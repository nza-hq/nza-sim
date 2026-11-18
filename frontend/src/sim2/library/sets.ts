/**
 * Brief 118 P3: construction sets, the fabric template a building starts from. Each set is a bundle of constructions
 * already in NZA Sim's library (snapshot.json), by key, so every U-value still comes from the library (rule 3) and a
 * set adds no figure of its own. Doors take the drafted solid timber door (docs/audit/102/library_additions.json,
 * awaiting Chris), the library's only door, until he adds his own.
 *
 * Sets for existing buildings by age (solid brick, unfilled cavity, single glazing…) need their constructions added
 * to the library first, as items Chris checks (docs/audit/102/library_additions.json); they are not here until then.
 */
export type SetElement = 'wall' | 'glazing' | 'door' | 'roof' | 'floor'
/** The library's door (a draft awaiting Chris's review): drawn doors and every set start from it. */
export const DEFAULT_DOOR = 'timber_door_solid'
export type ConstructionSet = { id: string; name: string; line: string } & Record<SetElement, string>

export const CONSTRUCTION_SETS: readonly ConstructionSet[] = [
  { id: 'set_standard', name: 'Standard new build', line: 'Insulated cavity wall, double low-e glazing, flat roof, slab floor', wall: 'cavity_wall_standard', glazing: 'double_low_e', door: DEFAULT_DOOR, roof: 'flat_roof_standard', floor: 'ground_floor_slab' },
  { id: 'set_enhanced', name: 'Enhanced fabric', line: '150 mm PIR cavity, triple glazing, 200 mm PIR roof, 150 mm XPS floor', wall: 'cavity_wall_enhanced', glazing: 'triple_glazing', door: DEFAULT_DOOR, roof: 'flat_roof_enhanced', floor: 'ground_floor_enhanced' },
  { id: 'set_timber', name: 'Timber frame, pitched roof', line: 'Timber frame wall, double low-e glazing, pitched roof, slab floor', wall: 'timber_frame_standard', glazing: 'double_low_e', door: DEFAULT_DOOR, roof: 'pitched_roof_standard', floor: 'ground_floor_slab' },
  // 17 Nov 2026 (example school): drafts awaiting Chris (library_additions.json), as the note above asks.
  { id: 'set_standard_hard', name: 'Standard new build, hard floors', line: 'As Standard new build, with a ground floor that has no carpet in it (halls, kitchens, corridors)', wall: 'cavity_wall_standard', glazing: 'double_low_e', door: DEFAULT_DOOR, roof: 'flat_roof_standard', floor: 'ground_floor_slab_hard' },
  { id: 'set_1960s', name: '1960s school or office, as built', line: 'Unfilled cavity wall, 1990s replacement double glazing, 100 mm loft insulation, uninsulated slab', wall: 'cavity_wall_unfilled_1960s', glazing: 'glazing_double_1990s', door: DEFAULT_DOOR, roof: 'loft_ceiling_100mm', floor: 'ground_floor_uninsulated' },
  { id: 'set_bridgwater', name: 'Bridgwater hotel (BRUKL)', line: 'The constructions from the Bridgwater BRUKL', wall: 'bridgwater_ext_wall', glazing: 'bridgwater_glazing', door: DEFAULT_DOOR, roof: 'bridgwater_roof', floor: 'bridgwater_ground_floor' },
]

export const SET_ELEMENTS: ReadonlyArray<{ key: SetElement; name: string }> = [
  { key: 'wall', name: 'Outside walls' },
  { key: 'glazing', name: 'Windows' },
  { key: 'door', name: 'Doors' },
  { key: 'roof', name: 'Roofs' },
  { key: 'floor', name: 'Ground floors' },
]
