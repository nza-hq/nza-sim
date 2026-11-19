/**
 * Brief 127 P1 (Linzie 18–19 Nov 2026: "check and layer lots of different data points ... see whether your model is
 * working"): every hourly dataset the run already holds, gathered into one catalogue for the results explorer.
 *
 * Nothing here is worked out. Each series is one of the engine's own hourly arrays (results.zones[].hourly, the plants'
 * given_w, the systems engine's fuel_w and its other lines, the setpoint hours, the weather file), copied to 32-bit
 * floats so the worker can post it and converted from W to kW. The only sums are stated in `from`: a fuel's total is
 * its end-use lines (as `energy.by_fuel`), a plant's total is its rooms' given_w (as delivered_kwh), the building's
 * heating and cooling are readBuildingHourlyW (Rule 11: the one read of each). The explorer reads hourly data only
 * from here.
 */
import { readBuildingHourlyW, type ModelResults } from '../../thermal/engine/results'
import type { SystemsResults } from '../../thermal/engine/systems'
import type { ZoneSetpointHours } from '../../thermal/engine/model'
import type { ModelDocument } from '../../thermal/schema/model'
import type { Weather } from '../../thermal/engine/types'

export type SeriesUnit = 'kW' | 'kWh' | '°C' | 'W/m²' | 'm/s' | '%' | 'kg/h' | 'in use'
export type SeriesScope = 'weather' | 'building' | 'system' | 'room'

export interface Series {
  id: string
  scope: SeriesScope
  /** The room or system it belongs to (null for weather and the building). */
  owner: string | null
  owner_name: string | null
  label: string
  unit: SeriesUnit
  /** How a period adds up: 'energy' sums kW over hours to kWh; 'mean' averages (temperatures, weather, states). */
  agg: 'energy' | 'mean'
  /** Where the number comes from, in words (shown on hover). */
  from: string
  /** One value an hour; NaN where it does not apply (a setpoint with that service off). */
  values: Float32Array
}

export interface SeriesSet {
  hours: number
  /** 1–12, 1–31, 0–23, and 0 Monday … 6 Sunday, as the engine's calendar counts days (gains.ts `calendar`). */
  month: Uint8Array
  day_of_month: Uint8Array
  hour: Uint8Array
  day_of_week: Uint8Array
  series: Series[]
}

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
const kw = (a: ArrayLike<number>) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i]! / 1000; return o }
const f32 = (a: ArrayLike<number>) => Float32Array.from(a as ArrayLike<number>)
const END_USE_WORDS: Record<string, string> = {
  heating: 'Heating', cooling: 'Cooling', dhw: 'Hot water', dhw_circulation: 'Hot water pump', pumps: 'Pumps', fans: 'Fans',
  lighting: 'Lighting', small_power: 'Small power', auxiliary: 'Other electrical',
}
const FUEL_WORDS: Record<string, string> = { electricity: 'electricity', gas: 'gas', oil: 'oil', biomass: 'biomass', district_heating: 'district heat', district_cooling: 'district cooling' }
const SERVICE_WORDS: Record<string, string> = { heating: 'Heating', cooling: 'Cooling', dhw: 'Hot water', lighting: 'Lighting', small_power: 'Small power', ventilation: 'Ventilation' }

