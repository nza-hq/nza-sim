/**
 * Brief 117 Part 1: the design heat loss of each room, for sizing heat emitters and plant.
 *
 * A steady calculation at one design outdoor temperature, with no sun and no internal gains, as MCS MIS 3005-D asks
 * (cl. 3.4.1; Linzie 16 Nov 2026: published UK sources, not the text of BS EN 12831-1). Every term is a line, and
 * the lines sum to the room's design heat loss (Rule 9). The conductances are the year's run's own
 * (`ZoneResults.conductances`, Rule 11): this file never works out an area, a U-value or a bridging total again.
 *
 *   fabric       U·A · (θ_int − θ_e)          each element facing outside, windows by their whole U
 *   bridging     H_tb · (θ_int − θ_e)         the zone's bridging total, as the year's run applies it
 *   ground       U·A · (θ_int − θ_g)          θ_g the model's ground temperature, the weather file's annual mean
 *                                             (MIS 3005-D cl. 3.4.1(c), solid floors)
 *   to_room      U·A · (θ_int − θ_other)      each surface shared with another zone at its design temperature
 *   infiltration ρc · n · V · (θ_int − θ_e)   n the model's own (q50 / 20, or a stated ach)
 *   vents        ρc · Σ c · v_d · (θ_int − θ_e)  each permanent vent at the stated design wind speed v_d
 *   mechanical   H_max · (θ_int − θ_e)        each ventilation entry at its largest hourly conductance (its full
 *                                             flow, after heat recovery)
 *   minimum_air  ρc · (0.5 − n_total) · V · ΔT  a top-up to 0.5 air changes an hour in a room with an outside surface
 *                                             (MCS), where infiltration, vents and ventilation give less
 *   warm_up      w · A_floor                  a stated allowance per m² of floor, or none
 *
 * Not included, and named on screen: the further ground factors of BS EN 12831-1 (its text is not used); a suspended
 * floor is taken as solid, against the ground temperature, as the year's run takes it.
 *
 * The building total is the heated rooms' sum. Heat between two heated rooms cancels in it; heat to an unheated zone
 * does not, because the unheated zone's own loss is not a heating load.
 */
import { ENGINE_CONSTANTS as K } from './constants'
import { groundTemperature } from './model'
import type { ZoneResults } from './results'
import type { Weather } from './types'
import { VentilationError, zoneVentilation } from './ventilation'
import type { ModelDocument } from '../schema/model'

export class DesignError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'DesignError' }
}

/** MCS: rooms with an outside surface get at least this many air changes an hour in the design heat loss. */
export const MIN_DESIGN_ACH = 0.5
/** The share of the year's hours colder than each weather-file design temperature (CIBSE Guide A's 99.6 % and 99 %). */
const COLD_SHARE = { heating_99_6: 0.004, heating_99: 0.01 } as const

export type DesignTerm = 'fabric' | 'bridging' | 'ground' | 'to_room' | 'infiltration' | 'vents' | 'mechanical_ventilation' | 'minimum_air_change' | 'warm_up'

export interface DesignLine {
  term: DesignTerm
  /** The element, for fabric, ground and to_room. */
  surface_id?: string
  /** The zone on the other side, for to_room. */
  other_zone_id?: string
  ventilation_id?: string
  /** W/K (null for warm_up). */
  h_w_per_k: number | null
  /** The temperature difference across it, K (null for warm_up). */
  delta_t_k: number | null
  w: number
}

export interface DesignZone {
  zone_id: string
  name: string
  /** A zone with a heating setpoint. An unheated zone's lines are shown, but it is not in the building total. */
  heated: boolean
  internal_c: number
  internal_source: 'stated' | 'follow_heat_c'
  /** Air changes an hour from infiltration, vents and ventilation, before the minimum. */
  ach: number
  lines: DesignLine[]
  total_w: number
  /** W per m² of floor. */
  w_per_m2: number
}

export interface DesignHeatLoss {
  outdoor_c: number
  outdoor_source: 'stated' | 'heating_99_6' | 'heating_99'
  ground_c: number
  vent_wind_m_s: number | null
  warm_up_w_per_m2: number | null
  zones: DesignZone[]
  /** The heated zones' sum, W. */
  building_w: number
}

/**
 * The weather file's design heating temperature: the coldest hour above which the stated share of hours lies
 * (nearest rank, 0.4 % → the 36th coldest of 8,760).
 */
export function weatherDesignTemperature(weather: Weather, which: keyof typeof COLD_SHARE): number {
  const t = Float64Array.from(weather.hours.dry_bulb).sort()
  return t[Math.max(0, Math.ceil(COLD_SHARE[which] * t.length) - 1)]
}

/**
 * The design heat loss of every zone. `zones` are the year's run's results, in the document's zone order. Throws a
 * DesignError naming the first input that is missing.
 */
