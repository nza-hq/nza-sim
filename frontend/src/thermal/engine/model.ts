/**
 * runModel: a model document and an EPW in, every zone's hourly temperatures and demand out (Brief 103 Part 4: one
 * zone; Brief 104 Part 3: several, and elements between them).
 *
 * Building-module scope (CLAUDE.md): opaque and glazing conduction, thermal bridging, solar through glazing and on
 * opaque surfaces, infiltration through q50, permanent vents, and the demand to hold the zone's comfort band. Nothing
 * else in the document is read. Everything the engine needs comes from the document, the library bodies it pins, the
 * weather and the stated run options; a missing input raises an error naming its path.
 */
import { infiltration, ventCoefficient, ventConductance, type Vent } from './air'
import { computeBridging } from './bridging'
import { ENGINE_CONSTANTS as K } from './constants'
import { innerElement, opaqueElement, windowElement, type ConstructionBody, type Element } from './elements'
import { runNetwork } from './network'
import type { BreakdownLine, ModelResults, ZoneResults } from './results'
import { shadingFactor } from './shading'
import { solarOnSurface, type SolarOptions } from './solar'
import { simpleGlazingAngular, simpleGlazingOptics } from './glazing'
import type { Weather } from './types'
import { runZone } from './zone'
import type { ModelDocument } from '../schema/model'
import { GainsError, zoneGains, type ZoneGains } from './gains'
import { VentilationError, zoneVentilation, type ZoneVentilation } from './ventilation'
import { EmitterError, zoneEmitters, type ZoneEmitters } from './emitters'

export class ModelError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'ModelError' }
}

export interface RunOptions {
  control: 'air' | 'operative'
  hc_convective_fraction: number
  warmup_days: number
  /** Albedo is a run option until the document carries it (today's engine: 0.2). */
  solar: SolarOptions
  /** Reference cases only (BESTEST's fixed gain), one zone. Internal gains from the document are `internal_gains`. */
  other_gains: { w: ArrayLike<number>; convective_fraction: number } | null
  /**
   * Internal gains (Brief 105 Part 2). 'profiles': each zone's gains from the document profiles it refers to
   * (gains.ts), on both solvers. Absent or 'none': no internal gains, the Building module's envelope-only state, as
   * Briefs 103 and 104 ran.
   */
  internal_gains?: 'none' | 'profiles'
  /**
   * Mechanical and natural ventilation (Brief 105 Part 3). 'document': each zone's ventilation entries
   * (ventilation.ts), on both solvers, added to the zone's conductance to outdoor air. Absent or 'none': infiltration
   * and permanent vents only, as Briefs 103 and 104 ran.
   */
  ventilation?: 'none' | 'document'
  /**
   * Brief 108 Part 4, the sizing run. 'none': each zone keeps its emitters' radiant share but their output is not
   * limited, so its peak heating is what its emitters would need to give to hold the setpoint every hour. Absent or
   * 'cap': heating is limited to the emitters' output (Part 2).
   */
  emitter_limit?: 'cap' | 'none'
  /**
   * Surface physics beyond ISO 52016-1's fixed simplifications (Brief 103 Part 6b). Absent: the simplifications
   * (outside h_ce 20, inside h_ci by tilt, transmitted solar over every inside surface by area).
   * - outside_convection 'wind': h_ce = 4 + 4·v (ISO 6946:2017 Annex C) from the weather's hourly wind speed.
   * - inside_convection 'by_heat_flow': ISO 52016-1 Table 25 by the actual direction of heat flow (previous hour).
   * - beam_on_floor: the beam part of transmitted solar lands on the floor-facing inside surfaces, by area.
   * - inside_convection 'tarp' (Brief 105 Part 6): Walton's natural-convection correlations, EnergyPlus's TARP inside
   *   algorithm, from each face's temperature difference with the air at the step before (network.ts). Runs on the
   *   network solver, one zone included.
   */
  surface_physics?: { outside_convection: 'fixed' | 'wind'; inside_convection: 'by_tilt' | 'by_heat_flow' | 'tarp'; beam_on_floor: boolean }
  /**
   * Brief 105 Part 6: steps per hour, and the outdoor temperature between the hour's readings ('hold' the hour's, or
   * 'linear' from the hour before's; network.ts). Absent: one step an hour. More than one runs on the network solver,
   * one zone included. Hourly inputs other than the outdoor temperature are held over the hour.
   */
  time_step?: { steps_per_hour: number; theta_e_between: 'hold' | 'linear' }
  /**
   * How solar passes through glazing (Brief 104 Part 1b). Absent or 'g_value': ISO 52016-1's g × F_W, all of it
   * transmitted into the zone and absorbed by its inside surfaces. 'optical': the window's own optics from its U and g
   * by the Simple Window Model (glazing.ts), with its angular dependence: the beam is transmitted at T(θ) and absorbed
   * in the pane at A(θ) for its own angle of incidence, sky and ground diffuse at the hemispherical values; the window's
   * network splits what the pane absorbs between outside and inside; solar falling on the window from inside leaves at
   * the diffuse transmittance and is absorbed at the diffuse absorptance (the frame share absorbs). No F_W.
   */
  glazing_solar?: 'g_value' | 'optical'
  /**
   * Share of transmitted solar given straight to the air node (Brief 104 Part 1b). Absent: ISO 52016-1 Annex B's
   * default, ENGINE_CONSTANTS.solar_convective_fraction (0.1). EnergyPlus gives none to the air: all of it lands on
   * the inside surfaces, which pass it on by convection and radiation.
   */
  solar_convective_fraction?: number
}

