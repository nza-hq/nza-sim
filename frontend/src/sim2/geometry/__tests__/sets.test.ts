import { describe, expect, it } from 'vitest'
import { construction } from '../../library/library'
import { CONSTRUCTION_SETS, SET_ELEMENTS } from '../../library/sets'
import { applySet } from '../applySet'
import { piecesOfRooms, roomType, typeOfSpan } from '../facade'
import { emptyPlan, type Plan, type XY } from '../plan'
import { addShape } from '../outline'
import { halveRoom } from '../rooms'
import { buildDocument } from '../toDocument'

const ok = (r: { plan: Plan } | { why: string }): Plan => {
  if ('why' in r) throw new Error(r.why)
  return r.plan
}
const two = () => ok(halveRoom(ok(addShape(emptyPlan(), [[0, 0], [20, 0], [20, 10], [0, 10]] as XY[])), 'r1'))

describe('construction sets (Brief 118 P3)', () => {
  it('every set names a library construction of the right element for each part', () => {
    for (const s of CONSTRUCTION_SETS) for (const { key } of SET_ELEMENTS) expect(construction(s[key])?.element, `${s.id} ${key}`).toBe(key)
  })
  it('a set on the whole building gives every wall, window, roof and floor its constructions, and is recorded', () => {
    const set = CONSTRUCTION_SETS[1]!
    const p = applySet(two(), set, ['r1', 'r2'])
    expect(p.fabric_set).toBe(set.id)
    for (const r of p.rooms) {
      for (const el of ['roof', 'floor'] as const) expect(p.fabric_types.find((t) => t.id === roomType(p, r.id, el))!.construction).toBe(set[el])
      for (const pc of piecesOfRooms(p, [r.id])) {
        expect(p.fabric_types.find((t) => t.id === typeOfSpan(p, pc, 'wall'))!.construction).toBe(set.wall)
        expect(p.fabric_types.find((t) => t.id === typeOfSpan(p, pc, 'glazing'))!.construction).toBe(set.glazing)
      }
    }
    expect(buildDocument(p).doc).toBeTruthy()
  })
  it('on one room it changes only that room, and a second Apply reuses the same types', () => {
    const set = CONSTRUCTION_SETS[0]!
    const a = applySet(two(), set, ['r2'])
    expect(a.fabric_set ?? null).toBeNull()
    expect(a.fabric_types.find((t) => t.id === roomType(a, 'r1', 'roof'))!.construction).not.toBe(set.roof)
    expect(a.fabric_types.find((t) => t.id === roomType(a, 'r2', 'roof'))!.construction).toBe(set.roof)
    const b = applySet(a, set, ['r1', 'r2'])
    expect(b.fabric_types.length).toBe(a.fabric_types.length)
  })
})
