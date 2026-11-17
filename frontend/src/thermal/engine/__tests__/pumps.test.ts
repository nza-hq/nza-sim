/**
 * Brief 114 Part 2: pumps, fans by how they run, other loads, and the control map, by hand.
 *
 * The cooled room's three zones with stated hourly demand (as systems.test.ts): the heat each system gives is known
 * on paper, so every pump figure can be worked out. Nothing here is fitted: the part-load curve is EnergyPlus's
 * Pump:VariableSpeed default (fraction of power = fraction of load).
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ModelDocument } from '../../schema/model'
import { upgradeDocument } from '../../schema/upgrade'
import { calendar } from '../gains'
import type { ModelResults } from '../results'
import { pumpCurve, PUMP_CURVE, runPumps } from '../pumps'
import { defaultPumps, defaultPumpWPerM2, NCM_SOURCE } from '../../catalogue/auxiliaryDefaults'
import { readEndUseKwh, readEntryKwh, runSystems, type SystemsResults } from '../systems'
import { zoneVentilation } from '../ventilation'
import { cooledRoomDocument } from './cooledRoom'
import { MOS, readMos } from './denver'

const W = readMos(fs.readFileSync(MOS))
const H = W.hours.count
const flat = (v: number) => new Float64Array(H).fill(v)

function setup() {
  const d: any = structuredClone(cooledRoomDocument().doc)
  const group = (id: string, service: string, zones: string[], share: number, source: string | null, eff: number | null, more: object = {}) =>
    ({ id, service, zones, enabled: true, share_pct: share, source, efficiency_metric: eff, ...more })
  d.system_groups = [
    group('hp', 'heating', ['west', 'east'], 60, 'ambient_air', 3),
    group('boiler', 'heating', ['west', 'east'], 40, 'gas', 0.9),
    group('chiller', 'cooling', ['middle'], 100, 'electricity', 2.5),
  ]
  d.zones[0].ventilation = [{ id: 'fan', kind: 'mev', enabled: true, flow_rate: 100, flow_rate_basis: 'constant', sfp_w_per_l_s: 1, recovery_sensible_pct: null, control_schedule_ref: 'always_on', legacy_v25: null }]
  const day = Array(24).fill(0).map((_, h) => (h >= 8 && h < 18 ? 1 : 0))
  d.profiles.push({ id: 'office', kind: 'schedule', day_types: { weekday: day, saturday: Array(24).fill(0), sunday: Array(24).fill(0) } })
  return d
}
/** West 1000 W and east 500 W heating every hour (or only in `months`), middle 800 W cooling. */
function results(doc: any, months: number[] | null = null): ModelResults {
  const on = (v: number) => { const a = new Float64Array(H); for (let h = 0; h < H; h++) a[h] = !months || months.includes(W.hours.month[h]) ? v : 0; return a }
  const demand: Record<string, [number, number]> = { west: [1000, 0], middle: [0, 800], east: [500, 0] }
  return { zones: doc.zones.map((z: any) => {
    const hw = on(demand[z.id][0]), cw = flat(demand[z.id][1])
    return { zone_id: z.id, hourly: { heating_w: hw, cooling_w: cw }, annual: { heating_kwh: hw.reduce((a, b) => a + b, 0) / 1000, cooling_kwh: (demand[z.id][1] * H) / 1000 } }
  }) } as unknown as ModelResults
}
const run = (doc: any, months: number[] | null = null, design: Map<string, number> | null = null) => runSystems(ModelDocument.parse(doc), results(doc, months), W.hours, design)
const ok = (doc: any, months: number[] | null = null, design: Map<string, number> | null = null): SystemsResults => {
  const r = run(doc, months, design)
  if (!r.ok) throw new Error(JSON.stringify(r.missing))
  return r.systems
}
const missing = (doc: any) => { const r = run(doc); if (r.ok) throw new Error('expected a refusal'); return r.missing }
const pump = (s: SystemsResults, id: string) => s.pumps.find((p) => p.id === id)!

