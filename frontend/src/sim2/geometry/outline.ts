/**
 * Sim2 geometry prototype: changes to the building outline, without a screen. Each one hands back a new plan, or a
 * reason in plain words (decodED's rule, Brief 101 D7: never refuse in silence).
 *
 *   - addShape: a drawn box, triangle or shape joins the outline (the first one is the outline); it must touch it.
 *   - cutShape: a drawn box is taken out of the outline; it must leave one piece with no hole.
 *   - setRing: the outline after a corner was dragged, added or taken away; it must not cross itself.
 *   - moveBy / turnBy: the whole building (outline, zones, windows) moves or turns; nothing else changes.
 *
 * When the outline's shape changes, zones go back to one zone (the old cut lines no longer fit) and window sets stay
 * on any wall that is still there, exactly as it was; the rest are dropped, and the reply says so.
 */
import pc from 'polygon-clipping'
import { ringCrossings } from './ported/drawCore'
import { area, ccw, type XY } from './ported/zones'
import { type Plan, wallRuns } from './plan'

export type Changed = { plan: Plan; said?: string } | { why: string }

/** Snap to a grid of `step` metres. */
export const snapXY = (p: XY, step: number): XY => [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step]

/** A box square to the grid, from two opposite corners. */
export function boxRing(a: XY, b: XY): XY[] | null {
  if (Math.abs(b[0] - a[0]) < 0.25 || Math.abs(b[1] - a[1]) < 0.25) return null
  return ccw([a, [b[0], a[1]], b, [a[0], b[1]]])
}
/** A right-angled triangle in the box from `a` to `b`, the right angle at `a` (where the drag started). */
export function triRing(a: XY, b: XY): XY[] | null {
  if (Math.abs(b[0] - a[0]) < 0.25 || Math.abs(b[1] - a[1]) < 0.25) return null
  return ccw([a, [b[0], a[1]], [a[0], b[1]]])
}

/** Drop repeated and in-line corners (what a union leaves behind). */
export function cleanRing(r: readonly XY[]): XY[] {
  let pts = r.map((p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6] as XY)
  if (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts = pts.slice(0, -1)
  let changed = true
  while (changed && pts.length > 3) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]!
      const b = pts[i]!
      const c = pts[(i + 1) % pts.length]!
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      const same = Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6
      if (same || Math.abs(cr) < 1e-6 * (1 + Math.hypot(c[0] - a[0], c[1] - a[1]))) {
        pts.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return ccw(pts)
}

const closed = (r: readonly XY[]): [number, number][][] => [[...r.map((p) => [p[0], p[1]] as [number, number]), [r[0]![0], r[0]![1]]]]

/** The plan with a new outline: zones back to one, windows kept on walls that did not change. */
export function withOutline(plan: Plan, ring: XY[], what: string): { plan: Plan; said?: string } {
  const before = wallRuns(plan.footprint)
  const after = wallRuns(ring)
  const same = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6
  let lost = 0
  const windows = plan.windows.flatMap((w) => {
    const old = before[w.wall]
    const now = old && after.find((r) => same(r.a, old.a) && same(r.b, old.b))
    if (!now) {
      lost++
      return []
    }
    return [{ ...w, wall: now.index }]
  })
  const hadZones = plan.zones.length > 1
  const first = plan.zones[0]
  const notes = [hadZones ? 'zones went back to one (split again)' : '', lost ? `${lost} window set${lost > 1 ? 's' : ''} removed (the wall changed)` : ''].filter(Boolean)
  return {
    plan: {
      ...plan,
      footprint: ring,
      zones: [{ id: first?.id ?? 'z1', name: first?.name ?? 'Zone 1', ring }],
      zone_next: first ? plan.zone_next : 2,
      windows,
    },
    said: notes.length ? `${what}: ${notes.join('; ')}` : undefined,
  }
}

export function addShape(plan: Plan, shape: XY[]): Changed {
  if (area(shape) < 1) return { why: 'Too small. Drag a bigger shape.' }
  if (!plan.footprint) return withOutline({ ...plan, zones: [], windows: [], zone_next: 1 }, cleanRing(shape), 'Added')
  const u = pc.union(closed(plan.footprint), closed(shape))
  if (u.length !== 1) return { why: 'Draw it touching the building.' }
  if (u[0]!.length > 1) return { why: 'That would leave a courtyard (a hole). Not yet supported.' }
  const ring = cleanRing(u[0]![0] as XY[])
  if (Math.abs(area(ring) - area(plan.footprint)) < 0.01) return { why: 'That is already inside the building.' }
  return withOutline(plan, ring, 'Added')
}

export function cutShape(plan: Plan, shape: XY[]): Changed {
  if (!plan.footprint) return { why: 'Draw the building first, then cut a piece out of it.' }
  const d = pc.difference(closed(plan.footprint), closed(shape))
  if (!d.length) return { why: 'That would cut away the whole building.' }
  if (d.length > 1) return { why: 'That would cut the building in two.' }
  if (d[0]!.length > 1) return { why: 'That would make a hole in the middle. Cut from an edge.' }
  const ring = cleanRing(d[0]![0] as XY[])
  if (Math.abs(area(ring) - area(plan.footprint)) < 0.01) return { why: 'That box does not overlap the building.' }
  return withOutline(plan, ring, 'Cut')
}

export function setRing(plan: Plan, ring: XY[]): Changed {
  if (ring.length < 3) return { why: 'A building needs at least 3 corners.' }
  if (ringCrossings(ring, true).length) return { why: 'Those walls cross. Move the corner.' }
  if (area(ring) < 1) return { why: 'Too small.' }
  return withOutline(plan, ccw(ring), 'Reshaped')
}

const mapPlan = (plan: Plan, f: (p: XY) => XY): Plan => ({
  ...plan,
  footprint: plan.footprint ? plan.footprint.map(f) : null,
  zones: plan.zones.map((z) => ({ ...z, ring: z.ring.map(f) })),
})

export const moveBy = (plan: Plan, d: XY): Plan => mapPlan(plan, (p) => [p[0] + d[0], p[1] + d[1]])

export function centreOf(ring: readonly XY[]): XY {
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** Turn the whole building by `rad` (anticlockwise) round `c`. Wall indices do not change. */
export function turnBy(plan: Plan, rad: number, c: XY): Plan {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return mapPlan(plan, (p) => {
    const d: XY = [p[0] - c[0], p[1] - c[1]]
    return [c[0] + d[0] * cos - d[1] * sin, c[1] + d[0] * sin + d[1] * cos]
  })
}
