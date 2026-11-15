/**
 * Brief 104 Part 3: the network solver.
 *
 * - On one zone it is Engine 1: the same inputs through runNetwork and runZone give the same hours.
 * - Every zone's balance closes every hour, and the heat one zone receives from another is what the other loses.
 * - runModel on the per-storey Bridgewater document closes per zone, and its junction lengths add up to the
 *   single-zone building's.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { innerElement, opaqueElement, windowElement, type Element, type Layer } from '../elements'
import { runNetwork, type NetworkInputs } from '../network'
import { runZone, type ZoneInputs } from '../zone'
import { REFEREE_OPTIONS, runModel } from '../model'
import { parseEpw } from '../epw'
import { readBuildingHeatingKwh } from '../results'
import { fromBuildingConfig } from '../../schema/fromBuildingConfig'

const H = 24 * 20
const WALL: Layer[] = [
  { kind: 'Material:NoMass', thermal_resistance: 2.5 },
  { kind: 'Material', thickness: 0.15, conductivity: 1.13, density: 2300, specific_heat: 1000 },
  { kind: 'Material', thickness: 0.013, conductivity: 0.16, density: 950, specific_heat: 840 },
]
const SLAB: Layer[] = [
  { kind: 'Material', thickness: 0.01, conductivity: 0.06, density: 200, specific_heat: 1300 },
  { kind: 'Material', thickness: 0.2, conductivity: 1.13, density: 2000, specific_heat: 1000 },
  { kind: 'Material', thickness: 0.013, conductivity: 0.16, density: 950, specific_heat: 840 },
]
const wave = (f: (h: number) => number) => Float64Array.from({ length: H }, (_, h) => f(h))
const day = (h: number) => Math.max(0, Math.sin(((h % 24) - 6) / 12 * Math.PI))
const te = wave((h) => 5 + 8 * Math.sin(((h % 24) - 9) / 24 * 2 * Math.PI) + (h / H) * 10)

function box(prefix: string) {
  const els: Element[] = [
    opaqueElement({ id: `${prefix}n`, area_m2: 30, tilt_deg: 90, boundary: 'outside', layers: WALL, stated_u: null, emissivity: 0.9, path: 'n' }),
    opaqueElement({ id: `${prefix}e`, area_m2: 20, tilt_deg: 90, boundary: 'outside', layers: WALL, stated_u: 0.3, emissivity: 0.9, path: 'e' }),
    opaqueElement({ id: `${prefix}r`, area_m2: 50, tilt_deg: 0, boundary: 'outside', layers: WALL, stated_u: null, emissivity: 0.9, path: 'r' }),
    opaqueElement({ id: `${prefix}g`, area_m2: 50, tilt_deg: 180, boundary: 'ground', layers: WALL, stated_u: null, emissivity: null, path: 'g' }),
    windowElement({ id: `${prefix}w`, area_m2: 8, tilt_deg: 90, u: 1.4, emissivity: 0.84, path: 'w', optics: { interior_transmitted: 0.4, interior_absorbed: 0.25 } }),
  ]
  const absorbed = [wave((h) => 120 * day(h)), wave((h) => 60 * day(h)), wave((h) => 300 * day(h)), wave(() => 0), wave((h) => 40 * day(h))]
  return { els, absorbed, alpha: [0.6, 0.7, 0.5, 0.8, null] as (number | null)[] }
}
const sol = wave((h) => 2500 * day(h)), beam = wave((h) => 1500 * day(h))
const vent = wave((h) => 20 + 10 * (h % 7))
const gains = wave((h) => (h % 24 >= 8 && h % 24 < 18 ? 800 : 100))

describe('runNetwork on one zone is runZone', () => {
  for (const [label, control, hcf, sp] of [
    ['air control, convective loads, heating and cooling', 'air', 1, { heat_c: 20, cool_c: 24 }],
    ['operative control, half-radiant loads', 'operative', 0.5, { heat_c: 21, cool_c: 23 }],
    ['free-floating', 'air', 1, { heat_c: null, cool_c: null }],
  ] as const) {
    it(label, () => {
      const b = box('')
      const zi: ZoneInputs = {
        elements: b.els, air_capacity_j_per_k: 2e6, bridging_w_per_k: 12, hours: H, theta_e: te, theta_ground: 9,
        ventilation_w_per_k: vent, solar_absorbed_w_per_m2: b.absorbed, solar_transmitted_w: sol, solar_beam_w: beam,
        inside_solar_absorptance: b.alpha, solar_convective_fraction: 0.1,
        other_gains: { w: gains, convective_fraction: 0.4 }, setpoints: sp, control, hc_convective_fraction: hcf,
        initial_c: 20, warmup_days: 3,
      }
      const ni: NetworkInputs = {
        zones: [{ air_capacity_j_per_k: 2e6, bridging_w_per_k: 12, ventilation_w_per_k: vent, solar_transmitted_w: sol, solar_beam_w: beam, other_gains: { w: gains, convective_fraction: 0.4 }, setpoints: sp, initial_c: 20 }],
        elements: b.els.map((element, k) => ({ element, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: b.absorbed[k], inside_solar_absorptance: b.alpha[k], inside_solar_absorptance_b: null })),
        hours: H, theta_e: te, theta_ground: 9, control, hc_convective_fraction: hcf, solar_convective_fraction: 0.1, warmup_days: 3,
      }
      const a = runZone(zi), n = runNetwork(ni)
      const z = n.zones[0]
      for (let h = 0; h < H; h++) {
        expect(z.theta_air[h]).toBeCloseTo(a.theta_air[h], 9)
        expect(z.theta_op[h]).toBeCloseTo(a.theta_op[h], 9)
        expect(z.heating_w[h]).toBeCloseTo(a.heating_w[h], 6)
        expect(z.cooling_w[h]).toBeCloseTo(a.cooling_w[h], 6)
        expect(z.terms.solar_lost_w[h]).toBeCloseTo(a.terms.solar_lost_w[h], 6)
      }
      for (let k = 0; k < b.els.length; k++) {
        let s = 0; for (let h = 0; h < H; h++) s += a.terms.boundary_w[k][h]
        expect(n.element_terms[k].boundary_wh).toBeCloseTo(s, 3)
      }
      expect(Math.max(...z.closure_wh)).toBeLessThanOrEqual(1e-6)
      expect(n.nodes).toBe(a.nodes)
      if (sp.heat_c != null) expect(Math.max(...z.heating_w)).toBeGreaterThan(0)
    })
  }
})

function twoStoreys(over: { setpoints?: [any, any] } = {}): NetworkInputs {
  const lo = box('lo_'), hi = box('hi_')
  // Lower storey: no roof; upper storey: no ground. The slab is the lower one's ceiling (zone_a 0, tilt 0) and the
  // upper one's floor (zone_b 1, tilt 180 on that face).
  const keep = (b: ReturnType<typeof box>, drop: number) => b.els.map((e, k) => ({ e, a: b.absorbed[k], al: b.alpha[k] })).filter((_, k) => k !== drop)
  const slab = innerElement({ id: 'slab', area_m2: 50, tilt_deg: 0, layers: SLAB, path: 'slab' })
  const sp = over.setpoints ?? [{ heat_c: 20, cool_c: 25 }, { heat_c: 18, cool_c: 23 }]
  const zone = (i: number) => ({
    air_capacity_j_per_k: 2e6, bridging_w_per_k: 10, ventilation_w_per_k: vent, solar_transmitted_w: sol, solar_beam_w: beam,
    other_gains: { w: gains, convective_fraction: 0.4 }, setpoints: sp[i], initial_c: 20,
  })
  return {
    zones: [zone(0), zone(1)],
    elements: [
      ...keep(lo, 2).map(({ e, a, al }) => ({ element: e, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: a, inside_solar_absorptance: al, inside_solar_absorptance_b: null })),
      ...keep(hi, 3).map(({ e, a, al }) => ({ element: e, zone_a: 1, zone_b: null, solar_absorbed_w_per_m2: a, inside_solar_absorptance: al, inside_solar_absorptance_b: null })),
      { element: slab, zone_a: 0, zone_b: 1, solar_absorbed_w_per_m2: wave(() => 0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: 0.7 },
      { element: innerElement({ id: 'mass', area_m2: 40, tilt_deg: 90, layers: SLAB, path: 'mass' }), zone_a: 1, zone_b: 1, solar_absorbed_w_per_m2: wave(() => 0), inside_solar_absorptance: 0.5, inside_solar_absorptance_b: 0.5 },
    ],
    hours: H, theta_e: te, theta_ground: 9, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0.1, warmup_days: 3,
  }
}

describe('two zones joined by a slab', () => {
  it('each zone closes every hour, and the slab\'s heat into one is the heat out of the other', () => {
    const r = runNetwork(twoStoreys())
    for (const z of r.zones) expect(Math.max(...z.closure_wh)).toBeLessThanOrEqual(1e-6)
    for (let h = 0; h < H; h++) expect(r.zones[0].terms.interzone_w[h] + r.zones[1].terms.interzone_w[h]).toBe(0)
    // Somewhere the slab carries heat (different setpoints drive it).
    expect(Math.max(...r.zones[1].terms.interzone_w.map(Math.abs))).toBeGreaterThan(1)
    // Internal mass is within one zone: no interzone heat from it.
    expect(r.element_interzone_wh[r.element_interzone_wh.length - 1]).not.toBeNull()
    expect(r.active_set.max_passes).toBeGreaterThanOrEqual(1)
  })
  it('holds each zone in its own band', () => {
    const r = runNetwork(twoStoreys())
    const [lo, hi] = r.zones
    for (let h = 0; h < H; h++) {
      expect(lo.theta_air[h]).toBeGreaterThan(20 - 1e-6); expect(lo.theta_air[h]).toBeLessThan(25 + 1e-6)
      expect(hi.theta_air[h]).toBeGreaterThan(18 - 1e-6); expect(hi.theta_air[h]).toBeLessThan(23 + 1e-6)
      if (lo.heating_w[h] > 0) expect(lo.theta_air[h]).toBeCloseTo(20, 6)
      if (hi.cooling_w[h] > 0) expect(hi.theta_air[h]).toBeCloseTo(23, 6)
    }
  })
  it('refuses a two-faced element without its second zone or absorptance, and a zone with no faces', () => {
    const a = twoStoreys(); (a.elements[a.elements.length - 2] as any).zone_b = null
    expect(() => runNetwork(a)).toThrow('zone_b')
    const b = twoStoreys(); b.elements[b.elements.length - 2].inside_solar_absorptance_b = null
    expect(() => runNetwork(b)).toThrow('inside_solar_absorptance_b')
    const c = twoStoreys(); c.zones.push({ ...c.zones[0] })
    expect(() => runNetwork(c)).toThrow('zones[2]: a zone needs at least one face')
  })
})

describe('runModel on the per-storey Bridgewater document', () => {
  const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
  const FIXTURE = parseYaml(readFileSync(repo('validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
  const lib = Object.fromEntries((FIXTURE.library_constructions as any[]).map((c) => [c.name, c.config_json]))
  const epw = (() => { try { return new Uint8Array(readFileSync(repo(`data/weather/current/${FIXTURE.building_config.weather_file}`))) } catch { return null } })()
  const doc = async (zoning: 'single' | 'per_storey') => (await fromBuildingConfig({
    building_config: structuredClone(FIXTURE.building_config), construction_choices: FIXTURE.construction_choices, comfort_band: FIXTURE.comfort_band,
    library_constructions: FIXTURE.library_constructions, weather: { file_name: FIXTURE.building_config.weather_file, file_hash: null },
    building_id: 'bridgewater-anchor',
  }, { zoning })).document
  it.skipIf(!epw)('closes per zone, the slabs cancel, and the junctions add up to the single zone\'s', async () => {
    const weather = await parseEpw(epw!)
    const one = runModel(await doc('single'), weather, lib, REFEREE_OPTIONS)
    const five = runModel(await doc('per_storey'), weather, lib, REFEREE_OPTIONS)
    expect(one.engine).toBe('thermal-1')
    expect(five.engine).toBe('thermal-2')
    expect(five.zones.length).toBeGreaterThan(1)
    let iz = 0, tb = 0
    for (const z of five.zones) {
      expect(z.closure.max_wh).toBeLessThanOrEqual(1)
      iz += z.breakdown.filter((l) => l.term === 'interzone').reduce((s, l) => s + l.kwh, 0)
      tb += z.conductances.bridging.total_w_per_k
    }
    expect(Math.abs(iz)).toBeLessThan(1e-6)
    expect(tb).toBeCloseTo(one.zones[0].conductances.bridging.total_w_per_k, 9)
    // Not a referee check (that is Part 5): the same building split by storey stays the same order of demand.
    const ratio = readBuildingHeatingKwh(five) / readBuildingHeatingKwh(one)
    expect(ratio).toBeGreaterThan(0.8); expect(ratio).toBeLessThan(1.2)
    console.log('per-storey Bridgewater', JSON.stringify({ zones: five.zones.length, nodes: five.solver.nodes, active_set: five.solver.active_set, run_ms: Math.round(five.run_ms), heating: five.zones.map((z) => +(z.annual.heating_kwh / 1000).toFixed(2)), cooling: five.zones.map((z) => +(z.annual.cooling_kwh / 1000).toFixed(2)), single: [one.zones[0].annual.heating_kwh / 1000, one.zones[0].annual.cooling_kwh / 1000] }))
  })
})
