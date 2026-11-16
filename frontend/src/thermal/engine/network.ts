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
 * The interface system (air, inside-surface and radiant star nodes of every zone) is sparse and factorised once per
 * run (Part 6, sparse.ts). Each hour two sparse solves give the state: one without ventilation or heating, then the
 * full one. Between them, each zone's ventilation and its heating or cooling are found from a Z-unknown system on
 * the air temperatures (Z×Z responses precomputed once). Heating and cooling are ideal: the zones whose control
 * temperature would leave the band are held on it together; the set starts from the hour before and is iterated
 * until consistent; the passes are counted and recorded.
 *
 * Every hour, every zone's balance is closed: Σ terms + heating − cooling − Δstorage over the zone's own nodes. The
 * heat crossing between zones is a term of each zone (`interzone_w`). An element between two zones is split at the
 * link nearest its middle: the nodes on each side belong to that side's zone, and the heat across that link is the
 * interzone transfer, so the two zones' transfers cancel exactly.
 */
import { ENGINE_CONSTANTS as K, heatFlowDirection } from './constants'
import type { Element } from './elements'
import { luFactor, luFactorInto, luSolve, type LU } from './linalg'
import { sparseLuFactor, sparseLuSolve, type SparseLU } from './sparse'
import { checkSetpointHours } from './zone'

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
  other_gains: { w: ArrayLike<number>; convective_fraction: number | ArrayLike<number> } | null
  setpoints: { heat_c: number | null; cool_c: number | null }
  /** Brief 109: each hour's setpoints in place of setpoints (NaN: off that hour); as Engine 1's. */
  setpoint_hours?: { heat_c: ArrayLike<number>; cool_c: ArrayLike<number> } | null
  /** Brief 108: the most heat the zone's emitters can give, W (null or absent: unlimited, ideal loads). */
  heating_cap_w?: number | null
  /** Brief 119: the most sensible cooling the zone's units give, W (null or absent: unlimited, ideal loads). */
  cooling_cap_w?: number | null
  /**
   * Brief 108 review F1: the emitters' output with the room at a given temperature, W. When given, in place of
   * heating_cap_w, each step's limit is this at the zone's control temperature at the end of the step before.
   */
  heating_cap_at?: ((room_c: number) => number) | null
  /** Brief 108: heating's share to the air when it differs from cooling's (the emitters'). Absent: hc_convective_fraction. */
  heating_convective_fraction?: number | null
  /**
   * Brief 109: underfloor heating in a floor. `share` of the zone's heating enters node `node` of element `element`
   * (inside the floor, on this zone's side of it); the rest reaches the room as heating_convective_fraction says.
   */
  heating_source?: { element: number; node: number; share: number } | null
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
  /**
   * Brief 105 Part 6: time steps per hour (absent: 1). The hourly inputs (solar, gains, ventilation) are held over
   * the hour; the outdoor temperature as `theta_e_between` says. Outputs stay hourly: means of the steps (W, °C), and
   * the hour's closure.
   */
  steps_per_hour?: number
  /**
   * Between steps of one hour: 'hold' the hour's outdoor temperature (absent), or 'linear' from the hour before's
   * reading to this hour's, reaching it at the hour's last step (EnergyPlus's convention for weather between readings).
   */
  theta_e_between?: 'hold' | 'linear'
  /**
   * Brief 105 Part 6: each face's convection with its zone's air. Absent or 'fixed': the element's h_ci (ISO 52016-1
   * Table 25 by tilt). 'tarp': Walton's natural-convection correlations, EnergyPlus's TARP inside algorithm, from the
   * face's tilt and its temperature difference with the air at the step before:
   *   heat flow unstable (a warm face looking up, a cool face looking down):  h = 9.482·|ΔT|^⅓ / (7.238 − |cos Σ|)
   *   heat flow stable (a warm face looking down, a cool face looking up):    h = 1.810·|ΔT|^⅓ / (1.382 + |cos Σ|)
   * (both 1.31·|ΔT|^⅓ on a vertical face), at least ENGINE_CONSTANTS.h_ci_tarp_min. The interface matrix is rebuilt
   * every step.
   */
  inside_convection?: 'fixed' | 'tarp'
  /**
   * Brief 120: plant (system) capacity. Each step, the zones a plant serves draw at most `cap_w` from it, less
   * `reserved_w` that hour (hot water it heats first), summed over its share of each zone's heating (or cooling). When
   * they ask for more:
   * - a heating plant with `flow` (every zone it serves has wet emitters on it) cannot hold its flow temperature: the
   *   water reaches every emitter at one lower flow temperature, found so that what the emitters give at it (each
   *   zone taking no more than it asks) is what the plant has, and each zone's limit is its emitters' output at that
   *   flow (Brief 120 P2b; EnergyPlus's plant loop does the same, docs/audit/120/02_referee.md). A room with bigger
   *   emitters keeps more;
   * - otherwise each zone gets the same fraction of what it asked for after its own emitters' limit;
   * and what it leaves a zone short is covered by the zone's other systems (Linzie, 16 Nov 19:48, "the boiler tops
   * up"): in full by systems with no capacity (`plant_free_share`), else by plants with spare capacity, up to it. The
   * step is solved again with what is left as each limited zone's limit (and again while a plant still gives more than
   * it has, as the zones' heat moves between them). Each plant's give to each zone is recorded (`zone_w`). Absent or
   * empty: no plant limits (as before Brief 120).
   */
  plants?: NetworkPlant[] | null
  /**
   * Review F1 (Linzie, 16 Nov 19:48): per zone, the share of its heating and of its cooling on systems with no capacity
   * (0 to 1). They cover a short plant's deficit in that zone in full (they top up). Absent: none.
   */
  plant_free_share?: { heating: ArrayLike<number>; cooling: ArrayLike<number> } | null
}

export interface NetworkPlant {
  service: 'heating' | 'cooling'
  /** The plant's output, W (heat delivered, or sensible cooling). */
  cap_w: number
  /** The zones it serves and its share of each one's heating (or cooling), 0 to 1. */
  zones: { zone: number; share: number }[]
  /** Each hour, W of the capacity taken first by something else (hot water with priority); null: none. */
  reserved_w?: ArrayLike<number> | null
  /**
   * Brief 120 P2b: a heating plant feeding wet emitters. `design_c` is its flow temperature; `out[k]` the output of
   * the emitters it feeds in `zones[k]` with the room at `room_c` and the water arriving at `flow_c`, W. Null: shares
   * in proportion to ask.
   */
  flow?: { design_c: number; out: ((room_c: number, flow_c: number) => number)[] } | null
}

export interface NetworkPlantRun {
  /** Each hour: what the zones asked of the plant before its limit (after the emitters'), what it gave them, W; and the share of the hour it was short (0 to 1). */
  ask_w: Float64Array
  delivered_w: Float64Array
  short: Float64Array
  /** Brief 120 P2b: each hour's lowest flow temperature, °C (a plant with `flow`; its design flow when not short), else null. */
  flow_c: Float64Array | null
  /** Review F1: what it gave each zone it serves (in `zones` order) each hour, W; Σ over them = delivered_w. */
  zone_w: Float64Array[]
}

export interface NetworkZoneRun {
  theta_air: Float64Array
  theta_mrt: Float64Array
  theta_op: Float64Array
  heating_w: Float64Array
  cooling_w: Float64Array
  /** Review F1: each hour's heating limit, W, when it follows the room's temperature (heating_cap_at); otherwise absent. */
  heating_cap_w?: Float64Array
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
  /** Brief 120: the share of each hour (0 to 1) the zone's heating or cooling was held below its ask by a plant's limit; absent without plants. */
  plant_limited?: Float64Array
  /**
   * Brief 120 review F3: the share of each hour (0 to 1) the zone's own emitters or units were at their limit in what it
   * asked of its plants (before any plant limit): it would have run short with no plant limit too. Absent without plants.
   */
  own_limited?: Float64Array
}

