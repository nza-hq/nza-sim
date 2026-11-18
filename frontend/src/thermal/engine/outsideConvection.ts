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

/** One face to outside air, as the film needs it. */
export interface OutsideFace {
  /** The wind at the face's centroid ÷ the weather file's (windFactorAt). */
  wind_factor: number
  azimuth_deg: number
  /** Cosine of the outward normal's angle from up (1 a flat roof, 0 a wall, −1 an exposed floor). */
  cos_tilt: number
  /** R_f, by the outside layer's roughness. */
  roughness: number
}

export function outsideFace(z_m: number, terrain: EpTerrain, azimuth_deg: number, tilt_deg: number, glazing: boolean): OutsideFace {
  const c = Math.cos((tilt_deg * Math.PI) / 180)
  return {
    wind_factor: windFactorAt(z_m, terrain), azimuth_deg, cos_tilt: Math.abs(c) < 1e-12 ? 0 : c,
    roughness: glazing ? K.doe2_roughness_glazing : K.doe2_roughness_opaque,
  }
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
}

/** One step's weather for the film: wind, direction, raining and the wet bulb (when raining). */
export interface FilmStep { v: number; dir: number; rain: boolean; wet_bulb: number }

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
