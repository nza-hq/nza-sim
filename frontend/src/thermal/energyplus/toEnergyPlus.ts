/**
 * Brief 123: the model document as an EnergyPlus input (epJSON), for the third tier, "Run in EnergyPlus" (Linzie 17 Nov
 * 10:27: "Instant, 15 minutes, then Energy+").
 *
 * The same inputs, EnergyPlus's own physics. Everything the hourly run takes as an input conversion is read from that
 * run (Rule 11: one place for each quantity), so the two engines start from the same numbers:
 *   - each zone's air change rate from its q50 (`conductances.infiltration.ach`),
 *   - each zone's thermal bridging, W/K (`conductances.bridging.total_w_per_k`),
 *   - each opaque element's U as the run used it (stated U or layers, `conductances.elements`).
 * The hour-by-hour inputs (gains, setpoints, ventilation running, emitter limits) come from the engine's own input
 * helpers (gains.ts, model.ts zoneSetpointHours, ventilation.ts, emitters.ts) and go to EnergyPlus as one CSV of hourly
 * columns (Schedule:File), so EnergyPlus runs exactly the hours the run ran.
 *
 * EnergyPlus then does its own physics, at four steps an hour: conduction through the layers (CTF), its inside and
 * outside convection (TARP, DOE-2), long-wave exchange between surfaces and with the sky, the Simple Window Model, the
 * sun on every face with the beam on the floor, the wind at each surface's height, and permanent vents by its wind and
 * stack opening model. Room loads are ideal loads; nothing here computes a heat flow.
 *
 * Geometry. The document holds each surface's area, tilt and azimuth, not its corners. Each surface becomes a rectangle
 * of its own area, tilt and azimuth, and the rectangles are set far apart (EnergyPlus's FullExterior shading then finds
 * no surface shading another). Windows sit in a wall of the same zone facing the same way (its gross area is the wall's
 * net area plus its windows'), split into glass and frame as the referees do (Brief 104 Part 1b). Zone volumes and floor
 * areas are stated, not worked out from the rectangles.
 *
 * What is not carried is refused or listed in `notes`, in words (Rule 2: nothing filled, nothing hidden).
 */
import type { ModelDocument, Surface } from '../schema/model'
import { readZoneConductances, type ModelResults } from '../engine/results'
import type { ConstructionBody, Layer } from '../engine/elements'
import type { Weather } from '../engine/types'
import { siteTerrain } from '../engine/airflow'
import { hostRectHeight, outsideFaceZ, windowLayout, windowMargin } from '../engine/outsideConvection'
import { iso6946Films } from '../engine/elements'
import { ENGINE_CONSTANTS as K } from '../engine/constants'
import { groundTemperature, ModelError, surfaceLayers, zoneSetpointHours } from '../engine/model'
import { zoneGains } from '../engine/gains'
import { zoneVentilation } from '../engine/ventilation'
import { zoneCooling, zoneEmitters } from '../engine/emitters'
import { airWeather, rhoAir } from '../engine/airflow'

export class EnergyPlusInputError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'EnergyPlusInputError' }
}

export const EP_VERSION = '25.2'
export const EP_STEPS_PER_HOUR = 4
export const SCHEDULE_FILE = 'schedules.csv'

export interface EnergyPlusInput {
  /** The epJSON object (Version set to EP_VERSION; the runner sets it to the installed EnergyPlus's). */
  epjson: Record<string, Record<string, Record<string, unknown>>>
  /** The hourly columns Schedule:File reads, with a header row. */
  schedules_csv: string
  /** EnergyPlus zone name → the document's zone id, in the document's order. */
  zones: { ep_name: string; zone_id: string; heated: boolean; cooled: boolean }[]
  /** How the model was carried, in plain words: what EnergyPlus does differently, and what it was not given. */
  notes: string[]
}

type Obj = Record<string, unknown>
type Vec = [number, number, number]

const r6 = (x: number) => Math.round(x * 1e6) / 1e6
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: Vec): Vec => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l] }
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Outward normal from azimuth (clockwise from north, x east, y north) and tilt (0 faces up, 180 down). */
function normal(az: number, tilt: number): Vec {
  const t = (tilt * Math.PI) / 180, a = (az * Math.PI) / 180
  return [Math.sin(t) * Math.sin(a), Math.sin(t) * Math.cos(a), Math.cos(t)]
}

/**
 * The surface's own frame seen from outside: `right` and `up` with right × up = the outward normal, so the corners
 * upper-left, lower-left, lower-right, upper-right run counterclockwise (EnergyPlus's default GlobalGeometryRules).
 */
function frame(n: Vec): { right: Vec; up: Vec } {
  const z: Vec = [0, 0, 1]
  const up = Math.abs(n[2]) > 1 - 1e-9 ? ([0, 1, 0] as Vec) : norm(sub(z, mul(n, dot(z, n))))
  return { right: cross(up, n), up }
}

/** Corners of a w × h rectangle at `o` (lower left) in the frame, UL, LL, LR, UR. */
function rect(o: Vec, f: { right: Vec; up: Vec }, x0: number, y0: number, w: number, h: number): Vec[] {
  const p = (x: number, y: number) => add(o, add(mul(f.right, x), mul(f.up, y)))
  return [p(x0, y0 + h), p(x0, y0), p(x0 + w, y0), p(x0 + w, y0 + h)]
}

const vertices = (pts: Vec[]) => pts.map(([x, y, z]) => ({ vertex_x_coordinate: r6(x), vertex_y_coordinate: r6(y), vertex_z_coordinate: r6(z) }))
function windowVertices(pts: Vec[]): Obj {
  const o: Obj = { number_of_vertices: 4 }
  pts.forEach(([x, y, z], i) => { o[`vertex_${i + 1}_x_coordinate`] = r6(x); o[`vertex_${i + 1}_y_coordinate`] = r6(y); o[`vertex_${i + 1}_z_coordinate`] = r6(z) })
  return o
}

