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
import { REFEREE_OPTIONS, runModel, type RunOptions } from '../../thermal/engine/model'
import { FUELS, readSystemsEui, readSystemsTotalKwh, runSystems, type EndUse, type Fuel } from '../../thermal/engine/systems'
import {
  readBuildingCoolingKwh, readBuildingHeatingKwh, readBuildingPeakW, type BreakdownLine, type ModelResults,
} from '../../thermal/engine/results'
import { ModelDocument } from '../../thermal/schema/model'
import { upgradeDocument } from '../../thermal/schema/upgrade'
import { CONSTRUCTIONS, resolveConstructions, type LibraryItem, type Missing } from './library'
import type { WeatherChoice } from './weather'

export type { Missing } from './library'

export const RUN_OPTIONS: RunOptions = { ...REFEREE_OPTIONS, internal_gains: 'profiles', ventilation: 'document' }

export interface Summary {
  engine: ModelResults['engine']
  run_ms: number
  weather: { file_name: string; station: string; sha256: string }
  building: { floor_m2: number; heating_kwh: number; cooling_kwh: number; peak_heating_w: number; peak_cooling_w: number }
  /** `heated` / `cooled`: false where the zone has no setpoint for it (heated only, or cooled only). */
  zones: {
    id: string; name: string; floor_m2: number; heating_kwh: number; cooling_kwh: number; heated: boolean; cooled: boolean
    /** The zone's own balance by term, kWh a year (Brief 106 P2, review F3): every term, heat from the other zones included. */
    breakdown: { term: BreakdownLine['term']; kwh: number }[]
  }[]
  /** The building's balance by term, kWh a year: positive is heat into the building. Heating and cooling included. */
  breakdown: { term: BreakdownLine['term']; kwh: number }[]
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
      }
    | { ok: false; missing: Missing[] }
}

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
const zoneName = (d: ModelDocument | null, i: string) => `"${d?.zones[Number(i)]?.name || `zone ${Number(i) + 1}`}"`
const profileLabel = (d: ModelDocument | null, i: string) => d?.profiles[Number(i)]?.label || d?.profiles[Number(i)]?.id || `profile ${i}`

/** One missing input in plain words; the engine's own message when there is no wording for its path. */
export function explain(path: string, message: string, doc: ModelDocument | null): Missing {
  for (const [re, f] of WORDS) {
    const m = path.match(re)
    if (m) return { path, what: f(m, doc) }
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

export function simulate(input: unknown, deps: { weather: WeatherChoice | null; constructions?: readonly LibraryItem[]; options?: RunOptions }): SimulateResult {
  let doc: ModelDocument
  try {
    const v = (input as { schema_version?: unknown })?.schema_version
    const parsed = ModelDocument.safeParse(input)
    if (parsed.success) doc = parsed.data
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
  let results: ModelResults
  try {
    results = runModel(doc, weather.weather, pre.library, deps.options ?? RUN_OPTIONS)
  } catch (e) {
    const err = e as Error & { path?: string }
    if (typeof err.path === 'string') {
      const msg = err.message.startsWith(`${err.path}: `) ? err.message.slice(err.path.length + 2) : err.message
      return { ok: false, missing: [explain(err.path, msg, doc)] }
    }
    throw e
  }
  // By term, summed over the given zones' lines. The building leaves heat between zones out (it cancels); a zone keeps it.
  const byTerm = (zs: ModelResults['zones'], interzone: boolean) => {
    const m = new Map<BreakdownLine['term'], number>()
    for (const z of zs) for (const l of z.breakdown) if (interzone || l.term !== 'interzone') m.set(l.term, (m.get(l.term) ?? 0) + l.kwh)
    return [...m].map(([term, kwh]) => ({ term, kwh }))
  }
  const summary: Summary = {
    engine: results.engine, run_ms: results.run_ms,
    weather: { file_name: weather.file_name, station: weather.station, sha256: weather.sha256 },
    building: {
      floor_m2: doc.zones.reduce((s, z) => s + z.area_m2, 0),
      heating_kwh: readBuildingHeatingKwh(results), cooling_kwh: readBuildingCoolingKwh(results),
      peak_heating_w: readBuildingPeakW(results, 'heating'), peak_cooling_w: readBuildingPeakW(results, 'cooling'),
    },
    zones: results.zones.map((z, i) => ({ id: z.zone_id, name: doc.zones[i].name, floor_m2: doc.zones[i].area_m2, heating_kwh: z.annual.heating_kwh, cooling_kwh: z.annual.cooling_kwh, heated: doc.zones[i].setpoints.heat_c != null, cooled: doc.zones[i].setpoints.cool_c != null, breakdown: byTerm([z], true) })),
    breakdown: byTerm(results.zones, false),
    drafts: pre.drafts,
    energy: energyOf(doc, results, weather),
  }
  return { ok: true, results, summary }
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
  const a = runSystems(doc, results, weather.weather.hours)
  if (!a.ok) return { ok: false, missing: a.missing.map((m) => explainSystems(m.path, m.message, doc)) }
  const s = a.systems
  return {
    ok: true, eui_kwh_per_m2: readSystemsEui(s), total_kwh: readSystemsTotalKwh(s),
    by_fuel: FUELS.filter((f) => s.by_fuel[f] > 0).map((fuel) => ({ fuel, kwh: s.by_fuel[fuel] })),
    end_uses: s.end_uses.filter((l) => l.kwh > 0),
    systems: s.groups.map((g) => ({ id: g.id, label: g.label || `${SERVICE_WORDS[g.service] ?? g.service} system`, service: g.service, fuel: g.fuel, efficiency: g.efficiency, served_kwh: g.served_kwh, fuel_kwh: g.fuel_kwh })),
  }
}
