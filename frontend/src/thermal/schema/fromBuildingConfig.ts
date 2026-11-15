/**
 * Today's single-zone inputs → a one-zone Simulate v2 model document (Brief 102 Part 1).
 *
 * One-way, and lossless for every field today's engine (`_calculateState3` and its helpers) reads, per the Part 0
 * trace (docs/audit/102/00_reconnaissance.md (a)); the coverage test asserts it field by field. It is also the
 * first fixture for Engine 1.
 *
 * The box becomes one zone spanning every storey; four walls (azimuth = facade + orientation), four glazing
 * surfaces (WWR), a roof and a ground floor; vents and openings on their wall; profiles carried whole and referred
 * to by id; v40 systems become system groups over the one zone, v40 ventilation becomes the zone's ventilation.
 *
 * Brief 104 Part 2: with `{ zoning: 'per_storey' }` the same document is split into one zone per storey, joined by
 * the interior floor construction today's EnergyPlus path uses (see `perStorey`).
 *
 * No defaults, no invention: a field the engine needs that is missing fails with its path, and any shape this
 * converter does not know (an unknown key on a system, a v25-only service, first-class operable openings) throws
 * rather than being dropped or guessed.
 *
 * Imports nothing from the engine (CLAUDE.md rule 12).
 */
import { canonicalJSON, sha256Hex } from './canonical'
import { FACADES, ModelDocument, SCHEMA_VERSION } from './model'
import { TODAY, stateTodaysGainInputs } from './upgrade'
import type { LibraryRef } from './model'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Obj = Record<string, unknown>

export interface ConverterInput {
  /** The project's `building_config` (with `systems_config_v40`, and `systems_config_v25` where it still exists). */
  building_config: Obj
  /** The project's `construction_choices` column: a library name, or `{ library_id, u_value_override, g_value_override }`. */
  construction_choices: Obj
  /** The project's comfort band (the `comfort_band_lower_c` / `_upper_c` columns), as the engine receives it. */
  comfort_band: { lower_c: number; upper_c: number }
  /** The construction library items as the engine receives them (`libraryData.constructions`). */
  library_constructions: Obj[]
  /** The weather file. With its sha256 the document pins the bytes; without, it records a legacy name only. */
  weather?: { file_name: string; file_hash?: string | null }
  /** The building's id (the project id today). */
  building_id?: string
}

/**
 * One input path the converter consumed. `value`: copied verbatim, so the document holds the same value at `doc`.
 * `structural`: an empty or absent list (or null) that becomes the absence of something in the document.
 */
export interface TraceEntry {
  src: string
  doc: string
  kind: 'value' | 'structural'
}

export interface Conversion {
  document: ModelDocument
  /** Input paths consumed, with their place in the single-zone document (per-storey documents are derived from it). */
  trace: TraceEntry[]
}

export interface ConverterOptions {
  /**
   * 'single' (default): one zone spanning every storey, as today. 'per_storey' (Brief 104 decision 4): one zone per
   * storey, joined by the interior floor construction today's EnergyPlus path uses; walls, glazing and vents split
   * evenly by storey; the roof on the top zone and the ground on the bottom one.
   */
  zoning?: 'single' | 'per_storey'
}

