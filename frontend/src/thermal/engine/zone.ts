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
import { ENGINE_CONSTANTS as K, heatFlowDirection } from './constants'
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
  other_gains: { w: ArrayLike<number>; convective_fraction: number | ArrayLike<number> } | null
  setpoints: { heat_c: number | null; cool_c: number | null }
  /** The temperature the setpoints apply to. EnergyPlus's thermostat controls air; ISO 52016-1 uses operative. */
  control: 'air' | 'operative'
  /** Share of heating/cooling delivered to the air (1 = ideal convective, as EnergyPlus IdealLoads). */
  hc_convective_fraction: number
  /**
   * Brief 108: the most heat the zone's emitters can give, W (null or absent: unlimited, ideal loads). When the
   * heating needed to hold the setpoint is more, the zone gets this and floats below its setpoint.
   */
  heating_cap_w?: number | null
  /** Brief 108: heating's share to the air when it differs from cooling's (the emitters' convective share). Absent: hc_convective_fraction. */
  heating_convective_fraction?: number | null
  /**
   * Outside convective coefficient per hour, W/m²K, for every element facing the outside (windows included), in place
   * of each element's fixed h_ce. Null or absent: the element's own (ISO 52016-1 Table 25, 20 W/m²K).
   */
  h_ce_w_per_m2k?: ArrayLike<number> | null
  /**
   * Inside convection on horizontal surfaces. 'by_tilt' (default): fixed by the surface's tilt as if heat flowed from
   * the zone (ceilings 5.0, floors 0.7). 'by_heat_flow': ISO 52016-1 Table 25 by the actual direction of heat flow,
   * taken from the previous hour (a floor warmer than the air, or a ceiling cooler than it, is heat flowing upward:
   * 5.0; the other way: 0.7). Walls are 2.5 either way.
   */
  inside_convection?: 'by_tilt' | 'by_heat_flow'
  /**
   * The beam part of `solar_transmitted_w`, W, per hour. It lands on the zone's upward-facing inside surfaces (floors,
   * tilt above 120°) by area, as the sun patch does; the rest of the transmitted solar is spread over every inside
   * surface by area. Null or absent: all of it by area (ISO 52016-1's simplification).
   */
  solar_beam_w?: ArrayLike<number> | null
  /**
   * Solar absorptance of each element's inside face (Brief 104 Part 1b), used only for opaque elements; absent or null
   * entries are 1. Diffuse solar inside the zone goes to each face in proportion to area × absorptance (a window:
   * its diffuse transmittance plus absorptance), which is the sum of the reflections, as EnergyPlus distributes it.
   */
  inside_solar_absorptance?: ArrayLike<number | null> | null
  /** Share of transmitted solar given straight to the air node; absent: ENGINE_CONSTANTS.solar_convective_fraction. */
  solar_convective_fraction?: number
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
    /** Transmitted solar that leaves again through windows from inside (negative; 'optical' windows only). */
    solar_lost_w: Float64Array
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
  if (inp.heating_convective_fraction != null && !(inp.heating_convective_fraction >= 0 && inp.heating_convective_fraction <= 1)) throw new ZoneError('must be 0 to 1', 'heating_convective_fraction')
  if (inp.heating_cap_w != null && !(inp.heating_cap_w >= 0)) throw new ZoneError('must be ≥ 0', 'heating_cap_w')
  if (!Number.isFinite(inp.initial_c)) throw new ZoneError('required', 'initial_c')
  if (!(Number.isInteger(inp.warmup_days) && inp.warmup_days >= 0)) throw new ZoneError('a whole number ≥ 0', 'warmup_days')
  if (inp.control !== 'air' && inp.control !== 'operative') throw new ZoneError('air or operative', 'control')
  if (inp.other_gains !== null) {
    if (!inp.other_gains) throw new ZoneError('required (null for none)', 'other_gains')
    arr(inp.other_gains.w, 'other_gains.w')
    const f = inp.other_gains.convective_fraction
    if (typeof f === 'number') { if (!(f >= 0 && f <= 1)) throw new ZoneError('must be 0 to 1', 'other_gains.convective_fraction') }
    else {
      arr(f, 'other_gains.convective_fraction')
      for (let h = 0; h < f.length; h++) if (!(f[h] >= 0 && f[h] <= 1)) throw new ZoneError(`hour ${h} must be 0 to 1`, 'other_gains.convective_fraction')
    }
  }
  if (inp.elements.length === 0) throw new ZoneError('a zone needs at least one element', 'elements')
  if (inp.h_ce_w_per_m2k != null) {
    arr(inp.h_ce_w_per_m2k, 'h_ce_w_per_m2k')
    for (let i = 0; i < hours; i++) if (!(inp.h_ce_w_per_m2k[i] > 0)) throw new ZoneError(`hour ${i} must be > 0`, 'h_ce_w_per_m2k')
  }
  if (inp.inside_convection != null && inp.inside_convection !== 'by_tilt' && inp.inside_convection !== 'by_heat_flow') {
    throw new ZoneError("by_tilt or by_heat_flow", 'inside_convection')
  }
  if (inp.solar_beam_w != null) {
    arr(inp.solar_beam_w, 'solar_beam_w')
    for (let i = 0; i < hours; i++) {
      if (inp.solar_beam_w[i] < 0 || inp.solar_beam_w[i] > inp.solar_transmitted_w[i] + 1e-9) throw new ZoneError(`hour ${i} must be between 0 and the transmitted solar`, 'solar_beam_w')
    }
  }
}

