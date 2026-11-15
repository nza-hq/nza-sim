/**
 * Internal gains from the document's profiles, per zone, hour by hour (Brief 105 Part 2).
 *
 * A faithful port of today's engine's gains (frontend/src/utils/instantCalc.js: computeHourlyGains,
 * computeTotalOccupants, magnitudeToWPerM2, lightingFractionForHour, equipmentFractionForHour, decomposeHour,
 * findActiveException), with three differences, each stated:
 *
 * 1. **Per zone, not per building.** Today's engine scales densities by the building's GIA and bedroom count. Here
 *    each zone scales the profiles it refers to by its own `area_m2` and `rooms`. A building total (`basis: 'total'`,
 *    `unit: 'total_w'`) is shared among the zones that refer to the profile by floor area, so a document cut into
 *    zones has the same building total as the one-zone document.
 * 2. **No fallbacks.** Where today's engine falls back (occupancy rate 0.75, 75 W a person, daylight factor 0.6, …),
 *    this module refuses and names the field. Schema 2.3's upgrade and the converter write today's fallbacks into the
 *    document (schema/upgrade.ts, stateTodaysGainInputs), so a converted document runs with the same values.
 * 3. **No occupancy, no occupancy-driven gains.** Today's engine returns zero for every gain when the building has no
 *    occupancy. Here a zone without an occupancy profile may still have gains that do not follow occupancy
 *    ('independent' with its own schedule, 'always_on'); one that does follow occupancy refuses, naming the zone's
 *    occupancy ref.
 *
 * Not here (as today): latent heat (demand is sensible), and the Systems scalar on lighting and small power
 * (`systems_config_v40`), which is Engine 4's.
 *
 * Calendar, as today: 1 January is a Monday; the day of the year comes from the weather's month and day on a
 * non-leap calendar; a schedule exception applies on the dates its MM-DD range covers (wrapping the year end).
 */
import type { ModelDocument, Profile } from '../schema/model'
import type { Weather } from './types'

export class GainsError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'GainsError' }
}

export type GainKind = 'occupancy' | 'lighting' | 'equipment' | 'auxiliary'

/** One profile's heat gain into one zone, W per hour (= Wh). */
export interface ZoneGain {
  kind: GainKind
  profile_id: string
  w: Float64Array
  radiant_fraction: number
}

/** A zone's gains: each profile's, their total, and the hourly convective share of the total (0 when there is none). */
export interface ZoneGains {
  gains: ZoneGain[]
  total_w: Float64Array
  convective_fraction: Float64Array
}

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

type Day = 'weekday' | 'saturday' | 'sunday'
type Sched = { weekday: number[]; saturday: number[]; sunday: number[]; monthly_multipliers?: number[]; exceptions?: Record<string, unknown>[] }

interface Calendar { monthIdx: Int8Array; day: Day[]; hourOfDay: Int8Array; mmdd: string[] }

