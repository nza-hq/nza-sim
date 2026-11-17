/**
 * Brief 115: weather-driven air leakage, vents and windows, room by room, every time step.
 *
 * Each room is a node with one unknown pressure P_z. Every opening to outside is a path between the room and the
 * outdoor air at its height. With the outdoor static pressure at ground level as zero, the pressure across a path at
 * height z (outside minus inside, positive into the room) is
 *
 *   Δp = Cp·½·ρ_w·U(z)²  +  g·z·(ρ_z − ρ_o)  −  P_z
 *
 * and P_z is the pressure that makes the mass flows in and out balance (Newton, kept inside a bracket). This is
 * EnergyPlus AirflowNetwork's multizone model for one zone with no distribution system, written term for term from its
 * source (EnergyPlus v25.2.0, src/EnergyPlus/AirflowNetwork/src/Elements.cpp `SurfaceCrack::calculate`,
 * `SimpleOpening::calculate`; Solver.cpp air properties, stack pressures, `calculate_wind_pressure`,
 * `venting_control`), so the referee (docs/audit/115/) compares like with like:
 *
 *   wind      U(z) = U_met · (270/10)^0.14 · (z/δ)^a, terrain a, δ: open 0.14/270, suburban 0.22/370,
 *             urban 0.22/370, city 0.33/460 (EnergyPlus Site terrain Country, Suburbs, Urban, City;
 *             DataEnvironment::WindSpeedAt; the weather file's wind is at 10 m in open country)
 *   Cp        Swami and Chandra's low-rise surface average for walls (as EnergyPlus's SurfaceAverageCalculation),
 *             tabulated every 10° of wind direction and read between by straight lines, as EnergyPlus reads a
 *             WindPressureCoefficientValues table; G = ln(this facade's width ÷ the adjacent one's), widths from the
 *             building's outside wall and glazing area facing each way
 *   air       ρ = P / (287·(T + 273.15)·(1 + 1.6077687·w)), cp = 1004.84 + 1858.95·w, μ = 1.71432e-5 + 4.828e-8·T;
 *             the wind's ρ at the hour's barometric pressure, the stack's at the site's standard pressure from its
 *             elevation; w from the hour's dew point, the same inside and out (no moisture is added in a room)
 *   cracks    m = k·C_T·|Δp|^n (or the laminar k·C_T·√ρ/μ·Δp when smaller), C_T = (ρ_ref/ρ_up/(T_up/T_ave))^(n−1)·
 *             (μ_ref/μ_ave)^(2n−1), reference 20 °C, 101 325 Pa, dry; k = ρ_ref·q50·A_env/3600/50^n (kg/s at 1 Pa)
 *   openings  a window is a large opening, Cd·width·height, with two-way flow over its height when the room and
 *             outside differ in density (the analytic integral EnergyPlus's SimpleOpening uses); a permanent vent is
 *             an orifice, m = Cd·A·√(2·ρ_up·|Δp|)
 *   heat      each path's air coming in brings cp·m·(θ_e − θ_z): a conductance cp·m_in, W/K, per line
 *
 * Where the leakage goes: each room's leakage (its q50 × its envelope area, as today's method) is shared over its
 * outside walls by area, each wall's in three equal bands over the room's height (stated: roof and floor leakage is
 * put on the walls, because a roof's pressure coefficient is not in this brief). Windows (glazing) leak nothing when
 * shut. Heights are above the ground: a zone's floor is at its storey × its storey height.
 *
 * Windows open by the zone's window entry on the control map (one per zone). Its opening profile (`hours_ref`, a
 * schedule) gives each hour's value, 0 to 1: how far the windows may open that hour (0 shut; none: 1 every hour).
 * 'temperature': open when the room (last step) is warmer than outside and than the threshold (`open_above_c`, or the
 * hour's value of the temperature profile `open_above_ref`), by `open_fraction` × the profile's value (× the
 * modulation, as EnergyPlus's: 1 at or below the lower difference, `min_fraction` at or above the upper, straight
 * between). 'timetable': open by `open_fraction` × the profile's value. A window's widest opening is its
 * `openable_fraction` × its style's angle factor (`windowEffectiveArea`).
 *
 * Single-sided turbulence (switchable, `building.air.single_sided_turbulence`): when every open window in a room is on
 * one facade, EN 16798-7's single-sided wind term q = ½·A_open·√0.001·U₁₀ (m³/s) is added as its own line (U₁₀ the
 * wind at 10 m on site). Not refereed: EnergyPlus has no exact counterpart (stated).
 */

