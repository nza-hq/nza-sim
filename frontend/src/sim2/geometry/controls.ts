/**
 * Brief 114 P4b: the Controls step's control map, read from the plan and the document the engine receives. One row per
 * system that serves rooms (heating, cooling, hot water, ventilation, lighting) and per other load: what controls it,
 * what it follows, what it is set to, how it runs, and its week (168 hours, Monday first) where the document states
 * one. Nothing here is a result of the run; the week is the schedule the engine is given, hour for hour.
 */
import { CONTROLLERS, type Plan, type PlanControl, type Service, monthsText } from './plan'

/** A week of hourly values 0 to 1, Monday 00:00 first (five weekdays, Saturday, Sunday). */
export type Week = number[]
type Days = { weekday: number[]; saturday: number[]; sunday: number[] }
type DocProfile = { id: string; kind: string; label?: string; day_types?: Days; schedule?: Days; relationship_to_occupancy?: string }
type DocZone = { id: string; name: string; surfaces?: string[]; profile_refs: { occupancy: string | null; lighting: string[] }; setpoints: { heat_c: number | null; cool_c: number | null; setback_c: number | null; hours_ref: string | null }; ventilation: Array<{ id: string; label?: string; runs?: string | null; control_schedule_ref?: string | null; demand_min_fraction?: number | null }> }
type DocGroup = { id: string; service: string; label?: string; zones: string[]; pumps?: { runs: string; schedule_ref: string | null; season_months?: number[] | null } }
type Doc = { zones: DocZone[]; system_groups: DocGroup[]; profiles: DocProfile[]; surfaces?: Array<{ id: string; openings?: Array<{ kind: string }> }> }

export type MapRow = {
  /** Unique on the map: `${kind}:${plan id}`. */
  key: string
  /** `window`: a space type's window rule (ref = the space type's id), Brief 115. */
  control: { kind: PlanControl['kind'] | 'window'; ref: string }
  service: Service | 'other' | 'windows'
  name: string
  controller: string
  follows: string
  setTo: string | null
  runs: string | null
  /** Null: the document gives no hours to draw (said in `weekNote`). */
  week: Week | null
  weekNote: string | null
}

const ALL: Week = Array(168).fill(1)
const weekOf = (d: Days): Week => [...d.weekday, ...d.weekday, ...d.weekday, ...d.weekday, ...d.weekday, ...d.saturday, ...d.sunday]
const daysOf = (p: DocProfile | undefined) => p?.day_types ?? p?.schedule ?? null
const maxOf = (ws: Week[]) => (ws.length ? ws[0]!.map((_, h) => Math.max(...ws.map((w) => w[h]!))) : null)
/** Hours a day the week's Monday is above zero. */
export const hoursOnMonday = (w: Week) => w.slice(0, 24).filter((v) => v > 0).length
const firstOn = (w: Week) => w.slice(0, 24).findIndex((v) => v > 0)
const lastOn = (w: Week) => 23 - [...w.slice(0, 24)].reverse().findIndex((v) => v > 0)
const weekendOn = (w: Week) => w.slice(120).some((v) => v > 0)

export const controllerName = (c: PlanControl | undefined) => (c?.controller ? CONTROLLERS.find((x) => x.key === c.controller)!.name : 'Not stated')