/** A safe EnergyPlus name (they are case-insensitive and at most 100 characters). */
const epName = (s: string) => s.replace(/[^A-Za-z0-9_\-.]+/g, '_').slice(0, 90)

/**
 * The CSV of hourly columns, one per distinct series. Every series has the weather's hours. Identical series share a
 * column, so a document with many zones on one profile stays small.
 */
class Columns {
  private names: string[] = []
  private cols: Float64Array[] = []
  private byKey = new Map<string, number>()
  constructor(readonly hours: number) {}
  /** The Schedule:File object for this series (column numbers from 1). */
  add(name: string, v: ArrayLike<number>, round = 4): Obj {
    if (v.length !== this.hours) throw new Error(`schedule "${name}" has ${v.length} values, not ${this.hours}`)
    const f = 10 ** round
    const a = Float64Array.from(v, (x) => Math.round(x * f) / f)
    const key = a.join(',')
    let i = this.byKey.get(key)
    if (i === undefined) { i = this.cols.length; this.cols.push(a); this.names.push(name); this.byKey.set(key, i) }
    return {
      schedule_type_limits_name: 'Any Number', file_name: SCHEDULE_FILE, column_number: i + 1, rows_to_skip_at_top: 1,
      number_of_hours_of_data: this.hours, column_separator: 'Comma', interpolate_to_timestep: 'No', minutes_per_item: 60,
    }
  }
  csv(): string {
    const lines = [this.names.map((n) => n.replace(/,/g, ' ')).join(',')]
    for (let h = 0; h < this.hours; h++) lines.push(this.cols.map((c) => c[h]).join(','))
    return lines.join('\n') + '\n'
  }
}

/** The layer resized so the stack's ISO 6946 U (films by tilt) equals `u`, as elements.ts opaqueElement does. */
function layersForU(layers: Layer[], tilt: number, boundary: 'outside' | 'ground', u: number, path: string): Layer[] {
  const out = layers.map((l) => ({ ...l }))
  const r = out.map((l) => (l.kind === 'Material:NoMass' ? (l.thermal_resistance as number) : (l.thickness as number) / (l.conductivity as number)))
  const { R_si, R_se } = iso6946Films(tilt, boundary)
  let li = 0
  r.forEach((x, i) => { if (x > r[li]) li = i })
  const others = R_si + R_se + r.reduce((s, x) => s + x, 0) - r[li]
  const want = 1 / u - others
  if (!(want > 1e-4)) {
    // 17 Nov 2026 (example school): a leaky wall with its zone's bridging on a small area can ask for more than the
    // largest layer alone can give; every layer's resistance is then scaled by one factor instead (the films stay).
    const all = 1 / u - R_si - R_se
    const sum = r.reduce((t, x) => t + x, 0)
    if (!(all > 1e-4) || !(sum > 0)) throw new EnergyPlusInputError(`U ${u.toFixed(3)} W/m²K (with this zone's thermal bridging) is above what the surface films alone allow (${(1 / (R_si + R_se)).toFixed(3)})`, path)
    const f = all / sum
    out.forEach((l, i) => {
      if (l.kind === 'Material:NoMass') l.thermal_resistance = r[i] * f
      else l.conductivity = (l.thickness as number) / (r[i] * f)
    })
    return out
  }
  const l = out[li]
  if (l.kind === 'Material:NoMass') l.thermal_resistance = want
  else l.conductivity = (l.thickness as number) / want
  return out
}

