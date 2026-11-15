/**
 * One zone, ISO 52016-1:2017 hourly method (Brief 103 Part 3).
 *
 * Nodes: the zone air (ISO 52016-1 6.5.6.2, eq. 27: air plus the zone's internal heat capacity) and each element's
 * chain (6.5.7, eqs. 28–31: outside surface, interior, inside surface). Inside surfaces exchange heat with the air by
 * convection (h_ci) and with each other by long-wave radiation through the area-weighted mean (h_ri, eq. 30's
 * Σ A_k/A_tot term). The outside surface exchanges with outdoor air (h_ce + h_re), loses F_sky·h_re·Δθ_er to the sky
 * (6.5.13.3) and absorbs α·I_sol. Thermal bridges couple the air node to the outdoor air (H_tr,tb in eq. 27), and so
 * does ventilation (H_ve, which may change every hour). Implicit Euler, Δt = 1 h, as the standard.
 *
 * Solve (decision 7): the node matrix A0 holds everything that does not change hour to hour and is factorised once.
 * Hourly ventilation is a rank-one change on the air node, applied with Sherman–Morrison, so each hour costs one
 * forward/back substitution. Heating and cooling are ideal and unlimited (ISO 52016-1 6.5.5.2): the free-floating
 * state and the response to a unit heat input are both solved, and the system is linear, so the exact input that
 * puts the control temperature on the setpoint is found without iteration.
 */
import { ENGINE_CONSTANTS as K } from './constants'
import type { Element } from './elements'
import { luFactor, luSolve } from './linalg'

export interface ZoneInputs {
  elements: Element[]
  /** C_int: air ρ·c·V plus the zone's internal heat capacity, J/K. */
  air_capacity_j_per_k: number
  /** H_tb, W/K, between the air node and the outdoor air. */
  bridging_w_per_k: number
  hours: number
  theta_e: ArrayLike<number>
  theta_ground: number
  /** H_ve per hour, W/K, between the air node and the supply (outdoor) air. */
  ventilation_w_per_k: ArrayLike<number>
  /** Absorbed solar on each element's outside face per hour, W/m² (α·I; zeros for windows and the ground). */
  solar_absorbed_w_per_m2: ArrayLike<number>[]
  /** Solar transmitted into the zone per hour, W. */
  solar_transmitted_w: ArrayLike<number>
  setpoints: { heat_c: number | null; cool_c: number | null }
  /** The temperature the setpoints apply to. EnergyPlus's thermostat controls air; ISO 52016-1 uses operative. */
  control: 'air' | 'operative'
  /** Share of heating/cooling delivered to the air (1 = ideal convective, as EnergyPlus IdealLoads). */
  hc_convective_fraction: number
  /** Every node starts here before the warm-up, °C. */
  initial_c: number
  /** The first day is repeated this many times before the year, as EnergyPlus's warm-up does. */
  warmup_days: number
}

export interface ZoneRun {
  hours: number
  theta_air: Float64Array
  theta_mrt: Float64Array
  theta_op: Float64Array
  /** Heating delivered, W (≥ 0). */
  heating_w: Float64Array
  /** Cooling delivered, W (≥ 0, heat removed). */
  cooling_w: Float64Array
  /** Every term of the zone's balance per hour, W, positive into the zone (air + all element nodes). */
  terms: {
    /** Per element: convection and long-wave with outdoor air at the outside face, or conduction to the ground. */
    boundary_w: Float64Array[]
    /** Per element: absorbed solar on the outside face. */
    solar_absorbed_w: Float64Array[]
    /** Per element: long-wave loss to the sky (negative). */
    sky_w: Float64Array[]
    bridging_w: Float64Array
    ventilation_w: Float64Array
    solar_transmitted_w: Float64Array
    /** Heat stored in all nodes over the hour (positive = stored). */
    storage_w: Float64Array
  }
  /** |Σ terms + heating − cooling − storage| per hour, Wh. */
  closure_wh: Float64Array
  nodes: number
}

export class ZoneError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'ZoneError' }
}

