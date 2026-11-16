/**
 * Brief 120 Part 1: system (plant) capacity. Hand cases on the network solver, then the document path.
 * Two identical rooms in steady cold weather, each losing k W/K to 0 °C outside, heated to 20 °C: unlimited, each
 * needs 20·k. On one plant of 20·k (half), shared in proportion to the asks (equal), each room settles where k·θ = 10·k,
 * at 10 °C.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { opaqueElement, type Element, type Layer } from '../elements'
import { REFEREE_OPTIONS, runModel } from '../model'
import { runNetwork, type NetworkInputs, type NetworkPlant } from '../network'
import { runSystems } from '../systems'
import { ModelDocument } from '../../schema/model'
import { upgradeDocument } from '../../schema/upgrade'
import { cooledRoomDocument } from './cooledRoom'
import { MOS, readMos } from './denver'

const H = 24 * 20
const flat = (v: number, n = H) => new Float64Array(n).fill(v)
const WALL: Layer[] = [
  { kind: 'Material:NoMass', thermal_resistance: 2 },
  { kind: 'Material', thickness: 0.1, conductivity: 1.13, density: 2300, specific_heat: 1000 },
]
const wall = (id: string, area: number): Element => ({ ...opaqueElement({ id, area_m2: area, tilt_deg: 90, boundary: 'outside', layers: WALL, stated_u: null, emissivity: 0.9, path: id }), f_sky: 0 })
const Rchain = (e: Element) => 1 / e.g_boundary + Array.from(e.g).reduce((s, g) => s + 1 / g, 0)
const els = [wall('a', 50), wall('b', 50)]
const k = els[0].area_m2 / (Rchain(els[0]) + 1 / els[0].h_ci) + 40 + 60  // one room's W/K to outside
const last = (a: Float64Array) => a[a.length - 1]
const net = (plants: NetworkPlant[] | null, theta = 0, sp = { heat_c: 20 as number | null, cool_c: null as number | null }): NetworkInputs => ({
  zones: [0, 1].map(() => ({ air_capacity_j_per_k: 1e6, bridging_w_per_k: 40, ventilation_w_per_k: flat(60), solar_transmitted_w: flat(0), solar_beam_w: null, other_gains: null, setpoints: sp, initial_c: 20 })),
  elements: els.map((element, i) => ({ element, zone_a: i, zone_b: null, solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null })),
  hours: H, theta_e: flat(theta), theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 60, plants,
})
const both = (share = 1) => [{ zone: 0, share }, { zone: 1, share }]

describe('Brief 120 P1 (network): a plant shares its capacity in proportion to the asks', () => {
  const half = 20 * k
  it('unlimited, each room needs 20·k; a plant above that changes nothing, value for value', () => {
    const free = runNetwork(net(null))
    expect(last(free.zones[0].heating_w)).toBeCloseTo(20 * k, 6)
    const big = runNetwork(net([{ service: 'heating', cap_w: 10 * half, zones: both() }]))
    for (const z of [0, 1]) expect(Array.from(big.zones[z].heating_w)).toEqual(Array.from(free.zones[z].heating_w))
    expect(Math.max(...big.plants[0].short)).toBe(0)
  })
  it('at half, each room gets half and settles at 10 °C; the plant never gives more than it has, and every hour closes', () => {
    const r = runNetwork(net([{ service: 'heating', cap_w: half, zones: both() }]))
    for (const z of [0, 1]) {
      expect(last(r.zones[z].heating_w)).toBeCloseTo(half / 2, 6)
      expect(Math.abs(last(r.zones[z].theta_air) - 10)).toBeLessThan(0.01)
      expect(Math.max(...r.zones[z].closure_wh)).toBeLessThanOrEqual(1)
      expect(last(r.zones[z].plant_limited!)).toBe(1)
    }
    for (let h = 0; h < H; h++) expect(r.zones[0].heating_w[h] + r.zones[1].heating_w[h]).toBeLessThanOrEqual(half * (1 + 1e-9) + 1e-6)
    expect(last(r.plants[0].delivered_w)).toBeCloseTo(half, 6)
    expect(last(r.plants[0].ask_w)).toBeGreaterThan(half)
    expect(last(r.plants[0].short)).toBe(1)
  })
  it('hot water heated first: a plant of 20·k + R with R reserved every hour is the plant of 20·k', () => {
    const R = 3000
    const a = runNetwork(net([{ service: 'heating', cap_w: half, zones: both() }]))
    const b = runNetwork(net([{ service: 'heating', cap_w: half + R, zones: both(), reserved_w: flat(R) }]))
    for (const z of [0, 1]) for (let h = 0; h < H; h++) expect(b.zones[z].heating_w[h]).toBeCloseTo(a.zones[z].heating_w[h], 6)
  })
  it('two plants each serving half of each room, each of 10·k, are the one plant of 20·k', () => {
    const a = runNetwork(net([{ service: 'heating', cap_w: half, zones: both() }]))
    const b = runNetwork(net([{ service: 'heating', cap_w: half / 2, zones: both(0.5) }, { service: 'heating', cap_w: half / 2, zones: both(0.5) }]))
    for (const z of [0, 1]) for (let h = 0; h < H; h++) expect(b.zones[z].heating_w[h]).toBeCloseTo(a.zones[z].heating_w[h], 6)
  })
  it('unequal rooms: both are held, the plant gives all it has, and the room losing more gets more', () => {
    const inp = net([{ service: 'heating', cap_w: half, zones: both() }])
    inp.zones[1].bridging_w_per_k = 40 + k  // room 2 loses 2k
    const r = runNetwork(inp)
    const h = H - 1
    expect(r.plants[0].short[h]).toBe(1)
    expect(r.zones[0].plant_limited![h]).toBe(1); expect(r.zones[1].plant_limited![h]).toBe(1)
    expect(r.zones[0].heating_w[h] + r.zones[1].heating_w[h]).toBeCloseTo(half, 6)
    expect(r.zones[1].heating_w[h]).toBeGreaterThan(r.zones[0].heating_w[h])
  })
  it('cooling: the mirror, two rooms at 40 °C outside cooled to 26 °C on a plant of half', () => {
    const sp = { heat_c: null, cool_c: 26 }
    const free = runNetwork(net(null, 40, sp))
    const need = last(free.zones[0].cooling_w)
    expect(need).toBeCloseTo(14 * k, 6)
    const r = runNetwork(net([{ service: 'cooling', cap_w: need, zones: both() }], 40, sp))
    for (const z of [0, 1]) { expect(last(r.zones[z].cooling_w)).toBeCloseTo(need / 2, 6); expect(Math.abs(last(r.zones[z].theta_air) - 33)).toBeLessThan(0.01) }
  })
  it('a stated capacity of 0 or less, or a share outside 0 to 1, is refused by name', () => {
    expect(() => runNetwork(net([{ service: 'heating', cap_w: 0, zones: both() }]))).toThrow(/plants\[0\]\.cap_w/)
    expect(() => runNetwork(net([{ service: 'heating', cap_w: 10, zones: both(1.5) }]))).toThrow(/plants\[0\]\.zones/)
  })
})

describe('Brief 120 P1 (document): capacity_kw limits the rooms a system serves', () => {
  const W = readMos(fs.readFileSync(MOS))
  const doc = (cap: number | null, more: (d: any) => void = () => {}) => {
    const c = cooledRoomDocument()
    const d: any = structuredClone(c.doc)
    for (const z of d.zones) z.setpoints = { ...z.setpoints, heat_c: 20, cool_c: null }
    d.system_groups = [{ id: 'boiler', service: 'heating', zones: d.zones.map((z: any) => z.id), enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, capacity_kw: cap }]
    more(d)
    return { d: ModelDocument.parse(d), lib: c.lib }
  }
  const run = (x: ReturnType<typeof doc>) => runModel(x.d, W, x.lib, { ...REFEREE_OPTIONS, internal_gains: 'none' })
  it('without a capacity, nothing changes; a 1 kW boiler never gives more than 1 kW, and its rooms go unmet', () => {
    const free = run(doc(null))
    expect(free.plants).toEqual([])
    const r = run(doc(1))
    for (let h = 0; h < W.hours.count; h++) expect(r.zones.reduce((s, z) => s + z.hourly.heating_w[h], 0)).toBeLessThanOrEqual(1000 * (1 + 1e-9) + 1e-6)
    const p = r.plants[0]
    expect(p.hours_short).toBeGreaterThan(100)
    expect(p.peak_ask_w).toBeGreaterThan(1000)
    expect(r.zones.some((z) => (z.annual.system_short_heating_hours_in_use ?? 0) > 0)).toBe(true)
    for (const z of r.zones) expect(z.annual.system_short_heating_hours_in_use!).toBeLessThanOrEqual(z.annual.unmet_heating_hours_in_use!)
    expect(free.zones.every((z) => z.annual.system_short_heating_hours_in_use === null)).toBe(true)
  })
  it('Rule 9: what the system gave is the rooms\' heating, and closure holds', () => {
    const r = run(doc(1))
    const rooms = r.zones.reduce((s, z) => s + z.annual.heating_kwh, 0)
    expect(r.plants[0].delivered_kwh).toBeCloseTo(rooms, 6)
    const p = r.plants[0]
    expect(p.asked_not_given_step_sum_kwh).toBeCloseTo(p.asked_not_given_step_sum_kwh_by_month.reduce((a, b) => a + b, 0), 9)
    // Review F4: it is Σ (ask − given) over the short steps (outside them the plant gives all it is asked), and it is far
    // above what the cap takes off the year's heating, because a cold room asks again each step: not an energy.
    expect(p.asked_not_given_step_sum_kwh).toBeCloseTo(p.ask_kwh - p.delivered_kwh, 6)
    expect(p.asked_not_given_step_sum_kwh).toBeGreaterThan(0)
    const free = run(doc(null)).zones.reduce((s, z) => s + z.annual.heating_kwh, 0)
    expect(p.asked_not_given_step_sum_kwh).toBeGreaterThan(free - rooms)
    for (const z of r.zones) expect(z.closure.max_wh).toBeLessThanOrEqual(1)
  })
  it('a capacity of 0 is refused by name; emitter_limit none lifts it', () => {
    expect(() => run(doc(0))).toThrow(/system_groups\[0\]\.capacity_kw/)
    const x = doc(1)
    expect(runModel(x.d, W, x.lib, { ...REFEREE_OPTIONS, internal_gains: 'none', emitter_limit: 'none' }).plants).toEqual([])
  })
  it('hot water first: named on a heating system with a capacity, naming a hot water system', () => {
    const bad = (f: (d: any) => void) => ModelDocument.safeParse((() => { const d: any = structuredClone(cooledRoomDocument().doc); d.system_groups = [{ id: 'boiler', service: 'heating', zones: [d.zones[0].id], enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, capacity_kw: 10 }, { id: 'hw', service: 'dhw', zones: [d.zones[0].id], enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9 }]; f(d); return d })()).error?.issues[0].message
    expect(bad((d) => { d.system_groups[0].dhw_priority_group_id = 'nope' })).toMatch(/does not exist/)
    expect(bad((d) => { d.system_groups[0].dhw_priority_group_id = 'boiler' })).toMatch(/not hot water/)
    expect(bad((d) => { d.system_groups[0].dhw_priority_group_id = 'hw'; d.system_groups[0].capacity_kw = null })).toMatch(/needs its capacity/)
    expect(bad((d) => { d.system_groups[0].dhw_priority_group_id = 'hw' })).toBeUndefined()
  })
  it('P2b: a short boiler feeding radiators lowers one flow temperature; the room with the bigger radiator keeps more', () => {
    const c = cooledRoomDocument()
    const d: any = structuredClone(c.doc)
    const rads: Record<string, number> = { west: 1600, east: 900 }
    d.system_groups = [{ id: 'lthw', service: 'heating', zones: Object.keys(rads), enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, capacity_kw: 1.6, design_flow_c: 50, design_return_c: 40 }]
    for (const z of d.zones) if (rads[z.id]) z.emitters = [{ id: `${z.id}_rad`, kind: 'radiator', count: 1, rated_output_w: rads[z.id], radiant_fraction: 0, system_group_id: 'lthw', rated_flow_c: 50, rated_return_c: 40, rated_room_c: 20, exponent_n: 1 }]
    const r = runModel(ModelDocument.parse(d), W, c.lib, REFEREE_OPTIONS)
    const p = r.plants[0]
    expect(p.hours_short).toBeGreaterThan(100)
    expect(p.min_flow_c!).toBeLessThan(45)
    expect(p.min_flow_c!).toBeGreaterThan(20)
    const [w, e] = ['west', 'east'].map((id) => r.zones.find((z) => z.zone_id === id)!)
    let gw = 0, ge = 0
    for (let h = 0; h < W.hours.count; h++) {
      const sum = w.hourly.heating_w[h] + e.hourly.heating_w[h]
      expect(sum).toBeLessThanOrEqual(1600 * (1 + 1e-9) + 1e-6)
      if (sum >= 1599) { gw += w.hourly.heating_w[h]; ge += e.hourly.heating_w[h] }
    }
    expect(gw / (gw + ge)).toBeGreaterThan(0.53)
    for (const z of [w, e]) expect(z.closure.max_wh).toBeLessThanOrEqual(1)
    // Review F8: pinned to the P2 referee's unequal case (docs/audit/120/02_referee.json; EnergyPlus 173 and 587 h,
    // shares 0.56 / 0.44), so a change to the sharing that moves a room is seen here.
    expect([w.annual.unmet_heating_hours, e.annual.unmet_heating_hours]).toEqual([158, 557])
    expect(gw / (gw + ge)).toBeCloseTo(0.561, 3)
  })
  it('review F8: a room asking less than its radiator gives at the lowered flow takes only its ask; the plant still gives all it has', () => {
    const c = cooledRoomDocument()
    const d: any = structuredClone(c.doc)
    const rads: Record<string, number> = { west: 1600, east: 900 }
    d.system_groups = [{ id: 'lthw', service: 'heating', zones: Object.keys(rads), enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, capacity_kw: 1.6, design_flow_c: 50, design_return_c: 40 }]
    for (const z of d.zones) if (rads[z.id]) z.emitters = [{ id: `${z.id}_rad`, kind: 'radiator', count: 1, rated_output_w: rads[z.id], radiant_fraction: 0, system_group_id: 'lthw', rated_flow_c: 50, rated_return_c: 40, rated_room_c: 20, exponent_n: 1 }]
    // The west room, with the bigger radiator, is kept only at 12 °C: it asks less than its radiator gives.
    for (const z of d.zones) if (z.id === 'west') z.setpoints = { ...z.setpoints, heat_c: 12 }
    const r = runModel(ModelDocument.parse(d), W, c.lib, REFEREE_OPTIONS)
    const p = r.plants[0]
    expect(p.hours_short).toBeGreaterThan(50)
    const [w, e] = ['west', 'east'].map((id) => r.zones.find((z) => z.zone_id === id)!)
    let full = 0, wAbove = 0
    for (let h = 0; h < W.hours.count; h++) {
      const sum = w.hourly.heating_w[h] + e.hourly.heating_w[h]
      if (sum >= 1600 * 0.999) full++
      if (w.hourly.heating_w[h] > 0 && w.hourly.theta_air_c[h] > 12.5) wAbove++
    }
    // Counted as EnergyPlus counts them (F9): the hours it gave all it had are its short hours.
    expect(Math.abs(full - p.hours_short)).toBeLessThanOrEqual(0.02 * p.hours_short + 2)
    expect(wAbove).toBe(0)
    expect(w.annual.unmet_heating_hours).toBe(0)
  })
  it('P2b: a plant with no radiators of its own in every room shares in proportion to ask, and states no flow temperature', () => {
    expect(run(doc(1)).plants[0].min_flow_c).toBeNull()
  })
  it('a capped heat pump at 60 % beside an uncapped boiler at 40 %: the boiler tops up (Linzie, 16 Nov 19:48), the heat pump never gives more than it has', () => {
    const c = cooledRoomDocument()
    const mk = (cap: number | null) => {
      const d: any = structuredClone(c.doc)
      for (const z of d.zones) z.setpoints = { ...z.setpoints, heat_c: 20, cool_c: null }
      const zs = d.zones.map((z: any) => z.id)
      d.system_groups = [
        { id: 'hp', service: 'heating', zones: zs, enabled: true, share_pct: 60, source: 'ambient_air', efficiency_metric: 3, capacity_kw: cap },
        { id: 'boiler', service: 'heating', zones: zs, enabled: true, share_pct: 40, source: 'gas', efficiency_metric: 0.9 },
      ]
      return runModel(ModelDocument.parse(d), W, c.lib, { ...REFEREE_OPTIONS, internal_gains: 'none' })
    }
    const free = mk(null), r = mk(0.6)
    const p = r.plants[0]
    expect(p.hours_short).toBeGreaterThan(1000)
    for (let h = 0; h < W.hours.count; h++) expect(p.zones.reduce((a, z) => a + z.given_w[h], 0)).toBeLessThanOrEqual(600 * (1 + 1e-9) + 1e-6)
    // The rooms get what they got with no cap: the boiler covers the rest.
    r.zones.forEach((z, i) => {
      expect(z.annual.heating_kwh).toBeCloseTo(free.zones[i].annual.heating_kwh, 3)
      expect(z.annual.unmet_heating_hours).toBe(free.zones[i].annual.unmet_heating_hours)
      expect(z.annual.system_short_heating_hours_in_use).toBe(0)
    })
    const sum = (z: { given_w: Float64Array }) => z.given_w.reduce((a, b) => a + b, 0) / 1000
    expect(p.delivered_kwh).toBeCloseTo(p.zones.reduce((a, z) => a + sum(z), 0), 6)
    expect(p.delivered_kwh).toBeLessThan(0.6 * r.zones.reduce((a, z) => a + z.annual.heating_kwh, 0))
  })
  it('two capped systems in the same rooms: the one with spare covers the other, up to its own capacity', () => {
    const c = cooledRoomDocument()
    const d: any = structuredClone(c.doc)
    for (const z of d.zones) z.setpoints = { ...z.setpoints, heat_c: 20, cool_c: null }
    const zs = d.zones.map((z: any) => z.id)
    d.system_groups = [
      { id: 'hp', service: 'heating', zones: zs, enabled: true, share_pct: 60, source: 'ambient_air', efficiency_metric: 3, capacity_kw: 0.3 },
      { id: 'boiler', service: 'heating', zones: zs, enabled: true, share_pct: 40, source: 'gas', efficiency_metric: 0.9, capacity_kw: 2 },
    ]
    const r = runModel(ModelDocument.parse(d), W, c.lib, { ...REFEREE_OPTIONS, internal_gains: 'none' })
    const [hp, boiler] = r.plants
    let boilerAboveShare = 0
    for (let h = 0; h < W.hours.count; h++) {
      const gh = hp.zones.reduce((a, z) => a + z.given_w[h], 0), gb = boiler.zones.reduce((a, z) => a + z.given_w[h], 0)
      expect(gh).toBeLessThanOrEqual(300 * (1 + 1e-9) + 1e-6)
      expect(gb).toBeLessThanOrEqual(2000 * (1 + 1e-9) + 1e-6)
      const rooms = r.zones.reduce((a, z) => a + z.hourly.heating_w[h], 0)
      expect(gh + gb).toBeCloseTo(rooms, 4)
      if (gb > 0.4 * rooms + 1) boilerAboveShare++
    }
    expect(boilerAboveShare).toBeGreaterThan(1000)
  })
  it('review F6: hot water heated first above the boiler\'s capacity is short, shown, and the rooms get nothing that hour', () => {
    const c = cooledRoomDocument()
    const d: any = structuredClone(c.doc)
    for (const z of d.zones) z.setpoints = { ...z.setpoints, heat_c: 20, cool_c: null }
    const zs = d.zones.map((z: any) => z.id)
    d.system_groups = [
      { id: 'boiler', service: 'heating', zones: zs, enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, capacity_kw: 3, dhw_priority_group_id: 'hw' },
      { id: 'hw', service: 'dhw', zones: zs, enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9 },
    ]
    d.services.dhw = { storage_setpoint_c: 60, tap_outlet_temp_c: 40, cold_supply_temp_c: 10, load_shape: 'follow_occupancy', circulation_pump_w: 0 }
    // Hot water only from 7 to 9 each morning, at more than the boiler's 3 kW.
    const sched = Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 9 ? 1 : 0))
    d.profiles.push({ id: 'occ', kind: 'occupancy', density: { value: 0.1, basis: 'per_m2' }, occupancy_rate: 1, sensible_w_per_person: 75, radiant_fraction: 0.3, schedule: { weekday: sched, saturday: sched, sunday: sched }, dhw: { basis: 'per_m2', litres_per_day: 6 } })
    for (const z of d.zones) z.profile_refs.occupancy = 'occ'
    const doc = ModelDocument.parse(d)
    const r = runModel(doc, W, c.lib, { ...REFEREE_OPTIONS, internal_gains: 'profiles' })
    const p = r.plants[0]
    expect(p.hot_water_id).toBe('hw')
    expect(p.hot_water_short_hours).toBeGreaterThan(300)
    expect(p.hot_water_short_kwh).toBeGreaterThan(0)
    for (let h = 0; h < W.hours.count; h++) {
      if (p.hot_water_given_frac![h] < 1) expect(p.zones.reduce((a, z) => a + z.given_w[h], 0)).toBe(0)
      expect(p.zones.reduce((a, z) => a + z.given_w[h], 0)).toBeLessThanOrEqual(3000 * (1 + 1e-9) + 1e-6)
    }
    // Systems serves only what the taps got (Rule 9 holds inside runSystems), and the shortfall is the plant's.
    const a = runSystems(doc, r, W.hours)
    if (!a.ok) throw new Error(JSON.stringify(a.missing))
    const s = a.systems
    const hw = s.groups.find((x) => x.id === 'hw')!
    expect(s.dhw!.demand_kwh - hw.served_kwh).toBeCloseTo(p.hot_water_short_kwh, 3)
    expect(p.reserved_kwh).toBeCloseTo(hw.served_kwh, 3)
  })
  it('a 2.8 document upgrades with no hot water heated first', () => {
    const d: any = structuredClone(cooledRoomDocument().doc)
    d.schema_version = '2.8'
    d.system_groups = [{ id: 'boiler', service: 'heating', zones: [d.zones[0].id], enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, capacity_kw: 10 }]
    expect(upgradeDocument(d).system_groups[0].dhw_priority_group_id).toBeNull()
  })
})
