/**
 * Brief 104 Part 4: multi-zone gates.
 *
 * (a) two zones in steady state against the hand value; (b) three zones in a row, hand-solved; (c) identical
 * uncoupled zones; (d) internal mass, its step response against the hand recursion; (e) the cooled room against
 * EnergyPlus built from the same inputs (validation/energyplus/104_cooled_room_spec.json and
 * docs/audit/104/04_cooled_room_energyplus.json, both committed, so this runs from a fresh checkout).
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENGINE_CONSTANTS as K } from '../constants'
import { innerElement, opaqueElement, windowElement, type ConstructionBody, type Element, type Layer } from '../elements'
import { REFEREE_OPTIONS, runModel } from '../model'
import { runNetwork, type NetworkElement, type NetworkInputs, type NetworkZone } from '../network'
import { readBuildingCoolingKwh, readBuildingHeatingKwh } from '../results'
import { runZone } from '../zone'
import { ModelDocument } from '../../schema/model'
import { MOS, MOS_SHA, readMos } from './denver'

const BLOCK: Layer[] = [
  { kind: 'Material', thickness: 0.012, conductivity: 0.16, density: 950, specific_heat: 840 },
  { kind: 'Material', thickness: 0.1, conductivity: 0.51, density: 1400, specific_heat: 1000 },
  { kind: 'Material', thickness: 0.012, conductivity: 0.16, density: 950, specific_heat: 840 },
]
const R_BLOCK = 0.012 / 0.16 + 0.1 / 0.51 + 0.012 / 0.16
const HC = K.h_ci_horizontal  // a vertical face: heat flows horizontally

function inputs(H: number, zones: Partial<NetworkZone>[], elements: NetworkElement[], warmup = 60): NetworkInputs {
  const zero = new Float64Array(H)
  return {
    zones: zones.map((z) => ({
      air_capacity_j_per_k: 1e4, bridging_w_per_k: 0, ventilation_w_per_k: zero, solar_transmitted_w: zero, solar_beam_w: null,
      other_gains: null, setpoints: { heat_c: null, cool_c: null }, initial_c: 15, ...z,
    })),
    elements, hours: H, theta_e: zero, theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: warmup,
  }
}
const inner = (id: string, area: number, zone_a: number, zone_b: number, H: number, layers = BLOCK): NetworkElement => ({
  element: innerElement({ id, area_m2: area, tilt_deg: 90, layers, path: id }), zone_a, zone_b,
  solar_absorbed_w_per_m2: new Float64Array(H), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: 0.6,
})
const last = (a: Float64Array) => a[a.length - 1]

describe('(a) two zones, steady state', () => {
  it('a partition between a zone held at 20 °C and a free zone losing to 0 °C outside: the free zone settles on the hand value', () => {
    const H = 48, A = 15, Hout = 10
    const r = runNetwork(inputs(H, [{ setpoints: { heat_c: 20, cool_c: 20 } }, { bridging_w_per_k: Hout }], [inner('p', A, 1, 0, H)]))
    // Each zone has one face, so no long-wave exchange: air → film → layers → film → air, in series.
    const UA = 1 / (1 / (HC * A) + R_BLOCK / A + 1 / (HC * A))
    const tB = (UA * 20) / (UA + Hout)
    expect(last(r.zones[1].theta_air)).toBeCloseTo(tB, 9)
    expect(last(r.zones[0].heating_w)).toBeCloseTo(UA * (20 - tB), 7)
    expect(last(r.zones[0].terms.interzone_w)).toBeCloseTo(-UA * (20 - tB), 7)
    for (const z of r.zones) expect(Math.max(...z.closure_wh)).toBeLessThanOrEqual(1e-6)
  })
})

describe('(b) three zones in a row', () => {
  it('outer zones held at 20 °C and 10 °C, the middle one free with two partitions of different area: hand-solved', () => {
    const H = 48, A1 = 20, A2 = 10, Hout = 8
    const r = runNetwork(inputs(H, [
      { setpoints: { heat_c: 20, cool_c: 20 } }, { bridging_w_per_k: Hout }, { setpoints: { heat_c: 10, cool_c: 10 } },
    ], [inner('p1', A1, 1, 0, H), inner('p2', A2, 1, 2, H)]))
    // Unknowns: the middle zone's two faces f1, f2 and its air t. Each outer zone reaches its partition's middle face
    // through K_i = 1 / (1/(h_c A) + R/A); the two middle faces exchange long-wave g = h_ri A1 A2 / (A1 + A2)
    // (ISO 52016-1 eq. 30); each face reaches the middle air by convection h_c A.
    const K1 = 1 / (1 / (HC * A1) + R_BLOCK / A1), K2 = 1 / (1 / (HC * A2) + R_BLOCK / A2)
    const g = (K.h_ri * A1 * A2) / (A1 + A2), c1 = HC * A1, c2 = HC * A2
    const M = [
      [K1 + c1 + g, -g, -c1],
      [-g, K2 + c2 + g, -c2],
      [-c1, -c2, c1 + c2 + Hout],
    ]
    const b = [K1 * 20, K2 * 10, 0]
    const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    const col = (j: number) => M.map((row, i) => row.map((v, k) => (k === j ? b[i] : v)))
    const D = det(M), f1 = det(col(0)) / D, f2 = det(col(1)) / D, t = det(col(2)) / D
    const z = r.zones[1]
    expect(last(z.theta_air)).toBeCloseTo(t, 9)
    expect(last(z.theta_mrt)).toBeCloseTo((A1 * f1 + A2 * f2) / (A1 + A2), 9)
    expect(last(r.zones[0].heating_w)).toBeCloseTo(K1 * (20 - f1), 7)
    expect(last(r.zones[2].cooling_w)).toBeCloseTo(K2 * (f2 - 10), 7)
    const iz = r.zones.map((q) => last(q.terms.interzone_w))
    expect(iz[0] + iz[1] + iz[2]).toBeCloseTo(0, 12)
  })
})

describe('(c) identical uncoupled zones', () => {
  it('three copies of one zone in one network give three times the one-zone result, hour by hour', () => {
    const H = 24 * 10
    const WALL: Layer[] = [{ kind: 'Material:NoMass', thermal_resistance: 2 }, ...BLOCK]
    const make = (p: string): Element[] => [
      opaqueElement({ id: `${p}w`, area_m2: 40, tilt_deg: 90, boundary: 'outside', layers: WALL, stated_u: null, emissivity: 0.9, path: 'w' }),
      opaqueElement({ id: `${p}r`, area_m2: 25, tilt_deg: 0, boundary: 'outside', layers: WALL, stated_u: null, emissivity: 0.9, path: 'r' }),
      opaqueElement({ id: `${p}g`, area_m2: 25, tilt_deg: 180, boundary: 'ground', layers: WALL, stated_u: null, emissivity: null, path: 'g' }),
      windowElement({ id: `${p}win`, area_m2: 6, tilt_deg: 90, u: 1.6, emissivity: 0.84, path: 'win', optics: { interior_transmitted: 0.4, interior_absorbed: 0.2 } }),
    ]
    const te = Float64Array.from({ length: H }, (_, h) => 8 + 8 * Math.sin((h / 24) * 2 * Math.PI))
    const sun = Float64Array.from({ length: H }, (_, h) => (h < H / 2 ? 300 : 5000) * Math.max(0, Math.sin((((h % 24) - 6) / 12) * Math.PI)))
    const abs = (els: Element[]) => els.map((_, k) => Float64Array.from(sun, (v) => (k < 2 ? v / 20 : k === 3 ? v / 50 : 0)))
    const alpha = [0.6, 0.6, 0.6, null]
    const vent = new Float64Array(H).fill(15)
    const sp = { heat_c: 20, cool_c: 24 }
    const one = runZone({
      elements: make(''), air_capacity_j_per_k: 1e6, bridging_w_per_k: 5, hours: H, theta_e: te, theta_ground: 10, ventilation_w_per_k: vent,
      solar_absorbed_w_per_m2: abs(make('')), solar_transmitted_w: sun, solar_beam_w: Float64Array.from(sun, (v) => v / 2),
      inside_solar_absorptance: alpha, solar_convective_fraction: 0, other_gains: null, setpoints: sp, control: 'air', hc_convective_fraction: 1,
      initial_c: 20, warmup_days: 5,
    })
    const zones = [0, 1, 2]
    const net = runNetwork({
      zones: zones.map(() => ({ air_capacity_j_per_k: 1e6, bridging_w_per_k: 5, ventilation_w_per_k: vent, solar_transmitted_w: sun, solar_beam_w: Float64Array.from(sun, (v) => v / 2), other_gains: null, setpoints: sp, initial_c: 20 })),
      elements: zones.flatMap((z) => { const els = make(`z${z}`); const a = abs(els); return els.map((element, k) => ({ element, zone_a: z, zone_b: null, solar_absorbed_w_per_m2: a[k], inside_solar_absorptance: alpha[k], inside_solar_absorptance_b: null })) }),
      hours: H, theta_e: te, theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 5,
    })
    for (const z of net.zones) for (let h = 0; h < H; h++) {
      expect(z.heating_w[h]).toBeCloseTo(one.heating_w[h], 6)
      expect(z.cooling_w[h]).toBeCloseTo(one.cooling_w[h], 6)
    }
    const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0)
    expect(net.zones.reduce((s, z) => s + sum(z.heating_w), 0)).toBeCloseTo(3 * sum(one.heating_w), 3)
    expect(sum(one.heating_w)).toBeGreaterThan(0)
    expect(sum(one.cooling_w)).toBeGreaterThan(0)
  })
})

describe('(d) internal mass', () => {
  it('a step in a zone whose air is held: each face follows C/Δt·(x − x₋₁) = h_c·A·(20 − x), and the heating is what the mass takes', () => {
    const H = 48, A = 12
    // One layer thin enough to be one segment: two faces of half its capacity each. By symmetry they stay equal, so
    // nothing crosses the layer and nothing is exchanged by long-wave between them.
    const d = K.max_sublayer_m
    const ONE: Layer[] = [{ kind: 'Material', thickness: d, conductivity: 1.13, density: 2000, specific_heat: 1000 }]
    const m = inner('mass', A, 0, 0, H, ONE)
    expect(m.element.c.length).toBe(2)
    const r = runNetwork(inputs(H, [{ setpoints: { heat_c: 20, cool_c: 20 }, initial_c: 0, air_capacity_j_per_k: 5000 }], [m], 0))
    const Cf = (2000 * 1000 * d / 2) * A, hA = HC * A
    let x = 0
    for (let h = 0; h < H; h++) {
      const prev = x
      x = (Cf / 3600 * x + hA * 20) / (Cf / 3600 + hA)
      expect(r.zones[0].theta_mrt[h]).toBeCloseTo(x, 9)
      const air = h === 0 ? (5000 / 3600) * 20 : 0
      expect(r.zones[0].heating_w[h]).toBeCloseTo(2 * hA * (20 - x) + air, 6)
      expect(r.zones[0].terms.storage_w[h]).toBeCloseTo(2 * Cf / 3600 * (x - prev) + air, 6)
    }
    expect(r.element_interzone_wh[0]).not.toBeNull()
    expect(Math.max(...r.zones[0].terms.interzone_w.map(Math.abs))).toBe(0)  // within one zone: no interzone line
  })
  it('at steady state it stores nothing and passes nothing through the zone; it shifts the steady result only by joining the long-wave exchange', () => {
    const H = 48
    const WALL: Layer[] = [{ kind: 'Material:NoMass', thermal_resistance: 2 }, ...BLOCK]
    const walls = [
      opaqueElement({ id: 'w', area_m2: 40, tilt_deg: 90, boundary: 'outside', layers: WALL, stated_u: null, emissivity: 0.9, path: 'w' }),
      opaqueElement({ id: 'r', area_m2: 25, tilt_deg: 0, boundary: 'outside', layers: WALL, stated_u: null, emissivity: 0.9, path: 'r' }),
    ].map((e) => ({ ...e, f_sky: 0 }))
    const els = (withMass: boolean): NetworkElement[] => [
      ...walls.map((element) => ({ element, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: new Float64Array(H), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null })),
      ...(withMass ? [inner('mass', 30, 0, 0, H)] : []),
    ]
    const zone = { setpoints: { heat_c: 20, cool_c: 20 }, bridging_w_per_k: 3 }
    const a = runNetwork(inputs(H, [zone], els(false))), b = runNetwork(inputs(H, [zone], els(true)))
    expect(Math.abs(last(b.zones[0].terms.storage_w))).toBeLessThan(1e-6)
    const qa = last(a.zones[0].heating_w), qb = last(b.zones[0].heating_w)
    // Recorded in docs/audit/104/04_multizone_gates.md: the mass faces settle between the air and the colder walls,
    // so they add a path from the air to the walls (convection in, long-wave out through ISO 52016-1's area-weighted
    // exchange). The heat loss rises, by 2.7 % in this case. The brief expected no change; that holds for storage,
    // not for a surface that joins the room's radiant exchange (EnergyPlus internal mass does the same).
    const shift = (qb - qa) / qa
    MULTIZONE_RESULTS.mass_steady_shift = shift
    expect(shift).toBeGreaterThan(0)
    expect(shift).toBeLessThan(0.05)
  })
})

export const MULTIZONE_RESULTS: Record<string, unknown> = {}

// ── (e) the cooled room ─────────────────────────────────────────────────────────────────────────────────────────
const repo = (p: string) => path.resolve(__dirname, '../../../../..', p)
const SPEC = JSON.parse(fs.readFileSync(repo('validation/energyplus/104_cooled_room_spec.json'), 'utf8'))
const EP = JSON.parse(fs.readFileSync(repo('docs/audit/104/04_cooled_room_energyplus.json'), 'utf8'))

function cooledRoomDocument() {
  const layers = (c: number[][]) => c.map(([d, k, cp, rho]) => (rho > 0 ? { kind: 'Material', thickness: d, conductivity: k, density: rho, specific_heat: cp } : { kind: 'Material:NoMass', thermal_resistance: d / k }))
  const lib: Record<string, ConstructionBody> = {
    wall: { layers: layers(SPEC.constructions.wall) }, roof: { layers: layers(SPEC.constructions.roof) },
    floor: { layers: layers(SPEC.constructions.floor) }, partition: { layers: layers(SPEC.constructions.partition) },
    window: { u_value_W_per_m2K: SPEC.window.u_w_per_m2k, g_value: SPEC.window.shgc, layers: [] },
  }
  const D = SPEC.depth_m, Hh = SPEC.height_m
  const ia = SPEC.inside_solar_absorptance
  const outside = (id: string, zone: string, kind: string, area: number, az: number | null, tilt: number, key: string, x: Record<string, unknown> = {}) => ({
    id, kind, zone_a: zone, zone_b: 'outside', facade: null, area_m2: area, azimuth_deg: az, tilt_deg: tilt, construction_ref: { key },
    g_value: null, openings: [], solar_absorptance: SPEC.solar_absorptance, thermal_emissivity: SPEC.thermal_emissivity, frame_fraction: null,
    inside_solar_absorptance: ia, inside_solar_absorptance_b: null, faces_up: null, ...x,
  })
  const rooms: any[] = SPEC.rooms
  const surfaces: any[] = []
  const zones = rooms.map((r, i) => {
    const w = r.x1 - r.x0, win = r.window_width_m * SPEC.window.height_m
    const own = [
      outside(`${r.id}_south`, r.id, 'wall', w * Hh - win, 180, 90, 'wall'),
      outside(`${r.id}_north`, r.id, 'wall', w * Hh, 0, 90, 'wall'),
      outside(`${r.id}_roof`, r.id, 'roof', w * D, null, 0, 'roof'),
      outside(`${r.id}_floor`, r.id, 'floor', w * D, null, 180, 'floor', { solar_absorptance: 0 }),
      outside(`${r.id}_window`, r.id, 'glazing', win, 180, 90, 'window', { solar_absorptance: null, frame_fraction: 0, inside_solar_absorptance: null }),
    ]
    if (i === 0) own.push(outside(`${r.id}_west`, r.id, 'wall', D * Hh, 270, 90, 'wall'))
    if (i === rooms.length - 1) own.push(outside(`${r.id}_east`, r.id, 'wall', D * Hh, 90, 90, 'wall'))
    surfaces.push(...own)
    return {
      id: r.id, name: r.id, floor: 0, storeys: 1, polygon: [[r.x0, 0], [r.x1, 0], [r.x1, D], [r.x0, D]], area_m2: w * D, height_m: Hh, use_type: 'test', rooms: null,
      profile_refs: { occupancy: null, lighting: [], equipment: [], auxiliary: [] },
      setpoints: { heat_c: r.heat_c, cool_c: r.cool_c, setback_c: null, hours_ref: null, control_strategy: 'active_setpoint' },
      ventilation: [], infiltration_q50: null, infiltration_ach: SPEC.infiltration_ach_sea_level_air, internal_heat_capacity_j_per_k_m2: 0,
      surfaces: own.map((s) => s.id),
    }
  })
  for (let i = 0; i + 1 < rooms.length; i++) {
    const a = rooms[i].id, b = rooms[i + 1].id
    surfaces.push({
      id: `${a}_to_${b}`, kind: 'partition', zone_a: a, zone_b: b, facade: null, area_m2: D * Hh, azimuth_deg: null, tilt_deg: 90,
      construction_ref: { key: 'partition' }, g_value: null, openings: [], solar_absorptance: null, thermal_emissivity: null, frame_fraction: null,
      inside_solar_absorptance: ia, inside_solar_absorptance_b: ia, faces_up: null,
    })
    zones[i].surfaces.push(`${a}_to_${b}`); zones[i + 1].surfaces.push(`${a}_to_${b}`)
  }
  const doc = ModelDocument.parse({
    schema_version: '2.3',
    building: { id: 'cooled-room', name: 'Cooled room', decoded_building_key: null, site: { lat: 39.83, lon: -104.65, name: 'Denver', exposure: null, ground: { method: 'annual_mean_outdoor' } }, orientation_deg: 0, reported_floor_area_m2: null, thermal_bridging: { mode: 'absent', multiplier: null, alpha_pct: null }, thermal_mass: { mode: null, category: null }, opening_defaults: {} },
    zones, surfaces, system_groups: [], profiles: [],
    services: { heating: { setpoint_mode: 'follow_comfort', setpoint_c: null }, cooling: { setpoint_mode: 'follow_comfort', setpoint_c: null }, dhw: { storage_setpoint_c: null, tap_outlet_temp_c: null, cold_supply_temp_c: null, demand_basis: null, litres_per_person_per_day: null, litres_per_m2_per_day: null, load_shape: null, circulation_pump_w: null } },
    weather_ref: { kind: 'epw', station_id: '725650', file_name: 'USA_CO_Denver.Intl.AP.725650_TMY3.mos', file_hash: MOS_SHA },
    library_refs: [],
  })
  return { doc, lib }
}

describe('(e) the cooled room against EnergyPlus from the same inputs', () => {
  it('per room, annual demand within ±10 % of EnergyPlus with the same surface coefficients; EnergyPlus\'s own also reported', () => {
    // The committed EnergyPlus results must be of this spec file (review F5): an edited spec makes them stale.
    expect(EP.spec_sha256).toBe(createHash('sha256').update(fs.readFileSync(repo('validation/energyplus/104_cooled_room_spec.json'))).digest('hex'))
    const weather = readMos(fs.readFileSync(MOS))
    const { doc, lib } = cooledRoomDocument()
    const r = runModel(doc, weather, lib, REFEREE_OPTIONS)
    expect(r.engine).toBe('thermal-2')
    const rows: Record<string, unknown> = {}
    for (const z of r.zones) {
      const room = SPEC.rooms.find((x: any) => x.id === z.zone_id)
      const which = room.heat_c != null ? 'heat_mwh' : 'cool_mwh'
      const e2 = (room.heat_c != null ? z.annual.heating_kwh : z.annual.cooling_kwh) / 1000
      const iso = EP.runs.iso_conv.zones[z.zone_id][which], base = EP.runs.base.zones[z.zone_id][which]
      rows[z.zone_id] = { demand: which, engine2: +e2.toFixed(3), ep_iso_conv: +iso.toFixed(3), ep_base: +base.toFixed(3), vs_iso: +((e2 / iso - 1) * 100).toFixed(1), vs_base: +((e2 / base - 1) * 100).toFixed(1),
        interzone_mwh: +(z.breakdown.filter((l) => l.term === 'interzone').reduce((s, l) => s + l.kwh, 0) / 1000).toFixed(3) }
      expect(z.closure.max_wh).toBeLessThanOrEqual(1)
      expect(Math.abs(e2 / iso - 1)).toBeLessThanOrEqual(0.10)
    }
    MULTIZONE_RESULTS.cooled_room = { rows, total: { heating: readBuildingHeatingKwh(r) / 1000, cooling: readBuildingCoolingKwh(r) / 1000 }, active_set: r.solver.active_set }
    console.log('cooled room', JSON.stringify(MULTIZONE_RESULTS.cooled_room))
  })
})
