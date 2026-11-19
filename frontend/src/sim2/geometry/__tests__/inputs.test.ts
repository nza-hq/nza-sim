/**
 * 19 Nov 2026 (Linzie, "how we input information before we run the model"): fresh air stated on the space type, each
 * basis written to the document as the engine reads it, and what a room asks for read back from the same helpers.
 */
import { describe, expect, it } from 'vitest'
import { emptyPlan, type Plan, type PlanSystem, type SpaceType, type XY } from '../plan'
import { fitRooms } from '../rooms'
import { buildDocument } from '../toDocument'
import { roomAsks } from '../asks'
import { zoneVentilation } from '../../../thermal/engine/ventilation'

const box: XY[] = [[0, 0], [10, 0], [10, 8], [0, 8]]  // 80 m²
const office: SpaceType = { id: 's1', name: 'Office', use: 'office', occupancy: 'office_occupancy', lighting: null, equipment: null, people_per_m2: 0.1, occupancy_rate: 1, sensible_w_per_person: 75, radiant_fraction: 0.3 }
const mvhr: PlanSystem = { id: 'y3', service: 'ventilation', name: 'MVHR', template: 'mvhr_standard', flow: 1.2, schedule: null, runs: 'continuous' }
const make = (sp: Partial<SpaceType>): Plan => {
  const p = fitRooms(emptyPlan(), [box]).plan
  return { ...p, spaces: [{ ...office, ...sp }], systems: [mvhr], rooms: p.rooms.map((r) => ({ ...r, space: 's1', systems: { ventilation: 'y3' } })) }
}
const hours = { count: 24, month: new Int8Array(24).fill(1), day: new Int8Array(24).fill(1), hour: Int8Array.from({ length: 24 }, (_, i) => i + 1) } as any
const ventOf = (p: Plan) => {
  const b = buildDocument(p)
  expect(b.issues).toEqual([])
  const doc = b.doc as any
  const flows = zoneVentilation(doc, hours)[0]!.map((v) => v.flow_m3s * 1000)
  return { entries: doc.zones[0].ventilation, l_s: flows.reduce((t, x) => t + x, 0) }
}

describe('fresh air on the space type', () => {
  it('not stated: the ventilation system flow, as before (1.2 l/s per m²)', () => {
    const v = ventOf(make({}))
    expect(v.entries).toHaveLength(1)
    expect(v.entries[0]).toMatchObject({ flow_rate: 1.2, flow_rate_basis: 'per_m2' })
    expect(v.l_s).toBeCloseTo(96, 6)
  })
  it('per person: 10 l/s × 8 people', () => {
    const p = make({ fresh_air_basis: 'per_person', fresh_air_l_s_person: 10 })
    const v = ventOf(p)
    expect(v.entries[0]).toMatchObject({ flow_rate: 10, flow_rate_basis: 'per_person' })
    expect(v.l_s).toBeCloseTo(80, 6)
    expect(roomAsks(p, p.rooms[0]!)).toMatchObject({ people: 8, fresh_from_space: true })
    expect(roomAsks(p, p.rooms[0]!).fresh_l_s).toBeCloseTo(80, 6)
  })
  it('per person plus per m²: two entries, added (7 × 8 + 0.7 × 80 = 112 l/s)', () => {
    const p = make({ fresh_air_basis: 'per_person_and_m2', fresh_air_l_s_person: 7, fresh_air_l_s_m2: 0.7 })
    const v = ventOf(p)
    expect(v.entries.map((e: any) => e.flow_rate_basis)).toEqual(['per_person', 'per_m2'])
    expect(v.l_s).toBeCloseTo(112, 6)
    expect(roomAsks(p, p.rooms[0]!).fresh_l_s).toBeCloseTo(112, 6)
  })
  it('each room fixed: 30 l/s × the zone\'s rooms', () => {
    const v = ventOf(make({ fresh_air_basis: 'per_room', fresh_air_l_s_room: 30 }))
    expect(v.entries[0]).toMatchObject({ flow_rate: 30, flow_rate_basis: 'constant' })
    expect(v.l_s).toBeCloseTo(30, 6)
  })
  it('air changes: 2 an hour of the room volume', () => {
    const p = make({ fresh_air_basis: 'ach', fresh_air_ach: 2 })
    const v = ventOf(p)
    const vol = 80 * p.storey_height_m
    expect(v.l_s).toBeCloseTo((2 * vol * 1000) / 3600, 6)
    expect(roomAsks(p, p.rooms[0]!).fresh_l_s).toBeCloseTo(v.l_s, 6)
  })
  it('a basis without its figure leaves the flow unstated, and the run names it', () => {
    const b = buildDocument(make({ fresh_air_basis: 'per_m2' }))
    expect((b.doc as any).zones[0].ventilation[0]).toMatchObject({ flow_rate: null, flow_rate_basis: null })
  })
})
