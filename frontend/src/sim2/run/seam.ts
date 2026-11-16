/**
 * Brief 105 Part 4: the run seam. A model document in, either results or the list of what is missing, in plain words.
 *
 *   simulate(doc, { weather, constructions? }) → { ok: true, results, summary } | { ok: false, missing }
 *
 * The document is checked against the schema; an older version is refused, not upgraded (review F1). Then the inputs a run
 * needs and the editor may not have yet are checked together, so the person sees every gap at once:
 *   weather, each construction, the building's thermal bridging, each zone's setpoints and air leakage. A zone with
 *   its control stated and only a heating (or only a cooling) setpoint is heated only (or cooled only).
 * Anything the engine itself still refuses (a gain profile without a density, a ventilation entry without a flow…)
 * comes back the same way, named by its path. Nothing is filled in (CLAUDE.md rules 2 and 3).
 *
 * The run: Engine 2 on REFEREE_OPTIONS (the configuration the EnergyPlus gates were passed on), with internal gains
 * from the document's profiles and the document's ventilation (Parts 2 and 3). It reports demand, heating and
 * cooling, per zone and for the building, the building's breakdown (Rule 9: every term, summed over the zones;
 * heat between zones cancels and is left out) and each zone's own breakdown, heat from the other zones included (Brief 106).
 */
import { REFEREE_OPTIONS, runModel, UNMET_K, zoneSetpointHours, type RunOptions, type ZoneSetpointHours } from '../../thermal/engine/model'
import { zoneSizing, type ZoneSizing } from '../../thermal/engine/emitters'
import { FUELS, readDocFloorM2, readSystemsEui, readSystemsTotalKwh, runSystems, ServedError, type EndUse, type Fuel } from '../../thermal/engine/systems'
import {
  readBuildingCoolingKwh, readBuildingHeatingKwh, readBuildingHourlyW, readBuildingPeakW, readZoneMinControlC, type BreakdownLine, type ModelResults,
} from '../../thermal/engine/results'
import { ModelDocument, type Surface } from '../../thermal/schema/model'
type SurfaceKind = Surface['kind']
import { upgradeDocument } from '../../thermal/schema/upgrade'
import { CONSTRUCTIONS, resolveConstructions, type LibraryItem, type Missing } from './library'
import type { WeatherChoice } from './weather'

export type { Missing } from './library'

export const RUN_OPTIONS: RunOptions = { ...REFEREE_OPTIONS, internal_gains: 'profiles', ventilation: 'document' }
/**
 * Brief 109 review F3: a zone that is both limited by its emitters and heated to hours is run in quarter hours. At one
 * step an hour the hour's temperature is its end, the warmest point of a limited morning's recovery, and the hours
 * below in use are undercounted (cooled room, mild: −54 h of EnergyPlus's 248 at 1 step, −31 h at 4; the gate is
 * ±50 h). Every other document keeps one step an hour, Brief 104's speed budget.
 */
export const QUARTER_HOUR_OPTIONS: RunOptions = { ...RUN_OPTIONS, time_step: { steps_per_hour: 4, theta_e_between: 'linear' } }
export function runOptionsFor(doc: ModelDocument): RunOptions {
  return doc.zones.some((z) => z.emitters.length > 0 && z.setpoints.hours_ref != null) ? QUARTER_HOUR_OPTIONS : RUN_OPTIONS
}

/** Heating and cooling by calendar month, kWh, January first (Brief 109, for the editor's charts). Sums to the year. */
export interface Monthly { heating_kwh: number[]; cooling_kwh: number[] }
/**
 * The breakdown's lines that belong to a surface, grouped by the surface's kind and the term (Brief 109). A regrouping
 * of the same lines, not a second calculation: with the lines that name no surface, they sum to `breakdown` term by term.
 * An interzone floor or ceiling takes its kind from the zone's own side (one zone's floor is the other's ceiling).
 */
export interface SurfaceLine { kind: SurfaceKind; term: BreakdownLine['term']; kwh: number }
/** Compass sector of a window's outward normal (N is 315° to 45°…), or `horizontal` when tilted less than 45°. */
export type Facing = 'N' | 'E' | 'S' | 'W' | 'horizontal'
/** Sun through windows by facing, kWh a year: transmitted into the room, and absorbed in the glass (Brief 109). */
export interface WindowSolar { facing: Facing; transmitted_kwh: number; absorbed_kwh: number }

