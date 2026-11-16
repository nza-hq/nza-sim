/**
 * Brief 107 Part 1: systems by zone group, by hand.
 *
 * The cooled room's three zones (west and east heated, middle cooled) with stated hourly demand, so every figure can
 * be worked out on paper: two heating groups at 60/40 over the outer rooms, one cooling group, hot water per m², a
 * circulation pump, a fan, and lighting with a gain fraction and a control factor.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ModelDocument } from '../../schema/model'
import { calendar } from '../gains'
import type { ModelResults } from '../results'
import { checkServed, readEndUseKwh, readSystemsEui, readSystemsTotalKwh, runSystems, ServedError, WATER_KWH_PER_L_K, type SystemsResults } from '../systems'
import { cooledRoomDocument } from './cooledRoom'
import { MOS, readMos } from './denver'

const W = readMos(fs.readFileSync(MOS))
const H = W.hours.count

function setup() {
  const d: any = structuredClone(cooledRoomDocument().doc)
  const group = (id: string, service: string, zones: string[], share: number, source: string | null, eff: number | null, more: object = {}) =>
    ({ id, service, zones, enabled: true, share_pct: share, source, efficiency_metric: eff, ...more })
  d.system_groups = [
    group('hp', 'heating', ['west', 'east'], 60, 'ambient_air', 3),
    group('boiler', 'heating', ['west', 'east'], 40, 'gas', 0.9),
    group('chiller', 'cooling', ['middle'], 100, 'electricity', 2.5),
    group('dhw_boiler', 'dhw', ['west', 'middle', 'east'], 100, 'gas', 0.8),
    group('lights', 'lighting', ['west', 'middle', 'east'], 100, 'electricity', null, { control_factor: 0.5 }),
  ]
  d.services.dhw = { storage_setpoint_c: 60, tap_outlet_temp_c: 40, cold_supply_temp_c: 10, load_shape: 'flat', circulation_pump_w: 100 }
  // Brief 112: hot water use is the space's, on an occupancy profile with no people (per m², so none are needed).
  d.profiles.push({ id: 'hw', kind: 'occupancy', density: { value: 0, basis: 'per_m2' }, occupancy_rate: 1, sensible_w_per_person: 75, radiant_fraction: 0.3, schedule: { weekday: Array(24).fill(1), saturday: Array(24).fill(1), sunday: Array(24).fill(1) }, dhw: { basis: 'per_m2', litres_per_day: 2 } })
  for (const z of d.zones) z.profile_refs.occupancy = 'hw'
  d.profiles.push({ id: 'light', kind: 'lighting', relationship_to_occupancy: 'always_on', area_share: 1, gain_fraction: 0.5, magnitude: { value: 5, unit: 'w_per_m2' }, radiant_fraction: 0.3 })
  for (const z of d.zones) z.profile_refs.lighting = ['light']
  d.zones[0].ventilation = [{ id: 'fan', kind: 'mev', enabled: true, flow_rate: 100, flow_rate_basis: 'constant', sfp_w_per_l_s: 1, recovery_sensible_pct: null, control_schedule_ref: 'always_on', legacy_v25: null }]
  return d
}
/** Results with stated demand: west 1000 W heating, east 500 W heating, middle 800 W cooling, every hour. */
function results(doc: any): ModelResults {
  const flat = (v: number) => new Float64Array(H).fill(v)
  const demand: Record<string, [number, number]> = { west: [1000, 0], middle: [0, 800], east: [500, 0] }
  return { zones: doc.zones.map((z: any) => ({ zone_id: z.id, hourly: { heating_w: flat(demand[z.id][0]), cooling_w: flat(demand[z.id][1]) }, annual: { heating_kwh: (demand[z.id][0] * H) / 1000, cooling_kwh: (demand[z.id][1] * H) / 1000 } })) } as unknown as ModelResults
}
const ok = (doc: any) => {
  const r = runSystems(ModelDocument.parse(doc), results(doc), W.hours)
  if (!r.ok) throw new Error(JSON.stringify(r.missing))
  return r.systems
}
const g = (s: SystemsResults, id: string) => s.groups.find((x) => x.id === id)!

