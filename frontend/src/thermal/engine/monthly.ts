/**
 * The monthly estimate (Brief 122 P1): a Static engine, labelled as such (CLAUDE.md Rule 7). It never claims to be the
 * hourly run's output and has its own result type; nothing reads one as the other (Rule 11).
 *
 * Method: the monthly quasi-steady calculation of ISO 52016-1:2017 clause 6.6 (the successor of ISO 13790:2008
 * clause 7 and 12), per zone and calendar month:
 *
 *   Q_H = Q_ht,H − η_H · Q_gn            Q_C = Q_gn − η_C · Q_ht,C
 *   Q_ht = (H_tr + H_ve) · (θ_set − θ_e,m) · t_m      (ground elements against the ground temperature)
 *   η_H = (1 − γ^a) / (1 − γ^(a+1)),  γ = Q_gn / Q_ht,H        η_C = (1 − λ^−a) / (1 − λ^−(a+1)),  λ = Q_gn / Q_ht,C
 *   a = a_0 + τ / τ_0  (a_0 = 1, τ_0 = 15 h: ISO 13790 Table 9 / 12.2.1.1),  τ = C_m / (H_tr + H_ve)
 *
 * Inputs are the hourly run's own: the same document, library, element builders (U, films, sky factor), bridging,
 * infiltration, vent coefficients, sun on each surface and glazing optics, and gain profiles. Each month's figures
 * are sums of the same hourly weather the hourly run reads. What the method leaves out is stated in `notes`.
 *
 * Every term is a line (Rule 9): the lines of each zone sum to zero every month, heating and cooling included.
 * `gains_not_used` is the gain the room could not use at its heating setpoint ((1 − η_H) · Q_gn, less what cooling
 * removed): it raises the room above the setpoint and leaves through the fabric and air.
 */
import type { ModelDocument } from '../schema/model'
import type { ConstructionBody, Element, Layer } from './elements'
import { ElementError, innerElement, opaqueElement, windowElement } from './elements'
import { AirError, infiltration, ventCoefficient, type Vent } from './air'
import { BridgingError, computeBridging } from './bridging'
import { ENGINE_CONSTANTS as K } from './constants'
import { GainsError, zoneGains } from './gains'
import { GlazingError, simpleGlazingAngular, simpleGlazingOptics } from './glazing'
import { groundTemperature, ModelError } from './model'
import type { BreakdownLine } from './results'
import { shadingFactor } from './shading'
import { solarOnSurface, type SolarOptions } from './solar'
import type { SurfaceIrradiance, Weather } from './types'

/** ISO 13790:2008 12.2.1.1 / ISO 52016-1 monthly: the utilisation's numerical parameters, heating and cooling. */
export const MONTHLY_CONSTANTS = {
  a_0: 1,
  tau_0_h: 15,
  /**
   * The effective heat capacity C_m, after ISO 13786:2017 Annex C (simplified): each inside face takes its layers'
   * heat capacity up to 0.10 m deep, half the element's thickness, or the first insulating layer, whichever comes
   * first. Insulating here: a no-mass layer, or a layer with conductivity below 0.1 W/mK (our reading; stated).
   */
  kappa_depth_m: 0.1,
  insulating_conductivity_w_per_mk: 0.1,
} as const

export interface MonthlyOptions {
  solar: SolarOptions
  glazing_solar: 'g_value' | 'optical'
  internal_gains: 'none' | 'profiles'
}

export interface MonthlyZone {
  zone_id: string
  floor_m2: number
  heating_kwh: number
  cooling_kwh: number
  monthly: { heating_kwh: number[]; cooling_kwh: number[] }
  /** Each term over the year, kWh, positive into the zone; sums to zero (Rule 9). */
  breakdown: BreakdownLine[]
  /** Conductances and the time constant the utilisation used. */
  h_tr_w_per_k: number
  h_ve_w_per_k: number
  c_m_j_per_k: number
  tau_h: number
}

