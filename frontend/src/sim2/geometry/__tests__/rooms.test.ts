import { describe, expect, it } from 'vitest'
import { emptyPlan, type Plan, type XY } from '../plan'
import { addShape } from '../outline'
import { assignZone, boxRoom, covers, divideRoom, halveRoom, innerSideAt, joinRooms, moveWall } from '../rooms'
import { buildDocument } from '../toDocument'

const box: XY[] = [[0, 0], [20, 0], [20, 10], [0, 10]]
const ok = (r: { plan: Plan } | { why: string }): Plan => {
  if ('why' in r) throw new Error(r.why)
  return r.plan
}
const start = () => ok(addShape(emptyPlan(), box))

describe('rooms', () => {
  it('a new building is one room in one zone', () => {
    const p = start()
    expect(p.rooms).toHaveLength(1)
    expect(p.zones).toHaveLength(1)
    expect(p.rooms[0]!.zone).toBe(p.zones[0]!.id)
  })
  it('halve, divide and a box keep the floor covered', () => {
    let p = ok(halveRoom(start(), 'r1'))
    expect(p.rooms.map((r) => r.name)).toEqual(['Room 1', 'Room 2'])
    p = ok(divideRoom(p, [0, 5], [10, 5]))
    expect(p.rooms).toHaveLength(3)
    p = ok(boxRoom(p, [[14, 0], [20, 0], [20, 4], [14, 4]]))
    expect(p.rooms).toHaveLength(4)
    expect(covers(p.blocks, p.rooms)).toBe(true)
  })
  it('a box outside the building is refused in words', () => {
    expect(boxRoom(start(), [[30, 0], [35, 0], [35, 5], [30, 5]])).toHaveProperty('why')
  })
  it('join puts touching rooms back together and refuses rooms apart', () => {
    let p = ok(halveRoom(start(), 'r1'))
    p = ok(halveRoom(p, 'r1'))
    const ids = p.rooms.map((r) => r.id)
    expect(joinRooms(p, [ids[0]!, ids[1]!])).not.toHaveProperty('why')
    const j = ok(joinRooms(p, ids))
    expect(j.rooms).toHaveLength(1)
    expect(j.rooms[0]!.ring).toHaveLength(4)
  })
  it('a wall between two rooms moves both, snapped by the caller', () => {
    const p = ok(halveRoom(start(), 'r1'))
    const s = innerSideAt(p, [10, 5], 0.5)
    expect(s).not.toBeNull()
    const q = ok(moveWall(p, s!, 2))
    const areas = q.rooms.map((r) => r.ring).map((r) => Math.abs(r.reduce((t, a, i) => t + a[0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * a[1], 0) / 2)).sort((a, b) => a - b)
    expect(areas[0]! + areas[1]!).toBeCloseTo(200, 6)
    expect(Math.abs(areas[1]! - areas[0]!)).toBeCloseTo(40, 6)
    // An outside wall is not picked up as a wall between rooms.
    expect(innerSideAt(p, [5, 0], 0.5)).toBeNull()
  })
  it('a wing added keeps the rooms and makes the new floor a room', () => {
    const p = ok(halveRoom(start(), 'r1'))
    const q = ok(addShape(p, [[0, 10], [6, 10], [6, 16], [0, 16]]))
    expect(q.rooms).toHaveLength(3)
    expect(covers(q.blocks, q.rooms)).toBe(true)
  })
})

describe('rooms in zones, in the document', () => {
  it('rooms of one zone make one zone with no partition between them; another zone gets a partition and a system', () => {
    let p = ok(halveRoom(start(), 'r1'))
    p = ok(halveRoom(p, 'r1'))
    // Three rooms along the 20 m building: 10, 5, 5 (or so). Put the last one in a new zone with its own heating.
    const last = p.rooms[p.rooms.length - 1]!
    const plant = { id: 's1', name: 'Plant', use: 'other', occupancy: null, lighting: null, equipment: null, heating: 'gas_boiler_heating', cooling: null, ventilation: null, dhw: null }
    p = { ...p, zones: [...p.zones, { id: 'z2', name: 'Plant', use: null, heating: null, cooling: null }], spaces: [plant], rooms: p.rooms.map((r) => (r.id === last.id ? { ...r, space: 's1' } : r)) }
    p = assignZone(p, [last.id], 'z2')
    const b = buildDocument(p)
    expect(b.issues).toEqual([])
    expect(b.totals.zones).toBe(2)
    expect(b.totals.partitions).toBe(1)
    expect(b.totals.floor_m2).toBeCloseTo(200, 6)
    const doc = b.doc as any
    const z1 = doc.zones.find((z: any) => z.id === 'z1')
    expect(z1.rooms).toBe(2)
    expect(z1.use_type).toBe('unassigned')
    expect(doc.zones.find((z: any) => z.id === 'z2').use_type).toBe('other')
    expect(doc.system_groups).toHaveLength(1)
    expect(doc.system_groups[0]).toMatchObject({ service: 'heating', zones: ['z2'], enabled: true, share_pct: 100, source: 'gas', template_ref: 'gas_boiler_heating' })
    expect(doc.system_groups[0].efficiency_metric).toBeGreaterThan(0.8)
    // Zone 1's south wall is one wall across both its rooms.
    const south = doc.surfaces.filter((s: any) => s.zone_a === 'z1' && s.kind === 'wall' && s.azimuth_deg === 180)
    expect(south).toHaveLength(1)
  })
})

describe('a room side partly on the outside wall', () => {
  it('counts the outside part as wall and the rest as shared, with nothing left over', () => {
    // A slanted top: the room below has one side running along the outside wall and on past the room beside it.
    let p = ok(addShape(emptyPlan(), [[0, 0], [20, 0], [24, 14], [0, 10]]))
    p = ok(addShape(p, [[0, 10], [6, 10], [6, 16], [0, 16]]))
    const b = buildDocument(p)
    expect(b.notes.filter((n) => n.includes('neither'))).toEqual([])
    expect(b.ok).toBe(true)
  })
})

describe('blocks', () => {
  it('a shape apart is its own block; a copy dropped against the building joins it', async () => {
    const { copyBlock, dropBlocks, moveBlocks, pushWall } = await import('../outline')
    let p = start()
    p = ok(addShape(p, [[30, 0], [36, 0], [36, 6], [30, 6]]))
    expect(p.blocks).toHaveLength(2)
    expect(p.rooms).toHaveLength(2)
    p = ok(copyBlock(p, 1))
    expect(p.blocks).toHaveLength(3)
    // The copy (6 × 6) moved back against the first block's east wall (x = 20).
    const copy = p.blocks[2]!
    const dx = 20 - Math.min(...copy.map((q) => q[0]))
    const dy = 0 - Math.min(...copy.map((q) => q[1]))
    p = ok(dropBlocks(moveBlocks(p, [2], [dx, dy]), 'Moved'))
    expect(p.blocks).toHaveLength(2)
    expect(covers(p.blocks, p.rooms)).toBe(true)
    expect(buildDocument(p).ok).toBe(true)
    // Push the first block's south wall out 2 m: 26 × 12 + 6 × 6 = … area grows by 2 × 26.
    const before = p.blocks[0]!.reduce((t, a, i, r) => t + a[0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * a[1], 0) / 2
    const south = p.blocks[0]!.findIndex((a, i, r) => a[1] === 0 && r[(i + 1) % r.length]![1] === 0 && r[(i + 1) % r.length]![0] > a[0])
    const q = ok(pushWall(p, 0, south, 2))
    const after = q.blocks[0]!.reduce((t, a, i, r) => t + a[0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * a[1], 0) / 2
    expect(after - before).toBeGreaterThan(39)
    expect(covers(q.blocks, q.rooms)).toBe(true)
  })
})
