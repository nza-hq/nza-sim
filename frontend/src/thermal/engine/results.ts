/**
 * Engine 1's results for one zone (Brief 103 Part 4). Rule 11: each quantity has one place in `ZoneResults` and one
 * read helper below; nothing reads the fields directly outside this file and the engine's own tests.
 */
import type { Bridging } from './bridging'
import type { Infiltration } from './air'
import type { ENGINE_CONSTANTS } from './constants'

export interface BreakdownLine {
  /** What the line is: one term of the zone's balance. Positive = heat into the zone over the year. */
  term:
    | 'heating' | 'cooling' | 'conduction' | 'opaque_solar_absorbed' | 'sky_longwave' | 'bridging' | 'infiltration'
    | 'permanent_vents' | 'solar_transmitted' | 'other_gains' | 'storage'
    | 'glazing_solar_absorbed' | 'solar_lost_through_glazing'
  surface_id: string | null
  kwh: number
}

export interface ZoneResults {
  engine: 'thermal-1'
  zone_id: string
  constants: typeof ENGINE_CONSTANTS
  conductances: {
    /** H = U·A per element, W/K, with U the stated (ISO 6946) U the element carries. */
    elements: { surface_id: string; kind: string; area_m2: number; u_w_per_m2k: number; h_w_per_k: number }[]
    glazing: { surface_id: string; g_value: number; frame_fraction: number; shading_factor: number }[]
    infiltration: Infiltration
    /** Each vent's flow per unit wind speed, m³/s per m/s; H = ρc · Σ coefficient · v each hour. */
    vents: { surface_id: string; area_m2: number; cd: number; flow_mode: string; m3s_per_ms: number }[]
    bridging: Bridging
  }
  hourly: {
    theta_air_c: Float64Array
    theta_operative_c: Float64Array
    theta_mean_radiant_c: Float64Array
    heating_w: Float64Array
    cooling_w: Float64Array
  }
  annual: {
    heating_kwh: number
    cooling_kwh: number
    peak_heating_w: number
    peak_cooling_w: number
    theta_air_c: { min: number; max: number; mean: number }
  }
  /** Every term of the balance, per element where it has one (Rule 9). The lines sum to the closure residual. */
  breakdown: BreakdownLine[]
  closure: { max_wh: number; sum_kwh: number }
  run_ms: number
}

export const readZoneHeatingKwh = (r: ZoneResults) => r.annual.heating_kwh
export const readZoneCoolingKwh = (r: ZoneResults) => r.annual.cooling_kwh
export const readZonePeakHeatingW = (r: ZoneResults) => r.annual.peak_heating_w
export const readZonePeakCoolingW = (r: ZoneResults) => r.annual.peak_cooling_w
export const readZoneAirTemperature = (r: ZoneResults) => r.hourly.theta_air_c
export const readZoneOperativeTemperature = (r: ZoneResults) => r.hourly.theta_operative_c
export const readZoneHourlyHeatingW = (r: ZoneResults) => r.hourly.heating_w
export const readZoneHourlyCoolingW = (r: ZoneResults) => r.hourly.cooling_w
export const readZoneBreakdown = (r: ZoneResults) => r.breakdown
export const readZoneConductances = (r: ZoneResults) => r.conductances
export const readZoneClosure = (r: ZoneResults) => r.closure
/** Sum of one breakdown term over the year (all surfaces), kWh. */
export const readZoneTermKwh = (r: ZoneResults, term: BreakdownLine['term']) =>
  r.breakdown.filter((l) => l.term === term).reduce((s, l) => s + l.kwh, 0)