export interface MonthlyResults {
  engine: 'monthly-static'
  method: 'ISO 52016-1 monthly quasi-steady'
  constants: typeof MONTHLY_CONSTANTS
  zones: MonthlyZone[]
  /** What this estimate leaves out or assumes, in words (shown with it). */
  notes: string[]
  run_ms: number
}

/** Per weather file: monthly hours, mean air and wind, and the ground temperature. Cached by the weather object. */
interface MonthlyWeather { hours: number[]; theta_e: number[]; wind: number[]; tg: number; sun: Map<string, MonthlySun>; optics: Map<string, MonthlyOptics> }
/** Per orientation: monthly sums of total, direct and diffuse irradiance, Wh/m². */
interface MonthlySun { total: number[]; raw: SurfaceIrradiance | null }
/** Per orientation, U and g (optical glazing): monthly transmitted (all, beam) and pane-absorbed solar per m² of glass, Wh. */
interface MonthlyOptics { t: number[]; beam: number[]; a: number[] }
const cache = new WeakMap<Weather, Map<string, MonthlyWeather>>()

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const zeros = () => new Array<number>(12).fill(0)

function monthlyWeather(weather: Weather, solar: SolarOptions): MonthlyWeather {
  let byOpt = cache.get(weather)
  if (!byOpt) { byOpt = new Map(); cache.set(weather, byOpt) }
  const key = JSON.stringify(solar)
  let w = byOpt.get(key)
  if (w) return w
  const H = weather.hours.count, hours = zeros(), te = zeros(), wind = zeros()
  for (let h = 0; h < H; h++) {
    const m = weather.hours.month[h] - 1
    hours[m]++; te[m] += weather.hours.dry_bulb[h]; wind[m] += weather.hours.wind_speed[h]
  }
  for (let m = 0; m < 12; m++) if (hours[m] > 0) { te[m] /= hours[m]; wind[m] /= hours[m] }
  w = { hours, theta_e: te, wind, tg: groundTemperature(weather), sun: new Map(), optics: new Map() }
  byOpt.set(key, w)
  return w
}

function sunOn(weather: Weather, W: MonthlyWeather, solar: SolarOptions, az: number, tilt: number): MonthlySun {
  const k = `${az}|${tilt}`
  let s = W.sun.get(k)
  if (s) return s
  const irr = solarOnSurface(weather, az, tilt, solar)
  const total = zeros()
  for (let h = 0; h < weather.hours.count; h++) total[weather.hours.month[h] - 1] += irr.total[h]
  s = { total, raw: irr }
  W.sun.set(k, s)
  return s
}

function opticsOn(weather: Weather, W: MonthlyWeather, sun: MonthlySun, az: number, tilt: number, u: number, g: number, path: string): MonthlyOptics {
  const k = `${az}|${tilt}|${u}|${g}`
  let o = W.optics.get(k)
  if (o) return o
  const op = simpleGlazingOptics(u, g, path), ang = simpleGlazingAngular(u, g, op, path)
  const irr = sun.raw!
  o = { t: zeros(), beam: zeros(), a: zeros() }
  // The hourly run's own per-hour optics (model.ts buildElements), summed by month.
  for (let h = 0; h < weather.hours.count; h++) {
    const m = weather.hours.month[h] - 1
    const dif = irr.diffuse[h] + irr.reflected[h]
    let tb = 0, ab = 0
    if (irr.direct[h] > 0) { const p = ang.at(irr.cos_incidence[h]); tb = irr.direct[h] * p.t; ab = irr.direct[h] * (1 - p.t - p.r) }
    o.t[m] += tb + dif * ang.t_dif; o.beam[m] += tb; o.a[m] += ab + dif * ang.a_dif
  }
  W.optics.set(k, o)
  return o
}

