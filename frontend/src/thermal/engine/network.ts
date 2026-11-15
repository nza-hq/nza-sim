/**
 * Several zones solved together, ISO 52016-1 hourly method (Brief 104 Part 3, decision 5).
 *
 * The node network of Engine 1 (zone.ts), extended:
 * - every zone has its air node and an inside-surface node for each face it has;
 * - an element between two zones, or internal mass, has an inside surface at both ends (`innerElement`). Its chain is
 *   condensed onto both faces, which couples the two zones' networks (or two faces of one zone);
 * - an element facing outside or the ground is condensed onto its one inside face, as in Engine 1.
 *
 * Inside a zone the faces exchange long-wave radiation through the zone's area-weighted mean (ISO 52016-1 eq. 30) and
 * convection with that zone's air; transmitted solar, radiant gains and radiant heating are spread over the zone's
 * own faces as in Engine 1.
 *
 * The interface system (air and inside-surface nodes of every zone) is factorised once per run. Each zone's hourly
 * ventilation is a rank-one change on its air node, so all of them together are one rank-Z change, applied with the
 * Woodbury identity (an Z×Z system per hour, refactorised only when a ventilation rate changes). Heating and cooling
 * are ideal: the free-floating state and each zone's response to a unit heat input are solved, and the zones whose
 * control temperature would leave the band are held on it together. The set of such zones is iterated until it is
 * consistent; the passes are counted and recorded.
 *
 * Every hour, every zone's balance is closed: Σ terms + heating − cooling − Δstorage over the zone's own nodes. The
 * heat crossing between zones is a term of each zone (`interzone_w`). An element between two zones is split at the
 * link nearest its middle: the nodes on each side belong to that side's zone, and the heat across that link is the
 * interzone transfer, so the two zones' transfers cancel exactly.
 */
import { ENGINE_CONSTANTS as K, heatFlowDirection } from './constants'
import type { Element } from './elements'
import { luFactor, luSolve, type LU } from './linalg'

export interface NetworkZone {
  /** C_int: air ρ·c·V plus the zone's internal heat capacity, J/K. */
  air_capacity_j_per_k: number
  /** H_tb, W/K, between this zone's air node and the outdoor air. */
  bridging_w_per_k: number
  /** H_ve per hour, W/K, between the air node and the outdoor air. */
  ventilation_w_per_k: ArrayLike<number>
  /** Solar transmitted into the zone through its windows per hour, W. */
  solar_transmitted_w: ArrayLike<number>
  /** The beam part of it, landing on the zone's floor-facing faces by area; null: all spread as diffuse. */
  solar_beam_w: ArrayLike<number> | null
  other_gains: { w: ArrayLike<number>; convective_fraction: number } | null
  setpoints: { heat_c: number | null; cool_c: number | null }
  /** Every node of the zone starts here before the warm-up, °C. */
  initial_c: number
}

export interface NetworkElement {
  element: Element
  /** The zone of the last node's face (the inside face, for an element facing outside or the ground). */
  zone_a: number
  /** 'zone' elements only: the zone of node 0's face (equal to zone_a for internal mass). Otherwise null. */
  zone_b: number | null
  /** Absorbed solar on the outside face per hour, W/m² (zeros for the ground and 'zone' elements). */
  solar_absorbed_w_per_m2: ArrayLike<number>
  /** Inside solar absorptance of the zone_a face (null for a window: its optics are on the element). */
  inside_solar_absorptance: number | null
  /** 'zone' elements only: the zone_b face's. */
  inside_solar_absorptance_b: number | null
}

export interface NetworkInputs {
  zones: NetworkZone[]
  elements: NetworkElement[]
  hours: number
  theta_e: ArrayLike<number>
  theta_ground: number
  control: 'air' | 'operative'
  hc_convective_fraction: number
  /** Absent: ENGINE_CONSTANTS.solar_convective_fraction. */
  solar_convective_fraction?: number
  warmup_days: number
}