/**
 * The options the EnergyPlus referee comparison uses: air thermostat, ideal convective loads, apparent solar time,
 * the sun's beam on the floor, as EnergyPlus distributes it in both referees (FullExterior for Bridgewater,
 * FullInteriorAndExterior for BESTEST; both put the beam on the floor), and, from Brief 104 Part 1b, EnergyPlus's
 * conventions for window solar: the window's own optics by the Simple Window Model the referee itself uses, and no
 * transmitted solar given straight to the air (docs/audit/104/01b_window_solar.md). Outside
 * and inside convection stay ISO 52016-1's fixed values: the referee's own correlations (DOE-2, TARP) are not ISO
 * 6946's or Table 25's, so switching between ISO forms does not make the two models the same (Part 6b,
 * docs/audit/103/07_bestest_referee.md).
 */
export const REFEREE_OPTIONS: RunOptions = {
  control: 'air', hc_convective_fraction: 1, warmup_days: 25,
  solar: { albedo: 0.2, sun_day: 'actual', solar_time: 'apparent', sky: 'perez' }, other_gains: null,
  surface_physics: { outside_convection: 'fixed', inside_convection: 'by_tilt', beam_on_floor: true },
  glazing_solar: 'optical', solar_convective_fraction: 0,
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Per zone: what the surfaces built for it, before the solver. */
interface ZoneBuild {
  transmittedBySurface: { id: string; w: Float64Array }[]
  solarTransmitted: Float64Array
  solarBeam: Float64Array
  vents: (Vent & { m3s_per_ms: number })[]
  glazingInfo: ZoneResults['conductances']['glazing']
  glazingAreas: number[]
  /** Per glazing surface: the facade (or orientation) it is on, for sharing the window junction out (network only). */
  glazingGroups: string[]
  envelopeArea: number
  hasRoof: boolean
  hasGround: boolean
  /** Floors and ceilings shared with another zone. */
  sharedSlabs: number
}

/**
 * Every surface of the document as an element, once (an element between two zones is listed by both), in the order
 * the zones list them. Shared by the one-zone and the network paths, so the two cannot drift (Rule 14's spirit).
 */
function buildElements(doc: ModelDocument, weather: Weather, library: Record<string, ConstructionBody>, options: RunOptions) {
  const H = weather.hours.count
  const zIndex = new Map(doc.zones.map((z, i) => [z.id, i]))
  const body = (key: string, path: string): ConstructionBody => {
    const b = library[key]
    if (!b) throw new ModelError(`construction "${key}" is not in the library given to the engine`, `${path}.construction_ref.key`)
    return b
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const sp = options.surface_physics ?? null
  const elements: Element[] = []
  const kinds: string[] = []
  const zoneA: number[] = []
  const zoneB: (number | null)[] = []
  const insideAlpha: (number | null)[] = []    // per element: the zone_a face's inside solar absorptance (null on glazing)
  const insideAlphaB: (number | null)[] = []   // per two-faced element: the zone_b face's
  const absorbed: Float64Array[] = []
  const zones: ZoneBuild[] = doc.zones.map(() => ({
    transmittedBySurface: [], solarTransmitted: new Float64Array(H), solarBeam: new Float64Array(H), vents: [], glazingInfo: [],
    glazingAreas: [], glazingGroups: [], envelopeArea: 0, hasRoof: false, hasGround: false, sharedSlabs: 0,
  }))
  const seen = new Set<string>()
  // Surfaces with the same orientation see the same sun, and windows with the same orientation, U and g the same
  // optics, so each is computed once per run (per-storey documents repeat every facade on every storey). The cached
  // values are the ones each surface computed before; nothing changes but the repetition.
  const sunCache = new Map<string, ReturnType<typeof solarOnSurface>>()
  const sunOn = (az: number, tilt: number) => {
    const k = `${az}|${tilt}`
    let v = sunCache.get(k)
    if (!v) { v = solarOnSurface(weather, az, tilt, options.solar); sunCache.set(k, v) }
    return v
  }
  const opticalCache = new Map<string, { t: Float64Array; beam: Float64Array; a: Float64Array }>()

  doc.zones.forEach((zone, zi) => {
    for (const id of zone.surfaces) {
      if (seen.has(id)) continue
      seen.add(id)
      const i = doc.surfaces.findIndex((s) => s.id === id)
      const s = doc.surfaces[i], path = `surfaces[${i}]`
      const za = zIndex.get(s.zone_a)
      const zbZone = zIndex.get(s.zone_b)
      if (za === undefined || (s.zone_a !== zone.id && s.zone_b !== zone.id)) throw new ModelError(`surface belongs to zone "${s.zone_a}"`, `${path}.zone_a`)
      const Z = zones[za]
      const ref = s.construction_ref
      const b = body(ref.key, path)
      // A y-factor is a bridging allowance folded into U. Engine 1 takes bridging only from building.thermal_bridging,
      // so a construction carrying one would count bridging twice (with ISO 14683 junctions) or apply it to glazing
      // only (as Part 4 did). Refused until the document says how to carry it (review finding 4, recorded for 104).
      const y = num(b.y_factor)
      if (y != null && y !== 1) throw new ModelError(`y-factor ${y} is not carried by Engine 1: bridging comes from building.thermal_bridging only`, `${path}.construction_ref (library "${ref.key}").y_factor`)

      if (zbZone !== undefined) {
        // Both faces inside: a partition, floor or ceiling between two zones, or internal mass within one (decision 2).
        if (num(ref.u_value_override) != null) throw new ModelError('an element between zones takes its U from its layers; a stated U is not applied', `${path}.construction_ref.u_value_override`)
        const ia = s.inside_solar_absorptance, ib = s.inside_solar_absorptance_b
        if (ia == null) throw new ModelError('required', `${path}.inside_solar_absorptance`)
        if (ib == null) throw new ModelError('required', `${path}.inside_solar_absorptance_b`)
        elements.push(innerElement({ id: s.id, area_m2: s.area_m2, tilt_deg: s.tilt_deg, layers: b.layers ?? [], path }))
        kinds.push(s.kind); zoneA.push(za); zoneB.push(zbZone); insideAlpha.push(ia); insideAlphaB.push(ib)
        absorbed.push(new Float64Array(H))
        if ((s.kind === 'floor' || s.kind === 'ceiling') && zbZone !== za) { Z.sharedSlabs++; zones[zbZone].sharedSlabs++ }
        continue
      }
      Z.envelopeArea += s.area_m2
      const solar = () => {
        if (s.tilt_deg > 90 + 1e-9) return new Float64Array(H)  // faces down: no sun reaches it in this model
        return sunOn(s.azimuth_deg ?? 0, s.tilt_deg).total
      }
      if (s.kind === 'glazing') {
        if (s.zone_b !== 'outside') throw new ModelError('glazing must face outside', `${path}.zone_b`)
        const pub = num(b.u_value_W_per_m2K)
        const u = num(ref.u_value_override) ?? pub
        if (u == null) throw new ModelError('glazing needs a U (override or library u_value_W_per_m2K)', `${path}.construction_ref`)
        const g = num(ref.g_value_override) ?? num(s.g_value) ?? num(b.g_value)
        if (g == null) throw new ModelError('glazing needs a g-value (override, surface or library)', `${path}.g_value`)
        const ff = s.frame_fraction
        if (ff == null) throw new ModelError('required', `${path}.frame_fraction`)
        const facade = s.facade
        const hasShading = !!(s.shading?.overhang?.depth_m || s.shading?.fins?.left_depth_m || s.shading?.fins?.right_depth_m)
        if (hasShading && facade == null) throw new ModelError('shading needs the facade label', `${path}.facade`)
        const sf = facade ? shadingFactor(facade, s.shading) : 1
        const optical = options.glazing_solar === 'optical'
        if (options.glazing_solar != null && options.glazing_solar !== 'g_value' && !optical) throw new ModelError("'g_value' or 'optical'", 'options.glazing_solar')
        const op = optical ? simpleGlazingOptics(u, g, path) : null
        const ang = op ? simpleGlazingAngular(u, g, op, path) : null
        const fw = K.glazing_angle_factor
        insideAlpha.push(null); insideAlphaB.push(null)
        elements.push(windowElement({
          id: s.id, area_m2: s.area_m2, tilt_deg: s.tilt_deg, u, emissivity: s.thermal_emissivity, path,
          // Solar falling on the window from inside is diffuse: it leaves at the diffuse transmittance and the glass
          // absorbs its diffuse absorptance; the frame share absorbs all of it.
          optics: ang ? { interior_transmitted: (1 - ff) * ang.t_dif, interior_absorbed: (1 - ff) * ang.a_dif + ff } : null,
        }))
        kinds.push(s.kind); zoneA.push(za); zoneB.push(null)
        const a = new Float64Array(H)
        absorbed.push(a)
        const sun = s.tilt_deg > 90 + 1e-9 ? null : sunOn(s.azimuth_deg ?? 0, s.tilt_deg)
        const w = new Float64Array(H)
        if (sun && ang) {
          // Optical: the beam at its own angle of incidence, sky and ground diffuse at the diffuse values (no F_W).
          // Per m² of glass, once per orientation, U and g.
          const ok = `${s.azimuth_deg ?? 0}|${s.tilt_deg}|${u}|${g}`
          let o = opticalCache.get(ok)
          if (!o) {
            o = { t: new Float64Array(H), beam: new Float64Array(H), a: new Float64Array(H) }
            for (let h = 0; h < H; h++) {
              const dif = sun.diffuse[h] + sun.reflected[h]
              let tb = 0, ab = 0
              if (sun.direct[h] > 0) { const p = ang.at(sun.cos_incidence[h]); tb = sun.direct[h] * p.t; ab = sun.direct[h] * (1 - p.t - p.r) }
              o.t[h] = tb + dif * ang.t_dif; o.beam[h] = tb; o.a[h] = ab + dif * ang.a_dif
            }
            opticalCache.set(ok, o)
          }
          const share = (1 - ff) * sf
          for (let h = 0; h < H; h++) {
            w[h] = o.t[h] * share * s.area_m2
            Z.solarTransmitted[h] += w[h]
            if (sp?.beam_on_floor) Z.solarBeam[h] += o.beam[h] * share * s.area_m2
            // Absorbed in the pane, per m² of window: the glass share of the opening only (the frame takes no solar here).
            a[h] = o.a[h] * share
          }
        } else if (sun) {
          const f = g * fw * (1 - ff) * sf * s.area_m2
          for (let h = 0; h < H; h++) { w[h] = sun.total[h] * f; Z.solarTransmitted[h] += w[h] }
          if (sp?.beam_on_floor) for (let h = 0; h < H; h++) Z.solarBeam[h] += Math.min(sun.direct[h] * f, w[h])
        }
        Z.transmittedBySurface.push({ id: s.id, w })
        Z.glazingInfo.push({ surface_id: s.id, g_value: g, frame_fraction: ff, shading_factor: sf })
        Z.glazingAreas.push(s.area_m2)
        Z.glazingGroups.push(`${facade ?? ''}|${s.azimuth_deg ?? ''}|${s.tilt_deg}`)
        continue
      }
      const outside = (s.kind === 'wall' || s.kind === 'roof' || s.kind === 'floor') && s.zone_b === 'outside'
      const ground = s.kind === 'ground' && s.zone_b === 'ground'
      if (!outside && !ground) throw new ModelError(`a ${s.kind} facing "${s.zone_b}" needs another zone`, path)
      if (s.kind === 'roof') Z.hasRoof = true
      if (ground) Z.hasGround = true
      const stated = num(ref.u_value_override) ?? num((b as any).u_value_override) ?? num(b.u_value_W_per_m2K)
      const ia = s.inside_solar_absorptance
      if (ia == null) throw new ModelError('required', `${path}.inside_solar_absorptance`)
      insideAlpha.push(ia); insideAlphaB.push(null)
      elements.push(opaqueElement({
        id: s.id, area_m2: s.area_m2, tilt_deg: s.tilt_deg, boundary: ground ? 'ground' : 'outside',
        layers: b.layers ?? [], stated_u: stated, emissivity: ground ? null : s.thermal_emissivity, path,
      }))
      kinds.push(s.kind); zoneA.push(za); zoneB.push(null)
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
        Z.vents.push({ ...v, m3s_per_ms: ventCoefficient(v, doc.building.site.exposure, p) })
      })
    }
  })
  return { elements, kinds, zoneA, zoneB, insideAlpha, insideAlphaB, absorbed, zones }
}

