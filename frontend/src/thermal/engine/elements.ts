/**
 * Building elements as thermal nodes (Brief 103 Part 3).
 *
 * ISO 52016-1:2017 6.5.7 gives each opaque element its own chain of nodes (outside surface, interior, inside surface)
 * and each window two surface nodes. Engine 1 keeps that structure but places the interior nodes from the
 * construction's own layers (a finite-volume split, each massive layer cut into sub-layers of at most
 * `max_sublayer_m`), rather than ISO 52016-1's five nodes from a mass-distribution class. This is a stated departure:
 * the library carries real layers, and the layer split is closer to the EnergyPlus referee's conduction.
 *
 * A construction's stated U (per-project override, else the library's published U) wins over its layers, exactly
 * as today's engine (instantCalc.js pickWholeWallU, getUValue): the layer with the largest resistance is resized so
 * the ISO 6946 U of the stack equals the stated U, and the masses stay as layered.
 */
import { ENGINE_CONSTANTS as K, heatFlowDirection } from './constants'

export interface Layer {
  name?: string
  kind?: string
  thickness?: number
  conductivity?: number
  density?: number
  specific_heat?: number
  thermal_resistance?: number
}

/** A construction as the library body carries it (`config_json`). */
export interface ConstructionBody {
  name?: string
  u_value_W_per_m2K?: number | null
  g_value?: number | null
  y_factor?: number | null
  layers?: Layer[]
}