export class AirflowError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'AirflowError' }
}

export const AIR = {
  g: 9.8,  // EnergyPlus AirflowNetwork's stack pressures and SimpleOpening use 9.8
  met: { exponent: 0.14, boundary_m: 270, height_m: 10 },
  terrain: {
    open: { exponent: 0.14, boundary_m: 270 },
    suburban: { exponent: 0.22, boundary_m: 370 },
    urban: { exponent: 0.22, boundary_m: 370 },
    city: { exponent: 0.33, boundary_m: 460 },
  },
  ref: { t_c: 20, p_pa: 101325, w: 0 },
  crack_bands: 3,
  /** EN 16798-7's single-sided wind coefficient C_wnd (1/(m/s)), as in EN 15242. */
  c_wnd: 0.001,
  /** EnergyPlus SimpleOpening's default least density difference for two-way flow, kg/m³. */
  min_rho_diff: 1e-4,
} as const

export type Terrain = keyof typeof AIR.terrain

/** The wind at height z ÷ the weather file's wind (EnergyPlus DataEnvironment::WindSpeedAt). */
export function windFactor(z: number, terrain: Terrain): number {
  if (!(z > 0)) return 0
  const t = AIR.terrain[terrain]
  return Math.pow(AIR.met.boundary_m / AIR.met.height_m, AIR.met.exponent) * Math.pow(z / t.boundary_m, t.exponent)
}

export const rhoAir = (p: number, t: number, w: number) => p / (287.0 * (t + 273.15) * (1 + 1.6077687 * Math.max(w, 1e-5)))
export const cpAir = (w: number) => 1.00484e3 + 1.85895e3 * w
export const muAir = (t: number) => 1.71432e-5 + 4.828e-8 * t
/** EnergyPlus's standard barometric pressure at an elevation, Pa. */
export const stdPressure = (elevation_m: number) => 101325 * Math.pow(1 - 2.25577e-5 * elevation_m, 5.2559)
/** Humidity ratio from the dew point (saturation pressure by Magnus, Alduchov and Eskridge 1996), kg/kg. */
export function humidityRatio(dewPoint: number, p: number): number {
  const pv = 610.94 * Math.exp((17.625 * dewPoint) / (dewPoint + 243.04))
  return Math.max(0, (0.621945 * pv) / (p - pv))
}
const RHO_REF = rhoAir(AIR.ref.p_pa, AIR.ref.t_c, AIR.ref.w)
const MU_REF = muAir(AIR.ref.t_c)

/** Swami and Chandra's low-rise wall surface-average Cp at incidence α (radians, 0 to π) and G = ln(side ratio). */
export function swamiChandra(alpha: number, G: number): number {
  const s2 = Math.sin(alpha / 2), c2 = Math.cos(alpha / 2), s = Math.sin(alpha), s3 = Math.sin(2 * alpha * G)
  return 0.6 * Math.log(1.248 - 0.703 * s2 - 1.175 * s * s + 0.131 * s3 * s3 * s3 + 0.769 * c2 + 0.07 * G * G * s2 * s2 + 0.717 * c2 * c2)
}

/** A facade's Cp every 10° of wind direction (0, 10, … 350), for its outward azimuth and side ratio. */
export function cpTable(azimuth_deg: number, G: number): Float64Array {
  const t = new Float64Array(36)
  for (let i = 0; i < 36; i++) {
    let a = Math.abs(((i * 10 - azimuth_deg) % 360 + 360) % 360)
    if (a > 180) a = 360 - a
    t[i] = swamiChandra((a * Math.PI) / 180, G)
  }
  return t
}
export function cpAt(table: ArrayLike<number>, windDir: number): number {
  const d = ((windDir % 360) + 360) % 360
  const i = Math.floor(d / 10), f = (d - 10 * i) / 10
  return table[i % 36] * (1 - f) + table[(i + 1) % 36] * f
}

