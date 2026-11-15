/**
 * Simulate v2 Engine 1 (Brief 103 Part 2): solar position and irradiance on any surface.
 *
 * Provenance: ported from frontend/src/utils/solarCalc.js (blob 67ef3fa17794, last changed in 0d68618; the
 * Brief 26 Part 2.5d azimuth fix included). Diverged: generalised from four vertical facades plus a horizontal roof to
 * any azimuth and tilt. Physics is unchanged where the two overlap, so a vertical or horizontal surface gives
 * today's numbers exactly (Part 2 gate).
 *
 * Method (as today): sun position from Cooper's declination and the hour angle at the hour's midpoint; isotropic sky
 * diffuse; ground reflection of DNI·sin(α) + DHI with a stated albedo. ASHRAE Handbook of Fundamentals 2021, Ch. 14.
 * Stated options, never silent changes: solar time is the EPW clock hour ('clock', today) or apparent solar time
 * ('apparent', Part 4); the day used for the sun position is 'mid_month' (today) or 'actual'; the sky is isotropic
 * (today) or Perez ('perez', Brief 104 Part 1b).
 */
import type { SurfaceIrradiance, Weather } from './types'

const DEG = Math.PI / 180
const MONTH_START_DAY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

export interface SolarOptions {
  /** Ground reflectance, 0 to 1. Today's engine uses 0.2. */
  albedo: number
  /** Which day of the month positions the sun: 'mid_month' (the 15th, today's engine) or 'actual' (the EPW day). */
  sun_day: 'mid_month' | 'actual'
  /**
   * 'clock': the EPW clock hour is taken as solar time (today's engine). 'apparent': the clock hour is corrected to
   * apparent solar time by longitude and the equation of time (Duffie & Beckman 4th ed. eqs. 1.5.2–1.5.3), as
   * ISO 52010-1 and EnergyPlus do.
   */
  solar_time: 'clock' | 'apparent'
  /**
   * Sky diffuse on a tilted surface (Brief 104 Part 1b). Absent or 'isotropic': DHI · (1 + cos β) / 2 (today's
   * engine). 'perez': Perez et al. (1990), the anisotropic model ISO 52010-1 specifies, with circumsolar and horizon
   * brightening; coefficients, air mass and the 85° cap as EnergyPlus 25.2.0 implements them (SolarShading.cc,
   * AnisoSkyViewFactors), which is the referee's own sky.
   */
  sky?: 'isotropic' | 'perez'
}

// Perez 1990 coefficients by sky-clearness bin (upper limits 1.065 … 6.2), as EnergyPlus 25.2.0 holds them.
const EPS_LIMIT = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2]
const F11 = [-0.0083117, 0.1299457, 0.3296958, 0.5682053, 0.8730280, 1.1326077, 1.0601591, 0.6777470]
const F12 = [0.5877285, 0.6825954, 0.4868735, 0.1874525, -0.3920403, -1.2367284, -1.5999137, -0.3272588]
const F13 = [-0.0620636, -0.1513752, -0.2210958, -0.2951290, -0.3616149, -0.4118494, -0.3589221, -0.2504286]
const F21 = [-0.0596012, -0.0189325, 0.0554140, 0.1088631, 0.2255647, 0.2877813, 0.2642124, 0.1561313]
const F22 = [0.0721249, 0.0659650, -0.0639588, -0.1519229, -0.4620442, -0.8230357, -1.1272340, -1.3765031]
const F23 = [-0.0220216, -0.0288748, -0.0260542, -0.0139754, 0.0012448, 0.0558651, 0.1310694, 0.2506212]

/** Perez F1 (circumsolar) and F2 (horizon) for one hour; the sun is up and DHI > 0. */
function perezF(sinAlt: number, dni: number, dhi: number, elevationM: number): [number, number] {
  const cosZ = sinAlt
  const z = Math.acos(Math.min(1, Math.max(-1, cosZ)))
  const zDeg = z / DEG
  const mH = 1 - (0.1 * elevationM) / 1000
  const m = zDeg <= 75 ? mH / cosZ : mH / (cosZ + 0.15 * Math.pow(93.9 - zDeg, -1.253))
  const k = 1.041 * z ** 3
  const eps = ((dni + dhi) / dhi + k) / (1 + k)
  const delta = (dhi * m) / 1353
  let b = 0
  while (b < 7 && eps >= EPS_LIMIT[b]) b++
  return [Math.max(0, F11[b] + F12[b] * delta + F13[b] * z), F21[b] + F22[b] * delta + F23[b] * z]
}

/** Minutes of apparent solar time ahead of local standard time (Duffie & Beckman eq. 1.5.2–1.5.3). */
export function solarTimeOffsetMin(dayOfYear: number, longitudeDeg: number, timeZoneH: number): number {
  const B = (2 * Math.PI * (dayOfYear - 1)) / 365
  const E = 229.2 * (0.000075 + 0.001868 * Math.cos(B) - 0.032077 * Math.sin(B) - 0.014615 * Math.cos(2 * B) - 0.04089 * Math.sin(2 * B))
  return 4 * (longitudeDeg - 15 * timeZoneH) + E
}

export interface SunPosition {
  /** Radians above the horizon; 0 when below. */
  altitude: number
  /** Radians from north, clockwise. */
  azimuth: number
  above_horizon: boolean
}