export function runZone(inp: ZoneInputs): ZoneRun {
  check(inp)
  const DT = 3600
  const els = inp.elements
  const E = els.length
  const A_tot = els.reduce((s, e) => s + e.area_m2, 0)
  const F = E + 1
  const nI = els.map((e) => e.c.length - 1)          // interior nodes per element (chain minus inside surface)
  const outsideFace = els.map((e) => e.boundary === 'outside')
  const dirOf = els.map((e) => heatFlowDirection(e.tilt_deg))

  // ── Structure (decision 7) ───────────────────────────────────────────────────────────────────────────────────
  // The nodes split into "interface" nodes, the air (0) and each element's inside surface (1..E), and each element's
  // interior chain (outside surface and layers), which touches nothing but its own neighbours and, at its last node,
  // its own inside surface. Each chain is a tridiagonal block, eliminated (static condensation); what is left is an
  // (E+1)×(E+1) system on the interface nodes. With fixed surface coefficients this is factorised once per run. When
  // the outside coefficient follows the wind, or the inside one the direction of heat flow, the coefficients change
  // hour by hour and the structure is rebuilt for the hours they change: per element a tridiagonal factorisation, and
  // one small dense factorisation (E+1)³/3, still O(nodes) per hour.
  interface Chain { m: number; cap: Float64Array; gLink: number; w: Float64Array; off: Float64Array; cp: Float64Array; piv: Float64Array }
  const caps = els.map((e, k) => { const c = new Float64Array(nI[k]); for (let j = 0; j < nI[k]; j++) c[j] = e.c[j] * e.area_m2; return c })
  const solveChain = (t: Chain, b: Float64Array, y: Float64Array) => {
    const { m, off, cp, piv } = t
    y[0] = b[0] / piv[0]
    for (let j = 1; j < m; j++) y[j] = (b[j] - off[j - 1] * y[j - 1]) / piv[j]
    for (let j = m - 2; j >= 0; j--) y[j] -= cp[j] * y[j + 1]
    return y
  }
  const chain = (k: number, gB_m2: number): Chain => {
    const e = els[k], m = nI[k], A = e.area_m2, cap = caps[k]
    const diag = new Float64Array(m), off = new Float64Array(Math.max(0, m - 1))
    for (let j = 0; j < m; j++) {
      diag[j] = cap[j] / DT + e.g[j] * A + (j > 0 ? e.g[j - 1] * A : gB_m2 * A)
      if (j < m - 1) off[j] = -e.g[j] * A
    }
    // Thomas factorisation: modified super-diagonal and pivots.
    const cp = new Float64Array(m), piv = new Float64Array(m)
    for (let j = 0; j < m; j++) {
      piv[j] = diag[j] - (j > 0 ? off[j - 1] * cp[j - 1] : 0)
      if (!(Math.abs(piv[j]) > 0)) throw new ZoneError('an element chain is singular', `elements[${k}]`)
      cp[j] = j < m - 1 ? off[j] / piv[j] : 0
    }
    const t: Chain = { m, cap, gLink: e.g[m - 1] * A, w: new Float64Array(m), off, cp, piv }
    // w = B⁻¹·c with c = −gLink at the last interior node: the chain's response to its inside surface temperature.
    const unit = new Float64Array(m); unit[m - 1] = -t.gLink
    solveChain(t, unit, t.w)
    return t
  }

  const capF = new Float64Array(F)
  capF[0] = inp.air_capacity_j_per_k
  for (let k = 0; k < E; k++) capF[k + 1] = els[k].c[els[k].c.length - 1] * els[k].area_m2
  const eAir = new Float64Array(F); eAir[0] = 1
  const spread = (f: number) => {
    const v = new Float64Array(F)
    v[0] = f
    for (let k = 0; k < E; k++) v[k + 1] += ((1 - f) * els[k].area_m2) / A_tot
    return v
  }
  const eHC = spread(inp.hc_convective_fraction)
  // Brief 108: heating may reach the room differently from cooling (radiators give part of their heat as radiation).
  const hcfH = inp.heating_convective_fraction ?? inp.hc_convective_fraction
  const eH = hcfH === inp.hc_convective_fraction ? eHC : spread(hcfH)
  const capH = inp.heating_cap_w ?? Infinity
  const ctl = new Float64Array(F)
  if (inp.control === 'air') ctl[0] = 1
  else { ctl[0] = 0.5; for (let k = 0; k < E; k++) ctl[k + 1] += (0.5 * els[k].area_m2) / A_tot }
  const dot = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < F; i++) s += a[i] * b[i]; return s }

  // One factorised structure for a given set of outside (W/m²K, per element) and inside convective coefficients.
  const build = (gB_m2: Float64Array, hci: Float64Array) => {
    const tri = els.map((_, k) => chain(k, gB_m2[k]))
    const S = new Float64Array(F * F)
    const add = (i: number, j: number, v: number) => { S[i * F + j] += v }
    add(0, 0, inp.bridging_w_per_k)
    for (let k = 0; k < E; k++) {
      const A = els[k].area_m2, f = k + 1, t = tri[k]
      const hc = hci[k] * A
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
    const uAir = luSolve(lu, eAir, new Float64Array(F))
    const wHC = luSolve(lu, eHC, new Float64Array(F))
    const wH = eH === eHC ? wHC : luSolve(lu, eH, new Float64Array(F))
    return { tri, lu, uAir, wHC, wH, ctl_uAir: dot(ctl, uAir), ctl_wHC: dot(ctl, wHC), ctl_wH: dot(ctl, wH), gB: gB_m2.map((g, k) => g * els[k].area_m2) }
  }
  const gBm2 = Float64Array.from(els, (e) => e.g_boundary)
  const hci = Float64Array.from(els, (e) => e.h_ci)
  let st = build(gBm2, hci)
  const dynamic = inp.h_ce_w_per_m2k != null || inp.inside_convection === 'by_heat_flow'
  // Per-element chain state (node temperatures) and scratch, kept apart from the factorisation so a rebuild keeps it.
  const xs = els.map((_, k) => new Float64Array(nI[k]))
  const bs = els.map((_, k) => new Float64Array(nI[k]))
  const ys = els.map((_, k) => new Float64Array(nI[k]))
  const floorShare = (() => {
    const floors = els.map((_, k) => dirOf[k] === 'downward')
    const aF = els.reduce((s, e, k) => s + (floors[k] ? e.area_m2 : 0), 0)
    return aF > 0 ? els.map((e, k) => (floors[k] ? e.area_m2 / aF : 0)) : null
  })()
  const H = inp.hours
  const out: ZoneRun = {
    hours: H, nodes: 1 + els.reduce((s, e) => s + e.c.length, 0),
    theta_air: new Float64Array(H), theta_mrt: new Float64Array(H), theta_op: new Float64Array(H),
    heating_w: new Float64Array(H), cooling_w: new Float64Array(H),
    terms: {
      boundary_w: els.map(() => new Float64Array(H)), solar_absorbed_w: els.map(() => new Float64Array(H)),
      sky_w: els.map(() => new Float64Array(H)), bridging_w: new Float64Array(H), ventilation_w: new Float64Array(H),
      solar_transmitted_w: new Float64Array(H), solar_lost_w: new Float64Array(H), other_gains_w: new Float64Array(H), storage_w: new Float64Array(H),
    },
    closure_wh: new Float64Array(H),
  }

  const xF = new Float64Array(F).fill(inp.initial_c)
  for (const x of xs) x.fill(inp.initial_c)
  const bF = new Float64Array(F), z = new Float64Array(F)
  const sky = els.map((e) => -e.f_sky * e.h_re * K.delta_theta_sky_k * e.area_m2)
  const share = els.map((e) => e.area_m2 / A_tot)
  const hceIn = inp.h_ce_w_per_m2k ?? null
  const byFlow = inp.inside_convection === 'by_heat_flow'
  const beamIn = inp.solar_beam_w ?? null
  const ground = els.map((e) => e.boundary === 'ground')
  const { heat_c, cool_c } = inp.setpoints
  const fsc = inp.solar_convective_fraction ?? K.solar_convective_fraction
  if (!(fsc >= 0 && fsc <= 1)) throw new ZoneError('solar_convective_fraction must be in [0, 1]', 'solar_convective_fraction')
  const og = inp.other_gains
  // Brief 105 Part 2: the convective share may vary by hour (several gains, each with its own radiant fraction).
  const ogcN = og && typeof og.convective_fraction === 'number' ? og.convective_fraction : 0
  const ogcH = og && typeof og.convective_fraction !== 'number' ? og.convective_fraction : null
  // Diffuse solar inside the zone (Brief 104 Part 1b): spread over the inside surfaces by area; an 'optical' window
  // absorbs part in its pane, passes part back out, and reflects the rest back into the zone, where it is spread again.
  // Summing the reflections: of diffuse D, each opaque surface takes D·s_k/den, a window D·s_k·a/den in its pane and
  // D·s_k·t/den lost, with den = 1 − Σ_windows s_k·(1 − t − a). Without optical windows den = 1 and this is the area share.
  const absNode = els.map((e) => e.absorbed_node ?? 0)
  for (let k = 0; k < E; k++) if (!(absNode[k] >= 0 && absNode[k] < nI[k])) throw new ZoneError('absorbed_node must be an interior node', `elements[${k}]`)
  const iso = els.map((e) => e.interior_solar ?? null)
  // An opaque inside face absorbs α of the solar reaching it and reflects the rest into the pool (α = 1 when the zone
  // gives none: every opaque face black, as before Part 1b). The sun patch on the floor reflects (1 − α) likewise.
  const alphaIn = els.map((_, k) => {
    const v = inp.inside_solar_absorptance?.[k] ?? 1
    if (!(v > 0 && v <= 1)) throw new ZoneError('inside_solar_absorptance must be in (0, 1]', `inside_solar_absorptance[${k}]`)
    return v
  })
  const den = 1 - els.reduce((s, e, k) => s + share[k] * (iso[k] ? 1 - iso[k]!.transmitted - iso[k]!.absorbed : 1 - alphaIn[k]), 0)
  const difSurf = els.map((_, k) => (iso[k] ? 0 : (share[k] * alphaIn[k]) / den))
  const beamReflected = floorShare ? els.reduce((s, _, k) => s + floorShare[k] * (1 - alphaIn[k]), 0) : 0
  const difPane = els.map((_, k) => (iso[k] ? (share[k] * iso[k]!.absorbed) / den : 0))
  const difLost = els.reduce((s, _, k) => s + (iso[k] ? (share[k] * iso[k]!.transmitted) / den : 0), 0)

  const step = (h: number, record: boolean) => {
    if (dynamic) {
      let changed = false
      for (let k = 0; k < E; k++) {
        if (hceIn && outsideFace[k]) {
          const g = hceIn[h] + els[k].h_re
          if (g !== gBm2[k]) { gBm2[k] = g; changed = true }
        }
        if (byFlow && dirOf[k] !== 'horizontal') {
          // Direction of heat flow at this surface from the previous hour: a floor (inside face up) warmer than the
          // air, or a ceiling (inside face down) cooler than it, has heat flowing upward.
          const surf = xF[k + 1], air = xF[0]
          const up = dirOf[k] === 'downward' ? surf > air : air > surf
          const v = up ? K.h_ci_upward : K.h_ci_downward
          if (v !== hci[k]) { hci[k] = v; changed = true }
        }
      }
      if (changed) st = build(gBm2, hci)
    }
    const { tri, lu, uAir, wHC, wH, ctl_uAir, ctl_wHC, ctl_wH, gB } = st
    const te = inp.theta_e[h], hv = inp.ventilation_w_per_k[h], sol = inp.solar_transmitted_w[h]
    const beam = beamIn && floorShare ? beamIn[h] : 0
    const ogw = og ? og.w[h] : 0, ogc = ogcH ? ogcH[h] : ogcN
    for (let i = 0; i < F; i++) bF[i] = (capF[i] / DT) * xF[i]
    bF[0] += inp.bridging_w_per_k * te + hv * te + fsc * sol + ogc * ogw
    const radBeam = (1 - fsc) * beam
    const solDiffuse = (1 - fsc) * (sol - beam) + radBeam * beamReflected
    const ogRad = (1 - ogc) * ogw
    for (let k = 0; k < E; k++) {
      const t = tri[k], b = bs[k], x = xs[k], y = ys[k]
      for (let j = 0; j < t.m; j++) b[j] = (t.cap[j] / DT) * x[j]
      b[0] += gB[k] * (ground[k] ? inp.theta_ground : te) + sky[k]
      b[absNode[k]] += inp.solar_absorbed_w_per_m2[k][h] * els[k].area_m2 + solDiffuse * difPane[k]
      solveChain(t, b, y)
      // Condensed right-hand side: b_f − cᵀ·y = b_f + gLink·y_last.
      bF[k + 1] += solDiffuse * difSurf[k] + ogRad * share[k] + (floorShare ? radBeam * floorShare[k] * alphaIn[k] : 0) + t.gLink * y[t.m - 1]
    }
    luSolve(lu, bF, z)
    const den = 1 + hv * uAir[0]
    const zA = (hv * z[0]) / den
    const ctl0 = dot(ctl, z) - ctl_uAir * zA
    let phi = 0
    let w = wHC, wA = (hv * wHC[0]) / den
    if (heat_c != null && ctl0 < heat_c) {
      w = wH; wA = (hv * wH[0]) / den
      phi = Math.min((heat_c - ctl0) / (ctl_wH - ctl_uAir * wA), capH)  // Brief 108: at most the emitters' output
    } else if (cool_c != null && ctl0 > cool_c) phi = (cool_c - ctl0) / (ctl_wHC - ctl_uAir * wA)
    let stored = 0
    for (let i = 0; i < F; i++) {
      const xi = z[i] - uAir[i] * zA + phi * (w[i] - uAir[i] * wA)
      if (record) stored += (capF[i] / DT) * (xi - xF[i])
      xF[i] = xi
    }
    for (let k = 0; k < E; k++) {
      const t = tri[k], xsurf = xF[k + 1], x = xs[k], y = ys[k]
      for (let j = 0; j < t.m; j++) {
        const xj = y[j] - t.w[j] * xsurf
        if (record) stored += (t.cap[j] / DT) * (xj - x[j])
        x[j] = xj
      }
    }
    if (!record) return
    const T = out.terms
    const ta = xF[0]
    let sum = phi + (T.bridging_w[h] = inp.bridging_w_per_k * (te - ta)) + (T.ventilation_w[h] = hv * (te - ta))
      + (T.solar_transmitted_w[h] = sol) + (T.solar_lost_w[h] = -solDiffuse * difLost) + (T.other_gains_w[h] = ogw)
    let mrt = 0
    for (let k = 0; k < E; k++) {
      const tb = ground[k] ? inp.theta_ground : te
      sum += (T.boundary_w[k][h] = gB[k] * (tb - xs[k][0]))
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
