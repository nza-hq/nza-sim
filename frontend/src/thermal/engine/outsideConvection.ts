/**
 * Brief 125 (Linzie 17 Nov 23:50, "Follow EnergyPlus's method"): the outside surface film as EnergyPlus works it out.
 *
 * EnergyPlus's default outside convection is DOE-2: natural convection from the face's temperature difference with the
 * outdoor air, combined with a forced term from the wind at the face's own height, windward or leeward, scaled by the
 * outside layer's roughness. While it rains, a wind-exposed face is wet: 1,000 W/m²K to the outdoor wet bulb. Each
 * piece was checked against EnergyPlus 25.2's own hourly outputs before it was written
 * (docs/briefs/active/125_outside-film.md, Part 1). The network solver (network.ts) calls these each step.
 */
import { ENGINE_CONSTANTS as K } from './constants'
import { windFactorAt, wetBulb, type EpTerrain } from './airflow'

/**
 * The height of an outside face's centroid, m: the one height the run's film and the EnergyPlus translator both use
 * (Rule 11). A face within 45° of vertical sits at the middle of its zone's height; one looking up (a roof) at the
 * zone's top; one looking down at the zone's floor.
 */
export function outsideFaceZ(zone: { floor: number; height_m: number; storeys: number }, tilt_deg: number): number {
  const z0 = zone.floor * zone.height_m, H = zone.height_m * zone.storeys
  if (tilt_deg > 45 && tilt_deg < 135) return z0 + H / 2
  if (tilt_deg <= 45) return z0 + H
  return z0
}

/** The parts of a surface the window layout reads. */
interface LayoutSurface { id: string; kind: string; zone_a: string; zone_b: string; area_m2: number; tilt_deg: number; azimuth_deg?: number | null }

/**
 * Brief 126: where each window of a zone sits, as the EnergyPlus translator draws it (one read, Rule 11): its host, the
 * biggest wall or roof of the zone facing the same way, and its glass height, m: the host's rectangle (gross = its net
 * area plus its windows'; a vertical one as tall as the zone or half its gross, at least 1 m; otherwise square) less a
 * margin top and bottom. A window with no host is left out (the translator refuses it by name).
 */
export function windowLayout(zone: { id: string; height_m: number; storeys: number; surfaces: readonly string[] }, byId: ReadonlyMap<string, LayoutSurface>): Map<string, { host: string; height_m: number }> {
  const own = zone.surfaces.map((id) => byId.get(id)).filter((s): s is LayoutSurface => !!s && s.zone_a === zone.id)
  const glass = own.filter((s) => s.kind === 'glazing' && s.area_m2 > 0)
  const hostOf = new Map<string, LayoutSurface>()
  for (const g of glass) {
    const cands = own.filter((w) => (w.kind === 'wall' || w.kind === 'roof') && w.zone_b === 'outside' && w.area_m2 > 0 && Math.abs(w.tilt_deg - g.tilt_deg) < 1e-6 && Math.abs((w.azimuth_deg ?? 0) - (g.azimuth_deg ?? 0)) < 1e-6)
    if (cands.length) hostOf.set(g.id, cands.reduce((a, b) => (b.area_m2 > a.area_m2 ? b : a)))
  }
  const out = new Map<string, { host: string; height_m: number }>()
  const height = zone.height_m * zone.storeys
  for (const g of glass) {
    const host = hostOf.get(g.id)
    if (!host) continue
    const gross = host.area_m2 + glass.filter((x) => hostOf.get(x.id) === host).reduce((t, x) => t + x.area_m2, 0)
    const h = hostRectHeight(host.tilt_deg, gross, height)
    out.set(g.id, { host: host.id, height_m: h - 2 * windowMargin(h) })
  }
  return out
}
/** A host surface's rectangle height, m (the translator draws it so). */
export function hostRectHeight(tilt_deg: number, gross_m2: number, zone_height_m: number): number {
  return tilt_deg > 45 && tilt_deg < 135 ? Math.max(1, Math.min(zone_height_m, gross_m2 / 2)) : Math.sqrt(gross_m2)
}
/** The wall left above and below a host's row of windows, m. */
export function windowMargin(host_height_m: number): number { return Math.min(0.02, host_height_m / 20) }