/** One zone's run in a common shape, from either solver. */
interface Solved {
  heating_w: Float64Array; cooling_w: Float64Array
  theta_air: Float64Array; theta_op: Float64Array; theta_mrt: Float64Array
  bridging_w: Float64Array; ventilation_w: Float64Array; solar_lost_w: Float64Array; other_gains_w: Float64Array; storage_w: Float64Array
  closure_wh: Float64Array
  /** Heat into the zone from the others per hour, W (zeros on Engine 1's solver: one zone). */
  interzone_w: Float64Array
  /** Per element of the model: its outside terms over the run, kWh (null when not this zone's). */
  element: (k: number) => { boundary_kwh: number; solar_absorbed_kwh: number; sky_kwh: number } | null
  /** Per element: heat into this zone across it from another zone over the run, kWh (null when not shared by this zone and another). */
  interzone: (k: number) => number | null
}

/**
 * runModel: a model document and an EPW in, every zone's hourly temperatures and demand out (Brief 104 Part 3,
 * decision 5). A document with one zone and no element inside it runs on Engine 1's solver (runZone), so every
 * Brief 103 number is unchanged; anything else runs on the network solver (runNetwork). Both take their elements from
 * the same builder and give their results through the same breakdown.
 */
export function runModel(doc: ModelDocument, weather: Weather, library: Record<string, ConstructionBody>, options: RunOptions): ModelResults {
  const t0 = now()
  const H = weather.hours.count
  const built = buildElements(doc, weather, library, options)
  const { elements, zoneA, zoneB, insideAlpha, insideAlphaB, absorbed } = built
  const sp = options.surface_physics ?? null
  const Zn = doc.zones.length
  // Sub-hourly steps and TARP convection run on the network solver (one zone is a network of one: multizone.test (c)).
  const network = Zn > 1 || elements.some((e) => e.boundary === 'zone') || (options.time_step?.steps_per_hour ?? 1) > 1
    || options.surface_physics?.inside_convection === 'tarp'

  // The window junction over several zones: 4√A per facade (all its glazing, every zone), shared out by area. On one
  // zone with one glazing surface per facade this is Engine 1's 4√A per surface; cutting a facade into storeys does
  // not change the building's window perimeter.
  const facadeArea = new Map<string, number>()
  for (const Z of built.zones) Z.glazingGroups.forEach((g, j) => facadeArea.set(g, (facadeArea.get(g) ?? 0) + Z.glazingAreas[j]))
  const windowPerimeter = (Z: ZoneBuild) => Z.glazingGroups.reduce((s, g, j) => {
    const A = facadeArea.get(g)!, a = Z.glazingAreas[j]
    return s + (A > 0 && a > 0 ? 4 * Math.sqrt(A) * (a / A) : 0)
  }, 0)

  // Mechanical and natural ventilation per zone (Brief 105 Part 3).
  let mech: ZoneVentilation[][] = doc.zones.map(() => [])
  if (options.ventilation === 'document') {
    try { mech = zoneVentilation(doc, weather.hours) } catch (e) {
      if (e instanceof VentilationError) throw new ModelError(e.message.slice(e.path.length + 2), e.path)
      throw e
    }
  } else if (options.ventilation != null && options.ventilation !== 'none') {
    throw new ModelError(`unknown value ${JSON.stringify(options.ventilation)} ('none' or 'document')`, 'options.ventilation')
  }

  // Air, bridging and ground, per zone.
  let tg = 0
  for (let h = 0; h < H; h++) tg += weather.hours.dry_bulb[h]
  tg /= H  // building.site.ground.method === 'annual_mean_outdoor' (the only method the schema allows)
  const air = doc.zones.map((zone, zi) => {
    const Z = built.zones[zi]
    const path = `zones[${zi}]`
    const volume = zone.area_m2 * zone.height_m
    const inf = infiltration({ q50: zone.infiltration_q50, ach: zone.infiltration_ach, envelope_area_m2: Z.envelopeArea, volume_m3: volume, path })
    const ventH = ventConductance(Z.vents.map((v) => v.m3s_per_ms), weather.hours.wind_speed, H)
    const Hve = new Float64Array(H)
    for (let h = 0; h < H; h++) {
      let m = 0
      for (const v of mech[zi]) m += v.h_w_per_k[h]
      Hve[h] = inf.h_w_per_k + ventH[h] + m
    }
    // Σ U·A of the zone's envelope (the legacy α bridging mode only): elements facing outside or the ground.
    const areaUA = elements.reduce((s, e, k) => s + (zoneA[k] === zi && e.boundary !== 'zone' ? e.u_w_per_m2k * e.area_m2 : 0), 0)
    const bridging = computeBridging({
      tb: doc.building.thermal_bridging, polygon: zone.polygon, storeys: zone.storeys, storey_height_m: zone.height_m,
      glazing_areas_m2: Z.glazingAreas, area_ua_w_per_k: areaUA,
      ...(network ? { zone_share: { has_roof: Z.hasRoof, has_ground: Z.hasGround, shared_slabs: Z.sharedSlabs, window_perimeter_m: windowPerimeter(Z) } } : {}),
    })
    return { volume, inf, ventH, Hve, bridging }
  })

  // Internal gains per zone (Brief 105 Part 2).
  let gains: (ZoneGains | null)[] = doc.zones.map(() => null)
  if (options.internal_gains === 'profiles') {
    if (options.other_gains) throw new ModelError('give internal gains from the document or reference-case other gains, not both', 'options.other_gains')
    try { gains = zoneGains(doc, weather.hours) } catch (e) {
      if (e instanceof GainsError) throw new ModelError(e.message.slice(e.path.length + 2), e.path)
      throw e
    }
  } else if (options.internal_gains != null && options.internal_gains !== 'none') {
    throw new ModelError(`unknown value ${JSON.stringify(options.internal_gains)} ('none' or 'profiles')`, 'options.internal_gains')
  }
  // A setback (a lower heating setpoint outside stated hours) is not modelled until Brief 109: refused, not ignored.
  doc.zones.forEach((z, zi) => {
    if (z.setpoints.setback_c != null) throw new ModelError('a heating setback is not modelled yet (Brief 109)', `zones[${zi}].setpoints.setback_c`)
    if (z.setpoints.hours_ref != null) throw new ModelError('setpoint hours are not modelled yet (Brief 109)', `zones[${zi}].setpoints.hours_ref`)
  })
  // Emitters per zone (Brief 108): a zone that states them is limited to their output, and their radiant share sets
  // how heating reaches the room. A zone that states none is not limited, as before.
  let emit: (ZoneEmitters | null)[]
  try { emit = zoneEmitters(doc) } catch (e) {
    if (e instanceof EmitterError) throw new ModelError(e.message.slice(e.path.length + 2), e.path)
    throw e
  }
  const capOf = (zi: number) => (options.emitter_limit === 'none' ? null : emit[zi]?.cap_w ?? null)
  const hcfHeatOf = (zi: number) => (emit[zi] ? 1 - emit[zi]!.radiant_fraction : null)
  const gainsIn = (zi: number) => {
    const g = gains[zi]
    return g ? { w: g.total_w, convective_fraction: g.convective_fraction } : null
  }

  const kwhOf = (x: ArrayLike<number>) => { let s = 0; for (let h = 0; h < H; h++) s += x[h]; return s / 1000 }
  let solved: Solved[]
  let solver: ModelResults['solver']
  if (!network) {
    const zone = doc.zones[0], Z = built.zones[0], a = air[0]
    const run = runZone({
      elements, air_capacity_j_per_k: K.rho_c_air * a.volume + zone.internal_heat_capacity_j_per_k_m2 * zone.area_m2,
      bridging_w_per_k: a.bridging.total_w_per_k, hours: H, theta_e: weather.hours.dry_bulb, theta_ground: tg,
      ventilation_w_per_k: a.Hve, solar_absorbed_w_per_m2: absorbed, solar_transmitted_w: Z.solarTransmitted,
      inside_solar_absorptance: insideAlpha, solar_convective_fraction: options.solar_convective_fraction,
      other_gains: options.other_gains ?? gainsIn(0), setpoints: { heat_c: zone.setpoints.heat_c, cool_c: zone.setpoints.cool_c },
      control: options.control, hc_convective_fraction: options.hc_convective_fraction, initial_c: zone.setpoints.heat_c ?? weather.hours.dry_bulb[0],
      heating_cap_w: capOf(0), heating_convective_fraction: hcfHeatOf(0),
      warmup_days: options.warmup_days,
      h_ce_w_per_m2k: sp?.outside_convection === 'wind' ? Float64Array.from(weather.hours.wind_speed, (v) => K.h_ce_wind_a + K.h_ce_wind_b * Math.max(0, v)) : null,
      inside_convection: (sp?.inside_convection ?? 'by_tilt') as 'by_tilt' | 'by_heat_flow',
      solar_beam_w: sp?.beam_on_floor ? Z.solarBeam : null,
    })
    const T = run.terms
    solved = [{
      heating_w: run.heating_w, cooling_w: run.cooling_w, theta_air: run.theta_air, theta_op: run.theta_op, theta_mrt: run.theta_mrt,
      bridging_w: T.bridging_w, ventilation_w: T.ventilation_w, solar_lost_w: T.solar_lost_w, other_gains_w: T.other_gains_w, storage_w: T.storage_w,
      closure_wh: run.closure_wh, interzone_w: new Float64Array(H),
      element: (k) => ({ boundary_kwh: kwhOf(T.boundary_w[k]), solar_absorbed_kwh: kwhOf(T.solar_absorbed_w[k]), sky_kwh: kwhOf(T.sky_w[k]) }),
      interzone: () => null,
    }]
    solver = { nodes: run.nodes, active_set: null }
  } else {
    // The surface-coefficient options that change hour by hour are Engine 1's only, for now (decision 5 keeps one
    // factorisation per run in the network); refused rather than ignored.
    if (sp?.outside_convection === 'wind') throw new ModelError("wind-driven outside convection runs on one zone only", 'options.surface_physics.outside_convection')
    if (sp?.inside_convection === 'by_heat_flow') throw new ModelError("inside convection by heat flow runs on one zone only", 'options.surface_physics.inside_convection')
    if (options.other_gains && Zn > 1) throw new ModelError('other gains are a one-zone reference-case input', 'options.other_gains')
    const run = runNetwork({
      zones: doc.zones.map((zone, zi) => ({
        air_capacity_j_per_k: K.rho_c_air * air[zi].volume + zone.internal_heat_capacity_j_per_k_m2 * zone.area_m2,
        bridging_w_per_k: air[zi].bridging.total_w_per_k, ventilation_w_per_k: air[zi].Hve,
        solar_transmitted_w: built.zones[zi].solarTransmitted, solar_beam_w: sp?.beam_on_floor ? built.zones[zi].solarBeam : null,
        other_gains: options.other_gains ?? gainsIn(zi), setpoints: { heat_c: zone.setpoints.heat_c, cool_c: zone.setpoints.cool_c },
        initial_c: zone.setpoints.heat_c ?? weather.hours.dry_bulb[0],
        heating_cap_w: capOf(zi), heating_convective_fraction: hcfHeatOf(zi),
      })),
      elements: elements.map((element, k) => ({
        element, zone_a: zoneA[k], zone_b: zoneB[k], solar_absorbed_w_per_m2: absorbed[k],
        inside_solar_absorptance: insideAlpha[k], inside_solar_absorptance_b: insideAlphaB[k],
      })),
      hours: H, theta_e: weather.hours.dry_bulb, theta_ground: tg, control: options.control,
      hc_convective_fraction: options.hc_convective_fraction, solar_convective_fraction: options.solar_convective_fraction,
      warmup_days: options.warmup_days,
      steps_per_hour: options.time_step?.steps_per_hour, theta_e_between: options.time_step?.theta_e_between,
      inside_convection: sp?.inside_convection === 'tarp' ? 'tarp' : 'fixed',
    })
    solved = run.zones.map((z, zi) => ({
      heating_w: z.heating_w, cooling_w: z.cooling_w, theta_air: z.theta_air, theta_op: z.theta_op, theta_mrt: z.theta_mrt,
      bridging_w: z.terms.bridging_w, ventilation_w: z.terms.ventilation_w, solar_lost_w: z.terms.solar_lost_w,
      other_gains_w: z.terms.other_gains_w, storage_w: z.terms.storage_w, closure_wh: z.closure_wh, interzone_w: z.terms.interzone_w,
      // The network sums the hours in the same order as kwhOf, so the values are the same sums.
      element: (k) => {
        if (zoneA[k] !== zi || elements[k].boundary === 'zone') return null
        const t = run.element_terms[k]
        return { boundary_kwh: t.boundary_wh / 1000, solar_absorbed_kwh: t.solar_absorbed_wh / 1000, sky_kwh: t.sky_wh / 1000 }
      },
      interzone: (k) => {
        const q = run.element_interzone_wh[k]
        if (q == null || zoneA[k] === zoneB[k]) return null
        if (zoneA[k] === zi) return q / 1000
        if (zoneB[k] === zi) return -q / 1000
        return null
      },
    }))
    solver = { nodes: run.nodes, active_set: run.active_set }
  }

  const run_ms = now() - t0
  const zones = doc.zones.map((zone, zi) => {
    const Z = built.zones[zi], a = air[zi], run = solved[zi]
    // Breakdown: annual kWh per term (Rule 9). Ventilation is split into infiltration and vents by their conductances.
    const kwh = (x: ArrayLike<number>) => { let s = 0; for (let h = 0; h < H; h++) s += x[h]; return s / 1000 }
    const lines: BreakdownLine[] = []
    // Mechanical ventilation shares it too, one line per entry (Brief 105 Part 3).
    let infW = 0, ventW = 0
    const mechW = mech[zi].map(() => 0)
    for (let h = 0; h < H; h++) {
      const v = run.ventilation_w[h], tot = a.Hve[h]
      if (tot > 0) {
        infW += (v * a.inf.h_w_per_k) / tot; ventW += (v * a.ventH[h]) / tot
        mech[zi].forEach((m, j) => { mechW[j] += (v * m.h_w_per_k[h]) / tot })
      }
    }
    lines.push({ term: 'heating', surface_id: null, kwh: kwh(run.heating_w) })
    lines.push({ term: 'cooling', surface_id: null, kwh: -kwh(run.cooling_w) })
    const mine: number[] = []
    elements.forEach((e, k) => {
      if (zoneA[k] === zi || zoneB[k] === zi) mine.push(k)
      const et = run.element(k)
      if (et) {
        lines.push({ term: 'conduction', surface_id: e.id, kwh: et.boundary_kwh })
        if (e.kind === 'opaque' && e.boundary === 'outside') lines.push({ term: 'opaque_solar_absorbed', surface_id: e.id, kwh: et.solar_absorbed_kwh })
        if (e.kind === 'window' && e.absorbed_node != null) lines.push({ term: 'glazing_solar_absorbed', surface_id: e.id, kwh: et.solar_absorbed_kwh })
        if (e.f_sky > 0) lines.push({ term: 'sky_longwave', surface_id: e.id, kwh: et.sky_kwh })
      }
      const iz = run.interzone(k)
      if (iz != null) lines.push({ term: 'interzone', surface_id: e.id, kwh: iz })
    })
    lines.push({ term: 'bridging', surface_id: null, kwh: kwh(run.bridging_w) })
    lines.push({ term: 'infiltration', surface_id: null, kwh: infW / 1000 })
    lines.push({ term: 'permanent_vents', surface_id: null, kwh: ventW / 1000 })
    mech[zi].forEach((m, j) => lines.push({ term: 'mechanical_ventilation', surface_id: null, ventilation_id: m.id, kwh: mechW[j] / 1000 }))
    for (const t of Z.transmittedBySurface) lines.push({ term: 'solar_transmitted', surface_id: t.id, kwh: kwh(t.w) })
    if (options.glazing_solar === 'optical') lines.push({ term: 'solar_lost_through_glazing', surface_id: null, kwh: kwh(run.solar_lost_w) })
    if (options.other_gains) lines.push({ term: 'other_gains', surface_id: null, kwh: kwh(run.other_gains_w) })
    // One line per gain profile (Rule 9): their sum is the gain the solver took (the closure checks the integrand).
    for (const g of gains[zi]?.gains ?? []) lines.push({ term: `${g.kind}_gains`, surface_id: null, profile_id: g.profile_id, kwh: kwh(g.w) })
    lines.push({ term: 'storage', surface_id: null, kwh: -kwh(run.storage_w) })

    let mn = Infinity, mx = -Infinity, mean = 0, maxClosure = 0
    for (let h = 0; h < H; h++) {
      const t = run.theta_air[h]; mn = Math.min(mn, t); mx = Math.max(mx, t); mean += t / H
      maxClosure = Math.max(maxClosure, run.closure_wh[h])
    }
    // Brief 108: hours the control temperature is more than UNMET_K below the heating setpoint, and hours at the cap.
    const ctlT = options.control === 'operative' ? run.theta_op : run.theta_air
    const hsp = zone.setpoints.heat_c
    let unmet = 0, minCtl = Infinity, atCap = 0
    const em = emit[zi]
    for (let h = 0; h < H; h++) {
      minCtl = Math.min(minCtl, ctlT[h])
      if (hsp != null && ctlT[h] < hsp - UNMET_K) unmet++
      if (em && run.heating_w[h] >= em.cap_w * (1 - 1e-9) && (em.cap_w > 0 || (hsp != null && ctlT[h] < hsp - 1e-6))) atCap++
    }
    let closure
    try { closure = checkClosure(lines, maxClosure) } catch (e) {
      if (e instanceof ModelError && Zn > 1) throw new ModelError(e.message, `zones[${zi}].${e.path}`)
      throw e
    }
    const r: ZoneResults = {
      engine: network ? 'thermal-2' : 'thermal-1', zone_id: zone.id, constants: K,
      conductances: {
        elements: mine.map((k) => ({ surface_id: elements[k].id, kind: built.kinds[k], area_m2: elements[k].area_m2, u_w_per_m2k: elements[k].u_w_per_m2k, h_w_per_k: elements[k].u_w_per_m2k * elements[k].area_m2 })),
        glazing: Z.glazingInfo, infiltration: a.inf,
        vents: Z.vents.map((v) => ({ surface_id: v.surface_id, area_m2: v.area_m2, cd: v.cd, flow_mode: v.flow_mode, m3s_per_ms: v.m3s_per_ms })),
        bridging: a.bridging,
      },
      hourly: { theta_air_c: run.theta_air, theta_operative_c: run.theta_op, theta_mean_radiant_c: run.theta_mrt, heating_w: run.heating_w, cooling_w: run.cooling_w, interzone_w: run.interzone_w },
      annual: {
        heating_kwh: kwh(run.heating_w), cooling_kwh: kwh(run.cooling_w),
        peak_heating_w: Math.max(...run.heating_w), peak_cooling_w: Math.max(...run.cooling_w),
        theta_air_c: { min: mn, max: mx, mean },
        unmet_heating_hours: hsp == null ? null : unmet, min_control_c: minCtl,
      },
      emitters: em ? { cap_w: em.cap_w, radiant_fraction: em.radiant_fraction, hours_at_cap: atCap, emitters: em.emitters } : null,
      breakdown: lines,
      closure,
      run_ms,
    }
    return r
  })
  return { engine: network ? 'thermal-2' : 'thermal-1', zones, solver, run_ms }
}

