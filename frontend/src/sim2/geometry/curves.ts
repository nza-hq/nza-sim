/**
 * Curved walls, drawn only (18 Nov 2026, Linzie: "can we add curves even if it's just to visually make it look right in
 * 3D? Even if the model can't do it"). A curve is a run of a block's sides (its facets) that the 3D view draws as one
 * smooth wall through the facets' corners. The model keeps the facets: every area, U-value, window and bridge is the
 * facets', so nothing here reaches the document.
 *
 * The smooth line is the circle that best fits the facets' corners (a bay is an arc), sampled between the first and the
 * last corner; when the corners are not near one circle, a Catmull-Rom spline through them.
 */
import type { PlacedWindow, WallRun, XY } from './plan'

/** Sides `from` to `to` (inclusive, in the ring's order, no wrap) of block `block`, drawn as one curve. */
export type WallCurve = { block: number; from: number; to: number }

const STEPS_PER_SIDE = 6

/** The facets' corners: ring[from] … ring[to + 1]. */
const corners = (ring: readonly XY[], c: WallCurve): XY[] => Array.from({ length: c.to - c.from + 2 }, (_, k) => ring[(c.from + k) % ring.length]!)

/** A curve that still fits its block: sides in range, at least two of them, turning one way. */
export function curveFits(ring: readonly XY[], c: WallCurve): boolean {
  if (!(c.from >= 0 && c.to > c.from && c.to < ring.length)) return false
  const p = corners(ring, c)
  let sign = 0
  for (let k = 1; k + 1 < p.length; k++) {
    const t = cross(p[k - 1]!, p[k]!, p[k + 1]!)
    if (Math.abs(t) < 1e-9) continue
    if (sign && Math.sign(t) !== sign) return false
    sign = Math.sign(t)
  }
  return sign !== 0
}
const cross = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])

/** The smooth line through a curve's corners, first corner to last. */
export function curvePoints(ring: readonly XY[], c: WallCurve): XY[] {
  const p = corners(ring, c)
  const n = (p.length - 1) * STEPS_PER_SIDE
  const circ = fitCircle(p)
  if (circ) {
    const ang = (q: XY) => Math.atan2(q[1] - circ.c[1], q[0] - circ.c[0])
    // Sweep from the first corner to the last the way the corners go (their turning sense).
    let a0 = ang(p[0]!), a1 = ang(p[p.length - 1]!)
    const ccw = cross(p[0]!, p[1]!, p[2] ?? p[1]!) > 0
    if (ccw) while (a1 <= a0) a1 += 2 * Math.PI
    else while (a1 >= a0) a1 -= 2 * Math.PI
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n
      return [circ.c[0] + circ.r * Math.cos(a), circ.c[1] + circ.r * Math.sin(a)] as XY
    })
  }
  return catmullRom(p, STEPS_PER_SIDE)
}

/** Least-squares circle (Kåsa) through the points, when they lie near one (within 8 % of its radius). */
function fitCircle(p: readonly XY[]): { c: XY; r: number } | null {
  if (p.length < 3) return null
  const n = p.length
  const mx = p.reduce((t, q) => t + q[0], 0) / n, my = p.reduce((t, q) => t + q[1], 0) / n
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0
  for (const [x, y] of p) {
    const u = x - mx, v = y - my
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-12) return null
  const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2
  const uc = (b1 * svv - b2 * suv) / det, vc = (suu * b2 - suv * b1) / det
  const c: XY = [uc + mx, vc + my]
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n)
  if (!Number.isFinite(r) || r <= 0) return null
  const worst = Math.max(...p.map((q) => Math.abs(Math.hypot(q[0] - c[0], q[1] - c[1]) - r)))
  return worst <= 0.08 * r ? { c, r } : null
}

