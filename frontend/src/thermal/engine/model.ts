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
import { AIR_LINES, AirflowError, airWeather, buildAirModels, siteTerrain, zoneAirStep, type ZoneAirModel } from './airflow'
import { outsideFace, outsideFaceZ, rainInputs, skyInfrared, windowLayout } from './outsideConvection'
import { ScheduleError, scheduleFractions, temperatureHours } from './pumps'
import { computeBridging } from './bridging'
import { ENGINE_CONSTANTS as K } from './constants'
import { ElementError, innerElement, layerFaceNode, opaqueElement, windowElement, type ConstructionBody, type Element, type Layer } from './elements'
import { runNetwork } from './network'
import type { BreakdownLine, ModelResults, PlantResults, ZoneResults } from './results'
import { shadingFactor } from './shading'
import { solarOnSurface, type SolarOptions } from './solar'
import { simpleGlazingAngular, simpleGlazingOptics } from './glazing'
import type { Weather } from './types'
import { runZone } from './zone'
import type { ModelDocument, Surface } from '../schema/model'
import { calendar, GainsError, zoneGains, type ZoneGains } from './gains'
import { VentilationError, zoneVentilation, type ZoneVentilation } from './ventilation'
import { EmitterError, zoneCooling, zoneEmitters, type ZoneCooling, type ZoneEmitters } from './emitters'
import { zoneHotWater } from './hotWater'
import type { NetworkPlant } from './network'

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
   * Brief 108 review F1 (Linzie, 15 Nov: "work it out each hour"). 'room' (default): each hour's limit is the
   * emitters' output at the room's control temperature at the end of the hour before, so a colder room draws more.
   * 'setpoint': the output with the room at its setpoint, fixed all year, as EnergyPlus's LimitCapacity takes it (the
   * Part 3 referee runs on this).
   */
  emitter_rating?: 'room' | 'setpoint'
  /**
   * Surface physics beyond ISO 52016-1's fixed simplifications (Brief 103 Part 6b). Absent: the simplifications
   * (outside h_ce 20, inside h_ci by tilt, transmitted solar over every inside surface by area).
   * - outside_convection 'wind': h_ce = 4 + 4·v (ISO 6946:2017 Annex C) from the weather's hourly wind speed.
   * - outside_convection 'doe2' (Brief 125, Linzie 17 Nov 23:50): EnergyPlus's own outside film, DOE-2 from the wind at
   *   each face's height and the site's terrain, windward or leeward, and the face's temperature; wet faces in rain
   *   (outsideConvection.ts). Runs on the network solver, one zone included.
   * - inside_convection 'by_heat_flow': ISO 52016-1 Table 25 by the actual direction of heat flow (previous hour).
   * - beam_on_floor: the beam part of transmitted solar lands on the floor-facing inside surfaces, by area.
   * - inside_convection 'tarp' (Brief 105 Part 6): Walton's natural-convection correlations, EnergyPlus's TARP inside
   *   algorithm, from each face's temperature difference with the air at the step before (network.ts). Runs on the
   *   network solver, one zone included. Brief 126: a window's inside face takes ISO 15099, as EnergyPlus's TARP does.
   * - outside_longwave 'energyplus' (Brief 126, Linzie 18 Nov 10:57): each outside face's long-wave as EnergyPlus,
   *   ground, sky and air by view, the sky from the weather file's infrared (outsideConvection.ts). Needs 'doe2'.
   *   Absent or 'iso': ISO 52016-1's h_re to the air and a sky 11 K below it.
   * - window 'energyplus' (Brief 126): a window as EnergyPlus's Simple Window Model takes it: the glass layer's
   *   resistance from the stated U less EnergyPlus's rating films, and emissivity 0.84 on the glass. Absent or 'iso':
   *   the stated U less ISO 6946's films, and the surface's stated emissivity.
   */
  surface_physics?: {
    outside_convection: 'fixed' | 'wind' | 'doe2'; inside_convection: 'by_tilt' | 'by_heat_flow' | 'tarp'; beam_on_floor: boolean
    outside_longwave?: 'iso' | 'energyplus'; window?: 'iso' | 'energyplus'
  }
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
  /**
   * Brief 126: the heat outdoor air carries in. Absent or 'fixed': ENGINE_CONSTANTS.rho_c_air (0.33 Wh/m³K) all year.
   * 'outdoor': ρ·c_p of the outdoor air each step, as EnergyPlus takes it for infiltration and ventilation (network.ts
   * outdoor_air). Runs on the network solver.
   */
  air_heat_capacity?: 'fixed' | 'outdoor'
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
  const surfaceOf: number[] = []  // per element: its surface's index in doc.surfaces (Brief 125)
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
        elements.push(innerElement({ id: s.id, area_m2: s.area_m2, tilt_deg: s.tilt_deg, layers: surfaceLayers(s, library, path), path }))
        kinds.push(s.kind); surfaceOf.push(i); zoneA.push(za); zoneB.push(zbZone); insideAlpha.push(ia); insideAlphaB.push(ib)
        absorbed.push(new Float64Array(H))
        // Brief 123 P4: a ceiling to an unconditioned loft is not a slab between storeys (its junction is the roof's, at the
        // loft's eaves), and its area is in the room's envelope for leakage: the air barrier is at the ceiling (P4.2).
        const loftA = doc.zones[za].conditioning === 'unconditioned', loftB = doc.zones[zbZone].conditioning === 'unconditioned'
        if (loftA !== loftB) zones[loftA ? zbZone : za].envelopeArea += s.area_m2
        else if ((s.kind === 'floor' || s.kind === 'ceiling') && zbZone !== za) { Z.sharedSlabs++; zones[zbZone].sharedSlabs++ }
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
          id: s.id, area_m2: s.area_m2, tilt_deg: s.tilt_deg, u, emissivity: s.thermal_emissivity, path, glass: sp?.window === 'energyplus' ? 'energyplus' : 'iso',
          // Solar falling on the window from inside is diffuse: it leaves at the diffuse transmittance and the glass
          // absorbs its diffuse absorptance; the frame share absorbs all of it.
          optics: ang ? { interior_transmitted: (1 - ff) * ang.t_dif, interior_absorbed: (1 - ff) * ang.a_dif + ff } : null,
        }))
        kinds.push(s.kind); surfaceOf.push(i); zoneA.push(za); zoneB.push(null)
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
        inside_finish: finishLayers(s.inside_finish, library, `${path}.inside_finish`),
      }))
      kinds.push(s.kind); surfaceOf.push(i); zoneA.push(za); zoneB.push(null)
      const a = new Float64Array(H)
      if (outside) {
        const alpha = s.solar_absorptance
        if (alpha == null) throw new ModelError('required', `${path}.solar_absorptance`)
        if (alpha > 0) { const I = solar(); for (let h = 0; h < H; h++) a[h] = alpha * I[h] }
      }
      absorbed.push(a)
      s.openings.forEach((o, j) => {
        // Brief 115: weather-driven air takes every vent and window itself (airflow.ts).
        if (doc.building.air.method === 'weather_driven') return
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
  return { elements, kinds, surfaceOf, zoneA, zoneB, insideAlpha, insideAlphaB, absorbed, zones }
}

/** One zone's run in a common shape, from either solver. */
interface Solved {
  /** Review F1: each hour's heating limit when it follows the room (absent otherwise). */
  heating_cap_w?: Float64Array
  heating_w: Float64Array; cooling_w: Float64Array
  theta_air: Float64Array; theta_op: Float64Array; theta_mrt: Float64Array
  bridging_w: Float64Array; ventilation_w: Float64Array; solar_lost_w: Float64Array; other_gains_w: Float64Array; storage_w: Float64Array
  closure_wh: Float64Array
  /** Brief 115: each weather-driven air line's heat, W (AIR_LINES order). */
  air_lines_w?: Float64Array[]
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
/** Brief 124 (D3): the layers of a finish named on a surface face, from the structure to the room, from the library given to the engine; none for null. */
export function finishLayers(ref: { key: string } | null | undefined, library: Record<string, ConstructionBody>, path: string): Layer[] {
  if (!ref) return []
  const b = library[ref.key]
  if (!b) throw new ModelError(`finish "${ref.key}" is not in the library given to the engine`, `${path}.key`)
  if (!b.layers?.length) throw new ModelError(`finish "${ref.key}" has no layers`, `${path}.key`)
  return b.layers
}

/**
 * Brief 124 (D3): a surface's whole layer stack, first layer first: zone_b's finish (turned room-first), the construction,
 * zone_a's finish.
 * For a surface facing outside or the ground there is no zone_b finish (the schema refuses one).
 */
export function surfaceLayers(s: Pick<Surface, 'construction_ref' | 'inside_finish' | 'inside_finish_b'>, library: Record<string, ConstructionBody>, path: string): Layer[] {
  const b = library[s.construction_ref.key]
  if (!b) throw new ModelError(`construction "${s.construction_ref.key}" is not in the library given to the engine`, `${path}.construction_ref.key`)
  return [...[...finishLayers(s.inside_finish_b, library, `${path}.inside_finish_b`)].reverse(), ...(b.layers ?? []), ...finishLayers(s.inside_finish, library, `${path}.inside_finish`)]
}

export function runModel(doc: ModelDocument, weather: Weather, library: Record<string, ConstructionBody>, options: RunOptions): ModelResults {
  const t0 = now()
  const H = weather.hours.count
  const built = buildElements(doc, weather, library, options)
  const { elements, zoneA, zoneB, insideAlpha, insideAlphaB, absorbed } = built
  const sp = options.surface_physics ?? null
  const Zn = doc.zones.length
  // Brief 120: each enabled heating or cooling system with a stated capacity limits its zones (decision 3: only where
  // stated). 'none' lifts it with the emitters' limits. A stated capacity of 0 or less is refused by name.
  const plantGroups = options.emitter_limit === 'none' ? [] : doc.system_groups.map((g, i) => ({ g, i }))
    .filter(({ g }) => g.enabled && (g.service === 'heating' || g.service === 'cooling') && g.capacity_kw != null)
  for (const { g, i } of plantGroups) if (!(g.capacity_kw! > 0)) throw new ModelError('must be above 0 (kW), or left empty for no limit', `system_groups[${i}].capacity_kw`)
  // Sub-hourly steps and TARP convection run on the network solver (one zone is a network of one: multizone.test (c)).
  // Underfloor heating in a floor (Brief 109) is Engine 2's: its heat enters a node inside the element. So are
  // system capacities (Brief 120): their limits are shared among zones within the step.
  // Brief 115: weather-driven air is worked out every step from the room's temperature, on the network solver.
  const weatherAir = doc.building.air.method === 'weather_driven'
  const network = weatherAir || plantGroups.length > 0 || Zn > 1 || elements.some((e) => e.boundary === 'zone') || (options.time_step?.steps_per_hour ?? 1) > 1
    || options.surface_physics?.inside_convection === 'tarp' || options.surface_physics?.outside_convection === 'doe2' || options.air_heat_capacity === 'outdoor' || doc.zones.some((z) => z.emitters.some((e) => e.kind === 'underfloor'))

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

  // Brief 115: weather-driven air, per zone (built before the conductances: a room with no outside wall keeps today's
  // leakage, review F4).
  let airModels: ZoneAirModel[] | null = null
  if (weatherAir) {
    try {
      airModels = buildAirModels(doc, built.zones.map((Z) => Z.envelopeArea), (ref, p) => scheduleFractions(doc, ref, weather.hours, p), (ref, p) => temperatureHours(doc, ref, weather.hours, p))
    } catch (e) {
      if (e instanceof AirflowError || e instanceof ScheduleError) throw new ModelError(e.message.slice(e.path.length + 2), e.path)
      throw e
    }
  }
  // Review F3/F4: an extract fan is in the room's air balance when the room has outside paths (leakage on its walls,
  // vents, windows); an inner room with none keeps today's leakage and its fan's own conductance, as before.
  const mevInBalance = doc.zones.map((_, zi) => !!airModels && airModels[zi].cracks.length + airModels[zi].vents.length + airModels[zi].windows.length > 0)
  // Air, bridging and ground, per zone.
  const tg = groundTemperature(weather)
  const air = doc.zones.map((zone, zi) => {
    const Z = built.zones[zi]
    const path = `zones[${zi}]`
    const volume = zone.area_m2 * zone.height_m
    // Brief 115: under weather-driven air, leakage and vents are worked out each step (airAt below), not here.
    const inf = weatherAir && !airModels![zi].fixed_leakage ? { source: 'q50' as const, ach: 0, h_w_per_k: 0 } : infiltration({ q50: zone.infiltration_q50, ach: zone.infiltration_ach, envelope_area_m2: Z.envelopeArea, volume_m3: volume, path })
    const ventH = ventConductance(Z.vents.map((v) => v.m3s_per_ms), weather.hours.wind_speed, H)
    const Hve = new Float64Array(H)
    for (let h = 0; h < H; h++) {
      let m = 0
      // Review F3: under weather-driven air an extract fan is in the pressure balance instead (airAt), not here.
      for (const v of mech[zi]) if (!(mevInBalance[zi] && v.kind === 'mev')) m += v.h_w_per_k[h]
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

  // Brief 115: weather-driven air, per zone, and what it recorded each hour.
  const airInflow: Float64Array[] = [], airOpen: Float64Array[] = []
  let airAtOf: (zi: number) => ((h: number, room_c: number, te: number, out: Float64Array, w: number, frac: number) => void) | null = () => null
  if (weatherAir) {
    // Review F3: under weather-driven air an extract fan (MEV) is a fixed flow out of the room, in its pressure
    // balance; its air arrives through leakage, vents and windows (their lines), so its own conductance is not added
    // again. A 'natural' entry beside opening windows would count the windows' air twice: refused by name.
    doc.zones.forEach((z, zi) => {
      const mevs = mech[zi].filter((v) => v.kind === 'mev')
      if (mevs.length && mevInBalance[zi]) {
        const ex = new Float64Array(H)
        for (const v of mevs) for (let h = 0; h < H; h++) ex[h] += v.flow_m3s * v.running[h]
        airModels![zi].extract = ex
      }
      const nat = z.ventilation.findIndex((v) => v.enabled && v.kind === 'natural')
      if (nat >= 0 && airModels![zi].windows.length) throw new ModelError('the room\'s opening windows give its natural ventilation under weather-driven air; remove this entry', `zones[${zi}].ventilation[${nat}]`)
    })
    const wx = airWeather(weather.hours, weather.header.elevation)
    for (let zi = 0; zi < Zn; zi++) { airInflow.push(new Float64Array(H)); airOpen.push(new Float64Array(H)) }
    airAtOf = (zi) => {
      const m = airModels![zi]
      return (h, room, te, out, w, frac) => {
        const st = zoneAirStep(m, wx, h, room, te, out, frac)
        if (w > 0) { airInflow[zi][h] += w * st.m_in * 3600; airOpen[zi][h] += w * st.open_factor }
      }
    }
  }

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
  // Brief 120: the plants, with the hot water a heating system heats first (hotWater.ts, the one calculation).
  const zIdx = new Map(doc.zones.map((z, i) => [z.id, i]))
  const plants: (NetworkPlant & { id: string; hw_group: string | null; hw_frac: Float64Array | null })[] = plantGroups.map(({ g, i }) => {
    let reserved: Float64Array | null = null
    if (g.dhw_priority_group_id != null) {
      const d = doc.system_groups.find((x) => x.id === g.dhw_priority_group_id)!
      reserved = new Float64Array(H)
      if (d.enabled) {
        const a = zoneHotWater(doc, gains, H, weather.hours)
        if (!a.ok) throw new ModelError(`${a.issues[0].message} (hot water heated first by "${g.id}")`, a.issues[0].path)
        if (a.hw) for (const zid of d.zones) {
          const z = a.hw.zones[zIdx.get(zid)!]
          if (z) for (let h = 0; h < H; h++) reserved[h] += (d.share_pct / 100) * z.w[h]
        }
      }
      void i
    }
    // Review F6: hot water heated first takes at most the plant's capacity; above it, the taps get that hour's share
    // `hw_frac` (Systems serves only that, and the rest is shown short). The rooms then get nothing that hour.
    let hwFrac: Float64Array | null = null
    if (reserved) {
      const cap = g.capacity_kw! * 1000
      for (let h = 0; h < H; h++) if (reserved[h] > cap) { hwFrac ??= new Float64Array(H).fill(1); hwFrac[h] = cap / reserved[h]; reserved[h] = cap }
    }
    return { id: g.id, service: g.service as 'heating' | 'cooling', cap_w: g.capacity_kw! * 1000, zones: g.zones.map((z) => ({ zone: zIdx.get(z)!, share: g.share_pct / 100 })), reserved_w: reserved, flow: null, hw_group: g.dhw_priority_group_id ?? null, hw_frac: hwFrac }
  })
  // Review F1 (Linzie, 16 Nov 19:48): each zone's share of heating (cooling) on enabled systems with no capacity; they
  // top up a short plant's deficit in the zone.
  const freeShare = { heating: new Float64Array(doc.zones.length), cooling: new Float64Array(doc.zones.length) }
  for (const g of doc.system_groups) {
    if (!g.enabled || (g.service !== 'heating' && g.service !== 'cooling') || plants.some((p) => p.id === g.id)) continue
    for (const zid of g.zones) { const zi = zIdx.get(zid); if (zi != null) freeShare[g.service][zi] += g.share_pct / 100 }
  }
  // Brief 109: each zone's heating hours and setback, resolved into its hourly setpoints (null: one setpoint all year).
  const hoursOf = zoneSetpointHours(doc, weather.hours)
  // Brief 115 P1: a window that opens by temperature must open above the room's heating setpoint in every hour it may
  // open, or it would open while the room is being heated. Refused by name, not clamped.
  if (airModels) airModels.forEach((m, zi) => {
    const r = m.rule
    if (!m.windows.length || !r || r.rule !== 'temperature') return
    const sh = hoursOf[zi]?.hourly.heat_c ?? null, fixed = doc.zones[zi].setpoints.heat_c
    for (let h = 0; h < H; h++) {
      if (r.hours && !(r.hours[h] > 0)) continue
      const hc = sh ? sh[h] : fixed
      const above = r.open_above_h ? r.open_above_h[h] : (r.open_above_c as number)
      if (hc != null && Number.isFinite(hc) && !(above > hc)) {
        const ci = doc.controls.findIndex((c) => c.target.kind === 'window' && c.target.ref === doc.zones[zi].id)
        throw new ModelError(`the windows open above ${above} °C, not above the room's heating setpoint (${hc} °C at hour ${h}): they would open while it is heated`, `controls[${ci}].${r.open_above_h ? 'open_above_ref' : 'open_above_c'}`)
      }
    }
  })
  // Emitters per zone (Brief 108): a zone that states them is limited to their output, and their radiant share sets
  // how heating reaches the room. A zone that states none is not limited, as before.
  let emit: (ZoneEmitters | null)[]
  // Brief 119: a zone whose units state any cooling is limited to it; a zone none of whose units cool is not.
  let cool: (ZoneCooling | null)[]
  try { emit = zoneEmitters(doc); cool = zoneCooling(doc) } catch (e) {
    if (e instanceof EmitterError) throw new ModelError(e.message.slice(e.path.length + 2), e.path)
    throw e
  }
  // Brief 120 P2b: a heating plant whose every zone has wet emitters on it shares a shortfall through one lower flow
  // temperature (the emitters' own output at it), as a wet system does; otherwise in proportion to ask.
  plantGroups.forEach(({ g }, k) => {
    if (g.service !== 'heating' || g.design_flow_c == null) return
    const out = plants[k].zones.map(({ zone }) => {
      const em = emit[zone]
      if (!em || em.at_flow(0, g.design_flow_c!, g.id) == null) return null  // null: no wet emitter of this system in the zone
      return (room_c: number, flow_c: number) => em.at_flow(room_c, flow_c, g.id)!
    })
    if (out.every((f) => f != null)) plants[k].flow = { design_c: g.design_flow_c, out: out as ((r: number, f: number) => number)[] }
  })
  // Review F8: a mode parameter that is not one of its values is refused, never read as the default (CLAUDE.md lesson 11).
  if (options.emitter_limit != null && options.emitter_limit !== 'cap' && options.emitter_limit !== 'none') throw new ModelError(`unknown emitter_limit "${String(options.emitter_limit)}"`, 'options.emitter_limit')
  if (options.emitter_rating != null && options.emitter_rating !== 'room' && options.emitter_rating !== 'setpoint') throw new ModelError(`unknown emitter_rating "${String(options.emitter_rating)}"`, 'options.emitter_rating')
  const byRoom = options.emitter_rating !== 'setpoint'
  const limited = (zi: number) => options.emitter_limit !== 'none' && emit[zi] != null
  const capOf = (zi: number) => (limited(zi) && !byRoom ? emit[zi]!.cap_w : null)
  const capAtOf = (zi: number) => (limited(zi) && byRoom ? emit[zi]!.at : null)
  const coolCapOf = (zi: number) => (options.emitter_limit !== 'none' && cool[zi] != null ? cool[zi]!.cap_w : null)
  const hcfHeatOf = (zi: number) => (emit[zi] ? 1 - emit[zi]!.radiant_fraction : null)
  // Brief 109: where underfloor heating's heat enters its floor: the element, and the node at its layer's inside face.
  const sourceOf = (zi: number) => {
    const sl = emit[zi]?.slab
    if (!sl) return null
    const zone = doc.zones[zi], ej = zone.emitters.findIndex((e) => e.kind === 'underfloor')
    const p = `zones[${zi}].emitters[${ej}].source_layer_index`
    const k = elements.findIndex((e) => e.id === sl.surface_id)
    const s = doc.surfaces.find((x) => x.id === sl.surface_id)!
    const el = elements[k]
    if (el.kind !== 'opaque') throw new ModelError(`surface "${s.id}" is not an opaque floor`, `zones[${zi}].emitters[${ej}].source_surface_id`)
    let node: number
    // Brief 124: the layer index counts the construction's own layers; a finish on zone_b's face comes first in the stack.
    const offset = el.boundary === 'zone' ? finishLayers(s.inside_finish_b, library, p).length : 0
    try { node = layerFaceNode(surfaceLayers(s, library, p), el.boundary, sl.layer_index + offset, p) } catch (e) {
      if (e instanceof ElementError) throw new ModelError(e.message.slice(e.path.length + 2), p)
      throw e
    }
    if (el.boundary === 'zone') {
      // A floor between two zones: its layers run from zone_b's face to zone_a's, and each half's heat is its zone's.
      const mid = Math.floor((el.c.length - 2) / 2)
      const mine = s.zone_a === zone.id ? node > mid : node <= mid
      if (!mine) throw new ModelError(`layer ${sl.layer_index} is in the half of "${s.id}" nearer the other zone; underfloor heating's pipes must be in this zone's half`, p)
    }
    return { element: k, node, share: sl.share }
  }
  const gainsIn = (zi: number) => {
    const g = gains[zi]
    return g ? { w: g.total_w, convective_fraction: g.convective_fraction } : null
  }

  // Brief 125: each face to outside air as EnergyPlus's film needs it: its height (outsideFaceZ, the translator's too),
  // the site's terrain (siteTerrain, the translator's too), its azimuth and tilt; the weather's wind, humidity, rain.
  const outsideFilm = () => {
    const { terrain } = siteTerrain(doc.building.site)
    const wx = airWeather(weather.hours, weather.header.elevation)
    return {
      faces: elements.map((e, k) => {
        if (e.boundary !== 'outside') return null
        const s = doc.surfaces[built.surfaceOf[k]]
        // Brief 126: the emissivity the element was built with (a window under EnergyPlus's model: its 0.84).
        return outsideFace(outsideFaceZ(doc.zones[zoneA[k]], s.tilt_deg), terrain, s.azimuth_deg ?? 0, s.tilt_deg, e.kind === 'window', e.h_re / K.h_re_per_emissivity)
      }),
      weather: {
        wind_speed: weather.hours.wind_speed, wind_direction: weather.hours.wind_direction, w: wx.w, pressure: weather.hours.pressure, ...rainInputs(weather.hours),
        sky_ir: sp?.outside_longwave === 'energyplus' ? skyInfrared(weather.hours).ir : null,
      },
    }
  }
  // Brief 126: each window's glass height as the translator draws it (windowLayout, one read), for ISO 15099 inside.
  const surfLite = new Map(doc.surfaces.map((s) => [s.id, s]))
  const layouts = new Map<number, Map<string, { host: string; height_m: number }>>()
  const windowHeightOf = (k: number) => {
    const zi = zoneA[k], s = doc.surfaces[built.surfaceOf[k]]
    let l = layouts.get(zi)
    if (!l) { l = windowLayout(doc.zones[zi], surfLite); layouts.set(zi, l) }
    const got = l.get(s.id)
    if (!got) throw new ModelError('a window needs a wall or roof of its zone facing the same way to sit in', `surfaces[${built.surfaceOf[k]}]`)
    return got.height_m
  }
  const kwhOf = (x: ArrayLike<number>) => { let s = 0; for (let h = 0; h < H; h++) s += x[h]; return s / 1000 }
  let solved: Solved[]
  let solver: ModelResults['solver']
  let plantRun: ReturnType<typeof runNetwork>['plants'] = []
  let plantLimited: (Float64Array | null)[] = doc.zones.map(() => null)
  let ownLimited: (Float64Array | null)[] = doc.zones.map(() => null)
  if (!network) {
    const zone = doc.zones[0], Z = built.zones[0], a = air[0]
    const run = runZone({
      elements, air_capacity_j_per_k: K.rho_c_air * a.volume + zone.internal_heat_capacity_j_per_k_m2 * zone.area_m2,
      bridging_w_per_k: a.bridging.total_w_per_k, hours: H, theta_e: weather.hours.dry_bulb, theta_ground: tg,
      ventilation_w_per_k: a.Hve, solar_absorbed_w_per_m2: absorbed, solar_transmitted_w: Z.solarTransmitted,
      inside_solar_absorptance: insideAlpha, solar_convective_fraction: options.solar_convective_fraction,
      other_gains: options.other_gains ?? gainsIn(0), setpoints: { heat_c: zone.setpoints.heat_c, cool_c: zone.setpoints.cool_c }, setpoint_hours: hoursOf[0]?.hourly ?? null,
      control: options.control, hc_convective_fraction: options.hc_convective_fraction, initial_c: zone.setpoints.heat_c ?? weather.hours.dry_bulb[0],
      heating_cap_w: capOf(0), heating_cap_at: capAtOf(0), heating_convective_fraction: hcfHeatOf(0), cooling_cap_w: coolCapOf(0),
      warmup_days: options.warmup_days,
      h_ce_w_per_m2k: sp?.outside_convection === 'wind' ? Float64Array.from(weather.hours.wind_speed, (v) => K.h_ce_wind_a + K.h_ce_wind_b * Math.max(0, v)) : null,
      inside_convection: (sp?.inside_convection ?? 'by_tilt') as 'by_tilt' | 'by_heat_flow',
      solar_beam_w: sp?.beam_on_floor ? Z.solarBeam : null,
    })
    const T = run.terms
    solved = [{
      heating_cap_w: run.heating_cap_w,
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
    if (sp?.outside_longwave === 'energyplus' && sp.outside_convection !== 'doe2') throw new ModelError("EnergyPlus's outside long-wave goes with its outside film ('doe2')", 'options.surface_physics.outside_longwave')
    if (options.other_gains && Zn > 1) throw new ModelError('other gains are a one-zone reference-case input', 'options.other_gains')
    const run = runNetwork({
      zones: doc.zones.map((zone, zi) => ({
        air_capacity_j_per_k: K.rho_c_air * air[zi].volume + zone.internal_heat_capacity_j_per_k_m2 * zone.area_m2,
        bridging_w_per_k: air[zi].bridging.total_w_per_k, ventilation_w_per_k: air[zi].Hve,
        solar_transmitted_w: built.zones[zi].solarTransmitted, solar_beam_w: sp?.beam_on_floor ? built.zones[zi].solarBeam : null,
        other_gains: options.other_gains ?? gainsIn(zi), setpoints: { heat_c: zone.setpoints.heat_c, cool_c: zone.setpoints.cool_c }, setpoint_hours: hoursOf[zi]?.hourly ?? null,
        initial_c: zone.setpoints.heat_c ?? weather.hours.dry_bulb[0],
        heating_cap_w: capOf(zi), heating_cap_at: capAtOf(zi), heating_convective_fraction: hcfHeatOf(zi), cooling_cap_w: coolCapOf(zi),
        heating_source: sourceOf(zi),
        ...(weatherAir ? { air_at: airAtOf(zi), air_lines: AIR_LINES.length } : {}),
      })),
      elements: elements.map((element, k) => ({
        element, zone_a: zoneA[k], zone_b: zoneB[k], solar_absorbed_w_per_m2: absorbed[k],
        inside_solar_absorptance: insideAlpha[k], inside_solar_absorptance_b: insideAlphaB[k],
        window_height_m: element.kind === 'window' ? windowHeightOf(k) : null,
      })),
      hours: H, theta_e: weather.hours.dry_bulb, theta_ground: tg, control: options.control,
      hc_convective_fraction: options.hc_convective_fraction, solar_convective_fraction: options.solar_convective_fraction,
      warmup_days: options.warmup_days,
      steps_per_hour: options.time_step?.steps_per_hour, theta_e_between: options.time_step?.theta_e_between,
      inside_convection: sp?.inside_convection === 'tarp' ? 'tarp' : 'fixed',
      inside_air: sp?.inside_convection === 'tarp' ? { pressure: weather.hours.pressure, w: airWeather(weather.hours, weather.header.elevation).w } : null,
      outdoor_air: options.air_heat_capacity === 'outdoor' ? { pressure: weather.hours.pressure, w: airWeather(weather.hours, weather.header.elevation).w } : null,
      outside_convection: sp?.outside_convection === 'doe2' ? outsideFilm() : null,
      plants, plant_free_share: plants.length ? freeShare : null,
    })
    plantRun = run.plants
    plantLimited = run.zones.map((z) => z.plant_limited ?? null)
    ownLimited = run.zones.map((z) => z.own_limited ?? null)
    solved = run.zones.map((z, zi) => ({
      heating_cap_w: z.heating_cap_w,
      heating_w: z.heating_w, cooling_w: z.cooling_w, theta_air: z.theta_air, theta_op: z.theta_op, theta_mrt: z.theta_mrt,
      bridging_w: z.terms.bridging_w, ventilation_w: z.terms.ventilation_w, solar_lost_w: z.terms.solar_lost_w,
      other_gains_w: z.terms.other_gains_w, storage_w: z.terms.storage_w, closure_wh: z.closure_wh, interzone_w: z.terms.interzone_w,
      air_lines_w: z.terms.air_lines_w,
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
    const al = run.air_lines_w
    for (let h = 0; h < H; h++) {
      // Brief 115: weather-driven air reports its own lines; the rest of the ventilation is the mechanical entries'.
      let v = run.ventilation_w[h]
      if (al) for (const x of al) v -= x[h]
      const tot = a.Hve[h]
      if (tot > 0) {
        infW += (v * a.inf.h_w_per_k) / tot; ventW += (v * a.ventH[h]) / tot
        mech[zi].forEach((m, j) => { if (!(mevInBalance[zi] && m.kind === 'mev')) mechW[j] += (v * m.h_w_per_k[h]) / tot })
      }
    }
    if (al) { infW += kwh(al[0]) * 1000; ventW += kwh(al[1]) * 1000 }
    // Brief 123: an unheated loft has no heating or cooling line (nothing serves it), not a zero one.
    if (doc.zones[zi].conditioning !== 'unconditioned') {
      lines.push({ term: 'heating', surface_id: null, kwh: kwh(run.heating_w) })
      lines.push({ term: 'cooling', surface_id: null, kwh: -kwh(run.cooling_w) })
    }
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
    if (al && airModels![zi].windows.length) lines.push({ term: 'window_ventilation', surface_id: null, kwh: kwh(al[2]) })
    if (al && airModels![zi].turbulence && airModels![zi].windows.length) lines.push({ term: 'single_sided_turbulence', surface_id: null, kwh: kwh(al[3]) })
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
    // Brief 109: against each hour's own setpoint (NaN: heating off, never unmet), and "in use" (decision 3): hours at
    // the full heating setpoint, more than UNMET_K below it.
    const heated = zone.setpoints.heat_c != null
    const sh = hoursOf[zi]
    let unmet = 0, unmetUse = 0, minCtl = Infinity, minUse = Infinity, atCap = 0
    const em = emit[zi]
    // Brief 119: the mirror for cooling: hours more than UNMET_K above each hour's cooling setpoint, and at the units' limit.
    const cooled = zone.setpoints.cool_c != null
    const cu = cool[zi], capCool = cu && options.emitter_limit !== 'none' ? cu.cap_w : Infinity
    let unmetC = 0, unmetCUse = 0, maxCtl = -Infinity, maxUse = -Infinity, atCoolCap = 0
    // Brief 120: unmet hours in use while a plant held the zone below its ask.
    const pl = plantLimited[zi], ol = ownLimited[zi]
    const onPlant = (svc: 'heating' | 'cooling') => plants.some((p) => p.service === svc && p.zones.some((x) => x.zone === zi && x.share > 0))
    // Review F3: a short hour is the system's alone when the plant held the zone and its own emitters (units) were not at
    // their limit in what it asked; both when they were too; the rest are the zone's own (or warm-up).
    let sysH = 0, sysC = 0, bothH = 0, bothC = 0
    const held = (h: number, w: number) => pl != null && pl[h] > 0 && w > 0
    const own = (h: number) => ol != null && ol[h] > 0
    for (let h = 0; h < H; h++) {
      const csp = sh ? sh.hourly.cool_c[h] : zone.setpoints.cool_c ?? NaN
      const inUse = sh ? sh.in_use[h] === 1 : true
      maxCtl = Math.max(maxCtl, ctlT[h])
      if (inUse) maxUse = Math.max(maxUse, ctlT[h])
      if (ctlT[h] > csp + UNMET_K) { unmetC++; if (inUse) { unmetCUse++; if (held(h, run.cooling_w[h])) { if (own(h)) bothC++; else sysC++ } } }
      if (cu && !Number.isNaN(csp) && run.cooling_w[h] >= capCool * (1 - 1e-9) && (capCool > 0 || ctlT[h] > csp + 1e-6)) atCoolCap++
    }
    for (let h = 0; h < H; h++) {
      const hsp = sh ? sh.hourly.heat_c[h] : zone.setpoints.heat_c ?? NaN
      const inUse = sh ? sh.in_use[h] === 1 : true
      minCtl = Math.min(minCtl, ctlT[h])
      if (inUse) minUse = Math.min(minUse, ctlT[h])
      if (ctlT[h] < hsp - UNMET_K) { unmet++; if (inUse) { unmetUse++; if (held(h, run.heating_w[h])) { if (own(h)) bothH++; else sysH++ } } }
      const capH = run.heating_cap_w ? run.heating_cap_w[h] : em?.cap_w ?? Infinity  // review F1: the hour's own limit
      if (em && !Number.isNaN(hsp) && run.heating_w[h] >= capH * (1 - 1e-9) && (capH > 0 || ctlT[h] < hsp - 1e-6)) atCap++
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
        unmet_heating_hours: heated ? unmet : null, min_control_c: minCtl,
        in_use_hours: sh ? sh.in_use_hours : H,
        unmet_heating_hours_in_use: heated ? unmetUse : null, min_control_in_use_c: Number.isFinite(minUse) ? minUse : null,
        unmet_cooling_hours: cooled ? unmetC : null, unmet_cooling_hours_in_use: cooled ? unmetCUse : null, max_control_c: maxCtl,
        max_control_in_use_c: Number.isFinite(maxUse) ? maxUse : null,
        system_short_heating_hours_in_use: heated && onPlant('heating') ? sysH : null,
        system_short_cooling_hours_in_use: cooled && onPlant('cooling') ? sysC : null,
        both_short_heating_hours_in_use: heated && onPlant('heating') ? bothH : null,
        both_short_cooling_hours_in_use: cooled && onPlant('cooling') ? bothC : null,
      },
      emitters: em ? { cap_w: em.cap_w, radiant_fraction: em.radiant_fraction, hours_at_cap: atCap, emitters: em.emitters, slab: em.slab } : null,
      cooling_units: cu ? { cap_w: cu.cap_w, hours_at_cap: atCoolCap, units: cu.units } : null,
      ...(weatherAir ? { air: { inflow_kg_per_h: airInflow[zi], window_open_fraction: airOpen[zi], hours_windows_open: airOpen[zi].reduce((t, x) => t + (x > 0 ? 1 : 0), 0), leakage: airModels![zi].fixed_leakage ? 'q50_over_20' as const : 'weather' as const } } : {}),
      breakdown: lines,
      closure,
      run_ms,
    }
    return r
  })
  // Brief 120: each plant over the year.
  const cal = plants.length ? calendar(weather.hours) : null
  const plantResults: PlantResults[] = plants.map((p, k) => {
    const r = plantRun[k]
    let peak = 0, hrs = 0, ask = 0, del = 0, res = 0, resPeak = 0, minFlow = Infinity
    const byMonth = new Array(12).fill(0)
    for (let h = 0; h < H; h++) {
      peak = Math.max(peak, r.ask_w[h]); hrs += r.short[h]; ask += r.ask_w[h]; del += r.delivered_w[h]
      res += p.reserved_w ? p.reserved_w[h] : 0
      resPeak = Math.max(resPeak, p.reserved_w ? p.reserved_w[h] : 0)
      if (r.flow_c) minFlow = Math.min(minFlow, r.flow_c[h])
      if (r.short[h] > 0) byMonth[cal!.monthIdx[h]] += (r.ask_w[h] - r.delivered_w[h]) / 1000
    }
    let hwHrs = 0, hwShort = 0
    if (p.hw_frac) for (let h = 0; h < H; h++) if (p.hw_frac[h] < 1) { hwHrs++; hwShort += (p.reserved_w![h] / p.hw_frac[h] - p.reserved_w![h]) / 1000 }
    return {
      hot_water_id: p.hw_group, hot_water_given_frac: p.hw_frac, hot_water_short_hours: hwHrs, hot_water_short_kwh: hwShort,
      id: p.id, service: p.service, cap_w: p.cap_w, peak_ask_w: peak, hours_short: hrs, ask_kwh: ask / 1000, delivered_kwh: del / 1000,
      asked_not_given_step_sum_kwh: byMonth.reduce((a, b) => a + b, 0), reserved_kwh: res / 1000, peak_reserved_w: resPeak, asked_not_given_step_sum_kwh_by_month: byMonth,
      min_flow_c: r.flow_c ? minFlow : null,
      zones: p.zones.map(({ zone, share }, j) => ({ zone_id: doc.zones[zone].id, share, given_w: r.zone_w[j] })),
    }
  })
  return { engine: network ? 'thermal-2' : 'thermal-1', zones, solver, run_ms, plants: plantResults }
}

/**
 * The ground's boundary temperature, °C: building.site.ground.method 'annual_mean_outdoor' (the only method the schema
 * allows), the weather file's mean dry bulb. The one place it is worked out (Rule 11): the year's run and the design
 * heat loss (Brief 117) both read it here.
 */
export function groundTemperature(weather: Weather): number {
  const H = weather.hours.count
  let tg = 0
  for (let h = 0; h < H; h++) tg += weather.hours.dry_bulb[h]
  return tg / H
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

export interface ZoneSetpointHours {
  /** Each hour's setpoints, °C; NaN where that service is off. */
  hourly: { heat_c: Float64Array; cool_c: Float64Array }
  /** 1 where the schedule is at 1 (the zone is in use), else 0. */
  in_use: Uint8Array
  in_use_hours: number
}

/**
 * Brief 109 (decisions 1 and 2, docs/audit/109/00_reconnaissance.md): a zone's hourly setpoints from setpoints.hours_ref
 * (a profile of kind 'schedule', f from 0 to 1 by hour) and setback_c. Heating: setback_c + f·(heat_c − setback_c); with
 * no setback, f is 0 (off) or 1 (heat_c). Cooling: cool_c where f > 0, off where f = 0. Null for a zone with neither.
 * Every gap is refused by name; nothing is defaulted.
 */
export function zoneSetpointHours(doc: ModelDocument, hours: Weather['hours']): (ZoneSetpointHours | null)[] {
  let cal: ReturnType<typeof calendar> | null = null
  return doc.zones.map((z, zi) => {
    const sp = z.setpoints, p = `zones[${zi}].setpoints`
    // Brief 121: setpoints that follow temperature profiles.
    const heatRef = sp.heat_ref ?? null, coolRef = sp.cool_ref ?? null
    const tempProfile = (ref: string, k: 'heat_ref' | 'cool_ref') => {
      const t = doc.profiles.find((q) => q.id === ref)
      if (!t || t.kind !== 'temperature') throw new ModelError(`no temperature profile "${ref}"`, `${p}.${k}`)
      return t
    }
    const extreme = (t: Extract<ModelDocument['profiles'][number], { kind: 'temperature' }>, f: (...x: number[]) => number) =>
      f(...t.day_types.weekday, ...t.day_types.saturday, ...t.day_types.sunday)
    const heatT = heatRef != null ? tempProfile(heatRef, 'heat_ref') : null
    const coolT = coolRef != null ? tempProfile(coolRef, 'cool_ref') : null
    if (heatT) {
      if (sp.setback_c != null) throw new ModelError('the heating profile carries the setback; leave setback_c empty', `${p}.setback_c`)
      if (sp.heat_c == null) throw new ModelError('a heating profile needs heat_c, the in-use setpoint emitters and design heat loss read: the profile\'s highest value', `${p}.heat_c`)
      const top = extreme(heatT, Math.max)
      if (sp.heat_c !== top) throw new ModelError(`heat_c (${sp.heat_c} °C) must be the heating profile's highest value (${top} °C)`, `${p}.heat_c`)
    }
    if (coolT) {
      if (sp.cool_c == null) throw new ModelError('a cooling profile needs cool_c: the profile\'s lowest value', `${p}.cool_c`)
      const low = extreme(coolT, Math.min)
      if (sp.cool_c !== low) throw new ModelError(`cool_c (${sp.cool_c} °C) must be the cooling profile's lowest value (${low} °C)`, `${p}.cool_c`)
    }
    if (sp.hours_ref == null && !heatT && !coolT) {
      if (sp.setback_c != null) throw new ModelError('a setback needs the hours it applies outside (hours_ref)', `${p}.hours_ref`)
      return null
    }
    cal ??= calendar(hours)
    const prof = sp.hours_ref == null ? null : doc.profiles.find((q) => q.id === sp.hours_ref)
    if (sp.hours_ref != null && !prof) throw new ModelError(`no profile "${sp.hours_ref}"`, `${p}.hours_ref`)
    if (prof == null) {
      // Profiles and no hours: in use every hour; the profiles give each hour's setpoints.
      const H = hours.count
      const heat = new Float64Array(H), cool = new Float64Array(H), use = new Uint8Array(H).fill(1)
      for (let h = 0; h < H; h++) {
        const d = cal.day[h], hr = cal.hourOfDay[h]
        heat[h] = heatT ? heatT.day_types[d][hr] : sp.heat_c ?? NaN
        cool[h] = coolT ? coolT.day_types[d][hr] : sp.cool_c ?? NaN
        if (heat[h] >= cool[h]) throw new ModelError(`the heating setpoint (${heat[h]} °C) reaches the cooling setpoint (${cool[h]} °C) at hour ${h}`, `${p}.${heatT ? 'heat_ref' : 'cool_ref'}`)
      }
      return { hourly: { heat_c: heat, cool_c: cool }, in_use: use, in_use_hours: H }
    }
    const pi = doc.profiles.indexOf(prof)
    if (prof.kind !== 'schedule') throw new ModelError(`profile "${prof.id}" is ${prof.kind}, not a schedule`, `${p}.hours_ref`)
    if (sp.heat_c == null && sp.cool_c == null) throw new ModelError('hours are given, but neither a heating nor a cooling setpoint', p)
    if (sp.setback_c != null) {
      if (sp.heat_c == null) throw new ModelError('a setback needs a heating setpoint to set back from', `${p}.heat_c`)
      if (sp.setback_c > sp.heat_c) throw new ModelError(`the setback (${sp.setback_c} °C) is above the heating setpoint (${sp.heat_c} °C)`, `${p}.setback_c`)
    }
    for (const dt of ['weekday', 'saturday', 'sunday'] as const) {
      prof.day_types[dt].forEach((f, hr) => {
        if (!(f >= 0 && f <= 1)) throw new ModelError(`${dt} hour ${hr}: ${f} must be 0 to 1`, `profiles[${pi}].day_types.${dt}`)
        if (sp.setback_c == null && sp.heat_c != null && !heatT && f !== 0 && f !== 1) throw new ModelError(`${dt} hour ${hr}: a part value (${f}) needs a setback to scale from; give 0 (off) or 1 (on), or state setback_c`, `profiles[${pi}].day_types.${dt}`)
      })
    }
    const H = hours.count
    const heat = new Float64Array(H), cool = new Float64Array(H), use = new Uint8Array(H)
    let n = 0
    for (let h = 0; h < H; h++) {
      const d = cal.day[h], hr = cal.hourOfDay[h]
      const f = prof.day_types[d][hr]
      heat[h] = heatT ? heatT.day_types[d][hr] : sp.heat_c == null ? NaN : sp.setback_c != null ? sp.setback_c + f * (sp.heat_c - sp.setback_c) : f > 0 ? sp.heat_c : NaN
      cool[h] = sp.cool_c != null && f > 0 ? (coolT ? coolT.day_types[d][hr] : sp.cool_c) : NaN
      if ((heatT || coolT) && heat[h] >= cool[h]) throw new ModelError(`the heating setpoint (${heat[h]} °C) reaches the cooling setpoint (${cool[h]} °C) at hour ${h}`, `${p}.${heatT ? 'heat_ref' : coolT ? 'cool_ref' : 'heat_c'}`)
      if (f === 1) { use[h] = 1; n++ }
    }
    return { hourly: { heat_c: heat, cool_c: cool }, in_use: use, in_use_hours: n }
  })
}