/**
 * Brief 115, Rule 11: a window's widest effective opening as a share of its glazing area: `openable_fraction` × its
 * style's factor. Hung and pivot windows: the opening-angle factor after EN 16798-7 (from EN 15242),
 * C(α) = 2.60e-7·α³ − 1.19e-4·α² + 1.86e-2·α (α in degrees), held to 0..1; sliding and louvre windows: 1 (the
 * louvre's own restriction is in its stated cd). The engine, the display and the referee writer read this one.
 */
export function windowEffectiveArea(o: { openable_fraction: number; style?: string; opening_angle_deg?: number | null }, path: string): number {
  if (!(o.openable_fraction >= 0 && o.openable_fraction <= 1)) throw new AirflowError('must be 0 to 1', `${path}.openable_fraction`)
  if (o.style == null) throw new AirflowError('say how the window opens (side_hung, top_hung, bottom_hung, centre_pivot, sliding or louvre)', `${path}.style`)
  if (o.style === 'sliding' || o.style === 'louvre') return o.openable_fraction
  const a = o.opening_angle_deg
  if (a == null) throw new AirflowError(`a ${o.style.replace('_', '-')} window needs its opening angle`, `${path}.opening_angle_deg`)
  const c = 2.6e-7 * a * a * a - 1.19e-4 * a * a + 1.86e-2 * a
  return o.openable_fraction * Math.min(1, Math.max(0, c))
}

export type AirLine = 'infiltration' | 'permanent_vents' | 'window_ventilation' | 'single_sided_turbulence'
export const AIR_LINES: readonly AirLine[] = ['infiltration', 'permanent_vents', 'window_ventilation', 'single_sided_turbulence']

interface Crack { z: number; wind: number; facade: number; k: number }
interface Vent { z: number; wind: number; facade: number; cdA: number }
interface Win { z_ref: number; wind: number; facade: number; cd: number; width: number; height: number; max_factor: number }

export interface WindowRule {
  rule: 'temperature' | 'timetable'
  open_fraction: number
  open_above_c: number | null
  /** The threshold each hour, °C, from a temperature profile (in place of open_above_c); null: open_above_c. */
  open_above_h: Float64Array | null
  /** The opening profile, 0..1 per hour (× open_fraction; 0 shut); null: 1 every hour. */
  hours: Float64Array | null
  modulation: { lower_dk: number; upper_dk: number; min_fraction: number } | null
}

export interface ZoneAirModel {
  n: number
  cracks: Crack[]
  vents: Vent[]
  windows: Win[]
  rule: WindowRule | null
  turbulence: boolean
  /** Cp tables, one per facade. */
  cp: Float64Array[]
  /** The site's 10 m wind ÷ the weather file's. */
  wind10: number
}

export interface AirWeather {
  dry_bulb: ArrayLike<number>
  wind_speed: ArrayLike<number>
  wind_direction: ArrayLike<number>
  w: Float64Array
  p_hour: ArrayLike<number>
  p_std: number
}

/** The weather the air model reads: humidity ratio per hour and the site's standard pressure. */
export function airWeather(hours: { dry_bulb: ArrayLike<number>; dew_point: ArrayLike<number>; pressure: ArrayLike<number>; wind_speed: ArrayLike<number>; wind_direction: ArrayLike<number>; count: number }, elevation_m: number): AirWeather {
  const w = new Float64Array(hours.count)
  for (let h = 0; h < hours.count; h++) w[h] = humidityRatio(hours.dew_point[h], hours.pressure[h])
  return { dry_bulb: hours.dry_bulb, wind_speed: hours.wind_speed, wind_direction: hours.wind_direction, w, p_hour: hours.pressure, p_std: stdPressure(elevation_m) }
}

const SCRATCH = new WeakMap<ZoneAirModel, { d0c: Float64Array; d0v: Float64Array; d0w: Float64Array; ww: Float64Array; rec: Float64Array; cpF: Float64Array; p: number }>()
function scratchOf(m: ZoneAirModel) {
  let s = SCRATCH.get(m)
  if (!s) {
    s = { d0c: new Float64Array(m.cracks.length), d0v: new Float64Array(m.vents.length), d0w: new Float64Array(m.windows.length), ww: new Float64Array(m.windows.length), rec: new Float64Array(3), cpF: new Float64Array(m.cp.length), p: NaN }
    SCRATCH.set(m, s)
  }
  return s
}