describe('systems by zone group, by hand', () => {
  const doc = setup()
  const s = ok(doc)
  const area = (id: string) => doc.zones.find((z: any) => z.id === id).area_m2
  const floor = doc.zones.reduce((a: number, z: any) => a + z.area_m2, 0)

  it('heating and cooling: demand × share ÷ efficiency, per group', () => {
    const heat = (1500 * H) / 1000
    expect(g(s, 'hp').served_kwh).toBeCloseTo(heat * 0.6, 6)
    expect(g(s, 'hp').fuel_kwh).toBeCloseTo((heat * 0.6) / 3, 6)
    expect(g(s, 'hp').fuel).toBe('electricity')
    expect(g(s, 'boiler').fuel_kwh).toBeCloseTo((heat * 0.4) / 0.9, 6)
    expect(g(s, 'chiller').fuel_kwh).toBeCloseTo((800 * H) / 1000 / 2.5, 6)
  })
  it('hot water: the tap-mix model per m² of each zone it serves, and the pump all year', () => {
    const hot = (40 - 10) / (60 - 10)
    const kwh = 2 * floor * hot * 50 * WATER_KWH_PER_L_K * 365
    expect(s.dhw!.hot_fraction).toBeCloseTo(0.6, 12)
    expect(s.dhw!.demand_kwh).toBeCloseTo(kwh, 6)
    expect(g(s, 'dhw_boiler').fuel_kwh).toBeCloseTo(kwh / 0.8, 6)
    expect(readEndUseKwh(s, 'dhw_circulation')).toBeCloseTo((100 * H) / 1000, 6)
  })
  it('fans: SFP × flow × the hours they run; lighting: the electricity, not the heat, whatever the control factor', () => {
    expect(readEndUseKwh(s, 'fans')).toBeCloseTo((1 * 100 * H) / 1000, 6)
    expect(g(s, 'lights').fuel_kwh).toBeCloseTo((5 * floor * H) / 1000, 6)
    expect(readEndUseKwh(s, 'lighting')).toBeCloseTo((5 * floor * H) / 1000, 6)
  })
  it('served equals the demand it takes, and the end-use lines sum to the totals by fuel (Rule 9)', () => {
    for (const service of ['heating', 'cooling', 'dhw'] as const) {
      const served = s.groups.filter((x) => x.service === service).reduce((a, x) => a + x.served_kwh, 0)
      const taken = s.zone_demand.filter((z) => z.service === service).reduce((a, z) => a + z.kwh, 0)
      expect(served).toBeCloseTo(taken, 6)
    }
    const byFuelFromLines: Record<string, number> = {}
    for (const l of s.end_uses) byFuelFromLines[l.fuel] = (byFuelFromLines[l.fuel] ?? 0) + l.kwh
    for (const [f, v] of Object.entries(s.by_fuel)) expect(byFuelFromLines[f] ?? 0).toBeCloseTo(v, 6)
    let hourly = 0
    for (let h = 0; h < H; h++) hourly += s.electricity_w[h]
    expect(hourly / 1000).toBeCloseTo(s.by_fuel.electricity, 4)
    expect(readSystemsEui(s)).toBeCloseTo(readSystemsTotalKwh(s) / floor, 9)
    expect(area('west')).toBeGreaterThan(0)
  })
  it('a fan on a schedule runs only its scheduled hours', () => {
    const d = setup()
    const day = Array(24).fill(0).map((_, h) => (h >= 8 && h < 18 ? 1 : 0))
    d.profiles.push({ id: 'office', kind: 'schedule', day_types: { weekday: day, saturday: Array(24).fill(0), sunday: Array(24).fill(0) } })
    d.zones[0].ventilation[0].control_schedule_ref = 'office'
    const r = ok(d)
    const c = calendar(W.hours)
    let on = 0
    for (let h = 0; h < H; h++) if (c.day[h] === 'weekday' && c.hourOfDay[h] >= 8 && c.hourOfDay[h] < 18) on++
    expect(on).toBeGreaterThan(2000)
    expect(readEndUseKwh(r, 'fans')).toBeCloseTo((100 * on) / 1000, 9)
  })
})

