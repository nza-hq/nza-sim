/**
 * Mechanical and natural ventilation per zone (Brief 105 Part 3), as an hourly conductance to outdoor air.
 *
 * A port of today's engine's per-system ventilation loss (frontend/src/utils/instantCalc.js, State 2: ventSystems,
 * ventUA and the per-hour mech-vent loop):
 *
 *   H = ρc · q · (1 − η)          W/K, while the system runs
 *
 * with ρc today's 0.33 Wh/m³K (ENGINE_CONSTANTS.rho_c_air), q the flow and η the sensible heat recovery
 * (`recovery_sensible_pct` / 100). Supply air at θ_e + η(θ_a − θ_e) brings ρc·q·(1 − η)·(θ_e − θ_a) into the zone,
 * which is the same heat. Flow bases, as today (projectV40FlowToLps):
 *
 *   constant     flow_rate l/s for the zone
 *   per_m2       flow_rate l/s per m² of the zone's floor
 *   per_person   flow_rate l/s per person at the zone's design occupancy (its occupancy profile's people × rate)
 *   ach          flow_rate air changes per hour of the zone's volume (natural ventilation; new in Brief 105)
 *
 * Stated differences from today's engine:
 * - **Schedule.** Today scales each system by `hours / 8760` all year (v25) and ignores its schedule. Here the
 *   system runs at its `control_schedule_ref` schedule's hourly fraction (a document `schedule` profile, 1 January a
 *   Monday as for gains), or all the time for today's built-in `always_on`. For Bridgewater (`always_on`, 8760 hours)
 *   the two are the same.
 * - **No fallbacks.** Today reads a missing recovery as 0 and a missing basis as 'constant'. Here MVHR needs its
 *   recovery stated; MEV and natural ventilation may state none or 0 (they have no heat exchanger); flow, basis and
 *   schedule are required.
 * - **Summer bypass** (today: recovery off in hours after a cooling hour when outside is cooler than the zone) is not
 *   modelled yet: a system with `summer_bypass: true` is refused rather than run without it.
 * - **Per zone.** A building's flow (`constant`) belongs to the zone whose entry states it; the per-storey converter
 *   shares Bridgewater's out by floor area.
 *
 * Not here: fan energy and fan heat (Systems, Engine 4), latent recovery, `share_pct` (a Systems split; today's
 * ventilation loss does not read it either).
 */
import { ENGINE_CONSTANTS as K } from './constants'
import { calendar, zoneGains, GainsError } from './gains'
import type { ModelDocument } from '../schema/model'
import type { Weather } from './types'

/**
 * Today's built-in "runs all the time" schedule name (systemsEngine.js `schedule_ref: 'always_on'`; the v40 entries'
 * `control_schedule_id`). It is not a document profile; a document profile of the same id would take precedence.
 */
export const ALWAYS_ON = 'always_on'

export class VentilationError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'VentilationError' }
}

export interface ZoneVentilation {
  id: string
  kind: 'mvhr' | 'mev' | 'natural'
  /** m³/s while running. */
  flow_m3s: number
  /** Sensible heat recovery, 0 to 1. */
  recovery: number
  /** Hourly conductance to outdoor air, W/K. */
  h_w_per_k: Float64Array
  /** The fraction of each hour the system runs, 0 to 1, from its schedule (Brief 107: fan hours follow it too). */
  running: Float64Array
}