describe('Brief 114 P2: the part-load curve', () => {
  it('is EnergyPlus Pump:VariableSpeed\'s default (0, 1, 0, 0): fraction of power = fraction of load, held to 0..1', () => {
    expect(PUMP_CURVE.coefficients).toEqual([0, 1, 0, 0])
    expect(pumpCurve(0)).toBe(0)
    expect(pumpCurve(0.37)).toBeCloseTo(0.37, 12)
    expect(pumpCurve(1.4)).toBe(1)
    expect(pumpCurve(-1)).toBe(0)
  })
  it('runPumps by hand: fixed draws rated × running; variable × load ÷ design; continuous follows the months with load', () => {
    const month = [1, 1, 2, 2, 3, 3]
    const load = Float64Array.from([0, 500, 0, 0, 1000, 250])
    expect(Array.from(runPumps(100, 'fixed', 'with_demand', load, 1000, month, null).w)).toEqual([0, 100, 0, 0, 100, 100])
    expect(Array.from(runPumps(100, 'variable', 'with_demand', load, 1000, month, null).w)).toEqual([0, 50, 0, 0, 100, 25])
    const c = runPumps(100, 'fixed', 'continuous', load, 1000, month, null)
    expect(Array.from(c.w)).toEqual([100, 100, 0, 0, 100, 100])  // February has no load: out of season
    expect(c.hours_run).toBe(4)
    const s = runPumps(100, 'fixed', 'schedule', load, 1000, month, Float64Array.from([1, 0.5, 0, 1, 0, 1]))
    expect(Array.from(s.w)).toEqual([100, 50, 0, 100, 0, 100])
    expect(s.hours_run).toBe(3.5)
  })
})

