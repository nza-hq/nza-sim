/**
 * Sim2 geometry prototype: the plan as the editor holds it, and the sums on it (no screen, no React).
 *
 * A plan is one floor: a footprint (drawn with decodED's drawing core), filled with rooms (decodED's room editor and
 * zone cut), and window sets on the footprint's walls. Rooms always cover the floor exactly, wall to wall, with no
 * gaps and no overlaps (partitions have no thickness here). Each room sits in one zone; a zone is what the model
 * document calls a zone, and carries what is assigned to it (its use, its heating and its cooling system).
 * Everything is in local metres, x east, y north, north up (orientation 0).
 *
 * A "wall run" is one side of the footprint (index i: footprint[i] → footprint[i+1]). Windows belong to a run and are
 * placed along it by distance from its start, so cutting the floor into rooms never moves or loses a window; when the
 * model document is written, each zone's stretch of the run takes the windows whose middles fall on it.
 */
import { area, ccw, type XY } from './ported/zones'

export type { XY }

/** A room: drawn, always inside the footprint, in exactly one zone. */
export type PlanRoom = { id: string; name: string; ring: XY[]; zone: string }
/** A zone: a group of rooms that the model treats as one air volume, with what is assigned to it. Null is unset. */
export type PlanZone = { id: string; name: string; use: string | null; heating: string | null; cooling: string | null }
/** A heating or cooling system the user has named. Its kit (fuel, efficiency) is not asked yet, so stays unset. */
export type PlanSystem = { id: string; service: 'heating' | 'cooling'; label: string }

/** Uses a zone can be given: the zone types today's schedule editor offers (UnifiedScheduleEditor.jsx). */
export const USES: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'bedroom', name: 'Bedroom' },
  { key: 'office', name: 'Office' },
  { key: 'public', name: 'Public' },
  { key: 'retail', name: 'Retail' },
  { key: 'industrial', name: 'Industrial' },
  { key: 'other', name: 'Other' },
]

/** N windows of one size, spaced equally along a wall run (equal gaps at both ends and between). */
export type WindowSet = {
  id: string
  /** Footprint side index. */
  wall: number
  count: number
  width_m: number
  height_m: number
  sill_m: number
}

export type Plan = {
  footprint: XY[] | null
  rooms: PlanRoom[]
  zones: PlanZone[]
  systems: PlanSystem[]
  storey_height_m: number
  windows: WindowSet[]
  /** Next numbers, so names and ids are never reused within a plan. */
  next: { room: number; zone: number; system: number }
}

export const emptyPlan = (): Plan => ({ footprint: null, rooms: [], zones: [], systems: [], storey_height_m: 3, windows: [], next: { room: 1, zone: 1, system: 1 } })

/** A new zone with nothing assigned. */
export const blankZone = (n: number): PlanZone => ({ id: `z${n}`, name: `Zone ${n}`, use: null, heating: null, cooling: null })

export const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1])
const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp

/** A footprint side: its two ends, length, and the true azimuth of its outward normal (degrees clockwise from north). */
export type WallRun = { index: number; a: XY; b: XY; length_m: number; azimuth_deg: number }

/** Outward normal azimuth of side a→b of an anticlockwise ring (outside is on the right). */
export function azimuthOf(a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  // Right-hand normal (dy, -dx); azimuth from north (y) clockwise towards east (x).
  const deg = (Math.atan2(dy, -dx) * 180) / Math.PI
  return round(((deg % 360) + 360) % 360, 6) % 360
}

export function wallRuns(footprint: readonly XY[] | null): WallRun[] {
  if (!footprint || footprint.length < 3) return []
  const r = ccw(footprint)
  return r.map((a, i) => {
    const b = r[(i + 1) % r.length] as XY
    return { index: i, a, b, length_m: dist(a, b), azimuth_deg: azimuthOf(a, b) }
  })
}

/** Compass label for an azimuth: 16 points for the screen. */
export function compass16(az: number): string {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return pts[Math.round(az / 22.5) % 16] as string
}
/** The schema's four-way facade label (nearest of north, east, south, west). */
export function facade4(az: number): 'north' | 'east' | 'south' | 'west' {
  return (['north', 'east', 'south', 'west'] as const)[Math.round(az / 90) % 4]!
}