export function seriesCatalogue(doc: ModelDocument, results: ModelResults, weather: Weather, setpoints: (ZoneSetpointHours | null)[], systems: SystemsResults | null): SeriesSet {
  const w = weather.hours, H = results.zones[0]?.hourly.heating_w.length ?? w.count
  const month = new Uint8Array(H), day = new Uint8Array(H), hour = new Uint8Array(H), dow = new Uint8Array(H)
  for (let h = 0; h < H; h++) { month[h] = w.month[h]!; day[h] = w.day[h]!; hour[h] = w.hour[h]! - 1; dow[h] = (CUM_DAYS[w.month[h]! - 1]! + w.day[h]! - 1) % 7 }
  const out: Series[] = []
  const add = (s: Omit<Series, 'values'>, values: Float32Array) => { if (values.length === H) out.push({ ...s, values }) }

  // Weather: the file the run used.
  const wx = (id: string, label: string, unit: SeriesUnit, a: ArrayLike<number>, field: string) =>
    add({ id: `weather.${id}`, scope: 'weather', owner: null, owner_name: null, label, unit, agg: 'mean', from: `Weather file (${field})` }, f32(a))
  wx('dry_bulb', 'Outdoor air temperature', '°C', w.dry_bulb, 'dry bulb')
  wx('global_horizontal', 'Sun on the ground (global horizontal)', 'W/m²', w.global_horizontal, 'global horizontal irradiance')
  wx('wind_speed', 'Wind speed', 'm/s', w.wind_speed, 'wind speed')
  wx('relative_humidity', 'Relative humidity', '%', w.relative_humidity, 'relative humidity')

  // Building: demand (the zones summed, readBuildingHourlyW), then energy by fuel and by end use.
  add({ id: 'building.heating', scope: 'building', owner: null, owner_name: null, label: 'Heating demand (all rooms)', unit: 'kW', agg: 'energy', from: 'Every room\'s heating, summed (readBuildingHourlyW)' }, kw(readBuildingHourlyW(results, 'heating')))
  add({ id: 'building.cooling', scope: 'building', owner: null, owner_name: null, label: 'Cooling demand (all rooms)', unit: 'kW', agg: 'energy', from: 'Every room\'s cooling, summed (readBuildingHourlyW)' }, kw(readBuildingHourlyW(results, 'cooling')))
  if (systems) {
    const lines = new Map<string, { end_use: string; fuel: string; w: Float64Array }>()
    const at = (end_use: string, fuel: string) => { const k = `${end_use}|${fuel}`; let l = lines.get(k); if (!l) { l = { end_use, fuel, w: new Float64Array(H) }; lines.set(k, l) } return l.w }
    for (const g of systems.groups) { const a = at(g.service, g.fuel); for (let h = 0; h < H; h++) a[h] += g.fuel_w[h]! }
    for (const u of systems.ungrouped) { const a = at(u.end_use, 'electricity'); for (let h = 0; h < H; h++) a[h] += u.w[h]! }
    const fuels = new Map<string, Float64Array>()
    for (const l of lines.values()) { let f = fuels.get(l.fuel); if (!f) { f = new Float64Array(H); fuels.set(l.fuel, f) } for (let h = 0; h < H; h++) f[h] += l.w[h]! }
    for (const [fuel, a] of fuels) if (a.some((v) => v > 0))
      add({ id: `building.fuel.${fuel}`, scope: 'building', owner: null, owner_name: null, label: `All ${FUEL_WORDS[fuel] ?? fuel}`, unit: 'kW', agg: 'energy', from: `Every end use's ${FUEL_WORDS[fuel] ?? fuel}, summed (as Energy used by fuel)` }, kw(a))
    for (const l of lines.values()) if (l.w.some((v) => v > 0)) {
      const two = [...lines.values()].filter((x) => x.end_use === l.end_use && x.w.some((v) => v > 0)).length > 1
      add({ id: `building.end_use.${l.end_use}.${l.fuel}`, scope: 'building', owner: null, owner_name: null, label: `${END_USE_WORDS[l.end_use] ?? l.end_use}${two ? ` (${FUEL_WORDS[l.fuel] ?? l.fuel})` : ''}`, unit: 'kW', agg: 'energy', from: 'Its systems\' energy drawn, summed (as Energy used by end use)' }, kw(l.w))
    }
  }

  // Systems: what each draws, what a system with a capacity gave its rooms, its pumps.
  const sysName = (id: string) => { const g = doc.system_groups.find((x) => x.id === id); return g?.label || `${SERVICE_WORDS[g?.service ?? ''] ?? 'A'} system` }
  if (systems) for (const g of systems.groups) {
    add({ id: `system.${g.id}.fuel`, scope: 'system', owner: g.id, owner_name: sysName(g.id), label: `${FUEL_WORDS[g.fuel] ? FUEL_WORDS[g.fuel]!.replace(/^./, (c) => c.toUpperCase()) : g.fuel} drawn`, unit: 'kW', agg: 'energy', from: 'The systems engine\'s energy drawn (fuel_w)' }, kw(g.fuel_w))
  }
  for (const p of results.plants) {
    const a = new Float64Array(H)
    for (const z of p.zones) for (let h = 0; h < H; h++) a[h] += z.given_w[h]!
    add({ id: `system.${p.id}.given`, scope: 'system', owner: p.id, owner_name: sysName(p.id), label: p.service === 'cooling' ? 'Cooling given to rooms' : 'Heat given to rooms', unit: 'kW', agg: 'energy', from: 'Its rooms\' share each hour, summed (the capacity check\'s given_w)' }, kw(a))
  }
  if (systems) for (const u of systems.ungrouped) if (u.end_use === 'pumps' && u.entry_id && u.w.some((v) => v > 0))
    add({ id: `system.${u.entry_id}.pumps`, scope: 'system', owner: u.entry_id, owner_name: sysName(u.entry_id), label: 'Pumps, electricity', unit: 'kW', agg: 'energy', from: 'The systems engine\'s pump line' }, kw(u.w))

  // Rooms.
  results.zones.forEach((z, i) => {
    const zd = doc.zones[i]!, name = zd.name || z.zone_id
    const r = (id: string, label: string, unit: SeriesUnit, agg: Series['agg'], from: string, values: Float32Array) =>
      add({ id: `room.${z.zone_id}.${id}`, scope: 'room', owner: z.zone_id, owner_name: name, label, unit, agg, from }, values)
    r('heating', 'Heating', 'kW', 'energy', 'The run\'s heating into the room', kw(z.hourly.heating_w))
    r('cooling', 'Cooling', 'kW', 'energy', 'The run\'s cooling of the room', kw(z.hourly.cooling_w))
    r('air', 'Air temperature', '°C', 'mean', 'The run\'s air node', f32(z.hourly.theta_air_c))
    r('operative', 'Operative temperature', '°C', 'mean', 'The run\'s operative temperature', f32(z.hourly.theta_operative_c))
    r('radiant', 'Mean radiant temperature', '°C', 'mean', 'The run\'s mean radiant temperature', f32(z.hourly.theta_mean_radiant_c))
    r('interzone', 'Heat from other rooms', 'kW', 'energy', 'Heat into the room through its inside walls and floors (negative: out)', kw(z.hourly.interzone_w))
    const sp = setpoints[i]
    if (sp) {
      if (sp.hourly.heat_c.some((v) => Number.isFinite(v))) r('heat_setpoint', 'Heating setpoint', '°C', 'mean', 'The room\'s setpoints and hours (zoneSetpointHours)', f32(sp.hourly.heat_c))
      if (sp.hourly.cool_c.some((v) => Number.isFinite(v))) r('cool_setpoint', 'Cooling setpoint', '°C', 'mean', 'The room\'s setpoints and hours (zoneSetpointHours)', f32(sp.hourly.cool_c))
      const use = new Float32Array(H); for (let h = 0; h < H; h++) use[h] = sp.in_use[h]! ? 100 : 0
      r('in_use', 'In use', 'in use', 'mean', 'The room\'s hours schedule at 1 (100) or not (0)', use)
    }
    if (z.air) {
      r('air_in', 'Outdoor air in', 'kg/h', 'mean', 'The run\'s weather-driven air', f32(z.air.inflow_kg_per_h))
      const open = new Float32Array(H); for (let h = 0; h < H; h++) open[h] = z.air.window_open_fraction[h]! * 100
      r('windows_open', 'Windows open', '%', 'mean', 'The run\'s window opening, % of the widest', open)
    }
    for (const p of results.plants) {
      const g = p.zones.find((x) => x.zone_id === z.zone_id)
      if (g) r(`from.${p.id}`, `${p.service === 'cooling' ? 'Cooling' : 'Heat'} from ${sysName(p.id)}`, 'kW', 'energy', 'The system\'s share for this room (given_w)', kw(g.given_w))
    }
    if (systems) systems.ungrouped.forEach((u, k) => { if (u.zone_id === z.zone_id && u.w.some((v) => v > 0))
      r(`${u.end_use}.${u.entry_id ?? k}`, `${END_USE_WORDS[u.end_use] ?? u.end_use}, electricity`, 'kW', 'energy', 'The systems engine\'s line for this room', kw(u.w)) })
  })
  return { hours: H, month, day_of_month: day, hour, day_of_week: dow, series: out }
}