export class ConversionError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} (${path})`)
    this.name = 'ConversionError'
  }
}

const ZONE_ID = 'z1'
const FACADE_BASE_DEG: Record<(typeof FACADES)[number], number> = { north: 0, east: 90, south: 180, west: 270 }

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Reads values from the inputs by path and records every leaf it copies. */
class Source {
  readonly trace: TraceEntry[] = []
  constructor(private readonly roots: Record<string, unknown>) {}

  get(path: string): unknown {
    const segs = path.replace(/\[(\d+)\]/g, '.$1').split('.')
    let v: unknown = this.roots[segs[0]]
    for (const s of segs.slice(1)) {
      if (v == null) return undefined
      v = (v as Obj)[s]
    }
    return v
  }

  /** Copies one value; records it. Missing → undefined (callers decide whether that is allowed). */
  take<T = unknown>(src: string, doc: string): T {
    const v = this.get(src)
    if (v !== undefined) this.trace.push({ src, doc, kind: 'value' })
    return v as T
  }

  /** Records an input that becomes the absence of something (an empty list, a null). */
  mark(src: string, doc: string): void {
    this.trace.push({ src, doc, kind: 'structural' })
  }

  /** Copies one value that must be present (null allowed). */
  need<T = unknown>(src: string, doc: string): T {
    const v = this.get(src)
    if (v === undefined) throw new ConversionError('missing field the engine reads', src)
    this.trace.push({ src, doc, kind: 'value' })
    return v as T
  }

  /** Copies a subtree (deep clone), recording every leaf. Keys starting with "_" (provenance notes) are left out. */
  tree(src: string, doc: string, omit: readonly string[] = []): Json {
    const walk = (v: unknown, s: string, d: string, top: boolean): Json => {
      if (Array.isArray(v)) {
        if (v.length === 0) this.trace.push({ src: s, doc: d, kind: 'value' })
        return v.map((x, i) => walk(x, `${s}[${i}]`, `${d}[${i}]`, false))
      }
      if (isObj(v)) {
        const out: Record<string, Json> = {}
        const keys = Object.keys(v).filter((k) => !k.startsWith('_') && !(top && omit.includes(k)) && v[k] !== undefined)
        if (keys.length === 0) this.trace.push({ src: s, doc: d, kind: 'value' })
        for (const k of keys) out[k] = walk(v[k], `${s}.${k}`, `${d}.${k}`, false)
        return out
      }
      this.trace.push({ src: s, doc: d, kind: 'value' })
      return v as Json
    }
    const v = this.get(src)
    if (v === undefined) throw new ConversionError('missing field the engine reads', src)
    return walk(v, src, doc, true)
  }
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ConversionError(`expected a number, found ${JSON.stringify(v)}`, path)
  return v
}

// Per-system fields the engine treats as service-level and refuses on a system entry (CLAUDE.md, Brief 42).
const SERVICE_LEVEL_ON_SYSTEM = [
  'setpoint',
  'tap_outlet_temp_c',
  'cold_supply_temp_c',
  'demand_basis',
  'demand_litres_per_person_per_day',
  'demand_litres_per_m2_day',
]
// Per-system keys a system group carries, and the ones it deliberately leaves out (not engine inputs).
const SYSTEM_KEYS = ['id', 'label', 'enabled', 'share_pct', 'source', 'efficiency_metric', 'control_mechanism', 'control_schedule_id', 'control_factor', 'capacity_kw', 'library_id']
const SYSTEM_DROPPED = ['notes', 'service']
const VENT_KEYS = ['id', 'label', 'enabled', 'share_pct', 'efficiency_metric', 'flow_rate', 'flow_rate_basis', 'summer_bypass', 'defrost_penalty_kwh', 'control_mechanism', 'control_schedule_id']
const VENT_DROPPED = ['notes', 'service', 'source', 'capacity_kw']
const V25_VENT_KEYS = ['name', 'library_id', 'enabled', 'hre_enabled', 'flow_l_s', 'sfp_w_per_l_s', 'hre', 'hours', 'schedule_ref', 'summer_bypass']

export async function fromBuildingConfig(input: ConverterInput, options: ConverterOptions = {}): Promise<Conversion> {
  const zoning = options.zoning ?? 'single'
  if (zoning !== 'single' && zoning !== 'per_storey') throw new ConversionError(`unknown zoning "${String(zoning)}"`, 'options.zoning')
  const bc = input.building_config
  if (!isObj(bc)) throw new ConversionError('building_config is not an object', 'building_config')
  const src = new Source({
    building_config: bc,
    construction_choices: input.construction_choices,
    comfortBand: input.comfort_band,
  })
  const B = 'building_config'

  // ── Geometry: the box ──────────────────────────────────────────────────────────────────────
  const length = num(src.need(`${B}.length`, 'zones[0].polygon[1][0]'), `${B}.length`)
  const width = num(src.need(`${B}.width`, 'zones[0].polygon[2][1]'), `${B}.width`)
  const storeys = num(src.need(`${B}.num_floors`, 'zones[0].storeys'), `${B}.num_floors`)
  const height = num(src.need(`${B}.floor_height`, 'zones[0].height_m'), `${B}.floor_height`)
  const orientation = num(src.need(`${B}.orientation`, 'building.orientation_deg'), `${B}.orientation`)

  // ── Constructions ──────────────────────────────────────────────────────────────────────────
  const libraryRefs: LibraryRef[] = []
  const constructionRef = async (element: string, docBase: string) => {
    const path = `construction_choices.${element}`
    const choice = src.get(path)
    let ref: { key: string; u_value_override?: number | null; g_value_override?: number | null }
    if (typeof choice === 'string' && choice) {
      src.take(path, `${docBase}.construction_ref.key`)
      ref = { key: choice }
    } else if (isObj(choice) && typeof choice.library_id === 'string') {
      for (const k of Object.keys(choice)) {
        if (!['library_id', 'u_value_override', 'g_value_override'].includes(k)) throw new ConversionError(`unknown construction choice field "${k}"`, `${path}.${k}`)
      }
      ref = { key: src.take<string>(`${path}.library_id`, `${docBase}.construction_ref.key`) }
      if (choice.u_value_override !== undefined) ref.u_value_override = src.take(`${path}.u_value_override`, `${docBase}.construction_ref.u_value_override`)
      if (choice.g_value_override !== undefined) ref.g_value_override = src.take(`${path}.g_value_override`, `${docBase}.construction_ref.g_value_override`)
    } else {
      throw new ConversionError('no construction assigned', path)
    }
    if (!libraryRefs.some((r) => r.kind === 'construction' && r.key === ref.key)) {
      const item = input.library_constructions.find((c) => c?.name === ref.key)
      if (!item) throw new ConversionError(`construction "${ref.key}" is not in the library`, path)
      // The pin is the item's own definition (config_json, which is library_items.body after Part 3), not the
      // engine's reshaped copy around it: the same item hashes the same however it was delivered.
      const body = isObj(item.config_json) ? item.config_json : item
      libraryRefs.push({ kind: 'construction', key: ref.key, version: null, body_hash: await sha256Hex(canonicalJSON(body)) })
    }
    return ref
  }

  // ── Surfaces ───────────────────────────────────────────────────────────────────────────────
  const surfaces: Obj[] = []
  const wallRef = await constructionRef('external_wall', 'surfaces[0]')
  const glazingRef = await constructionRef('glazing', 'surfaces[1]')
  const openingDefaults: Obj = {}
  for (const k of ['cd', 'flow_mode', 'schedule']) {
    if (src.get(`${B}.openings.${k}`) !== undefined) openingDefaults[k] = src.take(`${B}.openings.${k}`, `building.opening_defaults.${k}`)
  }
  if (src.get(`${B}.operable_openings`) != null) {
    const oo = src.get(`${B}.operable_openings`)
    if (!(Array.isArray(oo) && oo.length === 0)) {
      throw new ConversionError('first-class operable openings are not carried by this converter yet', `${B}.operable_openings`)
    }
  }
  src.mark(`${B}.operable_openings`, 'surfaces[].openings')

  for (const f of FACADES) {
    const gross = (f === 'north' || f === 'south' ? length : width) * height * storeys
    const wallIdx = surfaces.length
    const glzIdx = wallIdx + 1
    const wwr = num(src.need(`${B}.wwr.${f}`, `surfaces[${glzIdx}].wwr`), `${B}.wwr.${f}`)
    const azimuth = (FACADE_BASE_DEG[f] + orientation) % 360
    // Openings in this wall: the permanent vent (louvre) and the legacy operable fraction, each with the facade's cd / flow mode.
    const openings: Obj[] = []
    const op = `${B}.openings.${f}`
    const facadeOpen = src.get(op)
    if (facadeOpen !== undefined && !isObj(facadeOpen)) throw new ConversionError('expected an object', op)
    if (isObj(facadeOpen)) {
      for (const k of Object.keys(facadeOpen)) {
        if (!['louvre_area_m2', 'cd', 'flow_mode', 'openable_fraction'].includes(k)) throw new ConversionError(`unknown opening field "${k}"`, `${op}.${k}`)
      }
      const add = (kind: 'permanent_vent' | 'operable', main: Obj) => {
        const i = openings.length
        const o: Obj = { kind, ...main }
        if (facadeOpen.cd !== undefined) o.cd = src.take(`${op}.cd`, `surfaces[${wallIdx}].openings[${i}].cd`)
        if (facadeOpen.flow_mode !== undefined) o.flow_mode = src.take(`${op}.flow_mode`, `surfaces[${wallIdx}].openings[${i}].flow_mode`)
        // Schema 2.1: a permanent vent states its cd and flow mode. Where the project leaves them out, write what today's
        // engine resolves to (building-wide value, else resolveCd 0.25 / resolveFlowMode 'single_sided').
        if (kind === 'permanent_vent') {
          o.cd ??= openingDefaults.cd ?? TODAY.vent_cd
          o.flow_mode ??= openingDefaults.flow_mode ?? TODAY.vent_flow_mode
        }
        openings.push(o)
      }
      if (facadeOpen.louvre_area_m2 !== undefined) {
        add('permanent_vent', { area_m2: src.take(`${op}.louvre_area_m2`, `surfaces[${wallIdx}].openings[${openings.length}].area_m2`) })
      }
      if (facadeOpen.openable_fraction !== undefined) {
        add('operable', { openable_fraction: src.take(`${op}.openable_fraction`, `surfaces[${wallIdx}].openings[${openings.length}].openable_fraction`), control_ref: null })
      }
      if (facadeOpen.louvre_area_m2 === undefined && facadeOpen.openable_fraction === undefined && (facadeOpen.cd !== undefined || facadeOpen.flow_mode !== undefined)) {
        throw new ConversionError('cd / flow_mode without an opening to carry them', op)
      }
    }
    surfaces.push({
      id: `wall_${f}`, kind: 'wall', zone_a: ZONE_ID, zone_b: 'outside', facade: f,
      area_m2: gross * (1 - wwr), azimuth_deg: azimuth, tilt_deg: 90,
      construction_ref: wallRef, g_value: null, openings,
      solar_absorptance: TODAY.wall_solar_absorptance, thermal_emissivity: TODAY.outside_emissivity, frame_fraction: null,
      inside_solar_absorptance: TODAY.inside_solar_absorptance, inside_solar_absorptance_b: null, faces_up: null,
    })
    const glazing: Obj = {
      id: `glazing_${f}`, kind: 'glazing', zone_a: ZONE_ID, zone_b: 'outside', facade: f,
      area_m2: gross * wwr, azimuth_deg: azimuth, tilt_deg: 90,
      construction_ref: glazingRef, g_value: null, wwr, openings: [],
      solar_absorptance: null, thermal_emissivity: TODAY.outside_emissivity, frame_fraction: TODAY.frame_fraction,
      inside_solar_absorptance: null, inside_solar_absorptance_b: null, faces_up: null,
    }
    const wc = src.take(`${B}.window_count.${f}`, `surfaces[${glzIdx}].window_count`)
    if (wc !== undefined) glazing.window_count = wc
    const shading: Obj = {}
    if (src.get(`${B}.shading_overhang.${f}`) !== undefined) shading.overhang = src.tree(`${B}.shading_overhang.${f}`, `surfaces[${glzIdx}].shading.overhang`)
    if (src.get(`${B}.shading_fin.${f}`) !== undefined) shading.fins = src.tree(`${B}.shading_fin.${f}`, `surfaces[${glzIdx}].shading.fins`)
    if (Object.keys(shading).length) glazing.shading = shading
    surfaces.push(glazing)
  }
  // The same construction objects were referenced from surfaces[0] / [1] while tracing; every wall and glazing shares them.
  const roofIdx = surfaces.length
  surfaces.push({
    id: 'roof', kind: 'roof', zone_a: ZONE_ID, zone_b: 'outside', facade: null,
    area_m2: length * width, azimuth_deg: null, tilt_deg: 0,
    construction_ref: await constructionRef('roof', `surfaces[${roofIdx}]`), g_value: null, openings: [],
    solar_absorptance: TODAY.roof_solar_absorptance, thermal_emissivity: TODAY.outside_emissivity, frame_fraction: null,
    inside_solar_absorptance: TODAY.inside_solar_absorptance, inside_solar_absorptance_b: null, faces_up: null,
  })
  const groundIdx = surfaces.length
  surfaces.push({
    id: 'ground', kind: 'ground', zone_a: ZONE_ID, zone_b: 'ground', facade: null,
    area_m2: length * width, azimuth_deg: null, tilt_deg: 180,
    construction_ref: await constructionRef('ground_floor', `surfaces[${groundIdx}]`), g_value: null, openings: [],
    solar_absorptance: null, thermal_emissivity: null, frame_fraction: null,
    inside_solar_absorptance: TODAY.inside_solar_absorptance, inside_solar_absorptance_b: null, faces_up: null,
  })

  // ── Profiles ───────────────────────────────────────────────────────────────────────────────
  const profiles: Obj[] = []
  const profileRefs = { occupancy: null as string | null, lighting: [] as string[], equipment: [] as string[], auxiliary: [] as string[] }
  if (src.get(`${B}.occupancy`) != null) {
    const i = profiles.length
    const occ: Obj = { id: 'occupancy', kind: 'occupancy', ...(src.tree(`${B}.occupancy`, `profiles[${i}]`) as Obj) }
    stateTodaysGainInputs(occ)
    profiles.push(occ)
    profileRefs.occupancy = 'occupancy'
  }
  for (const kind of ['lighting', 'equipment', 'auxiliary'] as const) {
    const list = src.get(`${B}.gains.${kind}.profiles`)
    if (list === undefined) continue
    if (!Array.isArray(list)) throw new ConversionError('expected a list', `${B}.gains.${kind}.profiles`)
    if (list.length === 0) src.mark(`${B}.gains.${kind}.profiles`, `zones[0].profile_refs.${kind}`)
    list.forEach((p, j) => {
      const i = profiles.length
      const body = src.tree(`${B}.gains.${kind}.profiles[${j}]`, `profiles[${i}]`) as Obj
      if (typeof body.id !== 'string') throw new ConversionError('a gains profile has no id', `${B}.gains.${kind}.profiles[${j}].id`)
      const gp: Obj = { ...body, kind }
      stateTodaysGainInputs(gp)
      profiles.push(gp)
      profileRefs[kind].push(body.id)
    })
  }
  const schedules = src.get(`${B}.schedules`)
  if (Array.isArray(schedules)) {
    schedules.forEach((s, j) => {
      const sp = `${B}.schedules[${j}]`
      if (!isObj(s)) throw new ConversionError('expected an object', sp)
      for (const k of Object.keys(s)) if (!['id', 'name', 'day_types'].includes(k)) throw new ConversionError(`unknown schedule field "${k}"`, `${sp}.${k}`)
      const i = profiles.length
      const p: Obj = { id: src.need(`${sp}.id`, `profiles[${i}].id`), kind: 'schedule', day_types: src.tree(`${sp}.day_types`, `profiles[${i}].day_types`) }
      if (s.name !== undefined) p.label = src.take(`${sp}.name`, `profiles[${i}].label`)
      profiles.push(p)
    })
  }

  // ── Systems (v40) ──────────────────────────────────────────────────────────────────────────
  const V40 = `${B}.systems_config_v40`
  const V25 = `${B}.systems_config_v25`
  const v40 = src.get(V40)
  if (!isObj(v40)) throw new ConversionError('no systems_config_v40: v25-only projects are not converted (none exist in the DB, Brief 76 P2)', V40)
  const v25 = src.get(V25)
  const systemGroups: Obj[] = []
  for (const service of ['heating', 'cooling', 'dhw', 'lighting', 'small_power', 'auxiliary'] as const) {
    const list = src.get(`${V40}.${service}`)
    if (list === undefined) continue
    if (!Array.isArray(list)) throw new ConversionError('expected a list', `${V40}.${service}`)
    if (list.length === 0) {
      src.mark(`${V40}.${service}`, 'system_groups')
      if (isObj(v25) && isObj(v25[service]) && (v25[service] as Obj).enabled === true) {
        throw new ConversionError(`v40 has no ${service} system but v25 has one enabled: a v25-only service is not converted`, `${V25}.${service}`)
      }
      continue
    }
    list.forEach((e, j) => {
      const ep = `${V40}.${service}[${j}]`
      if (!isObj(e)) throw new ConversionError('expected an object', ep)
      for (const k of SERVICE_LEVEL_ON_SYSTEM) {
        if (k in e && !(k === 'setpoint' && e[k] === null && (service === 'lighting' || service === 'small_power' || service === 'auxiliary'))) {
          throw new ConversionError(`service-level field "${k}" on a system entry (stale data; the engine refuses it too)`, `${ep}.${k}`)
        }
      }
      for (const k of Object.keys(e)) {
        if (!SYSTEM_KEYS.includes(k) && !SYSTEM_DROPPED.includes(k) && k !== 'setpoint') throw new ConversionError(`unknown system field "${k}"`, `${ep}.${k}`)
      }
      if (e.service !== undefined && e.service !== service) throw new ConversionError(`entry says service "${String(e.service)}" inside ${service}`, `${ep}.service`)
      const gi = systemGroups.length
      const d = `system_groups[${gi}]`
      const g: Obj = { service, zones: [ZONE_ID] }
      g.id = src.need(`${ep}.id`, `${d}.id`)
      if (e.label !== undefined) g.label = src.take(`${ep}.label`, `${d}.label`)
      g.enabled = src.need(`${ep}.enabled`, `${d}.enabled`)
      g.share_pct = src.need(`${ep}.share_pct`, `${d}.share_pct`)
      g.source = e.source === undefined ? null : src.take(`${ep}.source`, `${d}.source`)
      g.efficiency_metric = e.efficiency_metric === undefined ? null : src.take(`${ep}.efficiency_metric`, `${d}.efficiency_metric`)
      if (e.control_mechanism !== undefined) g.control_mechanism = src.take(`${ep}.control_mechanism`, `${d}.control_mechanism`)
      if (e.control_schedule_id !== undefined) g.control_schedule_ref = src.take(`${ep}.control_schedule_id`, `${d}.control_schedule_ref`)
      if (e.control_factor !== undefined) g.control_factor = src.take(`${ep}.control_factor`, `${d}.control_factor`)
      if (e.capacity_kw !== undefined) g.capacity_kw = src.take(`${ep}.capacity_kw`, `${d}.capacity_kw`)
      if (e.library_id !== undefined) g.template_ref = src.take(`${ep}.library_id`, `${d}.template_ref`)
      systemGroups.push(g)
    })
  }

  // ── Ventilation (v40 entries, with the v25 fields the engine still falls back to) ───────────
  const ventilation: Obj[] = []
  const ventList = src.get(`${V40}.ventilation`)
  if (Array.isArray(ventList)) {
    if (ventList.length === 0) src.mark(`${V40}.ventilation`, 'zones[0].ventilation')
    const v25List = isObj(v25) && Array.isArray(v25.ventilation) ? (v25.ventilation as unknown[]) : []
    ventList.forEach((e, j) => {
      const ep = `${V40}.ventilation[${j}]`
      if (!isObj(e)) throw new ConversionError('expected an object', ep)
      for (const k of Object.keys(e)) {
        if (!VENT_KEYS.includes(k) && !VENT_DROPPED.includes(k) && k !== 'setpoint') throw new ConversionError(`unknown ventilation field "${k}"`, `${ep}.${k}`)
      }
      if (e.setpoint != null) throw new ConversionError('service-level field "setpoint" on a ventilation entry', `${ep}.setpoint`)
      const d = `zones[0].ventilation[${j}]`
      const v: Obj = { id: src.need(`${ep}.id`, `${d}.id`), enabled: src.need(`${ep}.enabled`, `${d}.enabled`) }
      if (e.label !== undefined) v.label = src.take(`${ep}.label`, `${d}.label`)
      for (const [from, to] of [['share_pct', 'share_pct'], ['flow_rate', 'flow_rate'], ['flow_rate_basis', 'flow_rate_basis'], ['summer_bypass', 'summer_bypass'], ['defrost_penalty_kwh', 'defrost_penalty_kwh'], ['control_mechanism', 'control_mechanism'], ['control_schedule_id', 'control_schedule_ref']] as const) {
        if (e[from] !== undefined) v[to] = src.take(`${ep}.${from}`, `${d}.${to}`)
      }
      const em = e.efficiency_metric
      if (em != null) {
        if (!isObj(em)) throw new ConversionError('expected { sfp_w_per_lps, recovery_sensible_pct, recovery_latent_pct }', `${ep}.efficiency_metric`)
        for (const k of Object.keys(em)) if (!['sfp_w_per_lps', 'recovery_sensible_pct', 'recovery_latent_pct'].includes(k)) throw new ConversionError(`unknown field "${k}"`, `${ep}.efficiency_metric.${k}`)
        if (em.sfp_w_per_lps !== undefined) v.sfp_w_per_l_s = src.take(`${ep}.efficiency_metric.sfp_w_per_lps`, `${d}.sfp_w_per_l_s`)
        if (em.recovery_sensible_pct !== undefined) v.recovery_sensible_pct = src.take(`${ep}.efficiency_metric.recovery_sensible_pct`, `${d}.recovery_sensible_pct`)
        if (em.recovery_latent_pct !== undefined) v.recovery_latent_pct = src.take(`${ep}.efficiency_metric.recovery_latent_pct`, `${d}.recovery_latent_pct`)
      }
      v.kind = typeof v.recovery_sensible_pct === 'number' && v.recovery_sensible_pct > 0 ? 'mvhr' : 'mev'
      const k25 = v25List.findIndex((x) => isObj(x) && x.id === e.id)
      if (k25 >= 0) {
        const m = v25List[k25] as Obj
        const mp = `${V25}.ventilation[${k25}]`
        const legacy: Obj = {}
        for (const k of Object.keys(m)) {
          if (k === 'id') continue
          if (!V25_VENT_KEYS.includes(k)) throw new ConversionError(`unknown v25 ventilation field "${k}"`, `${mp}.${k}`)
          legacy[k] = src.take(`${mp}.${k}`, `${d}.legacy_v25.${k}`)
        }
        src.take(`${mp}.id`, `${d}.id`)
        v.legacy_v25 = legacy
      } else {
        v.legacy_v25 = null
      }
      ventilation.push(v)
    })
  }

  // ── Service-level fields ───────────────────────────────────────────────────────────────────
  const services = {
    heating: {
      setpoint_mode: src.need(`${V40}.heating_setpoint_mode`, 'services.heating.setpoint_mode'),
      setpoint_c: src.need(`${V40}.heating_setpoint_c`, 'services.heating.setpoint_c'),
    },
    cooling: {
      setpoint_mode: src.need(`${V40}.cooling_setpoint_mode`, 'services.cooling.setpoint_mode'),
      setpoint_c: src.need(`${V40}.cooling_setpoint_c`, 'services.cooling.setpoint_c'),
    },
    dhw: {
      storage_setpoint_c: src.take(`${V40}.dhw_storage_setpoint_c`, 'services.dhw.storage_setpoint_c') ?? null,
      tap_outlet_temp_c: src.take(`${V40}.dhw_tap_outlet_temp_c`, 'services.dhw.tap_outlet_temp_c') ?? null,
      cold_supply_temp_c: src.take(`${V40}.dhw_cold_supply_temp_c`, 'services.dhw.cold_supply_temp_c') ?? null,
      demand_basis: src.take(`${V40}.dhw_demand_basis`, 'services.dhw.demand_basis') ?? null,
      litres_per_person_per_day: src.take(`${V40}.dhw_demand_litres_per_person_per_day`, 'services.dhw.litres_per_person_per_day') ?? null,
      litres_per_m2_per_day: src.take(`${V40}.dhw_demand_litres_per_m2_per_day`, 'services.dhw.litres_per_m2_per_day') ?? null,
      load_shape: src.take(`${V40}.dhw_load_shape`, 'services.dhw.load_shape') ?? null,
      // The one v25 DHW field still live with v40 present (the anchor moves with it; audit doc 01).
      circulation_pump_w: src.take(`${V25}.dhw.circulation_pump_w`, 'services.dhw.circulation_pump_w') ?? null,
    },
  }

  // ── Zone and building ──────────────────────────────────────────────────────────────────────
  const zone = {
    id: ZONE_ID,
    name: 'Whole building',
    floor: 0,
    storeys,
    polygon: [[0, 0], [length, 0], [length, width], [0, width]],
    area_m2: length * width * storeys,
    height_m: height,
    use_type: typeof bc.building_type === 'string' && bc.building_type ? bc.building_type : 'unassigned',
    rooms: src.take(`${B}.num_bedrooms`, 'zones[0].rooms') ?? null,
    profile_refs: profileRefs,
    setpoints: {
      heat_c: src.need('comfortBand.lower_c', 'zones[0].setpoints.heat_c'),
      cool_c: src.need('comfortBand.upper_c', 'zones[0].setpoints.cool_c'),
      setback_c: null,
      hours_ref: null,
      control_strategy: src.take(`${B}.control_strategy`, 'zones[0].setpoints.control_strategy') ?? null,
    },
    ventilation,
    infiltration_q50: src.take(`${B}.fabric.air_permeability_q50`, 'zones[0].infiltration_q50') ?? null,
    infiltration_ach: src.take(`${B}.infiltration_ach`, 'zones[0].infiltration_ach') ?? null,
    internal_heat_capacity_j_per_k_m2: TODAY.internal_heat_capacity_j_per_k_m2,
    surfaces: surfaces.map((s) => s.id as string),
  }
  const location = src.get(`${B}.location`)
  const building = {
    id: input.building_id ?? 'building',
    name: typeof bc.name === 'string' ? bc.name : '',
    decoded_building_key: null,
    site: {
      lat: isObj(location) && location.latitude !== undefined ? src.take(`${B}.location.latitude`, 'building.site.lat') : null,
      lon: isObj(location) && location.longitude !== undefined ? src.take(`${B}.location.longitude`, 'building.site.lon') : null,
      name: isObj(location) && location.name !== undefined ? src.take(`${B}.location.name`, 'building.site.name') : null,
      exposure: src.take(`${B}.openings.site_exposure`, 'building.site.exposure') ?? null,
      ground: { method: 'annual_mean_outdoor' as const },
    },
    orientation_deg: orientation,
    reported_floor_area_m2: src.take(`${B}.reported_gia`, 'building.reported_floor_area_m2') ?? null,
    thermal_bridging: {
      mode: src.take(`${B}.thermal_bridges.mode`, 'building.thermal_bridging.mode') ?? null,
      // Today's auto mode reads a missing multiplier as 1 (thermalBridges.js 182); the document states it.
      multiplier: src.take(`${B}.thermal_bridges.multiplier`, 'building.thermal_bridging.multiplier')
        ?? (src.get(`${B}.thermal_bridges.mode`) === 'iso14683_auto' ? TODAY.bridging_multiplier : null),
      alpha_pct: src.take(`${B}.fabric.thermal_bridging_alpha_pct`, 'building.thermal_bridging.alpha_pct') ?? null,
    },
    thermal_mass: {
      mode: src.take(`${B}.thermal_mass_mode`, 'building.thermal_mass.mode') ?? null,
      category: src.take(`${B}.thermal_mass_category`, 'building.thermal_mass.category') ?? null,
    },
    opening_defaults: openingDefaults,
  }

  // ── Weather ────────────────────────────────────────────────────────────────────────────────
  const w = input.weather ?? (typeof bc.weather_file === 'string' ? { file_name: bc.weather_file } : undefined)
  if (!w) throw new ConversionError('no weather file', `${B}.weather_file`)
  const weather_ref = w.file_hash
    ? { kind: 'epw' as const, station_id: /\.(\d{6})_/.exec(w.file_name)?.[1] ?? null, file_name: w.file_name, file_hash: w.file_hash }
    : { kind: 'legacy' as const, id: w.file_name }

  let draft: Obj = {
    schema_version: SCHEMA_VERSION,
    building,
    zones: [zone],
    surfaces,
    system_groups: systemGroups,
    services,
    profiles,
    weather_ref,
    library_refs: libraryRefs,
  }
  if (zoning === 'per_storey') {
    const key = TODAY.interior_floor_construction
    const item = input.library_constructions.find((c) => c?.name === key)
    if (!item) throw new ConversionError(`per-storey zoning needs the interior floor construction "${key}" in the library`, 'library_constructions')
    if (!libraryRefs.some((r) => r.kind === 'construction' && r.key === key)) {
      const body = isObj(item.config_json) ? item.config_json : item
      libraryRefs.push({ kind: 'construction', key, version: null, body_hash: await sha256Hex(canonicalJSON(body)) })
    }
    draft = perStorey(draft, { storeys, area_m2: length * width, interior_key: key })
  }
  const parsed = ModelDocument.safeParse(draft)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new ConversionError(`the converted document fails the schema: ${first.message}`, first.path.join('.'))
  }
  return { document: parsed.data, trace: src.trace }
}

/**
 * The single-zone document split into one zone per storey (Brief 104 decision 4). Areas are divided evenly: every
 * storey of today's box is the same. Zone `z1` is the ground storey.
 *
 * The room count is divided evenly too (Brief 105 Part 2, schema 2.3), so per-room gains add up to the building's.
 * The zone's mechanical ventilation entries stay on z1 and are not divided (Brief 105 Part 3 decides their split).
 */
function perStorey(single: Obj, g: { storeys: number; area_m2: number; interior_key: string }): Obj {
  const N = g.storeys
  if (!Number.isInteger(N) || N < 1) throw new ConversionError(`per-storey zoning needs a whole number of storeys, found ${N}`, 'building_config.num_floors')
  const z0 = (single.zones as Obj[])[0]
  const ids = Array.from({ length: N }, (_, i) => `z${i + 1}`)
  const zones: Obj[] = ids.map((id, i) => ({
    ...structuredClone(z0), id, name: `Storey ${i + 1}`, floor: i, storeys: 1, area_m2: g.area_m2,
    ventilation: i === 0 ? structuredClone(z0.ventilation) : [], rooms: z0.rooms == null ? null : z0.rooms / N, surfaces: [] as string[],
  }))
  const surfaces: Obj[] = []
  const put = (s: Obj, zone: number) => { surfaces.push(s); (zones[zone].surfaces as string[]).push(s.id as string) }
  for (const s of single.surfaces as Obj[]) {
    if (s.kind === 'wall' || s.kind === 'glazing') {
      // window_count stays as it is: it counts windows across the facade on each storey (BuildingViewer3D draws that
      // many per storey), so every storey has the same count.
      ids.forEach((zid, i) => {
        const c: Obj = { ...structuredClone(s), id: `${String(s.id)}_${zid}`, zone_a: zid, area_m2: (s.area_m2 as number) / N }
        c.openings = (s.openings as Obj[]).map((o) => (o.kind === 'permanent_vent' ? { ...o, area_m2: (o.area_m2 as number) / N } : { ...o }))
        put(c, i)
      })
    } else if (s.kind === 'roof') {
      put({ ...structuredClone(s), zone_a: ids[N - 1] }, N - 1)
    } else if (s.kind === 'ground') {
      put({ ...structuredClone(s), zone_a: ids[0] }, 0)
    } else {
      throw new ConversionError(`per-storey zoning does not know where a ${String(s.kind)} goes`, `surfaces.${String(s.id)}`)
    }
  }
  // The slab above each storey but the top: that storey's ceiling, the next storey's floor. Layers run from zone_b
  // (the storey above, first layer) to zone_a, which is the library's order (carpet first).
  for (let i = 0; i < N - 1; i++) {
    put({
      id: `ceiling_${ids[i]}`, kind: 'ceiling', zone_a: ids[i], zone_b: ids[i + 1], facade: null, area_m2: g.area_m2,
      azimuth_deg: null, tilt_deg: 0, construction_ref: { key: g.interior_key }, g_value: null, openings: [],
      solar_absorptance: null, thermal_emissivity: null, frame_fraction: null,
      inside_solar_absorptance: TODAY.inside_solar_absorptance, inside_solar_absorptance_b: TODAY.inside_solar_absorptance, faces_up: null,
    }, i)
    ;(zones[i + 1].surfaces as string[]).push(`ceiling_${ids[i]}`)
  }
  const systemGroups = (single.system_groups as Obj[]).map((sg) => ({ ...sg, zones: [...ids] }))
  return { ...single, zones, surfaces, system_groups: systemGroups }
}
