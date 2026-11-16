/**
 * Brief 108 Part 2: heating limited to the zone's emitters, on Engines 1 and 2.
 *
 * (a) EN 442 rating by hand; (b) a cap above the peak changes nothing, value for value; (c) one zone in steady cold
 * weather settles where its loss equals the cap, by hand, on both engines; (d) two zones, one capped: the neighbour
 * picks up the heat it now loses through the partition, by hand; (e) the cooled room with its heated rooms capped
 * below their peak: closure every hour, heating never above the cap, unmet hours counted; every solver path.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ENGINE_CONSTANTS as K } from '../constants'
import { innerElement, opaqueElement, type Element, type Layer } from '../elements'
import { logMeanDeltaT, ratedOutputAt, zoneEmitters } from '../emitters'
import { REFEREE_OPTIONS, runModel, UNMET_K, type RunOptions } from '../model'
import { runNetwork, type NetworkElement, type NetworkInputs } from '../network'
import { runZone, type ZoneInputs } from '../zone'
import { ModelDocument } from '../../schema/model'
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
const zone1 = (els: Element[], over: Partial<ZoneInputs> = {}): ZoneInputs => ({
  elements: els, air_capacity_j_per_k: 1e6, bridging_w_per_k: 40, hours: H, theta_e: flat(0), theta_ground: 10, ventilation_w_per_k: flat(60),
  solar_absorbed_w_per_m2: els.map(() => flat(0)), solar_transmitted_w: flat(0), other_gains: null,
  setpoints: { heat_c: 20, cool_c: 26 }, control: 'air', hc_convective_fraction: 1, initial_c: 20, warmup_days: 60, ...over,
})
const last = (a: Float64Array) => a[a.length - 1]

describe('(a) EN 442 rating', () => {
  it('75/65/20 is a log-mean ΔT of 49.83 K; a 1,000 W radiator at 50/40 in a 21 °C room gives 379 W', () => {
    expect(logMeanDeltaT(75, 65, 20)).toBeCloseTo(10 / Math.log(55 / 45), 12)
    expect(logMeanDeltaT(75, 65, 20)).toBeCloseTo(49.83, 2)
    const r = { flow_c: 75, return_c: 65, room_c: 20 }
    expect(ratedOutputAt(1000, 1.3, r, { flow_c: 50, return_c: 40, room_c: 21 })).toBeCloseTo(1000 * Math.pow((10 / Math.log(29 / 19)) / (10 / Math.log(55 / 45)), 1.3), 9)
    expect(Math.round(ratedOutputAt(1000, 1.3, r, { flow_c: 50, return_c: 40, room_c: 21 }))).toBe(379)
    expect(ratedOutputAt(1000, 1.3, r, r)).toBeCloseTo(1000, 12)
    expect(logMeanDeltaT(50, 50, 20)).toBe(30)
    expect(logMeanDeltaT(40, 20, 21)).toBeNaN()  // the return below the room gives no heat
  })
})

describe('(c) one zone in steady cold weather settles where its loss equals the cap', () => {
  const els = [wall('a', 60), wall('b', 40)]
  const k = els.reduce((s, e) => s + e.area_m2 / (Rchain(e) + 1 / e.h_ci), 0) + 40 + 60  // W/K, air to 0 °C outside
  it('Engine 1: uncapped needs 20·k; capped at half, the air settles at cap / k, and every hour closes', () => {
    const free = runZone(zone1(els))
    expect(last(free.heating_w)).toBeCloseTo(20 * k, 6)
    const cap = 10 * k
    const r = runZone(zone1(els, { heating_cap_w: cap }))
    expect(last(r.heating_w)).toBeCloseTo(cap, 9)
    expect(Math.abs(last(r.theta_air) - cap / k)).toBeLessThan(0.01)
    expect(Math.max(...r.heating_w)).toBeLessThanOrEqual(cap * (1 + 1e-12))
    expect(Math.max(...r.closure_wh)).toBeLessThanOrEqual(1)
  })
  it('Engine 2, the same zone alone: the same steady temperature', () => {
    const net: NetworkInputs = {
      zones: [{ air_capacity_j_per_k: 1e6, bridging_w_per_k: 40, ventilation_w_per_k: flat(60), solar_transmitted_w: flat(0), solar_beam_w: null, other_gains: null, setpoints: { heat_c: 20, cool_c: 26 }, initial_c: 20, heating_cap_w: 10 * k }],
      elements: els.map((element) => ({ element, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null })),
      hours: H, theta_e: flat(0), theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 60,
    }
    const r = runNetwork(net)
    expect(last(r.zones[0].heating_w)).toBeCloseTo(10 * k, 9)
    expect(Math.abs(last(r.zones[0].theta_air) - 10)).toBeLessThan(0.01)
    // Heating half radiant (the dense path, not the admittance form): still the cap, still closed.
    net.zones[0].heating_convective_fraction = 0.5
    const r2 = runNetwork(net)
    expect(last(r2.zones[0].heating_w)).toBeCloseTo(10 * k, 9)
    expect(Math.max(...r2.zones[0].closure_wh)).toBeLessThanOrEqual(1e-6)
    // Operative control: the cap holds; the zone sits below its operative setpoint.
    const r3 = runNetwork({ ...net, control: 'operative' })
    expect(last(r3.zones[0].heating_w)).toBeCloseTo(10 * k, 9)
    expect(last(r3.zones[0].theta_op)).toBeLessThan(20 - UNMET_K)
    expect(Math.max(...r3.zones[0].closure_wh)).toBeLessThanOrEqual(1e-6)
  })
})

describe('(d) two zones, one capped', () => {
  it('zone 1 capped floats at (cap + 20·UA) / (UA + H₁); zone 0 heats its own loss plus UA·(20 − T₁)', () => {
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
        other_gains: null, setpoints: { heat_c: 20, cool_c: 26 }, initial_c: 20, heating_cap_w: i === 1 ? cap : null,
      })),
      elements: [part], hours: H, theta_e: flat(0), theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 60,
    })
    const free = runNetwork(base(null))
    expect(last(free.zones[0].heating_w)).toBeCloseTo(20 * H0, 7)
    expect(last(free.zones[1].heating_w)).toBeCloseTo(20 * H1, 7)
    const cap = 100
    const r = runNetwork(base(cap))
    const T1 = (cap + 20 * UA) / (UA + H1)
    expect(last(r.zones[1].theta_air)).toBeCloseTo(T1, 7)
    expect(last(r.zones[1].heating_w)).toBeCloseTo(cap, 9)
    expect(last(r.zones[0].heating_w)).toBeCloseTo(20 * H0 + UA * (20 - T1), 6)
    expect(last(r.zones[0].terms.interzone_w)).toBeCloseTo(-UA * (20 - T1), 6)
    for (const z of r.zones) expect(Math.max(...z.closure_wh)).toBeLessThanOrEqual(1e-6)
  })
})

// ── (b) and (e): the cooled room (west and east heated, middle cooled) with emitters ────────────────────────────
const W = readMos(fs.readFileSync(MOS))
function withEmitters(perRoomW: number | null, radiant = 0, over: (d: any) => void = () => {}) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  d.system_groups = [{ id: 'boiler', service: 'heating', zones: ['west', 'east'], enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, design_flow_c: 75, design_return_c: 65 }]
  if (perRoomW != null) {
    for (const z of d.zones) if (z.setpoints.heat_c != null) {
      // Rated at the design temperatures and this room's setpoint, so the rated output is the cap.
      z.emitters = [{ id: `${z.id}_rad`, kind: 'radiator', count: 2, rated_output_w: perRoomW / 2, radiant_fraction: radiant, system_group_id: 'boiler', rated_flow_c: 75, rated_return_c: 65, rated_room_c: z.setpoints.heat_c, exponent_n: 1.3 }]
    }
  }
  over(d)
  return { doc: ModelDocument.parse(d), lib }
}

// (b)-(e) test the solver's fixed limit (LimitCapacity's form): the emitters rated with the room at its setpoint.
const FIXED: RunOptions = { ...REFEREE_OPTIONS, emitter_rating: 'setpoint' }

describe('(b) a cap above the peak changes nothing', () => {
  it('Engine 2 (three rooms): every hourly heating and temperature value equal to the uncapped run', () => {
    const a = withEmitters(null), base = runModel(a.doc, W, a.lib, FIXED)
    const peak = Math.max(...base.zones.map((z) => z.annual.peak_heating_w))
    const b = withEmitters(peak * 2), r = runModel(b.doc, W, b.lib, FIXED)
    for (let i = 0; i < 3; i++) {
      expect(Array.from(r.zones[i].hourly.heating_w)).toEqual(Array.from(base.zones[i].hourly.heating_w))
      expect(Array.from(r.zones[i].hourly.theta_air_c)).toEqual(Array.from(base.zones[i].hourly.theta_air_c))
    }
    expect(r.zones[0].emitters!.hours_at_cap).toBe(0)
    expect(r.zones[0].annual.unmet_heating_hours).toBe(base.zones[0].annual.unmet_heating_hours)
  })
  it('Engine 1 (the west room alone): the same', () => {
    const one = (perRoom: number | null) => withEmitters(perRoom, 0, (d) => {
      d.zones = [d.zones[0]]
      d.surfaces = d.surfaces.filter((s: any) => s.zone_a === d.zones[0].id && (s.zone_b === 'outside' || s.zone_b === 'ground'))
      d.zones[0].surfaces = d.zones[0].surfaces.filter((id: string) => d.surfaces.some((s: any) => s.id === id))
      d.system_groups[0].zones = [d.zones[0].id]
    })
    const a = one(null), base = runModel(a.doc, W, a.lib, FIXED)
    expect(base.engine).toBe('thermal-1')
    const b = one(base.zones[0].annual.peak_heating_w * 2), r = runModel(b.doc, W, b.lib, FIXED)
    expect(Array.from(r.zones[0].hourly.heating_w)).toEqual(Array.from(base.zones[0].hourly.heating_w))
    const c = one(base.zones[0].annual.peak_heating_w * 0.5), rc = runModel(c.doc, W, c.lib, FIXED)
    expect(Math.max(...rc.zones[0].hourly.heating_w)).toBeLessThanOrEqual(base.zones[0].annual.peak_heating_w * 0.5 * (1 + 1e-9))
    expect(rc.zones[0].annual.unmet_heating_hours).toBeGreaterThan(0)
  })
})

describe('(e) the heated rooms capped below their peak', () => {
  const run = (radiant: number, opts: RunOptions = FIXED) => {
    const options: RunOptions = { ...opts, emitter_rating: 'setpoint' }
    // The uncapped run with the same radiant share (emitters far above the peak), so only the cap differs.
    const a = withEmitters(1e9, radiant), base = runModel(a.doc, W, a.lib, options)
    const cap = 0.6 * Math.min(base.zones[0].annual.peak_heating_w, base.zones[2].annual.peak_heating_w)
    const b = withEmitters(cap, radiant)
    return { base, cap, r: runModel(b.doc, W, b.lib, options) }
  }
  for (const [label, radiant, options] of [
    ['air control, all convective (admittance path)', 0, FIXED],
    ['air control, 30 % radiant (dense path)', 0.3, FIXED],
    ['operative control, 30 % radiant', 0.3, { ...FIXED, control: 'operative' }],
    ['four steps an hour', 0, { ...FIXED, time_step: { steps_per_hour: 4, theta_e_between: 'linear' } }],
  ] as const) {
    it(`${label}: never above the cap, closes every hour, colder and with unmet hours`, () => {
      const { base, cap, r } = run(radiant, options as RunOptions)
      for (const zi of [0, 2]) {
        const z = r.zones[zi]
        expect(Math.max(...z.hourly.heating_w)).toBeLessThanOrEqual(cap * (1 + 1e-9))
        expect(z.closure.max_wh).toBeLessThanOrEqual(1)
        expect(z.emitters!.cap_w).toBeCloseTo(cap, 9)
        expect(z.emitters!.hours_at_cap).toBeGreaterThan(0)
        expect(z.annual.unmet_heating_hours!).toBeGreaterThan(base.zones[zi].annual.unmet_heating_hours!)
        expect(z.annual.min_control_c).toBeLessThan(base.zones[zi].annual.min_control_c)
        expect(z.annual.heating_kwh).toBeLessThan(base.zones[zi].annual.heating_kwh)
      }
      expect(r.zones[1].emitters).toBeNull()
      expect(r.zones[1].annual.unmet_heating_hours).toBeNull()  // the cooled room has no heating setpoint
    })
  }
})

describe('what an emitter needs is named, never filled', () => {
  const err = (over: (d: any) => void) => {
    const { doc } = withEmitters(1000, 0, over)
    try { zoneEmitters(doc); return null } catch (e) { return (e as Error).message }
  }
  it('the design temperatures, the rating, a return above the room, a setpoint to rate at', () => {
    expect(err((d) => { d.system_groups[0].design_flow_c = null })).toBe('system_groups[0].design_flow_c: required: the flow temperature its emitters are rated at')
    expect(err((d) => { d.zones[0].emitters[0].exponent_n = null })).toBe('zones[0].emitters[0].exponent_n: required')
    expect(err((d) => { d.zones[0].emitters[0].count = null })).toBe('zones[0].emitters[0].count: required')
    expect(err((d) => { d.system_groups[0].design_flow_c = 25; d.system_groups[0].design_return_c = 18 })).toMatch(/^system_groups\[0\]\.design_return_c: the return \(18 °C\) must be above/)
    expect(err((d) => { d.system_groups[0].enabled = false })).toMatch(/switched off/)
    expect(err((d) => { d.zones[0].emitters[0].radiant_fraction = 1.5 })).toBe('zones[0].emitters[0].radiant_fraction: must be 0 to 1')
  })
  it('an electric heater gives its stated output; output-weighted radiant share', () => {
    const { doc } = withEmitters(1000, 0.2, (d) => {
      d.zones[0].emitters.push({ id: 'h', kind: 'electric', count: 3, rated_output_w: 1000, radiant_fraction: 0.6, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null })
    })
    const z = zoneEmitters(doc)[0]!
    expect(z.cap_w).toBeCloseTo(4000, 9)
    expect(z.radiant_fraction).toBeCloseTo((1000 * 0.2 + 3000 * 0.6) / 4000, 12)
  })
})

describe('(f) against EnergyPlus: ideal loads at LimitCapacity (Brief 108 Part 3)', () => {
  it('each capped room: heating ±10 %, unmet hours ±20 % or ±50 h, lowest temperature ±1 K', async () => {
    const { createHash } = await import('node:crypto')
    const repo = (p: string) => new URL(`../../../../../${p}`, import.meta.url)
    const capsFile = fs.readFileSync(repo('validation/energyplus/108_capped_spec.json'))
    const EP = JSON.parse(fs.readFileSync(repo('docs/audit/108/03_cooled_room_capped_energyplus.json'), 'utf8'))
    expect(EP.caps_sha256).toBe(createHash('sha256').update(capsFile).digest('hex'))
    expect(EP.spec_sha256).toBe(createHash('sha256').update(fs.readFileSync(repo('validation/energyplus/104_cooled_room_spec.json'))).digest('hex'))
    const CAPS = JSON.parse(capsFile.toString())
    for (const [name, caps] of Object.entries<Record<string, number>>(CAPS.cases)) {
      const { doc, lib } = withEmitters(null, 0, (d) => {
        for (const z of d.zones) if (caps[z.id]) z.emitters = [{ id: `${z.id}_e`, kind: 'electric', count: 1, rated_output_w: caps[z.id], radiant_fraction: 0, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
      })
      const r = runModel(doc, W, lib, REFEREE_OPTIONS)
      for (const zid of Object.keys(caps)) {
        const z = r.zones.find((x) => x.zone_id === zid)!, p = EP.runs[name].zones[zid]
        expect(Math.abs(z.annual.heating_kwh / 1000 / p.heat_mwh - 1), `${name} ${zid} heating`).toBeLessThanOrEqual(0.1)
        const du = Math.abs(z.annual.unmet_heating_hours! - p.unmet_hours)
        expect(du <= 50 || du / p.unmet_hours <= 0.2, `${name} ${zid} unmet ${z.annual.unmet_heating_hours} vs ${p.unmet_hours}`).toBe(true)
        expect(Math.abs(z.annual.min_control_c - p.min_c), `${name} ${zid} lowest`).toBeLessThanOrEqual(1)
        expect(p.peak_heating_w).toBeCloseTo(caps[zid], 0)  // EnergyPlus holds the cap too
      }
    }
  })
})

// ── Review responses (docs/audit/108/06_independent_review.md) ─────────────────────────────────────────────────────
describe('review F2 / M4: Engine 1 carries the radiant share', () => {
  it('half radiant: Engine 1 equals Engine 2 to rounding, and needs more than all convective', () => {
    const els = [wall('a', 60), wall('b', 40)]
    const e1 = (hcf: number) => last(runZone(zone1(els, { heating_convective_fraction: hcf })).heating_w)
    const e2 = (hcf: number) => last(runNetwork({
      zones: [{ air_capacity_j_per_k: 1e6, bridging_w_per_k: 40, ventilation_w_per_k: flat(60), solar_transmitted_w: flat(0), solar_beam_w: null, other_gains: null, setpoints: { heat_c: 20, cool_c: 26 }, initial_c: 20, heating_convective_fraction: hcf }],
      elements: els.map((element) => ({ element, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null })),
      hours: H, theta_e: flat(0), theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 60,
    }).zones[0].heating_w)
    expect(e1(0.5)).toBeCloseTo(e2(0.5), 6)
    expect(e1(0.5) / e1(1)).toBeGreaterThan(1.05)  // under air control, heat put into the walls is partly lost through them
  })
})

describe('review F5: held zones beside capped ones, and emitters with cooling', () => {
  const OP: RunOptions = { ...REFEREE_OPTIONS, control: 'operative' }
  it('M1: operative control, the middle room heated and held beside a capped room: its operative temperature is its setpoint', () => {
    const mid = (d: any) => { d.zones[1].setpoints.heat_c = 21; d.system_groups[0].zones.push(d.zones[1].id) }
    const a = withEmitters(1e9, 0.3, mid), base = runModel(a.doc, W, a.lib, OP)
    const cap = 0.6 * base.zones[0].annual.peak_heating_w
    const b = withEmitters(cap, 0.3, mid), r = runModel(b.doc, W, b.lib, OP)
    expect(r.zones[0].emitters!.hours_at_cap).toBeGreaterThan(0)
    expect(r.zones[1].emitters).toBeNull()
    let held = 0
    for (let h = 0; h < r.zones[1].hourly.heating_w.length; h++) {
      if (r.zones[1].hourly.heating_w[h] > 1 && r.zones[0].hourly.heating_w[h] >= cap * (1 - 1e-9)) {
        expect(Math.abs(r.zones[1].hourly.theta_operative_c[h] - 21)).toBeLessThan(1e-6)
        held++
      }
    }
    expect(held).toBeGreaterThan(0)
  })
  it('M5: a room with emitters and a cooling setpoint: cooled hours hold the operative temperature at the cooling setpoint', () => {
    // The middle room in a narrow band beside it, so its free-or-held choice depends on the cooled room's response.
    const cool = (d: any) => { d.zones[0].setpoints.cool_c = 23; d.zones[1].setpoints.heat_c = 22; d.zones[1].setpoints.cool_c = 22.5; d.system_groups[0].zones.push(d.zones[1].id) }
    const b = withEmitters(800, 1, cool), r = runModel(b.doc, W, b.lib, OP)
    const z = r.zones[0]
    let cooled = 0
    for (let h = 0; h < z.hourly.cooling_w.length; h++) {
      if (z.hourly.cooling_w[h] > 1) { expect(Math.abs(z.hourly.theta_operative_c[h] - 23)).toBeLessThan(1e-6); cooled++ }
    }
    expect(cooled).toBeGreaterThan(0)
    expect(z.emitters!.hours_at_cap).toBeGreaterThan(0)
    expect(z.closure.max_wh).toBeLessThanOrEqual(1)
    // Every room left free in an hour sits inside its own band: the free rooms' control temperatures are taken with
    // the cooled room's cooling response, not its heating response.
    r.zones.forEach((q, zi) => {
      const sp = b.doc.zones[zi].setpoints
      for (let h = 0; h < q.hourly.heating_w.length; h++) {
        if (q.hourly.heating_w[h] !== 0 || q.hourly.cooling_w[h] !== 0) continue
        if (sp.cool_c != null) expect(q.hourly.theta_operative_c[h]).toBeLessThanOrEqual(sp.cool_c + 1e-6)
        if (sp.heat_c != null && !(q.emitters && zi === 0)) expect(q.hourly.theta_operative_c[h]).toBeGreaterThanOrEqual(sp.heat_c - 1e-6)
      }
    })
  })
})

describe('review F8 and F11: refusals in words', () => {
  it('an unknown emitter_limit is refused, not read as the cap', () => {
    const b = withEmitters(800)
    expect(() => runModel(b.doc, W, b.lib, { ...REFEREE_OPTIONS, emitter_limit: 'off' as any })).toThrow('options.emitter_limit: unknown emitter_limit "off"')
  })
  it('a setback says what it is, not a brief number', () => {
    const b = withEmitters(800, 0, (d) => { d.zones[0].setpoints.setback_c = 16 })
    expect(() => runModel(b.doc, W, b.lib, REFEREE_OPTIONS)).toThrow('zones[0].setpoints.setback_c: setbacks (a lower night setpoint) are not modelled yet')
  })
})

// ── Review F1 (Linzie, 15 Nov: "work it out each hour"): the limit follows the room ───────────────────────────────
describe('(g) a colder room draws more from the same radiator', () => {
  const els = [wall('a', 60), wall('b', 40)]
  const k = els.reduce((s, e) => s + e.area_m2 / (Rchain(e) + 1 / e.h_ci), 0) + 40 + 60  // W/K, air to 0 °C outside
  // A radiator rated 800 W at 75/65/20, run at 50/40, n 1.3, in a room heated to 20 °C.
  const R = 800, n = 1.3
  const Q = (room: number) => R * Math.pow(logMeanDeltaT(50, 40, Math.min(room, 20)) / logMeanDeltaT(75, 65, 20), n)
  // Where the steady loss k·θ meets the radiator's output at θ (outside 0 °C), by bisection.
  let lo = 0, hi = 20
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (k * m < Q(m)) lo = m; else hi = m }
  const theta = (lo + hi) / 2
  it('by hand: the steady state is where the loss meets the output at that room temperature, above the setpoint rating', () => {
    expect(theta).toBeLessThan(20)
    expect(Q(theta)).toBeGreaterThan(Q(20) * 1.05)
  })
  it('Engine 1 settles there; each hour within its own limit; closes', () => {
    const r = runZone(zone1(els, { heating_cap_at: Q }))
    expect(Math.abs(last(r.theta_air) - theta)).toBeLessThan(0.01)
    expect(last(r.heating_w)).toBeCloseTo(Q(theta), 0)
    for (let h = 0; h < H; h++) expect(r.heating_w[h]).toBeLessThanOrEqual(r.heating_cap_w![h] * (1 + 1e-12))
    expect(Math.max(...r.closure_wh)).toBeLessThanOrEqual(1)
    expect(Math.min(...r.heating_cap_w!)).toBeGreaterThanOrEqual(Q(20) * (1 - 1e-12))
    expect(() => runZone(zone1(els, { heating_cap_at: Q, heating_cap_w: 500 }))).toThrow('give a fixed limit or one that follows the room, not both')
  })
  it('Engine 2 settles at the same temperature, on the air and operative paths', () => {
    const net: NetworkInputs = {
      zones: [{ air_capacity_j_per_k: 1e6, bridging_w_per_k: 40, ventilation_w_per_k: flat(60), solar_transmitted_w: flat(0), solar_beam_w: null, other_gains: null, setpoints: { heat_c: 20, cool_c: 26 }, initial_c: 20, heating_cap_at: Q }],
      elements: els.map((element) => ({ element, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null })),
      hours: H, theta_e: flat(0), theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 60,
    }
    const r = runNetwork(net)
    expect(Math.abs(last(r.zones[0].theta_air) - theta)).toBeLessThan(0.01)
    expect(last(r.zones[0].heating_w)).toBeCloseTo(Q(theta), 0)
    expect(Math.max(...r.zones[0].closure_wh)).toBeLessThanOrEqual(1e-6)
    const op = runNetwork({ ...net, control: 'operative', zones: [{ ...net.zones[0], heating_convective_fraction: 0.7 }] })
    for (let h = 0; h < H; h++) expect(op.zones[0].heating_w[h]).toBeLessThanOrEqual(op.zones[0].heating_cap_w![h] * (1 + 1e-12))
    expect(Math.max(...op.zones[0].closure_wh)).toBeLessThanOrEqual(1e-6)
  })
})

describe('(g2) the output in a colder room: design water flow, the return falls', () => {
  it('at the setpoint it is the stated output; colder, the water\'s heat equals the radiator\'s at the lower return', () => {
    const { doc } = withEmitters(2000, 0, (d) => { d.system_groups[0].design_flow_c = 50; d.system_groups[0].design_return_c = 40; for (const z of d.zones) for (const e of z.emitters) e.rated_room_c = 20 })
    const z = zoneEmitters(doc)[0]!
    const sp = doc.zones[0].setpoints.heat_c!
    expect(z.at(sp)).toBeCloseTo(z.cap_w, 9)
    expect(z.at(sp + 3)).toBeCloseTo(z.cap_w, 9)  // above the setpoint it is not heating harder
    const room = 15, q = z.at(room)
    const mcp = z.cap_w / (50 - 40)
    const ret = 50 - q / mcp
    expect(ret).toBeLessThan(40)
    expect(q).toBeCloseTo(ratedOutputAt(2000, 1.3, { flow_c: 75, return_c: 65, room_c: 20 }, { flow_c: 50, return_c: ret, room_c: room }), 6)
    expect(q).toBeGreaterThan(z.cap_w)
    // Less than if the return held at 40 °C (the flow would have to rise).
    expect(q).toBeLessThan(ratedOutputAt(2000, 1.3, { flow_c: 75, return_c: 65, room_c: 20 }, { flow_c: 50, return_c: 40, room_c: room }))
  })
})

describe('(h) the cooled room at 50/40: rated by the room against rated at the setpoint', () => {
  const at5040 = (d: any) => { d.system_groups[0].design_flow_c = 50; d.system_groups[0].design_return_c = 40; for (const z of d.zones) for (const e of z.emitters) { e.rated_room_c = 20 } }
  it('fewer hours below, warmer at the coldest, more heat; never above the hour\'s own limit; closes', () => {
    const b = withEmitters(2000, 0.3, at5040)
    const room = runModel(b.doc, W, b.lib, REFEREE_OPTIONS), fixed = runModel(b.doc, W, b.lib, FIXED)
    for (const zi of [0, 2]) {
      const z = room.zones[zi], f = fixed.zones[zi]
      expect(f.annual.unmet_heating_hours!).toBeGreaterThan(0)
      expect(z.annual.unmet_heating_hours!).toBeLessThan(f.annual.unmet_heating_hours!)
      expect(z.annual.min_control_c).toBeGreaterThan(f.annual.min_control_c)
      expect(z.annual.heating_kwh).toBeGreaterThan(f.annual.heating_kwh)
      expect(z.emitters!.cap_w).toBe(f.emitters!.cap_w)  // the stated output is still the one at the setpoint
      expect(z.closure.max_wh).toBeLessThanOrEqual(1)
    }
  })
  it('electric heaters give their stated output whatever the room: the two ratings are identical', () => {
    const el = (d: any) => { for (const z of d.zones) z.emitters = z.emitters.map((e: any) => ({ ...e, kind: 'electric', system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null })) }
    const b = withEmitters(700, 0.3, el)
    const room = runModel(b.doc, W, b.lib, REFEREE_OPTIONS), fixed = runModel(b.doc, W, b.lib, FIXED)
    expect(Array.from(room.zones[0].hourly.heating_w)).toEqual(Array.from(fixed.zones[0].hourly.heating_w))
  })
  it('an unknown rating is refused', () => {
    const b = withEmitters(800)
    expect(() => runModel(b.doc, W, b.lib, { ...REFEREE_OPTIONS, emitter_rating: 'x' as any })).toThrow('options.emitter_rating: unknown emitter_rating "x"')
  })
})

describe('(i) against EnergyPlus: a hot-water radiator whose output follows the room (review F1)', () => {
  it('rated by the room: heating ±10 %, hours below ±20 % or ±50 h, lowest ±1 K; and the rise over the fixed limit matches EnergyPlus\'s', async () => {
    const { createHash } = await import('node:crypto')
    const repo = (p: string) => new URL(`../../../../../${p}`, import.meta.url)
    const specFile = fs.readFileSync(repo('validation/energyplus/108_hotwater_spec.json'))
    const EP = JSON.parse(fs.readFileSync(repo('docs/audit/108/09_hotwater_energyplus.json'), 'utf8'))
    const FX = JSON.parse(fs.readFileSync(repo('docs/audit/108/03_cooled_room_capped_energyplus.json'), 'utf8'))  // EnergyPlus at a fixed limit
    expect(EP.hotwater_spec_sha256).toBe(createHash('sha256').update(specFile).digest('hex'))
    expect(EP.spec_sha256).toBe(createHash('sha256').update(fs.readFileSync(repo('validation/energyplus/104_cooled_room_spec.json'))).digest('hex'))
    const HW = JSON.parse(specFile.toString())
    for (const [name, caps] of Object.entries<Record<string, number>>(HW.cases)) {
      const { doc, lib } = withEmitters(null, 0, (d) => {
        d.system_groups[0].design_flow_c = HW.flow_c; d.system_groups[0].design_return_c = HW.return_c
        for (const z of d.zones) if (caps[z.id]) z.emitters = [{ id: `${z.id}_rad`, kind: 'radiator', count: 1, rated_output_w: caps[z.id], radiant_fraction: HW.radiant_fraction, system_group_id: 'boiler', rated_flow_c: HW.flow_c, rated_return_c: HW.return_c, rated_room_c: HW.rated_room_c, exponent_n: HW.exponent_n }]
      })
      const room = runModel(doc, W, lib, REFEREE_OPTIONS), fixed = runModel(doc, W, lib, FIXED)
      for (const zid of Object.keys(caps)) {
        const z = room.zones.find((x) => x.zone_id === zid)!, f = fixed.zones.find((x) => x.zone_id === zid)!
        const p = EP.runs[name].zones[zid], pf = FX.runs[name].zones[zid]
        // EnergyPlus's radiator ran with the output per kelvin it was rated for (Engine 2's, design / (flow − setpoint)).
        expect(Math.abs(p.k_measured_median_w_per_k / (caps[zid] / (HW.flow_c - HW.rated_room_c)) - 1)).toBeLessThan(0.01)
        expect(Math.abs(z.annual.heating_kwh / 1000 / p.heat_mwh - 1), `${name} ${zid} heating`).toBeLessThanOrEqual(0.1)
        const du = Math.abs(z.annual.unmet_heating_hours! - p.unmet_hours)
        expect(du <= 50 || du / p.unmet_hours <= 0.2, `${name} ${zid} hours below ${z.annual.unmet_heating_hours} vs ${p.unmet_hours}`).toBe(true)
        expect(Math.abs(z.annual.min_control_c - p.min_c), `${name} ${zid} lowest`).toBeLessThanOrEqual(1)
        // The re-rating's own effect: how much warmer the coldest hour gets than at a fixed limit, in each program.
        expect(Math.abs((z.annual.min_control_c - f.annual.min_control_c) - (p.min_c - pf.min_c)), `${name} ${zid} rise`).toBeLessThanOrEqual(0.2)
        expect(z.annual.unmet_heating_hours!).toBeLessThan(f.annual.unmet_heating_hours!)
      }
    }
  })
})