describe('Brief 114 P2: pumps in the systems run', () => {
  it('no pumps stated: no pump lines, and every other line as before', () => {
    const s = ok(setup())
    expect(s.pumps).toEqual([])
    expect(readEndUseKwh(s, 'pumps')).toBe(0)
  })
  it('fixed, with demand: rated W every hour the system gives heat; heating energy unchanged', () => {
    const base = ok(setup())
    const d = setup()
    d.system_groups[0].pumps = { power: { w: 100 }, speed: 'fixed', runs: 'with_demand' }
    const s = ok(d)
    expect(readEndUseKwh(s, 'pumps')).toBeCloseTo((100 * H) / 1000, 9)
    expect(pump(s, 'hp')).toMatchObject({ rated_w: 100, rated_from: 'w', design_from: 'peak', design_w: 900, hours_run: H })
    expect(readEndUseKwh(s, 'heating')).toBeCloseTo(readEndUseKwh(base, 'heating'), 9)
    expect(s.by_fuel.electricity - base.by_fuel.electricity).toBeCloseTo((100 * H) / 1000, 6)
    expect(s.end_uses.find((l) => l.end_use === 'pumps')!.fuel).toBe('electricity')
  })
  it('variable speed: rated × the hour\'s load ÷ the capacity (900 W of 2 kW gives 45 %), or ÷ the busiest hour', () => {
    const d = setup()
    d.system_groups[0].capacity_kw = 2
    d.system_groups[0].pumps = { power: { w: 100 }, speed: 'variable', runs: 'with_demand' }
    const s = ok(d)
    expect(pump(s, 'hp')).toMatchObject({ design_w: 2000, design_from: 'capacity' })
    expect(readEndUseKwh(s, 'pumps')).toBeCloseTo((45 * H) / 1000, 9)
    delete d.system_groups[0].capacity_kw
    expect(readEndUseKwh(ok(d), 'pumps')).toBeCloseTo((100 * H) / 1000, 9)  // every hour is the busiest
  })
  it('W per kW of capacity or of the design heat loss (review F4: never of the busiest hour), and W per m² served', () => {
    const d = setup()
    d.system_groups[0].capacity_kw = 2
    d.system_groups[0].pumps = { power: { w_per_kw_capacity: 5 }, speed: 'fixed', runs: 'with_demand' }
    expect(pump(ok(d), 'hp')).toMatchObject({ rated_w: 10, rated_from: 'capacity' })
    delete d.system_groups[0].capacity_kw
    expect(missing(d)).toEqual([expect.objectContaining({ path: 'system_groups[0].pumps.power', message: expect.stringContaining('design conditions') })])
    const s = ok(d, null, new Map([['hp', 3000]]))
    expect(pump(s, 'hp')).toMatchObject({ rated_w: 15, rated_from: 'design_heat_loss', design_w: 3000, design_from: 'design_heat_loss' })
    // A stated W keeps its busiest-hour design load, shown as such.
    d.system_groups[0].pumps.power = { w: 100 }
    expect(pump(ok(d), 'hp')).toMatchObject({ design_w: 900, design_from: 'peak' })
    d.system_groups[0].pumps.power = { w_per_m2: 0.6 }
    const area = d.zones.filter((z: any) => z.id !== 'middle').reduce((a: number, z: any) => a + z.area_m2, 0)
    expect(pump(ok(d), 'hp').rated_w).toBeCloseTo(0.6 * area * 0.6, 12)
    expect(pump(ok(d), 'hp').rated_from).toBe('floor')
  })
  it('continuous: every hour of the months the system has load (heating in January to March only)', () => {
    const d = setup()
    d.system_groups[0].pumps = { power: { w: 100 }, speed: 'fixed', runs: 'continuous' }
    d.system_groups[2].pumps = { power: { w: 50 }, speed: 'fixed', runs: 'continuous' }
    const s = ok(d, [1, 2, 3])
    let q1 = 0
    for (let h = 0; h < H; h++) if (W.hours.month[h] <= 3) q1++
    expect(pump(s, 'hp').hours_run).toBe(q1)
    expect(pump(s, 'chiller').hours_run).toBe(H)  // the cooled room has load all year
    expect(readEndUseKwh(s, 'pumps')).toBeCloseTo((100 * q1 + 50 * H) / 1000, 9)
    expect(pump(s, 'hp')).toMatchObject({ season_months: [1, 2, 3], season_from: 'load' })
  })
  it('continuous in a stated season (Linzie 16 Nov 23:11): every hour of those months, whatever the load', () => {
    const d = setup()
    d.system_groups[0].pumps = { power: { w: 100 }, speed: 'fixed', runs: 'continuous', season_months: [10, 11, 12, 1, 2, 3, 4] }
    const s = ok(d, [1, 2])
    let n = 0
    for (let h = 0; h < H; h++) if ([10, 11, 12, 1, 2, 3, 4].includes(W.hours.month[h])) n++
    expect(pump(s, 'hp')).toMatchObject({ hours_run: n, season_months: [1, 2, 3, 4, 10, 11, 12], season_from: 'stated' })
    expect(readEndUseKwh(s, 'pumps')).toBeCloseTo((100 * n) / 1000, 9)
    const issues = (x: any) => { const r = ModelDocument.safeParse(x); return r.success ? [] : r.error.issues.map((i) => i.path.join('.')) }
    d.system_groups[0].pumps = { power: { w: 100 }, speed: 'fixed', runs: 'with_demand', season_months: [1] }
    expect(issues(d)).toEqual(['system_groups.0.pumps.season_months'])
    d.system_groups[0].pumps = { power: { w: 100 }, speed: 'fixed', runs: 'continuous', season_months: [1, 1] }
    expect(issues(d)).toEqual(['system_groups.0.pumps.season_months'])
  })
  it('to a schedule: only its hours, whatever the load', () => {
    const d = setup()
    d.system_groups[0].pumps = { power: { w: 100 }, speed: 'fixed', runs: 'schedule', schedule_ref: 'office' }
    const c = calendar(W.hours)
    let on = 0
    for (let h = 0; h < H; h++) if (c.day[h] === 'weekday' && c.hourOfDay[h] >= 8 && c.hourOfDay[h] < 18) on++
    expect(pump(ok(d), 'hp').hours_run).toBe(on)
    expect(readEndUseKwh(ok(d), 'pumps')).toBeCloseTo((100 * on) / 1000, 9)
  })
  it('Rule 9: the end-use lines, pumps included, sum to the totals by fuel, and the hourly electricity to its total', () => {
    const d = setup()
    d.system_groups[0].pumps = { power: { w: 100 }, speed: 'variable', runs: 'with_demand' }
    d.system_groups[1].pumps = { power: { w: 60 }, speed: 'fixed', runs: 'continuous' }
    const s = ok(d)
    const byFuel: Record<string, number> = {}
    for (const l of s.end_uses) byFuel[l.fuel] = (byFuel[l.fuel] ?? 0) + l.kwh
    for (const [f, v] of Object.entries(s.by_fuel)) expect(byFuel[f] ?? 0).toBeCloseTo(v, 6)
    let e = 0
    for (let h = 0; h < H; h++) e += s.electricity_w[h]
    expect(e / 1000).toBeCloseTo(s.by_fuel.electricity, 4)
    // Review F8: one exposure; the entry's kWh is read from its line.
    expect(s.pumps[0]).not.toHaveProperty('kwh')
    expect(readEndUseKwh(s, 'pumps')).toBeCloseTo(readEntryKwh(s, 'pumps', 'hp') + readEntryKwh(s, 'pumps', 'boiler'), 9)
  })
  it('a hot water system\'s pumps move what its heater gives', () => {
    const d = setup()
    d.system_groups.push({ id: 'dhw', service: 'dhw', zones: ['west', 'middle', 'east'], enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.8, pumps: { power: { w: 40 }, speed: 'fixed', runs: 'with_demand' } })
    d.services.dhw = { storage_setpoint_c: 60, tap_outlet_temp_c: 40, cold_supply_temp_c: 10, load_shape: 'flat', circulation_pump_w: 0 }
    d.profiles.push({ id: 'hw', kind: 'occupancy', density: { value: 0, basis: 'per_m2' }, occupancy_rate: 1, sensible_w_per_person: 75, radiant_fraction: 0.3, schedule: { weekday: Array(24).fill(1), saturday: Array(24).fill(1), sunday: Array(24).fill(1) }, dhw: { basis: 'per_m2', litres_per_day: 2 } })
    for (const z of d.zones) z.profile_refs.occupancy = 'hw'
    expect(pump(ok(d), 'dhw').hours_run).toBe(H)
  })
})