/** Sun position at a solar hour (e.g. 11.5 for 11:00 to 12:00) on a day of the year. Ported as-is. */
export function sunPosition(latitudeDeg: number, dayOfYear: number, solarHour: number): SunPosition {
  const lat = latitudeDeg * DEG
  const decl = 23.45 * DEG * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365)
  const hourAngle = (solarHour - 12) * 15 * DEG
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  if (sinAlt <= 0) return { altitude: 0, azimuth: 0, above_horizon: false }
  const altitude = Math.asin(sinAlt)
  const cosAlt = Math.cos(altitude)
  const cosAzFromN = (Math.sin(decl) - Math.sin(lat) * sinAlt) / (Math.cos(lat) * (cosAlt > 1e-6 ? cosAlt : 1e-6))
  const azFromN = Math.acos(Math.max(-1, Math.min(1, cosAzFromN)))
  const azimuth = hourAngle >= 0 ? 2 * Math.PI - azFromN : azFromN
  return { altitude, azimuth, above_horizon: true }
}

/** The sun's hourly position depends only on the weather's site and calendar and the options: computed once and shared by every surface. */
const tracks = new WeakMap<Weather, Map<string, { up: Uint8Array; sinAlt: Float64Array; cosAlt: Float64Array; az: Float64Array }>>()
function sunTrack(weather: Weather, options: SolarOptions) {
  let byOpt = tracks.get(weather)
  if (!byOpt) { byOpt = new Map(); tracks.set(weather, byOpt) }
  const key = `${options.sun_day}|${options.solar_time}`
  const hit = byOpt.get(key)
  if (hit) return hit
  const h = weather.hours, n = h.count
  const { longitude, time_zone } = weather.header
  const t = { up: new Uint8Array(n), sinAlt: new Float64Array(n), cosAlt: new Float64Array(n), az: new Float64Array(n) }
  for (let i = 0; i < n; i++) {
    const doy = MONTH_START_DAY[h.month[i] - 1] + (options.sun_day === 'mid_month' ? 15 : h.day[i])
    const shift = options.solar_time === 'apparent' ? solarTimeOffsetMin(MONTH_START_DAY[h.month[i] - 1] + h.day[i], longitude, time_zone) / 60 : 0
    const p = sunPosition(weather.header.latitude, doy, h.hour[i] - 0.5 + shift)
    if (!p.above_horizon) continue
    t.up[i] = 1; t.sinAlt[i] = Math.sin(p.altitude); t.cosAlt[i] = Math.cos(p.altitude); t.az[i] = p.azimuth
  }
  byOpt.set(key, t)
  return t
}

function check(name: string, v: number, lo: number, hi: number) {
  if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`solarOnSurface: ${name} must be between ${lo} and ${hi} (got ${v})`)
}

/**
 * Hourly irradiance on a plane surface. `azimuthDeg` is the outward normal from north, clockwise; `tiltDeg` is from
 * horizontal (0 = facing up, 90 = vertical). Night hours, and hours with the sun below the horizon, are zero (as today).
 *
 *   cos θ     = sin α · cos β + cos α · sin β · cos(γ_sun − γ_surface)
 *   direct    = DNI · max(0, cos θ)
 *   diffuse   = DHI · (1 + cos β) / 2
 *   reflected = (DNI · sin α + DHI) · albedo · (1 − cos β) / 2
 */
export function solarOnSurface(weather: Weather, azimuthDeg: number, tiltDeg: number, options: SolarOptions): SurfaceIrradiance {
  check('azimuth', azimuthDeg, -720, 720)
  check('tilt', tiltDeg, 0, 180)
  check('albedo', options?.albedo, 0, 1)
  if (options.sun_day !== 'mid_month' && options.sun_day !== 'actual') throw new Error(`solarOnSurface: sun_day must be 'mid_month' or 'actual'`)
  if (options.solar_time !== 'clock' && options.solar_time !== 'apparent') throw new Error(`solarOnSurface: solar_time must be 'clock' or 'apparent'`)
  const perez = options.sky === 'perez'
  if (options.sky != null && options.sky !== 'isotropic' && !perez) throw new Error(`solarOnSurface: sky must be 'isotropic' or 'perez'`)
  const h = weather.hours
  const n = h.count
  const sun = sunTrack(weather, options)
  const out: SurfaceIrradiance = { direct: new Float64Array(n), diffuse: new Float64Array(n), reflected: new Float64Array(n), total: new Float64Array(n), cos_incidence: new Float64Array(n) }
  const gs = azimuthDeg * DEG
  const beta = tiltDeg * DEG
  const cosB = Math.abs(Math.cos(beta)) < 1e-12 ? 0 : Math.cos(beta)
  const sinB = Math.sin(beta)
  const skyVf = (1 + cosB) / 2
  const gndVf = (1 - cosB) / 2
  for (let i = 0; i < n; i++) {
    const dn = h.direct_normal[i], dh = h.diffuse_horizontal[i]
    if (dn === 0 && dh === 0) continue
    if (!sun.up[i]) continue
    const sinA = sun.sinAlt[i], cosA = sun.cosAlt[i]
    const cosT = sinA * cosB + cosA * sinB * Math.cos(sun.az[i] - gs)
    const direct = cosT > 0 ? dn * cosT : 0
    let diffuse = dh * skyVf
    if (perez && dh > 0) {
      const [F1, F2] = perezF(sinA, dn, dh, weather.header.elevation)
      // Circumsolar: cos θ / max(cos 85°, cos z), with EnergyPlus's exception for a flat surface at a low sun.
      let cs = Math.max(0, cosT) / Math.max(0.0871557, sinA)
      if (cs > 0 && sinA < 0.0871557 && tiltDeg < 2) cs = 1
      diffuse = Math.max(0, dh * (skyVf * (1 - F1) + F1 * cs + F2 * sinB))
    }
    const reflected = (dn * sinA + dh) * options.albedo * gndVf
    out.direct[i] = direct
    out.cos_incidence[i] = cosT > 0 ? cosT : 0
    out.diffuse[i] = diffuse
    out.reflected[i] = reflected
    out.total[i] = Math.max(0, direct + diffuse + reflected)
  }
  return out
}