function check(inp: ZoneInputs) {
  const { hours } = inp
  const arr = (a: ArrayLike<number>, p: string) => {
    if (!a || a.length < hours) throw new ZoneError(`needs ${hours} hourly values`, p)
    for (let i = 0; i < hours; i++) if (!Number.isFinite(a[i])) throw new ZoneError(`hour ${i} is not a number`, p)
  }
  arr(inp.theta_e, 'theta_e'); arr(inp.ventilation_w_per_k, 'ventilation_w_per_k'); arr(inp.solar_transmitted_w, 'solar_transmitted_w')
  if (inp.solar_absorbed_w_per_m2.length !== inp.elements.length) throw new ZoneError('one array per element', 'solar_absorbed_w_per_m2')
  inp.solar_absorbed_w_per_m2.forEach((a, i) => arr(a, `solar_absorbed_w_per_m2[${i}]`))
  for (let i = 0; i < hours; i++) if (inp.ventilation_w_per_k[i] < 0) throw new ZoneError(`hour ${i} is negative`, 'ventilation_w_per_k')
  const { heat_c, cool_c } = inp.setpoints
  if (heat_c != null && cool_c != null && heat_c > cool_c) throw new ZoneError(`heating ${heat_c} above cooling ${cool_c}`, 'setpoints')
  if (!(inp.air_capacity_j_per_k >= 0)) throw new ZoneError('must be ≥ 0', 'air_capacity_j_per_k')
  if (!(inp.bridging_w_per_k >= 0)) throw new ZoneError('must be ≥ 0', 'bridging_w_per_k')
  if (!(inp.hc_convective_fraction >= 0 && inp.hc_convective_fraction <= 1)) throw new ZoneError('must be 0 to 1', 'hc_convective_fraction')
  if (!Number.isFinite(inp.initial_c)) throw new ZoneError('required', 'initial_c')
  if (!(Number.isInteger(inp.warmup_days) && inp.warmup_days >= 0)) throw new ZoneError('a whole number ≥ 0', 'warmup_days')
  if (inp.control !== 'air' && inp.control !== 'operative') throw new ZoneError('air or operative', 'control')
  if (inp.elements.length === 0) throw new ZoneError('a zone needs at least one element', 'elements')
}