export interface NetworkRun {
  hours: number
  zones: NetworkZoneRun[]
  /**
   * Per element, over the run, Wh, positive into the building: the outside or ground boundary, outside absorbed
   * solar, sky (the hours summed in order). Annual, not hourly: per-element hourly arrays would be most of a large
   * model's memory, and only their sums are reported; every hour's closure is checked inside the run.
   */
  element_terms: { boundary_wh: number; solar_absorbed_wh: number; sky_wh: number }[]
  /** Per element between two zones: heat into zone_a from zone_b across the element's middle link over the run, Wh. */
  element_interzone_wh: (number | null)[]
  nodes: number
  /** Most passes of the active-set iteration in any hour, and the hours that needed more than one. */
  active_set: { max_passes: number; hours_over_one: number }
  /** Brief 120: per plant, in the order given (empty without plants). */
  plants: NetworkPlantRun[]
}

export class NetworkError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'NetworkError' }
}

function check(inp: NetworkInputs) {
  const H = inp.hours
  const arr = (a: ArrayLike<number>, p: string) => {
    if (!a || a.length < H) throw new NetworkError(`needs ${H} hourly values`, p)
    for (let i = 0; i < H; i++) if (!Number.isFinite(a[i])) throw new NetworkError(`hour ${i} is not a number`, p)
  }
  if (inp.zones.length === 0) throw new NetworkError('at least one zone', 'zones')
  ;(inp.plants ?? []).forEach((pl, i) => {
    const p = `plants[${i}]`
    if (pl.service !== 'heating' && pl.service !== 'cooling') throw new NetworkError(`unknown service "${String(pl.service)}"`, `${p}.service`)
    if (!(pl.cap_w > 0) || !Number.isFinite(pl.cap_w)) throw new NetworkError('must be above 0', `${p}.cap_w`)
    for (const { zone, share } of pl.zones) {
      if (!(zone >= 0 && zone < inp.zones.length)) throw new NetworkError(`no zone ${zone}`, `${p}.zones`)
      if (!(share >= 0 && share <= 1)) throw new NetworkError('a share must be 0 to 1', `${p}.zones`)
    }
    if (pl.reserved_w) {
      arr(pl.reserved_w, `${p}.reserved_w`)
      for (let h = 0; h < H; h++) if (pl.reserved_w[h] < 0) throw new NetworkError(`hour ${h} is negative`, `${p}.reserved_w`)
    }
    if (pl.flow) {
      if (pl.service !== 'heating') throw new NetworkError('only a heating plant feeds emitters by flow temperature', `${p}.flow`)
      if (!Number.isFinite(pl.flow.design_c)) throw new NetworkError('must be a temperature', `${p}.flow.design_c`)
      if (pl.flow.out.length !== pl.zones.length || pl.flow.out.some((f) => typeof f !== 'function')) throw new NetworkError('one output function per zone served', `${p}.flow.out`)
    }
  })
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
    checkSetpointHours(z.setpoint_hours, H, NetworkError, `${p}.setpoint_hours`)
    if (!Number.isFinite(z.initial_c)) throw new NetworkError('required', `${p}.initial_c`)
    if (z.heating_cap_w != null && !(z.heating_cap_w >= 0)) throw new NetworkError('must be ≥ 0', `${p}.heating_cap_w`)
    if (z.cooling_cap_w != null && !(z.cooling_cap_w >= 0)) throw new NetworkError('must be ≥ 0', `${p}.cooling_cap_w`)
    if (z.heating_cap_at != null && z.heating_cap_w != null) throw new NetworkError('give a fixed limit or one that follows the room, not both', `${p}.heating_cap_at`)
    if (z.heating_cap_at != null && typeof z.heating_cap_at !== 'function') throw new NetworkError('must be a function of the room temperature', `${p}.heating_cap_at`)
    if (z.heating_convective_fraction != null && !(z.heating_convective_fraction >= 0 && z.heating_convective_fraction <= 1)) throw new NetworkError('must be 0 to 1', `${p}.heating_convective_fraction`)
    if (z.other_gains !== null) {
      arr(z.other_gains.w, `${p}.other_gains.w`)
      const f = z.other_gains.convective_fraction
      if (typeof f === 'number') { if (!(f >= 0 && f <= 1)) throw new NetworkError('must be 0 to 1', `${p}.other_gains.convective_fraction`) }
      else {
        arr(f, `${p}.other_gains.convective_fraction`)
        for (let h = 0; h < f.length; h++) if (!(f[h] >= 0 && f[h] <= 1)) throw new NetworkError(`hour ${h} must be 0 to 1`, `${p}.other_gains.convective_fraction`)
      }
    }
  })
  const Z = inp.zones.length
  inp.zones.forEach((z, zi) => {
    const src = z.heating_source
    if (src == null) return
    const p = `zones[${zi}].heating_source`, ne = inp.elements[src.element]
    if (!ne) throw new NetworkError('not an element', `${p}.element`)
    if (!(src.share > 0 && src.share <= 1)) throw new NetworkError('must be above 0, at most 1', `${p}.share`)
    const L = ne.element.c.length, isTwo = ne.element.boundary === 'zone'
    // Inside the element (not a face), and on this zone's side of a floor between two zones (its storage is counted there).
    if (!(Number.isInteger(src.node) && src.node >= (isTwo ? 1 : 0) && src.node <= L - 2)) throw new NetworkError('must be a node inside the element, not a face', `${p}.node`)
    const mid = isTwo ? Math.floor((L - 2) / 2) : -1
    const side = isTwo && src.node <= mid ? ne.zone_b : ne.zone_a
    if (side !== zi) throw new NetworkError(`the node is on ${isTwo ? 'the other zone\'s side of the floor' : 'another zone\'s element'}`, `${p}.node`)
  })
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
  const N = inp.steps_per_hour ?? 1
  if (!(Number.isInteger(N) && N >= 1 && N <= 60)) throw new NetworkError('a whole number from 1 to 60', 'steps_per_hour')
  if (inp.theta_e_between != null && inp.theta_e_between !== 'hold' && inp.theta_e_between !== 'linear') throw new NetworkError("'hold' or 'linear'", 'theta_e_between')
  if (inp.inside_convection != null && inp.inside_convection !== 'fixed' && inp.inside_convection !== 'tarp') throw new NetworkError("'fixed' or 'tarp'", 'inside_convection')
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
  const operative = inp.control === 'operative'
  const N = inp.steps_per_hour ?? 1
  const DT = 3600 / N
  const tarp = inp.inside_convection === 'tarp'

  // ── Nodes: zone air 0..Z−1, each element's face A, face B of two-faced elements, then each zone's radiant star
  // node (Part 6). ISO 52016-1 eq. 30's exchange h_ri·A_i·A_k/A_tot between every pair of a zone's faces is exactly a
  // star: each face coupled to one node by h_ri·A_i, that node with no capacity. Its temperature is the zone's mean
  // radiant temperature. The star keeps the matrix sparse: a face touches its zone's air and star nodes and, on a
  // two-faced element, the face on its other side.
  const faceA = new Int32Array(E), faceB = new Int32Array(E).fill(-1)
  let n = Z
  for (let k = 0; k < E; k++) faceA[k] = n++
  for (let k = 0; k < E; k++) if (two[k]) faceB[k] = n++
  const nFaces = n - Z
  const rad = new Int32Array(Z)
  for (let z = 0; z < Z; z++) rad[z] = n++
  interface Face { node: number; k: number; area: number; tilt: number; hci: number; alpha: number | null; side: 'a' | 'b' }
  const faces: Face[][] = Array.from({ length: Z }, () => [])
  inp.elements.forEach((ne, k) => {
    const e = els[k]
    faces[ne.zone_a].push({ node: faceA[k], k, area: e.area_m2, tilt: e.tilt_deg, hci: e.h_ci, alpha: ne.inside_solar_absorptance, side: 'a' })
    if (two[k]) faces[ne.zone_b!].push({ node: faceB[k], k, area: e.area_m2, tilt: e.tilt_b_deg!, hci: e.h_ci_b!, alpha: ne.inside_solar_absorptance_b, side: 'b' })
  })
  const Atot = faces.map((fs) => fs.reduce((s, f) => s + f.area, 0))
  const zoneOfNode = new Int32Array(n)
  for (let z = 0; z < Z; z++) { zoneOfNode[z] = z; zoneOfNode[rad[z]] = z; for (const f of faces[z]) zoneOfNode[f.node] = z }

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

  // Flat per-face arrays for the hourly loops, and each face's convection coefficient (fixed, or TARP's each step).
  const fNode = new Int32Array(nFaces), fZone = new Int32Array(nFaces), fArea = new Float64Array(nFaces), fAlpha = new Float64Array(nFaces)
  const fHci = new Float64Array(nFaces), fCos = new Float64Array(nFaces), fUp = new Float64Array(nFaces)
  {
    let q = 0
    for (let z = 0; z < Z; z++) for (const f of faces[z]) {
      fNode[q] = f.node; fZone[q] = z; fArea[q] = f.area; fAlpha[q] = f.alpha ?? 1; fHci[q] = f.hci
      // The face looks into the zone, against the element's outward normal (tilt from up): it looks up when tilt > 90°.
      const c = Math.cos((f.tilt * Math.PI) / 180)
      fCos[q] = Math.abs(c) < 1e-12 ? 0 : Math.abs(c); fUp[q] = c < -1e-12 ? 1 : c > 1e-12 ? -1 : 0
      q++
    }
  }

  // ── The interface matrix without ventilation, S0, sparse ─────────────────────────────────────────────────────
  // Everything but the faces' convection is fixed for the run (`base`); convection is added by `assemble`, once, or
  // every step for TARP.
  const rows: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  const add = (i: number, j: number, v: number) => { rows[i].set(j, (rows[i].get(j) ?? 0) + v) }
  const link = (i: number, j: number, g: number) => { add(i, i, g); add(j, j, g); add(i, j, -g); add(j, i, -g) }
  const capF = new Float64Array(n)
  for (let z = 0; z < Z; z++) {
    capF[z] = inp.zones[z].air_capacity_j_per_k
    add(z, z, inp.zones[z].bridging_w_per_k)
    for (const f of faces[z]) link(f.node, rad[z], K.h_ri * f.area)      // long-wave through the zone's star node
  }
  for (let k = 0; k < E; k++) {
    const e = els[k], t = chains[k], A = e.area_m2, L = e.c.length
    capF[faceA[k]] = e.c[L - 1] * A
    if (two[k]) capF[faceB[k]] = e.c[0] * A
    const a = faceA[k]
    if (t.m === 0) { link(a, faceB[k], e.g[0] * A); continue }  // a two-faced element with no interior node
    add(a, a, t.gA + t.gA * t.wA[t.m - 1])
    if (two[k]) {
      const b = faceB[k]
      add(b, b, t.gB + t.gB * t.wB![0])
      add(a, b, t.gA * t.wB![t.m - 1])
      add(b, a, t.gB * t.wA[0])
    }
  }
  const capDT = Float64Array.from(capF, (c) => c / DT)
  for (let i = 0; i < n; i++) add(i, i, capDT[i])
  const base = rows.map((r) => new Map(r))
  // Faces first; then each zone's star and air nodes, zone by zone (adjacent zones adjacent, so a stack stays banded).
  const order = new Int32Array(n)
  for (let i = 0; i < nFaces; i++) order[i] = Z + i
  for (let z = 0; z < Z; z++) { order[nFaces + 2 * z] = rad[z]; order[nFaces + 2 * z + 1] = z }
  let lu: SparseLU

  // Heating/cooling input vectors (convective share at the air, the rest over the zone's faces by area), and the
  // Z×Z responses at the air and star nodes to unit input at each air node (G, Gr) and to unit heating (EW, RW).
  // Brief 108: heating and cooling each have their own split (a zone's emitters give part of their heat as radiation);
  // EW, RW are heating's responses, EWc, RWc cooling's. Where the two splits are the same the columns are copied.
  const hcf = inp.hc_convective_fraction
  const hcfH = Float64Array.from(inp.zones, (z) => z.heating_convective_fraction ?? hcf)
  const capW = Float64Array.from(inp.zones, (z) => z.heating_cap_w ?? Infinity)
  const capC = Float64Array.from(inp.zones, (z) => z.cooling_cap_w ?? Infinity)
  // Review F1: a limit that follows the room is set each step from the control temperature at the end of the step before.
  const capAt = inp.zones.map((z) => z.heating_cap_at ?? null)
  const anyCapAt = capAt.some((f) => f != null)
  const ctlPrev = Float64Array.from(inp.zones, (z) => z.initial_c)
  const capRec = inp.zones.map((z) => (z.heating_cap_at ? new Float64Array(inp.hours) : null))
  const ehNodes: Int32Array[] = [], ehW: Float64Array[] = [], ecW: Float64Array[] = []
  const split = (z: number, f: number) => Float64Array.from([f, ...faces[z].map((x) => ((1 - f) * x.area) / Atot[z])])
  // Brief 109: heat into a floor's interior node j reaches the interface through that element's chain only. The chain
  // solves B·y = b; a unit at j adds u = B⁻¹·e_j to y, so faces A and B see g_A·u_last and g_B·u_0 (as the stored
  // heat does), and after the step the chain's nodes take φ_slab·u on top. srcU is u per zone (null: no slab).
  const srcU: (Float64Array | null)[] = inp.zones.map((z) => {
    const src = z.heating_source
    if (!src) return null
    const t = chains[src.element], e = new Float64Array(t.m), u = new Float64Array(t.m)
    e[src.node - t.first] = 1
    solveChain(t, e, u)
    return u
  })
  const srcK = Int32Array.from(inp.zones, (z) => z.heating_source?.element ?? -1)
  const srcShare = Float64Array.from(inp.zones, (z) => z.heating_source?.share ?? 0)
  for (let z = 0; z < Z; z++) {
    const u = srcU[z], k = srcK[z]
    const nodes = [z, ...faces[z].map((f) => f.node)]
    ecW.push(split(z, hcf))
    let wh = hcfH[z] === hcf ? ecW[z] : split(z, hcfH[z])
    if (u) {
      const s = srcShare[z], t = chains[k]
      const w = [...Array.from(wh, (x) => (1 - s) * x), s * t.gA * u[t.m - 1]]
      nodes.push(faceA[k])
      if (two[k]) { w.push(s * t.gB * u[0]); nodes.push(faceB[k]) }
      wh = Float64Array.from(w)
      // Cooling keeps the zone's own split; its weights cover the leading nodes only.
      const c = new Float64Array(nodes.length); c.set(ecW[z]); ecW[z] = c
    }
    ehNodes.push(Int32Array.from(nodes))
    ehW.push(wh)
  }
  const G = new Float64Array(Z * Z), Gr = new Float64Array(Z * Z), EW = new Float64Array(Z * Z), RW = new Float64Array(Z * Z)
  const EWc = new Float64Array(Z * Z), RWc = new Float64Array(Z * Z)
  const admittance = !operative && hcf === 1 && hcfH.every((f) => f === 1) && srcU.every((u) => u == null)
  const Y = new Float64Array(admittance ? Z * Z : 0)
  const assemble = () => {
    for (let i = 0; i < n; i++) { rows[i].clear(); for (const [j, v] of base[i]) rows[i].set(j, v) }
    for (let q = 0; q < nFaces; q++) link(fZone[q], fNode[q], fHci[q] * fArea[q])  // convection with the zone's air
    lu = sparseLuFactor(n, rows, order)
    const v = new Float64Array(n), x = new Float64Array(n)
    for (let j = 0; j < Z; j++) {
      v.fill(0); v[j] = 1
      sparseLuSolve(lu, v, x)
      for (let i = 0; i < Z; i++) { G[i * Z + j] = x[i]; Gr[i * Z + j] = x[rad[i]] }
      v.fill(0)
      for (let q = 0; q < ehNodes[j].length; q++) v[ehNodes[j][q]] += ecW[j][q]
      sparseLuSolve(lu, v, x)
      for (let i = 0; i < Z; i++) { EWc[i * Z + j] = x[i]; RWc[i * Z + j] = x[rad[i]] }
      if (ehW[j] === ecW[j]) { for (let i = 0; i < Z; i++) { EW[i * Z + j] = EWc[i * Z + j]; RW[i * Z + j] = RWc[i * Z + j] } continue }
      v.fill(0)
      for (let q = 0; q < ehNodes[j].length; q++) v[ehNodes[j][q]] += ehW[j][q]
      sparseLuSolve(lu, v, x)
      for (let i = 0; i < Z; i++) { EW[i * Z + j] = x[i]; RW[i * Z + j] = x[rad[i]] }
    }
    if (admittance) {
      const fG = luFactor(G, Z), e = new Float64Array(Z), col = new Float64Array(Z)
      for (let j = 0; j < Z; j++) { e.fill(0); e[j] = 1; luSolve(fG, e, col); for (let i = 0; i < Z; i++) Y[i * Z + j] = col[i] }
      for (let i = 0; i < Z; i++) for (let j = 0; j < i; j++) { const w = 0.5 * (Y[i * Z + j] + Y[j * Z + i]); Y[i * Z + j] = w; Y[j * Z + i] = w }
    }
  }
  assemble()
  /** TARP: each face's coefficient from its temperature difference with its zone's air at the step before. */
  const tarpCoefficients = () => {
    for (let q = 0; q < nFaces; q++) {
      const dT = xF[fNode[q]] - xF[fZone[q]], a = Math.cbrt(Math.abs(dT))
      const unstable = dT * fUp[q] > 0
      const h = unstable ? (K.tarp_unstable_a * a) / (K.tarp_unstable_b - fCos[q]) : (K.tarp_stable_a * a) / (K.tarp_stable_b + fCos[q])
      fHci[q] = Math.max(K.h_ci_tarp_min, h)
    }
    assemble()
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
  // All interior nodes start at zone_a's initial temperature; the warm-up removes the start state.
  const sky = els.map((e) => -e.f_sky * e.h_re * K.delta_theta_sky_k * e.area_m2)
  const gBnd = els.map((e) => e.g_boundary * e.area_m2)
  const ground = els.map((e) => e.boundary === 'ground')
  const absAt = els.map((e, k) => (e.absorbed_node ?? 0) - chains[k].first)
  const elZoneA = Int32Array.from(inp.elements, (ne) => ne.zone_a)
  const elZoneB = Int32Array.from(inp.elements, (ne) => ne.zone_b ?? -1)
  // The middle link of each two-faced element (chain nodes ℓ and ℓ+1): nodes 0..ℓ are zone_b's, the rest zone_a's.
  const mid = els.map((e, k) => (two[k] ? Math.floor((e.c.length - 2) / 2) : -1))
  // The chains' state and factors in flat arrays (Part 6): element k's interior nodes are cO[k] .. cO[k + 1] − 1.
  const cO = new Int32Array(E + 1)
  for (let k = 0; k < E; k++) cO[k + 1] = cO[k] + chains[k].m
  const NC = cO[E]
  const CX = new Float64Array(NC), CY = new Float64Array(NC), CD = new Float64Array(NC), COFF = new Float64Array(NC)
  const CCP = new Float64Array(NC), CPIV = new Float64Array(NC), CWA = new Float64Array(NC), CWB = new Float64Array(NC)
  const CZ = new Int32Array(NC)  // the zone whose storage each chain node counts in
  const gAc = new Float64Array(E), gBc = new Float64Array(E)
  for (let k = 0; k < E; k++) {
    const t = chains[k], o = cO[k]
    gAc[k] = t.gA; gBc[k] = t.gB
    for (let j = 0; j < t.m; j++) {
      CX[o + j] = inp.zones[inp.elements[k].zone_a].initial_c
      CD[o + j] = t.cap[j] / DT
      if (j > 0) COFF[o + j] = t.off[j - 1]
      CCP[o + j] = t.cp[j]; CPIV[o + j] = t.piv[j]; CWA[o + j] = t.wA[j]; CWB[o + j] = t.wB ? t.wB[j] : 0
      CZ[o + j] = two[k] && t.first + j <= mid[k] ? elZoneB[k] : elZoneA[k]
    }
  }
  const heatC = Float64Array.from(inp.zones, (z) => z.setpoints.heat_c ?? NaN)
  const coolC = Float64Array.from(inp.zones, (z) => z.setpoints.cool_c ?? NaN)
  // Brief 109: zones whose setpoints change by the hour; read at the start of each hour's steps.
  const spH = inp.zones.map((z) => z.setpoint_hours ?? null)
  const anySpH = spH.some((x) => x != null)
  const ventIn = inp.zones.map((z) => z.ventilation_w_per_k), solIn = inp.zones.map((z) => z.solar_transmitted_w)
  const beamIn = inp.zones.map((z, i) => (z.solar_beam_w && hasFloor[i] ? z.solar_beam_w : null))
  const ogIn = inp.zones.map((z) => (z.other_gains ? z.other_gains.w : null))
  // Brief 105 Part 2: a zone's convective share is one number, or one per hour (several gains, each its own split).
  const ogC = Float64Array.from(inp.zones, (z) => (typeof z.other_gains?.convective_fraction === 'number' ? z.other_gains.convective_fraction : 0))
  const ogCh = inp.zones.map((z) => (z.other_gains && typeof z.other_gains.convective_fraction !== 'number' ? z.other_gains.convective_fraction : null))
  const brid = Float64Array.from(inp.zones, (z) => z.bridging_w_per_k)
  // Hour-major copies of the per-element and per-zone hourly inputs, and hour-major outputs unpacked at the end
  // (Part 6): each hour then reads and writes a few contiguous rows instead of one value from each of hundreds of
  // year-long arrays. The values are the same products, computed once.
  const absP = new Float64Array(H * E)
  for (let k = 0; k < E; k++) { const a = inp.elements[k].solar_absorbed_w_per_m2, A = els[k].area_m2; for (let h = 0; h < H; h++) absP[h * E + k] = a[h] * A }
  const zIn = new Float64Array(H * Z * 3)  // ventilation, transmitted solar, beam
  for (let z = 0; z < Z; z++) {
    const v = ventIn[z], so = solIn[z], be = beamIn[z]
    for (let h = 0; h < H; h++) { const o = (h * Z + z) * 3; zIn[o] = v[h]; zIn[o + 1] = so[h]; zIn[o + 2] = be ? be[h] : 0 }
  }
  const NO = 13  // per zone and hour: air, mrt, op, heating, cooling, bridging, ventilation, solar in, solar lost, other, interzone, storage, closure
  const zOut = new Float64Array(H * Z * NO)
  const elB = new Float64Array(E), elS = new Float64Array(E), elK = new Float64Array(E), elI = new Float64Array(E)


  const bF = new Float64Array(n), z0 = new Float64Array(n), rhs = new Float64Array(n)
  const hv = new Float64Array(Z), phi = new Float64Array(Z), xa = new Float64Array(Z)
  // 0 free, 1 heating to heat_c, −1 cooling to cool_c, 2 heating at its limit (Brief 108: free, with the emitters'
  // whole output as a known input), −2 cooling at its limit (Brief 119: the units' whole cooling, known); kept from
  // the hour before.
  const mode = new Int8Array(Z)
  const held = (j: number) => mode[j] === 1 || mode[j] === -1
  const Ecol = (j: number) => (mode[j] < 0 ? EWc : EW)
  const Rcol = (j: number) => (mode[j] < 0 ? RWc : RW)
  /** A zone at its limit: its heating (+) or cooling (−), known; 0 otherwise. */
  const known = (j: number) => (mode[j] === 2 ? capW[j] : mode[j] === -2 ? -capC[j] : 0)
  let maxPasses = 0, hoursOverOne = 0
  const solDiffuse = new Float64Array(Z), radBeam = new Float64Array(Z), ogRad = new Float64Array(Z)
  const stored = new Float64Array(Z), sum = new Float64Array(Z), izs = new Float64Array(Z)
  const NM = operative ? 2 * Z : Z
  const Am = new Float64Array(NM * NM), bm = new Float64Array(NM), um = new Float64Array(NM)
  const luM: LU = { n: NM, lu: new Float64Array(NM * NM), piv: new Int32Array(NM) }
  // Air control with all heating at the air node (EW = G): the admittance form. With Y = G⁻¹ (symmetric positive
  // definite, as S0 is), x_a = z0 + G·(φ − H_v·x_a) is (Y + H_v)·x_a = Y·z0 + φ, so the free zones solve
  // K_FF·x_F = w_F − Y_FH·x_H with K = Y + H_v and w = Y·z0, by Cholesky, and each held zone's φ is (K·x_a − w)_i.
  // This replaces a dense Z×Z LU every hour by a Cholesky of the free zones only (Part 6).
  const wY = new Float64Array(Z), Kc = new Float64Array(admittance ? Z * Z : 0)
  const freeIdx = new Int32Array(Z)
  const actIdx = new Int32Array(Z)

  /**
   * The reduced hourly system: with x = S0⁻¹·(b + Σ_j e_j·q_j + Σ_j eh_j·φ_j), the air temperatures obey
   * x_a = z0_a + G·q + EW·φ with ventilation q_j = −h_v,j·x_a,j. Air control: each zone's unknown is its air
   * temperature (free) or its heating φ (held, air temperature known). Operative control: unknowns are every air
   * temperature and the held zones' φ, with (x_a + x_star)/2 = setpoint for those. Z (or Z + held) dense unknowns.
   */
  const solveReduced = () => {
    let m = 0
    for (let z = 0; z < Z; z++) if (held(z)) actIdx[m++] = z
    if (admittance) {
      let nf = 0
      for (let z = 0; z < Z; z++) {
        if (!held(z)) freeIdx[nf++] = z
        else xa[z] = mode[z] === 1 ? heatC[z] : coolC[z]
      }
      if (nf) {
        for (let p = 0; p < nf; p++) {
          const i = freeIdx[p]
          let r = wY[i] + known(i)  // all heating and cooling at the air node here: φ adds to the air's balance
          for (let a = 0; a < m; a++) { const j = actIdx[a]; r -= Y[i * Z + j] * xa[j] }
          bm[p] = r
          for (let q = 0; q <= p; q++) Kc[p * nf + q] = Y[i * Z + freeIdx[q]] + (q === p ? hv[i] : 0)
        }
        // Cholesky K_FF = L·Lᵀ in place (lower triangle), then the two triangular solves.
        for (let p = 0; p < nf; p++) {
          for (let q = 0; q <= p; q++) {
            let v = Kc[p * nf + q]
            for (let r = 0; r < q; r++) v -= Kc[p * nf + r] * Kc[q * nf + r]
            if (q === p) {
              if (!(v > 0)) throw new NetworkError('the zone air system is not positive definite', 'zones')
              Kc[p * nf + p] = Math.sqrt(v)
            } else Kc[p * nf + q] = v / Kc[q * nf + q]
          }
        }
        for (let p = 0; p < nf; p++) { let v = bm[p]; for (let r = 0; r < p; r++) v -= Kc[p * nf + r] * um[r]; um[p] = v / Kc[p * nf + p] }
        for (let p = nf - 1; p >= 0; p--) { let v = um[p]; for (let r = p + 1; r < nf; r++) v -= Kc[r * nf + p] * um[r]; um[p] = v / Kc[p * nf + p] }
        for (let p = 0; p < nf; p++) { const i = freeIdx[p]; xa[i] = um[p]; phi[i] = known(i) }
      }
      for (let a = 0; a < m; a++) {
        const i = actIdx[a]
        let v = hv[i] * xa[i] - wY[i]
        for (let j = 0; j < Z; j++) v += Y[i * Z + j] * xa[j]
        phi[i] = v
      }
      return
    }
    if (!operative) {
      for (let i = 0; i < Z; i++) {
        let r = z0[i]
        for (let j = 0; j < Z; j++) {
          const gij = G[i * Z + j]
          if (!held(j)) {
            Am[i * Z + j] = (i === j ? 1 : 0) + gij * hv[j]
            if (mode[j] === 2 || mode[j] === -2) r += Ecol(j)[i * Z + j] * known(j)  // a capped zone's known heating or cooling
          } else {
            Am[i * Z + j] = -Ecol(j)[i * Z + j]
            r -= ((i === j ? 1 : 0) + gij * hv[j]) * (mode[j] === 1 ? heatC[j] : coolC[j])
          }
        }
        bm[i] = r
      }
      luSolve(luFactorInto(Am, Z, luM), bm, um)
      for (let j = 0; j < Z; j++) {
        if (!held(j)) { xa[j] = um[j]; phi[j] = known(j) } else { xa[j] = mode[j] === 1 ? heatC[j] : coolC[j]; phi[j] = um[j] }
      }
      return
    }
    const N = Z + m
    for (let i = 0; i < Z; i++) {
      let r = z0[i]
      for (let j = 0; j < Z; j++) if (mode[j] === 2 || mode[j] === -2) r += Ecol(j)[i * Z + j] * known(j)
      bm[i] = r
    }
    for (let a = 0; a < m; a++) {
      const zi = actIdx[a]
      let r = (mode[zi] === 1 ? heatC[zi] : coolC[zi]) - 0.5 * z0[rad[zi]]
      for (let j = 0; j < Z; j++) if (mode[j] === 2 || mode[j] === -2) r -= 0.5 * Rcol(j)[zi * Z + j] * known(j)
      bm[Z + a] = r
    }
    {
      for (let i = 0; i < N * N; i++) Am[i] = 0
      for (let i = 0; i < Z; i++) {
        for (let j = 0; j < Z; j++) Am[i * N + j] = (i === j ? 1 : 0) + G[i * Z + j] * hv[j]
        for (let a = 0; a < m; a++) Am[i * N + Z + a] = -Ecol(actIdx[a])[i * Z + actIdx[a]]
      }
      for (let a = 0; a < m; a++) {
        const zi = actIdx[a], row = (Z + a) * N
        // 0.5·x_a,i + 0.5·(z0_r,i + Σ_j Gr_ij·(−h_v,j·x_a,j) + Σ_held RW_ij·φ_j + Σ_capped RW_ij·cap_j) = setpoint
        for (let j = 0; j < Z; j++) Am[row + j] = (zi === j ? 0.5 : 0) - 0.5 * Gr[zi * Z + j] * hv[j]
        for (let b = 0; b < m; b++) Am[row + Z + b] = 0.5 * Rcol(actIdx[b])[zi * Z + actIdx[b]]
      }
    }
    luSolve(luFactorInto(Am, N, luM), bm, um)
    for (let j = 0; j < Z; j++) { xa[j] = um[j]; phi[j] = known(j) }
    for (let a = 0; a < m; a++) phi[actIdx[a]] = um[Z + a]
  }
  /** The control temperature of zone i for the current xa, φ (operative needs the star node). */
  const control = (i: number) => {
    if (!operative) return xa[i]
    let r = z0[rad[i]]
    for (let j = 0; j < Z; j++) r += -Gr[i * Z + j] * hv[j] * xa[j] + Rcol(j)[i * Z + j] * phi[j]
    return 0.5 * (xa[i] + r)
  }

  /** The active set for this step, from the modes of the step before; returns the passes it took. */
  const settle = (h: number) => {
    let passes = 0
    for (;;) {
      passes++
      solveReduced()
      let changed = false
      for (let z = 0; z < Z; z++) {
        if (mode[z] === 1 && phi[z] < 0) { mode[z] = 0; changed = true }
        else if (mode[z] === 1 && phi[z] > capW[z]) { mode[z] = 2; changed = true }  // Brief 108: needs more than its emitters give
        else if (mode[z] === -1 && phi[z] > 0) { mode[z] = 0; changed = true }
        else if (mode[z] === -1 && -phi[z] > capC[z]) { mode[z] = -2; changed = true }  // Brief 119: needs more than its units give
        else if (mode[z] === -2) {
          // At its limit, the zone floats; once it would fall below its setpoint it needs less than the limit.
          if (control(z) < coolC[z] - 1e-9) { mode[z] = -1; changed = true }
        } else if (mode[z] === 2) {
          // At its limit, the zone floats; once it would rise above its setpoint it needs less than the limit.
          if (control(z) > heatC[z] + 1e-9) { mode[z] = 1; changed = true }
        } else if (mode[z] === 0) {
          const c = control(z)
          if (c < heatC[z] - 1e-9) { mode[z] = 1; changed = true }
          else if (c > coolC[z] + 1e-9) { mode[z] = -1; changed = true }
        }
      }
      if (!changed) break
      if (passes > 3 * Z + 3) throw new NetworkError(`the heating/cooling set did not settle in hour ${h}`, 'setpoints')
    }
    return passes
  }

  /**
   * Brief 120: each plant's limit for this step. Asks are the zones' heating (or cooling) with only their emitters'
   * limits; a short plant scales each zone's ask by its fraction f (shares weighted), the step is solved again, and f
   * is lowered while the plant still gives more than it has (the zones' heat moves between them as they float).
   */
  const PL = (inp.plants ?? []).length
  const plants = inp.plants ?? []
  const plOut: NetworkPlantRun[] = plants.map((p) => ({ ask_w: new Float64Array(H), delivered_w: new Float64Array(H), short: new Float64Array(H), flow_c: p.flow ? new Float64Array(H).fill(p.flow.design_c) : null, zone_w: p.zones.map(() => new Float64Array(H)) }))
  const target = new Float64Array(PL), flowNow = new Float64Array(PL)
  // The room temperature an emitter is rated at this step: the one it follows (heating_cap_at), else the setpoint.
  const roomOf = (z: number) => (capAt[z] ? ctlPrev[z] : heatC[z])
  /** Brief 120 P2b: the flow temperature at which plant p's emitters give `t` W (each zone at most its share of ask). */
  const flowFor = (p: number, t: number) => {
    const fl = plants[p].flow!
    const give = (f: number) => { let q = 0; plants[p].zones.forEach(({ zone, share }, k) => { q += Math.min(share * Math.max(0, ask[zone]), fl.out[k](roomOf(zone), f)) }); return q }
    let lo = Infinity
    for (const { zone } of plants[p].zones) lo = Math.min(lo, roomOf(zone))
    let hi = fl.design_c
    if (!(lo < hi)) return hi
    // Regula falsi (Illinois) on give(f) − t, which rises with f: below at lo (no emitter gives anything), at or above at the design flow.
    let ga = give(lo) - t, gb = give(hi) - t, side = 0
    if (gb <= 0) return hi
    for (let i = 0; i < 80 && hi - lo > 1e-7; i++) {
      const c = (lo * gb - hi * ga) / (gb - ga), gc = give(c) - t
      if (Math.abs(gc) <= 1e-9 * t + 1e-9) return c
      if (gc < 0) { lo = c; ga = gc; if (side === -1) gb /= 2; side = -1 } else { hi = c; gb = gc; if (side === 1) ga /= 2; side = 1 }
    }
    return lo
  }
  const zLimited = plants.length ? inp.zones.map(() => new Float64Array(H)) : []
  const zOwn = plants.length ? inp.zones.map(() => new Float64Array(H)) : []
  const ask = new Float64Array(Z), baseW = new Float64Array(Z), baseC = new Float64Array(Z), frac = new Float64Array(PL), avail = new Float64Array(PL)
  const sign = plants.map((p) => (p.service === 'heating' ? 1 : -1))
  const drawOf = (p: number, from: ArrayLike<number>) => { let d = 0; for (const { zone, share } of plants[p].zones) d += share * Math.max(0, sign[p] * from[zone]); return d }
  // Review F1 (Linzie, 16 Nov 19:48, "the boiler tops up"): what each plant gives each zone it serves this step, and
  // the zone's heating (cooling) on systems with no capacity (`free_share`), which cover any shortfall in full.
  const gv = plants.map((p) => new Float64Array(p.zones.length))
  const short = new Uint8Array(PL)
  const tot = new Float64Array(Z), heatTot = new Float64Array(Z), coolTot = new Float64Array(Z), def = new Float64Array(Z), freeAsk = new Float64Array(Z), spare = new Float64Array(PL)
  const freeOf = (svc: number, z: number) => (inp.plant_free_share ? (svc === 1 ? inp.plant_free_share.heating[z] : inp.plant_free_share.cooling[z]) : 0)
  /**
   * This step's gives, from the asks: each plant its share of each zone's ask, a short one less (a fraction of each
   * ask, or its emitters' output at its lowered flow, P2b). What a short plant leaves is a zone's deficit; systems with
   * no capacity serving the zone cover it in full; otherwise plants serving it with spare capacity cover it, shared in
   * proportion to their shares, up to their spare (no order: nothing comes first). A zone is limited only by what is
   * left. `tot` is each zone's total from all its systems.
   */
  const allot = (svc: number) => {
    tot.fill(0); def.fill(0)
    for (let z = 0; z < Z; z++) { freeAsk[z] = freeOf(svc, z) * Math.max(0, svc * ask[z]); tot[z] = freeAsk[z] }
    for (let p = 0; p < PL; p++) {
      if (sign[p] !== svc) continue
      const fl = short[p] && svc === 1 ? plants[p].flow : null
      if (fl) flowNow[p] = flowFor(p, target[p])
      let used = 0
      plants[p].zones.forEach(({ zone, share }, k) => {
        const nom = share * Math.max(0, svc * ask[zone])
        const g = !short[p] ? nom : fl ? Math.min(nom, fl.out[k](roomOf(zone), flowNow[p])) : frac[p] * nom
        gv[p][k] = g; tot[zone] += g; def[zone] += nom - g; used += g
      })
      spare[p] = short[p] ? 0 : Math.max(0, avail[p] - used)
    }
    for (let z = 0; z < Z; z++) if (def[z] > 0 && freeOf(svc, z) > 0) { tot[z] += def[z]; def[z] = 0 }
    for (let round = 0; round < 3; round++) {
      let left = false
      for (let z = 0; z < Z; z++) {
        if (!(def[z] > 1e-9)) continue
        let ws = 0
        for (let p = 0; p < PL; p++) if (sign[p] === svc && spare[p] > 1e-9) for (const e of plants[p].zones) if (e.zone === z) ws += e.share
        if (!(ws > 0)) continue
        const want = def[z]
        for (let p = 0; p < PL; p++) {
          if (sign[p] !== svc || !(spare[p] > 1e-9)) continue
          plants[p].zones.forEach(({ zone, share }, k) => {
            if (zone !== z || !(share > 0)) return
            const t = Math.min((want * share) / ws, spare[p])
            gv[p][k] += t; spare[p] -= t; tot[z] += t; def[z] -= t
          })
        }
        if (def[z] > 1e-9) left = true
      }
      if (!left) break
    }
  }
  /** What plant p gave over the step, its gives scaled to the zones' settled heating (each zone's systems in proportion). */
  const given = (p: number) => {
    let d = 0
    plants[p].zones.forEach(({ zone }, k) => { const t = tot[zone]; if (t > 0) d += (gv[p][k] * Math.max(0, sign[p] * phi[zone])) / t })
    return d
  }
  const plantLimit = (h: number, w: number, record: boolean) => {
    for (let z = 0; z < Z; z++) { ask[z] = phi[z]; if (record && (mode[z] === 2 || mode[z] === -2)) zOwn[z][h] += w }
    let any = false
    for (let p = 0; p < PL; p++) {
      avail[p] = Math.max(0, plants[p].cap_w - (plants[p].reserved_w ? plants[p].reserved_w![h] : 0))
      const a = drawOf(p, ask)
      frac[p] = a > avail[p] * (1 + 1e-9) + 1e-9 ? avail[p] / a : 1
      short[p] = frac[p] < 1 ? 1 : 0
      if (short[p]) any = true
      target[p] = avail[p]
      flowNow[p] = plants[p].flow ? plants[p].flow!.design_c : NaN
      if (record) plOut[p].ask_w[h] += w * a
    }
    let passes = 0
    if (any) {
      baseW.set(capW); baseC.set(capC)
      for (let it = 0; ; it++) {
        for (let z = 0; z < Z; z++) { capW[z] = baseW[z]; capC[z] = baseC[z] }
        const totS = [new Float64Array(Z), new Float64Array(Z)]
        for (const svc of [1, -1]) {
          allot(svc)
          // A zone is limited only where a deficit is left after the systems with spare have covered what they can.
          for (let z = 0; z < Z; z++) {
            if (def[z] > 1e-9) { if (svc === 1) capW[z] = Math.min(baseW[z], tot[z]); else capC[z] = Math.min(baseC[z], tot[z]) }
          }
          totS[svc === 1 ? 0 : 1].set(tot)
        }
        passes += settle(h)
        let over = false
        for (const svc of [1, -1]) {
          tot.set(totS[svc === 1 ? 0 : 1])
          for (let p = 0; p < PL; p++) {
            if (sign[p] !== svc) continue
            const d = given(p)
            if (d > avail[p] * (1 + 1e-9) + 1e-6) {
              over = true
              if (!short[p]) {
                // Newly short (its zones asked more after the others settled): a fraction of its share of the asks.
                short[p] = 1
                const a = drawOf(p, phi)
                frac[p] = a > 0 ? Math.min(1, avail[p] / a) : 1; target[p] = avail[p]
              } else { frac[p] *= avail[p] / d; target[p] *= avail[p] / d }
            }
          }
        }
        if (!over) { for (const svc of [1, -1]) { tot.set(totS[svc === 1 ? 0 : 1]); if (svc === 1) heatTot.set(tot); else coolTot.set(tot) } break }
        if (it > 50) throw new NetworkError(`plant limits did not settle in hour ${h}`, 'plants')
      }
      // A zone held by the plant (not its own emitters) starts the next step from its setpoint, as it would have.
      for (let z = 0; z < Z; z++) {
        const heldH = mode[z] === 2 && capW[z] < baseW[z] - 1e-9, heldC = mode[z] === -2 && capC[z] < baseC[z] - 1e-9
        if (record && (heldH || heldC)) zLimited[z][h] += w
        if (heldH) mode[z] = 1
        if (heldC) mode[z] = -1
      }
      capW.set(baseW); capC.set(baseC)
    } else {
      // Not short: re-run the shares on the settled asks so `tot` matches.
      allot(1); heatTot.set(tot); allot(-1); coolTot.set(tot)
    }
    if (record) for (let p = 0; p < PL; p++) {
      tot.set(sign[p] === 1 ? heatTot : coolTot)
      plants[p].zones.forEach(({ zone }, k) => {
        const t = tot[zone]
        const g = t > 0 ? gv[p][k] * (Math.max(0, sign[p] * phi[zone]) / t) : 0
        plOut[p].zone_w[k][h] += w * g
        plOut[p].delivered_w[h] += w * g
      })
      if (short[p]) plOut[p].short[h] += w
      if (plOut[p].flow_c && short[p]) plOut[p].flow_c![h] = Math.min(plOut[p].flow_c![h], flowNow[p])
    }
    return passes
  }

  /** One step of hour h at outdoor temperature te; recorded outputs add w (1 / steps per hour) of their value. */
  const sub = (h: number, te: number, record: boolean, w: number) => {
    if (tarp) tarpCoefficients()
    if (anyCapAt) for (let z = 0; z < Z; z++) { const f = capAt[z]; if (f) { capW[z] = f(ctlPrev[z]); if (record) capRec[z]![h] += w * capW[z] } }
    if (anySpH) for (let z = 0; z < Z; z++) {
      const sp = spH[z]
      if (!sp) continue
      heatC[z] = sp.heat_c[h]; coolC[z] = sp.cool_c[h]
      // A service switched off this hour lets go of the zone; the active set then starts it free.
      if ((mode[z] === 1 || mode[z] === 2) && Number.isNaN(heatC[z])) mode[z] = 0
      if ((mode[z] === -1 || mode[z] === -2) && Number.isNaN(coolC[z])) mode[z] = 0
    }
    for (let i = 0; i < n; i++) bF[i] = capDT[i] * xF[i]
    const zi0 = h * Z * 3
    for (let z = 0; z < Z; z++) {
      hv[z] = zIn[zi0 + 3 * z]
      const sol = zIn[zi0 + 3 * z + 1]
      const beam = zIn[zi0 + 3 * z + 2]
      const ogw = ogIn[z] ? ogIn[z]![h] : 0, ogc = ogCh[z] ? ogCh[z]![h] : ogC[z]
      // Ventilation's h_v·θ_e is a source; its h_v·θ_a is in the reduced system.
      bF[z] += brid[z] * te + fsc * sol + ogc * ogw + hv[z] * te
      radBeam[z] = (1 - fsc) * beam
      solDiffuse[z] = (1 - fsc) * (sol - beam) + radBeam[z] * beamRefl[z]
      ogRad[z] = (1 - ogc) * ogw
    }
    for (let q = 0; q < nFaces; q++) {
      const node = fNode[q], z = fZone[q]
      bF[node] += solDiffuse[z] * difFace[node] + (ogRad[z] * fArea[q]) / Atot[z] + radBeam[z] * floorShare[node] * fAlpha[q]
    }
    for (let k = 0; k < E; k++) {
      const o = cO[k], o1 = cO[k + 1]
      if (o1 === o) continue
      // solveChain with the right-hand side (stored heat, then the outside sources) formed as it goes.
      let s0 = 0, sA = 0, jA = -1
      if (!two[k]) { s0 = gBnd[k] * (ground[k] ? inp.theta_ground : te) + sky[k]; sA = absP[h * E + k] + solDiffuse[elZoneA[k]] * difPane[k]; jA = o + absAt[k] }
      let bj = CD[o] * CX[o]
      if (jA >= 0) { bj += s0; if (jA === o) bj += sA }
      CY[o] = bj / CPIV[o]
      for (let j = o + 1; j < o1; j++) {
        bj = CD[j] * CX[j]
        if (j === jA) bj += sA
        CY[j] = (bj - COFF[j] * CY[j - 1]) / CPIV[j]
      }
      for (let j = o1 - 2; j >= o; j--) CY[j] -= CCP[j] * CY[j + 1]
      bF[faceA[k]] += gAc[k] * CY[o1 - 1]
      if (two[k]) bF[faceB[k]] += gBc[k] * CY[o]
    }
    sparseLuSolve(lu, bF, z0)
    if (admittance) for (let z = 0; z < Z; z++) { let w = 0; for (let j = 0; j < Z; j++) w += Y[z * Z + j] * z0[j]; wY[z] = w }

    // Ideal loads: hold every zone that would leave its band on it, all together. The set starts from the hour
    // before and is iterated until consistent (a held zone's demand has the right sign; a free zone is in its band).
    let passes = settle(h)
    if (PL) passes += plantLimit(h, w, record)
    if (record) { maxPasses = Math.max(maxPasses, passes); if (passes > 1) hoursOverOne++ }

    // The full state: x = S0⁻¹·(b + Σ e_j·q_j + Σ eh_j·φ_j).
    rhs.set(bF)
    for (let z = 0; z < Z; z++) {
      rhs[z] -= hv[z] * xa[z]
      if (phi[z] !== 0) { const nd = ehNodes[z], w = phi[z] > 0 ? ehW[z] : ecW[z]; for (let q = 0; q < nd.length; q++) rhs[nd[q]] += w[q] * phi[z] }
    }
    sparseLuSolve(lu, rhs, rhs)
    if (record) stored.fill(0)
    for (let i = 0; i < n; i++) {
      const xi = rhs[i]
      if (record) stored[zoneOfNode[i]] += capDT[i] * (xi - xF[i])
      xF[i] = xi
    }
    // A floor heated from inside it: the chain's own solution takes that heat on top (Brief 109).
    for (let z = 0; z < Z; z++) {
      const u = srcU[z]
      if (!u || !(phi[z] > 0)) continue
      const o = cO[srcK[z]], q = srcShare[z] * phi[z]
      for (let j = 0; j < u.length; j++) CY[o + j] += q * u[j]
    }
    for (let k = 0; k < E; k++) {
      const xfa = xF[faceA[k]], xfb = two[k] ? xF[faceB[k]] : 0
      const o1 = cO[k + 1]
      if (record) {
        for (let j = cO[k]; j < o1; j++) {
          const xj = CY[j] - CWA[j] * xfa - CWB[j] * xfb
          stored[CZ[j]] += CD[j] * (xj - CX[j])
          CX[j] = xj
        }
      } else for (let j = cO[k]; j < o1; j++) CX[j] = CY[j] - CWA[j] * xfa - CWB[j] * xfb
    }
    if (anyCapAt) for (let z = 0; z < Z; z++) if (capAt[z]) ctlPrev[z] = operative ? 0.5 * (xF[z] + xF[rad[z]]) : xF[z]
    if (!record) return

    // ── Terms and closure, per zone ────────────────────────────────────────────────────────────────────────────
    const ob = h * Z * NO
    for (let z = 0; z < Z; z++) {
      const o = ob + z * NO, ta = xF[z]
      const tb = brid[z] * (te - ta), tv = hv[z] * (te - ta), ts = zIn[zi0 + 3 * z + 1], tl = -solDiffuse[z] * difLost[z], tg = ogIn[z] ? ogIn[z]![h] : 0
      sum[z] = tb + tv + ts + tl + tg + phi[z]
      zOut[o + 5] += w * tb; zOut[o + 6] += w * tv; zOut[o + 7] += w * ts; zOut[o + 8] += w * tl; zOut[o + 9] += w * tg
      if (phi[z] > 0) zOut[o + 3] += w * phi[z]; else if (phi[z] < 0) zOut[o + 4] -= w * phi[z]
      izs[z] = 0
    }
    for (let k = 0; k < E; k++) {
      const e = els[k], za = elZoneA[k]
      if (!two[k]) {
        const node0 = cO[k + 1] > cO[k] ? CX[cO[k]] : xF[faceA[k]]
        const tb = ground[k] ? inp.theta_ground : te
        const qb = gBnd[k] * (tb - node0), qs = absP[h * E + k]
        sum[za] += qb; elB[k] += w * qb
        sum[za] += qs; elS[k] += w * qs
        sum[za] += sky[k]; elK[k] += w * sky[k]
        continue
      }
      // Heat across the middle link, from the zone_b side (chain node ℓ) into the zone_a side (node ℓ+1).
      const l = mid[k], L = e.c.length
      const tl = l === 0 ? xF[faceB[k]] : CX[cO[k] + l - 1]
      const tr = l + 1 === L - 1 ? xF[faceA[k]] : CX[cO[k] + l]
      const q = e.g[l] * e.area_m2 * (tl - tr)
      elI[k] += w * q
      const zb = elZoneB[k]
      if (zb !== za) { izs[za] += q; izs[zb] -= q }
    }
    for (let z = 0; z < Z; z++) {
      const o = ob + z * NO
      sum[z] += izs[z]
      zOut[o + 10] += w * izs[z]
      zOut[o + 11] += w * stored[z]
      zOut[o + 12] += w * Math.abs(sum[z] - stored[z])  // each step's own residual, so steps cannot cancel (review F8)
      const mrt = xF[rad[z]]  // the star node is the area-weighted mean of the zone's faces
      zOut[o] += w * xF[z]; zOut[o + 1] += w * mrt; zOut[o + 2] += w * 0.5 * (xF[z] + mrt)
    }
  }
  const linear = inp.theta_e_between === 'linear'
  const step = (h: number, record: boolean) => {
    const cur = inp.theta_e[h]
    if (N === 1) sub(h, cur, record, 1)
    else {
      // The reading before hour 0 is the warm-up day's last hour (the warm-up repeats the first day).
      const prev = linear ? inp.theta_e[h > 0 ? h - 1 : Math.min(23, H - 1)] : cur
      for (let s = 1; s <= N; s++) sub(h, prev + ((cur - prev) * s) / N, record, 1 / N)
    }
  }

  for (let d = 0; d < inp.warmup_days; d++) for (let h = 0; h < 24; h++) step(h, false)
  for (let h = 0; h < H; h++) step(h, true)
  const nodes = n - Z + chains.reduce((s, t) => s + t.m, 0)  // the star nodes are not physical nodes
  // Unpack hour-major to one array per zone and quantity, in blocks of hours so the reads stay in cache.
  const cols = Array.from({ length: Z * NO }, () => new Float64Array(H))
  for (let h0 = 0; h0 < H; h0 += 64) {
    const h1 = Math.min(H, h0 + 64)
    for (let c = 0; c < Z * NO; c++) { const a = cols[c]; for (let h = h0; h < h1; h++) a[h] = zOut[h * Z * NO + c] }
  }
  const col = (z: number, f: number) => cols[z * NO + f]
  const zr: NetworkZoneRun[] = inp.zones.map((_, z) => ({
    theta_air: col(z, 0), theta_mrt: col(z, 1), theta_op: col(z, 2), heating_w: col(z, 3), cooling_w: col(z, 4),
    ...(capRec[z] ? { heating_cap_w: capRec[z]! } : {}),
    terms: {
      bridging_w: col(z, 5), ventilation_w: col(z, 6), solar_transmitted_w: col(z, 7), solar_lost_w: col(z, 8),
      other_gains_w: col(z, 9), interzone_w: col(z, 10), storage_w: col(z, 11),
    },
    closure_wh: col(z, 12),
    ...(PL ? { plant_limited: zLimited[z], own_limited: zOwn[z] } : {}),
  }))
  return {
    hours: H, zones: zr, nodes, active_set: { max_passes: maxPasses, hours_over_one: hoursOverOne },
    element_terms: els.map((_, k) => ({ boundary_wh: elB[k], solar_absorbed_wh: elS[k], sky_wh: elK[k] })),
    element_interzone_wh: els.map((_, k) => (two[k] ? elI[k] : null)),
    plants: plOut,
  }
}
