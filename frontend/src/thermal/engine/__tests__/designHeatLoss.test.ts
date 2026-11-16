/**
 * Brief 117 Part 1: the design heat loss against hand calculations.
 *
 * The cooled room (validation/energyplus/104_cooled_room_spec.json): west and east heated, middle not, with partitions
 * between them. (a) one room by hand, every line; (b) two heated rooms at different temperatures, the partition's heat
 * cancelling in the building total; (c) the weather file's design temperature; (d) ventilation and the minimum air
 * change; (e) every refusal by name; (f) the 2.5 → 2.6 upgrade fills nothing.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ENGINE_CONSTANTS as K } from '../constants'
import { DesignError, designHeatLoss, MIN_DESIGN_ACH, weatherDesignTemperature } from '../designHeatLoss'
import { groundTemperature, REFEREE_OPTIONS, runModel } from '../model'
import { ModelDocument } from '../../schema/model'
import { upgradeDocument } from '../../schema/upgrade'
import { cooledRoomDocument, SPEC } from './cooledRoom'
import { MOS, readMos } from './denver'

const W = readMos(fs.readFileSync(MOS))
const RHO_C = 0.33  // Wh/m³K: 0.33 W/K per m³/h
const R = (layers: number[][]) => layers.reduce((s, [d, k]) => s + d / k, 0)
// ISO 6946 films by hand: walls 0.13 inside, roofs (heat up) 0.10, a floor over outside air (heat down) 0.17; 0.04 outside.
const U_WALL = 1 / (0.13 + R(SPEC.constructions.wall) + 0.04)
const U_ROOF = 1 / (0.10 + R(SPEC.constructions.roof) + 0.04)
const U_FLOOR = 1 / (0.17 + R(SPEC.constructions.floor) + 0.04)
const U_PART = 1 / (0.13 + R(SPEC.constructions.partition) + 0.13)
const D = SPEC.depth_m, H = SPEC.height_m

function build(over: (d: any) => void = () => {}) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  d.building.design = { outdoor: { stated_c: -5 }, warm_up_w_per_m2: 10, vent_wind_m_s: null }
  for (const z of d.zones) z.design_internal_c = z.setpoints.heat_c == null ? 12 : 'follow_heat_c'
  over(d)
  const m = ModelDocument.parse(d)
  return { doc: m, run: runModel(m, W, lib, REFEREE_OPTIONS) }
}
const line = (z: any, term: string, surface?: string) => z.lines.filter((l: any) => l.term === term && (surface == null || l.surface_id === surface))
const sum = (ls: any[]) => ls.reduce((s, l) => s + l.w, 0)

describe('(a) one room by hand', () => {
  it('west at 20 °C, outside at −5 °C, the middle room at 12 °C: every line', () => {
    const { doc, run } = build()
    const r = designHeatLoss(doc, run.zones, W)
    const west = r.zones.find((z) => z.zone_id === 'west')!
    const dT = 25
    const win = 1.5 * SPEC.window.height_m
    expect(line(west, 'fabric', 'west_south')[0].w).toBeCloseTo(U_WALL * (4 * H - win) * dT, 6)
    expect(line(west, 'fabric', 'west_north')[0].w).toBeCloseTo(U_WALL * 4 * H * dT, 6)
    expect(line(west, 'fabric', 'west_west')[0].w).toBeCloseTo(U_WALL * D * H * dT, 6)
    expect(line(west, 'fabric', 'west_roof')[0].w).toBeCloseTo(U_ROOF * 4 * D * dT, 6)
    expect(line(west, 'fabric', 'west_floor')[0].w).toBeCloseTo(U_FLOOR * 4 * D * dT, 6)
    expect(line(west, 'fabric', 'west_window')[0].w).toBeCloseTo(SPEC.window.u_w_per_m2k * win * dT, 6)
    expect(line(west, 'bridging')[0].w).toBe(0)  // the cooled room states no bridging
    expect(line(west, 'ground')).toHaveLength(0)
    // The partition to the unheated middle room, at its stated 12 °C.
    const p = line(west, 'to_room', 'west_to_middle')[0]
    expect(p.other_zone_id).toBe('middle')
    expect(p.w).toBeCloseTo(U_PART * D * H * (20 - 12), 6)
    // Infiltration 0.414 ach, topped up to 0.5 (the room has outside surfaces).
    const V = 4 * D * H
    expect(line(west, 'infiltration')[0].w).toBeCloseTo(RHO_C * SPEC.infiltration_ach_sea_level_air * V * dT, 6)
    expect(line(west, 'minimum_air_change')[0].w).toBeCloseTo(RHO_C * (MIN_DESIGN_ACH - SPEC.infiltration_ach_sea_level_air) * V * dT, 6)
    expect(line(west, 'warm_up')[0].w).toBe(10 * 4 * D)
    // The lines are the total (Rule 9), and the total is the hand sum.
    const hand = U_WALL * (4 * H - win + 4 * H + D * H) * dT + U_ROOF * 4 * D * dT + U_FLOOR * 4 * D * dT + SPEC.window.u_w_per_m2k * win * dT
      + U_PART * D * H * 8 + RHO_C * MIN_DESIGN_ACH * V * dT + 10 * 4 * D
    expect(sum(west.lines)).toBeCloseTo(west.total_w, 9)
    expect(west.total_w).toBeCloseTo(hand, 6)
    expect(west.w_per_m2).toBeCloseTo(hand / (4 * D), 6)
    expect(west).toMatchObject({ heated: true, internal_c: 20, internal_source: 'follow_heat_c' })
  })
})

describe('(b) two heated rooms at different temperatures', () => {
  it('the partition\'s heat leaves one room and enters the other, so it cancels in the building total', () => {
    const { doc, run } = build((d) => {
      d.zones[1].setpoints.heat_c = 18; d.zones[1].design_internal_c = 'follow_heat_c'
      d.zones[2].design_internal_c = 22
    })
    const r = designHeatLoss(doc, run.zones, W)
    const [west, middle, east] = r.zones
    expect(line(west, 'to_room', 'west_to_middle')[0].w).toBeCloseTo(U_PART * D * H * (20 - 18), 6)
    expect(line(middle, 'to_room', 'west_to_middle')[0].w).toBeCloseTo(-U_PART * D * H * (20 - 18), 6)
    expect(line(middle, 'to_room', 'middle_to_east')[0].w).toBeCloseTo(U_PART * D * H * (18 - 22), 6)
    expect(line(east, 'to_room', 'middle_to_east')[0].w).toBeCloseTo(-U_PART * D * H * (18 - 22), 6)
    expect(east).toMatchObject({ internal_c: 22, internal_source: 'stated' })
    const toRooms = r.zones.reduce((s, z) => s + sum(line(z, 'to_room')), 0)
    expect(toRooms).toBeCloseTo(0, 9)
    expect(r.building_w).toBeCloseTo(r.zones.reduce((s, z) => s + z.total_w - sum(line(z, 'to_room')), 0), 6)
    // With middle unheated again, it is left out of the total, and the heat lost to it is not cancelled.
    const u = build()
    const ru = designHeatLoss(u.doc, u.run.zones, W)
    expect(ru.zones[1].heated).toBe(false)
    expect(ru.building_w).toBeCloseTo(ru.zones[0].total_w + ru.zones[2].total_w, 9)
    expect(ru.zones[1].lines.some((l) => l.term === 'warm_up')).toBe(false)
  })
})

describe('(c) the weather file\'s design temperature', () => {
  it('the 99.6 % and 99 % temperatures are the 36th and 88th coldest hours; the ground is the annual mean', () => {
    const t = [...W.hours.dry_bulb].sort((a, b) => a - b)
    expect(weatherDesignTemperature(W, 'heating_99_6')).toBe(t[35])
    expect(weatherDesignTemperature(W, 'heating_99')).toBe(t[87])
    const { doc, run } = build((d) => { d.building.design.outdoor = { from_weather: 'heating_99_6' } })
    const r = designHeatLoss(doc, run.zones, W)
    expect(r).toMatchObject({ outdoor_c: t[35], outdoor_source: 'heating_99_6' })
    expect(r.ground_c).toBeCloseTo(t.reduce((s, x) => s + x, 0) / t.length, 9)
    expect(r.ground_c).toBe(groundTemperature(W))
  })
  it('a floor on the ground loses heat to the ground temperature, not the outdoor one', () => {
    const { doc, run } = build((d) => { for (const s of d.surfaces) if (s.kind === 'floor') { s.kind = 'ground'; s.zone_b = 'ground'; s.solar_absorptance = null; s.thermal_emissivity = null } })
    const r = designHeatLoss(doc, run.zones, W)
    const g = line(r.zones[0], 'ground', 'west_floor')[0]
    const U = 1 / (0.17 + R(SPEC.constructions.floor))  // against the ground: no outside film
    expect(g.delta_t_k).toBeCloseTo(20 - groundTemperature(W), 9)
    expect(g.w).toBeCloseTo(U * 4 * D * (20 - groundTemperature(W)), 6)
  })
})

describe('(d) ventilation and the minimum air change', () => {
  it('MVHR at its full flow after recovery; with it the room is above 0.5 ach and gets no top-up', () => {
    const { doc, run } = build((d) => {
      d.zones[0].ventilation = [{ id: 'mvhr', kind: 'mvhr', enabled: true, flow_rate: 30, flow_rate_basis: 'constant', recovery_sensible_pct: 80, control_schedule_ref: 'always_on', legacy_v25: {} }]
    })
    const west = designHeatLoss(doc, run.zones, W).zones[0]
    expect(line(west, 'mechanical_ventilation')[0]).toMatchObject({ ventilation_id: 'mvhr' })
    expect(line(west, 'mechanical_ventilation')[0].w).toBeCloseTo(K.rho_c_air * 0.03 * 0.2 * 25, 6)
    expect(west.ach).toBeCloseTo(SPEC.infiltration_ach_sea_level_air + (0.03 * 3600) / (4 * D * H), 9)
    expect(line(west, 'minimum_air_change')).toHaveLength(0)
  })
  it('permanent vents at the stated design wind speed', () => {
    const { doc, run } = build((d) => {
      d.building.design.vent_wind_m_s = 4
      const s = d.surfaces.find((x: any) => x.id === 'west_north')
      s.openings = [{ kind: 'permanent_vent', area_m2: 0.01, cd: 0.6, flow_mode: 'single_sided' }]
    })
    const west = designHeatLoss(doc, run.zones, W).zones[0]
    const q = 0.025 * 1 * 0.01 * 4  // single-sided: 0.025 · min(1, cd/0.6) · A · v (air.ts)
    expect(line(west, 'vents')[0].w).toBeCloseTo(K.rho_c_air * q * 25, 9)
  })
})

describe('(d2) review F9: the cases the mutations got through', () => {
  const HOURS = JSON.parse(fs.readFileSync(new URL('../../../../../validation/energyplus/109_setback_spec.json', import.meta.url), 'utf8')).hours
  it('ventilation on a schedule: its full flow (the largest hour), not its mean', () => {
    const { doc, run } = build((d) => {
      d.profiles.push({ id: 'office', kind: 'schedule', day_types: HOURS })
      d.zones[0].ventilation = [{ id: 'mev', kind: 'mev', enabled: true, flow_rate: 30, flow_rate_basis: 'constant', recovery_sensible_pct: null, control_schedule_ref: 'office', legacy_v25: {} }]
    })
    const west = designHeatLoss(doc, run.zones, W).zones[0]
    expect(line(west, 'mechanical_ventilation')[0].w).toBeCloseTo(K.rho_c_air * 0.03 * 25, 6)
  })
  it('vents that lift the room above 0.5 air changes: no top-up', () => {
    const { doc, run } = build((d) => {
      d.building.design.vent_wind_m_s = 4
      d.surfaces.find((x: any) => x.id === 'west_north').openings = [{ kind: 'permanent_vent', area_m2: 0.05, cd: 0.6, flow_mode: 'single_sided' }]
    })
    const west = designHeatLoss(doc, run.zones, W).zones[0]
    const V = 4 * D * H, q = 0.025 * 0.05 * 4
    expect(west.ach).toBeCloseTo(SPEC.infiltration_ach_sea_level_air + (q * 3600) / V, 9)
    expect(west.ach).toBeGreaterThan(MIN_DESIGN_ACH)
    expect(line(west, 'minimum_air_change')).toHaveLength(0)
  })
  it('a room with no outside surface: no top-up', () => {
    const { doc, run } = build((d) => {
      const gone = new Set(['middle_south', 'middle_north', 'middle_roof', 'middle_floor', 'middle_window'])
      d.surfaces = d.surfaces.filter((x: any) => !gone.has(x.id))
      d.zones[1].surfaces = d.zones[1].surfaces.filter((id: string) => !gone.has(id))
    })
    const middle = designHeatLoss(doc, run.zones, W).zones[1]
    expect(middle.ach).toBeLessThan(MIN_DESIGN_ACH)
    expect(line(middle, 'minimum_air_change')).toHaveLength(0)
    expect(line(middle, 'fabric')).toHaveLength(0)
  })
  it('stated bridging is a line at the outdoor temperature difference', () => {
    const { doc, run } = build((d) => { d.building.thermal_bridging = { mode: null, multiplier: null, alpha_pct: 10 } })
    const west = designHeatLoss(doc, run.zones, W).zones[0]
    const tb = run.zones[0].conductances.bridging.total_w_per_k
    expect(tb).toBeGreaterThan(0)
    expect(line(west, 'bridging')[0].w).toBeCloseTo(tb * 25, 9)
  })
})

describe('(e) refusals, by name', () => {
  const refuse = (over: (d: any) => void, path: string, msg: RegExp) => {
    const { doc, run } = build(over)
    let err: any
    try { designHeatLoss(doc, run.zones, W) } catch (e) { err = e }
    expect(err).toBeInstanceOf(DesignError)
    expect(err.path).toBe(path)
    expect(err.message).toMatch(msg)
  }
  it('no design conditions', () => refuse((d) => { d.building.design = null }, 'building.design', /required/))
  it('a heated zone with no design temperature', () => refuse((d) => { d.zones[0].design_internal_c = null }, 'zones[0].design_internal_c', /follow_heat_c/))
  it('an unheated zone with no design temperature', () => refuse((d) => { d.zones[1].design_internal_c = null }, 'zones[1].design_internal_c', /unheated/))
  it('an unheated zone told to follow its heating setpoint', () => refuse((d) => { d.zones[1].design_internal_c = 'follow_heat_c' }, 'zones[1].design_internal_c', /no heating setpoint/))
  it('vents with no design wind speed', () => refuse((d) => {
    d.surfaces.find((x: any) => x.id === 'west_north').openings = [{ kind: 'permanent_vent', area_m2: 0.01, cd: 0.6, flow_mode: 'single_sided' }]
  }, 'building.design.vent_wind_m_s', /design wind speed/))
})

describe('(f) schema 2.6', () => {
  it('a 2.5 document upgrades with no design conditions and no design temperatures: nothing is filled', () => {
    const { doc } = cooledRoomDocument()
    const old: any = structuredClone(doc)
    old.schema_version = '2.5'
    delete old.building.design
    for (const z of old.zones) delete z.design_internal_c
    const up = upgradeDocument(old)
    expect(up.schema_version).toBe('2.10')
    expect(up.building.design).toBeNull()
    for (const z of up.zones) expect(z.design_internal_c).toBeNull()
  })
})
