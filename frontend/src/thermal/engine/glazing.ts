/**
 * A glazing system's normal-incidence solar optics from its U-value and SHGC (Brief 104 Part 1b).
 *
 * Source: the EnergyPlus Engineering Reference, "Simple Window Model" (WindowMaterial:SimpleGlazingSystem), which
 * implements Arasteh, Kohler and Griffith, "Modeling Windows in EnergyPlus with only U, SHGC, and optionally VT",
 * LBNL-2804E (2009). Each step below is that method's equation, in its order. It is a published method, used here so
 * that Engine 1 and the EnergyPlus referee describe the same window the same way; nothing is fitted.
 *
 * Checked against EnergyPlus 25.2.0's own derivation for the Bridgewater window (U 1.4, SHGC 0.441, eplusout.eio):
 * equivalent layer thickness 0.0458837 m, conductivity 0.0851890 W/mK, solar transmittance 0.357, absorptance 0.1894
 * (glazing.test.ts).
 */

export class GlazingError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'GlazingError' }
}

export interface GlazingOptics {
  /** Solar transmittance at normal incidence. */
  t_sol: number
  /** Solar absorptance of the equivalent layer at normal incidence (front side). */
  a_sol: number
  /** Solar reflectance, 1 − T − A. */
  r_sol: number
  /** The inward-flowing fraction of absorbed solar, N (so SHGC = T + N·A). */
  inward_fraction: number
  /** The equivalent layer's resistance, glass to glass, m²K/W, and its thickness, m. */
  r_layer: number
  thickness_m: number
}

const lerp = (u: number, lo: number, hi: number) => lo + ((u - 3.4) / (4.5 - 3.4)) * (hi - lo)

export function simpleGlazingOptics(u: number, shgc: number, path = 'glazing'): GlazingOptics {
  if (!(u > 0) || u > 7) throw new GlazingError(`U ${u} is outside the method's range (0, 7] W/m²K`, `${path}.u`)
  if (!(shgc > 0) || !(shgc < 1)) throw new GlazingError(`SHGC ${shgc} must be between 0 and 1`, `${path}.g_value`)
  // Step 1: the film resistances the method assumes for U, then the layer's own resistance.
  const r_iw = u < 5.85 ? 1 / (0.359073 * Math.log(u) + 6.949915) : 1 / (1.788041 * u - 2.886625)
  const r_ow = 1 / (0.025342 * u + 29.163853)
  const r_layer = 1 / u - r_iw - r_ow
  if (!(r_layer > 0)) throw new GlazingError(`U ${u} leaves no layer resistance after the method's films`, `${path}.u`)
  // Step 2: equivalent thickness.
  const thickness_m = 1 / r_layer > 7 ? 0.002 : 0.05914 - 0.00714 / r_layer
  // Step 3: solar transmittance at normal incidence, by U band (interpolated between 3.4 and 4.5).
  const tLow = shgc > 0.15 ? 0.085775 * shgc * shgc + 0.963954 * shgc - 0.084958 : 0.4104 * shgc
  const tHigh = shgc < 0.7206 ? 0.939998 * shgc * shgc + 0.20332 * shgc : 1.30415 * shgc - 0.30515
  const t_sol = u <= 3.4 ? tLow : u >= 4.5 ? tHigh : lerp(u, tLow, tHigh)
  if (!(t_sol >= 0) || !(t_sol < shgc)) throw new GlazingError(`derived transmittance ${t_sol} is not below SHGC ${shgc}`, `${path}.g_value`)
  // Step 4: the films for the solar split, then the inward-flowing fraction and the absorptance.
  const x = shgc - t_sol
  const riLow = 1 / (199.8208128 * x ** 3 - 90.639733 * x ** 2 + 19.737055 * x + 6.766575)
  const roLow = 1 / (5.763355 * x + 20.541528)
  const riHigh = 1 / (29.436546 * x ** 3 - 21.943415 * x ** 2 + 9.945872 * x + 7.426151)
  const roHigh = 1 / (2.225824 * x + 20.57708)
  const r_is = u <= 3.4 ? riLow : u >= 4.5 ? riHigh : lerp(u, riLow, riHigh)
  const r_os = u <= 3.4 ? roLow : u >= 4.5 ? roHigh : lerp(u, roLow, roHigh)
  const inward_fraction = (r_os + 0.5 * r_layer) / (r_os + r_layer + r_is)
  const a_sol = x / inward_fraction
  const r_sol = 1 - t_sol - a_sol
  if (!(a_sol >= 0) || !(r_sol >= 0)) throw new GlazingError(`U ${u} with SHGC ${shgc} gives no physical split (A ${a_sol}, R ${r_sol})`, path)
  return { t_sol, a_sol, r_sol, inward_fraction, r_layer, thickness_m }
}

