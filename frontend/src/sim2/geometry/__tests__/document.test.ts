import { describe, expect, it } from 'vitest'
import { azimuthOf, emptyPlan, layoutSet, wallRuns, type Plan, type XY } from '../plan'
import { cutZones } from '../ported/zones'
import { fitRooms } from '../rooms'
import { buildDocument } from '../toDocument'

const box: XY[] = [[0, 0], [12, 0], [12, 8], [0, 8]]
const plan = (fp: XY[]): Plan => fitRooms(emptyPlan(), fp).plan

describe('walls and windows', () => {
  it('azimuth of outward normals on an anticlockwise box', () => {
    expect(wallRuns(box).map((r) => r.azimuth_deg)).toEqual([180, 90, 0, 270])
    // A 45° diagonal side facing south-east.
    expect(azimuthOf([0, 0], [10, 10])).toBeCloseTo(135, 6)
  })
  it('three 1 m² windows, equally spaced, on a 12 m wall', () => {
    const run = wallRuns(box)[0]!
    const l = layoutSet(run, { id: 'w1', wall: 0, count: 3, width_m: 1 / 1.2, height_m: 1.2, sill_m: 0.9 }, 3)
    if ('why' in l) throw new Error(l.why)
    const gaps = [l.windows[0]!.offset_m, l.windows[1]!.offset_m - l.windows[0]!.offset_m - l.windows[0]!.width_m]
    expect(gaps[0]).toBeCloseTo(gaps[1]!, 9)
    expect(l.windows[2]!.offset_m + l.windows[2]!.width_m + l.gap_m).toBeCloseTo(12, 9)
  })
  it('says why when they do not fit', () => {
    const run = wallRuns(box)[0]!
    expect(layoutSet(run, { id: 'w', wall: 0, count: 10, width_m: 1.5, height_m: 1, sill_m: 1 }, 3)).toHaveProperty('why')
    expect(layoutSet(run, { id: 'w', wall: 0, count: 1, width_m: 1, height_m: 2.5, sill_m: 1 }, 3)).toHaveProperty('why')
  })
})

describe('model document', () => {
  it('one zone with three windows validates against the schema', () => {
    const p = plan(box)
    p.windows = [{ id: 'w1', wall: 0, count: 3, width_m: 1 / 1.2, height_m: 1.2, sill_m: 0.9 }]
    const b = buildDocument(p)
    expect(b.issues).toEqual([])
    expect(b.ok).toBe(true)
    expect(b.totals.glazing_m2).toBeCloseTo(3, 3)
    expect(b.totals.windows).toBe(3)
    // Net wall area: perimeter 40 m × 3 m − 3 m² glazing.
    expect(b.totals.wall_net_m2).toBeCloseTo(117, 3)
    const g = (b.doc as any).surfaces.find((s: any) => s.kind === 'glazing')
    expect(g).toMatchObject({ facade: 'south', azimuth_deg: 180, window_count: 3 })
    expect(g.wwr).toBeCloseTo(3 / 36, 3)
  })
  it('two rooms in two zones make two zones, a partition, and keep every window', () => {
    const p = plan(box)
    p.windows = [{ id: 'w1', wall: 0, count: 3, width_m: 1, height_m: 1, sill_m: 1 }]
    const cut = cutZones([box], [6, 0], [6, 8])
    if ('why' in cut) throw new Error(cut.why)
    p.rooms = cut.zones.map((ring, i) => ({ id: `r${i + 1}`, name: `Room ${i + 1}`, ring, zone: `z${i + 1}` }))
    p.zones = [1, 2].map((n) => ({ id: `z${n}`, name: `Zone ${n}`, use: null, heating: null, cooling: null }))
    const b = buildDocument(p)
    expect(b.ok).toBe(true)
    expect(b.totals.zones).toBe(2)
    expect(b.totals.partitions).toBe(1)
    expect(b.totals.floor_m2).toBeCloseTo(96, 6)
    expect(b.totals.windows).toBe(3)
    const part = (b.doc as any).surfaces.find((s: any) => s.kind === 'partition')
    expect(part.area_m2).toBeCloseTo(24, 6)
    // The middle window sits right on the cut line: counted once, and said.
    expect(b.notes).toContain('A window on wall 1 straddles a line between zones; it is counted in the zone its middle is in')
  })
  it('an L with a diagonal side validates', () => {
    const L: XY[] = [[0, 0], [20, 0], [20, 6], [14, 12], [0, 12]]
    const b = buildDocument(plan(L))
    expect(b.ok).toBe(true)
    const diag = (b.doc as any).surfaces.find((s: any) => s.kind === 'wall' && Math.abs(s.azimuth_deg - 45) < 1e-6)
    expect(diag.area_m2).toBeCloseTo(Math.hypot(6, 6) * 3, 3)
  })
})
