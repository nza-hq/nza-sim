/**
 * Brief 118 P3: give rooms a construction set. For each element the set names, the project gets one fabric type that
 * points at the set's library construction (made the first time, then reused), marked with the set it came from; the
 * chosen rooms' walls, windows, roof and floor then take those types. A type that is later changed by hand loses the
 * mark (it is the project's own from then on), so a second Apply of the set makes a fresh marked type.
 */
import { CONSTRUCTION_SETS, type ConstructionSet, SET_ELEMENTS } from '../library/sets'
import { piecesOfRooms, setTypeOn, setTypeOnRooms } from './facade'
import type { FabricType, Plan } from './plan'

export const setById = (id: string | null | undefined) => CONSTRUCTION_SETS.find((s) => s.id === id)

export function applySet(plan: Plan, set: ConstructionSet, ids: readonly string[]): Plan {
  let p = plan
  for (const { key: el, name } of SET_ELEMENTS) {
    let t = p.fabric_types.find((x) => x.element === el && x.template === set.id && x.construction === set[el] && x.u == null)
    if (!t) {
      let k = p.fabric_types.filter((x) => x.element === el).length + 1
      while (p.fabric_types.some((x) => x.id === `f_${el}${k}`)) k++
      t = { id: `f_${el}${k}`, element: el, name: `${set.name}: ${name.toLowerCase()}`, construction: set[el], u: null, template: set.id } satisfies FabricType
      p = { ...p, fabric_types: [...p.fabric_types, t] }
    }
    p = el === 'roof' || el === 'floor' ? setTypeOnRooms(p, ids, t.id) : setTypeOn(p, piecesOfRooms(p, ids), t.id)
  }
  const every = p.rooms.length > 0 && p.rooms.every((r) => ids.includes(r.id))
  return every ? { ...p, fabric_set: set.id } : p
}
