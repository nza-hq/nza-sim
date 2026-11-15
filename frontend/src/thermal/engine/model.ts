/**
 * runZoneModel: a model document and an EPW in, one zone's hourly temperatures and demand out (Brief 103 Part 4).
 *
 * Building-module scope (CLAUDE.md): opaque and glazing conduction, thermal bridging, solar through glazing and on
 * opaque surfaces, infiltration through q50, permanent vents, and the demand to hold the zone's comfort band. Nothing
 * else in the document is read. Everything the engine needs comes from the document, the library bodies it pins, the
 * weather and the stated run options; a missing input raises an error naming its path.
 */
import { infiltration, ventCoefficient, ventConductance, type Vent } from './air'
import { computeBridging } from './bridging'
import { ENGINE_CONSTANTS as K } from './constants'
import { opaqueElement, windowElement, type ConstructionBody, type Element } from './elements'
import type { BreakdownLine, ZoneResults } from './results'
import { shadingFactor } from './shading'
import { solarOnSurface, type SolarOptions } from './solar'
import type { Weather } from './types'
import { runZone } from './zone'
import type { ModelDocument } from '../schema/model'

export class ModelError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'ModelError' }
}

export interface RunOptions {
  control: 'air' | 'operative'
  hc_convective_fraction: number
  warmup_days: number
  /** Albedo is a run option until the document carries it (today's engine: 0.2). */
  solar: SolarOptions
  /** Reference cases only (BESTEST's fixed gain); internal gains from profiles arrive in Brief 105. */
  other_gains: { w: ArrayLike<number>; convective_fraction: number } | null
  /**
   * Surface physics beyond ISO 52016-1's fixed simplifications (Brief 103 Part 6b). Absent: the simplifications
   * (outside h_ce 20, inside h_ci by tilt, transmitted solar over every inside surface by area).
   * - outside_convection 'wind': h_ce = 4 + 4·v (ISO 6946:2017 Annex C) from the weather's hourly wind speed.
   * - inside_convection 'by_heat_flow': ISO 52016-1 Table 25 by the actual direction of heat flow (previous hour).
   * - beam_on_floor: the beam part of transmitted solar lands on the floor-facing inside surfaces, by area.
   */
  surface_physics?: { outside_convection: 'fixed' | 'wind'; inside_convection: 'by_tilt' | 'by_heat_flow'; beam_on_floor: boolean }
}

/**
 * The options the EnergyPlus referee comparison uses: air thermostat, ideal convective loads, apparent solar time,
 * and the sun's beam on the floor, as EnergyPlus distributes it (FullInteriorAndExterior) in both referees. Outside
 * and inside convection stay ISO 52016-1's fixed values: the referee's own correlations (DOE-2, TARP) are not ISO
 * 6946's or Table 25's, so switching between ISO forms does not make the two models the same (Part 6b,
 * docs/audit/103/07_bestest_referee.md).
 */