export class ElementError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${path}: ${message}`)
    this.name = 'ElementError'
  }
}

/** One resistance between two nodes, with the mass it stands for (J/K·m², split half to each side). */
interface Segment { r: number; c: number; layer: number }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Layers → segments, outside first. A layer with mass needs all four properties; a no-mass layer needs R. */
export function layerSegments(layers: Layer[], path: string): Segment[] {
  const out: Segment[] = []
  layers.forEach((l, i) => {
    const p = `${path}.layers[${i}]`
    if (l.kind === 'Material:NoMass') {
      const r = num(l.thermal_resistance)
      if (r == null || r < 0) throw new ElementError('a no-mass layer needs thermal_resistance ≥ 0', p)
      out.push({ r, c: 0, layer: i })
      return
    }
    const d = num(l.thickness), k = num(l.conductivity), rho = num(l.density), cp = num(l.specific_heat)
    if (d == null || k == null || rho == null || cp == null || !(d > 0) || !(k > 0) || rho < 0 || cp < 0) {
      throw new ElementError('a layer with mass needs thickness, conductivity, density and specific_heat', p)
    }
    const m = Math.max(1, Math.ceil(d / K.max_sublayer_m - 1e-9))
    for (let j = 0; j < m; j++) out.push({ r: d / k / m, c: (rho * cp * d) / m, layer: i })
  })
  return out
}

/** ISO 6946 surface resistances for a surface of this tilt and outside boundary. */
export function iso6946Films(tiltDeg: number, boundary: 'outside' | 'ground') {
  const dir = heatFlowDirection(tiltDeg)
  const R_si = dir === 'upward' ? K.R_si_upward : dir === 'downward' ? K.R_si_downward : K.R_si_horizontal
  return { R_si, R_se: boundary === 'ground' ? 0 : K.R_se }
}

/** ISO 6946 U of a layer stack: 1 / (R_se + Σ R_layers + R_si). The hand value analytic case (b) checks. */
export function iso6946U(layers: Layer[], tiltDeg: number, boundary: 'outside' | 'ground', path = 'layers'): number {
  const { R_si, R_se } = iso6946Films(tiltDeg, boundary)
  return 1 / (R_se + layerSegments(layers, path).reduce((s, g) => s + g.r, 0) + R_si)
}

export type ElementKind = 'opaque' | 'window'

/**
 * One element's node chain, per m² of element. Node 0 faces the boundary, the last node is the inside surface.
 * `g_boundary` couples node 0 to the boundary temperature (outside air or ground), W/m²K. `g[i]` couples node i to
 * node i+1. `c[i]` is node i's capacity, J/K·m².
 */
export interface Element {
  id: string
  kind: ElementKind
  area_m2: number
  tilt_deg: number
  boundary: 'outside' | 'ground'
  /** The stated U the element carries (ISO 6946 films), W/m²K: the conductance reported as H = U·A. */
  u_w_per_m2k: number
  c: Float64Array
  g: Float64Array
  g_boundary: number
  /** Outside long-wave coefficient, W/m²K (0 for the ground). Part of g_boundary; carries the sky term. */
  h_re: number
  /** Sky view factor of the outside face, (1 + cos β)/2 (0 for the ground). */
  f_sky: number
  h_ci: number
  /**
   * The node the element's absorbed solar enters (default 0, the outside surface). An 'optical' window absorbs in the
   * pane, its middle node (Brief 104 Part 1b).
   */
  absorbed_node?: number
  /**
   * An 'optical' window's response to solar arriving from inside the zone: the share transmitted back out (lost)
   * and the share absorbed in the pane. The rest is reflected back into the zone. Absent: an inside surface absorbs
   * all the solar that reaches it (ISO 52016-1's simplification).
   */
  interior_solar?: { transmitted: number; absorbed: number }
}

/** Builds an opaque element from its layers, resized to the stated U when there is one. */
export function opaqueElement(args: {
  id: string; area_m2: number; tilt_deg: number; boundary: 'outside' | 'ground'
  layers: Layer[]; stated_u: number | null; emissivity: number | null; path: string
}): Element {
  const { id, area_m2, tilt_deg, boundary, path } = args
  if (!(area_m2 > 0)) throw new ElementError('area must be > 0', `${path}.area_m2`)
  const segs = layerSegments(args.layers, path)
  if (segs.length === 0) throw new ElementError('an opaque element needs at least one layer', `${path}.layers`)
  const { R_si, R_se } = iso6946Films(tilt_deg, boundary)
  let u = 1 / (R_se + segs.reduce((s, g) => s + g.r, 0) + R_si)
  if (args.stated_u != null) {
    if (!(args.stated_u > 0)) throw new ElementError('stated U must be > 0', `${path}.u`)
    // Resize the most resistive layer so the stack's ISO 6946 U equals the stated U.
    const byLayer = new Map<number, number>()
    for (const s of segs) byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + s.r)
    let li = -1, lr = -1
    for (const [l, r] of byLayer) if (r > lr) { lr = r; li = l }
    const others = R_se + R_si + segs.reduce((s, g) => s + g.r, 0) - lr
    const want = 1 / args.stated_u - others
    if (!(want > 0)) throw new ElementError(`stated U ${args.stated_u} is above what the other layers and films allow (${(1 / others).toFixed(3)})`, `${path}.u`)
    const f = want / lr
    for (const s of segs) if (s.layer === li) s.r *= f
    u = args.stated_u
  }
  const h_re = boundary === 'ground' ? 0 : K.h_re_per_emissivity * need(args.emissivity, `${path}.thermal_emissivity`)
  const f_sky = boundary === 'ground' ? 0 : (1 + Math.cos((tilt_deg * Math.PI) / 180)) / 2
  // Nodes: outside an outside face there is a surface node with film h_ce + h_re; against the ground the first
  // segment couples straight to the ground temperature (no film, ISO 6946 R_se = 0).
  const rs = segs.map((s) => s.r), cs = segs.map((s) => s.c)
  let gB: number, rChain: number[], cNode: number[]
  if (boundary === 'outside') {
    gB = K.h_ce + h_re
    rChain = rs
    cNode = Array.from({ length: segs.length + 1 }, (_, i) => ((cs[i - 1] ?? 0) + (cs[i] ?? 0)) / 2)
  } else {
    if (!(rs[0] > 0)) throw new ElementError('the layer against the ground needs a resistance > 0', `${path}.layers[0]`)
    gB = 1 / rs[0]
    rChain = rs.slice(1)
    // The first segment's mass: half sits on the fixed ground boundary, half on node 0.
    cNode = Array.from({ length: segs.length }, (_, i) => ((cs[i] ?? 0) + (cs[i + 1] ?? 0)) / 2)
  }
  for (const [i, r] of rChain.entries()) if (!(r > 0)) throw new ElementError('every layer needs a resistance > 0', `${path}.layers[${segs[boundary === 'outside' ? i : i + 1].layer}]`)
  const dir = heatFlowDirection(tilt_deg)
  return {
    id, kind: 'opaque', area_m2, tilt_deg, boundary, u_w_per_m2k: u,
    c: Float64Array.from(cNode), g: Float64Array.from(rChain.map((r) => 1 / r)), g_boundary: gB, h_re, f_sky,
    h_ci: dir === 'upward' ? K.h_ci_upward : dir === 'downward' ? K.h_ci_downward : K.h_ci_horizontal,
  }
}

/**
 * A window: two massless surface nodes (ISO 52016-1 6.5.7.3), the pane resistance from the stated U. With `optics`
 * (Brief 104 Part 1b) the pane gets a massless middle node, half the resistance each side, where its absorbed solar
 * enters, so the network itself splits that heat between outside and inside (the Simple Window Model's N); and the
 * window passes solar from inside back out at its diffuse transmittance.
 */
export function windowElement(args: {
  id: string; area_m2: number; tilt_deg: number; u: number; emissivity: number | null; path: string
  optics?: { interior_transmitted: number; interior_absorbed: number } | null
}): Element {
  const { id, area_m2, tilt_deg, u, path } = args
  if (!(area_m2 > 0)) throw new ElementError('area must be > 0', `${path}.area_m2`)
  if (!(u > 0)) throw new ElementError('window U must be > 0', `${path}.u`)
  const { R_si, R_se } = iso6946Films(tilt_deg, 'outside')
  const r = 1 / u - R_se - R_si
  if (!(r > 0)) throw new ElementError(`window U ${u} is above the films alone (${(1 / (R_se + R_si)).toFixed(2)})`, `${path}.u`)
  const h_re = K.h_re_per_emissivity * need(args.emissivity, `${path}.thermal_emissivity`)
  const dir = heatFlowDirection(tilt_deg)
  return {
    id, kind: 'window', area_m2, tilt_deg, boundary: 'outside', u_w_per_m2k: u,
    c: new Float64Array(args.optics ? 3 : 2), g: args.optics ? Float64Array.of(2 / r, 2 / r) : Float64Array.of(1 / r),
    g_boundary: K.h_ce + h_re, h_re,
    f_sky: (1 + Math.cos((tilt_deg * Math.PI) / 180)) / 2,
    h_ci: dir === 'upward' ? K.h_ci_upward : dir === 'downward' ? K.h_ci_downward : K.h_ci_horizontal,
    ...(args.optics ? {
      absorbed_node: 1,
      interior_solar: { transmitted: args.optics.interior_transmitted, absorbed: args.optics.interior_absorbed },
    } : {}),
  }
}

function need(v: number | null, path: string): number {
  if (v == null || !Number.isFinite(v)) throw new ElementError('required', path)
  return v
}