export interface NetworkZoneRun {
  theta_air: Float64Array
  theta_mrt: Float64Array
  theta_op: Float64Array
  heating_w: Float64Array
  cooling_w: Float64Array
  terms: {
    bridging_w: Float64Array
    ventilation_w: Float64Array
    solar_transmitted_w: Float64Array
    solar_lost_w: Float64Array
    other_gains_w: Float64Array
    /** Heat into this zone from the others through the elements it shares with them (Σ over zones = 0 every hour). */
    interzone_w: Float64Array
    storage_w: Float64Array
  }
  /** |Σ terms + heating − cooling − storage| per hour, Wh, over this zone's own nodes. */
  closure_wh: Float64Array
}

export interface NetworkRun {
  hours: number
  zones: NetworkZoneRun[]
  /** Per element, positive into the building: the outside or ground boundary, outside absorbed solar, sky. */
  element_terms: { boundary_w: Float64Array; solar_absorbed_w: Float64Array; sky_w: Float64Array }[]
  /** Per element between two zones: heat into zone_a from zone_b across the element's middle link, W. */
  element_interzone_w: (Float64Array | null)[]
  nodes: number
  /** Most passes of the active-set iteration in any hour, and the hours that needed more than one. */
  active_set: { max_passes: number; hours_over_one: number }
}

export class NetworkError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'NetworkError' }
}

const DT = 3600

function check(inp: NetworkInputs) {
  const H = inp.hours
  const arr = (a: ArrayLike<number>, p: string) => {
    if (!a || a.length < H) throw new NetworkError(`needs ${H} hourly values`, p)
    for (let i = 0; i < H; i++) if (!Number.isFinite(a[i])) throw new NetworkError(`hour ${i} is not a number`, p)
  }
  if (inp.zones.length === 0) throw new NetworkError('at least one zone', 'zones')
  arr(inp.theta_e, 'theta_e')
  inp.zones.forEach((z, i) => {
    const p = `zones[${i}]`
    arr(z.ventilation_w_per_k, `${p}.ventilation_w_per_k`); arr(z.solar_transmitted_w, `${p}.solar_transmitted_w`)
    for (let h = 0; h < H; h++) if (z.ventilation_w_per_k[h] < 0) throw new NetworkError(`hour ${h} is negative`, `${p}.ventilation_w_per_k`)
    if (z.solar_beam_w) {
      arr(z.solar_beam_w, `${p}.solar_beam_w`)
      for (let h = 0; h < H; h++) if (z.solar_beam_w[h] < 0 || z.solar_beam_w[h] > z.solar_transmitted_w[h] + 1e-9) throw new NetworkError(`hour ${h} must be between 0 and the transmitted solar`, `${p}.solar_beam_w`)
    }
    if (!(z.air_capacity_j_per_k >= 0)) throw new NetworkError('must be ≥ 0', `${p}.air_capacity_j_per_k`)
    if (!(z.bridging_w_per_k >= 0)) throw new NetworkError('must be ≥ 0', `${p}.bridging_w_per_k`)
    const { heat_c, cool_c } = z.setpoints
    if (heat_c != null && cool_c != null && heat_c > cool_c) throw new NetworkError(`heating ${heat_c} above cooling ${cool_c}`, `${p}.setpoints`)
    if (!Number.isFinite(z.initial_c)) throw new NetworkError('required', `${p}.initial_c`)
    if (z.other_gains !== null) {
      arr(z.other_gains.w, `${p}.other_gains.w`)
      if (!(z.other_gains.convective_fraction >= 0 && z.other_gains.convective_fraction <= 1)) throw new NetworkError('must be 0 to 1', `${p}.other_gains.convective_fraction`)
    }
  })
  const Z = inp.zones.length
  inp.elements.forEach((ne, k) => {
    const p = `elements[${k}]`
    const e = ne.element
    if (!(Number.isInteger(ne.zone_a) && ne.zone_a >= 0 && ne.zone_a < Z)) throw new NetworkError('not a zone', `${p}.zone_a`)
    if (e.boundary === 'zone') {
      if (!(ne.zone_b != null && Number.isInteger(ne.zone_b) && ne.zone_b >= 0 && ne.zone_b < Z)) throw new NetworkError('a two-faced element needs zone_b', `${p}.zone_b`)
      if (e.c.length < 2) throw new NetworkError('a two-faced element needs two faces', p)
      if (!(ne.inside_solar_absorptance_b != null && ne.inside_solar_absorptance_b > 0 && ne.inside_solar_absorptance_b <= 1)) throw new NetworkError('must be in (0, 1]', `${p}.inside_solar_absorptance_b`)
    } else if (ne.zone_b != null) throw new NetworkError('only a two-faced element has zone_b', `${p}.zone_b`)
    arr(ne.solar_absorbed_w_per_m2, `${p}.solar_absorbed_w_per_m2`)
    const a = ne.inside_solar_absorptance
    if (e.interior_solar ? a != null : !(a != null && a > 0 && a <= 1)) throw new NetworkError(e.interior_solar ? 'a window takes its inside optics from the element' : 'must be in (0, 1]', `${p}.inside_solar_absorptance`)
    const an = e.absorbed_node ?? 0
    if (e.boundary !== 'zone' && !(an >= 0 && an < e.c.length - 1)) throw new NetworkError('absorbed_node must be an interior node', p)
  })
  if (!(inp.hc_convective_fraction >= 0 && inp.hc_convective_fraction <= 1)) throw new NetworkError('must be 0 to 1', 'hc_convective_fraction')
  if (inp.control !== 'air' && inp.control !== 'operative') throw new NetworkError('air or operative', 'control')
  if (!(Number.isInteger(inp.warmup_days) && inp.warmup_days >= 0)) throw new NetworkError('a whole number ≥ 0', 'warmup_days')
  const fsc = inp.solar_convective_fraction ?? K.solar_convective_fraction
  if (!(fsc >= 0 && fsc <= 1)) throw new NetworkError('must be in [0, 1]', 'solar_convective_fraction')
  for (let z = 0; z < Z; z++) {
    if (!inp.elements.some((ne) => ne.zone_a === z || ne.zone_b === z)) throw new NetworkError('a zone needs at least one face', `zones[${z}]`)
  }
}

