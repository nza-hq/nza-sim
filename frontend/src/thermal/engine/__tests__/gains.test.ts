/**
 * Brief 105 Part 2: internal gains from the document's profiles.
 *
 * - gains.ts is today's engine's gains, per zone: on the Bridgewater document, every hour of every kind equals
 *   today's computeHourlyGains (read-only import), and the five storeys add up to the one zone.
 * - A missing input is named, never assumed.
 * - The solvers take an hourly convective share: the same share as one number or as an hourly array gives the same
 *   hours on both, and a steady gain into a free-floating zone settles at the hand value.
 * - runModel with gains closes per zone, with one breakdown line per profile (Rule 9).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { computeHourlyGains } from '../../../utils/instantCalc.js'
import { opaqueElement, type Element, type Layer } from '../elements'
import { zoneGains } from '../gains'
import { REFEREE_OPTIONS, runModel } from '../model'
import { runNetwork } from '../network'
import { runZone, type ZoneInputs } from '../zone'
import { fromBuildingConfig } from '../../schema/fromBuildingConfig'
import { MOS, readMos } from './denver'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const FIXTURE = parseYaml(readFileSync(repo('validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const WEATHER = readMos(readFileSync(MOS))

async function bridgewater(zoning: 'single' | 'per_storey' = 'single') {
  const fx = structuredClone(FIXTURE)
  const r = await fromBuildingConfig({
    building_config: fx.building_config, construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
    library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: null },
    building_id: 'bridgewater-anchor',
  }, { zoning })
  const library = Object.fromEntries(fx.library_constructions.map((c: any) => [c.name, c.config_json]))
  return { doc: r.document, library, building: fx.building_config }
}

describe('gains.ts is today\'s engine\'s gains, per zone', () => {
  it('Bridgewater, one zone: every hour of every kind equals computeHourlyGains', async () => {
    const { doc, building } = await bridgewater()
    const [g] = zoneGains(doc, WEATHER.hours)
    const b = building
    const gia = b.length * b.width * b.num_floors
    expect(doc.zones[0].area_m2).toBeCloseTo(gia, 9)
    const wd = { month: WEATHER.hours.month, day: WEATHER.hours.day, hour: WEATHER.hours.hour }
    const kind = (k: string) => g!.gains.filter((x) => x.kind === k)
    expect(g!.gains.map((x) => x.kind)).toEqual(['occupancy', 'lighting', 'equipment', 'auxiliary'])
    let worst = 0, total = 0
    for (let h = 0; h < WEATHER.hours.count; h++) {
      const t = computeHourlyGains(b, h, wd, gia)
      const pairs: [number, number][] = [
        [kind('occupancy')[0].w[h], t.people], [kind('lighting')[0].w[h], t.lighting],
        [kind('equipment')[0].w[h], t.equipment], [kind('auxiliary')[0].w[h], t.auxiliary],
      ]
      for (const [a, e] of pairs) worst = Math.max(worst, Math.abs(a - e))
      total += t.total
    }
    expect(worst).toBeLessThan(1e-9)
    expect(total).toBeGreaterThan(1e6)  // not a vacuous comparison: tens of MWh a year
  })
  it('five storeys add up to the one zone, hour by hour', async () => {
    const one = zoneGains((await bridgewater()).doc, WEATHER.hours)[0]!
    const five = zoneGains((await bridgewater('per_storey')).doc, WEATHER.hours)
    expect(five.length).toBe(5)
    let worst = 0
    for (let h = 0; h < WEATHER.hours.count; h++) worst = Math.max(worst, Math.abs(five.reduce((s, z) => s + z!.total_w[h], 0) - one.total_w[h]))
    expect(worst).toBeLessThan(1e-9)
  })
  it('a building total is shared among the zones that refer to it, by floor area', async () => {
    const { doc } = await bridgewater('per_storey')
    const d = structuredClone(doc)
    const occ: any = d.profiles.find((p) => p.kind === 'occupancy')
    occ.density = { value: 100, basis: 'total' }
    d.zones[4].profile_refs.occupancy = null  // the top storey has none now
    d.zones[4].profile_refs.lighting = []; d.zones[4].profile_refs.equipment = []
    const g = zoneGains(d, WEATHER.hours)
    const h = 20  // 20:00 on 1 January, a weekday
    const peopleAt = (z: number) => g[z]!.gains[0].w[h] / (occ.occupancy_rate * occ.sensible_w_per_person)
    const s = [0, 1, 2, 3].reduce((t, z) => t + peopleAt(z), 0)
    const presence = occ.schedule.weekday[h] * occ.schedule.monthly_multipliers[0]
    expect(s).toBeCloseTo(100 * presence, 9)
    expect(peopleAt(0)).toBeCloseTo(25 * presence, 9)
  })
  it('names each missing input instead of assuming it', async () => {
    const { doc } = await bridgewater()
    const at = (f: (d: any) => void) => { const d: any = structuredClone(doc); f(d); return () => zoneGains(d, WEATHER.hours) }
    const idx = (k: string) => doc.profiles.findIndex((p) => p.kind === k)
    expect(at((d) => { d.profiles[idx('occupancy')].radiant_fraction = null })).toThrow(`profiles[${idx('occupancy')}].radiant_fraction: required`)
    expect(at((d) => { delete d.profiles[idx('occupancy')].sensible_w_per_person })).toThrow('sensible_w_per_person: required')
    expect(at((d) => { delete d.profiles[idx('occupancy')].occupancy_rate })).toThrow('occupancy_rate: required')
    expect(at((d) => { d.zones[0].rooms = null })).toThrow('zones[0].rooms: required by')
    expect(at((d) => { delete d.profiles[idx('lighting')].daylight_factor })).toThrow('daylight_factor: required')
    expect(at((d) => { delete d.profiles[idx('equipment')].baseload })).toThrow('baseload: required')
    expect(at((d) => { delete d.profiles[idx('equipment')].standby_factor })).toThrow('standby_factor: required')
    expect(at((d) => { d.profiles[idx('lighting')].relationship_to_occupancy = 'sometimes' })).toThrow('unknown relationship "sometimes"')
    expect(at((d) => { d.zones[0].profile_refs.occupancy = null })).toThrow('zones[0].profile_refs.occupancy: profile "default_lighting" follows occupancy')
    // Review F5: out-of-range values are refused, not clamped; an active exception day without values is refused.
    expect(at((d) => { d.profiles[idx('lighting')].gain_fraction = 1.2 })).toThrow('gain_fraction: must be 0 to 1')
    expect(at((d) => { d.profiles[idx('lighting')].area_share = -1 })).toThrow('area_share: must be ≥ 0')
    expect(at((d) => { d.profiles[idx('equipment')].standby_factor = 2 })).toThrow('standby_factor: must be 0 to 1')
    expect(at((d) => { d.profiles[idx('occupancy')].schedule.exceptions = [{ start_date: '01-01', end_date: '01-07' }] })).toThrow('has no weekday values')
    // A gain that does not follow occupancy runs without it (the external lighting has its own schedule).
    const lone: any = structuredClone(doc)
    lone.zones[0].profile_refs = { occupancy: null, lighting: [], equipment: [], auxiliary: lone.zones[0].profile_refs.auxiliary }
    expect(zoneGains(lone, WEATHER.hours)[0]!.gains.map((g) => g.kind)).toEqual(['auxiliary'])
  })
})

// ── The solvers ─────────────────────────────────────────────────────────────────────────────────────────────────
const H = 24 * 40
const flat = (v: number, n = H) => new Float64Array(n).fill(v)
const WALL: Layer[] = [
  { kind: 'Material:NoMass', thermal_resistance: 2.5 },
  { kind: 'Material', thickness: 0.15, conductivity: 1.13, density: 2300, specific_heat: 1000 },
]
const wall = (id: string, area: number) => ({ ...opaqueElement({ id, area_m2: area, tilt_deg: 90, boundary: 'outside', layers: WALL, stated_u: null, emissivity: 0.9, path: id }), f_sky: 0 })
const Rchain = (e: Element) => 1 / e.g_boundary + Array.from(e.g).reduce((s, g) => s + 1 / g, 0)
const varying = Float64Array.from({ length: H }, (_, h) => (h % 24 >= 8 && h % 24 < 18 ? 900 : 150))

function zoneIn(els: Element[], og: ZoneInputs['other_gains'], over: Partial<ZoneInputs> = {}): ZoneInputs {
  return {
    elements: els, air_capacity_j_per_k: 1e6, bridging_w_per_k: 10, hours: H, theta_e: flat(0), theta_ground: 10,
    ventilation_w_per_k: flat(30), solar_absorbed_w_per_m2: els.map(() => flat(0)), solar_transmitted_w: flat(0),
    other_gains: og, setpoints: { heat_c: null, cool_c: null }, control: 'air', hc_convective_fraction: 1, initial_c: 15, warmup_days: 0, ...over,
  }
}

describe('the solvers take an hourly convective share', () => {
  it('a steady convective gain into a free-floating zone settles at Q / (Σ A/(R + 1/h_ci) + H_tb + H_ve)', () => {
    const els = [wall('a', 60), wall('b', 40)]
    const r = runZone(zoneIn(els, { w: flat(1000), convective_fraction: flat(1) }, { warmup_days: 80 }))
    const hand = 1000 / (els.reduce((s, e) => s + e.area_m2 / (Rchain(e) + 1 / e.h_ci), 0) + 10 + 30)
    expect(r.theta_air[H - 1]).toBeCloseTo(hand, 6)
    expect(Math.max(...r.closure_wh)).toBeLessThanOrEqual(1)
  })
  it('one zone: a share as a number and as an hourly array give the same hours', () => {
    const els = [wall('a', 60), wall('b', 40)]
    const sp = { heat_c: 20, cool_c: 24 }
    const a = runZone(zoneIn(els, { w: varying, convective_fraction: 0.4 }, { setpoints: sp }))
    const b = runZone(zoneIn(els, { w: varying, convective_fraction: flat(0.4) }, { setpoints: sp }))
    expect(Array.from(b.heating_w)).toEqual(Array.from(a.heating_w))
    expect(Array.from(b.theta_air)).toEqual(Array.from(a.theta_air))
  })
  it('network: a share as a number and as an hourly array give the same hours; a varying share closes', () => {
    const els = [wall('a', 60), wall('b', 40)]
    const net = (cf: number | Float64Array) => runNetwork({
      zones: [{ air_capacity_j_per_k: 1e6, bridging_w_per_k: 10, ventilation_w_per_k: flat(30), solar_transmitted_w: flat(0), solar_beam_w: null, other_gains: { w: varying, convective_fraction: cf }, setpoints: { heat_c: 20, cool_c: 24 }, initial_c: 15 }],
      elements: els.map((element) => ({ element, zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: flat(0), inside_solar_absorptance: 1, inside_solar_absorptance_b: null })),
      hours: H, theta_e: flat(0), theta_ground: 10, control: 'air', hc_convective_fraction: 1, warmup_days: 0,
    })
    const a = net(0.4), b = net(flat(0.4))
    expect(Array.from(b.zones[0].heating_w)).toEqual(Array.from(a.zones[0].heating_w))
    const c = net(Float64Array.from({ length: H }, (_, h) => (h % 3) / 2))
    expect(Math.max(...c.zones[0].closure_wh)).toBeLessThanOrEqual(1)
  })
})

describe('runModel with internal gains from profiles', () => {
  for (const zoning of ['single', 'per_storey'] as const) {
    it(`Bridgewater ${zoning}: closes per zone, one line per profile, and gains lower heating and raise cooling`, async () => {
      const { doc, library } = await bridgewater(zoning)
      const without = runModel(doc, WEATHER, library, REFEREE_OPTIONS)
      const withG = runModel(doc, WEATHER, library, { ...REFEREE_OPTIONS, internal_gains: 'profiles' })
      const g = zoneGains(doc, WEATHER.hours)
      withG.zones.forEach((z, zi) => {
        const lines = z.breakdown.filter((l) => l.term.endsWith('_gains'))
        expect(lines.map((l) => l.profile_id)).toEqual(g[zi]!.gains.map((x) => x.profile_id))
        const kwh = g[zi]!.total_w.reduce((s, v) => s + v, 0) / 1000
        expect(lines.reduce((s, l) => s + l.kwh, 0)).toBeCloseTo(kwh, 6)
        expect(z.closure.max_wh).toBeLessThanOrEqual(1)
      })
      const sum = (r: typeof without, k: 'heating_kwh' | 'cooling_kwh') => r.zones.reduce((s, z) => s + z.annual[k], 0)
      expect(sum(withG, 'heating_kwh')).toBeLessThan(sum(without, 'heating_kwh'))
      expect(sum(withG, 'cooling_kwh')).toBeGreaterThan(sum(without, 'cooling_kwh'))
      // Absent and 'none' are the envelope-only run, unchanged.
      const none = runModel(doc, WEATHER, library, { ...REFEREE_OPTIONS, internal_gains: 'none' })
      expect(none.zones.map((z) => z.annual.heating_kwh)).toEqual(without.zones.map((z) => z.annual.heating_kwh))
    })
  }
  it('refuses document gains together with reference-case other gains, and an unknown mode', async () => {
    const { doc, library } = await bridgewater()
    expect(() => runModel(doc, WEATHER, library, { ...REFEREE_OPTIONS, internal_gains: 'profiles', other_gains: { w: flat(0, 8760), convective_fraction: 1 } })).toThrow('not both')
    expect(() => runModel(doc, WEATHER, library, { ...REFEREE_OPTIONS, internal_gains: 'some' as any })).toThrow('options.internal_gains')
  })
})