/**
 * Brief 109 Part 4: a zone heated to hours. Hours are numbered from 1 January 00:00 (0 to 8,759). The morning peak is
 * the largest hour of heating in the first in-use hour of any day (bringing the room back from its setback); the
 * later peak is the largest in any other in-use hour of the same run (review F8: not the peak without the setback,
 * which is the emitter sizing's `peak_w`). Recovery is over the cold mornings: of the days whose first in-use hour
 * starts from below the setpoint, the coldest quarter by the day's mean outdoor temperature. Each morning counts the
 * hours until the control temperature is within UNMET_K of the setpoint (0: within the first hour); a morning that
 * never gets there that day is counted apart.
 */
export interface ZoneHours {
  /** The heating setpoint in use, and the setback outside (null: heating off outside the hours), °C. */
  setpoint_c: number
  setback_c: number | null
  in_use_hours: number
  unmet_in_use_hours: number | null
  min_in_use_c: number | null
  morning_peak: { w: number; hour: number } | null
  later_peak: { w: number; hour: number } | null
  /** True when the zone's emitters limit its heating; false when heating is unlimited (review F2). */
  limited: boolean
  recovery: { mornings: number; median_h: number | null; not_reached: number } | null
}

export interface Summary {
  engine: ModelResults['engine']
  run_ms: number
  /** Steps the year was run in per hour: 1, or 4 when a limited zone is heated to hours (review F3, runOptionsFor). */
  steps_per_hour: number
  weather: { file_name: string; station: string; sha256: string }
  building: { floor_m2: number; heating_kwh: number; cooling_kwh: number; peak_heating_w: number; peak_cooling_w: number; monthly: Monthly }
  /** `heated` / `cooled`: false where the zone has no setpoint for it (heated only, or cooled only). */
  zones: {
    id: string; name: string; floor_m2: number; heating_kwh: number; cooling_kwh: number; heated: boolean; cooled: boolean
    /** The zone's own balance by term, kWh a year (Brief 106 P2, review F3): every term, heat from the other zones included. */
    breakdown: { term: BreakdownLine['term']; kwh: number }[]
    monthly: Monthly
    by_surface: SurfaceLine[]
    window_solar: WindowSolar[]
    /** Brief 109: heated to hours (a schedule and, usually, a setback); null when heated (or not) all year. */
    hours: ZoneHours | null
  }[]
  /** The building's balance by term, kWh a year: positive is heat into the building. Heating and cooling included. */
  breakdown: { term: BreakdownLine['term']; kwh: number }[]
  /** The building's surface lines by kind (heat between zones left out, as in `breakdown`). */
  by_surface: SurfaceLine[]
  window_solar: WindowSolar[]
  /** The building's hourly heating and cooling, W, 8,760 values; only when the run asks for it (`hourly: true`), else null. */
  hourly: { heating_w: Float64Array; cooling_w: Float64Array } | null
  /** Constructions used that are drafts awaiting review (not yet in the library), by display name. */
  drafts: string[]
  /**
   * Energy the installed systems use (Brief 107), or what they still need. Demand shows either way. The EUI here is
   * v2's own boundary (Rule 11), read once through readSystemsEui.
   */
  energy:
    | {
        ok: true; eui_kwh_per_m2: number; total_kwh: number
        by_fuel: { fuel: Fuel; kwh: number }[]
        end_uses: { end_use: EndUse; fuel: Fuel; kwh: number }[]
        systems: { id: string; label: string; service: EndUse; fuel: Fuel; efficiency: number | null; served_kwh: number; fuel_kwh: number }[]
        /** Inputs stated but not used yet, in words (review F4). */
        not_modelled: string[]
        /** True when no hot water system or hot water use is stated, so hot water is not in the total (review F1). */
        no_hot_water: boolean
      }
    | { ok: false; missing: Missing[] }
  /**
   * Brief 108 Part 4: each zone that states emitters, their output against the peak it needs, and the standard rating
   * that would cover it. Null when no zone states emitters (heating is not limited anywhere).
   */
  emitters: EmitterSummary | null
}

/** One zone's emitters: sizing (peak from a run with the emitters unlimited) and how the capped run went. */
export type EmitterZone = ZoneSizing & {
  id: string; name: string
  /**
   * Hours the zone ran more than 0.5 K below its heating setpoint, in the capped run. For a zone heated to hours
   * (`in_use`), only the hours in use count (the engine's `unmet_heating_hours_in_use`; Brief 109 review F6).
   */
  unmet_hours: number | null
  /** The lowest control temperature in the capped run, °C: of the year, or of the hours in use when `in_use`. */
  min_c: number
  /** Brief 109 review F6: true when the zone is heated to hours, so the two lines above are of the hours in use. */
  in_use: boolean
  /** Hours the emitters gave all they could, in the capped run. */
  hours_at_cap: number
}

