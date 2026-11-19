/**
 * Royal Wimbledon Golf Club clubhouse (18 Nov 2026, Linzie: "build the RWGC clubhouse in NZA Sim, as close as we can
 * get"). A real building, three floors, made with the editor's own functions as the school example was, and stacked
 * with Plan.floors. Writes docs/examples/rwgc_clubhouse.plan.json.
 *
 * Sources (NZA project 24022, SharePoint "24022 - RWGC"):
 *   Geometry   SolidPoint's measured survey, Revit "1706 - Royal Wimbledon Golf Club_Rvt23_rev2", converted to IFC/GLB.
 *              Its rooms rasterised to tile each floor and its windows, doors and curtain-wall glass placed on the
 *              outside walls: docs/examples/rwgc_clubhouse.geometry.json (origin at the building's south-west corner,
 *              Revit +y taken as north).
 *   Fabric     CA-1000 Energy Calcs, "U Values" and "Building Inputs": five construction blocks, their U-values and
 *              infiltration (Atkins fabric survey for glazing), as in the Energy Strategy (RP-1000 P01.1, §3.2).
 *   Systems    Energy Strategy §4: four Ideal Concord Super 200V (≈50 kW each, 85 %) on an LTHW circuit, six BMS
 *              heating zones, fan convectors on the CT circuit, Beaumont 250 water heater (146 kW, 768 L, ≈80 %),
 *              two combi boilers (caretaker's flat, Block 5), DX splits in offices and cellular rooms, extract to
 *              WCs, changing and kitchen, Trend IQ BMS. Emitters from CA-1000 "XX-Rad Schedule" (outputs at ΔT50).
 *              Which rooms have what: the heating strategy sketch SK-1000 P01 (existing: radiators, fan convectors,
 *              DX and radiators, extract only, unconditioned).
 *   Hours      RFI dump 2026-10-05 "Opening hours.xlsx" (kitchen, bar by season, office, pro shop).
 *   Check      2025 meters: clubhouse gas 330,648 kWh (British Gas), electricity 212,360 kWh (half-hourly).
 * Every figure the sources do not give is an assumption, listed in docs/examples/rwgc_clubhouse.assumptions.md.
 *
 * Run from frontend/:  npx vite-node ../scripts/example_rwgc_plan.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chainAt } from '../frontend/src/sim2/geometry/curves'
import { setTypeOnRooms } from '../frontend/src/sim2/geometry/facade'
import { type EmitterType, type FabricType, type OwnProfile, type Plan, type PlanControl, type PlanRoom, type PlanSystem, type PlanZone, type SpaceType, type Win, FLOOR_NAMES, floorsOf, newPlan, onFloor, upgradePlan } from '../frontend/src/sim2/geometry/plan'
import type { RoofRecipe } from '../frontend/src/sim2/geometry/roof'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { defaultPumps } from '../frontend/src/thermal/catalogue/auxiliaryDefaults'
import { TODAY } from '../frontend/src/thermal/schema/upgrade'

const root = path.resolve(__dirname, '..')
type XY = [number, number]
type GRoom = { number: string; name: string; ring: XY[]; area: number }
type GWin = { cat: 'Windows' | 'Doors' | 'Curtain Panels'; block: number; side: number; t_m: number; width_m: number; sill_m: number; height_m: number; dist: number }
type GFloor = { key: string; name: string; blocks: XY[][]; rooms: GRoom[]; windows: GWin[] }
const geo = JSON.parse(readFileSync(path.join(root, 'docs/examples/rwgc_clubhouse.geometry.json'), 'utf8')) as { floors: GFloor[] }
// The survey's roofs (Linzie 18 Nov 22:59: "see the whole building in 3D with all the roof shapes"): each Revit roof as
// a rectangle (its smallest enclosing one) with its style, pitch and ridge read from its slopes, on the floor whose top
// its eaves sit at (eaves below 56.9 m AOD the ground floor's, below 59.4 m the first floor's, above the second's).
// Dormers, flat bits and roofs drawn twice are left out. Made from the GLB by the same extraction as the rooms.
type GRoofPart = { id: string; name: string; ring: XY[]; recipe: RoofRecipe }
const roofsByFloor = JSON.parse(readFileSync(path.join(root, 'docs/examples/rwgc_clubhouse.roofs.json'), 'utf8')) as Record<string, GRoofPart[]>

const H = 3.0 // one storey height for every floor (floors are stacked this far apart)

// ─── Zones: the survey's rooms grouped by use, heating zone and construction block ─────────────────────────────────
// [zone name, block (1–5), room numbers]. Block from CA-1000: 1 the original c.1880s west wing (and its first and second
// floors), 2 Lounge 3 (tall, single glazed, early cavity), 3 the 1960s–90s dining suite and kitchen (and the first floor
// over it), 4 the c.2000s stores to the north-east, 5 the pro shop (and the simulator over it).
const ZONES: Array<[string, number, string[]]> = [
  // Ground floor
  ['Lounge 1', 1, ['388']],
  ['Lounge 2 (bay)', 1, ['389']],
  ['Entrance, cloakroom and stair', 1, ['391', '392', '455', '393', '390', '457']],
  ['Toilets (west)', 1, ['394']],
  ['Back of house (west, unheated)', 1, ['400', '401', '419', '406']],
  ['Lounge 3 (fan convectors)', 2, ['387']],
  ['Bar and bar store', 3, ['402', '411', '412', '414']],
  ['Main dining room', 3, ['385']],
  ['Dining room (double height)', 3, ['386']],
  ['East dining room (DX)', 3, ['374']],
  ['Corridor and lobby (south)', 3, ['377', '378', '382', '383', '384', '376']],
  ['Kitchen', 3, ['403', '404', '405', '407', '408', '409', '410']],
  ["Ladies' changing and toilets", 3, ['379', '381', '375', '459']],
  ["Ladies' lounge", 3, ['380']],
  ['Plant room and stores (unheated)', 3, ['370', '369', '368', '371', '372', '373']],
  ['Staff room and changing', 4, ['363', '364', '365']],
  ['Equipment store (unheated)', 4, ['362', '367']],
  ['Pro shop', 5, ['418', '415', '467']],
  ['Pro shop office (DX)', 5, ['416']],
  // First floor
  ["Men's changing room", 1, ['440']],
  ["Men's changing (bay)", 1, ['441']],
  ['Showers', 1, ['446', '469']],
  ['Office (DX)', 3, ['438', '439', '443']],
  ['First floor corridor', 3, ['437']],
  ["Caretaker's flat", 3, ['429', '430', '431', '432', '433', '434', '435', '436']],
  ['Golf simulator (DX)', 5, ['450', '452']],
  ['Pro shop lounge', 5, ['451']],
  // Second floor
  ['Trophy room', 1, ['425', '427']],
  ['Roof stores', 1, ['421', '422', '423', '424']],
]
const zoneOfNumber = new Map<string, number>()
ZONES.forEach(([, , ns], i) => ns.forEach((n) => zoneOfNumber.set(n, i)))
const zid = (name: string) => `z${ZONES.findIndex(([n]) => n === name) + 1}`

// ─── Fabric: one type per block per element, the U typed from CA-1000 on the nearest library construction ─────────
const BLOCK = [
  null,
  { name: 'Block 1 (c.1880s, original)', wall: 1.7, glz: 4.0, roof: 0.8, floor: 0.7, wallKey: 'cavity_wall_unfilled_1960s', glzKey: 'glazing_single_metal', roofKey: 'loft_ceiling_100mm', floorKey: 'ground_floor_uninsulated', wallWhat: 'solid masonry, no insulation', glzWhat: 'single-glazed timber sashes', roofWhat: 'pitched clay tile, little or no loft insulation', floorWhat: 'suspended timber over a vented void' },
  { name: 'Block 2 (c.1910–30, Lounge 3)', wall: 1.6, glz: 4.0, roof: 0.8, floor: 0.7, wallKey: 'cavity_wall_unfilled_1960s', glzKey: 'glazing_single_metal', roofKey: 'loft_ceiling_100mm', floorKey: 'ground_floor_uninsulated', wallWhat: 'early cavity, uninsulated, tile-hung gables', glzWhat: 'single glazing', roofWhat: 'pitched clay tile, little or no loft insulation', floorWhat: 'suspended timber over a vented void' },
  { name: 'Block 3 (c.1960s–90s, dining and kitchen)', wall: 0.6, glz: 2.8, roof: 0.35, floor: 0.35, wallKey: 'cavity_wall_unfilled_1960s', glzKey: 'glazing_double_1990s', roofKey: 'flat_roof_standard', floorKey: 'ground_floor_uninsulated', wallWhat: 'cavity with partial-fill insulation', glzWhat: 'early double glazing (6 mm gap)', roofWhat: 'flat or shallow pitch, 100–125 mm insulation', floorWhat: 'concrete slab, no insulation' },
  { name: 'Block 4 (c.2000s, stores)', wall: 0.4, glz: 2.0, roof: 0.22, floor: 0.25, wallKey: 'cavity_wall_standard', glzKey: 'double_low_e', roofKey: 'pitched_roof_standard', floorKey: 'ground_floor_slab_hard', wallWhat: 'insulated cavity', glzWhat: 'modern double glazing', roofWhat: 'trussed slate roof, 150–200 mm insulation', floorWhat: 'concrete slab with 75–100 mm insulation' },
  { name: 'Block 5 (c.1960, pro shop)', wall: 1.4, glz: 2.8, roof: 0.8, floor: 0.7, wallKey: 'cavity_wall_unfilled_1960s', glzKey: 'glazing_double_1990s', roofKey: 'loft_ceiling_100mm', floorKey: 'ground_floor_uninsulated', wallWhat: 'solid brick or early uninsulated cavity', glzWhat: 'single glazing with some double glazing (2.8 taken)', roofWhat: 'pitched slate/tile, minimal insulation', floorWhat: 'suspended timber over a vented void' },
]
const fabric: FabricType[] = [
  { id: 'f_door', element: 'door', name: 'External doors', construction: 'timber_door_solid', u: null },
  { id: 'f_partition', element: 'partition', name: 'Internal walls', construction: 'interior_wall_block_plastered', u: null },
  { id: 'f_intermediate', element: 'intermediate', name: 'Floors between storeys', construction: 'interior_floor_ceiling', u: null },
]
for (let b = 1; b <= 5; b++) {
  const B = BLOCK[b]!
  fabric.push(
    { id: `f_wall_b${b}`, element: 'wall', name: `${B.name}: walls, ${B.wallWhat} (U ${B.wall} typed)`, construction: B.wallKey, u: B.wall },
    { id: `f_glazing_b${b}`, element: 'glazing', name: `${B.name}: windows, ${B.glzWhat} (U ${B.glz} typed)`, construction: B.glzKey, u: B.glz },
    { id: `f_roof_b${b}`, element: 'roof', name: `${B.name}: roof, ${B.roofWhat} (U ${B.roof} typed)`, construction: B.roofKey, u: B.roof },
    { id: `f_floor_b${b}`, element: 'floor', name: `${B.name}: ground floor, ${B.floorWhat} (U ${B.floor} typed)`, construction: B.floorKey, u: B.floor },
  )
}
// The first type of each element is its default: Block 3's (the most floor).
const order = (e: string) => ['wall', 'glazing', 'door', 'roof', 'floor', 'partition', 'intermediate'].indexOf(e)
fabric.sort((a, b) => order(a.element) - order(b.element) || (a.id.endsWith('b3') ? -1 : b.id.endsWith('b3') ? 1 : 0))

// ─── Floors: outline, rooms (in their zones), windows and doors, then each block's fabric on its rooms ─────────────
let plan: Plan = { ...newPlan(), storey_height_m: H, fabric_types: fabric, zones: ZONES.map(([name], i) => ({ id: `z${i + 1}`, name, use: null, heating: null, cooling: null }) as PlanZone) }
let nRoom = 0, nWin = 0
const roomByNumber = new Map<string, string>()
const blockOfRoom = new Map<string, number>()
const dropped: string[] = []
geo.floors.forEach((f, k) => {
  plan = onFloor(plan, k)
  const rooms: PlanRoom[] = f.rooms.map((r) => {
    const zi = zoneOfNumber.get(r.number)
    if (zi == null) throw new Error(`room ${r.number} ${r.name} has no zone`)
    const id = `r${++nRoom}`
    roomByNumber.set(r.number, id)
    blockOfRoom.set(id, ZONES[zi]![1])
    return { id, name: `${r.name} (${r.number})`, ring: r.ring, zone: `z${zi + 1}` }
  })
  // A run's index counts through the blocks in order.
  const first = f.blocks.map((_, i) => f.blocks.slice(0, i).reduce((t, b) => t + b.length, 0))
  const runLen = (b: number, s: number) => { const r = f.blocks[b]!, a = r[s]!, c = r[(s + 1) % r.length]!; return Math.hypot(c[0] - a[0], c[1] - a[1]) }
  // Openings: on the outside wall (doors within 0.6 m and at least 0.5 m along it, so an inside door near the wall is
  // left out), clipped to the storey; where two overlap on a wall the larger stays.
  let ws = f.windows.filter((w) => w.width_m >= 0.5 && (w.cat !== 'Doors' || w.dist <= 0.6) && w.height_m > 0.3).map((w) => {
    const sill = Math.min(w.sill_m, H - 0.6)
    const door = w.cat === 'Doors'
    return { ...w, sill_m: door ? 0 : sill, height_m: Math.min(door ? 2.1 : w.height_m, H - 0.15 - (door ? 0 : sill)), door }
  })
  ws.sort((a, b) => b.width_m * b.height_m - a.width_m * a.height_m)
  const kept: typeof ws = []
  for (const w of ws) {
    const clash = kept.some((x) => x.block === w.block && x.side === w.side && Math.min(x.t_m + x.width_m, w.t_m + w.width_m) - Math.max(x.t_m, w.t_m) > 0.1)
    if (clash) { dropped.push(`${f.name}: ${w.cat} overlapping another on the same wall`); continue }
    kept.push(w)
  }
  // No wall more than 80 % glass (EnergyPlus needs a little wall round its windows): the heights come down to fit.
  for (const key of new Set(kept.map((w) => `${w.block}|${w.side}`))) {
    const on = kept.filter((w) => `${w.block}|${w.side}` === key)
    const [b, s] = key.split('|').map(Number) as [number, number]
    const glass = on.reduce((t, w) => t + w.width_m * w.height_m, 0)
    const cap = 0.8 * runLen(b, s) * H
    if (glass > cap) for (const w of on) w.height_m = Math.round(w.height_m * (cap / glass) * 1000) / 1000
  }
  ws = kept
  const windows: Win[] = ws.sort((a, b) => first[a.block]! + a.side - (first[b.block]! + b.side) || a.t_m - b.t_m).map((w) => ({
    id: `w${++nWin}`, wall: first[w.block]! + w.side, t_m: w.t_m, width_m: w.width_m, height_m: w.height_m, sill_m: w.sill_m, shading_m: 0, ...(w.door ? { door: true } : {}),
  }))
  // Its roof: the survey's roofs over it, insulated in the slope (the calcs' roof U-values are for the sloped areas),
  // and the rest flat.
  const roof_parts = (roofsByFloor[String(k)] ?? []).map((p) => ({ id: p.id, name: p.name, ring: p.ring, recipe: p.recipe }))
  // The two bays (Lounge 2 on the ground floor, the men's changing bay above it) are curved: drawn as curves in 3D,
  // modelled as their flat facets (Linzie 18 Nov 23:34).
  const BAY: XY = [-1.2, 23.5]
  const near = f.blocks[0]!.map((a, i) => { const b = f.blocks[0]![(i + 1) % f.blocks[0]!.length]!; return { i, d: Math.hypot((a[0] + b[0]) / 2 - BAY[0], (a[1] + b[1]) / 2 - BAY[1]) } }).sort((p, q) => p.d - q.d)[0]!
  const bay = near.d < 2 ? chainAt(f.blocks[0]!, near.i) : null
  plan = { ...plan, blocks: f.blocks, rooms, windows, wall_spans: [], roof: { style: 'flat' }, roof_parts, ...(bay ? { curves: [{ ...bay, block: 0 }] } : {}) }
  if (bay) console.log(`${f.name}: bay drawn as a curve, sides ${bay.from}–${bay.to}`)
  plan = { ...plan, floors: plan.floors!.map((x, i) => (i === k ? { ...x, name: FLOOR_NAMES[k]! } : x)) }
  for (let b = 1; b <= 5; b++) {
    const ids = rooms.filter((r) => blockOfRoom.get(r.id) === b).map((r) => r.id)
    if (!ids.length) continue
    for (const e of ['wall', 'glazing', 'roof', 'floor']) plan = setTypeOnRooms(plan, ids, `f_${e}_b${b}`)
  }
})

// ─── Profiles from the club's opening hours (RFI 2026-10-05), made the project's own ───────────────────────────────
const hrs = (from: number, to: number, on: number, off = 0) => Array.from({ length: 24 }, (_, h) => (h + 1 > from && h < to ? (h < from ? on * (h + 1 - from) : h + 1 > to ? on * (to - h) : on) : off))
const shape = (xs: Array<[number, number, number]>) => { const d = Array(24).fill(0); for (const [a, b, v] of xs) for (let h = a; h < b; h++) d[h] = v; return d }
const every = (d: number[]) => ({ weekday: d, saturday: d, sunday: d })
// Golf is busier in summer (an assumption; the club's covers or footfall would replace it).
const SEASON = [0.6, 0.65, 0.8, 0.95, 1.05, 1.15, 1.2, 1.15, 1.0, 0.85, 0.7, 0.75]
const own = (key: string, name: string, t: OwnProfile['schedule_type'], day_types: OwnProfile['day_types'], monthly: number[] | null = null): OwnProfile => ({ key, name, schedule_type: t, from: null, day_types, monthly_multipliers: monthly })
// Members' areas: open 07:30–18:00 every day, the bar until 19:30 (winter) to 22:30 (summer); 21:00 taken as the year's
// average close. Lunch is the busy time.
const members = shape([[7, 8, 0.15], [8, 11, 0.3], [11, 15, 0.8], [15, 18, 0.45], [18, 21, 0.4]])
const kitchen = shape([[6, 7, 0.5], [7, 16, 1]])
const office = shape([[7, 8, 0.5], [8, 17, 1], [17, 18, 0.5]])
const proShop = shape([[7, 18, 1]])
const changing = shape([[6, 8, 0.5], [8, 12, 0.9], [12, 16, 0.6], [16, 19, 0.5], [19, 20, 0.2]])
const flat = shape([[0, 7, 1], [7, 9, 0.5], [17, 24, 0.9]])
const allDay = Array(24).fill(1)
const PROFILES: OwnProfile[] = [
  own('rwgc_occ_members', 'RWGC members\' areas (07:30–21:00 daily, busy at lunch)', 'occupancy', every(members), SEASON),
  own('rwgc_occ_kitchen', 'RWGC kitchen (06:30–16:00 daily)', 'occupancy', every(kitchen)),
  own('rwgc_occ_office', 'RWGC office (weekdays 07:30–17:30)', 'occupancy', { weekday: office, saturday: Array(24).fill(0), sunday: Array(24).fill(0) }),
  own('rwgc_occ_proshop', 'RWGC pro shop (07:00–18:00 daily)', 'occupancy', every(proShop), SEASON),
  own('rwgc_occ_changing', 'RWGC changing rooms (06:30–20:00 daily)', 'occupancy', every(changing), SEASON),
  own('rwgc_occ_flat', "RWGC caretaker's flat (evenings and nights)", 'occupancy', every(flat)),
  own('rwgc_occ_occasional', 'RWGC stores and back of house (occasional, opening hours)', 'occupancy', every(shape([[7, 21, 0.1]]))),
  own('rwgc_always', 'RWGC all the time (refrigeration, cellar)', 'equipment', every(allDay)),
  // Heating: the BMS's times are not known; the clubhouse heated 06:00–21:00 every day to 21 °C (CA-1000 design), 16 °C
  // outside (CA-1000 set back).
  own('rwgc_heat_club', 'RWGC clubhouse heating, BMS (21 °C 06:00–21:00 daily, 16 °C set back)', 'heating_setpoint', every(shape([[0, 6, 16], [6, 21, 21], [21, 24, 16]]))),
  own('rwgc_heat_office', 'RWGC office heating (21 °C weekdays 07:00–18:00, 16 °C set back)', 'heating_setpoint', { weekday: shape([[0, 7, 16], [7, 18, 21], [18, 24, 16]]), saturday: Array(24).fill(16), sunday: Array(24).fill(16) }),
  own('rwgc_heat_flat', "RWGC caretaker's flat heating, combi (21 °C 06:30–09:00 and 16:00–23:00, 16 °C otherwise)", 'heating_setpoint', every(shape([[0, 6, 16], [6, 9, 21], [9, 16, 16], [16, 23, 21], [23, 24, 16]]))),
  own('rwgc_heat_proshop', 'RWGC pro shop heating, combi (20 °C 06:30–18:00 daily, 14 °C set back)', 'heating_setpoint', every(shape([[0, 6, 14], [6, 18, 20], [18, 24, 14]]))),
  own('rwgc_cool_dx', 'RWGC DX cooling (24 °C 07:00–21:00, off outside)', 'cooling_setpoint', every(shape([[0, 7, 35], [7, 21, 24], [21, 24, 35]]))),
  own('rwgc_vent_kitchen', 'RWGC kitchen extract (06:00–16:30)', 'ventilation', every(shape([[6, 17, 1]]))),
  own('rwgc_vent_club', 'RWGC toilet and changing extract (06:00–22:00)', 'ventilation', every(shape([[6, 22, 1]]))),
  own('rwgc_buggies', 'RWGC buggy charging (overnight 20:00–06:00)', 'ventilation', every(shape([[0, 6, 1], [20, 24, 1]]))),
]
plan = { ...plan, own_profiles: PROFILES, profiles: [] }

// ─── Space types: today's gains (as the school's) plus each kind of room's own figures ────────────────────────────
const gains = (): Partial<SpaceType> => ({
  occupancy_rate: TODAY.occupancy_rate, sensible_w_per_person: TODAY.sensible_w_per_person, radiant_fraction: TODAY.gains_radiant_fraction,
  light_area_share: TODAY.area_share, light_gain_fraction: TODAY.gain_fraction, light_relationship: TODAY.lighting_relationship, daylight_factor: TODAY.daylight_factor,
  equip_area_share: TODAY.area_share, equip_gain_fraction: TODAY.gain_fraction, equip_relationship: TODAY.equipment_relationship, standby_factor: TODAY.standby_factor,
})
const space = (id: string, name: string, use: string, occ: string | null, q: Partial<SpaceType>): SpaceType => ({ id, name, use, occupancy: occ, lighting: null, equipment: null, borrowed: null, ...gains(), ...q } as SpaceType)
const HEAT = { heat_profile: 'rwgc_heat_club' }
const SPACES: SpaceType[] = [
  space('s_lounge', 'Lounge and bar', 'public', 'rwgc_occ_members', { ...HEAT, people_per_m2: 0.3, lux: 200, equipment_w_per_m2: 3, equipment_baseload_w_per_m2: 1, floor_finish: 'carpet', ceiling: 'exposed' }),
  space('s_bar', 'Bar (with cellar cooling)', 'public', 'rwgc_occ_members', { ...HEAT, people_per_m2: 0.3, lux: 200, equipment_w_per_m2: 20, equipment_baseload_w_per_m2: 40, floor_finish: 'hard', ceiling: 'exposed' }),
  space('s_dining', 'Dining room', 'public', 'rwgc_occ_members', { ...HEAT, people_per_m2: 0.5, lux: 200, equipment_w_per_m2: 2, equipment_baseload_w_per_m2: 0.5, hot_water_basis: 'per_person', hot_water_litres: 6, floor_finish: 'carpet', ceiling: 'exposed' }),
  space('s_dining_dx', 'Dining room (DX cooled)', 'public', 'rwgc_occ_members', { ...HEAT, people_per_m2: 0.5, lux: 200, equipment_w_per_m2: 2, equipment_baseload_w_per_m2: 0.5, hot_water_basis: 'per_person', hot_water_litres: 6, cool_profile: 'rwgc_cool_dx', floor_finish: 'carpet', ceiling: 'exposed' }),
  space('s_circ', 'Entrance and corridors', 'public', 'rwgc_occ_members', { ...HEAT, people_per_m2: 0.05, lux: 150, equipment_w_per_m2: 0, equipment_baseload_w_per_m2: 0, floor_finish: 'hard', ceiling: 'exposed' }),
  space('s_wc', 'Toilets', 'public', 'rwgc_occ_members', { ...HEAT, people_per_m2: 0.1, lux: 150, equipment_w_per_m2: 0, equipment_baseload_w_per_m2: 0, hot_water_basis: 'per_m2', hot_water_litres: 5, floor_finish: 'hard', ceiling: 'exposed' }),
  space('s_changing', 'Changing rooms and showers', 'public', 'rwgc_occ_changing', { ...HEAT, people_per_m2: 0.2, lux: 150, equipment_w_per_m2: 2, equipment_baseload_w_per_m2: 0, hot_water_basis: 'per_person', hot_water_litres: 40, floor_finish: 'hard', ceiling: 'exposed' }),
  space('s_kitchen', 'Commercial kitchen', 'other', 'rwgc_occ_kitchen', { ...HEAT, people_per_m2: 0.1, lux: 500, equipment_w_per_m2: 100, equipment_baseload_w_per_m2: 12, equip_relationship: 'proportional', hot_water_basis: 'per_m2', hot_water_litres: 15, floor_finish: 'hard', ceiling: 'exposed', heat_c: 18 }),
  space('s_office', 'Office (DX cooled)', 'office', 'rwgc_occ_office', { heat_profile: 'rwgc_heat_office', cool_profile: 'rwgc_cool_dx', people_per_m2: 0.1, lux: 400, equipment_w_per_m2: 12, equipment_baseload_w_per_m2: 2, hot_water_basis: 'per_person', hot_water_litres: 5, floor_finish: 'carpet', ceiling: 'suspended' }),
  space('s_staff', 'Staff room', 'office', 'rwgc_occ_kitchen', { ...HEAT, people_per_m2: 0.1, lux: 300, equipment_w_per_m2: 8, equipment_baseload_w_per_m2: 1, hot_water_basis: 'per_person', hot_water_litres: 10, floor_finish: 'hard', ceiling: 'exposed' }),
  space('s_flat', "Caretaker's flat", 'bedroom', 'rwgc_occ_flat', { heat_profile: 'rwgc_heat_flat', people_basis: 'per_room', people_per_room: 2, lux: 150, equipment_w_per_m2: 4, equipment_baseload_w_per_m2: 1, hot_water_basis: 'per_person', hot_water_litres: 115, floor_finish: 'carpet', ceiling: 'exposed' }),
  space('s_shop', 'Pro shop', 'retail', 'rwgc_occ_proshop', { heat_profile: 'rwgc_heat_proshop', people_per_m2: 0.1, lux: 400, equipment_w_per_m2: 5, equipment_baseload_w_per_m2: 2, hot_water_basis: 'per_person', hot_water_litres: 3, floor_finish: 'carpet', ceiling: 'exposed' }),
  space('s_shop_dx', 'Pro shop office (DX cooled)', 'office', 'rwgc_occ_proshop', { heat_profile: 'rwgc_heat_proshop', cool_profile: 'rwgc_cool_dx', people_per_m2: 0.1, lux: 400, equipment_w_per_m2: 12, equipment_baseload_w_per_m2: 2, floor_finish: 'carpet', ceiling: 'exposed' }),
  space('s_sim', 'Golf simulator (DX cooled)', 'public', 'rwgc_occ_proshop', { heat_profile: 'rwgc_heat_proshop', cool_profile: 'rwgc_cool_dx', people_per_m2: 0.1, lux: 300, equipment_w_per_m2: 25, equipment_baseload_w_per_m2: 2, floor_finish: 'carpet', ceiling: 'exposed' }),
  space('s_trophy', 'Trophy room and roof stores', 'other', 'rwgc_occ_occasional', { ...HEAT, people_per_m2: 0.05, lux: 150, equipment_w_per_m2: 0, equipment_baseload_w_per_m2: 0, floor_finish: 'carpet', ceiling: 'exposed' }),
  // Unheated: NZA Sim runs a room only with a setpoint, so these are held above 5 °C (the BMS's frost protection),
  // which the rooms around them keep them well above; they have no emitters.
  space('s_unheated', 'Stores and plant (unheated, frost 5 °C)', 'other', 'rwgc_occ_occasional', { heat_c: 5, people_per_m2: 0.02, lux: 100, equipment_w_per_m2: 0, equipment_baseload_w_per_m2: 0, floor_finish: 'hard', ceiling: 'exposed' }),
  space('s_cold', 'Fridge and freezer rooms', 'other', 'rwgc_occ_kitchen', { ...HEAT, heat_c: 18, people_per_m2: 0.05, lux: 150, equipment: 'rwgc_always', equip_relationship: 'independent', equipment_w_per_m2: 150, equipment_baseload_w_per_m2: 150, floor_finish: 'hard', ceiling: 'exposed' }),
]
const SPACE_OF_ZONE: Record<string, string> = {
  'Lounge 1': 's_lounge', 'Lounge 2 (bay)': 's_lounge', 'Entrance, cloakroom and stair': 's_circ', 'Toilets (west)': 's_wc', 'Back of house (west, unheated)': 's_unheated',
  'Lounge 3 (fan convectors)': 's_lounge', 'Bar and bar store': 's_bar', 'Main dining room': 's_dining', 'Dining room (double height)': 's_dining', 'East dining room (DX)': 's_dining_dx',
  'Corridor and lobby (south)': 's_circ', Kitchen: 's_kitchen', "Ladies' changing and toilets": 's_changing', "Ladies' lounge": 's_lounge', 'Plant room and stores (unheated)': 's_unheated',
  'Staff room and changing': 's_staff', 'Equipment store (unheated)': 's_unheated', 'Pro shop': 's_shop', 'Pro shop office (DX)': 's_shop_dx',
  "Men's changing room": 's_changing', "Men's changing (bay)": 's_changing', Showers: 's_changing', 'Office (DX)': 's_office', 'First floor corridor': 's_circ',
  "Caretaker's flat": 's_flat', 'Golf simulator (DX)': 's_sim', 'Pro shop lounge': 's_shop', 'Trophy room': 's_trophy', 'Roof stores': 's_trophy',
}
// The fridge and freezer rooms are their own rooms in the kitchen zone; the zone takes the kitchen's space type (most floor).
const SPACE_OF_ROOM: Record<string, string> = { '409': 's_kitchen', '410': 's_kitchen' }

// ─── Systems and emitters ────────────────────────────────────────────────────────────────────────────────────────
const systems: PlanSystem[] = [
  { id: 'y1', service: 'heating', name: 'LTHW boilers: 4 × Ideal Concord Super 200V (≈200 kW), BMS zones', template: 'gas_boiler_noncondensing_heating', design_flow_c: 75, design_return_c: 65, capacity_kw: 200 },
  { id: 'y2', service: 'heating', name: "Combi boiler (caretaker's flat)", template: 'gas_boiler_heating', design_flow_c: 75, design_return_c: 65, capacity_kw: 24, dhw_first: 'y6' },
  { id: 'y3', service: 'heating', name: 'Combi boiler (pro shop, Block 5)', template: 'gas_boiler_heating', design_flow_c: 75, design_return_c: 65, capacity_kw: 24, dhw_first: 'y7' },
  { id: 'y4', service: 'cooling', name: 'DX split units (offices, east dining room, simulator)', template: 'split_system_cooling', capacity_kw: 21 },
  { id: 'y5', service: 'dhw', name: 'Beaumont 250 gas water heater (146 kW, 768 L, 1992)', template: 'gas_water_heater_direct_dhw', capacity_kw: 146, storage_litres: 768 },
  { id: 'y6', service: 'dhw', name: "Combi boiler hot water (caretaker's flat)", template: 'gas_boiler_dhw' },
  { id: 'y7', service: 'dhw', name: 'Combi boiler hot water (pro shop)', template: 'gas_boiler_dhw' },
  { id: 'y8', service: 'ventilation', name: 'Kitchen extract (untempered make-up air)', template: 'mev_standard', flow: 8, schedule: 'rwgc_vent_kitchen', runs: 'schedule' },
  { id: 'y9', service: 'ventilation', name: 'Toilet, shower and changing extract', template: 'mev_standard', flow: 1.5, schedule: 'rwgc_vent_club', runs: 'schedule' },
  { id: 'y10', service: 'lighting', name: 'Fluorescent and LED (part-upgraded)', template: null, efficacy: 2.6 },
]
// Radiators from CA-1000 "XX-Rad Schedule" (its outputs at ΔT50, i.e. 75/65 °C water, 20 °C room).
const rad = (id: string, name: string, w: number): EmitterType => ({ id, name, kind: 'radiator', rated_output_w: w, radiant_fraction: 0.3, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.3 })
const emitter_types: EmitterType[] = [
  rad('e_k2_1600x800', 'K2 1600×800', 3900), rad('e_k2_1600x600', 'K2 1600×600', 2925), rad('e_k2_1600x500', 'K2 1600×500', 2438), rad('e_k2_1600x400', 'K2 1600×400', 1950),
  rad('e_k2_1200x600', 'K2 1200×600', 2194), rad('e_k2_1200x500', 'K2 1200×500', 1828), rad('e_k2_1100x500', 'K2 1100×500', 1676), rad('e_k2_1200x300', 'K2 1200×300', 1097),
  rad('e_k2_1000x500', 'K2 1000×500', 1524), rad('e_k2_800x600', 'K2 800×600', 1463), rad('e_k2_800x500', 'K2 800×500', 1219), rad('e_k2_800x400', 'K2 800×400', 975),
  rad('e_k2_600x600', 'K2 600×600', 1097), rad('e_k2_500x500', 'K2 500×500', 762), rad('e_k2_600x400', 'K2 600×400', 731), rad('e_k2_600x300', 'K2 600×300', 548),
  rad('e_k2_300x600', 'K2 300×600', 548), rad('e_k2_800x200', 'K2 800×200', 488), rad('e_k1_1200x600', 'K1 1200×600', 1210), rad('e_k1_1200x500', 'K1 1200×500', 1008),
  rad('e_k1_1200x400', 'K1 1200×400', 806), rad('e_p_1600x500', 'P+ 1600×500', 1948), rad('e_p1_1200x600', 'P1 1200×600', 759), rad('e_p1_600x600', 'P1 600×600', 379),
  { id: 'e_fc', name: 'LTHW fan convector (CT circuit), 5 kW', kind: 'fan_coil', rated_output_w: 5000, radiant_fraction: 0, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.0 },
  { id: 'e_dx', name: 'DX split wall unit 3.5 kW (cooling)', kind: 'vrf_indoor', rated_output_w: null, radiant_fraction: 0, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null, heats: false, cooling_output_w: 3500 },
]
type Em = Array<[string, number]>
const ZONE_SYS: Record<string, { heating?: string; cooling?: string; ventilation?: string; dhw?: string; emitters?: Em }> = {
  'Lounge 1': { heating: 'y1', emitters: [['e_k2_1600x500', 2], ['e_k2_500x500', 2]] },
  'Lounge 2 (bay)': { heating: 'y1', emitters: [['e_k2_1200x300', 2], ['e_k2_1600x500', 1], ['e_k2_600x600', 1]] },
  'Entrance, cloakroom and stair': { heating: 'y1', emitters: [['e_k2_800x600', 1], ['e_k2_1600x600', 1], ['e_k2_300x600', 1]] },
  'Toilets (west)': { heating: 'y1', dhw: 'y5', ventilation: 'y9', emitters: [['e_k2_800x500', 1], ['e_k2_600x400', 1]] },
  'Back of house (west, unheated)': { heating: 'y1' },
  'Lounge 3 (fan convectors)': { heating: 'y1', emitters: [['e_fc', 2]] },
  'Bar and bar store': { heating: 'y1', emitters: [['e_k2_1600x400', 1]] },
  'Main dining room': { heating: 'y1', dhw: 'y5', emitters: [['e_k2_1600x400', 7]] },
  'Dining room (double height)': { heating: 'y1', dhw: 'y5', emitters: [['e_k1_1200x600', 2], ['e_k2_800x200', 2]] },
  'East dining room (DX)': { heating: 'y1', cooling: 'y4', dhw: 'y5', emitters: [['e_k2_1600x600', 1], ['e_k2_1600x400', 1], ['e_dx', 2]] },
  'Corridor and lobby (south)': { heating: 'y1', emitters: [['e_k2_1200x500', 1]] },
  Kitchen: { heating: 'y1', dhw: 'y5', ventilation: 'y8', emitters: [['e_k2_1600x800', 1]] },
  "Ladies' changing and toilets": { heating: 'y1', dhw: 'y5', ventilation: 'y9', emitters: [['e_k2_1200x500', 3], ['e_k2_1100x500', 1]] },
  "Ladies' lounge": { heating: 'y1', emitters: [['e_k2_1600x400', 2]] },
  'Plant room and stores (unheated)': { heating: 'y1' },
  'Staff room and changing': { heating: 'y1', dhw: 'y5', emitters: [['e_k2_1200x500', 2]] },
  'Equipment store (unheated)': { heating: 'y1' },
  'Pro shop': { heating: 'y3', dhw: 'y7', emitters: [['e_k2_1600x500', 3]] },
  'Pro shop office (DX)': { heating: 'y3', cooling: 'y4', emitters: [['e_k2_1000x500', 1], ['e_dx', 1]] },
  "Men's changing room": { heating: 'y1', dhw: 'y5', ventilation: 'y9', emitters: [['e_k2_1000x500', 4], ['e_k2_1200x300', 2]] },
  "Men's changing (bay)": { heating: 'y1', dhw: 'y5', ventilation: 'y9', emitters: [['e_k2_600x400', 1], ['e_k2_600x300', 1], ['e_k2_800x400', 1]] },
  Showers: { heating: 'y1', dhw: 'y5', ventilation: 'y9', emitters: [['e_k2_1000x500', 1]] },
  'Office (DX)': { heating: 'y1', cooling: 'y4', dhw: 'y5', emitters: [['e_k2_1600x600', 1], ['e_k1_1200x500', 2], ['e_p_1600x500', 1], ['e_dx', 1]] },
  'First floor corridor': { heating: 'y1', emitters: [['e_k1_1200x500', 1]] },
  "Caretaker's flat": { heating: 'y2', dhw: 'y6', emitters: [['e_k2_1200x600', 1], ['e_k2_600x400', 1], ['e_k1_1200x400', 1]] },
  'Golf simulator (DX)': { heating: 'y3', cooling: 'y4', emitters: [['e_k2_1600x400', 2], ['e_dx', 2]] },
  'Pro shop lounge': { heating: 'y3', dhw: 'y7', emitters: [['e_k2_1000x500', 1]] },
  'Trophy room': { heating: 'y1', emitters: [['e_p1_1200x600', 1], ['e_p1_600x600', 1]] },
  'Roof stores': { heating: 'y1', emitters: [['e_p1_600x600', 2]] },
}
const zoneName = new Map(ZONES.map(([n], i) => [`z${i + 1}`, n]))
const numberOf = new Map([...roomByNumber.entries()].map(([n, id]) => [id, n]))
// Each zone's emitters go on its biggest room.
const biggest = new Map<string, string>()
for (const f of floorsOf(plan)) for (const r of f.rooms) {
  const b = biggest.get(r.zone)
  const area = (x: PlanRoom) => Math.abs(x.ring.reduce((t, p, i) => { const q = x.ring[(i + 1) % x.ring.length]!; return t + p[0] * q[1] - q[0] * p[1] }, 0) / 2)
  if (!b) { biggest.set(r.zone, r.id); continue }
  const rb = floorsOf(plan).flatMap((x) => x.rooms).find((x) => x.id === b)!
  if (area(r) > area(rb)) biggest.set(r.zone, r.id)
}
const dress = (r: PlanRoom): PlanRoom => {
  const z = zoneName.get(r.zone)!
  const s = ZONE_SYS[z]
  if (!s) throw new Error(`zone ${z} has no systems entry`)
  const sys: NonNullable<PlanRoom['systems']> = { lighting: 'y10' }
  for (const k of ['heating', 'cooling', 'ventilation', 'dhw'] as const) if (s[k]) sys[k] = s[k]
  const sp = SPACE_OF_ROOM[numberOf.get(r.id)!] ?? SPACE_OF_ZONE[z]
  if (!sp) throw new Error(`zone ${z} has no space type`)
  return { ...r, space: sp, systems: sys, ...(s.emitters && biggest.get(r.zone) === r.id ? { emitters: s.emitters.map(([type, count]) => ({ type, count })) } : {}) }
}
for (let k = 0; k < geo.floors.length; k++) { plan = onFloor(plan, k); plan = { ...plan, rooms: plan.rooms.map(dress) } }
plan = onFloor(plan, 0)

plan = {
  ...plan,
  spaces: SPACES,
  systems,
  emitter_types,
  // Air leakage: one q50 for the building. The calcs' infiltration (0.1–0.75 ACH by block) and the strategy's "air
  // leakage is likely the single biggest driver of heat loss" point to a leaky building; 12 m³/h·m² at 50 Pa is taken.
  building: { ...plan.building!, q50: 12, tb_multiplier: 1.5, exposure: 'normal', terrain: 'suburban', design_outdoor: -4, warm_up_w_per_m2: null },
  dhw: { storage_c: 60, tap_c: 43, cold_c: 10, basis: null, litres: null, pump_w: 120, shape: 'follow_occupancy' },
  other_loads: [
    { id: 'ol1', kind: 'external_lighting', name: 'External lighting (car park, paths, terrace)', power_w: 1500, runs: 'dusk_to_dawn', schedule: null },
    { id: 'ol2', kind: 'other', name: 'Golf buggy charging (overnight)', power_w: 6000, runs: 'schedule', schedule: 'rwgc_buggies' },
    // The meter never drops below 11–12 kW overnight (digital twin report, Nov 2026); what is not traced to a room's
    // equipment yet (IT, comms, cellar and bar cooling, standby) is carried here until submetering says what it is.
    { id: 'ol3', kind: 'other', name: 'Base load not yet traced to a room (to the 2025 meter, pending submetering)', power_w: 4000, runs: 'continuous', schedule: null },
  ],
  next: { room: nRoom + 1, zone: ZONES.length + 1, system: systems.length + 1 },
}

// ─── Controls: the Trend IQ BMS (Energy Strategy §4.4) and local controls ────────────────────────────────────────
const controls: PlanControl[] = [
  { kind: 'system', ref: 'y1', controller: 'central_bms', note: 'Trend IQ BMS (early–mid 2010s): boiler sequencing, primary and zone pumps, six heating zones (two ground, four first floor) on time and local thermostats; TRVs on most radiators; CT circuit to the fan convectors' },
  { kind: 'system', ref: 'y5', controller: 'central_bms', note: 'BMS time schedule; secondary circulation pump' },
  { kind: 'system', ref: 'y2', controller: 'local', note: "Combi's own programmer and room thermostat" },
  { kind: 'system', ref: 'y3', controller: 'local', note: "Combi's own programmer and room thermostat" },
  { kind: 'system', ref: 'y4', controller: 'local', note: 'Handsets in each room; added piecemeal over time' },
  { kind: 'ventilation', ref: 'y8', controller: 'local', note: 'Kitchen extract with dedicated supply and fan control' },
  { kind: 'ventilation', ref: 'y9', controller: 'central_bms', note: null },
  { kind: 'lighting', ref: 'y10', controller: 'manual', note: 'Switched by hand; fluorescent being replaced with LED as fittings fail' },
]
plan = { ...plan, controls }
plan = upgradePlan(plan)

// The pumps from "Use defaults" (NCM Table 14), as the school's.
const first = buildDocument(plan)
if (!first.ok) throw new Error(JSON.stringify(first.issues.slice(0, 20), null, 1))
for (const x of plan.systems.filter((s) => s.service === 'heating' || s.service === 'cooling')) {
  const d = defaultPumps(first.doc as Parameters<typeof defaultPumps>[0], `${x.service}_${x.id}`)
  if (!d) continue
  const [basis, value] = Object.entries(d.power)[0] as [NonNullable<PlanSystem['pumps']>['basis'], number]
  plan = { ...plan, systems: plan.systems.map((s) => (s.id === x.id ? { ...s, pumps: { basis, value, speed: d.speed, runs: d.runs, schedule: d.schedule_ref ?? null, default_from: d.default_from } } : s)) }
}

const built = buildDocument(plan)
if (!built.ok) throw new Error(JSON.stringify(built.issues.slice(0, 20), null, 1))
const note = 'Royal Wimbledon Golf Club clubhouse (18 Nov 2026): three floors from SolidPoint\'s measured Revit survey, the fabric of NZA\'s five construction blocks (CA-1000), the systems in the Energy Strategy (RP-1000) and the club\'s opening hours. Real building; every figure the sources do not give is an assumption, listed in rwgc_clubhouse.assumptions.md. Made by scripts/example_rwgc_plan.mts.'
writeFileSync(path.join(root, 'docs/examples/rwgc_clubhouse.plan.json'), JSON.stringify({ _note: note, plan }, null, 1) + '\n')
const fl = floorsOf(plan)
console.log('floors', fl.map((f) => `${f.name}: ${f.rooms.length} rooms, ${f.windows.length} openings`).join('; '))
console.log('totals', JSON.stringify(built.totals))
console.log('dropped openings', dropped.length)
console.log('notes:\n ' + built.notes.join('\n '))