describe('systems: what is missing is named, never filled', () => {
  const missing = (d: any) => {
    const r = runSystems(ModelDocument.parse(d), results(d), W.hours)
    if (r.ok) throw new Error('expected a refusal')
    return r.missing
  }
  it('a heated zone that no heating system serves', () => {
    const d = setup()
    for (const x of d.system_groups) if (x.service === 'heating') x.zones = ['west']
    expect(missing(d)).toEqual([{ path: 'zones[2].heating', message: 'no heating system serves east' }])
  })
  it('shares that do not total 100 %', () => {
    const d = setup()
    d.system_groups[1].share_pct = 30
    expect(missing(d).map((m) => m.message)).toContain('the heating systems serving west share 90 %, not 100 %')
  })
  it('an unknown source, a missing efficiency, impossible hot water temperatures, a custom setpoint, a fan with no SFP', () => {
    const d = setup()
    d.system_groups[0].source = 'peat'
    d.system_groups[2].efficiency_metric = null
    d.services.dhw.tap_outlet_temp_c = 70
    d.services.heating = { setpoint_mode: 'custom', setpoint_c: 19 }
    d.zones[0].ventilation[0].sfp_w_per_l_s = null
    const paths = missing(d).map((m) => m.path)
    expect(paths).toEqual(expect.arrayContaining([
      'system_groups[0].source', 'system_groups[2].efficiency_metric', 'services.dhw.tap_outlet_temp_c',
      'services.heating.setpoint_mode', 'zones[0].ventilation[0].sfp_w_per_l_s',
    ]))
  })
  it('hot water inputs, when a hot water system is installed', () => {
    const d = setup()
    d.services.dhw.cold_supply_temp_c = null
    d.services.dhw.circulation_pump_w = null
    expect(missing(d).map((m) => m.path)).toEqual(expect.arrayContaining(['services.dhw.cold_supply_temp_c', 'services.dhw.circulation_pump_w']))
  })
  it('a zone with no demand needs no system; lighting with no group still counts, under no group', () => {
    const d = setup()
    d.system_groups = d.system_groups.filter((x: any) => x.service !== 'lighting')
    const s = ok(d)
    expect(readEndUseKwh(s, 'lighting')).toBeGreaterThan(0)
    expect(s.ungrouped.filter((u) => u.end_use === 'lighting').length).toBe(3)
  })
})

