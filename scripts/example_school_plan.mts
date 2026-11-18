/**
 * Worked example 2 (17 Nov 2026, Linzie 21:28): an extended UK primary school, made with the editor's own functions
 * so every step is one the workspace offers: the outline and rooms drawn, construction sets given by room (Fabric's
 * Apply), the School building use given to every room (Spaces' Apply, then each room its kind), the roof split into
 * two wings at the inner corner (Shape, Roof), systems, emitters and controls as typed on Systems and Controls, and
 * the pumps filled by "Use defaults". Writes docs/examples/extended_school.plan.json.
 *
 *   Original wing (1965), along the south: entrance, office, five classrooms, staff room, WCs and the old corridor.
 *     Unfilled cavity walls, 1990s replacement double glazing (top-hung, opened by hand above 23 °C), the corridor's
 *     original single-glazed steel windows, 100 mm in the loft under a 30° gable, an uninsulated slab. Gas boiler 1
 *     (1998, 80/70 °C) on big steel radiators, its own hot water cylinder; T8 fluorescent lighting.
 *   Extension (2012), north from the east end: hall, kitchen, store, link corridor, ICT suite, server room and a sixth
 *     classroom. Insulated cavity walls, double low-e glazing with trickle vents, a 5° mono-pitch warm roof, an
 *     insulated slab with hard floors. Gas boiler 2 (2012, 70/50 °C) on radiators for the hall, kitchen and corridor,
 *     and the kitchen's hot water first; VRF heating and cooling in the ICT suite and classroom 6, a cooling-only VRF
 *     unit in the server room; MVHR in the hall and ICT suite, extract in the kitchen and WCs; LED lighting.
 *
 * Every typed value is an example input chosen for the demonstration, not a real building.
 * Run from frontend/:  npx vite-node ../scripts/example_school_plan.mts
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { applySet, setById } from '../frontend/src/sim2/geometry/applySet'
import { applyUse, useById } from '../frontend/src/sim2/geometry/applyUse'
import { setTypeOn } from '../frontend/src/sim2/geometry/facade'
import { type EmitterType, type FabricType, type OwnProfile, type Plan, type PlanControl, type PlanSystem, type SpaceType, type Win, newPlan, upgradePlan } from '../frontend/src/sim2/geometry/plan'
import { splitAtCorner } from '../frontend/src/sim2/geometry/roof'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { defaultPumps } from '../frontend/src/thermal/catalogue/auxiliaryDefaults'
import { TODAY } from '../frontend/src/thermal/schema/upgrade'

const root = path.resolve(__dirname, '..')
type XY = [number, number]
const rect = (x0: number, y0: number, x1: number, y1: number): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

// ─── Outline and rooms (Shape) ───────────────────────────────────────────────────────────────────────────────────────
// x east, y north. Old wing 64 × 10 m along the south; the extension 24 × 30 m north from its east end.
const outline: XY[] = [[0, 0], [64, 0], [64, 40], [40, 40], [40, 10], [0, 10]]
const ROOMS: Array<[string, XY[]]> = [
  ['Entrance and reception', rect(0, 0, 6, 10)],
  ['School office and head', rect(6, 0, 12, 10)],
  ['Classroom 1', rect(12, 0, 20, 7.5)],
  ['Classroom 2', rect(20, 0, 28, 7.5)],
  ['Classroom 3', rect(28, 0, 36, 7.5)],
  ['Classroom 4', rect(36, 0, 44, 7.5)],
  ['Classroom 5', rect(44, 0, 52, 7.5)],
  ['Staff room', rect(52, 0, 58, 7.5)],
  ['Pupil WCs', rect(58, 0, 64, 7.5)],
  ['Corridor (original)', rect(12, 7.5, 64, 10)],
  ['Kitchen', rect(40, 10, 48, 20)],
  ['Store and plant', rect(40, 20, 48, 24)],
  ['Link corridor', rect(48, 10, 51, 24)],
  ['ICT suite', rect(51, 10, 64, 17)],
  ['Server room', rect(51, 17, 55, 24)],
  ['Classroom 6', rect(55, 17, 64, 24)],
  ['Hall', rect(40, 24, 64, 40)],
]
const id = (name: string) => `r${ROOMS.findIndex(([n]) => n === name) + 1}`
const OLD = ROOMS.slice(0, 10).map(([n]) => id(n))
const NEW = ROOMS.slice(10).map(([n]) => id(n))

let plan: Plan = {
  ...newPlan(),
  blocks: [outline],
  storey_height_m: 3.2,
  rooms: ROOMS.map(([name, ring], i) => ({ id: `r${i + 1}`, name, ring, zone: `z${i + 1}` })),
  zones: ROOMS.map(([name], i) => ({ id: `z${i + 1}`, name, use: null, heating: null, cooling: null })),
  next: { room: ROOMS.length + 1, zone: ROOMS.length + 1, system: 1 },
}

// ─── Windows and doors (Shape) ───────────────────────────────────────────────────────────────────────────────────────
// Wall runs, anticlockwise: 0 south (t = x), 1 east (t = y), 2 north of the hall (t = 64 − x), 3 west of the extension
// (t = 40 − y), 4 north of the old wing (t = 40 − x), 5 west end (t = 10 − y).
const wins: Win[] = []
const W = (wall: number, t: number, w: number, h: number, sill: number, o: { door?: boolean; shade?: number } = {}) =>
  wins.push({ id: `w${wins.length + 1}`, wall, t_m: t, width_m: w, height_m: h, sill_m: sill, shading_m: o.shade ?? 0, ...(o.door ? { door: true } : {}) })
// South: the entrance's glazed screen, office, five classrooms (three windows each), staff room, WCs (high, small).
W(0, 0.6, 1.8, 2.1, 0.05); W(0, 3.2, 2.0, 1.5, 0.8)
W(0, 7.0, 1.6, 1.5, 0.8); W(0, 9.4, 1.6, 1.5, 0.8)
for (let k = 0; k < 5; k++) for (const dx of [0.7, 3.1, 5.5]) W(0, 12 + 8 * k + dx, 1.8, 1.5, 0.8)
W(0, 52.8, 1.6, 1.5, 0.8); W(0, 55.6, 1.6, 1.5, 0.8)
W(0, 59.0, 1.2, 0.6, 1.8); W(0, 61.8, 1.2, 0.6, 1.8)
// East: old corridor's fire door, ICT suite, classroom 6, hall (high windows and a fire door).
W(1, 7.8, 1.0, 2.1, 0, { door: true })
W(1, 10.8, 2.2, 1.5, 0.8, { shade: 0.6 }); W(1, 13.8, 2.2, 1.5, 0.8, { shade: 0.6 })
W(1, 17.8, 2.4, 1.5, 0.8, { shade: 0.6 }); W(1, 20.9, 2.4, 1.5, 0.8, { shade: 0.6 })
W(1, 25.0, 3.0, 1.0, 2.0); W(1, 30.0, 1.8, 2.1, 0, { door: true }); W(1, 34.0, 3.0, 1.0, 2.0)
// North of the hall: four high windows.
for (const t of [1.5, 7.5, 13.5, 19.5]) W(2, t, 3.0, 1.0, 2.0)
// West of the extension: hall (high windows, a fire door), store door, kitchen windows and its delivery door.
W(3, 1.5, 3.0, 1.0, 2.0); W(3, 6.6, 1.8, 2.1, 0, { door: true }); W(3, 11.0, 3.0, 1.0, 2.0)
W(3, 17.5, 1.0, 2.1, 0, { door: true })
W(3, 21.0, 1.5, 1.2, 1.0); W(3, 24.5, 1.5, 1.2, 1.0); W(3, 28.0, 1.0, 2.1, 0, { door: true })
// North of the old wing: the old corridor's original single-glazed windows, the office and reception.
for (let k = 0; k < 7; k++) W(4, 1.5 + 4 * k, 1.2, 1.2, 1.0)
W(4, 29.5, 1.6, 1.2, 0.9); W(4, 35.5, 1.6, 1.2, 0.9)
// West end: reception, and the original front door.
W(5, 1.2, 1.0, 2.1, 0, { door: true }); W(5, 5.5, 1.6, 1.2, 0.9)
plan = { ...plan, windows: wins }

// ─── Fabric: construction sets by room (Fabric's Apply), then the old corridor's single glazing ─────────────────
plan = applySet(plan, setById('set_1960s')!, OLD)
plan = applySet(plan, setById('set_standard_hard')!, NEW)
const typeOf = (set: string, el: FabricType['element']) => plan.fabric_types.find((t) => t.template === set && t.element === el)!.id
const editType = (tid: string, q: Partial<FabricType>) => { plan = { ...plan, fabric_types: plan.fabric_types.map((t) => (t.id === tid ? { ...t, ...q } : t)) } }
// The old wing's windows open: top-hung, a third of the glass, to 30°. The extension's are side-hung with trickle vents.
editType(typeOf('set_1960s', 'glazing'), { opening: { style: 'top_hung', openable_fraction: 0.3, opening_angle_deg: 30, cd: 0.6 } })
editType(typeOf('set_standard_hard', 'glazing'), { opening: { style: 'side_hung', openable_fraction: 0.25, opening_angle_deg: 45, cd: 0.6 }, trickle: { area_mm2: 5000, cd: 0.6, flow_mode: 'single_sided' } })
// ISO 13370 for the whole floor (A 1,360 m², exposed perimeter 208 m, B' 13.1 m, clay λ 2.0, w 0.3 m): an
// uninsulated slab is about 0.33 W/m²K. The run's ground is the year's mean outdoor temperature with no soil, so the
// slab's layers alone would give 2.0; the U is typed on the type (Fabric) and says so.
editType(typeOf('set_1960s', 'floor'), { name: '1960s school, as built: ground floors (U typed, ISO 13370)', u: 0.33 })
// The corridor's original windows: single glazing in steel frames, a type of its own on those windows only.
plan = { ...plan, fabric_types: [...plan.fabric_types, { id: 'f_glazing_single', element: 'glazing', name: 'Original single glazing (steel frames)', construction: 'glazing_single_metal', u: null }] }
plan = setTypeOn(plan, [{ run: 4, t0: 0, t1: 28 }], 'f_glazing_single')
// The ICT suite and classroom 6 are cooled, so their windows are fixed: the extension's glazing with no opening part.
plan = { ...plan, fabric_types: [...plan.fabric_types, { id: 'f_glazing_fixed', element: 'glazing', name: 'Double low-e, fixed lights (cooled rooms)', construction: 'double_low_e', u: null, trickle: { area_mm2: 5000, cd: 0.6, flow_mode: 'single_sided' } }] }
plan = setTypeOn(plan, [{ run: 1, t0: 10, t1: 24 }], 'f_glazing_fixed')
// The loft's slopes: tiles and felt, no insulation.
plan = { ...plan, fabric_types: [...plan.fabric_types, { id: 'f_roof_loft', element: 'roof', name: 'Loft slopes: tiles and felt', construction: 'pitched_roof_uninsulated', u: null }] }
plan = { ...plan, fabric_types: plan.fabric_types.map((t) => (t.element === 'partition' ? { ...t, name: 'Block partition', construction: 'interior_wall_block_plastered' } : t)) }

// ─── Roof (Shape, Roof): two wings, a 30° gable with a cold loft over the original, a 5° mono-pitch warm roof over
// the extension, its high side to the east. ─────────────────────────────────────────────────────────────────────────
const [oldRing, newRing] = splitAtCorner(outline, 0)!
plan = {
  ...plan,
  roof: { style: 'flat' },
  roof_parts: [
    { id: 'rp1', name: 'Original wing', ring: oldRing, recipe: { style: 'gable', pitch_deg: 30, ridge_axis: 'longest', insulation: 'ceiling', loft_slope_type: 'f_roof_loft', loft_ach: null } },
    { id: 'rp2', name: 'Extension', ring: newRing, recipe: { style: 'mono', pitch_deg: 5, high_side: 'E', insulation: 'slope' } },
  ],
}

// ─── Building (Fabric, Air leakage; Site) ─────────────────────────────────────────────────────────────────────────
plan = {
  ...plan,
  building: {
    ...plan.building!,
    // One q50 for the building: the old wing leaky (about 15), the extension tested at 5.
    q50: 10, tb_multiplier: 1.5, exposure: 'normal', terrain: 'suburban',
    design_outdoor: 'heating_99_6', warm_up_w_per_m2: null,
  },
}

// ─── Profiles: the school's library profiles (drafts), and the hall's own heating with evening lets ─────────────
const hours = (from: number, to: number, on: number, off: number) => Array.from({ length: 24 }, (_, h) => (h >= from && h < to ? on : off))
const hallHeat: OwnProfile = {
  key: 'own_1', name: 'Hall heating, with evening lets', schedule_type: 'heating_setpoint', from: 'school_heating_setpoint',
  day_types: { weekday: hours(6, 21, 18, 12), saturday: hours(8, 13, 18, 12), sunday: Array(24).fill(12) }, monthly_multipliers: null,
}
const serverCool: OwnProfile = {
  key: 'own_2', name: 'Server room, 24 °C all the time', schedule_type: 'cooling_setpoint', from: null,
  day_types: { weekday: Array(24).fill(24), saturday: Array(24).fill(24), sunday: Array(24).fill(24) }, monthly_multipliers: null,
}
const serverLoad: OwnProfile = {
  key: 'own_3', name: 'Server load, all the time', schedule_type: 'equipment', from: null,
  day_types: { weekday: Array(24).fill(1), saturday: Array(24).fill(1), sunday: Array(24).fill(1) }, monthly_multipliers: null,
}
plan = {
  ...plan,
  own_profiles: [hallHeat, serverCool, serverLoad],
  profiles: ['school_classroom_occupancy', 'school_hall_occupancy', 'school_kitchen_occupancy', 'school_office_occupancy', 'school_corridor_occupancy', 'school_lighting', 'school_heating_setpoint', 'school_cooling_setpoint', 'school_ventilation_day'],
}

// ─── Spaces: the School use on every room (Spaces' Apply), then each room its kind ──────────────────────────────
const todaysGains = (): Partial<SpaceType> => ({
  occupancy_rate: TODAY.occupancy_rate, sensible_w_per_person: TODAY.sensible_w_per_person, equipment_baseload_w_per_m2: 0,
  radiant_fraction: TODAY.gains_radiant_fraction, light_area_share: TODAY.area_share, light_gain_fraction: TODAY.gain_fraction,
  light_relationship: TODAY.lighting_relationship, daylight_factor: TODAY.daylight_factor, equip_area_share: TODAY.area_share,
  equip_gain_fraction: TODAY.gain_fraction, equip_relationship: TODAY.equipment_relationship, standby_factor: TODAY.standby_factor,
})
plan = applyUse(plan, useById('use_school')!, plan.rooms.map((r) => r.id), todaysGains)
const sp = (borrowed: string) => plan.spaces.find((s) => s.borrowed === borrowed)!.id
const editSpace = (sid: string, q: Partial<SpaceType>) => { plan = { ...plan, spaces: plan.spaces.map((s) => (s.id === sid ? { ...s, ...q } : s)) } }
// Further kinds of room, each made from a school one and changed (as "New space type" from a copy would).
const copySpace = (from: string, nid: string, q: Partial<SpaceType>) => { plan = { ...plan, spaces: [...plan.spaces, { ...plan.spaces.find((s) => s.id === from)!, id: nid, ...q }] } }
const CL = sp('school_classroom'), HALL = sp('school_hall'), KIT = sp('school_kitchen'), OFF = sp('school_office'), COR = sp('school_corridor')
const WINDOWS_23 = { rule: 'temperature' as const, open_above_c: 23, open_fraction: 0.5, hours: 'school_ventilation_day', controller: 'manual' as const }
editSpace(CL, { people_per_m2: 0.5, lux: 300, hot_water_basis: 'per_person', hot_water_litres: 1.5, cool_c: null, heat_profile: 'school_heating_setpoint', windows: WINDOWS_23 })
editSpace(HALL, { windows: WINDOWS_23, equipment_w_per_m2: 2, equipment_baseload_w_per_m2: 0.5, people_per_m2: 0.6, lux: 300, hot_water_basis: null, hot_water_litres: null, cool_c: null, heat_profile: 'own_1', floor_finish: 'hard', ceiling: 'exposed' })
editSpace(KIT, { windows: { ...WINDOWS_23, open_above_c: 24 }, equip_relationship: 'proportional', people_per_m2: 0.1, lux: 500, hot_water_basis: 'per_m2', hot_water_litres: 8, cool_c: null, heat_profile: 'school_heating_setpoint', heat_c: 18 })
editSpace(OFF, { people_per_m2: 0.1, lux: 300, hot_water_basis: 'per_person', hot_water_litres: 3, cool_c: null, heat_profile: 'school_heating_setpoint', windows: WINDOWS_23 })
editSpace(COR, { windows: WINDOWS_23, equipment_w_per_m2: 0, equipment_baseload_w_per_m2: 0, people_per_m2: 0.1, lux: 100, hot_water_basis: null, hot_water_litres: null, cool_c: null, heat_profile: 'school_heating_setpoint' })
copySpace(CL, 's_ict', { name: 'ICT suite', borrowed: 'school_classroom', people_per_m2: 0.35, equipment_w_per_m2: 15, equipment_baseload_w_per_m2: 3, cool_c: 25, cool_profile: 'school_cooling_setpoint', windows: null })
copySpace(CL, 's_cl_cooled', { name: 'Classroom (cooled)', windows: null, cool_c: 25, cool_profile: 'school_cooling_setpoint' })
copySpace(COR, 's_wc', { name: 'WCs', lux: 200, people_per_m2: 0.05, hot_water_basis: 'per_m2', hot_water_litres: 4, heat_c: 18, heat_profile: null, heat_hours: 'school_ventilation_day', setback_c: 12 })
copySpace(COR, 's_server', {
  name: 'Comms room', borrowed: null, use: 'other', occupancy: null, people_per_m2: null, lux: 200, light_relationship: 'independent', equipment: 'own_3',
  equipment_w_per_m2: 50, equipment_baseload_w_per_m2: 50, equip_relationship: 'independent', heat_c: null, heat_profile: null, cool_c: 24, cool_profile: 'own_2',
})
// A room nothing heats cannot be drawn yet (only a loft floats), so the store and plant room is kept at 10 °C by a
// frost-protection panel heater, as plant rooms often are.
copySpace(COR, 's_store', { name: 'Store and plant', borrowed: null, use: 'other', occupancy: null, people_per_m2: null, lux: 100, light_relationship: 'independent', heat_c: 10, heat_profile: null, equipment_w_per_m2: null, equipment_baseload_w_per_m2: null })
const SPACE_OF: Record<string, string> = {
  'Entrance and reception': COR, 'School office and head': OFF, 'Staff room': OFF, 'Pupil WCs': 's_wc', 'Corridor (original)': COR,
  Kitchen: KIT, 'Store and plant': 's_store', 'Link corridor': COR, 'ICT suite': 's_ict', 'Server room': 's_server', 'Classroom 6': 's_cl_cooled', Hall: HALL,
}
plan = { ...plan, rooms: plan.rooms.map((r) => (SPACE_OF[r.name] ? { ...r, space: SPACE_OF[r.name] } : r)) }

// ─── Systems ──────────────────────────────────────────────────────────────────────────────────────────────────────
const systems: PlanSystem[] = [
  { id: 'y1', service: 'heating', name: 'Gas boiler 1 (original wing, 1998)', template: 'gas_boiler_heating', design_flow_c: 80, design_return_c: 70, capacity_kw: 120, dhw_first: 'y7' },
  { id: 'y2', service: 'heating', name: 'Gas boiler 2 (extension, 2012)', template: 'gas_boiler_heating', design_flow_c: 70, design_return_c: 50, capacity_kw: 90, dhw_first: 'y8' },
  { id: 'y3', service: 'heating', name: 'VRF heating (ICT suite and classroom 6)', template: 'vrf_heating', capacity_kw: 28 },
  { id: 'y4', service: 'cooling', name: 'VRF cooling (ICT suite, classroom 6, server room)', template: 'vrf_cooling', capacity_kw: 28 },
  { id: 'y5', service: 'ventilation', name: 'MVHR (hall)', template: 'mvhr_standard', flow: 1.5, schedule: 'school_ventilation_day', runs: 'schedule' },
  { id: 'y6', service: 'ventilation', name: 'MVHR (ICT suite and classroom 6)', template: 'mvhr_standard', flow: 2.5, schedule: 'school_ventilation_day', runs: 'schedule' },
  { id: 'y7', service: 'dhw', name: 'Hot water cylinder (boiler 1)', template: 'gas_boiler_dhw' },
  { id: 'y8', service: 'dhw', name: 'Kitchen hot water (boiler 2)', template: 'gas_boiler_dhw' },
  { id: 'y9', service: 'ventilation', name: 'Kitchen extract', template: 'mev_standard', flow: 4, schedule: 'school_ventilation_day', runs: 'schedule' },
  { id: 'y10', service: 'ventilation', name: 'WC extract', template: 'mev_standard', flow: 3, schedule: 'school_ventilation_day', runs: 'schedule' },
  { id: 'y11', service: 'lighting', name: 'T8 fluorescent (original wing)', template: null, efficacy: 3.5 },
  { id: 'y12', service: 'lighting', name: 'LED (extension)', template: null, efficacy: 1.8 },
  { id: 'y13', service: 'heating', name: 'Frost protection panel heater', template: 'electric_panel_heating', capacity_kw: 2 },
]
const emitter_types: EmitterType[] = [
  { id: 'et1', name: 'Steel panel radiator K2 600×1800 (original)', kind: 'radiator', rated_output_w: 3020, radiant_fraction: 0.3, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.3 },
  { id: 'et2', name: 'Radiator K2 600×1400 (extension)', kind: 'radiator', rated_output_w: 2350, radiant_fraction: 0.3, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.33 },
  { id: 'et3', name: 'VRF cassette 5.6 kW', kind: 'vrf_indoor', rated_output_w: 6300, radiant_fraction: 0, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null, heats: true, cooling_output_w: 4300 },
  { id: 'et5', name: 'Panel heater 2 kW', kind: 'electric', rated_output_w: 2000, radiant_fraction: 0.2, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null },
  { id: 'et4', name: 'VRF wall unit 3.6 kW (cooling only)', kind: 'vrf_indoor', rated_output_w: null, radiant_fraction: 0, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null, heats: false, cooling_output_w: 3200 },
]
const LT_OLD = 'y11', LT_NEW = 'y12'
const ROOM_SYS: Record<string, { heating?: string; cooling?: string; ventilation?: string; dhw?: string; emitters?: Array<[string, number]> }> = {
  'Entrance and reception': { heating: 'y1', dhw: 'y7', emitters: [['et1', 3]] },
  'School office and head': { heating: 'y1', dhw: 'y7', emitters: [['et1', 2]] },
  'Classroom 1': { heating: 'y1', dhw: 'y7', emitters: [['et1', 3]] },
  'Classroom 2': { heating: 'y1', dhw: 'y7', emitters: [['et1', 3]] },
  'Classroom 3': { heating: 'y1', dhw: 'y7', emitters: [['et1', 3]] },
  'Classroom 4': { heating: 'y1', dhw: 'y7', emitters: [['et1', 3]] },
  'Classroom 5': { heating: 'y1', dhw: 'y7', emitters: [['et1', 3]] },
  'Staff room': { heating: 'y1', dhw: 'y7', emitters: [['et1', 2]] },
  'Pupil WCs': { heating: 'y1', dhw: 'y7', ventilation: 'y10', emitters: [['et1', 2]] },
  'Corridor (original)': { heating: 'y1', emitters: [['et1', 4]] },
  Kitchen: { heating: 'y2', dhw: 'y8', ventilation: 'y9', emitters: [['et2', 4]] },
  'Store and plant': { heating: 'y13', emitters: [['et5', 1]] },
  'Link corridor': { heating: 'y2', emitters: [['et2', 2]] },
  'ICT suite': { dhw: 'y8', heating: 'y3', cooling: 'y4', ventilation: 'y6', emitters: [['et3', 2]] },
  'Server room': { cooling: 'y4', emitters: [['et4', 3]] },
  'Classroom 6': { dhw: 'y8', heating: 'y3', cooling: 'y4', ventilation: 'y6', emitters: [['et3', 2]] },
  Hall: { heating: 'y2', ventilation: 'y5', emitters: [['et2', 10]] },
}
plan = {
  ...plan,
  systems,
  emitter_types,
  rooms: plan.rooms.map((r) => {
    const s = ROOM_SYS[r.name]!
    const sys: NonNullable<typeof r.systems> = { lighting: OLD.includes(r.id) ? LT_OLD : LT_NEW }
    for (const k of ['heating', 'cooling', 'ventilation', 'dhw'] as const) if (s[k]) sys[k] = s[k]
    return { ...r, systems: sys, ...(s.emitters ? { emitters: s.emitters.map(([type, count]) => ({ type, count })) } : {}) }
  }),
  dhw: { storage_c: 60, tap_c: 43, cold_c: 10, basis: null, litres: null, pump_w: 60, shape: 'follow_occupancy' },
  other_loads: [{ id: 'ol1', kind: 'external_lighting', name: 'External lighting (car park and paths)', power_w: 1200, runs: 'dusk_to_dawn', schedule: null }],
  next: { room: ROOMS.length + 1, zone: ROOMS.length + 1, system: systems.length + 1 },
}

// ─── Controls: who runs what (recorded), and the pumps from "Use defaults" ─────────────────────────────────────────
const controls: PlanControl[] = [
  { kind: 'system', ref: 'y1', controller: 'time_clock', note: 'Old boiler on a seven-day time clock, set by the caretaker' },
  { kind: 'system', ref: 'y2', controller: 'central_bms', note: null },
  { kind: 'system', ref: 'y3', controller: 'local', note: 'VRF wall controllers in each room' },
  { kind: 'system', ref: 'y4', controller: 'local', note: null },
  { kind: 'ventilation', ref: 'y5', controller: 'central_bms', note: null },
  { kind: 'ventilation', ref: 'y6', controller: 'central_bms', note: null },
  { kind: 'ventilation', ref: 'y9', controller: 'time_clock', note: null },
  { kind: 'ventilation', ref: 'y10', controller: 'time_clock', note: null },
  { kind: 'lighting', ref: 'y11', controller: 'manual', note: null },
  { kind: 'lighting', ref: 'y12', controller: 'photocell', note: 'Daylight dimming and absence detection (recorded only)' },
]
plan = { ...plan, controls }
plan = upgradePlan(plan)
const first = buildDocument(plan)
if (!first.ok) throw new Error(JSON.stringify(first.issues, null, 1))
for (const x of plan.systems.filter((s) => s.service === 'heating' || s.service === 'cooling')) {
  const d = defaultPumps(first.doc as Parameters<typeof defaultPumps>[0], `${x.service}_${x.id}`)
  if (!d) continue
  const [basis, value] = Object.entries(d.power)[0] as [NonNullable<PlanSystem['pumps']>['basis'], number]
  plan = { ...plan, systems: plan.systems.map((s) => (s.id === x.id ? { ...s, pumps: { basis, value, speed: d.speed, runs: d.runs, schedule: d.schedule_ref ?? null, default_from: d.default_from } } : s)) }
}

const built = buildDocument(plan)
if (!built.ok) throw new Error(JSON.stringify(built.issues, null, 1))
const note = 'Worked example 2 (17 Nov 2026): an extended UK primary school, L-shaped, one storey: a 1965 wing and a 2012 extension, 17 rooms in 17 zones, drawn with the editor\'s own plan shape. Every typed value is an example input chosen for the demonstration, not a real building. Made by scripts/example_school_plan.mts. Load with window.sim2.loadPlan(fixture.plan).'
writeFileSync(path.join(root, 'docs/examples/extended_school.plan.json'), JSON.stringify({ _note: note, plan }, null, 1) + '\n')
console.log('rooms', plan.rooms.length, 'windows', plan.windows.length, 'types', plan.fabric_types.length, 'pumps', plan.systems.filter((s) => s.pumps).map((s) => `${s.id}:${s.pumps!.value}${s.pumps!.basis}`).join(' '))
console.log('notes:', (built as any).notes)
