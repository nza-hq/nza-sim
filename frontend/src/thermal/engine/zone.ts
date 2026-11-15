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
 * Solve (decision 7): each element's interior chain is condensed onto its inside surface once (static condensation),
 * leaving a small system on the air and inside-surface nodes that is factorised once. Hourly ventilation is a rank-one change on the air node, applied with Sherman–Morrison, so each hour costs one
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
  /**
   * Other heat sources in the zone per hour, W, with their convective share (the rest is radiant, spread over the
   * inside surfaces by area). Engine 1 maps nothing from the document here (internal gains are Brief 105); the
   * reference cases use it for BESTEST's fixed 200 W.
   */
  other_gains: { w: ArrayLike<number>; convective_fraction: number } | null
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
    other_gains_w: Float64Array
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
  if (inp.other_gains !== null) {
    if (!inp.other_gains) throw new ZoneError('required (null for none)', 'other_gains')
    arr(inp.other_gains.w, 'other_gains.w')
    const f = inp.other_gains.convective_fraction
    if (!(f >= 0 && f <= 1)) throw new ZoneError('must be 0 to 1', 'other_gains.convective_fraction')
  }
  if (inp.elements.length === 0) throw new ZoneError('a zone needs at least one element', 'elements')
}

export function runZone(inp: ZoneInputs): ZoneRun {
  check(inp)
  const DT = 3600
  const els = inp.elements
  const E = els.length
  const A_tot = els.reduce((s, e) => s + e.area_m2, 0)

  // ── Structure (decision 7) ───────────────────────────────────────────────────────────────────────────────────
  // The nodes split into "interface" nodes, the air (0) and each element's inside surface (1..E), and each element's
  // interior chain (outside surface and layers), which touches nothing but its own neighbours and, at its last node,
  // its own inside surface. Each chain is a tridiagonal block, eliminated once (static condensation); what is left is
  // an (E+1)×(E+1) system on the interface nodes, factorised once. Each hour is then a tridiagonal substitution per
  // element plus one small dense substitution: O(nodes), and a block structure multi-zone can extend.
  const nI = els.map((e) => e.c.length - 1)          // interior nodes per element (chain minus inside surface)
  const tri = els.map((e, k) => {
    const m = nI[k], A = e.area_m2
    const diag = new Float64Array(m), off = new Float64Array(Math.max(0, m - 1)), cap = new Float64Array(m)
    for (let j = 0; j < m; j++) {
      cap[j] = e.c[j] * A
      diag[j] = cap[j] / DT + e.g[j] * A + (j > 0 ? e.g[j - 1] * A : e.g_boundary * A)
      if (j < m - 1) off[j] = -e.g[j] * A
    }
    // Thomas factorisation: modified super-diagonal and pivots.
    const cp = new Float64Array(m), piv = new Float64Array(m)
    for (let j = 0; j < m; j++) {
      piv[j] = diag[j] - (j > 0 ? off[j - 1] * cp[j - 1] : 0)
      if (!(Math.abs(piv[j]) > 0)) throw new ZoneError('an element chain is singular', `elements[${k}]`)
      cp[j] = j < m - 1 ? off[j] / piv[j] : 0
    }
    const gLink = e.g[m - 1] * A                       // last interior node ↔ inside surface
    const solve = (b: Float64Array, y: Float64Array) => {
      y[0] = b[0] / piv[0]
      for (let j = 1; j < m; j++) y[j] = (b[j] - off[j - 1] * y[j - 1]) / piv[j]
      for (let j = m - 2; j >= 0; j--) y[j] -= cp[j] * y[j + 1]
      return y
    }
    // w = B⁻¹·c with c = −gLink at the last interior node: the chain's response to its inside surface temperature.
    const unit = new Float64Array(m); unit[m - 1] = -gLink
    const w = solve(unit, new Float64Array(m))
    return { m, cap, gLink, solve, w, b: new Float64Array(m), y: new Float64Array(m), x: new Float64Array(m) }
  })

  const F = E + 1
  const S = new Float64Array(F * F)
  const capF = new Float64Array(F)
  const add = (i: number, j: number, v: number) => { S[i * F + j] += v }
  capF[0] = inp.air_capacity_j_per_k
  add(0, 0, inp.bridging_w_per_k)
  for (let k = 0; k < E; k++) {
    const e = els[k], A = e.area_m2, f = k + 1, t = tri[k]
    capF[f] = e.c[e.c.length - 1] * A
    const hc = e.h_ci * A
    add(0, 0, hc); add(f, f, hc); add(0, f, -hc); add(f, 0, -hc)
    // ISO 52016-1 eq. 30: h_ri · A_i · Σ_k (A_k / A_tot)(θ_i − θ_k).
    for (let q = 0; q < E; q++) {
      if (q === k) continue
      const g = (K.h_ri * A * els[q].area_m2) / A_tot
      add(f, f, g); add(f, q + 1, -g)
    }
    // The chain's link to this surface, condensed: S_ff += gLink − cᵀ·w = gLink + gLink·w_last (w_last = −gLink·(B⁻¹)_last,last).
    add(f, f, t.gLink + t.gLink * t.w[t.m - 1])
  }
  for (let i = 0; i < F; i++) add(i, i, capF[i] / DT)
  const lu = luFactor(S, F)

  // Unit responses on the interface, once per run.
  const eAir = new Float64Array(F); eAir[0] = 1
  const uAir = luSolve(lu, eAir, new Float64Array(F))
  const eHC = new Float64Array(F)
  eHC[0] = inp.hc_convective_fraction
  for (let k = 0; k < E; k++) eHC[k + 1] += ((1 - inp.hc_convective_fraction) * els[k].area_m2) / A_tot
  const wHC = luSolve(lu, eHC, new Float64Array(F))
  const ctl = new Float64Array(F)
  if (inp.control === 'air') ctl[0] = 1
  else { ctl[0] = 0.5; for (let k = 0; k < E; k++) ctl[k + 1] += (0.5 * els[k].area_m2) / A_tot }
  const dot = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < F; i++) s += a[i] * b[i]; return s }
  const ctl_uAir = dot(ctl, uAir), ctl_wHC = dot(ctl, wHC)

  const H = inp.hours
  const out: ZoneRun = {
    hours: H, nodes: 1 + els.reduce((s, e) => s + e.c.length, 0),
    theta_air: new Float64Array(H), theta_mrt: new Float64Array(H), theta_op: new Float64Array(H),
    heating_w: new Float64Array(H), cooling_w: new Float64Array(H),
    terms: {
      boundary_w: els.map(() => new Float64Array(H)), solar_absorbed_w: els.map(() => new Float64Array(H)),
      sky_w: els.map(() => new Float64Array(H)), bridging_w: new Float64Array(H), ventilation_w: new Float64Array(H),
      solar_transmitted_w: new Float64Array(H), other_gains_w: new Float64Array(H), storage_w: new Float64Array(H),
    },
    closure_wh: new Float64Array(H),
  }

  const xF = new Float64Array(F).fill(inp.initial_c)
  for (const t of tri) t.x.fill(inp.initial_c)
  const bF = new Float64Array(F), z = new Float64Array(F)
  const sky = els.map((e) => -e.f_sky * e.h_re * K.delta_theta_sky_k * e.area_m2)
  const gB = els.map((e) => e.g_boundary * e.area_m2)
  const share = els.map((e) => e.area_m2 / A_tot)
  const ground = els.map((e) => e.boundary === 'ground')
  const { heat_c, cool_c } = inp.setpoints
  const fsc = K.solar_convective_fraction
  const og = inp.other_gains

  const step = (h: number, record: boolean) => {
    const te = inp.theta_e[h], hv = inp.ventilation_w_per_k[h], sol = inp.solar_transmitted_w[h]
    const ogw = og ? og.w[h] : 0, ogc = og ? og.convective_fraction : 0
    for (let i = 0; i < F; i++) bF[i] = (capF[i] / DT) * xF[i]
    bF[0] += inp.bridging_w_per_k * te + hv * te + fsc * sol + ogc * ogw
    const radIn = (1 - fsc) * sol + (1 - ogc) * ogw
    for (let k = 0; k < E; k++) {
      const t = tri[k], b = t.b
      for (let j = 0; j < t.m; j++) b[j] = (t.cap[j] / DT) * t.x[j]
      b[0] += gB[k] * (ground[k] ? inp.theta_ground : te) + sky[k] + inp.solar_absorbed_w_per_m2[k][h] * els[k].area_m2
      t.solve(b, t.y)
      // Condensed right-hand side: b_f − cᵀ·y = b_f + gLink·y_last.
      bF[k + 1] += radIn * share[k] + t.gLink * t.y[t.m - 1]
    }
    luSolve(lu, bF, z)
    const den = 1 + hv * uAir[0]
    const zA = (hv * z[0]) / den, wA = (hv * wHC[0]) / den
    const ctl0 = dot(ctl, z) - ctl_uAir * zA
    const dctl = ctl_wHC - ctl_uAir * wA
    let phi = 0
    if (heat_c != null && ctl0 < heat_c) phi = (heat_c - ctl0) / dctl
    else if (cool_c != null && ctl0 > cool_c) phi = (cool_c - ctl0) / dctl
    let stored = 0
    for (let i = 0; i < F; i++) {
      const xi = z[i] - uAir[i] * zA + phi * (wHC[i] - uAir[i] * wA)
      if (record) stored += (capF[i] / DT) * (xi - xF[i])
      xF[i] = xi
    }
    for (let k = 0; k < E; k++) {
      const t = tri[k], xs = xF[k + 1]
      for (let j = 0; j < t.m; j++) {
        const xj = t.y[j] - t.w[j] * xs
        if (record) stored += (t.cap[j] / DT) * (xj - t.x[j])
        t.x[j] = xj
      }
    }
    if (!record) return
    const T = out.terms
    const ta = xF[0]
    let sum = phi + (T.bridging_w[h] = inp.bridging_w_per_k * (te - ta)) + (T.ventilation_w[h] = hv * (te - ta))
      + (T.solar_transmitted_w[h] = sol) + (T.other_gains_w[h] = ogw)
    let mrt = 0
    for (let k = 0; k < E; k++) {
      const tb = ground[k] ? inp.theta_ground : te
      sum += (T.boundary_w[k][h] = gB[k] * (tb - tri[k].x[0]))
      sum += (T.solar_absorbed_w[k][h] = inp.solar_absorbed_w_per_m2[k][h] * els[k].area_m2)
      sum += (T.sky_w[k][h] = sky[k])
      mrt += xF[k + 1] * share[k]
    }
    T.storage_w[h] = stored
    out.closure_wh[h] = Math.abs(sum - stored)  // Δt = 1 h, so W over the hour = Wh
    out.theta_air[h] = ta; out.theta_mrt[h] = mrt; out.theta_op[h] = 0.5 * (ta + mrt)
    if (phi > 0) out.heating_w[h] = phi; else if (phi < 0) out.cooling_w[h] = -phi
  }

  for (let d = 0; d < inp.warmup_days; d++) for (let h = 0; h < 24; h++) step(h, false)
  for (let h = 0; h < H; h++) step(h, true)
  return out
}