export interface EmitterSummary {
  zones: EmitterZone[]
  /**
   * The same building with every wet heating system's design flow and return temperatures replaced, and nothing else
   * changed (Linzie's case: 70/60 against 50/40). Null when no what-if was asked for.
   */
  what_if:
    | null
    | { ok: true; flow_c: number; return_c: number; heating_kwh: number; zones: EmitterZone[]; energy: Summary['energy'] }
    | { ok: false; flow_c: number; return_c: number; missing: Missing[] }
}

export interface WhatIf { design_flow_c: number; design_return_c: number }

export type SimulateResult =
  | { ok: true; results: ModelResults; summary: Summary }
  | { ok: false; missing: Missing[] }

const WORDS: [RegExp, (m: RegExpMatchArray, doc: ModelDocument | null) => string][] = [
  [/^zones$/, () => 'Draw the building and put its rooms in at least one zone.'],
  [/^zones\[(\d+)\]\.setpoints\.heat_c$/, (m, d) => `Set the heating setpoint for ${zoneName(d, m[1])}.`],
  [/^zones\[(\d+)\]\.setpoints\.cool_c$/, (m, d) => `Set the cooling setpoint for ${zoneName(d, m[1])}.`],
  [/^zones\[(\d+)\]\.infiltration_q50$/, (m, d) => `Set the air leakage (q50) for ${zoneName(d, m[1])}.`],
  [/^zones\[(\d+)\]\.rooms$/, (m, d) => `Set the number of rooms in ${zoneName(d, m[1])}.`],
  [/^zones\[(\d+)\]\.ventilation\[(\d+)\]\.flow_rate(_basis)?$/, (m, d) => `Set the ventilation flow for ${zoneName(d, m[1])}.`],
  [/^zones\[(\d+)\]\.ventilation\[(\d+)\]\.control_schedule_ref$/, (m, d) => `Say when the ventilation runs in ${zoneName(d, m[1])}.`],
  [/^zones\[(\d+)\]\.ventilation\[(\d+)\]\.recovery_sensible_pct$/, (m, d) => `Set the MVHR heat recovery for ${zoneName(d, m[1])}.`],
  [/^building\.thermal_bridging\./, () => 'Set the thermal bridging for the building.'],
  [/^building\.site\.exposure$/, () => 'Set the site exposure (sheltered, normal or exposed).'],
  [/^profiles\[(\d+)\]\.(\w+)/, (m, d) => `The space type "${profileLabel(d, m[1])}" needs ${FIELD[m[2]] ?? m[2].replace(/_/g, ' ')}.`],
]
const FIELD: Record<string, string> = {
  radiant_fraction: 'a radiant fraction', sensible_w_per_person: 'heat per person', occupancy_rate: 'an occupancy rate',
  magnitude: 'a lighting power (W/m²)', active: 'an equipment power (W/m²)', baseload: 'an always-on equipment power (W/m²)',
  relationship_to_occupancy: 'how it follows occupancy', gain_fraction: 'a gain fraction', area_share: 'an area share',
  daylight_factor: 'a daylight factor', standby_factor: 'a standby factor', schedule: 'a schedule', density: 'a density',
}
const EMITTER_FIELD: Record<string, string> = {
  count: 'how many there are', rated_output_w: 'the rated output (W)', radiant_fraction: 'the radiant fraction',
  system_group_id: 'the heating system that feeds it', rated_flow_c: 'the rated flow temperature', rated_return_c: 'the rated return temperature',
  rated_room_c: 'the rated room temperature', exponent_n: 'the exponent (n)',
  source_surface_id: 'the floor its pipes are in', source_layer_index: 'the layer its pipes run along',
}
const zoneName = (d: ModelDocument | null, i: string) => `"${d?.zones[Number(i)]?.name || `zone ${Number(i) + 1}`}"`
const profileLabel = (d: ModelDocument | null, i: string) => d?.profiles[Number(i)]?.label || d?.profiles[Number(i)]?.id || `profile ${i}`

