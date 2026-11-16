/**
 * Brief 119 Part 1: cooling limited to the zone's units (fan coils, VRF indoor units), on Engines 1 and 2: the mirror
 * of Brief 108's heating limit (emitters.test.ts).
 *
 * (a) one zone in steady hot weather settles where its gain equals the cap, by hand, on both engines and every solver
 * path; (b) two zones, one limited: the neighbour picks up the heat it now gains through the partition, by hand;
 * (c) units above the peak change nothing, value for value; (d) the cooled room limited below its peak: never above
 * the cap, closed every hour, unmet hours above the setpoint counted; (e) a unit that cools only does not limit
 * heating; (f) refusals by name.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ENGINE_CONSTANTS as K } from '../constants'
import { innerElement, opaqueElement, type Element, type Layer } from '../elements'
import { zoneCooling, zoneEmitters } from '../emitters'
import { REFEREE_OPTIONS, runModel, UNMET_K, type RunOptions } from '../model'
import { runNetwork, type NetworkElement, type NetworkInputs } from '../network'
import { runZone, type ZoneInputs } from '../zone'
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
const HOT = 40
const zone1 = (els: Element[], over: Partial<ZoneInputs> = {}): ZoneInputs => ({
  elements: els, air_capacity_j_per_k: 1e6, bridging_w_per_k: 40, hours: H, theta_e: flat(HOT), theta_ground: 10, ventilation_w_per_k: flat(60),
  solar_absorbed_w_per_m2: els.map(() => flat(0)), solar_transmitted_w: flat(0), other_gains: null,
  setpoints: { heat_c: 20, cool_c: 26 }, control: 'air', hc_convective_fraction: 1, initial_c: 26, warmup_days: 60, ...over,
})
const last = (a: Float64Array) => a[a.length - 1]

describe('(a) one zone in steady hot weather settles where its gain equals the cap', () => {
  const els = [wall('a', 60), wall('b', 40)]
  const k = els.reduce((s, e) => s + e.area_m2 / (Rchain(e) + 1 / e.h_ci), 0) + 40 + 60  // W/K, air to 40 °C outside
  const cap = 7 * k  // half of the unlimited (40 − 26)·k
  it('Engine 1: unlimited needs 14·k; limited at half, the air settles at 40 − cap / k, and every hour closes', () => {
    const free = runZone(zone1(els))
    expect(last(free.cooling_w)).toBeCloseTo(14 * k, 6)
    const r = runZone(zone1(els, { cooling_cap_w: cap }))
    expect(last(r.cooling_w)).toBeCloseTo(cap, 9)
    expect(Math.abs(last(r.theta_air) - (HOT - cap / k))).toBeLessThan(0.01)
    expect(Math.max(...r.cooling_w)).toBeLessThanOrEqual(cap * (1 + 1e-12))
    expect(Math.max(...r.heating_w)).toBe(0)
    expect(Math.max(...r.closure_wh)).toBeLessThanOrEqual(1)
  })
  it('Engine 2, the same zone alone: the same, on the admittance, dense and operative paths', () => {
    const net: NetworkInputs = {
      zones: [{ air_capacity_j_per_k: 1e6, bridging_w_per_k: 40, ventilation_w_per_k: flat(60), solar_transmitted_w: flat(0), solar_beam_w: null, other_gains: null, setpoints: { heat_c: 20, cool_c: 26 }, initial_c: 26, cooling_cap_w: cap }],
      elements: els.map((element) => ({ element, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null })),
      hours: H, theta_e: flat(HOT), theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 60,
    }
    const r = runNetwork(net)
    expect(last(r.zones[0].cooling_w)).toBeCloseTo(cap, 9)
    expect(Math.abs(last(r.zones[0].theta_air) - (HOT - cap / k))).toBeLessThan(0.01)
    // Half radiant (the dense path, not the admittance form): still the cap, still closed.
    const r2 = runNetwork({ ...net, hc_convective_fraction: 0.5 })
    expect(last(r2.zones[0].cooling_w)).toBeCloseTo(cap, 9)
    expect(Math.max(...r2.zones[0].closure_wh)).toBeLessThanOrEqual(1e-6)
    // Operative control: the cap holds; the zone sits above its operative setpoint.
    const r3 = runNetwork({ ...net, control: 'operative' })
    expect(last(r3.zones[0].cooling_w)).toBeCloseTo(cap, 9)
    expect(last(r3.zones[0].theta_op)).toBeGreaterThan(26 + UNMET_K)
    expect(Math.max(...r3.zones[0].closure_wh)).toBeLessThanOrEqual(1e-6)
    // A cap above the need changes nothing.
    const r4 = runNetwork({ ...net, zones: [{ ...net.zones[0], cooling_cap_w: 20 * k }] })
    const r5 = runNetwork({ ...net, zones: [{ ...net.zones[0], cooling_cap_w: null }] })
    expect(Array.from(r4.zones[0].cooling_w)).toEqual(Array.from(r5.zones[0].cooling_w))
  })
})

describe('(b) two zones, one limited', () => {
  it('zone 1 floats at (UA·26 + H₁·40 − cap) / (UA + H₁); zone 0 cools its own gain plus UA·(T₁ − 26)', () => {
    const A = 15, H0 = 12, H1 = 10, HC = K.h_ci_horizontal
    const BLOCK: Layer[] = [{ kind: 'Material', thickness: 0.1, conductivity: 0.51, density: 1400, specific_heat: 1000 }]
    const UA = 1 / (1 / (HC * A) + 0.1 / 0.51 / A + 1 / (HC * A))
    const part: NetworkElement = {
      element: innerElement({ id: 'p', area_m2: A, tilt_deg: 90, layers: BLOCK, path: 'p' }), zone_a: 1, zone_b: 0,
      solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: 0.6,
    }
    const base = (cap: number | null): NetworkInputs => ({
      zones: [H0, H1].map((Hb, i) => ({
        air_capacity_j_per_k: 1e4, bridging_w_per_k: Hb, ventilation_w_per_k: flat(0), solar_transmitted_w: flat(0), solar_beam_w: null,
        other_gains: null, setpoints: { heat_c: 20, cool_c: 26 }, initial_c: 26, cooling_cap_w: i === 1 ? cap : null,
      })),
      elements: [part], hours: H, theta_e: flat(HOT), theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 60,
    })
    const free = runNetwork(base(null))
    expect(last(free.zones[1].cooling_w)).toBeCloseTo(14 * H1, 7)
    const cap = 80
    const r = runNetwork(base(cap))
    const T1 = (UA * 26 + H1 * HOT - cap) / (UA + H1)
    expect(last(r.zones[1].theta_air)).toBeCloseTo(T1, 7)
    expect(last(r.zones[1].cooling_w)).toBeCloseTo(cap, 9)
    expect(last(r.zones[0].cooling_w)).toBeCloseTo(14 * H0 + UA * (T1 - 26), 6)
    for (const z of r.zones) expect(Math.max(...z.closure_wh)).toBeLessThanOrEqual(1e-6)
  })
})

// ── (c)–(f): the cooled room (west and east heated, middle cooled) with a fan coil in the middle ──────────────────
const W = readMos(fs.readFileSync(MOS))
function withUnits(coolW: number | null, over: (d: any) => void = () => {}) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  if (coolW != null) {
    const mid = d.zones.find((z: any) => z.setpoints.cool_c != null)
    mid.emitters = [{ id: 'fcu', kind: 'fan_coil', count: 2, heats: false, cooling_output_w: coolW / 2, rated_output_w: null, radiant_fraction: null, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
  }
  over(d)
  return { doc: ModelDocument.parse(d), lib }
}
const OPTS: RunOptions = REFEREE_OPTIONS
const cooledIndex = (doc: ModelDocument) => doc.zones.findIndex((z) => z.setpoints.cool_c != null)

describe('(c) units above the peak change nothing', () => {
  it('every hourly cooling, heating and temperature value equal to the run without units', () => {
    const a = withUnits(null), base = runModel(a.doc, W, a.lib, OPTS)
    const b = withUnits(1e9), r = runModel(b.doc, W, b.lib, OPTS)
    r.zones.forEach((z, i) => {
      expect(Array.from(z.hourly.cooling_w)).toEqual(Array.from(base.zones[i].hourly.cooling_w))
      expect(Array.from(z.hourly.heating_w)).toEqual(Array.from(base.zones[i].hourly.heating_w))
      expect(Array.from(z.hourly.theta_air_c)).toEqual(Array.from(base.zones[i].hourly.theta_air_c))
    })
    const ci = cooledIndex(b.doc)
    expect(r.zones[ci].cooling_units).toMatchObject({ cap_w: 1e9, hours_at_cap: 0 })
    expect(r.zones[ci].emitters).toBeNull()  // a unit that cools only is not a heating emitter
    expect(base.zones[ci].cooling_units).toBeNull()
  })
})

describe('(d) the cooled room limited below its peak', () => {
  for (const [label, opts] of [['air control', OPTS], ['operative control', { ...OPTS, control: 'operative' as const }], ['quarter hours', { ...OPTS, time_step: { steps_per_hour: 4, theta_e_between: 'linear' as const } }]] as const) {
    it(`${label}: never above the cap, closes every hour, warmer, with hours above the setpoint`, () => {
      const a = withUnits(null), base = runModel(a.doc, W, a.lib, opts)
      const ci = cooledIndex(a.doc)
      const cap = 0.6 * base.zones[ci].annual.peak_cooling_w
      const b = withUnits(cap), r = runModel(b.doc, W, b.lib, opts)
      const z = r.zones[ci]
      expect(Math.max(...z.hourly.cooling_w)).toBeLessThanOrEqual(cap * (1 + 1e-9))
      expect(z.closure.max_wh).toBeLessThanOrEqual(1)
      expect(z.annual.cooling_kwh).toBeLessThan(base.zones[ci].annual.cooling_kwh)
      expect(z.annual.max_control_c).toBeGreaterThan(base.zones[ci].annual.max_control_c + 1)
      expect(z.annual.unmet_cooling_hours!).toBeGreaterThan(base.zones[ci].annual.unmet_cooling_hours!)
      expect(z.cooling_units!.hours_at_cap).toBeGreaterThan(0)
      expect(z.cooling_units!.hours_at_cap).toBeGreaterThanOrEqual(z.annual.unmet_cooling_hours! - 1)  // above the setpoint only at the cap
      for (const q of r.zones) expect(q.closure.max_wh).toBeLessThanOrEqual(1)
      // emitter_limit 'none' lifts the cooling limit too (the sizing run).
      const free = runModel(b.doc, W, b.lib, { ...opts, emitter_limit: 'none' })
      expect(Array.from(free.zones[ci].hourly.cooling_w)).toEqual(Array.from(base.zones[ci].hourly.cooling_w))
    })
  }
  it('Engine 1 (the cooled room alone): the same', () => {
    const one = (coolW: number | null) => withUnits(coolW, (d) => {
      const mid = d.zones.find((z: any) => z.setpoints.cool_c != null)
      d.zones = [mid]
      d.surfaces = d.surfaces.filter((s: any) => s.zone_a === mid.id && (s.zone_b === 'outside' || s.zone_b === 'ground'))
      mid.surfaces = mid.surfaces.filter((id: string) => d.surfaces.some((s: any) => s.id === id))
      d.system_groups = []
    })
    const a = one(null), base = runModel(a.doc, W, a.lib, OPTS)
    expect(base.engine).toBe('thermal-1')
    const cap = 0.6 * base.zones[0].annual.peak_cooling_w
    const b = one(cap), r = runModel(b.doc, W, b.lib, OPTS)
    const z = r.zones[0]
    expect(Math.max(...z.hourly.cooling_w)).toBeLessThanOrEqual(cap * (1 + 1e-9))
    expect(z.closure.max_wh).toBeLessThanOrEqual(1)
    expect(z.annual.unmet_cooling_hours!).toBeGreaterThan(base.zones[0].annual.unmet_cooling_hours!)
  })
})

describe('(e) a unit that cools only does not limit heating; a unit that does both limits both', () => {
  it('the heating cap is the heating emitters\' alone', () => {
    const b = withUnits(500, (d) => {
      const mid = d.zones.find((z: any) => z.setpoints.cool_c != null)
      mid.setpoints.heat_c = 20
      d.system_groups = [{ id: 'boiler', service: 'heating', zones: [mid.id], enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, design_flow_c: 75, design_return_c: 65 }]
      mid.emitters.push({ id: 'rad', kind: 'radiator', count: 1, rated_output_w: 700, radiant_fraction: 0.3, system_group_id: 'boiler', rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.3 })
    })
    const ci = cooledIndex(b.doc)
    expect(zoneEmitters(b.doc)[ci]!.cap_w).toBeCloseTo(700, 9)
    expect(zoneEmitters(b.doc)[ci]!.emitters.map((e) => e.id)).toEqual(['rad'])
    expect(zoneCooling(b.doc)[ci]).toEqual({ cap_w: 500, units: [{ id: 'fcu', kind: 'fan_coil', output_w: 500 }] })
  })
  it('a VRF indoor unit that heats and cools: both caps from the one unit', () => {
    const b = withUnits(null, (d) => {
      const mid = d.zones.find((z: any) => z.setpoints.cool_c != null)
      mid.setpoints.heat_c = 20
      mid.emitters = [{ id: 'vrf', kind: 'vrf_indoor', count: 2, rated_output_w: 400, cooling_output_w: 350, radiant_fraction: 0, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
    })
    const ci = cooledIndex(b.doc)
    expect(zoneEmitters(b.doc)[ci]!.cap_w).toBe(800)
    expect(zoneCooling(b.doc)[ci]!.cap_w).toBe(700)
  })
})

describe('(f) refusals by name, nothing filled', () => {
  const mid = (d: any) => d.zones.find((z: any) => z.setpoints.cool_c != null)
  it('cooling on a kind that does not cool; a radiator that does not heat', () => {
    expect(() => withUnits(null, (d) => { mid(d).emitters = [{ id: 'r', kind: 'radiator', count: 1, rated_output_w: 1, cooling_output_w: 100, radiant_fraction: 0, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }] })).toThrow('a radiator does not cool')
    expect(() => withUnits(null, (d) => { mid(d).emitters = [{ id: 'r', kind: 'electric', count: 1, heats: false, rated_output_w: null, radiant_fraction: null, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }] })).toThrow('a electric heats')
  })
  it('a unit that does not heat: its heating fields empty, its cooling stated', () => {
    const a = withUnits(500, (d) => { mid(d).emitters[0].rated_output_w = 300 })
    expect(() => zoneEmitters(a.doc)).toThrow('rated_output_w: leave empty: this unit does not heat')
    const b = withUnits(500, (d) => { mid(d).emitters[0].cooling_output_w = null })
    expect(() => zoneCooling(b.doc)).toThrow('cooling_output_w: required')
  })
  it('cooling units need a cooling setpoint', () => {
    const a = withUnits(500, (d) => { mid(d).setpoints.cool_c = null })
    expect(() => zoneCooling(a.doc)).toThrow('setpoints.cool_c: a zone with cooling units needs a cooling setpoint')
  })
  it('2.6 → 2.7: every emitter heats, none cools, none names a catalogue item', () => {
    const { doc } = cooledRoomDocument()
    const d: any = structuredClone(doc)
    d.schema_version = '2.6'
    d.zones[0].emitters = [{ id: 'e', kind: 'electric', count: 1, rated_output_w: 500, radiant_fraction: 0, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null, source_surface_id: null, source_layer_index: null }]
    const up = upgradeDocument(d)
    expect(up.schema_version).toBe('2.7')
    expect(up.zones[0].emitters[0]).toMatchObject({ heats: true, cooling_output_w: null, catalogue_ref: null, rated_output_w: 500 })
  })
})