export const REFEREE_OPTIONS: RunOptions = {
  control: 'air', hc_convective_fraction: 1, warmup_days: 25,
  solar: { albedo: 0.2, sun_day: 'actual', solar_time: 'apparent' }, other_gains: null,
  surface_physics: { outside_convection: 'fixed', inside_convection: 'by_tilt', beam_on_floor: true },
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function runZoneModel(doc: ModelDocument, weather: Weather, library: Record<string, ConstructionBody>, options: RunOptions): ZoneResults {
  const t0 = now()
  if (doc.zones.length !== 1) throw new ModelError(`Engine 1 runs one zone; the document has ${doc.zones.length} (multi-zone is Brief 104)`, 'zones')
  const zone = doc.zones[0]
  const H = weather.hours.count
  const surfaces = zone.surfaces.map((id) => {
    const i = doc.surfaces.findIndex((s) => s.id === id)
    return { s: doc.surfaces[i], path: `surfaces[${i}]` }
  })
  const body = (key: string, path: string): ConstructionBody => {
    const b = library[key]
    if (!b) throw new ModelError(`construction "${key}" is not in the library given to the engine`, `${path}.construction_ref.key`)
    return b
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  const elements: Element[] = []
  const absorbed: Float64Array[] = []
  const transmittedBySurface: { id: string; w: Float64Array }[] = []
  const solarTransmitted = new Float64Array(H)
  const solarBeam = new Float64Array(H)
  const sp = options.surface_physics ?? null
  const vents: (Vent & { m3s_per_ms: number })[] = []
  const glazingInfo: ZoneResults['conductances']['glazing'] = []
  let envelopeArea = 0

  for (const { s, path } of surfaces) {
    if (s.zone_a !== zone.id) throw new ModelError(`surface belongs to zone "${s.zone_a}"`, `${path}.zone_a`)
    envelopeArea += s.area_m2
    const ref = s.construction_ref
    const b = body(ref.key, path)
    const solar = () => {
      if (s.tilt_deg > 90 + 1e-9) return new Float64Array(H)  // faces down: no sun reaches it in this model
      return solarOnSurface(weather, s.azimuth_deg ?? 0, s.tilt_deg, options.solar).total
    }
    if (s.kind === 'glazing') {
      if (s.zone_b !== 'outside') throw new ModelError('glazing must face outside in Engine 1', `${path}.zone_b`)
      const pub = num(b.u_value_W_per_m2K)
      const u = num(ref.u_value_override) ?? (pub != null ? pub * (num(b.y_factor) && b.y_factor! > 0 ? b.y_factor! : 1) : null)
      if (u == null) throw new ModelError('glazing needs a U (override or library u_value_W_per_m2K)', `${path}.construction_ref`)
      const g = num(ref.g_value_override) ?? num(s.g_value) ?? num(b.g_value)
      if (g == null) throw new ModelError('glazing needs a g-value (override, surface or library)', `${path}.g_value`)
      const ff = s.frame_fraction
      if (ff == null) throw new ModelError('required', `${path}.frame_fraction`)
      const facade = s.facade
      const hasShading = !!(s.shading?.overhang?.depth_m || s.shading?.fins?.left_depth_m || s.shading?.fins?.right_depth_m)
      if (hasShading && facade == null) throw new ModelError('shading needs the facade label', `${path}.facade`)
      const sf = facade ? shadingFactor(facade, s.shading) : 1
      elements.push(windowElement({ id: s.id, area_m2: s.area_m2, tilt_deg: s.tilt_deg, u, emissivity: s.thermal_emissivity, path }))
      absorbed.push(new Float64Array(H))
      const sun = s.tilt_deg > 90 + 1e-9 ? null : solarOnSurface(weather, s.azimuth_deg ?? 0, s.tilt_deg, options.solar)
      const w = new Float64Array(H)
      const f = g * K.glazing_angle_factor * (1 - ff) * sf * s.area_m2
      if (sun) {
        for (let h = 0; h < H; h++) { w[h] = sun.total[h] * f; solarTransmitted[h] += w[h] }
        if (sp?.beam_on_floor) for (let h = 0; h < H; h++) solarBeam[h] += Math.min(sun.direct[h] * f, w[h])
      }
      transmittedBySurface.push({ id: s.id, w })
      glazingInfo.push({ surface_id: s.id, g_value: g, frame_fraction: ff, shading_factor: sf })
      continue
    }
    const outside = (s.kind === 'wall' || s.kind === 'roof' || s.kind === 'floor') && s.zone_b === 'outside'
    const ground = s.kind === 'ground' && s.zone_b === 'ground'
    if (!outside && !ground) throw new ModelError(`a ${s.kind} facing "${s.zone_b}" needs another zone (Brief 104)`, path)
    const stated = num(ref.u_value_override) ?? num((b as any).u_value_override) ?? num(b.u_value_W_per_m2K)
    elements.push(opaqueElement({
      id: s.id, area_m2: s.area_m2, tilt_deg: s.tilt_deg, boundary: ground ? 'ground' : 'outside',
      layers: b.layers ?? [], stated_u: stated, emissivity: ground ? null : s.thermal_emissivity, path,
    }))
    const a = new Float64Array(H)
    if (outside) {
      const alpha = s.solar_absorptance
      if (alpha == null) throw new ModelError('required', `${path}.solar_absorptance`)
      if (alpha > 0) { const I = solar(); for (let h = 0; h < H; h++) a[h] = alpha * I[h] }
    }
    absorbed.push(a)
    s.openings.forEach((o, j) => {
      if (o.kind !== 'permanent_vent') throw new ModelError('operable openings are the Operation module (not Engine 1)', `${path}.openings[${j}]`)
      if (!(o.area_m2 > 0)) return
      const p = `${path}.openings[${j}]`
      if (o.cd == null) throw new ModelError('required', `${p}.cd`)
      if (o.flow_mode == null) throw new ModelError('required', `${p}.flow_mode`)
      const v: Vent = { surface_id: s.id, area_m2: o.area_m2, cd: o.cd, flow_mode: o.flow_mode as Vent['flow_mode'] }
      vents.push({ ...v, m3s_per_ms: ventCoefficient(v, doc.building.site.exposure, p) })
    })
  }

  const volume = zone.area_m2 * zone.height_m
  const inf = infiltration({ q50: zone.infiltration_q50, ach: zone.infiltration_ach, envelope_area_m2: envelopeArea, volume_m3: volume, path: 'zones[0]' })
  const ventH = ventConductance(vents.map((v) => v.m3s_per_ms), weather.hours.wind_speed, H)
  const Hve = new Float64Array(H)
  for (let h = 0; h < H; h++) Hve[h] = inf.h_w_per_k + ventH[h]
  const areaUA = elements.reduce((s, e) => s + e.u_w_per_m2k * e.area_m2, 0)
  const bridging = computeBridging({
    tb: doc.building.thermal_bridging, polygon: zone.polygon, storeys: zone.storeys, storey_height_m: zone.height_m,
    glazing_areas_m2: surfaces.filter(({ s }) => s.kind === 'glazing').map(({ s }) => s.area_m2), area_ua_w_per_k: areaUA,
  })
  let tg = 0
  for (let h = 0; h < H; h++) tg += weather.hours.dry_bulb[h]
  tg /= H  // building.site.ground.method === 'annual_mean_outdoor' (the only method the schema allows)

  const run = runZone({
    elements, air_capacity_j_per_k: K.rho_c_air * volume + zone.internal_heat_capacity_j_per_k_m2 * zone.area_m2,
    bridging_w_per_k: bridging.total_w_per_k, hours: H, theta_e: weather.hours.dry_bulb, theta_ground: tg,
    ventilation_w_per_k: Hve, solar_absorbed_w_per_m2: absorbed, solar_transmitted_w: solarTransmitted,
    other_gains: options.other_gains, setpoints: { heat_c: zone.setpoints.heat_c, cool_c: zone.setpoints.cool_c },
    control: options.control, hc_convective_fraction: options.hc_convective_fraction, initial_c: zone.setpoints.heat_c ?? weather.hours.dry_bulb[0],
    warmup_days: options.warmup_days,
    h_ce_w_per_m2k: sp?.outside_convection === 'wind' ? Float64Array.from(weather.hours.wind_speed, (v) => K.h_ce_wind_a + K.h_ce_wind_b * Math.max(0, v)) : null,
    inside_convection: sp?.inside_convection ?? 'by_tilt',
    solar_beam_w: sp?.beam_on_floor ? solarBeam : null,
  })

  // Breakdown: annual kWh per term (Rule 9). Ventilation is split into infiltration and vents by their conductances.
  const kwh = (a: ArrayLike<number>) => { let s = 0; for (let h = 0; h < H; h++) s += a[h]; return s / 1000 }
  const lines: BreakdownLine[] = []
  let infW = 0, ventW = 0
  for (let h = 0; h < H; h++) {
    const v = run.terms.ventilation_w[h], tot = Hve[h]
    if (tot > 0) { infW += (v * inf.h_w_per_k) / tot; ventW += (v * ventH[h]) / tot }
  }
  lines.push({ term: 'heating', surface_id: null, kwh: kwh(run.heating_w) })
  lines.push({ term: 'cooling', surface_id: null, kwh: -kwh(run.cooling_w) })
  elements.forEach((e, k) => {
    lines.push({ term: 'conduction', surface_id: e.id, kwh: kwh(run.terms.boundary_w[k]) })
    if (e.kind === 'opaque' && e.boundary === 'outside') {
      lines.push({ term: 'opaque_solar_absorbed', surface_id: e.id, kwh: kwh(run.terms.solar_absorbed_w[k]) })
    }
    if (e.f_sky > 0) lines.push({ term: 'sky_longwave', surface_id: e.id, kwh: kwh(run.terms.sky_w[k]) })
  })
  lines.push({ term: 'bridging', surface_id: null, kwh: kwh(run.terms.bridging_w) })
  lines.push({ term: 'infiltration', surface_id: null, kwh: infW / 1000 })
  lines.push({ term: 'permanent_vents', surface_id: null, kwh: ventW / 1000 })
  for (const t of transmittedBySurface) lines.push({ term: 'solar_transmitted', surface_id: t.id, kwh: kwh(t.w) })
  if (options.other_gains) lines.push({ term: 'other_gains', surface_id: null, kwh: kwh(run.terms.other_gains_w) })
  lines.push({ term: 'storage', surface_id: null, kwh: -kwh(run.terms.storage_w) })

  let mn = Infinity, mx = -Infinity, mean = 0, maxClosure = 0
  for (let h = 0; h < H; h++) {
    const t = run.theta_air[h]; mn = Math.min(mn, t); mx = Math.max(mx, t); mean += t / H
    maxClosure = Math.max(maxClosure, run.closure_wh[h])
  }
  return {
    engine: 'thermal-1', zone_id: zone.id, constants: K,
    conductances: {
      elements: elements.map((e, k) => ({ surface_id: e.id, kind: surfaces[k].s.kind, area_m2: e.area_m2, u_w_per_m2k: e.u_w_per_m2k, h_w_per_k: e.u_w_per_m2k * e.area_m2 })),
      glazing: glazingInfo, infiltration: inf,
      vents: vents.map((v) => ({ surface_id: v.surface_id, area_m2: v.area_m2, cd: v.cd, flow_mode: v.flow_mode, m3s_per_ms: v.m3s_per_ms })),
      bridging,
    },
    hourly: { theta_air_c: run.theta_air, theta_operative_c: run.theta_op, theta_mean_radiant_c: run.theta_mrt, heating_w: run.heating_w, cooling_w: run.cooling_w },
    annual: {
      heating_kwh: kwh(run.heating_w), cooling_kwh: kwh(run.cooling_w),
      peak_heating_w: Math.max(...run.heating_w), peak_cooling_w: Math.max(...run.cooling_w),
      theta_air_c: { min: mn, max: mx, mean },
    },
    breakdown: lines,
    closure: { max_wh: maxClosure, sum_kwh: lines.reduce((s, l) => s + l.kwh, 0) },
    run_ms: now() - t0,
  }
}