describe('systems: review responses (Brief 107 F1–F8)', () => {
  const missing = (d: any, r = results(d)) => {
    const a = runSystems(ModelDocument.parse(d), r, W.hours)
    if (a.ok) throw new Error('expected a refusal')
    return a.missing
  }
  it('F1: a zone with hot water use that no hot water system serves is named, not dropped', () => {
    const d = setup()
    d.system_groups.find((x: any) => x.id === 'dhw_boiler').zones = ['west']
    expect(missing(d)).toEqual(expect.arrayContaining([{ path: 'zones[1].dhw', message: 'no hot water system serves middle' }, { path: 'zones[2].dhw', message: 'no hot water system serves east' }]))
  })
  it('F1: hot water use stated with no hot water system is named; with neither, there is no hot water', () => {
    const d = setup()
    d.system_groups = d.system_groups.filter((x: any) => x.service !== 'dhw')
    expect(missing(d)).toEqual([{ path: 'services.dhw', message: 'hot water use is stated on a space but no hot water system serves it' }])
    d.profiles.find((p: any) => p.id === 'hw').dhw = null
    expect(readEndUseKwh(ok(d), 'dhw')).toBe(0)
  })
  it('Brief 112: a hot water system with no space stating its use is named', () => {
    const d = setup()
    d.profiles.find((p: any) => p.id === 'hw').dhw = null
    expect(missing(d)).toEqual([{ path: 'services.dhw', message: 'a hot water system is installed but no space states its hot water use (litres a day per person or per m²)' }])
  })
  it('F2: served is checked against the demand computed apart from serving, per service', () => {
    const s = ok(setup())
    const heat = (1500 * H) / 1000, cool = (800 * H) / 1000
    expect(() => checkServed(s.groups, heat, cool, s.dhw!.demand_kwh)).not.toThrow()
    // A zone dropped before serving (the review's mutation M3) leaves served short of the integrand.
    expect(() => checkServed(s.groups, heat + 1, cool, s.dhw!.demand_kwh)).toThrow(ServedError)
    expect(() => checkServed(s.groups, heat, cool, s.dhw!.demand_kwh * 1.001)).toThrow(ServedError)
    // And runSystems itself throws when the model's annual demand disagrees with the hours it serves.
    const d = setup()
    const r: any = results(d)
    r.zones[2].annual.heating_kwh += 10
    expect(() => runSystems(ModelDocument.parse(d), r, W.hours)).toThrow(ServedError)
  })
  it('F3: groups sharing a zone\'s lighting must state their control factor; a lone group need not', () => {
    const d = setup()
    d.system_groups.find((x: any) => x.id === 'lights').control_factor = null
    expect(readEndUseKwh(ok(d), 'lighting')).toBeGreaterThan(0)
    d.system_groups.find((x: any) => x.id === 'lights').share_pct = 50
    d.system_groups.push({ id: 'lights2', service: 'lighting', zones: ['west', 'middle', 'east'], enabled: true, share_pct: 50, source: 'electricity', efficiency_metric: null, control_factor: 1 })
    expect(missing(d).map((m) => m.path)).toContain('system_groups[4].control_factor')
  })
  it('F4: inputs not modelled yet are listed, not silently dropped', () => {
    const d = setup()
    // Brief 120: a heating system's capacity is modelled (in the run), so it is no longer listed; a hot water one's is.
    d.system_groups[0].capacity_kw = 0.1
    d.system_groups[3].capacity_kw = 30
    d.system_groups[1].control_schedule_ref = 'nowhere'
    d.zones[0].ventilation[0].defrost_penalty_kwh = 5
    expect(ok(d).not_modelled).toEqual([
      { path: 'system_groups[1].control_schedule_ref', what: 'control schedule "nowhere" (not in this building)' },
      { path: 'system_groups[3].capacity_kw', what: 'capacity' },
      { path: 'zones[0].ventilation[0].defrost_penalty_kwh', what: 'defrost penalty' },
    ])
  })
  it('F6: hourly shapes: one hot hour of heating lands in that hour of electricity; hot water follows occupancy', () => {
    const d = setup()
    const r: any = results(d)
    const spike = new Float64Array(H); spike[1000] = 9000
    r.zones[0].hourly.heating_w = spike; r.zones[0].annual.heating_kwh = 9
    const s = ok2(d, r)
    const hp = g(s, 'hp'), boiler = g(s, 'boiler')
    expect(hp.fuel_w[1000] - (500 * 0.6) / 3).toBeCloseTo((9000 * 0.6) / 3, 9)
    expect(hp.fuel_w[999]).toBeCloseTo((500 * 0.6) / 3, 9)
    expect(boiler.fuel_w[1000] - (500 * 0.4) / 0.9).toBeCloseTo((9000 * 0.4) / 0.9, 9)
    // electricity_w hour by hour: the heat pump, chiller, fan, hot water pump and lighting at hour 1000
    const lightW = 5 * d.zones.reduce((a: number, z: any) => a + z.area_m2, 0)
    expect(s.electricity_w[1000]).toBeCloseTo(hp.fuel_w[1000] + 800 / 2.5 + 100 + 100 + lightW, 6)
    // hot water following occupancy: zero in unoccupied hours, the same annual total
    const o = setup()
    o.profiles.push({ id: 'occ', kind: 'occupancy', density: { value: 0.1, basis: 'per_m2' }, occupancy_rate: 1, sensible_w_per_person: 75, radiant_fraction: 0.3, schedule: { weekday: Array(24).fill(0).map((_, h) => (h >= 8 && h < 18 ? 1 : 0)), saturday: Array(24).fill(0), sunday: Array(24).fill(0) }, dhw: { basis: 'per_m2', litres_per_day: 2 } })
    for (const z of o.zones) z.profile_refs.occupancy = 'occ'
    const flat = ok(o)
    o.services.dhw.load_shape = 'follow_occupancy'
    const fo = ok(o)
    expect(g(fo, 'dhw_boiler').fuel_kwh).toBeCloseTo(g(flat, 'dhw_boiler').fuel_kwh, 6)
    const c = calendar(W.hours)
    let night = 0
    for (let h = 0; h < H; h++) if (c.hourOfDay[h] < 8) night += g(fo, 'dhw_boiler').fuel_w[h]
    expect(night).toBe(0)
  })
  it('F8: a building with no floor area has no EUI; it is named, not 0', () => {
    const d = setup()
    for (const z of d.zones) z.area_m2 = 0
    expect(missing(d).map((m) => m.path)).toContain('zones')
  })
})
const ok2 = (doc: any, r: ModelResults) => {
  const a = runSystems(ModelDocument.parse(doc), r, W.hours)
  if (!a.ok) throw new Error(JSON.stringify(a.missing))
  return a.systems
}