export function designHeatLoss(doc: ModelDocument, zones: readonly ZoneResults[], weather: Weather): DesignHeatLoss {
  const d = doc.building.design
  if (d == null) throw new DesignError('required: the design outdoor temperature and allowances', 'building.design')
  if (zones.length !== doc.zones.length) throw new Error('designHeatLoss: one result per zone, in the document\'s order')

  const outdoor_c = 'stated_c' in d.outdoor ? d.outdoor.stated_c : weatherDesignTemperature(weather, d.outdoor.from_weather)
  const outdoor_source = 'stated_c' in d.outdoor ? 'stated' as const : d.outdoor.from_weather
  const ground_c = groundTemperature(weather)

  // Each zone's design internal temperature, all first: a room's loss to its neighbour needs the neighbour's.
  const internal = doc.zones.map((z, i) => {
    const p = `zones[${i}].design_internal_c`
    const v = z.design_internal_c
    if (v == null) throw new DesignError(z.setpoints.heat_c == null ? 'required: the temperature this unheated zone is taken to sit at' : "required: a temperature, or 'follow_heat_c'", p)
    if (v === 'follow_heat_c') {
      if (z.setpoints.heat_c == null) throw new DesignError('this zone has no heating setpoint to follow: state its temperature', p)
      return { c: z.setpoints.heat_c, source: 'follow_heat_c' as const }
    }
    return { c: v, source: 'stated' as const }
  })
  const zoneIndex = new Map(doc.zones.map((z, i) => [z.id, i]))
  const surfaces = new Map(doc.surfaces.map((s) => [s.id, s]))

  let mech: ReturnType<typeof zoneVentilation>
  try { mech = zoneVentilation(doc, weather.hours) } catch (e) {
    if (e instanceof VentilationError) throw new DesignError(e.message.slice(e.path.length + 2), e.path)
    throw e
  }

  const out: DesignZone[] = doc.zones.map((zone, zi) => {
    const r = zones[zi]
    if (r.zone_id !== zone.id) throw new Error(`designHeatLoss: result ${zi} is zone "${r.zone_id}", not "${zone.id}"`)
    const c = r.conductances
    const ti = internal[zi].c
    const dte = ti - outdoor_c
    const lines: DesignLine[] = []
    let outsideFacing = false
    for (const el of c.elements) {
      const s = surfaces.get(el.surface_id)
      if (!s) throw new Error(`designHeatLoss: element "${el.surface_id}" has no surface in the document`)
      if (s.zone_b === 'outside') {
        outsideFacing = true
        lines.push({ term: 'fabric', surface_id: el.surface_id, h_w_per_k: el.h_w_per_k, delta_t_k: dte, w: el.h_w_per_k * dte })
      } else if (s.zone_b === 'ground') {
        lines.push({ term: 'ground', surface_id: el.surface_id, h_w_per_k: el.h_w_per_k, delta_t_k: ti - ground_c, w: el.h_w_per_k * (ti - ground_c) })
      } else {
        if (s.zone_a === s.zone_b) continue  // internal mass: both faces in this zone
        const other = s.zone_a === zone.id ? s.zone_b : s.zone_a
        const oi = zoneIndex.get(other)!
        const dt = ti - internal[oi].c
        lines.push({ term: 'to_room', surface_id: el.surface_id, other_zone_id: other, h_w_per_k: el.h_w_per_k, delta_t_k: dt, w: el.h_w_per_k * dt })
      }
    }
    const tb = c.bridging.total_w_per_k
    lines.push({ term: 'bridging', h_w_per_k: tb, delta_t_k: dte, w: tb * dte })

    // Air: infiltration, vents at the design wind, each ventilation entry at its full flow, then the minimum.
    const V = zone.area_m2 * zone.height_m
    const hInf = c.infiltration.h_w_per_k
    lines.push({ term: 'infiltration', h_w_per_k: hInf, delta_t_k: dte, w: hInf * dte })
    let ach = c.infiltration.ach
    if (c.vents.length) {
      if (d.vent_wind_m_s == null) throw new DesignError('required: this building has permanent vents, counted at a design wind speed', 'building.design.vent_wind_m_s')
      const q = c.vents.reduce((sum, v) => sum + v.m3s_per_ms, 0) * d.vent_wind_m_s
      const h = K.rho_c_air * q
      lines.push({ term: 'vents', h_w_per_k: h, delta_t_k: dte, w: h * dte })
      ach += (q * 3600) / V
    }
    for (const m of mech[zi]) {
      let h = 0, run = 0
      for (let k = 0; k < m.h_w_per_k.length; k++) { if (m.h_w_per_k[k] > h) h = m.h_w_per_k[k]; if (m.running[k] > run) run = m.running[k] }
      lines.push({ term: 'mechanical_ventilation', ventilation_id: m.id, h_w_per_k: h, delta_t_k: dte, w: h * dte })
      ach += (m.flow_m3s * run * 3600) / V
    }
    if (outsideFacing && ach < MIN_DESIGN_ACH) {
      const h = (K.rho_c_air * (MIN_DESIGN_ACH - ach) * V) / 3600
      lines.push({ term: 'minimum_air_change', h_w_per_k: h, delta_t_k: dte, w: h * dte })
    }
    const heated = zone.setpoints.heat_c != null
    if (d.warm_up_w_per_m2 != null && heated) lines.push({ term: 'warm_up', h_w_per_k: null, delta_t_k: null, w: d.warm_up_w_per_m2 * zone.area_m2 })

    const total_w = lines.reduce((s, l) => s + l.w, 0)
    return {
      zone_id: zone.id, name: zone.name, heated, internal_c: ti, internal_source: internal[zi].source, ach, lines, total_w,
      w_per_m2: zone.area_m2 > 0 ? total_w / zone.area_m2 : 0,
    }
  })
  return {
    outdoor_c, outdoor_source, ground_c, vent_wind_m_s: d.vent_wind_m_s, warm_up_w_per_m2: d.warm_up_w_per_m2,
    zones: out, building_w: out.reduce((s, z) => s + (z.heated ? z.total_w : 0), 0),
  }
}