export function toEnergyPlus(doc: ModelDocument, weather: Weather, library: Record<string, ConstructionBody>, ours: ModelResults): EnergyPlusInput {
  const H = weather.hours.count
  if (H !== 8760) throw new EnergyPlusInputError(`the weather file has ${H} hours; EnergyPlus runs here take a 8,760-hour year`, 'weather')
  if (ours.zones.length !== doc.zones.length) throw new EnergyPlusInputError('the hourly run does not match the building (run it again)', 'zones')
  const notes: string[] = []
  const note = (s: string) => { if (!notes.includes(s)) notes.push(s) }
  // Weather-driven air (17 Nov 2026; before, refused): EnergyPlus's own air model (AirflowNetwork) is not built yet,
  // so each room is given the outdoor air the hourly run worked out for it, hour by hour (leakage, vents, windows opened
  // by its rule and an extract fan's make-up air, results.air.inflow_kg_per_h), as volume at the hour's outdoor
  // density. EnergyPlus then checks everything else (fabric, sun, mass, gains, setpoints) with the run's air. A room
  // the run gave today's leakage (no outside wall, review F4) keeps it, as under today's method.
  const weatherAir = doc.building.air.method === 'weather_driven'
  const airWx = weatherAir ? airWeather(weather.hours, weather.header.elevation) : null
  // Brief 126: the outdoor humidity ratio each hour (airWeather, the run's one read) and EnergyPlus's standard density.
  const wOut = (airWx ?? airWeather(weather.hours, weather.header.elevation)).w
  const RHO_STD = 101325 / (287.0 * (20 + 273.15))
  const airOf = (zi: number) => (weatherAir && ours.zones[zi].air?.leakage === 'weather' ? ours.zones[zi].air! : null)
  if (weatherAir && ours.zones.some((z) => !z.air)) throw new EnergyPlusInputError('the hourly run has no weather-driven air for every room (run it again)', 'building.air.method')
  const shaded: string[] = []
  const ep: Record<string, Record<string, Obj>> = {}
  const put = (type: string, name: string, o: Obj) => { (ep[type] ??= {})[name] = o }
  const cols = new Columns(H)
  const surfById = new Map(doc.surfaces.map((s, i) => [s.id, { s, i }]))
  const surfLite = new Map(doc.surfaces.map((s) => [s.id, s]))
  const zoneIndex = new Map(doc.zones.map((z, i) => [z.id, i]))
  const Z = doc.zones.map((_, i) => `Z${i + 1}`)

  // ── Run settings ──────────────────────────────────────────────────────────────────────────────────────────────
  put('Version', 'Version 1', { version_identifier: EP_VERSION })
  put('SimulationControl', 'SimulationControl 1', {
    do_zone_sizing_calculation: 'No', do_system_sizing_calculation: 'No', do_plant_sizing_calculation: 'No',
    run_simulation_for_sizing_periods: 'No', run_simulation_for_weather_file_run_periods: 'Yes',
  })
  // Terrain sets how EnergyPlus scales the weather file's wind to each surface's height.
  // Brief 125: one read of the site's terrain, shared with the run's outside film (airflow.ts siteTerrain).
  const { terrain, stated: terrainStated } = siteTerrain(doc.building.site)
  if (!terrainStated) note('Wind: the site states no terrain or exposure, so EnergyPlus scales the wind to each surface\'s height as for suburbs (its own default).')
  put('Building', epName(doc.building.name || 'Building'), {
    north_axis: 0, terrain, solar_distribution: 'FullExterior', maximum_number_of_warmup_days: 25, minimum_number_of_warmup_days: 6,
    loads_convergence_tolerance_value: 0.04, temperature_convergence_tolerance_value: 0.4,
  })
  put('GlobalGeometryRules', 'GlobalGeometryRules 1', { starting_vertex_position: 'UpperLeftCorner', vertex_entry_direction: 'Counterclockwise', coordinate_system: 'Relative' })
  put('Timestep', 'Timestep 1', { number_of_timesteps_per_hour: EP_STEPS_PER_HOUR })
  const hd = weather.header
  put('Site:Location', epName(hd.city || 'Site'), { latitude: hd.latitude, longitude: hd.longitude, time_zone: hd.time_zone, elevation: hd.elevation })
  put('RunPeriod', 'Year', {
    begin_month: 1, begin_day_of_month: 1, end_month: 12, end_day_of_month: 31, day_of_week_for_start_day: 'Monday',
    use_weather_file_holidays_and_special_days: 'No', use_weather_file_daylight_saving_period: 'No', apply_weekend_holiday_rule: 'No',
    use_weather_file_rain_indicators: 'Yes', use_weather_file_snow_indicators: 'Yes',
  })
  // The ground: the document's method, the weather file's mean dry bulb all year (as the hourly run takes it).
  if (doc.building.site.ground.method !== 'annual_mean_outdoor') throw new EnergyPlusInputError('only the annual mean outdoor ground temperature is carried', 'building.site.ground.method')
  const tg = r6(groundTemperature(weather))
  put('Site:GroundTemperature:BuildingSurface', 'Ground', Object.fromEntries(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].map((m) => [`${m}_ground_temperature`, tg]),
  ))
  put('ScheduleTypeLimits', 'Any Number', {})
  put('Schedule:Constant', 'Always On', { schedule_type_limits_name: 'Any Number', hourly_value: 1 })
  put('Schedule:Constant', 'Always Off', { schedule_type_limits_name: 'Any Number', hourly_value: 0 })

  // ── Constructions ─────────────────────────────────────────────────────────────────────────────────────────────
  const matByKey = new Map<string, string>()
  const consByKey = new Map<string, string>()
  const material = (l: Layer, solar: number, thermal: number, path: string): string => {
    const nomass = l.kind === 'Material:NoMass'
    const o: Obj = nomass
      ? { roughness: 'MediumRough', thermal_resistance: r6(l.thermal_resistance as number), thermal_absorptance: thermal, solar_absorptance: solar, visible_absorptance: solar }
      : { roughness: 'MediumRough', thickness: r6(l.thickness as number), conductivity: r6(l.conductivity as number), density: l.density, specific_heat: Math.max(100, l.specific_heat as number), thermal_absorptance: thermal, solar_absorptance: solar, visible_absorptance: solar }
    if (!nomass && !((l.thickness as number) > 0 && (l.conductivity as number) > 0)) throw new EnergyPlusInputError('a layer with mass needs thickness and conductivity', path)
    const key = JSON.stringify([nomass, o])
    let n = matByKey.get(key)
    if (!n) { n = `M${matByKey.size + 1}_${epName(l.name ?? 'layer').slice(0, 40)}`; matByKey.set(key, n); put(nomass ? 'Material:NoMass' : 'Material', n, o) }
    return n
  }
  /**
   * A construction from layers (outside first). Absorptances on the outer layer's outside face and the inner layer's
   * inside face; EnergyPlus reads a material's absorptance on whichever face is exposed. A middle layer keeps 0.9 / 0.7
   * (never exposed). Long-wave inside: 0.9.
   */
  const construction = (layers: Layer[], outside: { solar: number; thermal: number } | null, insideSolar: number, path: string, label: string): string => {
    if (layers.length === 0) throw new EnergyPlusInputError('needs at least one layer', path)
    if (layers.length > 10) throw new EnergyPlusInputError('EnergyPlus takes at most 10 layers', path)
    const names = layers.map((l, i) => {
      const first = i === 0, last = i === layers.length - 1
      const solar = first && outside ? outside.solar : last ? insideSolar : first ? insideSolar : 0.7
      const thermal = first && outside ? outside.thermal : 0.9
      return material(l, solar, thermal, `${path}.layers[${i}]`)
    })
    const key = names.join('|')
    let n = consByKey.get(key)
    if (!n) {
      n = `C${consByKey.size + 1}_${epName(label).slice(0, 40)}`
      consByKey.set(key, n)
      const o: Obj = { outside_layer: names[0] }
      names.slice(1).forEach((m, j) => { o[`layer_${j + 2}`] = m })
      put('Construction', n, o)
    }
    return n
  }
  const twoSided = (layers: Layer[], ia: number, ib: number, path: string, label: string): [string, string] => {
    if (layers.length === 0) throw new EnergyPlusInputError('needs at least one layer', path)
    if (layers.length > 10) throw new EnergyPlusInputError('EnergyPlus takes at most 10 layers', path)
    const names = layers.map((l, i) => material(l, i === 0 ? ib : i === layers.length - 1 ? ia : 0.7, 0.9, `${path}.layers[${i}]`))
    const make = (ns: string[], tag: string) => {
      const key = ns.join('|')
      let n = consByKey.get(key)
      if (!n) {
        n = `C${consByKey.size + 1}_${epName(label).slice(0, 36)}${tag}`
        consByKey.set(key, n)
        const o: Obj = { outside_layer: ns[0] }
        ns.slice(1).forEach((m, j) => { o[`layer_${j + 2}`] = m })
        put('Construction', n, o)
      }
      return n
    }
    return [make(names, ''), make([...names].reverse(), '_rev')]
  }
  const glazingCons = new Map<string, string>()
  const glazing = (u: number, shgc: number): string => {
    const key = `${u}|${shgc}`
    let n = glazingCons.get(key)
    if (!n) {
      n = `Glazing_U${u}_g${shgc}`
      put('WindowMaterial:SimpleGlazingSystem', n, { u_factor: u, solar_heat_gain_coefficient: shgc, visible_transmittance: Math.max(0.0001, Math.min(0.99, shgc)) })
      put('Construction', n, { outside_layer: n })
      glazingCons.set(key, n)
    }
    return n
  }
  const bodyOf = (s: Surface, path: string) => {
    const b = library[s.construction_ref.key]
    if (!b) throw new EnergyPlusInputError(`construction "${s.construction_ref.key}" is not in the library`, `${path}.construction_ref.key`)
    return b
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  // The U each opaque element ran at, and each zone's bridging, read from the hourly run (Rule 11).
  const uRan = new Map<string, number>()
  const ventsRan = new Map<string, number[]>()
  for (const z of ours.zones) {
    const c = readZoneConductances(z)
    for (const e of c.elements) uRan.set(e.surface_id, e.u_w_per_m2k)
    for (const v of c.vents) ventsRan.set(v.surface_id, [...(ventsRan.get(v.surface_id) ?? []), v.m3s_per_ms])  // in the openings' order
  }

  // ── Zones, their surfaces, and where each rectangle goes ──────────────────────────────────────────────────────
  let slot = 0
  const place = (zFloor: number): Vec => { slot++; return [slot * 400, slot * 400, zFloor] }
  const zones: EnergyPlusInput['zones'] = []
  const gainsAll = zoneGains(doc, weather.hours)
  const ventAll = zoneVentilation(doc, weather.hours)
  const spAll = zoneSetpointHours(doc, weather.hours)
  const emAll = zoneEmitters(doc)
  const coolAll = zoneCooling(doc)
  let anyMass = false

  doc.zones.forEach((zone, zi) => {
    const zp = `zones[${zi}]`, zn = Z[zi]
    const r = ours.zones[zi]
    const height = zone.height_m * zone.storeys
    const volume = zone.area_m2 * zone.height_m
    if (!(volume > 0)) throw new EnergyPlusInputError('the zone needs a floor area and height', `${zp}.area_m2`)
    const z0 = zone.floor * zone.height_m
    put('Zone', zn, { direction_of_relative_north: 0, x_origin: 0, y_origin: 0, z_origin: 0, multiplier: 1, ceiling_height: r6(height), volume: r6(volume), floor_area: r6(zone.area_m2) })

    // Internal heat capacity on the air: the zone's contents (Brief 124: ISO 52016-1's 10 kJ/K·m²), as the hourly run.
    const C = zone.internal_heat_capacity_j_per_k_m2 * zone.area_m2
    if (C > 0) {
      const m = 1 + C / (K.rho_c_air * volume)
      put('ZoneCapacitanceMultiplier:ResearchSpecial', `${zn} capacity`, { zone_or_zonelist_name: zn, temperature_capacity_multiplier: r6(m), humidity_capacity_multiplier: 1, carbon_dioxide_capacity_multiplier: 1, generic_contaminant_capacity_multiplier: 1 })
    }

    const own = zone.surfaces.map((sid) => surfById.get(sid)!).filter(({ s }) => s.zone_a === zone.id)
    // Thermal bridging: the run's W/K for this zone, as it is in the run, H·(θ_e − θ_air) (ISO 52016-1). EnergyPlus has
    // no linear bridge; Brief 126 carries it as outdoor air of exactly that conductance (below), not folded into the
    // walls' U as before, where it took the walls' sun and outside film and lost less than the run's (school: about
    // 7 MWh a year of the plain case's gap, docs/briefs/active/126_inside-sky-window.md Part 1).
    const tbH = readZoneConductances(r).bridging.total_w_per_k

    // Windows by host: a wall (or roof) of this zone facing the same way.
    const glass = own.filter(({ s }) => s.kind === 'glazing' && s.area_m2 > 0)
    // Brief 126: one layout for the translator and the run's window heights (windowLayout).
    const layout = windowLayout(zone, surfLite)
    const hostOf = new Map<string, string>()
    for (const { s, i } of glass) {
      const l = layout.get(s.id)
      if (!l) throw new EnergyPlusInputError(`window "${s.id}" has no wall or roof of its zone facing the same way to sit in`, `surfaces[${i}]`)
      hostOf.set(s.id, l.host)
    }

    for (const sid of zone.surfaces) {
      const { s, i } = surfById.get(sid)!
      const p = `surfaces[${i}]`
      if (s.area_m2 <= 0 || s.kind === 'glazing') continue
      const interzone = zoneIndex.has(s.zone_b) && s.zone_b !== s.zone_a
      if (interzone && s.zone_a !== zone.id) continue  // written from zone_a's side, with its twin
      const b = bodyOf(s, p)
      // Brief 124: with the inside finishes (carpet, a suspended ceiling) on each face, as the hourly run builds them.
      let layers: Layer[]
      try { layers = surfaceLayers(s, library, p) } catch (e) {
        if (e instanceof ModelError) throw new EnergyPlusInputError(e.message.slice(e.path.length + 2), e.path)
        throw e
      }
      if (s.kind === 'internal_mass' || interzone) {
        const ia = s.inside_solar_absorptance!, ib = s.inside_solar_absorptance_b!
        // One set of materials, zone_b's face first (its absorptance ib) and zone_a's last (ia); zone_b's surface takes
        // the same materials reversed, so EnergyPlus sees one construction from two sides.
        const [cA, cB] = twoSided(layers, ia, ib, p, b.name ?? s.construction_ref.key)
        const zb = s.kind === 'internal_mass' ? zn : Z[zoneIndex.get(s.zone_b)!]
        const zbFloor = s.kind === 'internal_mass' ? z0 : doc.zones[zoneIndex.get(s.zone_b)!].floor * doc.zones[zoneIndex.get(s.zone_b)!].height_m
        const tilt = s.tilt_deg
        const n = normal(0, tilt), f = frame(n)
        const w = tilt > 45 && tilt < 135 ? Math.min(height, Math.sqrt(s.area_m2)) : Math.sqrt(s.area_m2)
        const pts = rect(place(Math.min(z0, zbFloor) + 0.5), f, 0, 0, s.area_m2 / w, w)
        const typeA = s.kind === 'floor' ? 'Floor' : s.kind === 'ceiling' ? 'Ceiling' : tilt < 45 ? 'Ceiling' : tilt > 135 ? 'Floor' : 'Wall'
        const typeB = typeA === 'Floor' ? 'Ceiling' : typeA === 'Ceiling' ? 'Floor' : 'Wall'
        const nA = epName(`${s.id}`), nB = epName(`${s.id}_b`)
        put('BuildingSurface:Detailed', nA, { surface_type: typeA, construction_name: cA, zone_name: zn, outside_boundary_condition: 'Surface', outside_boundary_condition_object: nB, sun_exposure: 'NoSun', wind_exposure: 'NoWind', number_of_vertices: 4, vertices: vertices(pts) })
        put('BuildingSurface:Detailed', nB, { surface_type: typeB, construction_name: cB, zone_name: zb, outside_boundary_condition: 'Surface', outside_boundary_condition_object: nA, sun_exposure: 'NoSun', wind_exposure: 'NoWind', number_of_vertices: 4, vertices: vertices([...pts].reverse() as Vec[]) })
        if (s.kind === 'internal_mass') anyMass = true
        continue
      }
      const outside = s.zone_b === 'outside'
      const ground = s.kind === 'ground' && s.zone_b === 'ground'
      if (!outside && !ground) throw new EnergyPlusInputError(`a ${s.kind} facing "${s.zone_b}" is not carried`, p)
      const boundary = ground ? 'ground' : 'outside'
      let u = uRan.get(s.id)
      if (u == null) throw new EnergyPlusInputError('the hourly run has no U for this surface (run it again)', p)
      layers = layersForU(layers, s.tilt_deg, boundary, u, p)
      const outsideOptics = outside ? { solar: s.solar_absorptance!, thermal: s.thermal_emissivity! } : null
      const cons = construction(layers, outsideOptics, s.inside_solar_absorptance!, p, b.name ?? s.construction_ref.key)
      const az = s.azimuth_deg ?? 0
      const n = normal(az, s.tilt_deg), f = frame(n)
      // Windows hosted here: gross = this surface's net area + theirs.
      const hosted = glass.filter(({ s: g }) => hostOf.get(g.id) === s.id)
      const winArea = hosted.reduce((t, x) => t + x.s.area_m2, 0)
      const gross = s.area_m2 + winArea
      const h = hostRectHeight(s.tilt_deg, gross, height)
      const w = gross / h
      // Brief 125: the surface's centroid at outsideFaceZ, the height the run's outside film takes its wind at (one
      // read). Its windows fill the middle of it, so they share the height. Ground floors stay at the zone's floor.
      const o = place(ground ? z0 : outsideFaceZ(zone, s.tilt_deg) - (h / 2) * f.up[2])
      const type = s.kind === 'wall' ? 'Wall' : s.kind === 'roof' ? 'Roof' : 'Floor'
      const sname = epName(s.id)
      put('BuildingSurface:Detailed', sname, {
        surface_type: type, construction_name: cons, zone_name: zn, outside_boundary_condition: ground ? 'Ground' : 'Outdoors',
        sun_exposure: ground ? 'NoSun' : 'SunExposed', wind_exposure: ground ? 'NoWind' : 'WindExposed', number_of_vertices: 4, vertices: vertices(rect(o, f, 0, 0, w, h)),
      })
      if (hosted.length) {
        // A row of windows with small gaps; each split into glass and frame (Brief 104 Part 1b).
        const m = windowMargin(h)
        const hw = h - 2 * m
        const widths = hosted.map((x) => x.s.area_m2 / hw)
        const gap = (w - widths.reduce((a, c) => a + c, 0)) / (hosted.length + 1)
        if (!(gap > 0.001)) throw new EnergyPlusInputError(`the windows on "${s.id}" fill it completely; EnergyPlus needs a little wall around them`, p)
        let x = gap
        hosted.forEach(({ s: g, i: gi }, k) => {
          const gp = `surfaces[${gi}]`, gb = bodyOf(g, gp)
          const gu = num(g.construction_ref.u_value_override) ?? num(gb.u_value_W_per_m2K)
          const gg = num(g.construction_ref.g_value_override) ?? num(g.g_value) ?? num(gb.g_value)
          if (gu == null) throw new EnergyPlusInputError('glazing needs a U', `${gp}.construction_ref`)
          if (gg == null) throw new EnergyPlusInputError('glazing needs a g-value', `${gp}.g_value`)
          const ff = g.frame_fraction ?? 0
          const wg = widths[k] * (1 - ff), wf = widths[k] * ff
          const gn = epName(g.id)
          put('FenestrationSurface:Detailed', gn, { surface_type: 'Window', construction_name: glazing(gu, gg), building_surface_name: sname, multiplier: 1, ...windowVertices(rect(o, f, x, m, wg, hw)) })
          if (wf > 0) put('FenestrationSurface:Detailed', `${gn}_frame`, { surface_type: 'Window', construction_name: glazing(gu, 0.0001), building_surface_name: sname, multiplier: 1, ...windowVertices(rect(o, f, x + wg, m, wf, hw)) })
          if (g.shading?.overhang?.depth_m || g.shading?.fins?.left_depth_m || g.shading?.fins?.right_depth_m) {
            shaded.push(g.id)
          }
          x += widths[k] + gap
        })
      }
      // Permanent vents: the flow per unit wind the document states (its cd, flow mode and the site exposure: the same
      // CIBSE / EN 16798-7 coefficient the hourly run takes, air.ts ventCoefficient, read from the run), on EnergyPlus's
      // wind at the zone's height. EnergyPlus's own opening effectiveness (0.3 to 0.6) is a cross-ventilation figure and
      // would overstate a single-sided vent about twentyfold. No stack: the document states no height difference.
      s.openings.forEach((op, j) => {
        if (op.kind !== 'permanent_vent' || !(op.area_m2 > 0)) return
        if (airOf(zi)) return
        const k = ventsRan.get(s.id)?.shift()
        if (k == null) throw new EnergyPlusInputError('the hourly run has no flow for this vent (run it again)', `${p}.openings[${j}]`)
        put('ZoneVentilation:WindandStackOpenArea', epName(`${s.id}_vent${j + 1}`), {
          zone_or_space_name: zn, opening_area: op.area_m2, opening_area_fraction_schedule_name: 'Always On', opening_effectiveness: r6(k / op.area_m2),
          effective_angle: r6(az), height_difference: 0, discharge_coefficient_for_opening: op.cd ?? 0.6,
          minimum_indoor_temperature: -100, maximum_indoor_temperature: 100, delta_temperature: -100, minimum_outdoor_temperature: -100, maximum_outdoor_temperature: 100, maximum_wind_speed: 40,
        })
        note('Permanent vents: the flow per unit of wind the model states for each vent (as the hourly run takes it), with EnergyPlus\'s wind at the zone\'s height and terrain.')
      })
    }

    // ── Thermal bridging (Brief 126): H W/K as air at standard density, V = H / (ρ_std·c_p(w)) each hour, so EnergyPlus's
    // ρ_std·c_p·V·(θ_e − θ_air) is the run's H·(θ_e − θ_air). c_p follows the hour's outdoor humidity, as EnergyPlus's.
    if (tbH > 0) {
      const v = new Float64Array(H)
      let peak = 0
      for (let h = 0; h < H; h++) { v[h] = tbH / (RHO_STD * (1004.84 + 1858.95 * wOut[h])); if (v[h] > peak) peak = v[h] }
      const bn = epName(`${zn}_bridging`)
      put('Schedule:File', bn, cols.add(bn, Float64Array.from(v, (x) => x / peak)))
      put('ZoneInfiltration:DesignFlowRate', `${zn} thermal bridging`, {
        zone_or_zonelist_or_space_or_spacelist_name: zn, schedule_name: bn, design_flow_rate_calculation_method: 'Flow/Zone', design_flow_rate: r6(peak),
        constant_term_coefficient: 1, temperature_term_coefficient: 0, velocity_term_coefficient: 0, velocity_squared_term_coefficient: 0, density_basis: 'Standard',
      })
      note('Thermal bridging: EnergyPlus has no linear bridge, so each room\'s bridging W/K is carried as outdoor air of exactly that conductance (heat = H × (outdoor − room air), as in the run), shown in EnergyPlus\'s infiltration.')
    }

    // ── Air leakage: the run's air change rate from q50, constant (today's method) ──────────────────────────────
    const za = airOf(zi)
    if (za) {
      const q = new Float64Array(H)
      let peak = 0
      for (let h = 0; h < H; h++) {
        q[h] = za.inflow_kg_per_h[h] / 3600 / rhoAir(airWx!.p_hour[h], weather.hours.dry_bulb[h], airWx!.w[h])
        if (q[h] > peak) peak = q[h]
      }
      if (peak > 0) {
        const an = epName(`${zn}_air`)
        put('Schedule:File', an, cols.add(an, Float64Array.from(q, (v) => v / peak)))
        put('ZoneInfiltration:DesignFlowRate', `${zn} air`, {
          zone_or_zonelist_or_space_or_spacelist_name: zn, schedule_name: an, design_flow_rate_calculation_method: 'Flow/Zone', design_flow_rate: r6(peak),
          constant_term_coefficient: 1, temperature_term_coefficient: 0, velocity_term_coefficient: 0, velocity_squared_term_coefficient: 0,
        })
      }
      note('Air: the building uses weather-driven air, which EnergyPlus is not given its own way yet (its AirflowNetwork). Each room takes the outdoor air the hourly run worked out for it, hour by hour (leakage, vents, windows opened by their rule, an extract fan\'s make-up air), so EnergyPlus checks the fabric, sun, mass, gains and setpoints but not the air.')
    }
    const ach = za ? 0 : readZoneConductances(r).infiltration.ach
    if (ach > 0) put('ZoneInfiltration:DesignFlowRate', `${zn} leakage`, {
      zone_or_zonelist_or_space_or_spacelist_name: zn, schedule_name: 'Always On', design_flow_rate_calculation_method: 'AirChanges/Hour', air_changes_per_hour: r6(ach),
      constant_term_coefficient: 1, temperature_term_coefficient: 0, velocity_term_coefficient: 0, velocity_squared_term_coefficient: 0,
    })

    // ── Internal gains, hour by hour as the run has them ─────────────────────────────────────────────────────────
    const zg = gainsAll[zi]
    for (const g of zg?.gains ?? []) {
      const peakHeat = g.w.reduce((m, v) => Math.max(m, v), 0)
      if (!(peakHeat > 0)) continue
      const base = epName(`${zn}_${g.kind}_${g.profile_id}`)
      if (g.electric_w) {
        // Electric: EnergyPlus meters the power; the share that is not heat to the room is "lost".
        const peakE = g.electric_w.reduce((m, v) => Math.max(m, v), 0)
        const frac = new Float64Array(H)
        let heat = 0, elec = 0
        for (let h = 0; h < H; h++) { frac[h] = peakE > 0 ? g.electric_w[h] / peakE : 0; heat += g.w[h]; elec += g.electric_w[h] }
        const lost = elec > 0 ? Math.max(0, Math.min(1, 1 - heat / elec)) : 0
        for (let h = 0; h < H; h++) if (g.electric_w[h] > 0 && Math.abs(g.w[h] / g.electric_w[h] - (1 - lost)) > 1e-3) {
          note(`Gains "${g.profile_id}": its heat is not a fixed share of its power every hour, so EnergyPlus is given the year's share.`)
          break
        }
        put('ElectricEquipment', base, {
          zone_or_zonelist_or_space_or_spacelist_name: zn, schedule_name: base, design_level_calculation_method: 'EquipmentLevel', design_level: r6(peakE),
          fraction_latent: 0, fraction_radiant: r6(g.radiant_fraction * (1 - lost)), fraction_lost: r6(lost),
          end_use_subcategory: g.kind === 'lighting' ? 'Lighting' : g.kind === 'equipment' ? 'Equipment' : 'Auxiliary',
        })
        put('Schedule:File', base, cols.add(base, frac))
      } else {
        const frac = Float64Array.from(g.w, (v) => v / peakHeat)
        put('OtherEquipment', base, {
          fuel_type: 'None', zone_or_zonelist_or_space_or_spacelist_name: zn, schedule_name: base, design_level_calculation_method: 'EquipmentLevel',
          design_level: r6(peakHeat), fraction_latent: 0, fraction_radiant: r6(g.radiant_fraction), fraction_lost: 0, end_use_subcategory: 'People',
        })
        put('Schedule:File', base, cols.add(base, frac))
        note('People: their sensible heat as stated (W per person, radiant share), as the hourly run takes it; their moisture is not modelled in either.')
      }
    }

    // ── Ventilation entries ─────────────────────────────────────────────────────────────────────────────────────
    let oaFlow = 0
    const oaRun = new Float64Array(H)
    for (const v of ventAll[zi]) {
      if (v.kind === 'mvhr') {
        // MVHR: the ideal loads' outdoor air at its flow × (1 − recovery), with no heat exchanger: the same heat as the
        // stated recovery every hour, as the model states it (no summer bypass). EnergyPlus's own ideal-loads heat
        // recovery bypasses itself whenever that helps, which the model does not state (Bridgewater: half the cooling).
        const q = v.flow_m3s * (1 - v.recovery)
        oaFlow += q
        for (let h = 0; h < H; h++) oaRun[h] += q * v.running[h]
        continue
      }
      // Weather-driven air: an extract fan's air is in the room's air above (its make-up air through the openings).
      if (v.kind === 'mev' && airOf(zi)) continue
      const vn = epName(`${zn}_${v.id}`)
      put('Schedule:File', vn, cols.add(vn, v.running))
      put('ZoneVentilation:DesignFlowRate', vn, {
        zone_or_zonelist_or_space_or_spacelist_name: zn, schedule_name: vn, design_flow_rate_calculation_method: 'Flow/Zone', design_flow_rate: r6(v.flow_m3s),
        ventilation_type: v.kind === 'mev' ? 'Exhaust' : 'Natural', fan_pressure_rise: 0, fan_total_efficiency: 1,
        constant_term_coefficient: 1, temperature_term_coefficient: 0, velocity_term_coefficient: 0, velocity_squared_term_coefficient: 0,
        minimum_indoor_temperature: -100, maximum_indoor_temperature: 100, delta_temperature: -100, minimum_outdoor_temperature: -100, maximum_outdoor_temperature: 100, maximum_wind_speed: 40,
      })
    }

    // ── Setpoints and the room's heating and cooling (ideal loads) ───────────────────────────────────────────────
    const sp = spAll[zi]
    const heatC = zone.setpoints.heat_c, coolC = zone.setpoints.cool_c
    const heatSp = new Float64Array(H), coolSp = new Float64Array(H), heatOn = new Float64Array(H), coolOn = new Float64Array(H)
    for (let h = 0; h < H; h++) {
      const hs = sp ? sp.hourly.heat_c[h] : heatC ?? NaN
      const cs = sp ? sp.hourly.cool_c[h] : coolC ?? NaN
      heatOn[h] = Number.isFinite(hs) ? 1 : 0; coolOn[h] = Number.isFinite(cs) ? 1 : 0
      heatSp[h] = Number.isFinite(hs) ? hs : -50
      coolSp[h] = Number.isFinite(cs) ? cs : 60
    }
    const heated = heatOn.some((x) => x > 0), cooled = coolOn.some((x) => x > 0)
    zones.push({ ep_name: zn, zone_id: zone.id, heated, cooled })
    if (heated || cooled || oaFlow > 0) {
      put('Schedule:File', `${zn} heating setpoint`, cols.add(`${zn} heating setpoint`, heatSp, 2))
      put('Schedule:File', `${zn} cooling setpoint`, cols.add(`${zn} cooling setpoint`, coolSp, 2))
      put('Schedule:File', `${zn} heating on`, cols.add(`${zn} heating on`, heatOn, 0))
      put('Schedule:File', `${zn} cooling on`, cols.add(`${zn} cooling on`, coolOn, 0))
      put('Schedule:Constant', `${zn} control type`, { schedule_type_limits_name: 'Any Number', hourly_value: 4 })
      put('ThermostatSetpoint:DualSetpoint', `${zn} setpoints`, { heating_setpoint_temperature_schedule_name: `${zn} heating setpoint`, cooling_setpoint_temperature_schedule_name: `${zn} cooling setpoint` })
      put('ZoneControl:Thermostat', `${zn} thermostat`, { zone_or_zonelist_name: zn, control_type_schedule_name: `${zn} control type`, control_1_object_type: 'ThermostatSetpoint:DualSetpoint', control_1_name: `${zn} setpoints` })
      const em = emAll[zi], cu = coolAll[zi]
      const il: Obj = {
        availability_schedule_name: 'Always On', zone_supply_air_node_name: `${zn} supply`, zone_exhaust_air_node_name: `${zn} exhaust`,
        maximum_heating_supply_air_temperature: 50, minimum_cooling_supply_air_temperature: 13,
        maximum_heating_supply_air_humidity_ratio: 0.0156, minimum_cooling_supply_air_humidity_ratio: 0.0077,
        heating_limit: em ? 'LimitCapacity' : 'NoLimit', cooling_limit: cu ? 'LimitCapacity' : 'NoLimit',
        heating_availability_schedule_name: `${zn} heating on`, cooling_availability_schedule_name: `${zn} cooling on`,
        dehumidification_control_type: 'None', humidification_control_type: 'None',
        demand_controlled_ventilation_type: 'None', outdoor_air_economizer_type: 'NoEconomizer',
        heat_recovery_type: 'None',
      }
      if (em) {
        il.maximum_sensible_heating_capacity = r6(em.cap_w)
        note('Radiators and other emitters: EnergyPlus limits each room\'s heating to its emitters\' output at the setpoint, held fixed (LimitCapacity); the hourly run re-rates it each hour at the room\'s temperature. The heat goes to the air in EnergyPlus.')
        if (em.slab) note('Underfloor heating: EnergyPlus gives its heat to the room\'s air, not into the floor slab.')
      }
      if (cu) il.maximum_total_cooling_capacity = r6(cu.cap_w)
      if (oaFlow > 0) {
        const oaName = `${zn} MVHR`
        const runFrac = Float64Array.from(oaRun, (x) => x / oaFlow)
        put('Schedule:File', `${zn} MVHR running`, cols.add(`${zn} MVHR running`, runFrac))
        put('DesignSpecification:OutdoorAir', oaName, { outdoor_air_method: 'Flow/Zone', outdoor_air_flow_per_zone: r6(oaFlow), outdoor_air_schedule_name: `${zn} MVHR running` })
        put('OutdoorAir:Node', `${zn} outdoor air`, {})
        Object.assign(il, { design_specification_outdoor_air_object_name: oaName, outdoor_air_inlet_node_name: `${zn} outdoor air`, heat_recovery_type: 'None' })
        note('MVHR: outdoor air through the room\'s ideal loads at its flow × (1 − heat recovery), the same heat as the stated recovery all year (the model states no summer bypass); its heat is in the room\'s heating and cooling. Fan electricity is from the stated SFP, as in the hourly run.')
      }
      put('ZoneHVAC:IdealLoadsAirSystem', `${zn} ideal loads`, il)
      put('ZoneHVAC:EquipmentList', `${zn} equipment`, { load_distribution_scheme: 'SequentialLoad', equipment: [{ zone_equipment_object_type: 'ZoneHVAC:IdealLoadsAirSystem', zone_equipment_name: `${zn} ideal loads`, zone_equipment_cooling_sequence: 1, zone_equipment_heating_or_no_load_sequence: 1 }] })
      put('ZoneHVAC:EquipmentConnections', zn, {
        zone_name: zn, zone_conditioning_equipment_list_name: `${zn} equipment`, zone_air_inlet_node_or_nodelist_name: `${zn} supply`,
        // EnergyPlus needs the air to leave the zone somewhere: the ideal loads' exhaust node, always.
        zone_air_exhaust_node_or_nodelist_name: `${zn} exhaust`, zone_air_node_name: `${zn} air`,
      })
    }
  })

  if (anyMass) note('Internal mass: a surface with both faces in its room, as the hourly run has it.')
  if (doc.system_groups.some((g) => g.enabled && (g.service === 'heating' || g.service === 'cooling') && g.capacity_kw != null)) {
    note('System capacity (kW) is not given to EnergyPlus yet: its rooms are limited only by their own emitters and units.')
  }
  note('Energy: EnergyPlus gives each room\'s heating and cooling; the fuel and electricity come from those through the systems\' stated efficiencies, the same conversion the hourly run uses. Lighting, equipment, hot water, pumps and fans are the same inputs in both.')

  // ── Outputs ───────────────────────────────────────────────────────────────────────────────────────────────────
  put('OutputControl:Files', 'OutputControl:Files 1', {
    output_csv: 'No', output_mtr: 'No', output_eso: 'No', output_eio: 'No', output_tabular: 'No', output_sqlite: 'No', output_json: 'Yes',
    output_audit: 'No', output_zone_sizing: 'No', output_system_sizing: 'No', output_dxf: 'No', output_bnd: 'No', output_rdd: 'No', output_mdd: 'No',
    output_mtd: 'No', output_end: 'Yes', output_shd: 'No', output_dfs: 'No', output_glhe: 'No', output_delightin: 'No', output_delighteldmp: 'No',
    output_delightdfdmp: 'No', output_edd: 'No', output_dbg: 'No', output_perflog: 'No', output_sln: 'No', output_sci: 'No', output_wrl: 'No',
    output_screen: 'No', output_extshd: 'No', output_tarcog: 'No',
  })
  put('Output:JSON', 'Output:JSON 1', { option_type: 'TimeSeries', output_json: 'Yes', output_cbor: 'No', output_messagepack: 'No' })
  const vars = ['Zone Ideal Loads Supply Air Sensible Heating Energy', 'Zone Ideal Loads Supply Air Sensible Cooling Energy', 'Zone Mean Air Temperature', 'Zone Operative Temperature']
  vars.forEach((v, i) => put('Output:Variable', `Output:Variable ${i + 1}`, { key_value: '*', variable_name: v, reporting_frequency: 'Hourly' }))

  if (shaded.length) notes.unshift(`Overhangs and fins are not carried (EnergyPlus needs each window's real size and position, which the model does not hold yet), so ${shaded.length === 1 ? 'one window has' : `${shaded.length} windows have`} more sun in EnergyPlus than in NZA Sim: ${shaded.join(', ')}.`)
  return { epjson: ep, schedules_csv: cols.csv(), zones, notes }
}