describe('Brief 114 P2: what is refused, by name', () => {
  it('an old auxiliary "Pumps" load beside system pumps would count twice', () => {
    const d = setup()
    d.profiles.push({ id: 'aux_pumps', kind: 'auxiliary', label: 'Pumps', relationship_to_occupancy: 'always_on', area_share: 1, gain_fraction: 1, magnitude: { value: 1, unit: 'w_per_m2' }, radiant_fraction: 0.3 })
    d.zones[0].profile_refs.auxiliary = ['aux_pumps']
    expect(ok(d).pumps).toEqual([])  // alone it still runs, as stated
    d.system_groups[0].pumps = { power: { w: 100 }, speed: 'fixed', runs: 'with_demand' }
    expect(missing(d)).toEqual([expect.objectContaining({ path: `profiles[${d.profiles.length - 1}]`, message: expect.stringContaining('counted twice') })])
    d.profiles[d.profiles.length - 1].label = 'Heating circulators'  // review F6: named otherwise, still caught
    expect(missing(d)).toHaveLength(1)
  })
  it('review F6: an old auxiliary lift or external lighting load beside an other load of that kind', () => {
    const d = setup()
    d.profiles.push({ id: 'aux_lift', kind: 'auxiliary', label: 'Lift', relationship_to_occupancy: 'always_on', area_share: 1, gain_fraction: 1, magnitude: { value: 1, unit: 'w_per_m2' }, radiant_fraction: 0.3 })
    d.zones[0].profile_refs.auxiliary = ['aux_lift']
    expect(ok(d).other_loads).toEqual([])
    d.other_loads = [{ id: 'lift', kind: 'lift', power_w: 2000, runs: 'continuous' }]
    expect(missing(d)).toEqual([expect.objectContaining({ message: expect.stringContaining('counted twice') })])
  })
  it('review F7: with pumps stated, their heat into the water is listed as not counted', () => {
    const d = setup()
    expect(ok(d).not_modelled.some((n) => /pump heat/.test(n.what))).toBe(false)
    d.system_groups[0].pumps = { power: { w: 100 }, speed: 'fixed', runs: 'with_demand' }
    expect(ok(d).not_modelled).toContainEqual({ path: 'system_groups[].pumps', what: 'pump heat into the water (not counted)' })
  })
  it('the schema: pumps on a lighting system, a schedule for pumps that run with demand, a missing schedule', () => {
    const issues = (d: any) => { const r = ModelDocument.safeParse(d); return r.success ? [] : r.error.issues.map((i) => i.path.join('.')) }
    const d = setup()
    d.system_groups.push({ id: 'lights', service: 'lighting', zones: ['west'], enabled: true, share_pct: 100, source: 'electricity', efficiency_metric: null, pumps: { power: { w: 1 }, speed: 'fixed', runs: 'with_demand' } })
    d.system_groups[0].pumps = { power: { w: 1 }, speed: 'fixed', runs: 'with_demand', schedule_ref: 'office' }
    d.system_groups[1].pumps = { power: { w: 1 }, speed: 'fixed', runs: 'schedule' }
    expect(issues(d)).toEqual(expect.arrayContaining(['system_groups.3.pumps', 'system_groups.0.pumps.schedule_ref', 'system_groups.1.pumps.schedule_ref']))
  })
})