// ─── Windows ──────────────────────────────────────────────────────────────────────────────────────

/** One placed window: distance of its left edge from the run's start (looking at the wall from outside, run a→b). */
export type PlacedWindow = { set: string; wall: number; offset_m: number; width_m: number; height_m: number; sill_m: number }

export type Layout = { windows: PlacedWindow[]; gap_m: number } | { why: string }

/** Equal spacing: gap = (L − N·w) / (N + 1). Refuses, in words, when they do not fit. */
export function layoutSet(run: WallRun, s: WindowSet, storeyHeight: number): Layout {
  if (!(s.count >= 1) || !Number.isInteger(s.count)) return { why: 'Number of windows must be a whole number, 1 or more' }
  if (!(s.width_m > 0) || !(s.height_m > 0)) return { why: 'Window size must be more than zero' }
  if (s.sill_m < 0) return { why: 'Sill height cannot be below the floor' }
  if (s.sill_m + s.height_m > storeyHeight + 1e-9) return { why: `Sill + window height (${round(s.sill_m + s.height_m, 2)} m) is taller than the storey (${storeyHeight} m)` }
  const total = s.count * s.width_m
  if (total > run.length_m + 1e-9) return { why: `${s.count} windows ${round(s.width_m, 2)} m wide need ${round(total, 2)} m; this wall is ${round(run.length_m, 2)} m` }
  const gap = (run.length_m - total) / (s.count + 1)
  const windows: PlacedWindow[] = []
  for (let i = 0; i < s.count; i++) {
    windows.push({ set: s.id, wall: run.index, offset_m: gap + i * (s.width_m + gap), width_m: s.width_m, height_m: s.height_m, sill_m: s.sill_m })
  }
  return { windows, gap_m: gap }
}

/** Every window on the plan (sets that no longer fit are skipped and reported). */
export function allWindows(plan: Plan): { windows: PlacedWindow[]; problems: Array<{ set: string; why: string }> } {
  const runs = wallRuns(plan.footprint)
  const windows: PlacedWindow[] = []
  const problems: Array<{ set: string; why: string }> = []
  for (const s of plan.windows) {
    const run = runs[s.wall]
    if (!run) {
      problems.push({ set: s.id, why: 'Its wall is gone' })
      continue
    }
    const l = layoutSet(run, s, plan.storey_height_m)
    if ('why' in l) problems.push({ set: s.id, why: l.why })
    else windows.push(...l.windows)
  }
  return { windows, problems }
}

/** A point `t` metres along a run. */
export const along = (run: WallRun, t: number): XY => {
  const f = run.length_m ? t / run.length_m : 0
  return [run.a[0] + (run.b[0] - run.a[0]) * f, run.a[1] + (run.b[1] - run.a[1]) * f]
}

// ─── Rooms (or any pieces of the floor) against the footprint ──────────────────────────────────────────────────────────────────

const EPS = 0.05

/** Where `p` sits on a run: distance along it, or null if it is not on the run. */
export function onRun(run: WallRun, p: XY): number | null {
  const dx = run.b[0] - run.a[0]
  const dy = run.b[1] - run.a[1]
  const L = run.length_m
  if (L < 1e-9) return null
  const t = ((p[0] - run.a[0]) * dx + (p[1] - run.a[1]) * dy) / L
  const off = Math.abs((p[0] - run.a[0]) * dy - (p[1] - run.a[1]) * dx) / L
  if (off > EPS || t < -EPS || t > L + EPS) return null
  return Math.max(0, Math.min(L, t))
}

/** A piece's side lying on the footprint: which run, and the stretch [t0, t1] of it (t0 < t1). */
export type PieceWall = { piece: string; side: number; run: number; t0: number; t1: number; length_m: number; azimuth_deg: number }
/** A stretch two pieces share. */
export type PieceShare = { a: string; b: string; length_m: number }
export type Piece = { id: string; ring: XY[] }

