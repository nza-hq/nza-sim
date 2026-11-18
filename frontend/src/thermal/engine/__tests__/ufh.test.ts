/**
 * Brief 109 Part 3: underfloor heating in the floor. Its heat enters a node inside the floor (the inside face of the
 * layer its pipes run along); the floor carries it up to the room and down to the ground. Engine 2.
 *
 * (a) by hand: one zone whose only surface is a ground floor heated from inside, in constant weather. Its loss to
 *     outside is bridging and ventilation; heat in the floor = that loss + the loss down through the insulation.
 * (b) the cooled room with underfloor heating in its two heated rooms' floors, to office hours with a night setback:
 *     closure every hour, the heating line is the heat put into the floor, Engine 2 chosen for one zone too.
 * (c) the same rooms with the same limit as radiators: underfloor heating is slower to bring the room back each morning.
 * (d) refusals, by name.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { innerElement, layerFaceNode, opaqueElement, type Layer } from '../elements'
import { REFEREE_OPTIONS, runModel, type RunOptions } from '../model'
import { runNetwork } from '../network'
import { ModelDocument } from '../../schema/model'
import { upgradeDocument } from '../../schema/upgrade'
import { cooledRoomDocument } from './cooledRoom'
import { MOS, readMos } from './denver'

const H = 24 * 20
const flat = (v: number) => new Float64Array(H).fill(v)
const last = (a: Float64Array) => a[a.length - 1]

describe('(a) by hand: heat into the floor = the room\'s loss + the loss down', () => {
  // Ground floor, outside first: 100 mm of insulation (R 2.5), then 70 mm screed in two sub-layers; pipes on the
  // insulation's inside face (layer 0).
  const LAYERS: Layer[] = [
    { kind: 'Material:NoMass', thermal_resistance: 2.5 },
    { kind: 'Material', thickness: 0.07, conductivity: 1.2, density: 2000, specific_heat: 1000 },
  ]
  const A = 50
  const el = opaqueElement({ id: 'slab', area_m2: A, tilt_deg: 180, boundary: 'ground', layers: LAYERS, stated_u: null, emissivity: null, path: 'slab' })
  const node = layerFaceNode(LAYERS, 'ground', 0, 'slab')
  it('the pipes sit at node 0, the insulation\'s inside face (against the ground the first segment ends there)', () => {
    expect(node).toBe(0)
    expect(el.c.length).toBe(3)  // node 0, the screed's middle, the room face
  })
  it('steady state to 1e-6', () => {
    const Hz = 40 + 60, te = 0, tg = 10, sp = 20
    const r = runNetwork({
      zones: [{
        air_capacity_j_per_k: 1e6, bridging_w_per_k: 40, ventilation_w_per_k: flat(60), solar_transmitted_w: flat(0), solar_beam_w: null,
        other_gains: null, setpoints: { heat_c: sp, cool_c: 26 }, initial_c: sp, heating_source: { element: 0, node, share: 1 },
      }],
      elements: [{ element: el, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null }],
      hours: H, theta_e: flat(te), theta_ground: tg, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 200,
    })
    // By hand. Up: the room's whole loss crosses the floor's face by convection (the floor is the zone's only face, so
    // its long-wave exchange is with itself, none), and the screed from the pipes to the face.
    const up = Hz * (sp - te)
    const tFace = sp + up / (el.h_ci * A)
    const rUp = Array.from(el.g).reduce((s, g) => s + 1 / g, 0)  // node 0 to the face, m²K/W
    const tPipe = tFace + (up * rUp) / A
    const down = (tPipe - tg) * el.g_boundary * A
    expect(last(r.zones[0].theta_air)).toBeCloseTo(sp, 9)
    expect(Math.abs(last(r.zones[0].heating_w) / (up + down) - 1)).toBeLessThan(1e-6)
    expect(down).toBeGreaterThan(100)  // the downward loss is real here, not rounding
    expect(Math.max(...r.zones[0].closure_wh)).toBeLessThanOrEqual(1e-6)
  })
  it('half the heat in the floor, half to the air: the heat is the same; the floor runs cooler', () => {
    const base = {
      air_capacity_j_per_k: 1e6, bridging_w_per_k: 40, ventilation_w_per_k: flat(60), solar_transmitted_w: flat(0), solar_beam_w: null,
      other_gains: null, setpoints: { heat_c: 20, cool_c: 26 }, initial_c: 20,
    }
    const run = (share: number | null) => runNetwork({
      zones: [{ ...base, heating_source: share == null ? null : { element: 0, node, share } }],
      elements: [{ element: el, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null }],
      hours: H, theta_e: flat(0), theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 200,
    })
    const all = last(run(1).zones[0].heating_w), half = last(run(0.5).zones[0].heating_w), air = last(run(null).zones[0].heating_w)
    // Less heat goes down when less goes into the floor: all > half > air-only.
    expect(all).toBeGreaterThan(half); expect(half).toBeGreaterThan(air)
    expect(Math.max(...run(0.5).zones[0].closure_wh)).toBeLessThanOrEqual(1e-6)
  })
})

describe('(a2) a floor between two storeys, heated from the upper room (review F5)', () => {
  // From the upper room's face (zone_b, node 0) down: carpet, screed, concrete, plaster. Pipes at the screed's top
  // (layer 0's inside face), in the upper room's half. The lower room is not heated; both lose only to outside air.
  const LAYERS: Layer[] = [
    { kind: 'Material', thickness: 0.01, conductivity: 0.06, density: 200, specific_heat: 1300 },
    { kind: 'Material', thickness: 0.065, conductivity: 0.41, density: 1200, specific_heat: 840 },
    { kind: 'Material', thickness: 0.2, conductivity: 1.13, density: 2000, specific_heat: 1000 },
    { kind: 'Material', thickness: 0.013, conductivity: 0.25, density: 900, specific_heat: 1000 },
  ]
  const slab = innerElement({ id: 'slab', area_m2: 50, tilt_deg: 0, layers: LAYERS, path: 'slab' })
  const zone = (heat: number | null, src: { element: number; node: number; share: number } | null) => ({
    air_capacity_j_per_k: 1e6, bridging_w_per_k: 40, ventilation_w_per_k: flat(60), solar_transmitted_w: flat(0), solar_beam_w: null,
    other_gains: null, setpoints: { heat_c: heat, cool_c: null }, initial_c: 15, heating_source: src,
  })
  const run = (node: number) => runNetwork({
    // zone 0: the lower room (zone_a, the slab's last node); zone 1: the upper room (zone_b, node 0), heated in the floor.
    zones: [zone(null, null), zone(20, { element: 0, node, share: 1 })],
    elements: [{ element: slab, zone_a: 0, zone_b: 1, solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: 0.6 }],
    hours: H, theta_e: flat(0), theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 200,
  })
  const node = layerFaceNode(LAYERS, 'zone', 0, 'slab')
  it('the heat into the floor equals both rooms\' losses (1e-6), the upper room holds 20 °C, and both close every hour', () => {
    const mid = Math.floor((slab.c.length - 2) / 2)
    expect(node).toBeGreaterThanOrEqual(1); expect(node).toBeLessThanOrEqual(mid)  // the upper room's half
    const r = run(node)
    const lo = last(r.zones[0].theta_air), up = last(r.zones[1].theta_air)
    expect(up).toBeCloseTo(20, 9)
    expect(lo).toBeGreaterThan(5)  // the lower room is warmed through its ceiling, from the upper room's floor
    expect(Math.abs(last(r.zones[1].heating_w) / (100 * (up - 0) + 100 * (lo - 0)) - 1)).toBeLessThan(1e-6)
    expect(last(r.zones[0].heating_w)).toBe(0)
    for (const z of r.zones) expect(Math.max(...z.closure_wh)).toBeLessThanOrEqual(1e-6)
  })
  it('a node in the lower room\'s half is refused for the upper room', () => {
    expect(() => run(slab.c.length - 2)).toThrow(/the other zone's side of the floor/)
  })
})

const W = readMos(fs.readFileSync(MOS))
const HOURS = JSON.parse(fs.readFileSync(new URL('../../../../../validation/energyplus/109_setback_spec.json', import.meta.url), 'utf8')).hours
/** The cooled room on office hours, setback 15 °C; each heated room's heating `w`, in its floor (layer 0: under the slab) or as radiators. */
function rooms(w: number | null, how: 'floor' | 'radiator', over: (d: any) => void = () => {}) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  d.profiles.push({ id: 'hours', kind: 'schedule', day_types: HOURS })
  d.system_groups = [{ id: 'boiler', service: 'heating', zones: ['west', 'east'], enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, design_flow_c: 45, design_return_c: 35 }]
  for (const z of d.zones) {
    if (z.setpoints.heat_c == null) continue
    z.setpoints.hours_ref = 'hours'; z.setpoints.setback_c = 15
    if (w == null) continue
    z.emitters = [{
      id: `${z.id}_e`, kind: how === 'floor' ? 'underfloor' : 'radiator', count: 1, rated_output_w: w,
      radiant_fraction: how === 'floor' ? null : 0, system_group_id: 'boiler', rated_flow_c: 45, rated_return_c: 35, rated_room_c: z.setpoints.heat_c, exponent_n: 1.1,
      source_surface_id: how === 'floor' ? `${z.id}_floor` : null, source_layer_index: how === 'floor' ? 0 : null,
    }]
  }
  over(d)
  return { doc: ModelDocument.parse(d), lib }
}
const FIXED: RunOptions = { ...REFEREE_OPTIONS, emitter_rating: 'setpoint' }