describe('Brief 114 P2: fans by how they run', () => {
  it('continuous: the same as the built-in always-on schedule, value for value', () => {
    const d = setup()
    const a = zoneVentilation(ModelDocument.parse(d), W.hours)[0][0]
    d.zones[0].ventilation[0].runs = 'continuous'
    d.zones[0].ventilation[0].control_schedule_ref = null
    const b = zoneVentilation(ModelDocument.parse(d), W.hours)[0][0]
    expect(Array.from(b.running)).toEqual(Array.from(a.running))
    expect(Array.from(b.h_w_per_k)).toEqual(Array.from(a.h_w_per_k))
  })
  it('demand (always on): the share of the people present, never below the least share; the same as a schedule of that shape', () => {
    const d = setup()
    const occ = Array(24).fill(0).map((_, h) => (h >= 9 && h < 17 ? 0.8 : 0))
    d.profiles.push({ id: 'people', kind: 'occupancy', density: { value: 0.1, basis: 'per_m2' }, occupancy_rate: 1, sensible_w_per_person: 75, radiant_fraction: 0.3, schedule: { weekday: occ, saturday: Array(24).fill(0), sunday: Array(24).fill(0) } })
    d.zones[0].profile_refs.occupancy = 'people'
    Object.assign(d.zones[0].ventilation[0], { runs: 'demand', demand_min_fraction: 0.2, control_schedule_ref: 'always_on' })
    const v = zoneVentilation(ModelDocument.parse(d), W.hours)[0][0]
    const same = (x: number) => Math.max(0.2, x)
    d.profiles.push({ id: 'shape', kind: 'schedule', day_types: { weekday: occ.map(same), saturday: Array(24).fill(0.2), sunday: Array(24).fill(0.2) } })
    Object.assign(d.zones[0].ventilation[0], { runs: 'schedule', demand_min_fraction: null, control_schedule_ref: 'shape' })
    const s = zoneVentilation(ModelDocument.parse(d), W.hours)[0][0]
    for (let h = 0; h < H; h++) expect(v.running[h]).toBeCloseTo(s.running[h], 12)
    let e = 0
    for (let h = 0; h < H; h++) e += v.running[h]
    expect(e).toBeGreaterThan(0.2 * H)
    expect(e).toBeLessThan(0.5 * H)
  })
  it('review F1: demand runs only inside its hours; off outside them, whatever the least share', () => {
    const d = setup()
    const occ = Array(24).fill(0).map((_, h) => (h >= 9 && h < 17 ? 0.8 : 0))
    d.profiles.push({ id: 'people', kind: 'occupancy', density: { value: 0.1, basis: 'per_m2' }, occupancy_rate: 1, sensible_w_per_person: 75, radiant_fraction: 0.3, schedule: { weekday: occ, saturday: Array(24).fill(0), sunday: Array(24).fill(0) } })
    d.zones[0].profile_refs.occupancy = 'people'
    Object.assign(d.zones[0].ventilation[0], { runs: 'demand', demand_min_fraction: 0.2, control_schedule_ref: 'office' })
    const v = zoneVentilation(ModelDocument.parse(d), W.hours)[0][0]
    const c = calendar(W.hours)
    for (let h = 0; h < H; h++) {
      const inHours = c.day[h] === 'weekday' && c.hourOfDay[h] >= 8 && c.hourOfDay[h] < 18
      const pres = c.day[h] === 'weekday' && c.hourOfDay[h] >= 9 && c.hourOfDay[h] < 17 ? 0.8 : 0
      expect(v.running[h]).toBeCloseTo(inHours ? Math.max(0.2, pres) : 0, 12)
    }
    d.zones[0].ventilation[0].control_schedule_ref = null
    expect(ModelDocument.safeParse(d).success).toBe(false)  // demand needs its hours
  })
  it('demand needs a zone with people and a least share', () => {
    const d = setup()
    Object.assign(d.zones[0].ventilation[0], { runs: 'demand', demand_min_fraction: 0.2, control_schedule_ref: 'always_on' })
    d.zones[0].profile_refs.occupancy = null
    expect(() => zoneVentilation(ModelDocument.parse(d), W.hours)).toThrow(/profile_refs\.occupancy/)
    d.zones[0].ventilation[0].demand_min_fraction = null
    expect(ModelDocument.safeParse(d).success).toBe(false)
  })
})