/** One face to outside air, as the film needs it. */
export interface OutsideFace {
  /** The wind at the face's centroid ÷ the weather file's (windFactorAt). */
  wind_factor: number
  azimuth_deg: number
  /** Cosine of the outward normal's angle from up (1 a flat roof, 0 a wall, −1 an exposed floor). */
  cos_tilt: number
  /** R_f, by the outside layer's roughness. */
  roughness: number
  /**
   * Brief 126: EnergyPlus's outside long-wave. The face's emissivity, its view to the ground ((1 − cos Σ)/2), to the sky
   * ((1 + cos Σ)/2·β) and to the air (the rest of the sky view), β = √((1 + cos Σ)/2).
   */
  emissivity: number
  view_ground: number
  view_sky: number
  view_air: number
}

export function outsideFace(z_m: number, terrain: EpTerrain, azimuth_deg: number, tilt_deg: number, glazing: boolean, emissivity = 0.9): OutsideFace {
  const c0 = Math.cos((tilt_deg * Math.PI) / 180), c = Math.abs(c0) < 1e-12 ? 0 : c0
  const fs = (1 + c) / 2, beta = Math.sqrt(fs)
  return {
    wind_factor: windFactorAt(z_m, terrain), azimuth_deg, cos_tilt: c,
    roughness: glazing ? K.doe2_roughness_glazing : K.doe2_roughness_opaque,
    emissivity, view_ground: (1 - c) / 2, view_sky: fs * beta, view_air: fs * (1 - beta),
  }
}

/** ε·σ·(T_s² + T_x²)(T_s + T_x), the linearised long-wave coefficient between a face at ts and a body at tx (°C), per unit view. */
export function radiantH(emissivity: number, ts: number, tx: number): number {
  const a = ts + 273.15, b = tx + 273.15
  return emissivity * K.sigma * (a * a + b * b) * (a + b)
}

/**
 * Brief 126: a face's outside long-wave as EnergyPlus works it out, from its temperature the step before (ts), the
 * outdoor air (te, also the ground's) and the sky (tsky). out.total: the coefficient to the outdoor air if the sky were
 * at the air, W/m²K; out.sky: the sky's own share, so the exchange is total·(te − T_s) + sky·(tsky − te).
 */
export function outsideLongwave(f: OutsideFace, ts: number, te: number, tsky: number, out: { total: number; sky: number }) {
  const hAir = radiantH(f.emissivity, ts, te)
  out.sky = f.view_sky * radiantH(f.emissivity, ts, tsky)
  out.total = (f.view_ground + f.view_air) * hAir + out.sky
  return out
}

/**
 * The sky's infrared per hour, W/m²: the weather file's horizontal infrared, or where that is missing, EnergyPlus's
 * Clark and Allen sky (emissivity from the dew point and opaque cover in tenths, at the dry bulb). Null: no hours.
 */
export function skyInfrared(hours: { count: number; dry_bulb: ArrayLike<number>; dew_point: ArrayLike<number>; opaque_sky_cover: ArrayLike<number>; horizontal_infrared?: ArrayLike<number> | null }): { ir: Float64Array; estimated: number } {
  const ir = new Float64Array(hours.count)
  let estimated = 0
  for (let h = 0; h < hours.count; h++) {
    const v = hours.horizontal_infrared ? hours.horizontal_infrared[h] : NaN
    if (Number.isFinite(v)) { ir[h] = v; continue }
    estimated++
    const n = hours.opaque_sky_cover[h] >= 0 && hours.opaque_sky_cover[h] <= 10 ? hours.opaque_sky_cover[h] : 0
    const e = (K.clark_allen_a + K.clark_allen_b * Math.log((hours.dew_point[h] + 273.15) / 273)) * (1 + K.clark_allen_n1 * n + K.clark_allen_n2 * n * n + K.clark_allen_n3 * n * n * n)
    ir[h] = e * K.sigma * Math.pow(hours.dry_bulb[h] + 273.15, 4)
  }
  return { ir, estimated }
}