/** κ·A of one inside face, J/K, from the layers in order from that face (ISO 13786 Annex C, simplified). */
function faceCapacity(layersFromFace: Layer[], area: number): number {
  const total = layersFromFace.reduce((s, l) => s + (l.kind === 'Material:NoMass' ? 0 : l.thickness ?? 0), 0)
  const dMax = Math.min(MONTHLY_CONSTANTS.kappa_depth_m, total / 2)
  let d = 0, c = 0
  for (const l of layersFromFace) {
    if (l.kind === 'Material:NoMass' || (l.conductivity ?? 0) < MONTHLY_CONSTANTS.insulating_conductivity_w_per_mk) break
    const t = Math.min(l.thickness ?? 0, dMax - d)
    if (!(t > 0)) break
    c += (l.density ?? 0) * (l.specific_heat ?? 0) * t
    d += t
    if (d >= dMax - 1e-12) break
  }
  return c * area
}

const util = (r: number, a: number) => {
  // ISO 13790 eq. (52)/(64): r = γ (heating) or 1/λ (cooling).
  if (!(r > 0)) return 1
  if (Math.abs(r - 1) < 1e-9) return a / (a + 1)
  return (1 - r ** a) / (1 - r ** (a + 1))
}

/**
 * The monthly estimate for every zone of a document. Errors as the hourly run's (`ModelError`, with the document path).
 * Each zone is taken alone at its own setpoints; heat between zones is not counted (in Fabric only every zone has the
 * same setpoint). Heating runs all year at `heat_c`; hours, setbacks and setpoint profiles are not modelled.
 */
