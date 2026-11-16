/**
 * Brief 109 Part 1: heating hours and setbacks on Engines 1 and 2.
 *
 * (a) A zone whose only heat store is its air (massless walls), in a constant cold, heated 07:00–19:00 at 20 °C with a
 * 15 °C setback and a limited emitter: every hour equals the hand recursion of the backward-Euler step, on Engine 1 and
 * on Engine 2. (b) A schedule of all 1s equals no schedule, value for value. (c) The cooled room with hours and a
 * setback: cooling only in its hours, heating at the setback at night, closure every hour, hours below counted against
 * each hour's setpoint and in use. (d) Refusals, by name.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { opaqueElement, type Element, type Layer } from '../elements'
import { REFEREE_OPTIONS, runModel, UNMET_K, zoneSetpointHours } from '../model'
import { runNetwork } from '../network'
import { runZone, type ZoneInputs } from '../zone'
import { ModelDocument } from '../../schema/model'
import { cooledRoomDocument } from './cooledRoom'
import { MOS, readMos } from './denver'

const D = 20, H = 24 * D
const flat = (v: number, n = H) => new Float64Array(n).fill(v)
const NOMASS: Layer[] = [{ kind: 'Material:NoMass', thermal_resistance: 2 }]
const wall = (id: string, area: number): Element => ({ ...opaqueElement({ id, area_m2: area, tilt_deg: 90, boundary: 'outside', layers: NOMASS, stated_u: null, emissivity: 0.9, path: id }), f_sky: 0 })
const Rchain = (e: Element) => 1 / e.g_boundary + Array.from(e.g).reduce((s, g) => s + 1 / g, 0)
// 07:00–19:00 at 20 °C, 15 °C otherwise (the hour starting 07:00 is index 7).
const DAY = Array.from({ length: 24 }, (_, hr) => (hr >= 7 && hr < 19 ? 20 : 15))
const sched = (heat: number[], cool: number[] | null = null) => ({
  heat_c: Float64Array.from({ length: H }, (_, h) => heat[h % 24]),
  cool_c: Float64Array.from({ length: H }, (_, h) => (cool ? cool[h % 24] : NaN)),
})

describe('(a) a setback by hand: the air-only zone follows the backward-Euler recursion', () => {
  const els = [wall('a', 60), wall('b', 40)]
  const k = els.reduce((s, e) => s + e.area_m2 / (Rchain(e) + 1 / e.h_ci), 0) + 40 + 60  // W/K, air to outside
  const C = 2e6, te = 0, cap = 22 * k
  const inputs = (): ZoneInputs => ({
    elements: els, air_capacity_j_per_k: C, bridging_w_per_k: 40, hours: H, theta_e: flat(te), theta_ground: 10, ventilation_w_per_k: flat(60),
    solar_absorbed_w_per_m2: els.map(() => flat(0)), solar_transmitted_w: flat(0), other_gains: null,
    setpoints: { heat_c: 20, cool_c: null }, setpoint_hours: sched(DAY), control: 'air', hc_convective_fraction: 1, initial_c: 20, warmup_days: 30,
    heating_cap_w: cap,
  })
  // The hand recursion over the same warm-up and days.
  const hand = () => {
    const a = C / 3600, T = new Float64Array(H), P = new Float64Array(H)
    let t = 20
    const one = (sp: number) => {
      const need = (a + k) * sp - a * t - k * te
      const phi = Math.min(Math.max(need, 0), cap)
      t = (a * t + k * te + phi) / (a + k)
      return phi
    }
    for (let d = 0; d < 30; d++) for (let h = 0; h < 24; h++) one(DAY[h])
    for (let h = 0; h < H; h++) { P[h] = one(DAY[h % 24]); T[h] = t }
    return { T, P }
  }
  it('Engine 1: every hour of the last day to 0.01 K and 0.1 W; the morning is limited; every hour closes', () => {
    const r = runZone(inputs()), x = hand()
    for (let h = H - 24; h < H; h++) {
      expect(Math.abs(r.theta_air[h] - x.T[h]), `hour ${h % 24}`).toBeLessThan(0.01)
      expect(Math.abs(r.heating_w[h] - x.P[h]), `hour ${h % 24}`).toBeLessThan(0.1)
    }
    expect(r.heating_w[H - 24 + 7]).toBeCloseTo(cap, 6)  // 07:00, recovering at the limit
    expect(r.theta_air[H - 24 + 7]).toBeLessThan(20 - UNMET_K)
    expect(r.theta_air[H - 24 + 3]).toBeCloseTo(15, 6)  // held at the setback overnight
    expect(Math.max(...r.closure_wh)).toBeLessThanOrEqual(1e-6)
  })
  it('Engine 2, the same zone alone: equal to Engine 1 to rounding, with heating off at night too', () => {
    const e1 = runZone(inputs())
    const net = (spH: ReturnType<typeof sched>) => runNetwork({
      zones: [{ air_capacity_j_per_k: C, bridging_w_per_k: 40, ventilation_w_per_k: flat(60), solar_transmitted_w: flat(0), solar_beam_w: null, other_gains: null, setpoints: { heat_c: 20, cool_c: null }, setpoint_hours: spH, initial_c: 20, heating_cap_w: cap }],
      elements: els.map((element) => ({ element, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null })),
      hours: H, theta_e: flat(te), theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 30,
    }).zones[0]
    const e2 = net(sched(DAY))
    for (let h = 0; h < H; h++) {
      expect(Math.abs(e2.theta_air[h] - e1.theta_air[h])).toBeLessThan(1e-6)
      expect(Math.abs(e2.heating_w[h] - e1.heating_w[h])).toBeLessThan(1e-4)
    }
    // Heating off outside the hours (NaN): no heat at night, both engines alike.
    const OFF = DAY.map((v) => (v === 20 ? 20 : NaN))
    const o1 = runZone({ ...inputs(), setpoint_hours: sched(OFF) }), o2 = net(sched(OFF))
    for (let h = H - 24; h < H; h++) {
      if (Number.isNaN(OFF[h % 24])) { expect(o1.heating_w[h]).toBe(0); expect(o2.heating_w[h]).toBe(0) }
      expect(Math.abs(o2.theta_air[h] - o1.theta_air[h])).toBeLessThan(1e-6)
    }
    expect(Math.max(...o2.closure_wh)).toBeLessThanOrEqual(1e-6)
  })
})

// ── The cooled room (west and east heated at 20 °C, middle cooled at 24 °C) ────────────────────────────────────
const W = readMos(fs.readFileSync(MOS))
function withHours(day: number[], over: (d: any) => void = () => {}) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  d.profiles.push({ id: 'office_hours', kind: 'schedule', day_types: { weekday: day, saturday: Array(24).fill(0), sunday: Array(24).fill(0) } })
  for (const z of d.zones) { z.setpoints.hours_ref = 'office_hours'; if (z.setpoints.heat_c != null) z.setpoints.setback_c = 15 }
  over(d)
  return { doc: ModelDocument.parse(d), lib }
}
const OFFICE = Array.from({ length: 24 }, (_, hr) => (hr >= 7 && hr < 19 ? 1 : 0))

describe('(b) a schedule of all 1s is no schedule', () => {
  it('every hourly value equal, Engine 2 (three rooms), with and without emitters', () => {
    const { doc, lib } = cooledRoomDocument()
    const all = withHours(Array(24).fill(1), (d) => { d.profiles[0].day_types.saturday = Array(24).fill(1); d.profiles[0].day_types.sunday = Array(24).fill(1) })
    const a = runModel(doc, W, lib, REFEREE_OPTIONS), b = runModel(all.doc, W, all.lib, REFEREE_OPTIONS)
    for (let zi = 0; zi < 3; zi++) {
      expect(Array.from(b.zones[zi].hourly.heating_w)).toEqual(Array.from(a.zones[zi].hourly.heating_w))
      expect(Array.from(b.zones[zi].hourly.cooling_w)).toEqual(Array.from(a.zones[zi].hourly.cooling_w))
      expect(Array.from(b.zones[zi].hourly.theta_air_c)).toEqual(Array.from(a.zones[zi].hourly.theta_air_c))
      expect(b.zones[zi].annual.in_use_hours).toBe(8760)
    }
  })
})

describe('(c) the cooled room with office hours and a 15 °C setback', () => {
  const b = withHours(OFFICE)
  const r = runModel(b.doc, W, b.lib, REFEREE_OPTIONS)
  const sh = zoneSetpointHours(b.doc, W.hours)
  it('setpoints by the hour; cooling only in its hours; heated rooms never below the hour\'s setpoint when unlimited', () => {
    const west = r.zones[0], mid = r.zones[1]
    expect(west.annual.in_use_hours).toBe(260 * 12 + 1 * 12)  // 261 weekdays in the weather year (1 January a Monday)
    for (let h = 0; h < 8760; h++) {
      if (Number.isNaN(sh[1]!.hourly.cool_c[h])) expect(mid.hourly.cooling_w[h]).toBe(0)
      expect(west.hourly.theta_air_c[h]).toBeGreaterThanOrEqual(sh[0]!.hourly.heat_c[h] - 1e-6)
    }
    expect(west.annual.unmet_heating_hours).toBe(0)
    for (const z of r.zones) expect(z.closure.max_wh).toBeLessThanOrEqual(1)
  })
  it('a setback saves heat against heating all day, and the cooled room cools less', () => {
    const { doc, lib } = cooledRoomDocument()
    const base = runModel(doc, W, lib, REFEREE_OPTIONS)
    expect(r.zones[0].annual.heating_kwh).toBeLessThan(base.zones[0].annual.heating_kwh)
    expect(r.zones[1].annual.cooling_kwh).toBeLessThan(base.zones[1].annual.cooling_kwh)
  })
  it('with emitters too small for the morning: hours below counted against each hour, and in use never more', () => {
    const c = withHours(OFFICE, (d) => {
      d.system_groups = [{ id: 'boiler', service: 'heating', zones: ['west', 'east'], enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, design_flow_c: 75, design_return_c: 65 }]
      for (const z of d.zones) if (z.setpoints.heat_c != null) z.emitters = [{ id: `${z.id}_e`, kind: 'electric', count: 1, rated_output_w: 900, radiant_fraction: 0, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
    })
    const q = runModel(c.doc, W, c.lib, REFEREE_OPTIONS)
    for (const zi of [0, 2]) {
      const a = q.zones[zi].annual
      expect(a.unmet_heating_hours!).toBeGreaterThan(0)
      expect(a.unmet_heating_hours_in_use!).toBeGreaterThan(0)
      expect(a.unmet_heating_hours_in_use!).toBeLessThanOrEqual(a.unmet_heating_hours!)
      expect(a.min_control_in_use_c!).toBeGreaterThanOrEqual(a.min_control_c)
      expect(q.zones[zi].closure.max_wh).toBeLessThanOrEqual(1)
      // By hand from the hourly temperatures.
      let n = 0
      for (let h = 0; h < 8760; h++) if (sh[zi]!.in_use[h] && q.zones[zi].hourly.theta_air_c[h] < 20 - UNMET_K) n++
      expect(a.unmet_heating_hours_in_use).toBe(n)
    }
  })
  it('Engine 1 (one zone) runs hours too: the west room alone', () => {
    const one = withHours(OFFICE, (d) => {
      d.zones = [d.zones[0]]
      d.surfaces = d.surfaces.filter((s: any) => s.zone_a === 'west').map((s: any) => (s.zone_b === 'middle' ? { ...s, zone_b: 'outside', kind: 'wall', azimuth_deg: 90, solar_absorptance: 0.6, thermal_emissivity: 0.9, inside_solar_absorptance_b: null } : s))
      d.zones[0].surfaces = d.surfaces.map((s: any) => s.id)
    })
    const q = runModel(one.doc, W, one.lib, REFEREE_OPTIONS)
    expect(q.engine).toBe('thermal-1')
    expect(q.zones[0].annual.unmet_heating_hours).toBe(0)
    expect(q.zones[0].closure.max_wh).toBeLessThanOrEqual(1)
  })
})

describe('(d) refused by name, never defaulted', () => {
  const err = (f: (d: any) => void) => { try { runModel(withHours(OFFICE, f).doc, W, cooledRoomDocument().lib, REFEREE_OPTIONS) } catch (e) { return (e as Error).message } return 'ran' }
  it('each gap names its path', () => {
    expect(err((d) => { d.zones[0].setpoints.hours_ref = 'nope' })).toBe('zones[0].setpoints.hours_ref: no profile "nope"')
    expect(err((d) => { d.profiles.push({ id: 'occ', kind: 'occupancy', density: { value: 1, basis: 'm2_per_person' }, radiant_fraction: null }); d.zones[0].setpoints.hours_ref = 'occ' })).toBe('zones[0].setpoints.hours_ref: profile "occ" is occupancy, not a schedule')
    expect(err((d) => { d.zones[0].setpoints.setback_c = 22 })).toBe('zones[0].setpoints.setback_c: the setback (22 °C) is above the heating setpoint (20 °C)')
    expect(err((d) => { d.zones[0].setpoints.hours_ref = null })).toBe('zones[0].setpoints.hours_ref: a setback needs the hours it applies outside (hours_ref)')
    expect(err((d) => { d.zones[1].setpoints.setback_c = 15 })).toBe('zones[1].setpoints.heat_c: a setback needs a heating setpoint to set back from')
    expect(err((d) => { d.profiles[0].day_types.weekday[8] = 1.5 })).toBe('profiles[0].day_types.weekday: weekday hour 8: 1.5 must be 0 to 1')
    expect(err((d) => { d.zones[0].setpoints.setback_c = null; d.profiles[0].day_types.weekday[6] = 0.5 })).toBe('profiles[0].day_types.weekday: weekday hour 6: a part value (0.5) needs a setback to scale from; give 0 (off) or 1 (on), or state setback_c')
  })
})