/** Each zone's ventilation entries that run (enabled, kind not 'none'), with their hourly conductance. */
export function zoneVentilation(doc: ModelDocument, hours: Weather['hours']): ZoneVentilation[][] {
  const H = hours.count
  const c = calendar(hours)
  const sched = new Map(doc.profiles.flatMap((p, i) => (p.kind === 'schedule' ? [[p.id, { p, i }] as const] : [])))
  let presenceOf: (Float64Array | null)[] | undefined
  return doc.zones.map((zone, zi) => {
    const out: ZoneVentilation[] = []
    zone.ventilation.forEach((v, j) => {
      const p = `zones[${zi}].ventilation[${j}]`
      if (!v.enabled || v.kind === 'none') return
      if (v.summer_bypass === true) throw new VentilationError('summer bypass is not modelled yet (Brief 105 Part 3)', `${p}.summer_bypass`)
      const rate = v.flow_rate
      if (rate == null || !Number.isFinite(rate)) throw new VentilationError('required', `${p}.flow_rate`)
      if (rate < 0) throw new VentilationError('must be ≥ 0', `${p}.flow_rate`)
      const basis = v.flow_rate_basis
      if (basis == null) throw new VentilationError('required (constant, per_m2, per_person or ach)', `${p}.flow_rate_basis`)
      let q: number  // m³/s
      switch (basis) {
        case 'constant': q = rate / 1000; break
        case 'per_m2': q = (rate * zone.area_m2) / 1000; break
        case 'per_person': q = (rate * designOccupants(doc, zi, p)) / 1000; break
        case 'ach': q = (rate * zone.area_m2 * zone.height_m) / 3600; break
        default: throw new VentilationError(`unknown basis "${basis}" (constant, per_m2, per_person or ach)`, `${p}.flow_rate_basis`)
      }
      let eta: number
      const r = v.recovery_sensible_pct
      if (v.kind === 'mvhr') {
        if (r == null || !Number.isFinite(r)) throw new VentilationError('required for MVHR', `${p}.recovery_sensible_pct`)
        if (!(r >= 0 && r <= 100)) throw new VentilationError('must be 0 to 100', `${p}.recovery_sensible_pct`)
        eta = r / 100
      } else {
        if (r != null && r !== 0) throw new VentilationError(`${v.kind === 'mev' ? 'extract' : 'natural'} ventilation has no heat recovery (null or 0)`, `${p}.recovery_sensible_pct`)
        eta = 0
      }
      const ref = v.control_schedule_ref
      const h0 = K.rho_c_air * q * (1 - eta)
      const hw = new Float64Array(H)
      const run = new Float64Array(H)
      // Brief 114: how the fans are told to run. Continuous: every hour. Demand: the share of the zone's people present
      // each hour (its occupancy profile's schedule), never below the stated least share. Schedule or not stated: the
      // schedule, as before.
      if (v.runs === 'continuous') {
        hw.fill(h0); run.fill(1)
        out.push({ id: v.id, kind: v.kind, flow_m3s: q, recovery: eta, h_w_per_k: hw, running: run })
        return
      }
      if (v.runs === 'demand') {
        const m = v.demand_min_fraction
        if (m == null) throw new VentilationError('required: the least share of the flow (0 to 1)', `${p}.demand_min_fraction`)
        const presence = (presenceOf ??= zonePresence(doc, hours))[zi]
        if (!presence) throw new VentilationError('fans on demand follow the people: the zone needs an occupancy profile', `zones[${zi}].profile_refs.occupancy`)
        for (let h = 0; h < H; h++) { const f = Math.min(1, Math.max(m, presence[h])); hw[h] = h0 * f; run[h] = f }
        out.push({ id: v.id, kind: v.kind, flow_m3s: q, recovery: eta, h_w_per_k: hw, running: run })
        return
      }
      if (ref == null) throw new VentilationError(`required: when the system runs ('${ALWAYS_ON}' or a schedule profile)`, `${p}.control_schedule_ref`)
      const s = sched.get(ref)
      if (s) {
        const dt = s.p.day_types
        for (let h = 0; h < H; h++) {
          const f = dt[c.day[h]][c.hourOfDay[h]]
          if (!(f >= 0 && f <= 1)) throw new VentilationError(`hour ${c.hourOfDay[h]} of ${c.day[h]} must be 0 to 1`, `profiles[${s.i}].day_types`)
          hw[h] = h0 * f
          run[h] = f
        }
      } else if (ref === ALWAYS_ON) { hw.fill(h0); run.fill(1) }
      else throw new VentilationError(`schedule profile "${ref}" does not exist`, `${p}.control_schedule_ref`)
      out.push({ id: v.id, kind: v.kind, flow_m3s: q, recovery: eta, h_w_per_k: hw, running: run })
    })
    return out
  })
}

/** The zone's design occupancy (people at full presence × occupancy rate), as today's designOccupants per zone. */
function designOccupants(doc: ModelDocument, zi: number, path: string): number {
  const zone = doc.zones[zi]
  const ref = zone.profile_refs.occupancy
  if (ref == null) throw new VentilationError('a per-person flow needs the zone\'s occupancy profile', `zones[${zi}].profile_refs.occupancy`)
  const i = doc.profiles.findIndex((p) => p.id === ref)
  const o = doc.profiles[i]
  if (!o || o.kind !== 'occupancy') throw new VentilationError(`occupancy profile "${ref}" does not exist`, `zones[${zi}].profile_refs.occupancy`)
  if (o.occupancy_rate == null) throw new VentilationError(`required by ${path}`, `profiles[${i}].occupancy_rate`)
  const d = o.density
  let people: number
  if (d.basis === 'per_m2') people = d.value * zone.area_m2
  else if (d.basis === 'per_room') {
    if (zone.rooms == null) throw new VentilationError(`required by ${path}`, `zones[${zi}].rooms`)
    people = d.value * zone.rooms
  } else if (d.basis === 'total') {
    const area = doc.zones.filter((z) => z.profile_refs.occupancy === ref).reduce((s, z) => s + z.area_m2, 0)
    people = (d.value * zone.area_m2) / area
  } else throw new VentilationError(`unknown basis "${d.basis}"`, `profiles[${i}].density.basis`)
  return Math.max(0, people * o.occupancy_rate)
}

/**
 * Brief 114: each zone's share of its people present each hour (its occupancy profile's schedule, 0 to 1), from the
 * same gains calculation the run uses; null for a zone with no occupancy profile. A gains refusal is passed on by name.
 */
function zonePresence(doc: ModelDocument, hours: Weather['hours']): (Float64Array | null)[] {
  try {
    return zoneGains(doc, hours).map((g) => g?.occupancy?.presence ?? null)
  } catch (e) {
    if (e instanceof GainsError) throw new VentilationError(e.message.slice(e.path.length + 2), e.path)
    throw e
  }
}