describe('Brief 114 P2: other loads outside the rooms', () => {
  it('a lift continuously, external lighting dusk to dawn and inside a time clock; auxiliary lines, warming no room', () => {
    const d = setup()
    d.other_loads = [
      { id: 'lift', kind: 'lift', label: 'Lift', power_w: 300, runs: 'continuous' },
      { id: 'ext', kind: 'external_lighting', power_w: 200, runs: 'dusk_to_dawn' },
      { id: 'ext2', kind: 'external_lighting', power_w: 100, runs: 'dusk_to_dawn', schedule_ref: 'office' },
    ]
    const s = ok(d)
    let dark = 0, darkOffice = 0
    const c = calendar(W.hours)
    for (let h = 0; h < H; h++) if (!(W.hours.global_horizontal[h] > 0)) { dark++; if (c.day[h] === 'weekday' && c.hourOfDay[h] >= 8 && c.hourOfDay[h] < 18) darkOffice++ }
    expect(dark).toBeGreaterThan(3500)
    expect(dark).toBeLessThan(5500)
    expect(s.other_loads.map((o) => o.hours_run)).toEqual([H, dark, darkOffice])
    expect(readEndUseKwh(s, 'auxiliary')).toBeCloseTo((300 * H + 200 * dark + 100 * darkOffice) / 1000, 9)
    expect(readEndUseKwh(s, 'heating')).toBeCloseTo(readEndUseKwh(ok(setup()), 'heating'), 9)
  })
})