export function runZone(inp: ZoneInputs): ZoneRun {
  check(inp)
  const DT = 3600
  const els = inp.elements
  // Node layout: 0 = air, then each element's chain, outside first.
  const start: number[] = []
  let n = 1
  for (const e of els) { start.push(n); n += e.c.length }
  const inside = els.map((e, i) => start[i] + e.c.length - 1)
  const A_tot = els.reduce((s, e) => s + e.area_m2, 0)

  const A0 = new Float64Array(n * n)
  const cap = new Float64Array(n)  // J/K per node
  const add = (i: number, j: number, v: number) => { A0[i * n + j] += v }
  const couple = (i: number, j: number, g: number) => { add(i, i, g); add(j, j, g); add(i, j, -g); add(j, i, -g) }

  cap[0] = inp.air_capacity_j_per_k
  add(0, 0, inp.bridging_w_per_k)
  els.forEach((e, k) => {
    const s = start[k], A = e.area_m2
    for (let j = 0; j < e.c.length; j++) cap[s + j] = e.c[j] * A
    for (let j = 0; j < e.g.length; j++) couple(s + j, s + j + 1, e.g[j] * A)
    add(s, s, e.g_boundary * A)
    couple(0, inside[k], e.h_ci * A)
    // ISO 52016-1 eq. 30: h_ri · A_i · Σ_k (A_k / A_tot)(θ_i − θ_k).
    for (let m = 0; m < els.length; m++) {
      if (m === k) continue
      const g = (K.h_ri * A * els[m].area_m2) / A_tot
      add(inside[k], inside[k], g); add(inside[k], inside[m], -g)
    }
  })
  for (let i = 0; i < n; i++) add(i, i, cap[i] / DT)
  const lu = luFactor(A0, n)

  // Unit vectors and their solves, once per run.
  const eAir = new Float64Array(n); eAir[0] = 1
  const uAir = luSolve(lu, eAir, new Float64Array(n))
  const eHC = new Float64Array(n)
  eHC[0] = inp.hc_convective_fraction
  els.forEach((e, k) => { eHC[inside[k]] += ((1 - inp.hc_convective_fraction) * e.area_m2) / A_tot })
  const wHC = luSolve(lu, eHC, new Float64Array(n))
  const ctl = new Float64Array(n)
  if (inp.control === 'air') ctl[0] = 1
  else { ctl[0] = 0.5; els.forEach((e, k) => { ctl[inside[k]] += (0.5 * e.area_m2) / A_tot }) }
  const dot = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s }
  const ctl_uAir = dot(ctl, uAir), ctl_wHC = dot(ctl, wHC)

  const H = inp.hours
  const out: ZoneRun = {
    hours: H, nodes: n,
    theta_air: new Float64Array(H), theta_mrt: new Float64Array(H), theta_op: new Float64Array(H),
    heating_w: new Float64Array(H), cooling_w: new Float64Array(H),
    terms: {
      boundary_w: els.map(() => new Float64Array(H)), solar_absorbed_w: els.map(() => new Float64Array(H)),
      sky_w: els.map(() => new Float64Array(H)), bridging_w: new Float64Array(H), ventilation_w: new Float64Array(H),
      solar_transmitted_w: new Float64Array(H), storage_w: new Float64Array(H),
    },
    closure_wh: new Float64Array(H),
  }

  const x = new Float64Array(n).fill(inp.initial_c)
  const b = new Float64Array(n), z = new Float64Array(n)
  const sky = els.map((e) => -e.f_sky * e.h_re * K.delta_theta_sky_k * e.area_m2)
  const { heat_c, cool_c } = inp.setpoints
  const fsc = K.solar_convective_fraction

  const step = (h: number, record: boolean) => {
    const te = inp.theta_e[h], hv = inp.ventilation_w_per_k[h], sol = inp.solar_transmitted_w[h]
    for (let i = 0; i < n; i++) b[i] = (cap[i] / DT) * x[i]
    b[0] += inp.bridging_w_per_k * te + hv * te + fsc * sol
    els.forEach((e, k) => {
      const s = start[k], A = e.area_m2
      const tb = e.boundary === 'ground' ? inp.theta_ground : te
      b[s] += e.g_boundary * A * tb + sky[k] + inp.solar_absorbed_w_per_m2[k][h] * A
      b[inside[k]] += ((1 - fsc) * sol * A) / A_tot
    })
    luSolve(lu, b, z)
    // Sherman–Morrison for the hour's ventilation on the air node.
    const den = 1 + hv * uAir[0]
    const zA = (hv * z[0]) / den
    const wA = (hv * wHC[0]) / den
    const ctl0 = dot(ctl, z) - ctl_uAir * zA
    const dctl = ctl_wHC - ctl_uAir * wA  // control temperature per W of heating
    let phi = 0
    if (heat_c != null && ctl0 < heat_c) phi = (heat_c - ctl0) / dctl
    else if (cool_c != null && ctl0 > cool_c) phi = (cool_c - ctl0) / dctl
    let stored = 0
    for (let i = 0; i < n; i++) {
      const xi = z[i] - uAir[i] * zA + phi * (wHC[i] - uAir[i] * wA)
      if (record) stored += (cap[i] / DT) * (xi - x[i])
      x[i] = xi
    }
    if (!record) return
    const T = out.terms
    let sum = phi + (T.bridging_w[h] = inp.bridging_w_per_k * (te - x[0])) + (T.ventilation_w[h] = hv * (te - x[0])) + (T.solar_transmitted_w[h] = sol)
    let mrt = 0
    els.forEach((e, k) => {
      const A = e.area_m2, tb = e.boundary === 'ground' ? inp.theta_ground : te
      sum += (T.boundary_w[k][h] = e.g_boundary * A * (tb - x[start[k]]))
      sum += (T.solar_absorbed_w[k][h] = inp.solar_absorbed_w_per_m2[k][h] * A)
      sum += (T.sky_w[k][h] = sky[k])
      mrt += (x[inside[k]] * A) / A_tot
    })
    T.storage_w[h] = stored
    out.closure_wh[h] = Math.abs(sum - stored)  // Δt = 1 h, so W over the hour = Wh
    out.theta_air[h] = x[0]; out.theta_mrt[h] = mrt; out.theta_op[h] = 0.5 * (x[0] + mrt)
    if (phi > 0) out.heating_w[h] = phi; else if (phi < 0) out.cooling_w[h] = -phi
  }

  for (let d = 0; d < inp.warmup_days; d++) for (let h = 0; h < 24; h++) step(h, false)
  for (let h = 0; h < H; h++) step(h, true)
  return out
}