/**
 * The Simple Window Model's angular dependence: transmittance and reflectance at an angle of incidence, as ratios
 * applied to the normal-incidence values, from the same method (LBNL-2804E, its curves A–J and its 28-cell map of
 * U × SHGC to a curve or an interpolation between curves). The coefficients and the map are those EnergyPlus 25.2.0
 * implements (WindowManager.cc, TransAndReflAtPhi, simple glazing branch); nothing is fitted here.
 *
 * Returned for a glazing system: `at(cos θ)` gives { t, r } at that incidence (T = t_sol·Tc, R = r0·(1 − Rc) + Rc,
 * clipped as EnergyPlus clips them, so A = 1 − T − R), and the hemispherical diffuse values EnergyPlus derives by
 * averaging the same function over 0–90° in 10° steps (WindowManager.cc DiffuseAverage). EnergyPlus evaluates the beam
 * from a polynomial fitted through those ten angles; Engine 1 evaluates the curve itself (the fit reproduces it).
 */
export interface GlazingAngular {
  at(cosTheta: number): { t: number; r: number }
  t_dif: number
  r_dif: number
  /** Diffuse absorptance: the same average of A(θ) = 1 − T(θ) − R(θ), as EnergyPlus averages it (not 1 − T − R). */
  a_dif: number
}

type Curves = Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'FGHI' | 'FH' | 'BDCD', number>
function curves(c: number): { T: Curves; R: Curves } {
  const p = (a: number[]) => a[0] + a[1] * c + a[2] * c ** 2 + a[3] * c ** 3 + a[4] * c ** 4
  const t = {
    A: p([0, 3.36, -3.85, 1.49, 0.01]), B: p([0, 2.83, -2.42, 0.04, 0.55]), C: p([0, 2.45, -1.58, -0.64, 0.77]),
    D: p([0, 2.85, -2.58, 0.40, 0.35]), E: p([0, 1.51, 2.49, -5.87, 2.88]), F: p([0, 1.21, 3.14, -6.37, 3.03]),
    G: p([0, 1.09, 3.54, -6.84, 3.23]), H: p([0, 0.98, 3.83, -7.13, 3.33]), I: p([0, 0.79, 3.93, -6.86, 3.15]),
    J: p([0, 0.08, 6.02, -8.84, 3.74]),
  }
  const rr = {
    A: p([1, -0.70, 2.57, -3.20, 1.33]) - t.A, B: p([1, -1.87, 6.50, -7.86, 3.23]) - t.B,
    C: p([1, -2.52, 8.40, -9.86, 3.99]) - t.C, D: p([1, -1.85, 6.40, -7.64, 3.11]) - t.D,
    E: p([1, -1.57, 5.60, -6.82, 2.80]) - t.E, F: p([1, -3.15, 10.98, -13.14, 5.32]) - t.F,
    G: p([1, -3.25, 11.32, -13.54, 5.49]) - t.G, H: p([1, -3.39, 11.70, -13.94, 5.64]) - t.H,
    I: p([1, -4.06, 13.55, -15.74, 6.27]) - t.I, J: p([1, -4.35, 14.27, -16.32, 6.39]) - t.J,
  }
  const mix = (x: typeof t) => ({ ...x, FGHI: (x.F + x.G + x.H + x.I) / 4, FH: (x.F + x.H) / 2, BDCD: (x.B + x.D + x.C + x.D) / 4 })
  return { T: mix(t), R: mix(rr) }
}

const two = (x: number, x0: number, x1: number, f0: number, f1: number) => f0 + ((x - x0) / (x1 - x0)) * (f1 - f0)
const four = (x: number, y: number, x1: number, x2: number, y1: number, y2: number, f11: number, f12: number, f21: number, f22: number) => {
  const d = (x2 - x1) * (y2 - y1)
  return (f11 / d) * (x2 - x) * (y2 - y) + (f21 / d) * (x - x1) * (y2 - y) + (f12 / d) * (x2 - x) * (y - y1) + (f22 / d) * (x - x1) * (y - y1)
}