/**
 * Brief 126: the outdoor air's volumetric heat capacity as EnergyPlus takes it for infiltration and ventilation, J/m³K:
 * ρ = p / (287·T·(1 + 1.6078·w)) at the outdoor dry bulb (EnergyPlus PsyRhoAirFnPbTdbW), c_p = 1004.84 + 1858.95·w
 * (PsyCpAirFnW).
 */
export function outdoorAirRhoCp(te: number, p: number, w: number): number {
  return (p / (287.0 * (te + 273.15) * (1 + 1.6078 * w))) * (1004.84 + 1858.95 * w)
}

/** The glass layer's resistance EnergyPlus's Simple Window Model takes from a stated U, m²K/W. */
export function simpleGlazingLayerR(u: number): number {
  const ri = u <= K.simple_glazing_ri_u_split ? 1 / (K.simple_glazing_ri_ln_a * Math.log(u) + K.simple_glazing_ri_ln_b) : 1 / (K.simple_glazing_ri_lin_a * u - K.simple_glazing_ri_lin_b)
  const ro = 1 / (K.simple_glazing_ro_a * u + K.simple_glazing_ro_b)
  return 1 / u - ri - ro
}

/**
 * A window's inside convection, EnergyPlus's ISO 15099 (its TARP for windows), W/m²K: ts the glass, ta the room air
 * (°C), height_m the glass's height, tilt_deg the window's outward tilt from up, p the air pressure (Pa) and w its
 * humidity ratio. A face warmer than the air takes the tilt from the other side (ISO 15099 8.3.2.2).
 */
export function iso15099Inside(ts: number, ta: number, height_m: number, tilt_deg: number, p: number, w: number): number {
  const dT = Math.abs(ts - ta)
  if (!(dT > 0)) return K.h_ci_tarp_min
  const T = ta + 0.25 * (ts - ta) + 273.15
  const rho = p / (287.0 * T * (1 + 1.6078 * w))
  const lambda = K.iso15099_lambda_a + K.iso15099_lambda_b * T, mu = K.iso15099_mu_a + K.iso15099_mu_b * T, cp = K.iso15099_cp_a + K.iso15099_cp_b * T
  const ra = (rho * rho * height_m ** 3 * K.gravity * cp * dT) / (T * mu * lambda)
  const tilt = ts > ta ? 180 - tilt_deg : tilt_deg
  const sin = Math.sin((tilt * Math.PI) / 180)
  let nu: number
  if (tilt < 15) nu = 0.13 * Math.cbrt(ra)
  else if (tilt <= 90) {
    const racv = (2.5e5 * Math.exp(0.72 * tilt)) / sin
    nu = ra <= racv ? 0.56 * Math.pow(ra * sin, 0.25) : 0.13 * (Math.cbrt(ra) - Math.cbrt(racv)) + 0.56 * Math.pow(racv * sin, 0.25)
  } else if (tilt <= 179) nu = 0.56 * Math.pow(ra * sin, 0.25)
  else nu = 0.58 * Math.pow(ra, 0.2)
  return Math.max(K.h_ci_tarp_min, (nu * lambda) / height_m)
}

/** Walton's natural convection on an outside face (EnergyPlus CalcASHRAETARPNatural), dT = face − outdoor air. */
export function naturalFilm(dT: number, cos_tilt: number): number {
  const a = Math.cbrt(Math.abs(dT))
  if (a === 0) return 0
  // Unstable: a warm face looking up, a cool face looking down; a vertical face takes either (both ≈ 1.31·|ΔT|^⅓).
  const unstable = (dT > 0 && cos_tilt > 0) || (dT < 0 && cos_tilt < 0)
  const c = Math.abs(cos_tilt)
  return unstable ? (K.tarp_unstable_a * a) / (K.tarp_unstable_b - c) : (K.tarp_stable_a * a) / (K.tarp_stable_b + c)
}