/** One missing input in plain words; the engine's own message when there is no wording for its path. */
export function explain(path: string, message: string, doc: ModelDocument | null): Missing {
  // Brief 109: heating hours and setbacks, in words (the engine's refusals in zoneSetpointHours).
  const hz = path.match(/^zones\[(\d+)\]\.setpoints(\.hours_ref|\.setback_c)?$/)
  if (hz && message !== 'required') {
    const zn = zoneName(doc, hz[1])
    if (hz[2] === '.hours_ref') {
      if (message.startsWith('a setback needs')) return { path, what: `Choose the hours ${zn} is heated in, so its setback knows when to apply.` }
      if (message.startsWith('no profile')) return { path, what: `The hours chosen for ${zn} no longer exist. Choose them again.` }
      return { path, what: `The hours for ${zn} must be a schedule: ${message}.` }
    }
    if (hz[2] === '.setback_c') return { path, what: `In ${zn}, ${message}.` }
    return { path, what: `Set a heating or cooling setpoint for ${zn}, or take away its hours.` }
  }
  const dt = path.match(/^profiles\[(\d+)\]\.day_types\.(\w+)$/)
  if (dt) return { path, what: `The schedule "${profileLabel(doc, dt[1])}", ${message.replace(/^\w+ hour/, (x) => `${x.split(' ')[0]}, hour`)}.` }
  for (const [re, f] of WORDS) {
    const m = path.match(re)
    if (m) return { path, what: f(m, doc) }
  }
  // Brief 108: emitters and their system's design temperatures, in words; the engine's reason kept when it is not "required".
  const sentence = (head: string, field: string) => ({ path, what: message.startsWith('required') ? `Set ${field} for ${head}.` : `${head.charAt(0).toUpperCase()}${head.slice(1)}: ${message.replace(/^required: /, '')}.` })
  const g = path.match(/^system_groups\[(\d+)\]\.design_(flow|return)_c$/)
  if (g) {
    const sg = doc?.system_groups[Number(g[1])]
    return sentence(`the heating system "${sg?.label || sg?.id || g[1]}"`, `the ${g[2]} temperature its emitters run at`)
  }
  const e = path.match(/^zones\[(\d+)\]\.emitters\[(\d+)\]\.(\w+)$/)
  if (e) {
    const em = doc?.zones[Number(e[1])]?.emitters[Number(e[2])]
    return sentence(`the emitter "${em?.label || em?.id || e[2]}" in ${zoneName(doc, e[1])}`, EMITTER_FIELD[e[3]] ?? e[3].replace(/_/g, ' '))
  }
  return { path, what: `${message.charAt(0).toUpperCase()}${message.slice(1)} (${path}).` }
}

/** What a run needs that the document does not state yet, all at once. */
function preflight(doc: ModelDocument, weather: WeatherChoice | null, items: readonly LibraryItem[]) {
  const missing: Missing[] = []
  if (!weather) missing.push({ path: 'weather', what: 'Choose a weather file.' })
  const lib = resolveConstructions(doc, items)
  missing.push(...lib.missing)
  if (doc.building.thermal_bridging.mode == null) missing.push({ path: 'building.thermal_bridging.mode', what: 'Set the thermal bridging for the building.' })
  doc.zones.forEach((z, i) => {
    // A zone that states its control and one setpoint is heated only (or cooled only): the other side floats, and the
    // engine is told so by a null setpoint (no system for it, Rule 8). With no control stated, both are still to set.
    const sp = z.setpoints
    if (sp.control_strategy == null || (sp.heat_c == null && sp.cool_c == null)) {
      if (sp.heat_c == null) missing.push(explain(`zones[${i}].setpoints.heat_c`, 'required', doc))
      if (sp.cool_c == null) missing.push(explain(`zones[${i}].setpoints.cool_c`, 'required', doc))
    }
    if (z.infiltration_q50 == null && z.infiltration_ach == null) missing.push(explain(`zones[${i}].infiltration_q50`, 'required', doc))
  })
  return { missing, library: lib.library, drafts: lib.drafts }
}