/** The curve ratio for U and SHGC: EnergyPlus's 28 cells, in its order and with its boundaries. */
function cellRatio(u: number, s: number, k: Curves, path: string): number {
  if (u < 1.4195) {
    if (s > 0.45) return k.E
    if (s >= 0.35) return two(s, 0.35, 0.45, k.J, k.E)
    return k.J
  }
  if (u <= 1.7034) {
    const X = [1.4195, 1.7034] as const
    if (s > 0.55) return k.E
    if (s > 0.5) return four(u, s, X[0], X[1], 0.5, 0.55, k.E, k.E, k.FGHI, k.E)
    if (s > 0.45) return two(u, X[0], X[1], k.E, k.FGHI)
    if (s > 0.35) return four(u, s, X[0], X[1], 0.35, 0.45, k.J, k.E, k.FGHI, k.FGHI)
    if (s > 0.3) return two(u, X[0], X[1], k.J, k.FGHI)
    if (s > 0.25) return four(u, s, X[0], X[1], 0.25, 0.3, k.J, k.J, k.FH, k.FGHI)
    return two(u, X[0], X[1], k.J, k.FH)
  }
  if (u < 3.4068) {
    if (s > 0.55) return k.E
    if (s >= 0.5) return two(s, 0.5, 0.55, k.FGHI, k.E)
    if (s > 0.3) return k.FGHI
    if (s >= 0.25) return two(s, 0.25, 0.3, k.FH, k.FGHI)
    return k.FH
  }
  if (u <= 4.5424) {
    const X = [3.4068, 4.5424] as const
    if (s > 0.65) return two(u, X[0], X[1], k.E, k.A)
    if (s > 0.6) return four(u, s, X[0], X[1], 0.6, 0.65, k.E, k.E, k.BDCD, k.A)
    if (s > 0.55) return two(u, X[0], X[1], k.E, k.BDCD)
    if (s > 0.5) return four(u, s, X[0], X[1], 0.5, 0.55, k.FGHI, k.E, k.BDCD, k.BDCD)
    if (s > 0.45) return two(u, X[0], X[1], k.FGHI, k.BDCD)
    if (s > 0.3) return four(u, s, X[0], X[1], 0.3, 0.45, k.FGHI, k.FGHI, k.D, k.BDCD)
    if (s > 0.25) return four(u, s, X[0], X[1], 0.25, 0.3, k.FH, k.FGHI, k.D, k.D)
    return two(u, X[0], X[1], k.FH, k.D)
  }
  if (s > 0.65) return k.A
  if (s >= 0.6) return two(s, 0.6, 0.65, k.BDCD, k.A)
  if (s > 0.45) return k.BDCD
  if (s >= 0.3) return two(s, 0.3, 0.45, k.D, k.BDCD)
  if (s < 0.3) return k.D
  throw new GlazingError(`U ${u}, SHGC ${s} falls in no cell of the angular map`, path)
}

export function simpleGlazingAngular(u: number, shgc: number, optics: GlazingOptics, path = 'glazing'): GlazingAngular {
  const at = (cosTheta: number) => {
    const c = Math.min(1, Math.max(0, cosTheta))
    let tc: number, rc: number
    if (c === 1) { tc = 1; rc = 0 } else { const k = curves(c); tc = cellRatio(u, shgc, k.T, path); rc = cellRatio(u, shgc, k.R, path) }
    const t = Math.max(0, Math.min(1, optics.t_sol * tc))
    const r = Math.max(0, Math.min(0.9999 - t, optics.r_sol * (1 - rc) + rc))
    return { t, r }
  }
  // EnergyPlus's DiffuseAverage: trapezoid of prop · sin 2φ over φ = 0, 10, …, 90°.
  const d = (10 * Math.PI) / 180
  const avg = (f: (p: { t: number; r: number }) => number) => {
    let v = 0
    for (let i = 0; i < 9; i++) v += 0.5 * d * (f(at(Math.cos(i * d))) * Math.sin(2 * i * d) + f(at(Math.cos((i + 1) * d))) * Math.sin(2 * (i + 1) * d))
    return Math.max(0, v)
  }
  return { at, t_dif: avg((p) => p.t), r_dif: avg((p) => p.r), a_dif: avg((p) => 1 - p.t - p.r) }
}