/** DOE-2's coefficient for one face in a dry step, W/m²K: v the weather's wind (m/s), dir its direction (° from north). */
export function doe2Film(f: OutsideFace, dT: number, v: number, dir: number): number {
  const hn = naturalFilm(dT, f.cos_tilt)
  const V = f.wind_factor * Math.max(0, v)
  let windward = Math.abs(f.cos_tilt) >= K.doe2_horizontal_cos
  if (!windward) {
    let d = Math.abs(dir - f.azimuth_deg)
    if (d > 180) d = 360 - d
    windward = d <= K.doe2_leeward_beyond_deg
  }
  const hf = V > 0 ? (windward ? K.doe2_windward_a * Math.pow(V, K.doe2_windward_b) : K.doe2_leeward_a * Math.pow(V, K.doe2_leeward_b)) : 0
  const h = hn + f.roughness * (Math.sqrt(hn * hn + hf * hf) - hn)
  return Math.max(K.h_ce_min, h)
}

/** The weather the film reads, hourly; rain inputs null when the file does not carry them. */
export interface FilmWeather {
  wind_speed: ArrayLike<number>
  wind_direction: ArrayLike<number>
  /** Humidity ratio, kg/kg, and pressure, Pa, per hour (airWeather's, one read). */
  w: ArrayLike<number>
  pressure: ArrayLike<number>
  /** 1 where the present weather says rain (observation 0, a first-three code digit below 9), else 0; null: not in the file. */
  rain_code: ArrayLike<number> | null
  /** Liquid precipitation depth, mm (missing read as 0); null: not in the file. */
  precipitation_mm: ArrayLike<number> | null
  /** Brief 126: the sky's infrared per hour, W/m² (skyInfrared); null keeps ISO 52016-1's fixed sky (11 K below the air). */
  sky_ir?: ArrayLike<number> | null
}

/** One step's weather for the film: wind, direction, raining and the wet bulb (when raining). */
export interface FilmStep { v: number; dir: number; rain: boolean; wet_bulb: number; t_sky?: number }

/**
 * The step's weather at fraction `frac` through hour h (1: its end), read between hours as EnergyPlus does: on a line
 * from the hour before, wind direction the short way round; te is the step's outdoor dry bulb.
 */
export function filmStep(wx: FilmWeather, h: number, frac: number, te: number, out: FilmStep): FilmStep {
  const hp = h > 0 ? h - 1 : Math.min(23, wx.wind_speed.length - 1)
  const lin = (a: ArrayLike<number>) => a[hp] + (a[h] - a[hp]) * frac
  out.v = lin(wx.wind_speed)
  const d0 = wx.wind_direction[hp], dd = ((wx.wind_direction[h] - d0) % 360 + 540) % 360 - 180
  out.dir = (d0 + dd * frac + 360) % 360
  out.rain = (wx.rain_code != null && lin(wx.rain_code) >= K.rain_code_at_least) || (wx.precipitation_mm != null && lin(wx.precipitation_mm) >= K.rain_precipitation_mm)
  out.wet_bulb = out.rain ? wetBulb(te, lin(wx.w), lin(wx.pressure)) : te
  // The sky: its infrared read between hours, then its temperature (as EnergyPlus).
  if (wx.sky_ir) out.t_sky = Math.pow(lin(wx.sky_ir) / K.sigma, 0.25) - 273.15
  return out
}

/** Rain inputs from the EPW's own fields (epw.ts), or null when absent. */
export function rainInputs(hours: { present_weather_observation?: ArrayLike<number> | null; present_weather_codes?: readonly string[] | null; liquid_precipitation_mm?: ArrayLike<number> | null; count: number }) {
  const obs = hours.present_weather_observation, codes = hours.present_weather_codes
  let rain_code: Float64Array | null = null
  if (obs && codes) {
    rain_code = new Float64Array(hours.count)
    for (let h = 0; h < hours.count; h++) {
      const c = codes[h] ?? ''
      rain_code[h] = obs[h] === 0 && [0, 1, 2].some((i) => c[i] != null && c[i] >= '0' && c[i] < '9') ? 1 : 0
    }
  }
  let precipitation_mm: Float64Array | null = null
  if (hours.liquid_precipitation_mm) {
    precipitation_mm = Float64Array.from(hours.liquid_precipitation_mm, (p) => (p >= 0 && p < 999 ? p : 0))
  }
  return { rain_code, precipitation_mm }
}
