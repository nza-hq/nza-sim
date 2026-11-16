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
    /** Heat into this zone from another through the element they share (Brief 104); the two zones' lines cancel. */
    | 'interzone'
    /** Internal gains from the document's profiles, one line per profile the zone refers to (Brief 105 Part 2). */
    | 'occupancy_gains' | 'lighting_gains' | 'equipment_gains' | 'auxiliary_gains'
    /** Mechanical or natural ventilation, one line per zone ventilation entry that runs (Brief 105 Part 3). */
    | 'mechanical_ventilation'
  surface_id: string | null
  /** The profile a gains line comes from. */
  profile_id?: string
  /** The zone ventilation entry a mechanical_ventilation line comes from. */
  ventilation_id?: string
  kwh: number
}

export interface ZoneResults {
  /** 'thermal-1': one zone alone (Engine 1's solver); 'thermal-2': solved as part of a network of zones (Brief 104). */
  engine: 'thermal-1' | 'thermal-2'
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
    /** Heat into the zone from the other zones, W (Brief 105 Part 6; zeros for a one-zone model). */
    interzone_w: Float64Array
  }
  annual: {
    heating_kwh: number
    cooling_kwh: number
    peak_heating_w: number
    peak_cooling_w: number
    /** The air node's statistics. Not the lowest temperature to report: that is the control temperature, read through readZoneMinControlC. */
    theta_air_c: { min: number; max: number; mean: number }
    /** Brief 108: hours the control temperature is more than 0.5 K below the heating setpoint (null: not heated). */
    unmet_heating_hours: number | null
    /**
     * Brief 108: the lowest control temperature (air or operative, as the run's control), °C. The one exposure of
     * "the lowest temperature the zone fell to" (Rule 11, review F9); under air control it equals theta_air_c.min,
     * which is the air node's statistic and is not read for this anywhere.
     */
    min_control_c: number
    /** Brief 109: hours the zone is in use (its schedule at 1; every hour when it states none). */
    in_use_hours: number
    /** Brief 109: of those, hours more than 0.5 K below the heating setpoint (null: not heated). What an occupant feels. */
    unmet_heating_hours_in_use: number | null
    /** Brief 109: the lowest control temperature in use, °C (null: never in use). */
    min_control_in_use_c: number | null
  }
  /** Brief 108: the zone's emitters and the cap they set, or null when it states none (heating not limited). */
  emitters: {
    cap_w: number; radiant_fraction: number; hours_at_cap: number; emitters: { id: string; kind: string; output_w: number; rated_w: number; exponent_n: number | null }[]
    /** Brief 109: underfloor heating's floor and layer, and its share of the zone's heating; null when none is in a floor. */
    slab: { surface_id: string; layer_index: number; share: number } | null
  } | null
  /** Every term of the balance, per element where it has one (Rule 9). The lines sum to the closure residual. */
  breakdown: BreakdownLine[]
  closure: { max_wh: number; sum_kwh: number }
  /** The whole run's time (every zone), ms. */
  run_ms: number
}

/**
 * A model's results (Brief 104 Part 3): one `ZoneResults` per zone, in the document's order. Building totals are not
 * stored a second time (Rule 11): they are read from the zones with the helpers below.
 */
export interface ModelResults {
  engine: 'thermal-1' | 'thermal-2'
  zones: ZoneResults[]
  solver: {
    /** Temperature nodes solved per hour. */
    nodes: number
    /** Most passes the heating/cooling set took in any hour, and how many hours needed more than one (Engine 2). */
    active_set: { max_passes: number; hours_over_one: number } | null
  }
  run_ms: number
}

export const readZoneHeatingKwh = (r: ZoneResults) => r.annual.heating_kwh
export const readZoneCoolingKwh = (r: ZoneResults) => r.annual.cooling_kwh
export const readZonePeakHeatingW = (r: ZoneResults) => r.annual.peak_heating_w
export const readZonePeakCoolingW = (r: ZoneResults) => r.annual.peak_cooling_w
/** The lowest control temperature of the year (Rule 11: the one read path). */
export const readZoneMinControlC = (r: ZoneResults) => r.annual.min_control_c
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

const sumZones = (r: ModelResults, f: (z: ZoneResults) => number) => r.zones.reduce((s, z) => s + f(z), 0)
export const readModelZones = (r: ModelResults) => r.zones
export const readBuildingHeatingKwh = (r: ModelResults) => sumZones(r, readZoneHeatingKwh)
export const readBuildingCoolingKwh = (r: ModelResults) => sumZones(r, readZoneCoolingKwh)
/** The building's hourly heating or cooling, W: the zones' summed hour by hour. */
export function readBuildingHourlyW(r: ModelResults, which: 'heating' | 'cooling'): Float64Array {
  const out = new Float64Array(r.zones[0]?.hourly.heating_w.length ?? 0)
  for (const z of r.zones) { const a = which === 'heating' ? z.hourly.heating_w : z.hourly.cooling_w; for (let h = 0; h < out.length; h++) out[h] += a[h] }
  return out
}
/** The building's peak, W: the largest hour of the zones' sum (not the sum of the zones' own peaks). */
export const readBuildingPeakW = (r: ModelResults, which: 'heating' | 'cooling') => readBuildingHourlyW(r, which).reduce((m, v) => Math.max(m, v), 0)