export function edgesOf(footprint: readonly XY[] | null, pieces: readonly Piece[]): { walls: PieceWall[]; shares: PieceShare[]; open: Array<{ piece: string; side: number; length_m: number }> } {
  const runs = wallRuns(footprint)
  const walls: PieceWall[] = []
  const open: Array<{ piece: string; side: number; length_m: number }> = []
  const inner: Array<{ zone: string; a: XY; b: XY }> = []
  for (const z of pieces) {
    const r = ccw(z.ring)
    r.forEach((a, i) => {
      const b = r[(i + 1) % r.length] as XY
      const L = dist(a, b)
      if (L < 1e-6) return
      // The stretches of this side that lie on the outside wall are walls; what is left of it is inside (a side can
      // be both, when a corner in line with it was tidied away).
      const u: XY = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
      const at = (s: number): XY => [a[0] + u[0] * s, a[1] + u[1] * s]
      const onLine = (p: XY) => Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]) < EPS
      const covered: Array<[number, number]> = []
      for (const run of runs) {
        if (!onLine(run.a) || !onLine(run.b)) continue
        const sa = (run.a[0] - a[0]) * u[0] + (run.a[1] - a[1]) * u[1]
        const sb = (run.b[0] - a[0]) * u[0] + (run.b[1] - a[1]) * u[1]
        const s0 = Math.max(0, Math.min(sa, sb))
        const s1 = Math.min(L, Math.max(sa, sb))
        if (s1 - s0 <= EPS) continue
        const ta = onRun(run, at(s0))!
        const tb = onRun(run, at(s1))!
        walls.push({ piece: z.id, side: i, run: run.index, t0: Math.min(ta, tb), t1: Math.max(ta, tb), length_m: s1 - s0, azimuth_deg: run.azimuth_deg })
        covered.push([s0, s1])
      }
      covered.sort((x, y) => x[0] - y[0])
      let s = 0
      for (const [c0, c1] of covered) {
        if (c0 - s > EPS) inner.push({ zone: z.id, a: at(s), b: at(c0) })
        s = Math.max(s, c1)
      }
      if (L - s > EPS) inner.push({ zone: z.id, a: at(s), b })
    })
  }
  // Shared stretches between zones: collinear overlap of their inner sides (a cut line, or part of one).
  const shares = new Map<string, PieceShare>()
  const covered = new Map<number, number>()
  for (let i = 0; i < inner.length; i++) {
    for (let j = i + 1; j < inner.length; j++) {
      const p = inner[i]!
      const q = inner[j]!
      if (p.zone === q.zone) continue
      const L = dist(p.a, p.b)
      const u: XY = [(p.b[0] - p.a[0]) / L, (p.b[1] - p.a[1]) / L]
      const offA = Math.abs((q.a[0] - p.a[0]) * u[1] - (q.a[1] - p.a[1]) * u[0])
      const offB = Math.abs((q.b[0] - p.a[0]) * u[1] - (q.b[1] - p.a[1]) * u[0])
      if (offA > EPS || offB > EPS) continue
      const s0 = (q.a[0] - p.a[0]) * u[0] + (q.a[1] - p.a[1]) * u[1]
      const s1 = (q.b[0] - p.a[0]) * u[0] + (q.b[1] - p.a[1]) * u[1]
      const ov = Math.min(L, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1))
      if (ov <= EPS) continue
      const [x, y] = p.zone < q.zone ? [p.zone, q.zone] : [q.zone, p.zone]
      const k = `${x}|${y}`
      const s = shares.get(k) ?? { a: x, b: y, length_m: 0 }
      s.length_m += ov
      shares.set(k, s)
      covered.set(i, (covered.get(i) ?? 0) + ov)
      covered.set(j, (covered.get(j) ?? 0) + ov)
    }
  }
  inner.forEach((s, i) => {
    const L = dist(s.a, s.b)
    const left = L - (covered.get(i) ?? 0)
    if (left > EPS) open.push({ piece: s.zone, side: i, length_m: left })
  })
  return { walls, shares: [...shares.values()], open }
}

export const ringArea = (r: readonly XY[]) => area(r)
