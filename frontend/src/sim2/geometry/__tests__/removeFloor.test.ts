import { describe, expect, it } from 'vitest'
import { emptyPlan, floorsOf, onFloor, removeFloor, type Plan } from '../plan'

const sq = (x: number): [number, number][] => [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]]
function three(): Plan {
  let p: Plan = { ...emptyPlan(), blocks: [sq(0)], rooms: [{ id: 'r1', name: 'Hall', ring: sq(0), zone: 'z1' } as never], zones: [{ id: 'z1', name: 'Z1' } as never, { id: 'z2', name: 'Z2' } as never, { id: 'z3', name: 'Z3' } as never] }
  p = onFloor(p, 1)
  p = { ...p, blocks: [sq(0)], rooms: [{ id: 'r2', name: 'Office', ring: sq(0), zone: 'z2' } as never] }
  p = onFloor(p, 2)
  p = { ...p, blocks: [sq(0)], rooms: [{ id: 'r3', name: 'Store', ring: sq(0), zone: 'z3' } as never] }
  return p
}

describe('removeFloor (19 Nov 2026)', () => {
  it('removes the top floor and its zone, and edits the floor below', () => {
    const p = removeFloor(three(), 2)
    expect(floorsOf(p).map((f) => f.name)).toEqual(['Ground floor', 'First floor'])
    expect(p.active_floor).toBe(1)
    expect(p.rooms.map((r) => r.id)).toEqual(['r2'])
    expect(p.zones.map((z) => z.id)).toEqual(['z1', 'z2'])
  })
  it('a middle floor: the one above moves down and is renamed for its place', () => {
    const p = removeFloor(onFloor(three(), 1), 1)
    const fs = floorsOf(p)
    expect(fs.map((f) => f.name)).toEqual(['Ground floor', 'First floor'])
    expect(fs[1]!.rooms.map((r) => r.id)).toEqual(['r3'])
    expect(p.rooms.map((r) => r.id)).toEqual(['r1'])
  })
  it('back to one floor: a one-floor plan again; the ground floor cannot be removed', () => {
    const two = removeFloor(three(), 2)
    const one = removeFloor(two, 1)
    expect(one.floors).toBeUndefined()
    expect(one.rooms.map((r) => r.id)).toEqual(['r1'])
    expect(removeFloor(two, 0)).toBe(two)
  })
})