export function controlMap(plan: Plan, doc: Doc | null): { occupied: Week | null; rows: MapRow[]; flags: string[] } {
  const prof = (id: string | null | undefined) => (id ? doc?.profiles.find((p) => p.id === id) : undefined)
  const zone = (id: string) => doc?.zones.find((z) => z.id === id)
  const occWeek = (zs: DocZone[]) => maxOf(zs.map((z) => daysOf(prof(z.profile_refs.occupancy))).filter((d): d is Days => !!d).map(weekOf))
  const occupied = doc ? occWeek(doc.zones) : null
  const ctl = (kind: PlanControl['kind'], ref: string) => (plan.controls ?? []).find((c) => c.kind === kind && c.ref === ref)
  const schedName = (ref: string | null | undefined) => (ref === 'always_on' ? 'every hour' : prof(ref)?.label ?? ref ?? 'not stated')
  const rows: MapRow[] = []
  const flags: string[] = []
  const occH = occupied ? hoursOnMonday(occupied) : null

  for (const sys of plan.systems) {
    if (sys.service === 'ventilation') {
      const entries = (doc?.zones ?? []).flatMap((z) => z.ventilation.filter((v) => v.id === `${sys.id}_vent`).map((v) => ({ z, v })))
      if (!entries.length) continue
      const v = entries[0]!.v
      const runs = v.runs ?? (v.control_schedule_ref === 'always_on' ? 'continuous' : 'schedule')
      const zs = entries.map((e) => e.z)
      const week = runs === 'continuous' ? ALL
        : runs === 'demand' ? (() => { const o = occWeek(zs); const m = v.demand_min_fraction ?? 0; return o ? o.map((x) => Math.max(x, m)) : null })()
          : (() => { const d = daysOf(prof(v.control_schedule_ref)); return v.control_schedule_ref === 'always_on' ? ALL : d ? weekOf(d) : null })()
      rows.push({
        key: `ventilation:${sys.id}`, control: { kind: 'ventilation', ref: sys.id }, service: 'ventilation', name: sys.name,
        controller: controllerName(ctl('ventilation', sys.id)),
        follows: runs === 'demand' ? `the people in (demand), never below ${Math.round((v.demand_min_fraction ?? 0) * 100)} %` : runs === 'continuous' ? 'every hour' : schedName(v.control_schedule_ref),
        setTo: null, runs: runs === 'demand' ? 'With demand' : runs === 'continuous' ? 'Continuously' : 'On a schedule',
        week, weekNote: week ? null : 'No hours stated',
      })
      if (week && occH != null && occupied) {
        const fh = hoursOnMonday(week)
        if (fh >= occH + 4) flags.push(`${sys.name}: fans run ${fh} h on a weekday; the building is occupied ${occH} h`)
        if (weekendOn(week) && !weekendOn(occupied)) flags.push(`${sys.name}: fans run at the weekend; nobody is in`)
      }
      continue
    }
    const g = doc?.system_groups.find((x) => x.id === `${sys.service}_${sys.id}`)
    if (!g) continue
    const zs = g.zones.map(zone).filter((z): z is DocZone => !!z)
    const kind: PlanControl['kind'] = sys.service === 'lighting' ? 'lighting' : 'system'
    const pumps = g.pumps ? (g.pumps.runs === 'continuous' ? `pumps continuously through its season (${g.pumps.season_months?.length ? monthsText(g.pumps.season_months) : 'months with load'})` : g.pumps.runs === 'with_demand' ? 'pumps with demand' : `pumps on ${schedName(g.pumps.schedule_ref)}`) : null
    if (sys.service === 'heating' || sys.service === 'cooling') {
      const heat = sys.service === 'heating'
      const sets = [...new Set(zs.map((z) => {
        const sp = z.setpoints
        const c = heat ? sp.heat_c : sp.cool_c
        return c == null ? 'not stated' : `${c} °C${heat && sp.setback_c != null ? `, ${sp.setback_c} °C outside its hours` : sp.hours_ref ? ', off outside its hours' : ''}`
      }))]
      const hours = [...new Set(zs.map((z) => (z.setpoints.hours_ref ? schedName(z.setpoints.hours_ref) : 'every hour')))]
      const weeks = zs.filter((z) => (heat ? z.setpoints.heat_c : z.setpoints.cool_c) != null).map((z) => { const d = daysOf(prof(z.setpoints.hours_ref)); return z.setpoints.hours_ref ? (d ? weekOf(d) : ALL) : ALL })
      const week = maxOf(weeks)
      rows.push({
        key: `system:${sys.id}`, control: { kind, ref: sys.id }, service: sys.service, name: sys.name,
        controller: controllerName(ctl(kind, sys.id)),
        follows: hours.length === 1 ? hours[0]! : `${hours.length} different hours across its rooms`,
        setTo: sets.length === 1 ? sets[0]! : `${sets.length} temperatures across its rooms`,
        runs: pumps, week, weekNote: week ? null : 'No temperature stated',
      })
      if (heat && week && occupied && occH) {
        const early = firstOn(occupied) - firstOn(week)
        const late = lastOn(week) - lastOn(occupied)
        const allDay = hoursOnMonday(week) === 24
        if (allDay && occH < 24) flags.push(`${sys.name}: heating held every hour; the building is occupied ${occH} h on a weekday`)
        else {
          if (early >= 2) flags.push(`${sys.name}: heating comes on ${early} h before anyone arrives`)
          if (late >= 2) flags.push(`${sys.name}: heating stays on ${late} h after everyone leaves`)
        }
        if (weekendOn(week) && !weekendOn(occupied) && !allDay) flags.push(`${sys.name}: heating runs at the weekend; nobody is in`)
      }
      continue
    }
    if (sys.service === 'lighting') {
      const ws = zs.flatMap((z) => z.profile_refs.lighting.map((id) => {
        const p = prof(id)
        const rel = p?.relationship_to_occupancy
        if (rel === 'always_on') return ALL
        const own = daysOf(p)
        if (rel === 'independent' && own) return weekOf(own)
        const o = daysOf(prof(z.profile_refs.occupancy))
        return o ? weekOf(o) : own ? weekOf(own) : null
      })).filter((w): w is Week => !!w)
      const rels = [...new Set(zs.flatMap((z) => z.profile_refs.lighting.map((id) => prof(id)?.relationship_to_occupancy ?? 'proportional')))]
      const relName = (r: string) => (r === 'always_on' ? 'always on' : r === 'independent' ? 'its own time clock' : r === 'proportional_with_spill' ? 'the people in, left on after' : 'the people in')
      const week = maxOf(ws)
      rows.push({
        key: `lighting:${sys.id}`, control: { kind, ref: sys.id }, service: 'lighting', name: sys.name,
        controller: controllerName(ctl(kind, sys.id)),
        follows: rels.length === 1 ? relName(rels[0]!) : rels.map(relName).join('; '), setTo: null, runs: null,
        week, weekNote: week ? null : 'No hours stated',
      })
      if (week && occupied && occH != null && hoursOnMonday(week) >= occH + 4) flags.push(`${sys.name}: lights on ${hoursOnMonday(week)} h on a weekday; the building is occupied ${occH} h`)
      continue
    }
    if (sys.service === 'dhw') {
      rows.push({
        key: `system:${sys.id}`, control: { kind, ref: sys.id }, service: 'dhw', name: sys.name,
        controller: controllerName(ctl(kind, sys.id)), follows: 'the hot water drawn', setTo: null, runs: pumps,
        week: null, weekNote: 'Heats as water is drawn',
      })
    }
  }
  // Brief 115: opening windows, one row per space type whose rooms have them in the document.
  const opensIn = (z: DocZone) => (z.surfaces ?? []).some((sid) => doc?.surfaces?.find((s) => s.id === sid)?.openings?.some((o) => o.kind === 'operable'))
  for (const sp of plan.spaces) {
    const zs = (doc?.zones ?? []).filter((z) => plan.rooms.some((r) => r.zone === z.id && r.space === sp.id) && opensIn(z))
    if (!zs.length) continue
    const w = sp.windows ?? null
    const hours = w?.hours && w.hours !== 'always_on' ? w.hours : null
    const d = hours ? daysOf(prof(hours)) : null
    rows.push({
      key: `window:${sp.id}`, control: { kind: 'window', ref: sp.id }, service: 'windows', name: `Windows · ${sp.name}`,
      controller: w?.controller ? CONTROLLERS.find((x) => x.key === w.controller)!.name : 'Not stated',
      follows: !w?.rule ? 'not stated' : w.rule === 'temperature' ? `the room above ${w.open_above_c ?? '?'} °C and warmer than outside${hours ? `, within ${schedName(hours)}` : ''}` : hours ? schedName(hours) : 'every hour',
      setTo: w?.open_fraction != null ? `${Math.round(w.open_fraction * 100)} % of their widest` : null, runs: null,
      week: hours ? (d ? weekOf(d) : null) : w?.rule ? ALL : null,
      weekNote: !w?.rule ? 'No window rule yet: the run asks for one' : w.rule === 'temperature' ? null : null,
    })
    if (w?.rule === 'temperature' && w.open_above_c != null && sp.heat_c != null && !(w.open_above_c > sp.heat_c)) flags.push(`Windows · ${sp.name}: open above ${w.open_above_c} °C, not above the heating's ${sp.heat_c} °C; they would open while it heats, so the run refuses it`)
  }
  for (const l of plan.other_loads ?? []) {
    rows.push({
      key: `other:${l.id}`, control: { kind: 'system', ref: l.id }, service: 'other', name: l.name, controller: '',
      follows: l.runs === 'continuous' ? 'every hour' : l.runs === 'dusk_to_dawn' ? `dusk to dawn${l.schedule ? `, within ${schedName(l.schedule)}` : ''}` : l.runs === 'schedule' ? schedName(l.schedule) : 'not stated',
      setTo: null, runs: null,
      week: l.runs === 'continuous' ? ALL : l.runs === 'schedule' ? (() => { const d = daysOf(prof(l.schedule)); return d ? weekOf(d) : null })() : null,
      weekNote: l.runs === 'dusk_to_dawn' ? 'Dark hours come from the weather file' : null,
    })
  }
  return { occupied, rows, flags }
}
