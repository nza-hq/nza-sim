import { describe, expect, it } from 'vitest'
import { azimuthOf, emptyPlan, layoutIn, upgradePlan, wallRuns, type Plan, type PlanSystem, type XY } from '../plan'
import { DOOR, changeWindow, crossing, setOpeningsIn, setTypeOn, setTypeOnRooms, setWindowsIn, spaceByRoom, wallPieces, windowsIn } from '../facade'
import { cutZones } from '../ported/zones'
import { fitRooms } from '../rooms'
import { buildDocument } from '../toDocument'

const box: XY[] = [[0, 0], [12, 0], [12, 8], [0, 8]]
const plan = (fp: XY[]): Plan => fitRooms(emptyPlan(), [fp]).plan

const withWindows = (p: Plan, run: number, spec: { count: number; width_m: number; height_m: number; sill_m: number; shading_m?: number }): Plan => {
  const r = setWindowsIn(p, { run, t0: 0, t1: wallRuns(p.blocks)[run]!.length_m }, { shading_m: 0, ...spec })
  if ('why' in r) throw new Error(r.why)
  return r.plan
}

describe('walls and windows', () => {
  it('azimuth of outward normals on an anticlockwise box', () => {
    expect(wallRuns([box]).map((r) => r.azimuth_deg)).toEqual([180, 90, 0, 270])
    // A 45° diagonal side facing south-east.
    expect(azimuthOf([0, 0], [10, 10])).toBeCloseTo(135, 6)
  })
  it('three 1 m² windows, equally spaced, on a 12 m wall', () => {
    const run = wallRuns([box])[0]!
    const l = layoutIn({ run: 0, t0: 0, t1: run.length_m }, { count: 3, width_m: 1 / 1.2, height_m: 1.2, sill_m: 0.9 }, 3)
    if ('why' in l) throw new Error(l.why)
    const gaps = [l.windows[0]!.offset_m, l.windows[1]!.offset_m - l.windows[0]!.offset_m - l.windows[0]!.width_m]
    expect(gaps[0]).toBeCloseTo(gaps[1]!, 9)
    expect(l.windows[2]!.offset_m + l.windows[2]!.width_m + l.gap_m).toBeCloseTo(12, 9)
  })
  it('says why when they do not fit', () => {
    const run = wallRuns([box])[0]!
    expect(layoutIn({ run: 0, t0: 0, t1: run.length_m }, { count: 10, width_m: 1.5, height_m: 1, sill_m: 1 }, 3)).toHaveProperty('why')
    expect(layoutIn({ run: 0, t0: 0, t1: run.length_m }, { count: 1, width_m: 1, height_m: 2.5, sill_m: 1 }, 3)).toHaveProperty('why')
  })
})