export function runMonthly(doc: ModelDocument, weather: Weather, library: Record<string, ConstructionBody>, options: MonthlyOptions): MonthlyResults {
  const t0 = now()
  const W = monthlyWeather(weather, options.solar)
  const notes: string[] = [
    'Monthly estimate (static): ISO 52016-1 monthly method. Not the hourly run.',
    'Each room alone, heated all day at its heating setpoint; heating hours, setbacks and heat between rooms are not counted.',
  ]
  const zIndex = new Map(doc.zones.map((z, i) => [z.id, i]))
  const Zn = doc.zones.length
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const wrap = <T>(f: () => T): T => {
    try { return f() } catch (e) {
      if (e instanceof ElementError || e instanceof AirError || e instanceof BridgingError || e instanceof GlazingError || e instanceof GainsError) throw new ModelError(e.message.slice(e.path.length + 2), e.path)
      throw e
    }
  }
  const weatherAir = doc.building.air.method === 'weather_driven'
  if (weatherAir) notes.push('Weather-driven air is not in this estimate: leakage is q50 ÷ 20 and permanent vents use today\'s wind formula.')

  // Per zone: conductances, mass, monthly gains (Wh), and the lines.
  interface ZB {
    lossLines: { term: BreakdownLine['term']; surface_id: string | null; profile_id?: string; h: number; ground: boolean }[]
    gainLines: { term: BreakdownLine['term']; surface_id: string | null; profile_id?: string; wh: number[] }[]
    cm: number; envelopeArea: number; glazingAreas: number[]; glazingGroups: string[]; hasRoof: boolean; hasGround: boolean; sharedSlabs: number
    vents: number; inside: { area: number; alpha: number | null; window: { t: number; a: number; n: number } | null; floor: boolean }[]
    tr: number[]; beam: number[]; paneIn: number[]
  }
  const Z: ZB[] = doc.zones.map(() => ({ lossLines: [], gainLines: [], cm: 0, envelopeArea: 0, glazingAreas: [], glazingGroups: [], hasRoof: false, hasGround: false, sharedSlabs: 0, vents: 0, inside: [], tr: zeros(), beam: zeros(), paneIn: zeros() }))
  let nullFlowMode = false
  const ceilings: { room: number; loft: number; surface_id: string; h: number }[] = []
  const seen = new Set<string>()
  doc.zones.forEach((zone, zi) => {
    for (const id of zone.surfaces) {
      if (seen.has(id)) continue
      seen.add(id)
      const i = doc.surfaces.findIndex((s) => s.id === id)
      const s = doc.surfaces[i], path = `surfaces[${i}]`
      const za = zIndex.get(s.zone_a)!, zb = zIndex.get(s.zone_b)
      const b = library[s.construction_ref.key]
      if (!b) throw new ModelError(`construction "${s.construction_ref.key}" is not in the library given to the engine`, `${path}.construction_ref.key`)
      const layers = b.layers ?? []
      const ref = s.construction_ref
      if (zb !== undefined) {
        // Between zones or within one: mass only (heat between zones is not counted). Layers run zone_b → zone_a.
        const e = wrap(() => innerElement({ id: s.id, area_m2: s.area_m2, tilt_deg: s.tilt_deg, layers, path }))
        Z[za].cm += faceCapacity([...layers].reverse(), s.area_m2)
        Z[zb].cm += faceCapacity(layers, s.area_m2)
        Z[za].inside.push({ area: s.area_m2, alpha: s.inside_solar_absorptance ?? null, window: null, floor: s.tilt_deg > 120 })
        Z[zb].inside.push({ area: s.area_m2, alpha: s.inside_solar_absorptance_b ?? null, window: null, floor: 180 - s.tilt_deg > 120 })
        // Brief 123 P4: a ceiling to an unconditioned loft carries heat (ISO 13789 6.4, below); its area is in the room's
        // envelope for leakage, and it is not a slab between storeys (as the hourly run, model.ts buildElements).
        const ua = doc.zones[za].conditioning === 'unconditioned', ub = doc.zones[zb].conditioning === 'unconditioned'
        if (ua !== ub) {
          const room = ua ? zb : za, loft = ua ? za : zb
          Z[room].envelopeArea += s.area_m2
          ceilings.push({ room, loft, surface_id: s.id, h: e.u_w_per_m2k * s.area_m2 })
        } else if ((s.kind === 'floor' || s.kind === 'ceiling') && zb !== za) { Z[za].sharedSlabs++; Z[zb].sharedSlabs++ }
        continue
      }
      const T = Z[za]
      T.envelopeArea += s.area_m2
      if (s.kind === 'glazing') {
        const u = num(ref.u_value_override) ?? num(b.u_value_W_per_m2K)
        if (u == null) throw new ModelError('glazing needs a U (override or library u_value_W_per_m2K)', `${path}.construction_ref`)
        const g = num(ref.g_value_override) ?? num(s.g_value) ?? num(b.g_value)
        if (g == null) throw new ModelError('glazing needs a g-value (override, surface or library)', `${path}.g_value`)
        const ff = s.frame_fraction
        if (ff == null) throw new ModelError('required', `${path}.frame_fraction`)
        const hasShading = !!(s.shading?.overhang?.depth_m || s.shading?.fins?.left_depth_m || s.shading?.fins?.right_depth_m)
        if (hasShading && s.facade == null) throw new ModelError('shading needs the facade label', `${path}.facade`)
        const sf = s.facade ? shadingFactor(s.facade, s.shading) : 1
        const optical = options.glazing_solar === 'optical'
        const e: Element = wrap(() => windowElement({ id: s.id, area_m2: s.area_m2, tilt_deg: s.tilt_deg, u, emissivity: s.thermal_emissivity, path, optics: optical ? { interior_transmitted: 0, interior_absorbed: 0 } : null }))
        T.lossLines.push({ term: 'conduction', surface_id: s.id, h: u * s.area_m2, ground: false })
        const rse = 1 / e.g_boundary
        if (e.f_sky > 0) T.gainLines.push({ term: 'sky_longwave', surface_id: s.id, wh: W.hours.map((n) => -rse * u * s.area_m2 * e.f_sky * e.h_re * K.delta_theta_sky_k * n) })
        const up = s.tilt_deg <= 90 + 1e-9
        const sun = up ? sunOn(weather, W, options.solar, s.azimuth_deg ?? 0, s.tilt_deg) : null
        const share = (1 - ff) * sf
        let win: ZB['inside'][number]['window'] = null
        if (optical) {
          const op = wrap(() => simpleGlazingOptics(u, g, path)), ang = wrap(() => simpleGlazingAngular(u, g, op, path))
          // The pane's absorbed solar flows inward by its share of the resistance to outside (the hourly run's middle node).
          const r = 2 / e.g[0], n = (rse + r / 2) * u
          win = { t: (1 - ff) * ang.t_dif, a: (1 - ff) * ang.a_dif + ff, n }
          if (sun) {
            const o = wrap(() => opticsOn(weather, W, sun, s.azimuth_deg ?? 0, s.tilt_deg, u, g, path))
            const tr = o.t.map((x) => x * share * s.area_m2)
            T.gainLines.push({ term: 'solar_transmitted', surface_id: s.id, wh: tr })
            T.gainLines.push({ term: 'glazing_solar_absorbed', surface_id: s.id, wh: o.a.map((x) => x * share * s.area_m2 * n) })
            for (let m = 0; m < 12; m++) { T.tr[m] += tr[m]; T.beam[m] += o.beam[m] * share * s.area_m2 }
          }
        } else if (sun) {
          const tr = sun.total.map((x) => x * g * K.glazing_angle_factor * share * s.area_m2)
          T.gainLines.push({ term: 'solar_transmitted', surface_id: s.id, wh: tr })
          for (let m = 0; m < 12; m++) T.tr[m] += tr[m]
        }
        T.inside.push({ area: s.area_m2, alpha: null, window: win, floor: false })
        T.glazingAreas.push(s.area_m2)
        T.glazingGroups.push(`${s.facade ?? ''}|${s.azimuth_deg ?? ''}|${s.tilt_deg}`)
        continue
      }
      const outside = (s.kind === 'wall' || s.kind === 'roof' || s.kind === 'floor') && s.zone_b === 'outside'
      const ground = s.kind === 'ground' && s.zone_b === 'ground'
      if (!outside && !ground) throw new ModelError(`a ${s.kind} facing "${s.zone_b}" needs another zone`, path)
      if (s.kind === 'roof') T.hasRoof = true
      if (ground) T.hasGround = true
      const stated = num(ref.u_value_override) ?? num((b as { u_value_override?: unknown }).u_value_override) ?? num(b.u_value_W_per_m2K)
      const e = wrap(() => opaqueElement({ id: s.id, area_m2: s.area_m2, tilt_deg: s.tilt_deg, boundary: ground ? 'ground' : 'outside', layers, stated_u: stated, emissivity: ground ? null : s.thermal_emissivity, path }))
      const ua = e.u_w_per_m2k * s.area_m2
      T.lossLines.push({ term: 'conduction', surface_id: s.id, h: ua, ground })
      T.cm += faceCapacity([...layers].reverse(), s.area_m2)
      if (s.inside_solar_absorptance == null) throw new ModelError('required', `${path}.inside_solar_absorptance`)
      T.inside.push({ area: s.area_m2, alpha: s.inside_solar_absorptance, window: null, floor: s.tilt_deg > 120 })
      if (outside) {
        const rse = 1 / e.g_boundary
        const alpha = s.solar_absorptance
        if (alpha == null) throw new ModelError('required', `${path}.solar_absorptance`)
        const up = s.tilt_deg <= 90 + 1e-9
        if (alpha > 0 && up) {
          const sun = sunOn(weather, W, options.solar, s.azimuth_deg ?? 0, s.tilt_deg)
          T.gainLines.push({ term: 'opaque_solar_absorbed', surface_id: s.id, wh: sun.total.map((x) => alpha * rse * ua * x) })
        } else T.gainLines.push({ term: 'opaque_solar_absorbed', surface_id: s.id, wh: zeros() })
        if (e.f_sky > 0) T.gainLines.push({ term: 'sky_longwave', surface_id: s.id, wh: W.hours.map((n) => -rse * ua * e.f_sky * e.h_re * K.delta_theta_sky_k * n) })
      }
      s.openings.forEach((o, j) => {
        if (o.kind !== 'permanent_vent' || !(o.area_m2 > 0)) return
        const p = `${path}.openings[${j}]`
        if (o.cd == null) throw new ModelError('required', `${p}.cd`)
        let mode = o.flow_mode
        if (mode == null) {
          if (!weatherAir) throw new ModelError('required', `${p}.flow_mode`)
          mode = 'single_sided'; nullFlowMode = true
        }
        const v: Vent = { surface_id: s.id, area_m2: o.area_m2, cd: o.cd, flow_mode: mode as Vent['flow_mode'] }
        T.vents += wrap(() => ventCoefficient(v, doc.building.site.exposure, p))
      })
    }
  })
  if (nullFlowMode) notes.push('Vents with no flow mode (weather-driven air) are taken as single-sided here.')

  // Bridging, shared over zones as the hourly network run does (Brief 104 Part 3).
  const facadeArea = new Map<string, number>()
  for (const T of Z) T.glazingGroups.forEach((g, j) => facadeArea.set(g, (facadeArea.get(g) ?? 0) + T.glazingAreas[j]))
  let gains: ReturnType<typeof zoneGains> = doc.zones.map(() => null)
  if (options.internal_gains === 'profiles') gains = wrap(() => zoneGains(doc, weather.hours))

  const P = MONTHLY_CONSTANTS
  const pre = doc.zones.map((zone, zi) => {
    const T = Z[zi], path = `zones[${zi}]`
    const volume = zone.area_m2 * zone.height_m
    const inf = wrap(() => infiltration({ q50: zone.infiltration_q50, ach: zone.infiltration_ach, envelope_area_m2: T.envelopeArea, volume_m3: volume, path }))
    const areaUA = T.lossLines.reduce((s, l) => s + l.h, 0)
    const windowPerimeter = T.glazingGroups.reduce((s, g, j) => {
      const A = facadeArea.get(g)!, a = T.glazingAreas[j]
      return s + (A > 0 && a > 0 ? 4 * Math.sqrt(A) * (a / A) : 0)
    }, 0)
    const br = wrap(() => computeBridging({
      tb: doc.building.thermal_bridging, polygon: zone.polygon, storeys: zone.storeys, storey_height_m: zone.height_m,
      glazing_areas_m2: T.glazingAreas, area_ua_w_per_k: areaUA,
      zone_share: { has_roof: T.hasRoof, has_ground: T.hasGround, shared_slabs: T.sharedSlabs, window_perimeter_m: windowPerimeter },
    }))
    return { volume, inf, areaUA, br }
  })
  // Brief 123 P4: an unconditioned loft is an adjacent unconditioned space (ISO 13789:2017 6.4): each room's ceiling loss
  // is H_iu·b·(θ_i − θ_e) with b = H_ue / (H_iu + H_ue); H_iu all the ceilings under the loft, H_ue the loft's fabric,
  // bridging and air to outside. Solar and sky on the loft's slopes are not counted (b without solar), and noted.
  const loftB = new Map<number, { b: number; Hue: number }>()
  doc.zones.forEach((z, li) => {
    if (z.conditioning !== 'unconditioned') return
    const Hiu = ceilings.filter((c) => c.loft === li).reduce((s, c) => s + c.h, 0)
    const Hue = pre[li].areaUA + pre[li].br.total_w_per_k + pre[li].inf.h_w_per_k
    loftB.set(li, { b: Hiu + Hue > 0 ? Hue / (Hiu + Hue) : 1, Hue })
  })
  for (const c of ceilings) Z[c.room].lossLines.push({ term: 'interzone', surface_id: c.surface_id, h: c.h * loftB.get(c.loft)!.b, ground: false })
  if (loftB.size) notes.push('An unheated loft is taken by ISO 13789\'s adjustment factor: solar on a cold roof\'s slopes is not counted in this estimate.')
  const roomTheta = (zi: number) => doc.zones[zi].setpoints.heat_c ?? doc.zones[zi].setpoints.cool_c
  const zones: MonthlyZone[] = doc.zones.map((zone, zi) => {
    const T = Z[zi], path = `zones[${zi}]`
    const { volume, inf, br } = pre[zi]
    const areaUA = pre[zi].areaUA
    if (zone.conditioning === 'unconditioned') {
      // The loft: no heating or cooling; what arrives through the ceilings leaves through its own lines, by conductance.
      const { Hue } = loftB.get(zi)!
      const mine = ceilings.filter((c) => c.loft === zi)
      const lines = new Map<string, BreakdownLine>()
      const add = (term: BreakdownLine['term'], surface_id: string | null, kwh: number) => {
        const k = `${term}|${surface_id}`
        const l = lines.get(k) ?? { term, surface_id, kwh: 0 }
        l.kwh += kwh; lines.set(k, l)
      }
      for (let m = 0; m < 12; m++) {
        const n = W.hours[m]
        if (n === 0) continue
        let qin = 0
        for (const c of mine) {
          const th = roomTheta(c.room)
          if (th == null) continue
          const q = c.h * loftB.get(zi)!.b * (th - W.theta_e[m]) * n
          add('interzone', c.surface_id, q / 1000); qin += q
        }
        const share = Hue > 0 ? qin / Hue / 1000 : 0
        for (const l of T.lossLines) add(l.term, l.surface_id, -l.h * share)
        add('bridging', null, -br.total_w_per_k * share)
        add('infiltration', null, -inf.h_w_per_k * share)
      }
      return {
        zone_id: zone.id, floor_m2: 0, heating_kwh: 0, cooling_kwh: 0, monthly: { heating_kwh: zeros(), cooling_kwh: zeros() },
        breakdown: [...lines.values()], h_tr_w_per_k: areaUA + br.total_w_per_k, h_ve_w_per_k: inf.h_w_per_k, c_m_j_per_k: 0, tau_h: 0,
      }
    }
    // Air-side lines, with the vents' conductance at each month's mean wind.
    const ventH = W.wind.map((v) => K.rho_c_air * T.vents * v)
    // Interior solar: the hourly run's split (network.ts "Solar inside each zone"), applied to the month's diffuse and
    // to the beam reflected off the floor. What leaves through the windows is a line, and so is what the panes absorb
    // from inside and pass back to the room.
    const Atot = T.inside.reduce((s, f) => s + f.area, 0)
    let den = 1, lostF = 0, paneF = 0, beamRefl = 0
    if (Atot > 0) {
      den = 1 - T.inside.reduce((s, f) => s + (f.area / Atot) * (f.window ? 1 - f.window.t - f.window.a : 1 - (f.alpha ?? 1)), 0)
      for (const f of T.inside) if (f.window) { lostF += (f.area / Atot) * f.window.t / den; paneF += (f.area / Atot) * f.window.a * (1 - f.window.n) / den }
      const fl = T.inside.filter((f) => f.floor && !f.window), aF = fl.reduce((s, f) => s + f.area, 0)
      for (const f of fl) beamRefl += (f.area / aF) * (1 - (f.alpha ?? 1))
      if (!(aF > 0)) beamRefl = 1
    }
    if (options.glazing_solar === 'optical') {
      // Diffuse = transmitted − beam; the beam reaches the room's diffuse field only as the floor's reflection.
      const toDiffuse = T.tr.map((t, m) => t - T.beam[m] + T.beam[m] * beamRefl)
      T.gainLines.push({ term: 'solar_lost_through_glazing', surface_id: null, wh: toDiffuse.map((d) => -d * (lostF + paneF)) })
    }
    for (const g of gains[zi]?.gains ?? []) {
      const wh = zeros()
      for (let h = 0; h < weather.hours.count; h++) wh[weather.hours.month[h] - 1] += g.w[h]
      T.gainLines.push({ term: `${g.kind}_gains` as BreakdownLine['term'], surface_id: null, profile_id: g.profile_id, wh })
    }

    // The ceilings to a loft (interzone lines, already × b) are part of H_tr for the time constant.
    const Htr = areaUA + br.total_w_per_k + T.lossLines.filter((l) => l.term === 'interzone').reduce((s, l) => s + l.h, 0)
    // The hourly run's air node: the air and the zone's stated internal capacity (furniture, partitions not drawn).
    const cm = T.cm + K.rho_c_air * volume + zone.internal_heat_capacity_j_per_k_m2 * zone.area_m2
    const heatC = zone.setpoints.heat_c, coolC = zone.setpoints.cool_c
    const lines = new Map<string, BreakdownLine>()
    const add = (term: BreakdownLine['term'], surface_id: string | null, kwh: number, extra: Partial<BreakdownLine> = {}) => {
      const k = `${term}|${surface_id}|${extra.profile_id ?? ''}`
      const l = lines.get(k) ?? { term, surface_id, ...extra, kwh: 0 }
      l.kwh += kwh
      lines.set(k, l)
    }
    const heat = zeros(), cool = zeros()
    let tauH = 0
    for (let m = 0; m < 12; m++) {
      const n = W.hours[m]
      if (n === 0) continue
      const te = W.theta_e[m], Hve = inf.h_w_per_k + ventH[m]
      const tau = cm / 3600 / (Htr + Hve)
      tauH += tau * n / weather.hours.count
      const a = P.a_0 + tau / P.tau_0_h
      // Losses at a setpoint (positive Wh = heat out), by line.
      const lossAt = (theta: number) => {
        const out: { term: BreakdownLine['term']; surface_id: string | null; wh: number }[] = T.lossLines.map((l) => ({ term: l.term, surface_id: l.surface_id, wh: l.h * (theta - (l.ground ? W.tg : te)) * n }))
        out.push({ term: 'bridging', surface_id: null, wh: br.total_w_per_k * (theta - te) * n })
        out.push({ term: 'infiltration', surface_id: null, wh: inf.h_w_per_k * (theta - te) * n })
        out.push({ term: 'permanent_vents', surface_id: null, wh: ventH[m] * (theta - te) * n })
        return out
      }
      const Qgn = T.gainLines.reduce((s, l) => s + l.wh[m], 0)
      const shown = heatC != null ? heatC : coolC
      if (shown == null) throw new ModelError('the monthly estimate needs a heating or cooling setpoint', `${path}.setpoints.heat_c`)
      const lossH = lossAt(shown)
      const QhtH = lossH.reduce((s, l) => s + l.wh, 0)
      let QH = 0, QC = 0
      if (heatC != null && QhtH > 0) QH = Math.max(0, QhtH - util(Qgn / QhtH, a) * Qgn)
      if (coolC != null) {
        const QhtC = lossAt(coolC).reduce((s, l) => s + l.wh, 0)
        QC = QhtC > 0 ? Math.max(0, Qgn - util(QhtC / Qgn, a) * QhtC) : Math.max(0, Qgn - QhtC)
        if (!(Qgn > 0)) QC = Math.max(0, -QhtC)
      }
      heat[m] = QH / 1000; cool[m] = QC / 1000
      for (const l of lossH) add(l.term, l.surface_id, -l.wh / 1000)
      for (const l of T.gainLines) add(l.term, l.surface_id, l.wh[m] / 1000, l.profile_id ? { profile_id: l.profile_id } : {})
      add('heating', null, QH / 1000)
      add('cooling', null, -QC / 1000)
      // Closes the month (Rule 9): the gain not used at the heating setpoint, less what cooling removed.
      add('gains_not_used', null, (QhtH - Qgn - QH + QC) / 1000)
    }
    const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)
    return {
      zone_id: zone.id, floor_m2: zone.area_m2, heating_kwh: sum(heat), cooling_kwh: sum(cool),
      monthly: { heating_kwh: heat, cooling_kwh: cool }, breakdown: [...lines.values()],
      h_tr_w_per_k: Htr, h_ve_w_per_k: inf.h_w_per_k + K.rho_c_air * T.vents * (sum(W.wind.map((v, m) => v * W.hours[m])) / weather.hours.count),
      c_m_j_per_k: cm, tau_h: tauH,
    }
  })
  void Zn
  return { engine: 'monthly-static', method: 'ISO 52016-1 monthly quasi-steady', constants: MONTHLY_CONSTANTS, zones, notes, run_ms: now() - t0 }
}