/** One step's state for the report: whether windows were open and the room's pressure. */
export interface AirStep { open_factor: number; p_z: number; iterations: number; /** Outdoor air coming in, kg/s (the turbulence term's too). */ m_in: number }

/**
 * One room, one step: the conductance of each line (W/K, in AIR_LINES order) into `out`, from the room's air
 * temperature at the last step, the outdoor temperature `te` this step and hour h's wind.
 */
export function zoneAirStep(m: ZoneAirModel, wx: AirWeather, h: number, room_c: number, te: number, out: Float64Array, frac = 1): AirStep {
  const w = wx.w[h]
  const rhoO = rhoAir(wx.p_std, te, w), rhoZ = rhoAir(wx.p_std, room_c, w)
  const muO = muAir(te), muZ = muAir(room_c), muAve = 0.5 * (muO + muZ)
  const tAveK = 0.5 * (te + room_c) + 273.15
  // Between hours (frac < 1) the wind is read on a straight line from the hour before, as the outdoor temperature is
  // and as EnergyPlus interpolates its weather between hours (direction the short way round).
  let U = wx.wind_speed[h], dir = wx.wind_direction[h]
  if (frac < 1) {
    const hp = h > 0 ? h - 1 : Math.min(23, wx.wind_speed.length - 1)
    U = wx.wind_speed[hp] + (U - wx.wind_speed[hp]) * frac
    const d0 = wx.wind_direction[hp], dd = ((dir - d0) % 360 + 540) % 360 - 180
    dir = (d0 + dd * frac + 360) % 360
  }
  const qw = 0.5 * rhoAir(wx.p_hour[h], te, w) * U * U
  const nexp = m.n
  // C_T for flow in (outside upwind) and out (room upwind).
  const ctIn = Math.pow(RHO_REF / rhoO / ((te + 273.15) / tAveK), nexp - 1) * Math.pow(MU_REF / muAve, 2 * nexp - 1)
  const ctOut = Math.pow(RHO_REF / rhoZ / ((room_c + 273.15) / tAveK), nexp - 1) * Math.pow(MU_REF / muAve, 2 * nexp - 1)
  const lamIn = Math.sqrt(rhoO) / muO, lamOut = Math.sqrt(rhoZ) / muZ
  const cpF = scratchOf(m).cpF
  for (let i = 0; i < m.cp.length; i++) cpF[i] = cpAt(m.cp[i], dir)
  const dRhoStack = AIR.g * (rhoZ - rhoO)

  // Window opening this step.
  let factor = 0
  const r = m.rule
  if (r && m.windows.length) {
    const prof = r.hours ? r.hours[h] : 1
    if (prof > 0) {
      if (r.rule === 'timetable') factor = r.open_fraction * prof
      else if (room_c > te && room_c > (r.open_above_h ? r.open_above_h[h] : (r.open_above_c as number))) {
        let mult = 1
        const md = r.modulation
        if (md && md.min_fraction !== 1) {
          const dT = room_c - te
          mult = dT <= md.lower_dk ? 1 : dT >= md.upper_dk ? md.min_fraction : md.min_fraction + ((md.upper_dk - dT) / (md.upper_dk - md.lower_dk)) * (1 - md.min_fraction)
        }
        factor = r.open_fraction * prof * mult
      }
    }
  }

  // Each path's pressure difference with the room at P = 0 (wind + stack), fixed this step.
  const nc = m.cracks.length, nv = m.vents.length, nw = factor > 0 ? m.windows.length : 0
  const sc = scratchOf(m)
  const d0c = sc.d0c, d0v = sc.d0v, d0w = sc.d0w, ww = sc.ww
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < nc; i++) { const c = m.cracks[i]; const d = cpF[c.facade] * qw * c.wind * c.wind + c.z * dRhoStack; d0c[i] = d; if (d < lo) lo = d; if (d > hi) hi = d }
  for (let i = 0; i < nv; i++) { const v = m.vents[i]; const d = cpF[v.facade] * qw * v.wind * v.wind + v.z * dRhoStack; d0v[i] = d; if (d < lo) lo = d; if (d > hi) hi = d }
  for (let i = 0; i < nw; i++) {
    const o = m.windows[i]
    // EnergyPlus SimpleOpening with node N = outside, M = the room; PDROP at the opening's reference height.
    const d = cpF[o.facade] * qw * o.wind * o.wind + o.z_ref * dRhoStack
    d0w[i] = d; ww[i] = o.width * o.max_factor * factor
    const top = d + o.height * dRhoStack
    if (d < lo) lo = d; if (d > hi) hi = d; if (top < lo) lo = top; if (top > hi) hi = top
  }
  const drho = rhoO - rhoZ, gd = AIR.g * drho, sN = Math.sqrt(rhoO), sM = Math.sqrt(rhoZ)
  const kIn = ctIn, kOut = ctOut
  // Net flow into the room at room pressure P (kg/s), its slope (−dF/dP) and Σ|F|; with `rec`, the inflow per line.
  let F_ = 0, D_ = 0, A_ = 0
  const flowAt = (P: number, rec: Float64Array | null) => {
    let f = 0, df = 0, sa = 0
    for (let i = 0; i < nc; i++) {
      const c = m.cracks[i]
      const dp = d0c[i] - P
      let F: number, D: number
      if (dp >= 0) {
        const FL = c.k * kIn * lamIn * dp, FT = dp > 0 ? c.k * kIn * Math.exp(nexp * Math.log(dp)) : 0
        if (FL <= FT) { F = FL; D = c.k * kIn * lamIn } else { F = FT; D = (FT * nexp) / dp }
      } else {
        const a = -dp
        const FL = c.k * kOut * lamOut * a, FT = c.k * kOut * Math.exp(nexp * Math.log(a))
        if (FL <= FT) { F = -FL; D = c.k * kOut * lamOut } else { F = -FT; D = (FT * nexp) / a }
      }
      f += F; df += D; sa += F < 0 ? -F : F
      if (rec && F > 0) rec[0] += F
    }
    for (let i = 0; i < nv; i++) {
      const dp = d0v[i] - P
      const a = dp < 0 ? -dp : dp
      const F = (dp >= 0 ? 1 : -1) * m.vents[i].cdA * Math.sqrt(2 * (dp >= 0 ? rhoO : rhoZ) * a)
      f += F; sa += F < 0 ? -F : F
      if (a > 1e-12) df += (F < 0 ? -F : F) / (2 * a)
      if (rec && F > 0) rec[1] += F
    }
    for (let i = 0; i < nw; i++) {
      const o = m.windows[i]
      const pdrop = d0w[i] - P
      const W = ww[i], Hh = o.height
      if ((drho < 0 ? -drho : drho) < AIR.min_rho_diff) {
        const dmid = pdrop - 0.5 * Hh * gd
        const a = dmid < 0 ? -dmid : dmid
        const F = (dmid >= 0 ? 1 : -1) * o.cd * W * Hh * Math.sqrt(2 * (dmid >= 0 ? rhoO : rhoZ) * a)
        f += F; sa += F < 0 ? -F : F; df += a > 1e-12 ? (F < 0 ? -F : F) / (2 * a) : 0
        if (rec && F > 0) rec[2] += F
        continue
      }
      const Y = pdrop / gd, C = Math.SQRT2 * W * o.cd, agd = gd < 0 ? -gd : gd
      const DF0 = (C * Math.sqrt(pdrop < 0 ? -pdrop : pdrop)) / agd
      const ay = Y < 0 ? -Y : Y
      const F0 = (2 / 3) * C * Math.sqrt(agd * ay) * ay
      const hy = Hh - Y, ahy = hy < 0 ? -hy : hy
      const DFH = C * Math.sqrt(ahy / agd)
      const FH = (2 / 3) * DFH * agd * ahy
      let a = 0, b = 0, da = 0, db = 0
      if (Y <= 0) {
        const x = FH - F0 < 0 ? F0 - FH : FH - F0, dx = DFH - DF0 < 0 ? DF0 - DFH : DFH - DF0
        if (drho >= 0) { a = -sM * x; da = sM * dx } else { a = sN * x; da = sN * dx }
      } else if (Y >= Hh) {
        const x = FH - F0 < 0 ? F0 - FH : FH - F0, dx = DFH - DF0 < 0 ? DF0 - DFH : DFH - DF0
        if (drho >= 0) { a = sN * x; da = sN * dx } else { a = -sM * x; da = sM * dx }
      } else if (drho >= 0) { a = -sM * FH; da = sM * DFH; b = sN * F0; db = sN * DF0 } else { a = sN * FH; da = sN * DFH; b = -sM * F0; db = sM * DF0 }
      f += a + b; df += da + db; sa += (a < 0 ? -a : a) + (b < 0 ? -b : b)
      if (rec) { if (a > 0) rec[2] += a; if (b > 0) rec[2] += b }
    }
    F_ = f; D_ = df; A_ = sa
  }

  for (let i = 0; i < 4; i++) out[i] = 0
  if (!(hi > -Infinity)) return { open_factor: factor, p_z: 0, iterations: 0, m_in: 0 }
  // The room's pressure lies between the paths' own (every flow one way beyond them). Newton inside that bracket; a
  // step that falls outside it, or two that do not halve the imbalance, give way to bisection (the openings'
  // derivatives are EnergyPlus's derivative factors, not always the true slope). Settled when the imbalance is below
  // 1e-6 of the flows through the room, or 1e-9 kg/s (0.004 g an hour).
  lo -= 1e-9; hi += 1e-9
  // Start from the room's pressure at the step before (it moves little from one step to the next).
  let P = sc.p > lo && sc.p < hi ? sc.p : 0.5 * (lo + hi), it = 0, slow = 0, last = Infinity
  for (; it < 200; it++) {
    flowAt(P, null)
    const f = F_, af = f < 0 ? -f : f
    if (af <= 1e-9 + 1e-6 * A_ || hi - lo < 1e-10) break
    if (f > 0) lo = P; else hi = P
    slow = af > 0.5 * last ? slow + 1 : 0
    last = af
    let next = D_ > 0 && slow < 2 ? P + f / D_ : NaN
    if (!(next > lo && next < hi)) { next = 0.5 * (lo + hi); slow = 0 }
    P = next
  }
  if (it >= 200) throw new AirflowError(`the room's air pressure did not settle at hour ${h}`, 'air')
  sc.p = P
  const rec = sc.rec
  rec[0] = 0; rec[1] = 0; rec[2] = 0
  flowAt(P, rec)
  const cp = cpAir(w)
  out[0] = cp * rec[0]; out[1] = cp * rec[1]; out[2] = cp * rec[2]
  let mt = 0
  if (m.turbulence && nw > 0) {
    const f0 = m.windows[0].facade
    if (m.windows.every((o) => o.facade === f0)) {
      let A = 0
      for (const o of m.windows) A += o.width * o.max_factor * factor * o.height
      mt = rhoO * 0.5 * A * Math.sqrt(AIR.c_wnd) * U * m.wind10
      out[3] = cp * mt
    }
  }
  return { open_factor: factor, p_z: P, iterations: it, m_in: rec[0] + rec[1] + rec[2] + mt }
}