describe('model document', () => {
  it('one zone with three windows validates against the schema', () => {
    const p = withWindows(plan(box), 0, { count: 3, width_m: 1 / 1.2, height_m: 1.2, sill_m: 0.9 })
    const b = buildDocument(p)
    expect(b.issues).toEqual([])
    expect(b.ok).toBe(true)
    expect(b.totals.glazing_m2).toBeCloseTo(3, 3)
    expect(b.totals.windows).toBe(3)
    // Net wall area: perimeter 40 m × 3 m − 3 m² glazing.
    expect(b.totals.wall_net_m2).toBeCloseTo(117, 3)
    const g = (b.doc as any).surfaces.find((s: any) => s.kind === 'glazing')
    expect(g).toMatchObject({ facade: 'south', azimuth_deg: 180, window_count: 3 })
    expect(g.wwr).toBeCloseTo(3 / 36, 3)
  })
  it('shading depth on a wall becomes the glazing overhang and still validates', () => {
    const p = withWindows(plan(box), 0, { count: 2, width_m: 1, height_m: 1.5, sill_m: 0.9, shading_m: 0.4 })
    const b = buildDocument(p)
    expect(b.ok).toBe(true)
    const glz = JSON.stringify(b.doc).match(/"shading":\{"overhang":\{"depth_m":0.4,"offset_m":0\}\}/)
    expect(glz).not.toBeNull()
  })
  it('two rooms in two zones make two zones, a partition, and keep every window', () => {
    const p = withWindows(plan(box), 0, { count: 3, width_m: 1, height_m: 1, sill_m: 1 })
    const cut = cutZones([box], [6, 0], [6, 8])
    if ('why' in cut) throw new Error(cut.why)
    p.rooms = cut.zones.map((ring, i) => ({ id: `r${i + 1}`, name: `Room ${i + 1}`, ring, zone: `z${i + 1}` }))
    p.zones = [1, 2].map((n) => ({ id: `z${n}`, name: `Zone ${n}`, use: null, heating: null, cooling: null }))
    const b = buildDocument(p)
    expect(b.ok).toBe(true)
    expect(b.totals.zones).toBe(2)
    expect(b.totals.partitions).toBe(1)
    expect(b.totals.floor_m2).toBeCloseTo(96, 6)
    expect(b.totals.windows).toBe(3)
    const part = (b.doc as any).surfaces.find((s: any) => s.kind === 'partition')
    expect(part.area_m2).toBeCloseTo(24, 6)
    // The middle window sits right on the cut line: counted once, and said.
    expect(b.notes).toContain('A window on wall 1 crosses into the next room; it is counted in the room its middle is in')
  })
  it('rooms split an outside wall into pieces; each piece takes its own windows and wall type', () => {
    let p = withWindows(plan(box), 0, { count: 3, width_m: 1, height_m: 1, sill_m: 1 })
    const cut = cutZones([box], [6, 0], [6, 8])
    if ('why' in cut) throw new Error(cut.why)
    p = { ...p, rooms: cut.zones.map((ring, i) => ({ id: `r${i + 1}`, name: `Room ${i + 1}`, ring, zone: 'z1' })), zones: [{ id: 'z1', name: 'Zone 1', use: null, heating: null, cooling: null }] }
    const south = wallPieces(p).filter((x) => x.run === 0)
    expect(south.map((x) => [x.t0, x.t1])).toEqual([[0, 6], [6, 12]])
    // The middle window (5.5–6.5 m) crosses the room line; spacing by room puts it clear.
    expect(crossing(p).length).toBe(1)
    p = spaceByRoom(p, 0)
    expect(crossing(p).length).toBe(0)
    expect(windowsIn(p, south[0]!).length + windowsIn(p, south[1]!).length).toBe(3)
    // Room 2's piece alone gets 2 windows; room 1's stay.
    const r = setWindowsIn(p, south[1]!, { count: 2, width_m: 1.2, height_m: 1.2, sill_m: 0.9, shading_m: 0 })
    if ('why' in r) throw new Error(r.why)
    p = r.plan
    expect(windowsIn(p, south[1]!).map((w) => w.width_m)).toEqual([1.2, 1.2])
    // An extension's wall type with its own U-value: the same zone now has two south walls.
    p = { ...p, fabric_types: [...p.fabric_types, { id: 'f_wall2', element: 'wall', name: 'Extension wall', construction: null, u: 0.18 }] }
    p = setTypeOn(p, [south[1]!], 'f_wall2')
    const b = buildDocument(p)
    expect(b.ok).toBe(true)
    const walls = (b.doc as any).surfaces.filter((s: any) => s.kind === 'wall' && s.azimuth_deg === 180)
    expect(walls.length).toBe(2)
    expect(walls.map((w: any) => w.construction_ref)).toEqual([{ key: 'unassigned:external_wall' }, { key: 'unassigned:external_wall:f_wall2', u_value_override: 0.18 }])
    // Glazing follows its wall piece: 2 windows on the extension's wall.
    const glz = (b.doc as any).surfaces.filter((s: any) => s.kind === 'glazing' && s.azimuth_deg === 180)
    expect(glz.length).toBe(2)
    expect(glz.reduce((n: number, g: any) => n + g.window_count, 0)).toBe(windowsIn(p, south[0]!).length + 2)
  })
  it('four windows and a door share a wall, spaced together; the door is its own opaque surface', () => {
    const r = setOpeningsIn(plan(box), { run: 0, t0: 0, t1: 12 }, { count: 4, width_m: 1, height_m: 1.2, sill_m: 0.9, shading_m: 0 }, { count: 1, ...DOOR })
    if ('why' in r) throw new Error(r.why)
    const ws = windowsIn(r.plan, { run: 0, t0: 0, t1: 12 })
    expect(ws.map((w) => (w.door ? 'D' : 'W')).join('')).toBe('WWDWW')
    // Equal gaps: (12 − 4 − 0.9) / 6.
    const gap = (12 - 4.9) / 6
    expect(ws[0]!.t_m).toBeCloseTo(gap, 9)
    expect(ws[2]!.t_m).toBeCloseTo(3 * gap + 2, 9)
    expect(ws[2]!.sill_m).toBe(0)
    const b = buildDocument(r.plan)
    expect(b.ok).toBe(true)
    const doors = (b.doc as any).surfaces.filter((s: any) => s.construction_ref.key === 'unassigned:external_door')
    expect(doors.length).toBe(1)
    expect(doors[0].area_m2).toBeCloseTo(0.9 * 2.1, 6)
    expect(b.totals.windows).toBe(4)
    expect(b.totals.doors).toBe(1)
    // Net wall: 40 m × 3 m − 4.8 m² glass − 1.89 m² door.
    expect(b.totals.wall_net_m2).toBeCloseTo(120 - 4.8 - 1.89, 3)
    // A window turned into a door keeps its middle and drops to the floor; moved up, a window stays in the storey.
    const w0 = ws[0]!
    const p2 = changeWindow(r.plan, w0.id, { door: true, ...DOOR })
    const d0 = p2.windows.find((w) => w.id === w0.id)!
    expect(d0.door).toBe(true)
    expect(d0.sill_m).toBe(0)
    expect(d0.t_m + d0.width_m / 2).toBeCloseTo(w0.t_m + w0.width_m / 2, 9)
    const p3 = changeWindow(r.plan, ws[1]!.id, { sill_m: 5 })
    expect(p3.windows.find((w) => w.id === ws[1]!.id)!.sill_m).toBeCloseTo(3 - 1.2, 9)
  })
  it('fabric types are library constructions, per room; space types give zones their use, profiles and systems', () => {
    let p = withWindows(plan(box), 0, { count: 3, width_m: 1, height_m: 1, sill_m: 1 })
    const cut = cutZones([box], [6, 0], [6, 8])
    if ('why' in cut) throw new Error(cut.why)
    p = { ...p, rooms: cut.zones.map((ring, i) => ({ id: `r${i + 1}`, name: `Room ${i + 1}`, ring, zone: 'z1' })), zones: [{ id: 'z1', name: 'Zone 1', use: null, heating: null, cooling: null }] }
    p = spaceByRoom(p, 0)
    // Library constructions for the whole building, an enhanced wall and roof on room 2 only.
    const set = (id: string, construction: string) => p.fabric_types.map((t) => (t.id === id ? { ...t, construction } : t))
    p = { ...p, fabric_types: set('f_wall', 'cavity_wall_standard') }
    p = { ...p, fabric_types: set('f_glazing', 'triple_glazing') }
    p = { ...p, fabric_types: [...p.fabric_types, { id: 'f_wall2', element: 'wall', name: 'Extension', construction: 'cavity_wall_enhanced', u: null }, { id: 'f_roof2', element: 'roof', name: 'New roof', construction: 'flat_roof_enhanced', u: 0.1 }] }
    p = setTypeOnRooms(p, ['r2'], 'f_wall2')
    p = setTypeOnRooms(p, ['r2'], 'f_roof2')
    // Room 1 an office with MVHR, VRF heating and no cooling; room 2 has no space type and no systems: the zone takes
    // the office's.
    const office = { id: 's1', name: 'Office', use: 'office', occupancy: 'office_occupancy', lighting: 'office_lighting', equipment: null }
    const systems: PlanSystem[] = [
      { id: 'y1', service: 'heating', name: 'VRF', template: 'vrf_heating' },
      { id: 'y2', service: 'cooling', name: 'None', template: 'none_cooling' },
      { id: 'y3', service: 'ventilation', name: 'MVHR', template: 'mvhr_standard', flow: null, schedule: null },
    ]
    p = { ...p, spaces: [office], systems, rooms: p.rooms.map((r) => (r.id === 'r1' ? { ...r, space: 's1', systems: { heating: 'y1', cooling: 'y2', ventilation: 'y3' } } : r)) }
    const b = buildDocument(p)
    expect(b.issues).toEqual([])
    const doc = b.doc as any
    const keys = (kind: string) => doc.surfaces.filter((s: any) => s.kind === kind).map((s: any) => s.construction_ref)
    expect(keys('wall')).toContainEqual({ key: 'cavity_wall_standard' })
    expect(keys('wall')).toContainEqual({ key: 'cavity_wall_enhanced' })
    expect(keys('roof')).toEqual(expect.arrayContaining([{ key: 'unassigned:roof' }, { key: 'flat_roof_enhanced', u_value_override: 0.1 }]))
    expect(keys('roof')).toHaveLength(2)
    expect(doc.surfaces.filter((s: any) => s.kind === 'roof').reduce((n: number, s: any) => n + s.area_m2, 0)).toBeCloseTo(96, 6)
    const glz = doc.surfaces.filter((s: any) => s.kind === 'glazing')
    expect(glz.every((g: any) => g.construction_ref.key === 'triple_glazing' && g.g_value === 0.35)).toBe(true)
    const z = doc.zones[0]
    expect(z.use_type).toBe('office')
    // Occupancy needs people per m² (the library profile is a shape only); without it, it waits, with a note.
    expect(z.profile_refs).toEqual({ occupancy: null, lighting: ['s1_lighting'], equipment: [], auxiliary: [] })
    expect(b.notes.some((n) => /people per m²/.test(n))).toBe(true)
    expect(doc.profiles.map((x: any) => x.id)).toEqual(['s1_lighting'])
    expect(doc.profiles[0].schedule.weekday).toHaveLength(24)
    expect(doc.profiles[0].magnitude).toBeUndefined()
    const b2 = buildDocument({ ...p, systems: systems.map((x) => (x.id === 'y3' ? { ...x, flow: 1.2, schedule: 'hotel_ventilation_occupied' } : x)), spaces: [{ ...office, people_per_m2: 0.1, sensible_w_per_person: 75, occupancy_rate: 0.8, lighting_w_per_m2: 8, equipment_w_per_m2: 10, equipment_baseload_w_per_m2: 0, radiant_fraction: 0.3, equip_relationship: 'proportional', standby_factor: 0.1 }] })
    expect(b2.issues).toEqual([])
    const d2 = b2.doc as any
    expect(d2.zones[0].profile_refs.occupancy).toBe('s1_occupancy')
    expect(d2.profiles.find((x: any) => x.id === 's1_occupancy')).toMatchObject({ density: { value: 0.1, basis: 'per_m2' }, sensible_w_per_person: 75, occupancy_rate: 0.8 })
    expect(d2.profiles.find((x: any) => x.id === 's1_lighting').magnitude).toEqual({ value: 8, unit: 'w_per_m2' })
    expect(d2.profiles.find((x: any) => x.id === 's1_equipment')).toMatchObject({ active: { value: 10, unit: 'w_per_m2' }, baseload: { value: 0, unit: 'w_per_m2' }, relationship_to_occupancy: 'proportional', standby_factor: 0.1, radiant_fraction: 0.3 })
    expect(d2.zones[0].ventilation[0]).toMatchObject({ kind: 'mvhr', flow_rate: 1.2, flow_rate_basis: 'per_m2', control_schedule_ref: 'hotel_ventilation_occupied' })
    expect(d2.profiles.find((x: any) => x.id === 'hotel_ventilation_occupied')).toMatchObject({ kind: 'schedule' })
    // Every library item used is pinned with its body hash.
    expect(d2.library_refs.map((r: any) => `${r.kind}:${r.key}`)).toEqual(expect.arrayContaining(['construction:cavity_wall_standard', 'construction:triple_glazing', 'profile:office_occupancy', 'system_template:vrf_heating', 'system_template:mvhr_standard']))
    expect(d2.library_refs.every((r: any) => /^[0-9a-f]{64}$/.test(r.body_hash))).toBe(true)
    expect(z.ventilation).toHaveLength(1)
    expect(z.ventilation[0]).toMatchObject({ kind: 'mvhr', enabled: true })
    // No mechanical cooling is no system at all; VRF heating is one group.
    expect(doc.system_groups.map((g: any) => g.template_ref)).toEqual(['vrf_heating'])
    expect(doc.system_groups[0]).toMatchObject({ id: 'heating_y1', label: 'VRF', zones: ['z1'] })
    expect(b.notes.some((n) => /no space type/.test(n))).toBe(true)
    // Two heating systems in one zone: the one on the most floor, with a note.
    const mixed = buildDocument({ ...p, systems: [...systems, { id: 'y4', service: 'heating', name: 'Panels', template: 'electric_panel_heating' }], rooms: p.rooms.map((r) => (r.id === 'r2' ? { ...r, systems: { heating: 'y4' } } : r)) })
    expect(mixed.notes.some((n) => /2 heating systems/.test(n))).toBe(true)
    expect((mixed.doc as any).system_groups).toHaveLength(1)
  })
  it('a plan from before the Systems step keeps its systems', () => {
    let p = plan([[0, 0], [10, 0], [10, 8], [0, 8]])
    const old = { id: 's1', name: 'Office', use: 'office', occupancy: null, lighting: null, equipment: null, heating: 'vrf_heating', cooling: null, ventilation: 'mvhr_standard', dhw: null, vent_flow: 1, vent_schedule: 'always_on' }
    p = { ...p, spaces: [old as any], rooms: p.rooms.map((r) => ({ ...r, space: 's1' })) }
    const up = upgradePlan(p)
    expect(up.systems).toEqual([
      { id: 'y1', service: 'heating', name: 'Heating · Office', template: 'vrf_heating' },
      { id: 'y2', service: 'ventilation', name: 'Ventilation · Office', template: 'mvhr_standard', flow: 1, schedule: 'always_on' },
    ])
    expect(up.rooms.every((r) => r.systems?.heating === 'y1' && r.systems?.ventilation === 'y2')).toBe(true)
    expect('heating' in up.spaces[0]!).toBe(false)
    expect(upgradePlan(up)).toEqual(up)
    const d = buildDocument(up).doc as any
    expect(d.zones[0].ventilation[0]).toMatchObject({ kind: 'mvhr', flow_rate: 1, control_schedule_ref: 'always_on' })
  })
  it('an L with a diagonal side validates', () => {
    const L: XY[] = [[0, 0], [20, 0], [20, 6], [14, 12], [0, 12]]
    const b = buildDocument(plan(L))
    expect(b.ok).toBe(true)
    const diag = (b.doc as any).surfaces.find((s: any) => s.kind === 'wall' && Math.abs(s.azimuth_deg - 45) < 1e-6)
    expect(diag.area_m2).toBeCloseTo(Math.hypot(6, 6) * 3, 3)
  })
})

