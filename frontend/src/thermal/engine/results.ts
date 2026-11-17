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
    /** Brief 115, weather-driven air: windows opened by the zone's window rule, and EN 16798-7's single-sided term. */
    | 'window_ventilation' | 'single_sided_turbulence'
    /** Brief 122, the monthly estimate (static) only: gain not used at the heating setpoint, less what cooling removed (monthly.ts). */
    | 'gains_not_used'
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
  /**
   * Brief 115: weather-driven air (absent under today's method). Each hour: the outdoor air that came in, kg/h, and
   * how far the windows were open (0 to 1 of their widest, the hour's mean); and the hours any window was open.
   */
  /** Brief 115: weather-driven air. `leakage` 'q50_over_20': a room with no outside wall keeps today's leakage (review F4). */
  air?: { inflow_kg_per_h: Float64Array; window_open_fraction: Float64Array; hours_windows_open: number; leakage: 'weather' | 'q50_over_20' }
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
    /** Brief 119: hours the control temperature is more than 0.5 K above the cooling setpoint (null: not cooled). */
    unmet_cooling_hours: number | null
    /** Brief 119: of those, the hours in use (null: not cooled). */
    unmet_cooling_hours_in_use: number | null
    /** Brief 119: the highest control temperature (air or operative, as the run's control), °C. */
    max_control_c: number
    /** Brief 119 review F4: the highest control temperature in use, °C (null: never in use). The mirror of min_control_in_use_c. */
    max_control_in_use_c: number | null
    /**
     * Brief 120 (review F3): of the hours in use below (above) the setpoint, those in which a system's capacity held the
     * zone below its ask while the zone's own emitters (units) were not at their limit in that ask ("system short"), and
     * those in which both were ("both"). The rest are the zone's own emitters or units, or warm-up. Null: no system with
     * a capacity serves the zone.
     */
    system_short_heating_hours_in_use: number | null
    system_short_cooling_hours_in_use: number | null
    both_short_heating_hours_in_use: number | null
    both_short_cooling_hours_in_use: number | null
  }
  /** Brief 108: the zone's emitters and the cap they set, or null when it states none (heating not limited). */
  emitters: {
    cap_w: number; radiant_fraction: number; hours_at_cap: number; emitters: { id: string; kind: string; output_w: number; rated_w: number; exponent_n: number | null }[]
    /** Brief 109: underfloor heating's floor and layer, and its share of the zone's heating; null when none is in a floor. */
    slab: { surface_id: string; layer_index: number; share: number } | null
  } | null
  /** Brief 119: the zone's cooling units and the limit they set, or null when none cools (cooling not limited). */
  cooling_units: { cap_w: number; hours_at_cap: number; units: { id: string; kind: string; output_w: number }[] } | null
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
  /** Brief 120: each heating or cooling system with a capacity, in the document's order (empty: none). */
  plants: PlantResults[]
}

/**
 * Brief 120: a system's capacity against what its zones asked of it. `ask` is each hour's heating (or cooling) the
 * zones would have taken from it at their setpoints with only their own emitters' limits; `delivered` what it gave
 * them. `asked_not_given_step_sum_kwh` (review F4) is Σ (ask − given) over its short steps, each ask at the setpoint
 * from wherever the zone had fallen to, so a deficit carried over is counted again each step: it is not an energy, not
 * the heat a bigger plant would have used, and is not shown to the person (the seam leaves it out).
 */
export interface PlantResults {
  id: string
  service: 'heating' | 'cooling'
  cap_w: number
  /**
   * The highest step's ask, W, and the hours (fractions summed) the plant was short. The ask is at the setpoint from where
   * the zones are, so a zone left cold asks for its whole recovery in one step (bounded only by its emitters): with a short
   * plant and no emitter limit it can be many times the design heat loss. Not a sizing figure; not shown (the seam leaves
   * it, and ask_kwh, out).
   */
  peak_ask_w: number
  hours_short: number
  ask_kwh: number
  delivered_kwh: number
  asked_not_given_step_sum_kwh: number
  /** Hot water it heated first, kWh a year (0 without). */
  reserved_kwh: number
  /** The highest hour of that hot water, W (0 without). */
  peak_reserved_w: number
  /**
   * Review F6: the hot water system it heats first (null: none). In an hour whose hot water is above its capacity the
   * taps get `hot_water_given_frac` of it (null: never short) and the rooms nothing; the hours, and the heat the taps
   * did not get, kWh a year. Systems serves only what the taps got.
   */
  hot_water_id: string | null
  hot_water_given_frac: Float64Array | null
  hot_water_short_hours: number
  hot_water_short_kwh: number
  /** asked_not_given_step_sum_kwh by calendar month, January first. */
  asked_not_given_step_sum_kwh_by_month: number[]
  /** Brief 120 P2b: the lowest flow temperature it fell to, °C (its design flow if never short); null when it does not feed wet emitters in every zone (shared in proportion to ask). */
  min_flow_c: number | null
  /**
   * Review F1: what it gave each zone it serves, W each hour (Σ = what it delivered). With a short plant beside others,
   * the zone's systems no longer give in fixed shares (the others top up); Systems reads each system's energy from here.
   */
  zones: { zone_id: string; share: number; given_w: Float64Array }[]
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