// ─── Building the model from the document ─────────────────────────────────────────────────────────────────────────

interface DocLike {
  building: { air: { method: string; exponent: number | null; single_sided_turbulence: boolean | null }; site: { terrain?: string | null } }
  zones: { id: string; floor: number; storeys: number; height_m: number; infiltration_q50: number | null; infiltration_ach: number | null }[]
  surfaces: { id: string; kind: string; zone_a: string; zone_b: string; area_m2: number; azimuth_deg: number | null; tilt_deg: number; openings: any[] }[]
  controls: { id: string; target: { kind: string; ref: string }; rule: string | null; open_fraction: number | null; open_above_ref: string | null; open_above_c?: number | null; min_open_h: number | null; min_closed_h: number | null; modulation: { full_open_below_dk: number; min_open_above_dk: number; min_fraction: number } | null }[]
}

/**
 * Every zone's air model, from the document. `envelopeArea` is each zone's envelope area as today's method takes it;
 * `hoursOf` turns a schedule profile into hourly fractions; `windows` false leaves windows out (Rule 8: at "Fabric
 * only" and "+ Spaces" there are no windows in the run).
 */
export function buildAirModels(doc: DocLike, envelopeArea: number[], hoursOf: (ref: string, path: string) => Float64Array,
  tempOf: (ref: string, path: string) => Float64Array = (_r, p) => { throw new AirflowError('temperature profiles need the weather calendar', p) }): ZoneAirModel[] {
  const air = doc.building.air
  const terrain = doc.building.site.terrain as Terrain | null | undefined
  if (terrain == null || !(terrain in AIR.terrain)) throw new AirflowError('weather-driven air needs the terrain (open, suburban, urban or city)', 'building.site.terrain')
  const n = air.exponent
  if (n == null || !(n > 0 && n <= 1)) throw new AirflowError('the cracks\' flow exponent, above 0 and at most 1', 'building.air.exponent')
  // Facades: outside walls and glazing by outward azimuth (whole degrees); a facade's width is its area.
  const isOut = (s: DocLike['surfaces'][number]) => s.zone_b === 'outside' && (s.kind === 'wall' || s.kind === 'glazing') && s.tilt_deg > 45 && s.tilt_deg < 135
  const facadeArea = new Map<number, number>()
  for (const s of doc.surfaces) if (isOut(s)) {
    if (s.azimuth_deg == null) throw new AirflowError('an outside wall or window needs its azimuth for the wind', `surfaces[${doc.surfaces.indexOf(s)}].azimuth_deg`)
    const a = Math.round(s.azimuth_deg) % 360
    facadeArea.set(a, (facadeArea.get(a) ?? 0) + s.area_m2)
  }
  const near = (a: number) => { for (const [k, v] of facadeArea) { const d = Math.abs(((k - a) % 360 + 540) % 360 - 180); if (d <= 1) return v } return 0 }
  const tables = new Map<number, Float64Array>()
  const tableOf = (az: number) => {
    const a = Math.round(az) % 360
    if (!tables.has(a)) {
      const side = (near((a + 90) % 360) + near((a + 270) % 360)) / ((near((a + 90) % 360) > 0 ? 1 : 0) + (near((a + 270) % 360) > 0 ? 1 : 0) || 1)
      const G = side > 0 && facadeArea.get(a)! > 0 ? Math.log(facadeArea.get(a)! / side) : 0
      tables.set(a, cpTable(a, G))
    }
    return a
  }

  return doc.zones.map((zone, zi) => {
    const zp = `zones[${zi}]`
    const base = zone.floor * zone.height_m, Hz = zone.storeys * zone.height_m
    const facades: number[] = []
    const facadeIndex = (az: number) => { const a = tableOf(az); let i = facades.indexOf(a); if (i < 0) { facades.push(a); i = facades.length - 1 } return i }
    const mine = doc.surfaces.map((s, i) => ({ s, i })).filter(({ s }) => s.zone_a === zone.id)
    const walls = mine.filter(({ s }) => s.kind === 'wall' && isOut(s))
    // Leakage.
    if (zone.infiltration_q50 == null) throw new AirflowError('weather-driven air works from the room\'s air permeability q50 (m³/h·m² at 50 Pa)', `${zp}.infiltration_q50`)
    const q50 = zone.infiltration_q50
    const kTot = (RHO_REF * q50 * envelopeArea[zi]) / 3600 / Math.pow(50, n)
    const wallArea = walls.reduce((t, { s }) => t + s.area_m2, 0)
    const cracks: Crack[] = []
    if (kTot > 0) {
      if (!(wallArea > 0)) throw new AirflowError('a room with air leakage needs an outside wall to carry it (roof and floor leakage is put on the walls)', `${zp}.infiltration_q50`)
      for (const { s } of walls) for (let b = 0; b < AIR.crack_bands; b++) {
        const z = base + ((b + 0.5) * Hz) / AIR.crack_bands
        cracks.push({ z, wind: windFactor(z, terrain), facade: facadeIndex(s.azimuth_deg!), k: (kTot * s.area_m2) / wallArea / AIR.crack_bands })
      }
    }
    // Vents and windows.
    const vents: Vent[] = [], windows: Win[] = []
    for (const { s, i } of mine) s.openings.forEach((o: any, j: number) => {
      const p = `surfaces[${i}].openings[${j}]`
      if (o.kind === 'permanent_vent') {
        if (!(o.area_m2 > 0)) return
        if (!isOut(s)) throw new AirflowError('a vent opens to outside, in an outside wall', p)
        if (o.cd == null) throw new AirflowError('required', `${p}.cd`)
        if (o.height_m == null) throw new AirflowError('weather-driven air needs the vent\'s height above the room\'s floor', `${p}.height_m`)
        const z = base + o.height_m
        vents.push({ z, wind: windFactor(z, terrain), facade: facadeIndex(s.azimuth_deg!), cdA: o.cd * o.area_m2 })
      } else if (o.kind === 'operable') {
        if (s.kind !== 'glazing' || !isOut(s)) throw new AirflowError('an opening window belongs on an outside glazing surface', p)
        if (o.cd == null) throw new AirflowError('required', `${p}.cd`)
        if (o.sill_m == null || o.head_m == null || !(o.head_m > o.sill_m)) throw new AirflowError('the window\'s sill and head heights above the room\'s floor, head above sill', `${p}.sill_m`)
        const height = o.head_m - o.sill_m
        const zRef = base + o.sill_m
        windows.push({ z_ref: zRef, wind: windFactor(base + 0.5 * (o.sill_m + o.head_m), terrain), facade: facadeIndex(s.azimuth_deg!), cd: o.cd, width: s.area_m2 / height, height, max_factor: windowEffectiveArea(o, p) })
      }
    })
    // The zone's window rule.
    let rule: WindowRule | null = null
    if (windows.length) {
      const ci = doc.controls.findIndex((c) => c.target.kind === 'window' && c.target.ref === zone.id)
      if (ci < 0) throw new AirflowError(`zone "${zone.id}" has opening windows: give it a window rule on the control map`, `${zp}`)
      const c = doc.controls[ci], cp = `controls[${ci}]`
      if (c.rule == null) throw new AirflowError('the window rule: temperature or timetable', `${cp}.rule`)
      if (c.rule === 'adaptive') throw new AirflowError('adaptive window rules are not modelled yet (Brief 115 follow-up); use temperature or timetable', `${cp}.rule`)
      if (c.open_fraction == null) throw new AirflowError('how far the windows open, 0 to 1 of their widest', `${cp}.open_fraction`)
      if (c.min_open_h != null || c.min_closed_h != null) throw new AirflowError('least open and closed times are not modelled yet; leave empty', `${cp}.${c.min_open_h != null ? 'min_open_h' : 'min_closed_h'}`)
      if (c.open_above_ref != null && c.open_above_c != null) throw new AirflowError('the windows open above a temperature profile or one temperature: keep one', `${cp}.open_above_c`)
      if (c.rule === 'temperature' && c.open_above_c == null && c.open_above_ref == null) throw new AirflowError('a window that opens by temperature needs the temperature it opens above (one figure, or a temperature profile)', `${cp}.open_above_c`)
      const hrs = (c as any).hours_ref as string | null
      const md = c.modulation
      if (md && !(md.min_open_above_dk > md.full_open_below_dk)) throw new AirflowError('the upper difference must be above the lower', `${cp}.modulation`)
      rule = {
        rule: c.rule as 'temperature' | 'timetable', open_fraction: c.open_fraction, open_above_c: c.open_above_c ?? null,
        open_above_h: c.rule === 'temperature' && c.open_above_ref != null ? tempOf(c.open_above_ref, `${cp}.open_above_ref`) : null,
        hours: hrs != null ? hoursOf(hrs, `${cp}.hours_ref`) : null,
        modulation: md ? { lower_dk: md.full_open_below_dk, upper_dk: md.min_open_above_dk, min_fraction: md.min_fraction } : null,
      }
    }
    return { n, cracks, vents, windows, rule, turbulence: air.single_sided_turbulence === true, cp: facades.map((a) => tables.get(a)!), wind10: windFactor(10, terrain) }
  })
}
