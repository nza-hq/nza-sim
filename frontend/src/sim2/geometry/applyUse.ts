/**
 * Brief 118 P3: a building use (Hotel, Office, Shop) as a template for Spaces. It brings one space type for each kind
 * of room NZA Sim's library has profiles for in that use (each filled by `borrow`, so every value comes from the
 * library or today's Internal Gains templates), and gives the use's main space type to the rooms chosen. A space type
 * it made before is reused, so applying again changes nothing. Values the sources do not give stay unset.
 */
import { BORROWS, borrow } from './borrow'
import type { Plan, SpaceType } from './plan'

export type BuildingUse = { id: string; name: string; type: string; main: string }
const USE_NAMES: Record<string, string> = { hotel: 'Hotel', office: 'Office', retail: 'Shop' }

/** The uses the library can fill: each library building type with at least one kind of room. */
export const BUILDING_USES: BuildingUse[] = [...new Set(BORROWS.map((b) => b.type))].map((type) => ({
  id: `use_${type}`, name: USE_NAMES[type] ?? type, type, main: BORROWS.find((b) => b.type === type)!.key,
}))
export const useById = (id: string | null | undefined) => BUILDING_USES.find((u) => u.id === id)
export const roomKindsOf = (u: BuildingUse) => BORROWS.filter((b) => b.type === u.type)

export function applyUse(plan: Plan, use: BuildingUse, ids: readonly string[], base: () => Partial<SpaceType>): Plan {
  let spaces = plan.spaces
  let mainId = ''
  for (const b of roomKindsOf(use)) {
    let sp = spaces.find((x) => x.borrowed === b.key)
    if (!sp) {
      let k = spaces.length + 1
      while (spaces.some((x) => x.id === `s${k}`)) k++
      sp = { id: `s${k}`, name: b.name, use: null, occupancy: null, lighting: null, equipment: null, ...base(), ...borrow(b) } as SpaceType
      spaces = [...spaces, sp]
    }
    if (b.key === use.main) mainId = sp.id
  }
  const every = plan.rooms.length > 0 && plan.rooms.every((r) => ids.includes(r.id))
  return { ...plan, spaces, rooms: plan.rooms.map((r) => (ids.includes(r.id) ? { ...r, space: mainId } : r)), ...(every ? { building_use: use.id } : {}) }
}