/** decomposeHour, once for the year. */
export function calendar(hours: Weather['hours']): Calendar {
  const H = hours.count
  const monthIdx = new Int8Array(H), hourOfDay = new Int8Array(H), day: Day[] = new Array(H), mmdd: string[] = new Array(H)
  for (let h = 0; h < H; h++) {
    const m = hours.month[h], d = hours.day[h]
    monthIdx[h] = m - 1
    hourOfDay[h] = hours.hour[h] - 1
    const dow = (CUM_DAYS[m - 1] + (d - 1)) % 7
    day[h] = dow === 5 ? 'saturday' : dow === 6 ? 'sunday' : 'weekday'
    mmdd[h] = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return { monthIdx, day, hourOfDay, mmdd }
}

function inRange(d: string, a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false
  return a <= b ? d >= a && d <= b : d >= a || d <= b
}

function activeException(s: Sched, d: string): Record<string, any> | null {
  for (const e of s.exceptions ?? []) if (inRange(d, e.start_date, e.end_date)) return e as Record<string, any>
  return null
}

/** A schedule's own value for the hour: its exception's day if one is active, else its day; × the monthly multiplier. */
function ownValue(s: Sched, c: Calendar, h: number): number {
  const e = activeException(s, c.mmdd[h])
  const dt = c.day[h], hr = c.hourOfDay[h]
  const mm = Number(s.monthly_multipliers?.[c.monthIdx[h]] ?? 1)
  // An active exception without this day's values is NaN, refused by the caller with its path (review F5): today's
  // engine read it as 0.
  if (e) return (Array.isArray(e[dt]) ? Number(e[dt][hr] ?? 0) : NaN) * (e.ignore_monthly_multipliers ? 1 : mm)
  return Number(s[dt]?.[hr] ?? 0) * mm
}

/** The schedule's day value without the exception check (lightingFractionForHour and equipmentFractionForHour). */
function dayValue(s: Sched, c: Calendar, h: number): number {
  return Number(s[c.day[h]]?.[c.hourOfDay[h]] ?? 0) * Number(s.monthly_multipliers?.[c.monthIdx[h]] ?? 1)
}

const LIGHT_REL = new Set(['always_on', 'independent', 'proportional', 'proportional_with_spill'])
const EQUIP_REL = new Set(['independent', 'proportional'])

/**
 * Each zone's gains over the weather year, or null for a zone that refers to no gain profile. `share[z]` is computed
 * here: the zone's share of a building-total profile, by floor area among the zones that refer to it.
 */
export function zoneGains(doc: ModelDocument, hours: Weather['hours']): (ZoneGains | null)[] {
  const H = hours.count
  const c = calendar(hours)
  const byId = new Map<string, { p: Profile; i: number }>(doc.profiles.map((p, i) => [p.id, { p, i }]))
  // Floor area of the zones that refer to each profile, for building totals.
  const refArea = new Map<string, number>()
  for (const z of doc.zones) {
    const r = z.profile_refs
    for (const id of new Set([r.occupancy, ...r.lighting, ...r.equipment, ...r.auxiliary])) if (id != null) refArea.set(id, (refArea.get(id) ?? 0) + z.area_m2)
  }
  const need = <T>(v: T | null | undefined, path: string, what = 'required'): T => {
    if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) throw new GainsError(what, path)
    return v
  }
  const frac01 = (v: unknown, path: string) => {
    const x = need(v as number | null | undefined, path)
    if (!(x >= 0 && x <= 1)) throw new GainsError('must be 0 to 1', path)
    return x
  }

  return doc.zones.map((zone, zi) => {
    const zp = `zones[${zi}]`
    const refs = zone.profile_refs
    if (refs.occupancy == null && refs.lighting.length + refs.equipment.length + refs.auxiliary.length === 0) return null
    const A = zone.area_m2
    const get = (id: string, kind: GainKind, path: string) => {
      const f = byId.get(id)
      if (!f) throw new GainsError(`profile "${id}" does not exist`, path)
      if (f.p.kind !== kind) throw new GainsError(`profile "${id}" is ${f.p.kind}, not ${kind}`, path)
      return f as { p: Extract<Profile, { kind: typeof kind }>; i: number }
    }
    const share = (id: string) => A / (refArea.get(id) as number)
    const rooms = (path: string) => {
      const r = zone.rooms
      if (r == null) throw new GainsError(`required by ${path}`, `${zp}.rooms`)
      return r
    }
    /** magnitudeToWPerM2 × zone area: the zone's W at fraction 1. */
    const watts = (m: { value: number; unit: string }, id: string, path: string): number => {
      switch (m.unit) {
        case 'w_per_m2': return m.value * A
        case 'w_per_room': return m.value * rooms(path)
        case 'total_w': return m.value * share(id)
        default: throw new GainsError(`unknown unit "${m.unit}" (w_per_m2, w_per_room or total_w)`, `${path}.unit`)
      }
    }

    const out: ZoneGain[] = []
    // ── Occupancy ──────────────────────────────────────────────────────────────────────────────────────────────
    let presence: Float64Array | null = null
    let occRate = NaN
    let occSched: Sched | null = null
    if (refs.occupancy != null) {
      const { p, i } = get(refs.occupancy, 'occupancy', `${zp}.profile_refs.occupancy`)
      const pp = `profiles[${i}]`
      const o = p as Extract<Profile, { kind: 'occupancy' }>
      occSched = need(o.schedule as Sched | undefined, `${pp}.schedule`)
      occRate = need(o.occupancy_rate, `${pp}.occupancy_rate`)
      const sensible = need(o.sensible_w_per_person, `${pp}.sensible_w_per_person`)
      const rf = frac01(o.radiant_fraction, `${pp}.radiant_fraction`)
      const d = o.density
      let people: number
      switch (d.basis) {
        case 'per_m2': people = d.value * A; break
        case 'per_room': people = d.value * rooms(`${pp}.density`); break
        case 'total': people = d.value * share(o.id); break
        default: throw new GainsError(`unknown basis "${d.basis}" (per_m2, per_room or total)`, `${pp}.density.basis`)
      }
      presence = new Float64Array(H)
      const w = new Float64Array(H)
      for (let h = 0; h < H; h++) {
        presence[h] = ownValue(occSched, c, h)
        if (Number.isNaN(presence[h])) throw new GainsError(`an exception active on ${c.mmdd[h]} has no ${c.day[h]} values`, `${pp}.schedule.exceptions`)
        w[h] = people * occRate * presence[h] * sensible
      }
      out.push({ kind: 'occupancy', profile_id: o.id, w, radiant_fraction: rf })
    }

    // ── Lighting, auxiliary, equipment ─────────────────────────────────────────────────────────────────────────
    const gainProfile = (id: string, kind: Exclude<GainKind, 'occupancy'>, j: number) => {
      const { p, i } = get(id, kind, `${zp}.profile_refs.${kind}[${j}]`)
      const pp = `profiles[${i}]`
      const g = p as Extract<Profile, { kind: 'lighting' }>
      // Range-checked, not clamped (review F5; today's engine clamps the gain fraction to 0..1).
      const areaShare = need(g.area_share, `${pp}.area_share`)
      if (!(areaShare >= 0)) throw new GainsError('must be ≥ 0', `${pp}.area_share`)
      const gainFraction = frac01(g.gain_fraction, `${pp}.gain_fraction`)
      const rf = frac01(g.radiant_fraction, `${pp}.radiant_fraction`)
      const rel = need(g.relationship_to_occupancy, `${pp}.relationship_to_occupancy`)
      const isEquip = kind === 'equipment'
      if (!(isEquip ? EQUIP_REL : LIGHT_REL).has(rel)) {
        throw new GainsError(`unknown relationship "${rel}" (${[...(isEquip ? EQUIP_REL : LIGHT_REL)].join(', ')})`, `${pp}.relationship_to_occupancy`)
      }
      // Today's helpers fall back to the occupancy schedule when a profile has none of its own.
      const ownSched = (g.schedule as Sched | undefined) ?? null
      const usesOcc = rel === 'proportional' || rel === 'proportional_with_spill' || (rel === 'independent' && !ownSched)
      if (usesOcc && presence === null) {
        throw new GainsError(`profile "${g.id}" follows occupancy (${rel}${ownSched ? '' : ', no schedule of its own'}), and the zone has no occupancy profile`, `${zp}.profile_refs.occupancy`)
      }
      const sched = (ownSched ?? occSched) as Sched
      const daylight = !isEquip && rel === 'proportional_with_spill' ? frac01(g.daylight_factor, `${pp}.daylight_factor`) : 1
      const standby = isEquip && rel !== 'independent' ? frac01(g.standby_factor, `${pp}.standby_factor`) : 0

      let base = 0, act = 0
      if (isEquip) {
        base = watts(need(g.baseload, `${pp}.baseload`), g.id, `${pp}.baseload`) * areaShare
        act = watts(need(g.active, `${pp}.active`), g.id, `${pp}.active`) * areaShare
      } else {
        act = watts(need(g.magnitude, `${pp}.magnitude`), g.id, `${pp}.magnitude`) * areaShare
      }
      const w = new Float64Array(H)
      for (let h = 0; h < H; h++) {
        let f: number
        if (rel === 'independent') {
          f = ownValue(sched, c, h)
          if (Number.isNaN(f)) throw new GainsError(`an exception active on ${c.mmdd[h]} has no ${c.day[h]} values`, `${pp}.schedule.exceptions`)
        }
        else if (isEquip) f = Math.max(standby, dayValue(sched, c, h) * occRate)
        else if (rel === 'always_on') f = 1
        else if (rel === 'proportional') f = presence![h] * occRate
        else {
          f = dayValue(sched, c, h) * occRate
          const hr = c.hourOfDay[h]
          if (hr >= 9 && hr <= 16 && daylight < 1) f *= daylight
        }
        w[h] = (base + act * f) * gainFraction
      }
      out.push({ kind, profile_id: g.id, w, radiant_fraction: rf })
    }
    refs.lighting.forEach((id, j) => gainProfile(id, 'lighting', j))
    refs.equipment.forEach((id, j) => gainProfile(id, 'equipment', j))
    refs.auxiliary.forEach((id, j) => gainProfile(id, 'auxiliary', j))

    const total_w = new Float64Array(H), convective_fraction = new Float64Array(H)
    for (let h = 0; h < H; h++) {
      let t = 0, cv = 0
      for (const g of out) { t += g.w[h]; cv += (1 - g.radiant_fraction) * g.w[h] }
      total_w[h] = t
      convective_fraction[h] = t > 0 ? cv / t : 0
    }
    return { gains: out, total_w, convective_fraction }
  })
}