export function simulate(input: unknown, deps: { weather: WeatherChoice | null; constructions?: readonly LibraryItem[]; options?: RunOptions; what_if?: WhatIf; hourly?: boolean }): SimulateResult {
  let doc: ModelDocument
  try {
    const v = (input as { schema_version?: unknown })?.schema_version
    const parsed = ModelDocument.safeParse(input)
    if (parsed.success) doc = parsed.data
    else if (v === '2.3' || v === '2.4') doc = upgradeDocument(input)  // 2.3 → 2.4 adds empty emitter lists (Brief 108), 2.4 → 2.5 null source fields (Brief 109); nothing is filled
    else if (v !== undefined && parsed.error.issues.some((i) => i.path[0] === 'schema_version')) {
      // An older document is not run here (review F1): the 2.2 → 2.3 upgrade states today's gain fallbacks, which is
      // right for a document converted from today's tool and wrong for one drawn in the editor. The editor writes the
      // current version; an older saved plan is brought up to date by the editor, which shows what it fills.
      upgradeDocument(input)  // still read, so a document that cannot be read says why
      return { ok: false, missing: [{ path: 'schema_version', what: `This building was saved in an older format (${String(v)}). Open it in the editor and save it again before results can be shown.` }] }
    } else return { ok: false, missing: parsed.error.issues.slice(0, 12).map((i) => explain(i.path.join('.'), i.message, null)) }
  } catch (e) {
    return { ok: false, missing: [{ path: 'schema_version', what: `The building cannot be read (${(e as Error).message}).` }] }
  }
  const pre = preflight(doc, deps.weather, deps.constructions ?? CONSTRUCTIONS)
  if (pre.missing.length) return { ok: false, missing: pre.missing }
  const weather = deps.weather!
  const options = deps.options ?? runOptionsFor(doc)
  const run = (d: ModelDocument, o: RunOptions) => runModel(d, weather.weather, pre.library, o)
  let results: ModelResults
  try {
    results = run(doc, options)
  } catch (e) {
    const m = engineMissing(e, doc)
    if (m) return { ok: false, missing: [m] }
    throw e
  }
  // By term, summed over the given zones' lines. The building leaves heat between zones out (it cancels); a zone keeps it.
  const byTerm = (zs: ModelResults['zones'], interzone: boolean) => {
    const m = new Map<BreakdownLine['term'], number>()
    for (const z of zs) for (const l of z.breakdown) if (interzone || l.term !== 'interzone') m.set(l.term, (m.get(l.term) ?? 0) + l.kwh)
    return [...m].map(([term, kwh]) => ({ term, kwh }))
  }
  const surf = new Map(doc.surfaces.map((x) => [x.id, x]))
  // A surface's kind from zone `zid`'s side: the zone_b side of an interzone floor is a ceiling, and the other way round.
  const kindFor = (sid: string, zid: string): SurfaceKind => {
    const x = surf.get(sid)
    if (!x) throw new Error(`breakdown line names surface "${sid}", which the document does not have`)
    if (x.zone_b === zid && x.zone_a !== zid) return x.kind === 'floor' ? 'ceiling' : x.kind === 'ceiling' ? 'floor' : x.kind
    return x.kind
  }
  const bySurface = (zs: ModelResults['zones'], interzone: boolean): SurfaceLine[] => {
    const m = new Map<string, SurfaceLine>()
    for (const z of zs) for (const l of z.breakdown) {
      if (l.surface_id == null || (!interzone && l.term === 'interzone')) continue
      const kind = kindFor(l.surface_id, z.zone_id), key = `${kind}|${l.term}`
      const e = m.get(key) ?? { kind, term: l.term, kwh: 0 }
      e.kwh += l.kwh; m.set(key, e)
    }
    return [...m.values()]
  }
  const windowSolar = (zs: ModelResults['zones']): WindowSolar[] => {
    const m = new Map<Facing, WindowSolar>()
    for (const z of zs) for (const l of z.breakdown) {
      if (l.surface_id == null || (l.term !== 'solar_transmitted' && l.term !== 'glazing_solar_absorbed')) continue
      const facing = facingOf(surf.get(l.surface_id)!)
      const e = m.get(facing) ?? { facing, transmitted_kwh: 0, absorbed_kwh: 0 }
      if (l.term === 'solar_transmitted') e.transmitted_kwh += l.kwh; else e.absorbed_kwh += l.kwh
      m.set(facing, e)
    }
    return FACINGS.filter((f) => m.has(f)).map((f) => m.get(f)!)
  }
  const bHeat = readBuildingHourlyW(results, 'heating'), bCool = readBuildingHourlyW(results, 'cooling')
  const hoursOf = zoneSetpointHours(doc, weather.weather.hours)
  const summary: Summary = {
    engine: results.engine, run_ms: results.run_ms, steps_per_hour: options.time_step?.steps_per_hour ?? 1,
    weather: { file_name: weather.file_name, station: weather.station, sha256: weather.sha256 },
    building: {
      floor_m2: readDocFloorM2(doc),
      heating_kwh: readBuildingHeatingKwh(results), cooling_kwh: readBuildingCoolingKwh(results),
      peak_heating_w: readBuildingPeakW(results, 'heating'), peak_cooling_w: readBuildingPeakW(results, 'cooling'),
      monthly: monthly(bHeat, bCool),
    },
    zones: results.zones.map((z, i) => ({
      id: z.zone_id, name: doc.zones[i].name, floor_m2: doc.zones[i].area_m2, heating_kwh: z.annual.heating_kwh, cooling_kwh: z.annual.cooling_kwh,
      heated: doc.zones[i].setpoints.heat_c != null, cooled: doc.zones[i].setpoints.cool_c != null, breakdown: byTerm([z], true),
      monthly: monthly(z.hourly.heating_w, z.hourly.cooling_w), by_surface: bySurface([z], true), window_solar: windowSolar([z]),
      hours: hoursOf[i] && doc.zones[i].setpoints.heat_c != null ? zoneHours(z, doc.zones[i].setpoints, hoursOf[i]!, weather.weather.hours.dry_bulb, options.control) : null,
    })),
    breakdown: byTerm(results.zones, false),
    by_surface: bySurface(results.zones, false),
    window_solar: windowSolar(results.zones),
    hourly: deps.hourly ? { heating_w: bHeat, cooling_w: bCool } : null,
    drafts: pre.drafts,
    energy: energyOf(doc, results, weather),
    emitters: null,
  }
  summary.emitters = emitterSummary(doc, results, options, run, weather, deps.what_if ?? null)
  return { ok: true, results, summary }
}

