import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { chainAt, curvedWalls, curvePoints, displayRing, displayRoomRing } from '../curves'
import { allWindows, floorsOf, upgradePlan, wallRuns, type Plan, type XY } from '../plan'
import { buildDocument } from '../toDocument'

/** Half a 12-gon of radius 5 about (0, 0), on the west of a rectangle: a faceted bay, anticlockwise. */
const R = 5
const arc: XY[] = Array.from({ length: 7 }, (_, k) => { const a = Math.PI / 2 + (k * Math.PI) / 6; return [R * Math.cos(a), R * Math.sin(a)] as XY })
const ring: XY[] = [[10, -5], [10, 5], ...arc] // sides 0 (east), 1 (top), 2–7 the bay's six facets, 8 back along the bottom
const close = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])

describe('curved walls, drawn only (18 Nov 2026)', () => {
  it('finds the bay from any of its facets', () => {
    expect(chainAt(ring, 4)).toEqual({ block: -1, from: 2, to: 7 })
    expect(chainAt(ring, 0)).toBeNull()
  })
  it('the curve runs through the first and last corner, on the circle the corners lie on', () => {
    const pts = curvePoints(ring, { block: 0, from: 2, to: 7 })
    expect(close(pts[0]!, arc[0]!)).toBeLessThan(1e-6)
    expect(close(pts[pts.length - 1]!, arc[6]!)).toBeLessThan(1e-6)
    for (const p of pts) expect(Math.hypot(p[0], p[1])).toBeCloseTo(R, 6)
    // It bulges out to the west, beyond the facets.
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(-R, 6)
  })
  it('outlines follow the curve, and a room along it too', () => {
    const c = [{ block: 0, from: 2, to: 7 }]
    const out = displayRing(ring, c)
    expect(out.length).toBeGreaterThan(ring.length)
    const room = displayRoomRing(ring, [ring], c)
    expect(room.length).toBe(out.length)
  })
  it('windows on the facets move onto the curve, their width scaled by curve length over facet length', () => {
    const runs = wallRuns([ring])
    const placed = [{ set: 'w1', wall: 4, offset_m: 0.5, width_m: 1, height_m: 1.2, sill_m: 0.9, shading_m: 0, door: false }]
    const { replaced, segments } = curvedWalls([ring], runs, placed, [{ block: 0, from: 2, to: 7 }])
    expect([...replaced].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7])
    const facets = runs.filter((r) => r.side >= 2 && r.side <= 7).reduce((t, r) => t + r.length_m, 0)
    const curve = segments.reduce((t, g) => t + g.run.length_m, 0)
    const width = segments.flatMap((g) => g.windows).reduce((t, w) => t + w.width_m, 0)
    expect(width).toBeCloseTo(curve / facets, 6)
  })
  it('the RWGC clubhouse: two bays drawn as curves, and the model is the same with or without them', () => {
    const file = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../../docs/examples/rwgc_clubhouse.plan.json'), 'utf8'))
    const plan = upgradePlan(file.plan) as Plan
    expect(floorsOf(plan).map((f) => f.curves?.length ?? 0)).toEqual([1, 1, 0])
    const strip = (p: Plan): Plan => ({ ...p, curves: undefined, floors: p.floors?.map((f) => ({ ...f, curves: undefined })) })
    expect(JSON.stringify(buildDocument(plan).doc)).toBe(JSON.stringify(buildDocument(strip(plan)).doc))
    expect(allWindows(plan).problems).toEqual([])
  })
})