/** One zone's results (Engine 1's entry point, kept): runModel on a one-zone document. */
export function runZoneModel(doc: ModelDocument, weather: Weather, library: Record<string, ConstructionBody>, options: RunOptions): ZoneResults {
  if (doc.zones.length !== 1) throw new ModelError(`runZoneModel runs one zone; the document has ${doc.zones.length} (use runModel)`, 'zones')
  return runModel(doc, weather, library, options).zones[0]
}

/** Brief 108: an hour is unmet when the control temperature is more than this below the heating setpoint, K. */
export const UNMET_K = 0.5

/** Largest hourly residual a run may have, Wh: |Σ terms − demand − Δstorage| (brief: "fails loudly"). */
export const CLOSURE_MAX_WH = 1

/**
 * Refuses a result whose balance does not close (CLAUDE.md Rule 9, integrand against display). Two checks:
 * - every hour, the solver's own terms sum to the storage change within CLOSURE_MAX_WH;
 * - over the year, the displayed breakdown lines (demand included) sum to zero within rounding, so a term computed
 *   but missing from the breakdown, or shown but not computed, fails here rather than passing silently.
 */
export function checkClosure(lines: readonly BreakdownLine[], maxHourlyWh: number): { max_wh: number; sum_kwh: number } {
  if (!(maxHourlyWh <= CLOSURE_MAX_WH)) throw new ModelError(`the hourly balance misses by ${maxHourlyWh} Wh (limit ${CLOSURE_MAX_WH})`, 'closure.max_wh')
  let sum = 0, gross = 0
  for (const l of lines) { sum += l.kwh; gross += Math.abs(l.kwh) }
  const tol = 1e-9 * gross + 1e-3
  if (!(Math.abs(sum) <= tol)) throw new ModelError(`the breakdown lines sum to ${sum} kWh, not zero (tolerance ${tol}): a term is missing from the display or from the balance`, 'closure.sum_kwh')
  return { max_wh: maxHourlyWh, sum_kwh: sum }
}