describe('the two-zone test fixture', () => {
  it('builds a valid document with setpoints, air leakage, bridging and exposure stated', async () => {
    const fx = (await import('../__fixtures__/two_zones.plan.json')).default as unknown as { plan: Plan }
    const b = buildDocument(upgradePlan(fx.plan))
    expect(b.issues).toEqual([])
    const doc = b.doc as any
    expect(doc.zones.map((z: any) => [z.setpoints.heat_c, z.setpoints.cool_c, z.setpoints.control_strategy, z.infiltration_q50])).toEqual([[21, 24, 'active_setpoint', 5], [16, null, 'active_setpoint', 5]])
    expect(doc.building.thermal_bridging).toEqual({ mode: 'iso14683_auto', multiplier: 1, alpha_pct: null })
    expect(doc.building.site.exposure).toBe('normal')
    // Walls between zones take the drafted internal wall, flagged as awaiting Chris.
    expect(doc.surfaces.filter((s: any) => s.kind === 'partition').map((s: any) => s.construction_ref.key)).toEqual(['interior_wall_block_plastered'])
    expect(b.notes.some((n) => /draft library item/.test(n))).toBe(true)
  })
})

describe('hot water for the whole building', () => {
  it('writes the typed values to services.dhw, and notes what is missing', () => {
    const fp: XY[] = [[0, 0], [10, 0], [10, 8], [0, 8]]
    let p = fitRooms(emptyPlan(), [fp]).plan
    p = { ...p, systems: [{ id: 'y1', service: 'dhw', name: 'Gas', template: 'gas_boiler_dhw' }], rooms: p.rooms.map((r) => ({ ...r, systems: { dhw: 'y1' } })) }
    const a = buildDocument(p)
    expect((a.doc as any).services.dhw.storage_setpoint_c).toBeNull()
    p = { ...p, dhw: { storage_c: 60, tap_c: 43, cold_c: 10, basis: 'per_person', litres: 50, pump_w: 0 } }
    const b = buildDocument(p)
    expect(b.issues).toEqual([])
    expect((b.doc as any).services.dhw).toMatchObject({ storage_setpoint_c: 60, tap_outlet_temp_c: 43, cold_supply_temp_c: 10, demand_basis: 'per_person', litres_per_person_per_day: 50, litres_per_m2_per_day: null, circulation_pump_w: 0, load_shape: 'flat' })
    expect(b.notes.some((n) => /Hot water/.test(n))).toBe(false)
  })
})