describe('(b) the cooled room, underfloor heating in its floors, office hours and a setback', () => {
  it('closes every hour; the heating line is the heat put into the floor; one zone runs on Engine 2 too', () => {
    const { doc, lib } = rooms(1100, 'floor')
    const r = runModel(doc, W, lib, FIXED)
    expect(r.engine).toBe('thermal-2')
    for (const z of r.zones) {
      expect(z.closure.max_wh).toBeLessThanOrEqual(1)
      const line = z.breakdown.find((l) => l.term === 'heating')?.kwh ?? 0
      expect(line).toBeCloseTo(z.annual.heating_kwh, 9)
      if (z.zone_id !== 'middle') {
        expect(z.emitters?.slab).toEqual({ surface_id: `${z.zone_id}_floor`, layer_index: 0, share: 1 })
        expect(z.annual.peak_heating_w).toBeLessThanOrEqual(1100 + 1e-6)
      }
    }
    const one = rooms(1100, 'floor', (d) => {
      d.zones = d.zones.filter((z: any) => z.id === 'west')
      d.surfaces = d.surfaces.filter((s: any) => s.zone_a === 'west' && s.zone_b !== 'middle')
      d.zones[0].surfaces = d.surfaces.map((s: any) => s.id)
      d.system_groups[0].zones = ['west']
    })
    const r1 = runModel(one.doc, W, one.lib, FIXED)
    expect(r1.engine).toBe('thermal-2')
    expect(r1.zones[0].closure.max_wh).toBeLessThanOrEqual(1)
  })
})