describe('Brief 114 P1: the control map and the upgrade', () => {
  const issues = (d: any) => { const r = ModelDocument.safeParse(d); return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
  it('one entry per target, which must exist; hours only on a window; adaptive needs its category', () => {
    const d = setup()
    d.controls = [
      { id: 'c1', target: { kind: 'system', ref: 'hp' }, controller: 'central_bms' },
      { id: 'c2', target: { kind: 'system', ref: 'hp' }, controller: 'local' },
      { id: 'c3', target: { kind: 'system', ref: 'nope' }, controller: 'local' },
      { id: 'c4', target: { kind: 'ventilation', ref: 'fan' }, controller: 'time_clock', hours_ref: 'office' },
      { id: 'c5', target: { kind: 'window', ref: 'west' }, controller: 'manual', rule: 'adaptive', hours_ref: 'office' },
    ]
    const got = issues(d)
    expect(got).toEqual(expect.arrayContaining([
      expect.stringMatching(/^controls\.1\.target: system "hp" has two control entries/),
      expect.stringMatching(/^controls\.2\.target\.ref: no heating, cooling/),
      expect.stringMatching(/^controls\.3\.hours_ref: /),
      expect.stringMatching(/^controls\.4\.adaptive_category: /),
    ]))
    expect(got).toHaveLength(4)
  })
  it('the controller is recorded and shown, and changes no number', () => {
    const d = setup()
    const base = ok(d)
    d.controls = [{ id: 'c1', target: { kind: 'system', ref: 'hp' }, controller: 'central_bms', note: 'Trend BMS, outstation 2' }, { id: 'c2', target: { kind: 'window', ref: 'west' }, controller: 'manual', rule: 'temperature' }]
    const s = ok(d)
    expect(s.by_fuel).toEqual(base.by_fuel)
    expect(s.not_modelled).toEqual(expect.arrayContaining([
      { path: 'controls[0].controller', what: 'controller (recorded, not yet used in the calculation)' },
      { path: 'controls[1]', what: 'window rule (used only with weather-driven air)' },
    ]))
  })
  it('2.9 upgrades to 2.10 with nothing filled: no pumps, fans as their schedule says, no other loads, no controls', () => {
    const d = setup()
    d.schema_version = '2.9'
    for (const g of d.system_groups) delete g.pumps
    const up = upgradeDocument(d)
    expect(up.schema_version).toBe('2.12')
    expect(up.system_groups.every((g) => g.pumps === null)).toBe(true)
    expect(up.zones[0].ventilation[0]).toMatchObject({ runs: null, demand_min_fraction: null, control_schedule_ref: 'always_on' })
    expect(up.other_loads).toEqual([])
    expect(up.controls).toEqual([])
  })
})

describe('Brief 114 P1: the stated defaults (NCM Modelling Guide 2021, Table 14)', () => {
  it('constant-speed W/m²: heating 0.6, cooling 1.8 − 0.6 = 1.2 (stated subtraction), hot water none published', () => {
    expect(defaultPumpWPerM2('heating')).toBe(0.6)
    expect(defaultPumpWPerM2('cooling')).toBe(1.2)
    expect(defaultPumpWPerM2('dhw')).toBeNull()
  })
  it('filled only for a system with a water circuit, and labelled with its source', () => {
    const d = setup()
    expect(defaultPumps(ModelDocument.parse(d), 'hp')).toBeNull()  // nothing says it has water: the user says
    d.system_groups[0].design_flow_c = 45; d.system_groups[0].design_return_c = 40
    const doc = ModelDocument.parse(d)
    const refs = new Set(doc.zones.filter((z) => ['west', 'east'].includes(z.id)).map((z) => z.setpoints.hours_ref))
    const got = defaultPumps(doc, 'hp')!
    expect(got).toMatchObject({ power: { w_per_m2: 0.6 }, speed: 'fixed', default_from: expect.stringContaining(NCM_SOURCE) })
    // Review F2: paired with the rooms' heating hours when they share them (NCM para 103), else with demand, said so.
    if (refs.size === 1 && [...refs][0] != null) expect(got).toMatchObject({ runs: 'schedule', schedule_ref: [...refs][0] })
    else expect(got).toMatchObject({ runs: 'with_demand', schedule_ref: null, default_from: expect.stringContaining('no one set of heating hours') })
  })
  it('review F2: shared heating hours are paired; mixed hours run with demand and say why', () => {
    const d = setup()
    d.system_groups[0].design_flow_c = 55
    for (const z of d.zones) z.setpoints.hours_ref = 'office'
    expect(defaultPumps(ModelDocument.parse(d), 'hp')).toMatchObject({ runs: 'schedule', schedule_ref: 'office' })
    d.zones.find((z: any) => z.id === 'east').setpoints.hours_ref = null
    expect(defaultPumps(ModelDocument.parse(d), 'hp')).toMatchObject({ runs: 'with_demand', default_from: expect.stringContaining('no one set of heating hours') })
    expect(defaultPumps(ModelDocument.parse(d), 'chiller')).toBeNull()
  })
})
