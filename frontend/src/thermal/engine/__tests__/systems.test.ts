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
import { readEndUseKwh, readSystemsEui, readSystemsTotalKwh, runSystems, WATER_KWH_PER_L_K, type SystemsResults } from '../systems'
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
  d.services.dhw = { storage_setpoint_c: 60, tap_outlet_temp_c: 40, cold_supply_temp_c: 10, demand_basis: 'per_m2', litres_per_person_per_day: null, litres_per_m2_per_day: 2, load_shape: 'flat', circulation_pump_w: 100 }
  d.profiles.push({ id: 'light', kind: 'lighting', relationship_to_occupancy: 'always_on', area_share: 1, gain_fraction: 0.5, magnitude: { value: 5, unit: 'w_per_m2' }, radiant_fraction: 0.3 })
  for (const z of d.zones) z.profile_refs.lighting = ['light']
  d.zones[0].ventilation = [{ id: 'fan', kind: 'mev', enabled: true, flow_rate: 100, flow_rate_basis: 'constant', sfp_w_per_l_s: 1, recovery_sensible_pct: null, control_schedule_ref: 'always_on', legacy_v25: null }]
  return d
}
/** Results with stated demand: west 1000 W heating, east 500 W heating, middle 800 W cooling, every hour. */
function results(doc: any): ModelResults {
  const flat = (v: number) => new Float64Array(H).fill(v)
  const demand: Record<string, [number, number]> = { west: [1000, 0], middle: [0, 800], east: [500, 0] }
  return { zones: doc.zones.map((z: any) => ({ zone_id: z.id, hourly: { heating_w: flat(demand[z.id][0]), cooling_w: flat(demand[z.id][1]) } })) } as unknown as ModelResults
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
