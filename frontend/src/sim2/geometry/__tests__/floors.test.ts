import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDocument } from '../toDocument'
import { allRooms, floorsOf, newPlan, onFloor, upgradePlan, type Plan } from '../plan'

type XY = [number, number]
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

/** Ground 20 × 10 m in two zones; the first floor 12 × 10 m from x = 4 to 16, overhanging nothing. */
function twoFloors(): Plan {
  let p: Plan = { ...newPlan(), building: { ...newPlan().building!, terrain: 'suburban' }, storey_height_m: 3, zones: [1, 2, 3].map((n) => ({ id: `z${n}`, name: `Zone ${n}`, use: null, heating: null, cooling: null })) }
  p = { ...p, blocks: [rect(0, 0, 20, 10)], rooms: [{ id: 'r1', name: 'West', ring: rect(0, 0, 10, 10), zone: 'z1' }, { id: 'r2', name: 'East', ring: rect(10, 0, 20, 10), zone: 'z2' }] }
  p = onFloor(p, 1)
  p = { ...p, blocks: [rect(4, 0, 16, 10)], rooms: [{ id: 'r3', name: 'Upstairs', ring: rect(4, 0, 16, 10), zone: 'z3' }] }
  return onFloor(p, 0)
}

describe('stacked floors (18 Nov 2026, RWGC clubhouse)', () => {
  it('switching floors keeps every floor; the one being edited is the plan\'s own geometry', () => {
    const p = twoFloors()
    expect(floorsOf(p).map((f) => f.rooms.map((r) => r.id))).toEqual([['r1', 'r2'], ['r3']])
    expect(p.rooms.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(onFloor(p, 1).rooms.map((r) => r.id)).toEqual(['r3'])
    expect(allRooms(onFloor(p, 1)).map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
    // A floor past the top is added empty.
    expect(floorsOf(onFloor(p, 2))).toHaveLength(3)
    expect(onFloor(p, 2).blocks).toEqual([])
  })

  it('the floors join where they stand on each other: ceilings for the overlap, the rest of the roof stays', () => {
    const b = buildDocument(twoFloors())
    expect(b.issues).toEqual([])
    const doc = b.doc as any
    expect(doc.zones.map((z: any) => [z.id, z.floor])).toEqual([['z1', 0], ['z2', 0], ['z3', 1]])
    const s = (zone: string, kind: string) => doc.surfaces.filter((x: any) => x.zone_a === zone && x.kind === kind).reduce((t: number, x: any) => t + x.area_m2, 0)
    // Upstairs (x 4–16) is over 6 × 10 m of the west zone and 6 × 10 m of the east.
    expect(s('z1', 'ceiling')).toBeCloseTo(60, 6)
    expect(s('z2', 'ceiling')).toBeCloseTo(60, 6)
    expect(s('z1', 'roof')).toBeCloseTo(40, 6)
    expect(s('z2', 'roof')).toBeCloseTo(40, 6)
    // Upstairs stands wholly on rooms: no ground floor, no floor open to outside.
    expect(s('z3', 'ground') + s('z3', 'floor')).toBeCloseTo(0, 6)
    expect(s('z3', 'roof')).toBeCloseTo(120, 6)
    // Each ceiling is in both zones' lists.
    for (const c of doc.surfaces.filter((x: any) => x.kind === 'ceiling')) {
      expect(doc.zones.find((z: any) => z.id === c.zone_a).surfaces).toContain(c.id)
      expect(doc.zones.find((z: any) => z.id === c.zone_b).surfaces).toContain(c.id)
    }
    expect(b.totals.floor_m2).toBeCloseTo(320, 6)
  })

  it('an upper room over no room below has a floor open to outside air', () => {
    let p = twoFloors()
    p = onFloor(p, 1)
    p = { ...p, blocks: [rect(14, 0, 26, 10)], rooms: [{ id: 'r3', name: 'Upstairs', ring: rect(14, 0, 26, 10), zone: 'z3' }] }
    const b = buildDocument(onFloor(p, 0))
    expect(b.issues).toEqual([])
    const doc = b.doc as any
    const open = doc.surfaces.filter((x: any) => x.zone_a === 'z3' && x.kind === 'floor' && x.zone_b === 'outside')
    expect(open.reduce((t: number, x: any) => t + x.area_m2, 0)).toBeCloseTo(60, 6)
    expect(open[0].tilt_deg).toBe(180)
    expect(b.notes.some((n) => /over no room below/.test(n))).toBe(true)
  })

  it('a floor\'s roof part is a pitched roof over the rooms under it; the rest of the block stays flat', () => {
    let p = twoFloors()
    // A 30° gable over the east end of the ground floor (x 16–20), where nothing stands above.
    p = { ...p, roof: { style: 'flat' }, roof_parts: [{ id: 'g1', name: 'East wing', ring: rect(16, 0, 20, 10), recipe: { style: 'gable', pitch_deg: 30, ridge_axis: 'longest', insulation: 'slope' } }] }
    const b = buildDocument(p)
    expect(b.issues).toEqual([])
    const doc = b.doc as any
    const roofs = (zone: string, slope: boolean) => doc.surfaces.filter((x: any) => x.zone_a === zone && x.kind === 'roof' && (x.tilt_deg > 0) === slope).reduce((t: number, x: any) => t + x.area_m2, 0)
    // The gable's slopes are 4 × 10 m on plan, over the east zone only: 40 / cos 30°.
    expect(roofs('z2', true)).toBeCloseTo(40 / Math.cos(Math.PI / 6), 3)
    // The east zone's flat roof: 10 × 10 less the 60 m² upstairs stands on, less the 40 m² under the gable.
    expect(roofs('z2', false)).toBeCloseTo(0, 3)
    expect(roofs('z1', false)).toBeCloseTo(40, 3)
    expect(roofs('z1', true)).toBeCloseTo(0, 3)
  })

  it('a one-floor plan builds as before (no floors field, nothing stacked)', () => {
    const one: Plan = { ...newPlan(), building: { ...newPlan().building!, terrain: 'suburban' }, storey_height_m: 3, zones: [{ id: 'z1', name: 'Zone 1', use: null, heating: null, cooling: null }], blocks: [rect(0, 0, 10, 10)], rooms: [{ id: 'r1', name: 'Room', ring: rect(0, 0, 10, 10), zone: 'z1' }] }
    const doc = buildDocument(one).doc as any
    expect(doc.zones[0].floor).toBe(0)
    expect(doc.surfaces.some((x: any) => x.kind === 'ceiling')).toBe(false)
  })

  it('the RWGC clubhouse: three floors, every room, and the document is valid', () => {
    const file = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../../docs/examples/rwgc_clubhouse.plan.json'), 'utf8'))
    const plan = upgradePlan(file.plan) as Plan
    expect(floorsOf(plan)).toHaveLength(3)
    const b = buildDocument(plan)
    expect(b.issues).toEqual([])
    const doc = b.doc as any
    expect(new Set(doc.zones.map((z: any) => z.floor))).toEqual(new Set([0, 1, 2]))
    expect(b.totals.rooms).toBe(79)
    // The first and second floors stand on the floors below them (a few m² overhang).
    const up = doc.zones.filter((z: any) => z.floor > 0)
    const upArea = up.reduce((t: number, z: any) => t + z.area_m2, 0)
    const ceil = doc.surfaces.filter((x: any) => x.kind === 'ceiling').reduce((t: number, x: any) => t + x.area_m2, 0)
    expect(ceil).toBeGreaterThan(upArea - 20)
    expect(ceil).toBeLessThanOrEqual(upArea + 1e-6)
  })
})