/** Brief 109 Part 4: a scheduled zone's hours below, peaks and morning recovery (see ZoneHours). */
function zoneHours(z: ModelResults['zones'][number], set: { heat_c: number | null; setback_c?: number | null }, sh: ZoneSetpointHours, te: ArrayLike<number>, control: RunOptions['control']): ZoneHours {
  const H = z.hourly.heating_w.length, q = z.hourly.heating_w
  const ctl = control === 'operative' ? z.hourly.theta_operative_c : z.hourly.theta_air_c
  const use = sh.in_use, sp = sh.hourly.heat_c
  let morning: ZoneHours['morning_peak'] = null, steady: ZoneHours['later_peak'] = null
  const starts: { day: number; h: number; tmean: number }[] = []
  for (let d = 0; d * 24 < H; d++) {
    let first = -1
    for (let i = 0; i < 24; i++) {
      const h = d * 24 + i
      if (!use[h]) continue
      if (first < 0) {
        first = h
        if (!morning || q[h] > morning.w) morning = { w: q[h], hour: h }
      } else if (!steady || q[h] > steady.w) steady = { w: q[h], hour: h }
    }
    // A cold morning starts from below the setpoint (the hour before was set back).
    if (first > 0 && ctl[first - 1] < sp[first] - UNMET_K) {
      let t = 0
      for (let i = 0; i < 24; i++) t += te[d * 24 + i]
      starts.push({ day: d, h: first, tmean: t / 24 })
    }
  }
  let recovery: ZoneHours['recovery'] = null
  if (starts.length) {
    const cold = [...starts].sort((a, b) => a.tmean - b.tmean).slice(0, Math.max(1, Math.round(starts.length / 4)))
    const took: number[] = []
    let notReached = 0
    for (const m of cold) {
      let h = m.h
      while (h < (m.day + 1) * 24 && use[h] && ctl[h] < sp[h] - UNMET_K) h++
      if (h < (m.day + 1) * 24 && use[h]) took.push(h - m.h); else notReached++
    }
    took.sort((a, b) => a - b)
    const median = took.length ? (took.length % 2 ? took[(took.length - 1) / 2] : (took[took.length / 2 - 1] + took[took.length / 2]) / 2) : null
    recovery = { mornings: cold.length, median_h: median, not_reached: notReached }
  }
  return {
    setpoint_c: set.heat_c!, setback_c: set.setback_c ?? null, in_use_hours: z.annual.in_use_hours, unmet_in_use_hours: z.annual.unmet_heating_hours_in_use, min_in_use_c: z.annual.min_control_in_use_c,
    morning_peak: morning, later_peak: steady, limited: z.emitters != null, recovery,
  }
}