/** One element's interior chain: the nodes between its interface nodes, tridiagonal, Thomas-factorised once. */
interface Chain {
  /** Chain node index of each interior node. */
  first: number
  m: number
  cap: Float64Array
  off: Float64Array
  cp: Float64Array
  piv: Float64Array
  /** Link to face A (the last chain node) from the last interior node, W/K; and to face B (node 0) from the first. */
  gA: number
  gB: number
  /** Responses of the interior to a unit face-A and face-B temperature (B⁻¹·c). */
  wA: Float64Array
  wB: Float64Array | null
}

function thomas(m: number, diag: Float64Array, off: Float64Array, path: string) {
  const cp = new Float64Array(m), piv = new Float64Array(m)
  for (let j = 0; j < m; j++) {
    piv[j] = diag[j] - (j > 0 ? off[j - 1] * cp[j - 1] : 0)
    if (!(Math.abs(piv[j]) > 0)) throw new NetworkError('an element chain is singular', path)
    cp[j] = j < m - 1 ? off[j] / piv[j] : 0
  }
  return { cp, piv }
}
function solveChain(t: Chain, b: Float64Array, y: Float64Array) {
  const { m, off, cp, piv } = t
  if (m === 0) return y
  y[0] = b[0] / piv[0]
  for (let j = 1; j < m; j++) y[j] = (b[j] - off[j - 1] * y[j - 1]) / piv[j]
  for (let j = m - 2; j >= 0; j--) y[j] -= cp[j] * y[j + 1]
  return y
}