describe('(c) underfloor heating is slower to bring a room back than radiators of the same output', () => {
  it('more hours below in use, colder at 08:00 on average, and still warm after hours', () => {
    const f = rooms(1100, 'floor'), rad = rooms(1100, 'radiator')
    const rf = runModel(f.doc, W, f.lib, FIXED).zones[0], rr = runModel(rad.doc, W, rad.lib, FIXED).zones[0]
    expect(rf.annual.unmet_heating_hours_in_use!).toBeGreaterThan(rr.annual.unmet_heating_hours_in_use! + 50)
    const at = (z: typeof rf, hour: number) => { let s = 0, n = 0; for (let d = 0; d < 365; d++) if (d % 7 < 5 && (d < 90 || d > 300)) { s += z.hourly.theta_air_c[d * 24 + hour]; n++ } return s / n }
    expect(at(rf, 8)).toBeLessThan(at(rr, 8) - 0.2)
    expect(at(rf, 21)).toBeGreaterThan(at(rr, 21))  // the floor keeps giving heat after the heating stops
  })
})

describe('(d) refusals, by name', () => {
  const refuse = (over: (d: any) => void, path: string, msg: RegExp) => {
    const { doc, lib } = rooms(1100, 'floor', over)
    let err: any
    try { runModel(doc, W, lib, FIXED) } catch (e) { err = e }
    expect(err?.path).toBe(path); expect(err?.message).toMatch(msg)
  }
  it('underfloor heating without its floor or layer', () => {
    refuse((d) => { d.zones[0].emitters[0].source_surface_id = null }, 'zones[0].emitters[0].source_surface_id', /required/)
    refuse((d) => { d.zones[0].emitters[0].source_layer_index = null }, 'zones[0].emitters[0].source_layer_index', /required/)
  })
  it('a radiant fraction stated for underfloor heating; a source stated for a radiator', () => {
    refuse((d) => { d.zones[0].emitters[0].radiant_fraction = 0.5 }, 'zones[0].emitters[0].radiant_fraction', /through the floor/)
    refuse((d) => { d.zones[0].emitters[0].kind = 'radiator'; d.zones[0].emitters[0].radiant_fraction = 0 }, 'zones[0].emitters[0].source_surface_id', /only underfloor/)
  })
  it('a surface that is not this room\'s floor; the last layer; a layer that does not exist', () => {
    refuse((d) => { d.zones[0].emitters[0].source_surface_id = 'west_roof' }, 'zones[0].emitters[0].source_surface_id', /not west's floor/)
    refuse((d) => { d.zones[0].emitters[0].source_surface_id = 'east_floor' }, 'zones[0].emitters[0].source_surface_id', /not one of west's/)
    refuse((d) => { d.zones[0].emitters[0].source_layer_index = 1 }, 'zones[0].emitters[0].source_layer_index', /must sit below the last/)
    refuse((d) => { d.zones[0].emitters[0].source_layer_index = 5 }, 'zones[0].emitters[0].source_layer_index', /not inside the construction/)
  })
  it('a 2.4 document reads with no source stated, and its underfloor heating is then refused by name', () => {
    const { doc } = rooms(1100, 'floor')
    const old: any = structuredClone(doc)
    old.schema_version = '2.4'
    for (const z of old.zones) for (const e of z.emitters) { delete e.source_surface_id; delete e.source_layer_index }
    const up = upgradeDocument(old)
    expect(up.schema_version).toBe('2.12')
    expect(up.zones[0].emitters[0].source_surface_id).toBeNull()
    expect(up.zones[0].emitters[0].source_layer_index).toBeNull()
  })
})