const FACINGS: readonly Facing[] = ['N', 'E', 'S', 'W', 'horizontal']
/** A window's facing: `horizontal` below 45° tilt (a rooflight), else the 90° sector its azimuth falls in. */
export function facingOf(s: { azimuth_deg: number | null; tilt_deg: number }): Facing {
  if (s.tilt_deg < 45 || s.azimuth_deg == null) return 'horizontal'
  const a = ((s.azimuth_deg % 360) + 360) % 360
  return a >= 315 || a < 45 ? 'N' : a < 135 ? 'E' : a < 225 ? 'S' : 'W'
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
/** Hourly W (one non-leap year, 8,760 hours from 1 January) to kWh by month. */
function monthly(heat: ArrayLike<number>, cool: ArrayLike<number>): Monthly {
  if (heat.length !== 8760 || cool.length !== 8760) throw new Error(`monthly totals need 8,760 hours, not ${heat.length}`)
  const out: Monthly = { heating_kwh: [], cooling_kwh: [] }
  let h = 0
  for (const d of MONTH_DAYS) {
    let a = 0, b = 0
    for (const end = h + d * 24; h < end; h++) { a += heat[h]; b += cool[h] }
    out.heating_kwh.push(a / 1000); out.cooling_kwh.push(b / 1000)
  }
  return out
}

/** What the engine refused, named by its path; null for anything else (a fault, rethrown). */
function engineMissing(e: unknown, doc: ModelDocument): Missing | null {
  const err = e as Error & { path?: string }
  if (typeof err?.path !== 'string') return null
  const msg = err.message.startsWith(`${err.path}: `) ? err.message.slice(err.path.length + 2) : err.message
  return explain(err.path, msg, doc)
}

/**
 * Brief 108 Part 4. Sizing needs each zone's peak with its emitters unlimited: a second run of the same document,
 * the emitters' radiant share kept and their output not limited (`emitter_limit: 'none'`). The what-if changes only
 * the wet heating systems' design temperatures, runs capped and unlimited again, and reports the same lines.
 *
 * Brief 109 decision 4 (review F1): the sizing run is heated to the setpoint at every hour, with no hours and no
 * setback. With them, the unlimited peak is the Monday-morning recovery (Bridgewater storey 1: 328.4 kW against
 * 23.2 kW), and sizing to it would ask for emitters an order of magnitude too big. How the sized room recovers from
 * its setback is the capped run's, shown by the heating hours panel.
 */
export function steadyDocument(doc: ModelDocument): ModelDocument {
  if (!doc.zones.some((z) => z.setpoints.hours_ref != null)) return doc
  const d = structuredClone(doc)
  for (const z of d.zones) { z.setpoints.hours_ref = null; z.setpoints.setback_c = null }
  return d
}

/** Brief 108 Part 4: each zone's emitters sized on the steady run (see steadyDocument), and how the capped run went. */
function emitterSummary(
  doc: ModelDocument, results: ModelResults, options: RunOptions, run: (d: ModelDocument, o: RunOptions) => ModelResults,
  weather: WeatherChoice, whatIf: WhatIf | null,
): EmitterSummary | null {
  if (!doc.zones.some((z) => z.emitters.length > 0)) return null
  const unlimited = (d: ModelDocument) => run(steadyDocument(d), { ...options, emitter_limit: 'none' })
  const sized = (d: ModelDocument, capped: ModelResults, free: ModelResults): EmitterZone[] =>
    capped.zones.flatMap((z, i) => {
      if (!z.emitters) return []
      return [{
        id: z.zone_id, name: d.zones[i].name,
        ...zoneSizing(d, i, z.emitters, free.zones[i].annual.peak_heating_w),
        ...(d.zones[i].setpoints.hours_ref != null
          ? { unmet_hours: z.annual.unmet_heating_hours_in_use, min_c: z.annual.min_control_in_use_c ?? readZoneMinControlC(z), in_use: true }
          : { unmet_hours: z.annual.unmet_heating_hours, min_c: readZoneMinControlC(z), in_use: false }),
        hours_at_cap: z.emitters.hours_at_cap,
      }]
    })
  const free = unlimited(doc)
  const zones = sized(doc, results, free)
  if (!whatIf) return { zones, what_if: null }
  const { design_flow_c: flow_c, design_return_c: return_c } = whatIf
  const w = structuredClone(doc)
  let changed = 0
  for (const g of w.system_groups) {
    if (g.service === 'heating' && g.design_flow_c != null) { g.design_flow_c = flow_c; g.design_return_c = return_c; changed++ }
  }
  if (changed === 0) return { zones, what_if: { ok: false, flow_c, return_c, missing: [{ path: 'system_groups', what: 'No heating system states flow and return temperatures, so there is nothing to compare.' }] } }
  let wr: ModelResults
  try { wr = run(w, options) } catch (e) {
    const m = engineMissing(e, w)
    if (m) return { zones, what_if: { ok: false, flow_c, return_c, missing: [m] } }
    throw e
  }
  // Review F10: unlimited, only the radiant share can differ between the two pairs (when a zone mixes fixed and wet
  // emitters, the output weighting moves). Where no zone's share moves, the base run's peaks are the what-if's.
  const same = results.zones.every((z, i) => Math.abs((z.emitters?.radiant_fraction ?? 0) - (wr.zones[i].emitters?.radiant_fraction ?? 0)) < 1e-12)
  return { zones, what_if: { ok: true, flow_c, return_c, heating_kwh: readBuildingHeatingKwh(wr), zones: sized(w, wr, same ? free : unlimited(w)), energy: energyOf(w, wr, weather) } }
}

const SERVICE_WORDS: Record<string, string> = { heating: 'heating', cooling: 'cooling', dhw: 'hot water', lighting: 'lighting', small_power: 'small power', auxiliary: 'auxiliary' }

/** A systems gap in plain words, naming the system or zone. */
function explainSystems(path: string, message: string, doc: ModelDocument): Missing {
  const g = path.match(/^system_groups\[(\d+)\]\.(\w+)$/)
  if (g) {
    const sg = doc.system_groups[Number(g[1])]
    const name = `"${sg?.label || sg?.id}"`
    const what: Record<string, string> = {
      efficiency_metric: sg?.service === 'cooling' ? 'its SEER' : 'its efficiency or SCOP', source: 'what it runs on (gas, electricity, air source…)',
      share_pct: 'a share from 0 to 100 %', control_factor: 'a control factor of 0 or more',
    }
    if (message.startsWith('unknown source') || message.endsWith('runs on electricity')) return { path, what: `The system ${name}: ${message}.` }
    return { path, what: `The system ${name} needs ${what[g[2]] ?? g[2].replace(/_/g, ' ')}.` }
  }
  if (path === 'services.dhw') return { path, what: 'Hot water use is stated, but no hot water system is chosen to heat it.' }
  const z = path.match(/^zones\[(\d+)\]\.dhw$/)
  if (z) return { path, what: `Choose a hot water system for ${zoneName(doc, z[1])}.` }
  const d = path.match(/^services\.dhw\.(\w+)$/)
  if (d) {
    const what: Record<string, string> = {
      storage_setpoint_c: 'the hot water store temperature', tap_outlet_temp_c: 'the tap outlet temperature', cold_supply_temp_c: 'the cold supply temperature',
      demand_basis: 'how hot water use is counted (per person or per m²)', litres_per_person_per_day: 'litres per person a day', litres_per_m2_per_day: 'litres per m² a day',
      load_shape: 'when hot water is used (flat, or following occupancy)', circulation_pump_w: 'the circulation pump power (0 if none)',
    }
    return { path, what: message.startsWith('required') ? `Hot water needs ${what[d[1]] ?? d[1]}.` : `Hot water: ${what[d[1]] ?? d[1]} ${message}.` }
  }
  const v = path.match(/^zones\[(\d+)\]\.ventilation\[(\d+)\]\.sfp_w_per_l_s$/)
  if (v) return { path, what: `Set the fan power (SFP) for the ventilation in ${zoneName(doc, v[1])}.` }
  return { path, what: `${message.charAt(0).toUpperCase()}${message.slice(1)}.` }
}

function energyOf(doc: ModelDocument, results: ModelResults, weather: WeatherChoice): Summary['energy'] {
  let a: ReturnType<typeof runSystems>
  try { a = runSystems(doc, results, weather.weather.hours) } catch (e) {
    // The served-equals-demand check (Rule 9) failing is a fault in the tool, never a number to show.
    if (e instanceof ServedError) return { ok: false, missing: [{ path: 'systems', what: `The energy check failed (${e.message}). This is a fault in the tool; please report it.` }] }
    throw e
  }
  if (!a.ok) return { ok: false, missing: a.missing.map((m) => explainSystems(m.path, m.message, doc)) }
  const s = a.systems
  return {
    ok: true, eui_kwh_per_m2: readSystemsEui(s), total_kwh: readSystemsTotalKwh(s),
    by_fuel: FUELS.filter((f) => s.by_fuel[f] > 0).map((fuel) => ({ fuel, kwh: s.by_fuel[fuel] })),
    end_uses: s.end_uses.filter((l) => l.kwh > 0),
    systems: s.groups.map((g) => ({ id: g.id, label: g.label || `${SERVICE_WORDS[g.service] ?? g.service} system`, service: g.service, fuel: g.fuel, efficiency: g.efficiency, served_kwh: g.served_kwh, fuel_kwh: g.fuel_kwh })),
    not_modelled: s.not_modelled.map((n) => {
      const m = n.path.match(/^system_groups\[(\d+)\]/)
      const v = n.path.match(/^zones\[(\d+)\]\.ventilation/)
      const owner = m ? `"${doc.system_groups[Number(m[1])]?.label || doc.system_groups[Number(m[1])]?.id}"` : v ? `the ventilation in ${zoneName(doc, v[1])}` : n.path
      return `${owner}: ${n.what}`
    }),
    no_hot_water: s.dhw == null,
  }
}