export function runNetwork(inp: NetworkInputs): NetworkRun {
  check(inp)
  const Z = inp.zones.length
  const els = inp.elements.map((ne) => ne.element)
  const E = els.length
  const two = els.map((e) => e.boundary === 'zone')
  const fsc = inp.solar_convective_fraction ?? K.solar_convective_fraction

  // ── Interface nodes: zone air nodes 0..Z−1, then each element's face A, then face B of two-faced elements. ──────
  const faceA = new Int32Array(E), faceB = new Int32Array(E).fill(-1)
  let n = Z
  for (let k = 0; k < E; k++) faceA[k] = n++
  for (let k = 0; k < E; k++) if (two[k]) faceB[k] = n++
  // Faces per zone: { node, element, area, tilt, alpha, iso (window optics), side }.
  interface Face { node: number; k: number; area: number; tilt: number; hci: number; alpha: number | null; side: 'a' | 'b' }
  const faces: Face[][] = Array.from({ length: Z }, () => [])
  inp.elements.forEach((ne, k) => {
    const e = els[k]
    faces[ne.zone_a].push({ node: faceA[k], k, area: e.area_m2, tilt: e.tilt_deg, hci: e.h_ci, alpha: ne.inside_solar_absorptance, side: 'a' })
    if (two[k]) faces[ne.zone_b!].push({ node: faceB[k], k, area: e.area_m2, tilt: e.tilt_b_deg!, hci: e.h_ci_b!, alpha: ne.inside_solar_absorptance_b, side: 'b' })
  })
  const Atot = faces.map((fs) => fs.reduce((s, f) => s + f.area, 0))
  const zoneOfNode = new Int32Array(n)
  for (let z = 0; z < Z; z++) { zoneOfNode[z] = z; for (const f of faces[z]) zoneOfNode[f.node] = z }

  // ── Chains ───────────────────────────────────────────────────────────────────────────────────────────────────
  // A boundary element's interior is chain nodes 0..L−2 (node 0 is its outside surface, coupled to the boundary);
  // a two-faced element's is 1..L−2 (node 0 is face B).
  const chains: Chain[] = els.map((e, k) => {
    const L = e.c.length, A = e.area_m2
    const first = two[k] ? 1 : 0
    const m = L - 1 - first
    const cap = new Float64Array(m), diag = new Float64Array(m), off = new Float64Array(Math.max(0, m - 1))
    for (let j = 0; j < m; j++) {
      const i = first + j
      cap[j] = e.c[i] * A
      const left = i === 0 ? e.g_boundary * A : e.g[i - 1] * A
      diag[j] = cap[j] / DT + left + e.g[i] * A
      if (j < m - 1) off[j] = -e.g[i] * A
    }
    const { cp, piv } = thomas(m, diag, off, `elements[${k}]`)
    const t: Chain = { first, m, cap, off, cp, piv, gA: e.g[L - 2] * A, gB: two[k] ? e.g[0] * A : 0, wA: new Float64Array(m), wB: two[k] ? new Float64Array(m) : null }
    if (m > 0) {
      const u = new Float64Array(m); u[m - 1] = -t.gA; solveChain(t, u, t.wA)
      if (t.wB) { const v = new Float64Array(m); v[0] = -t.gB; solveChain(t, v, t.wB) }
    }
    return t
  })

  // ── The interface matrix without ventilation, S0 ─────────────────────────────────────────────────────────────
  const S = new Float64Array(n * n)
  const add = (i: number, j: number, v: number) => { S[i * n + j] += v }
  const capF = new Float64Array(n)
  for (let z = 0; z < Z; z++) {
    capF[z] = inp.zones[z].air_capacity_j_per_k
    add(z, z, inp.zones[z].bridging_w_per_k)
    for (const f of faces[z]) {
      const hc = f.hci * f.area
      add(z, z, hc); add(f.node, f.node, hc); add(z, f.node, -hc); add(f.node, z, -hc)
      for (const q of faces[z]) {
        if (q === f) continue
        const g = (K.h_ri * f.area * q.area) / Atot[z]
        add(f.node, f.node, g); add(f.node, q.node, -g)
      }
    }
  }
  for (let k = 0; k < E; k++) {
    const e = els[k], t = chains[k], A = e.area_m2, L = e.c.length
    capF[faceA[k]] = e.c[L - 1] * A
    if (two[k]) capF[faceB[k]] = e.c[0] * A
    const a = faceA[k]
    if (t.m === 0) {
      // A two-faced element with no interior node: one conductance between its faces.
      const g = e.g[0] * A
      add(a, a, g); add(faceB[k], faceB[k], g); add(a, faceB[k], -g); add(faceB[k], a, -g)
      continue
    }
    add(a, a, t.gA + t.gA * t.wA[t.m - 1])
    if (two[k]) {
      const b = faceB[k]
      add(b, b, t.gB + t.gB * t.wB![0])
      add(a, b, t.gA * t.wB![t.m - 1])
      add(b, a, t.gB * t.wA[0])
    }
  }
  for (let i = 0; i < n; i++) add(i, i, capF[i] / DT)
  const lu: LU = luFactor(S, n)

  // Columns: unit input at each zone's air (ventilation, Woodbury), heating/cooling input, and the control rows.
  const col = (v: Float64Array) => luSolve(lu, v, new Float64Array(n))
  const hcf = inp.hc_convective_fraction
  const U: Float64Array[] = [], W0: Float64Array[] = [], ctl: Float64Array[] = []
  for (let z = 0; z < Z; z++) {
    const ea = new Float64Array(n); ea[z] = 1
    U.push(col(ea))
    const eh = new Float64Array(n); eh[z] = hcf
    for (const f of faces[z]) eh[f.node] += ((1 - hcf) * f.area) / Atot[z]
    W0.push(col(eh))
    const c = new Float64Array(n)
    if (inp.control === 'air') c[z] = 1
    else { c[z] = 0.5; for (const f of faces[z]) c[f.node] += (0.5 * f.area) / Atot[z] }
    ctl.push(c)
  }
  const dot = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s }
  // Z×Z blocks: G = Eᵀ·U, CU = Ctlᵀ·U, CW0 = Ctlᵀ·W0, EW0 = Eᵀ·W0 (row i, column j).
  const G = new Float64Array(Z * Z), CU = new Float64Array(Z * Z), CW0 = new Float64Array(Z * Z), EW0 = new Float64Array(Z * Z)
  for (let i = 0; i < Z; i++) for (let j = 0; j < Z; j++) {
    G[i * Z + j] = U[j][i]; EW0[i * Z + j] = W0[j][i]
    CU[i * Z + j] = dot(ctl[i], U[j]); CW0[i * Z + j] = dot(ctl[i], W0[j])
  }

  // ── Solar inside each zone (Part 1b's rule, per zone) ────────────────────────────────────────────────────────
  // Of diffuse D in zone z, face f takes D·s_f·α_f/den_z (a window: s_f·a/den_z in its pane, s_f·t/den_z lost), with
  // den_z = 1 − Σ s_f·ρ_f. The beam lands on the zone's floor-facing faces by area; they reflect (1 − α) into D.
  const difFace = new Float64Array(n), difPane = new Float64Array(E), difLost = new Float64Array(Z)
  const floorShare = new Float64Array(n), beamRefl = new Float64Array(Z), hasFloor = new Uint8Array(Z)
  for (let z = 0; z < Z; z++) {
    const fs = faces[z]
    const iso = (f: Face) => (f.side === 'a' ? els[f.k].interior_solar ?? null : null)
    const den = 1 - fs.reduce((s, f) => { const o = iso(f); return s + (f.area / Atot[z]) * (o ? 1 - o.transmitted - o.absorbed : 1 - f.alpha!) }, 0)
    for (const f of fs) {
      const sh = f.area / Atot[z], o = iso(f)
      if (o) { difPane[f.k] += (sh * o.absorbed) / den; difLost[z] += (sh * o.transmitted) / den } else difFace[f.node] = (sh * f.alpha!) / den
    }
    const fl = fs.filter((f) => heatFlowDirection(f.tilt) === 'downward')
    const aF = fl.reduce((s, f) => s + f.area, 0)
    if (aF > 0) {
      hasFloor[z] = 1
      for (const f of fl) { floorShare[f.node] = f.area / aF; beamRefl[z] += (f.area / aF) * (1 - (f.alpha ?? 1)) }
    }
  }

  // ── State ────────────────────────────────────────────────────────────────────────────────────────────────────
  const H = inp.hours
  const xF = new Float64Array(n)
  for (let i = 0; i < n; i++) xF[i] = inp.zones[zoneOfNode[i]].initial_c
  const xs = chains.map((t, k) => new Float64Array(t.m).fill(inp.zones[inp.elements[k].zone_a].initial_c))
  const bs = chains.map((t) => new Float64Array(t.m)), ys = chains.map((t) => new Float64Array(t.m))
  // Two-faced elements start from a straight line between their zones' initial temperatures is not needed: the
  // warm-up removes the start state. All interior nodes start at zone_a's initial temperature.
  const sky = els.map((e) => -e.f_sky * e.h_re * K.delta_theta_sky_k * e.area_m2)
  const gBnd = els.map((e) => e.g_boundary * e.area_m2)
  const ground = els.map((e) => e.boundary === 'ground')
  // The middle link of each two-faced element (chain nodes ℓ and ℓ+1): nodes 0..ℓ are zone_b's, the rest zone_a's.
  const mid = els.map((e, k) => (two[k] ? Math.floor((e.c.length - 2) / 2) : -1))

  const zr: NetworkZoneRun[] = inp.zones.map(() => ({
    theta_air: new Float64Array(H), theta_mrt: new Float64Array(H), theta_op: new Float64Array(H),
    heating_w: new Float64Array(H), cooling_w: new Float64Array(H),
    terms: {
      bridging_w: new Float64Array(H), ventilation_w: new Float64Array(H), solar_transmitted_w: new Float64Array(H),
      solar_lost_w: new Float64Array(H), other_gains_w: new Float64Array(H), interzone_w: new Float64Array(H), storage_w: new Float64Array(H),
    },
    closure_wh: new Float64Array(H),
  }))
  const et = els.map(() => ({ boundary_w: new Float64Array(H), solar_absorbed_w: new Float64Array(H), sky_w: new Float64Array(H) }))
  const ezw = els.map((_, k) => (two[k] ? new Float64Array(H) : null))

  const bF = new Float64Array(n), z0 = new Float64Array(n)
  const hv = new Float64Array(Z), hvPrev = new Float64Array(Z).fill(NaN)
  let Mlu: LU | null = null
  const P = new Float64Array(Z * Z)  // M⁻¹·D·EW0
  const R = new Float64Array(Z * Z)  // control response to unit heat in each zone, with this hour's ventilation
  const y0 = new Float64Array(Z), c0 = new Float64Array(Z), phi = new Float64Array(Z), rhsZ = new Float64Array(Z), tmpZ = new Float64Array(Z)
  const mode = new Int8Array(Z)  // 0 free, 1 heating to heat_c, −1 cooling to cool_c
  let maxPasses = 0, hoursOverOne = 0
  const solDiffuse = new Float64Array(Z), radBeam = new Float64Array(Z), ogRad = new Float64Array(Z)

  const step = (h: number, record: boolean) => {
    const te = inp.theta_e[h]
    for (let i = 0; i < n; i++) bF[i] = (capF[i] / DT) * xF[i]
    let hvChanged = false
    for (let z = 0; z < Z; z++) {
      const zn = inp.zones[z]
      hv[z] = zn.ventilation_w_per_k[h]
      if (hv[z] !== hvPrev[z]) hvChanged = true
      const sol = zn.solar_transmitted_w[h]
      const beam = zn.solar_beam_w && hasFloor[z] ? zn.solar_beam_w[h] : 0
      const ogw = zn.other_gains ? zn.other_gains.w[h] : 0, ogc = zn.other_gains ? zn.other_gains.convective_fraction : 0
      bF[z] += zn.bridging_w_per_k * te + fsc * sol + ogc * ogw  // ventilation's h_v·θ_e is added with the Woodbury term below
      radBeam[z] = (1 - fsc) * beam
      solDiffuse[z] = (1 - fsc) * (sol - beam) + radBeam[z] * beamRefl[z]
      ogRad[z] = (1 - ogc) * ogw
      bF[z] += hv[z] * te
    }
    for (let z = 0; z < Z; z++) for (const f of faces[z]) {
      bF[f.node] += solDiffuse[z] * difFace[f.node] + (ogRad[z] * f.area) / Atot[z] + radBeam[z] * floorShare[f.node] * (f.alpha ?? 1)
    }
    for (let k = 0; k < E; k++) {
      const e = els[k], t = chains[k], ne = inp.elements[k]
      if (t.m === 0) continue
      const b = bs[k], x = xs[k], y = ys[k]
      for (let j = 0; j < t.m; j++) b[j] = (t.cap[j] / DT) * x[j]
      if (!two[k]) {
        b[0] += gBnd[k] * (ground[k] ? inp.theta_ground : te) + sky[k]
        b[(e.absorbed_node ?? 0) - t.first] += ne.solar_absorbed_w_per_m2[h] * e.area_m2 + solDiffuse[ne.zone_a] * difPane[k]
      }
      solveChain(t, b, y)
      bF[faceA[k]] += t.gA * y[t.m - 1]
      if (two[k]) bF[faceB[k]] += t.gB * y[0]
    }
    luSolve(lu, bF, z0)

    // Ventilation (rank Z): M = I + D·G; y0 = M⁻¹·D·Eᵀ·z0; P = M⁻¹·D·EW0; R = CW0 − CU·P.
    if (hvChanged || !Mlu) {
      const M = new Float64Array(Z * Z)
      for (let i = 0; i < Z; i++) for (let j = 0; j < Z; j++) M[i * Z + j] = (i === j ? 1 : 0) + hv[i] * G[i * Z + j]
      Mlu = luFactor(M, Z)
      const colIn = new Float64Array(Z), colOut = new Float64Array(Z)
      for (let j = 0; j < Z; j++) {
        for (let i = 0; i < Z; i++) colIn[i] = hv[i] * EW0[i * Z + j]
        luSolve(Mlu, colIn, colOut)
        for (let i = 0; i < Z; i++) P[i * Z + j] = colOut[i]
      }
      for (let i = 0; i < Z; i++) for (let j = 0; j < Z; j++) {
        let s = CW0[i * Z + j]
        for (let q = 0; q < Z; q++) s -= CU[i * Z + q] * P[q * Z + j]
        R[i * Z + j] = s
      }
      hvPrev.set(hv)
    }
    for (let i = 0; i < Z; i++) rhsZ[i] = hv[i] * z0[i]
    luSolve(Mlu, rhsZ, y0)
    for (let i = 0; i < Z; i++) {
      let s = dot(ctl[i], z0)
      for (let q = 0; q < Z; q++) s -= CU[i * Z + q] * y0[q]
      c0[i] = s
    }

    // Ideal loads: hold every zone that would leave its band on it, all together; iterate the set to consistency.
    mode.fill(0)
    for (let z = 0; z < Z; z++) {
      const { heat_c, cool_c } = inp.zones[z].setpoints
      if (heat_c != null && c0[z] < heat_c) mode[z] = 1
      else if (cool_c != null && c0[z] > cool_c) mode[z] = -1
    }
    let passes = 0
    for (;;) {
      passes++
      phi.fill(0)
      const act: number[] = []
      for (let z = 0; z < Z; z++) if (mode[z] !== 0) act.push(z)
      if (act.length) {
        const m = act.length, A = new Float64Array(m * m), r = new Float64Array(m), s = new Float64Array(m)
        act.forEach((zi, i) => {
          const sp = inp.zones[zi].setpoints
          r[i] = (mode[zi] === 1 ? sp.heat_c! : sp.cool_c!) - c0[zi]
          act.forEach((zj, j) => { A[i * m + j] = R[zi * Z + zj] })
        })
        luSolve(luFactor(A, m), r, s)
        act.forEach((zi, i) => { phi[zi] = s[i] })
      }
      let changed = false
      for (let z = 0; z < Z; z++) {
        let c = c0[z]
        for (let j = 0; j < Z; j++) c += R[z * Z + j] * phi[j]
        const { heat_c, cool_c } = inp.zones[z].setpoints
        if (mode[z] === 1 && phi[z] < 0) { mode[z] = 0; changed = true }
        else if (mode[z] === -1 && phi[z] > 0) { mode[z] = 0; changed = true }
        else if (mode[z] === 0 && heat_c != null && c < heat_c - 1e-9) { mode[z] = 1; changed = true }
        else if (mode[z] === 0 && cool_c != null && c > cool_c + 1e-9) { mode[z] = -1; changed = true }
      }
      if (!changed) break
      if (passes > 2 * Z + 2) throw new NetworkError(`the heating/cooling set did not settle in hour ${h}`, 'setpoints')
    }
    if (record) { maxPasses = Math.max(maxPasses, passes); if (passes > 1) hoursOverOne++ }

    // x = z0 + W0·φ − U·(y0 + P·φ).
    for (let i = 0; i < Z; i++) { let s = y0[i]; for (let j = 0; j < Z; j++) s += P[i * Z + j] * phi[j]; tmpZ[i] = s }
    const stored = record ? new Float64Array(Z) : null
    for (let i = 0; i < n; i++) {
      let xi = z0[i]
      for (let j = 0; j < Z; j++) xi += W0[j][i] * phi[j] - U[j][i] * tmpZ[j]
      if (stored) stored[zoneOfNode[i]] += (capF[i] / DT) * (xi - xF[i])
      xF[i] = xi
    }
    for (let k = 0; k < E; k++) {
      const t = chains[k], x = xs[k], y = ys[k], wB = t.wB
      const xa = xF[faceA[k]], xb = two[k] ? xF[faceB[k]] : 0
      const za = inp.elements[k].zone_a, zb = inp.elements[k].zone_b
      for (let j = 0; j < t.m; j++) {
        const xj = y[j] - t.wA[j] * xa - (wB ? wB[j] * xb : 0)
        if (stored) {
          const node = t.first + j
          stored[two[k] && node <= mid[k] ? zb! : za] += (t.cap[j] / DT) * (xj - x[j])
        }
        x[j] = xj
      }
    }
    if (!record) return

    // ── Terms and closure, per zone ────────────────────────────────────────────────────────────────────────────
    const sum = new Float64Array(Z)
    for (let z = 0; z < Z; z++) {
      const zn = inp.zones[z], T = zr[z].terms, ta = xF[z]
      sum[z] += (T.bridging_w[h] = zn.bridging_w_per_k * (te - ta)) + (T.ventilation_w[h] = hv[z] * (te - ta))
        + (T.solar_transmitted_w[h] = zn.solar_transmitted_w[h]) + (T.solar_lost_w[h] = -solDiffuse[z] * difLost[z])
        + (T.other_gains_w[h] = zn.other_gains ? zn.other_gains.w[h] : 0) + phi[z]
      if (phi[z] > 0) zr[z].heating_w[h] = phi[z]; else if (phi[z] < 0) zr[z].cooling_w[h] = -phi[z]
    }
    for (let k = 0; k < E; k++) {
      const e = els[k], ne = inp.elements[k]
      if (!two[k]) {
        const node0 = xs[k].length ? xs[k][0] : xF[faceA[k]]
        const tb = ground[k] ? inp.theta_ground : te
        sum[ne.zone_a] += (et[k].boundary_w[h] = gBnd[k] * (tb - node0))
        sum[ne.zone_a] += (et[k].solar_absorbed_w[h] = ne.solar_absorbed_w_per_m2[h] * e.area_m2)
        sum[ne.zone_a] += (et[k].sky_w[h] = sky[k])
        continue
      }
      // Heat across the middle link, from the zone_b side (chain node ℓ) into the zone_a side (node ℓ+1).
      const node = (i: number) => (i === 0 ? xF[faceB[k]] : i === e.c.length - 1 ? xF[faceA[k]] : xs[k][i - 1])
      const l = mid[k]
      const q = e.g[l] * e.area_m2 * (node(l) - node(l + 1))
      ezw[k]![h] = q
      if (ne.zone_b !== ne.zone_a) {
        zr[ne.zone_a].terms.interzone_w[h] += q
        zr[ne.zone_b!].terms.interzone_w[h] -= q
      }
    }
    for (let z = 0; z < Z; z++) {
      const r = zr[z], fs = faces[z]
      sum[z] += r.terms.interzone_w[h]
      r.terms.storage_w[h] = stored![z]
      r.closure_wh[h] = Math.abs(sum[z] - stored![z])
      let mrt = 0
      for (const f of fs) mrt += (xF[f.node] * f.area) / Atot[z]
      r.theta_air[h] = xF[z]; r.theta_mrt[h] = mrt; r.theta_op[h] = 0.5 * (xF[z] + mrt)
    }
  }

  for (let d = 0; d < inp.warmup_days; d++) for (let h = 0; h < 24; h++) step(h, false)
  for (let h = 0; h < H; h++) step(h, true)
  const nodes = n + chains.reduce((s, t) => s + t.m, 0)
  return { hours: H, zones: zr, element_terms: et, element_interzone_w: ezw, nodes, active_set: { max_passes: maxPasses, hours_over_one: hoursOverOne } }
}