function catmullRom(p: readonly XY[], steps: number): XY[] {
  const out: XY[] = []
  const at = (i: number) => p[Math.max(0, Math.min(p.length - 1, i))]!
  for (let i = 0; i + 1 < p.length; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  out.push(p[p.length - 1]!)
  return out
}

/** A block's outline with its curves drawn smooth (for slabs, floors and flat roofs in 3D). */
export function displayRing(ring: readonly XY[], curves: readonly WallCurve[]): XY[] {
  const mine = curves.filter((c) => curveFits(ring, c)).sort((a, b) => b.from - a.from)
  let out = [...ring] as XY[]
  for (const c of mine) out = [...out.slice(0, c.from), ...curvePoints(ring, c).slice(0, -1), ...out.slice(c.to + 1)]
  return out
}

const same = (a: XY, b: XY) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6

/** A room's outline with the part of it along a curve drawn smooth too (the room's corners along the facets match the
 * block's, forwards as the block goes). */
export function displayRoomRing(room: readonly XY[], blocks: readonly (readonly XY[])[], curves: readonly WallCurve[]): XY[] {
  let out = [...room] as XY[]
  for (const c of curves) {
    const ring = blocks[c.block]
    if (!ring || !curveFits(ring, c)) continue
    const p = corners(ring, c)
    const n = out.length
    for (let s = 0; s < n; s++) {
      if (!same(out[s]!, p[0]!)) continue
      let ok = true
      for (let k = 1; k < p.length; k++) if (!same(out[(s + k) % n]!, p[k]!)) { ok = false; break }
      if (!ok) continue
      const pts = curvePoints(ring, c)
      const rest = Array.from({ length: n - p.length + 1 }, (_, k) => out[(s + p.length - 1 + k) % n]!)
      out = [...pts.slice(0, -1), ...rest]
      break
    }
  }
  return out
}

/** The runs a floor's curves replace (by run index), and each curve's segments with the windows on them, moved from
 * the facets onto the curve in proportion to the distance along. */
export function curvedWalls(blocks: readonly (readonly XY[])[], runs: readonly WallRun[], placed: readonly PlacedWindow[], curves: readonly WallCurve[]) {
  const replaced = new Set<number>()
  const segments: Array<{ run: WallRun; windows: PlacedWindow[] }> = []
  for (const c of curves) {
    const ring = blocks[c.block]
    if (!ring || !curveFits(ring, c)) continue
    const chain = runs.filter((r) => r.block === c.block && r.side >= c.from && r.side <= c.to).sort((a, b) => a.side - b.side)
    if (chain.length !== c.to - c.from + 1) continue
    chain.forEach((r) => replaced.add(r.index))
    const start = new Map<number, number>()
    let Lf = 0
    for (const r of chain) { start.set(r.index, Lf); Lf += r.length_m }
    const pts = curvePoints(ring, c)
    const segL = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]))
    const Lc = segL.reduce((t, x) => t + x, 0)
    const k = Lc / (Lf || 1)
    // The windows on the facets, as distances along the curve.
    const along = placed.filter((w) => start.has(w.wall)).map((w) => ({ w, s0: (start.get(w.wall)! + w.offset_m) * k, s1: (start.get(w.wall)! + w.offset_m + w.width_m) * k }))
    let s = 0
    pts.slice(1).forEach((b, i) => {
      const a = pts[i]!, L = segL[i]!
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const az = ((Math.atan2(dy, -dx) * 180) / Math.PI + 360) % 360
      const run: WallRun = { index: -1 - segments.length, block: c.block, side: -1, a, b, length_m: L, azimuth_deg: az }
      const windows = along.flatMap(({ w, s0, s1 }) => {
        const lo = Math.max(s0, s), hi = Math.min(s1, s + L)
        return hi - lo > 0.02 ? [{ ...w, wall: run.index, offset_m: lo - s, width_m: hi - lo }] : []
      })
      segments.push({ run, windows })
      s += L
    })
  }
  return { replaced, segments }
}

/**
 * The curve a wall belongs to, found from it (Shape: "Draw as a curve"): it and the walls either side that keep turning
 * the same way by a little at each corner (5°–60°), each under 6 m. Null when that makes fewer than three walls.
 */
export function chainAt(ring: readonly XY[], side: number): WallCurve | null {
  const n = ring.length
  const len = (i: number) => Math.hypot(ring[(i + 1) % n]![0] - ring[i]![0], ring[(i + 1) % n]![1] - ring[i]![1])
  // The turn at corner i+1, between side i and side i+1 (degrees, signed).
  const turn = (i: number) => {
    const a = ring[i]!, b = ring[(i + 1) % n]!, c = ring[(i + 2) % n]!
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0])
    return ((((t2 - t1) * 180) / Math.PI + 540) % 360) - 180
  }
  const ok = (t: number, sign: number) => Math.abs(t) >= 5 && Math.abs(t) <= 60 && (sign === 0 || Math.sign(t) === sign)
  if (len(side) > 6) return null
  let from = side, to = side, sign = 0
  while (to + 1 < n && len(to + 1) <= 6 && ok(turn(to), sign)) { sign = Math.sign(turn(to)); to++ }
  while (from - 1 >= 0 && len(from - 1) <= 6 && ok(turn(from - 1), sign)) { sign = Math.sign(turn(from - 1)); from-- }
  return to - from >= 2 ? { block: -1, from, to } : null
}
