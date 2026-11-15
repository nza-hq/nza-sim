/**
 * Brief 105 Part 3: ventilation per zone.
 *
 * - The conductance is today's ρc·q·(1 − η) for each basis, scheduled by the entry's schedule profile.
 * - Analytic MVHR: a free-floating zone with a steady gain settles where the gain equals the conductances including
 *   ρc·q·(1 − η); heating at a setpoint equals the hand value.
 * - Bridgewater's entries (MVHR 80 %, two extracts) give today's per-system UA, and five storeys add up to one zone.
 * - Missing inputs are named; summer bypass is refused, not ignored.
 * - runModel with ventilation closes per zone with one line per entry (Rule 9).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { ENGINE_CONSTANTS as K } from '../constants'
import { REFEREE_OPTIONS, runModel } from '../model'
import { zoneVentilation } from '../ventilation'
import { fromBuildingConfig } from '../../schema/fromBuildingConfig'
import { MOS, readMos } from './denver'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const FIXTURE = parseYaml(readFileSync(repo('validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const WEATHER = readMos(readFileSync(MOS))
const LIB = Object.fromEntries((FIXTURE.library_constructions as any[]).map((c) => [c.name, c.config_json]))

async function bridgewater(zoning: 'single' | 'per_storey' = 'single') {
  return (await fromBuildingConfig({
    building_config: structuredClone(FIXTURE.building_config), construction_choices: FIXTURE.construction_choices, comfort_band: FIXTURE.comfort_band,
    library_constructions: FIXTURE.library_constructions, weather: { file_name: FIXTURE.building_config.weather_file, file_hash: null },
    building_id: 'bridgewater-anchor',
  }, { zoning })).document
}

describe('the conductance per entry', () => {
  it('Bridgewater: today\'s per-system UA, 0.33 Wh/m³K × l/s × 3.6 × (1 − η), all year (always_on)', async () => {
    const doc = await bridgewater()
    const [v] = zoneVentilation(doc, WEATHER.hours)
    // instantCalc.js ventUA: AIR_HEAT_CAPACITY (0.33) × flow_l_s × 3.6 × (1 − hre) × hours/8760, hours 8760.
    const today = [1425 * 3.6 * 0.33 * (1 - 0.8), 2208 * 3.6 * 0.33, 210 * 3.6 * 0.33]
    expect(v.map((x) => x.kind)).toEqual(['mvhr', 'mev', 'mev'])
    v.forEach((x, i) => {
      expect(Math.min(...x.h_w_per_k)).toBeCloseTo(today[i], 9)
      expect(Math.max(...x.h_w_per_k)).toBeCloseTo(today[i], 9)
    })
  })
  it('five storeys add up to the one zone', async () => {
    const one = zoneVentilation(await bridgewater(), WEATHER.hours)[0]
    const five = zoneVentilation(await bridgewater('per_storey'), WEATHER.hours)
    one.forEach((x, j) => expect(five.reduce((s, z) => s + z[j].h_w_per_k[0], 0)).toBeCloseTo(x.h_w_per_k[0], 9))
  })
  it('each basis, and a schedule that switches the system off', async () => {
    const doc: any = await bridgewater()
    const z = doc.zones[0]
    doc.profiles.push({ id: 'days', kind: 'schedule', day_types: { weekday: Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 18 ? 1 : 0)), saturday: Array(24).fill(0), sunday: Array(24).fill(0.5) } })
    z.ventilation = [
      { ...z.ventilation[0], id: 'a', flow_rate: 0.5, flow_rate_basis: 'per_m2', control_schedule_ref: 'days' },
      { ...z.ventilation[1], id: 'b', flow_rate: 10, flow_rate_basis: 'per_person' },
      { ...z.ventilation[1], id: 'c', kind: 'natural', flow_rate: 0.7, flow_rate_basis: 'ach', recovery_sensible_pct: null },
      { ...z.ventilation[1], id: 'd', kind: 'none' },
      { ...z.ventilation[1], id: 'e', enabled: false },
    ]
    const v = zoneVentilation(doc, WEATHER.hours)[0]
    expect(v.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    const rc = K.rho_c_air
    // 1 January is a Monday: 09:00 runs, 03:00 does not; 6 January is a Saturday (off), 7 January a Sunday (half).
    expect(v[0].h_w_per_k[9]).toBeCloseTo(rc * (0.5 * z.area_m2 / 1000) * 0.2, 9)
    expect(v[0].h_w_per_k[3]).toBe(0)
    expect(v[0].h_w_per_k[5 * 24 + 12]).toBe(0)
    expect(v[0].h_w_per_k[6 * 24 + 12]).toBeCloseTo(rc * (0.5 * z.area_m2 / 1000) * 0.2 * 0.5, 9)
    const occ: any = doc.profiles.find((p: any) => p.kind === 'occupancy')
    expect(v[1].h_w_per_k[0]).toBeCloseTo(rc * (10 * occ.density.value * z.rooms * occ.occupancy_rate) / 1000, 9)
    expect(v[2].h_w_per_k[0]).toBeCloseTo(rc * (0.7 * z.area_m2 * z.height_m) / 3600, 9)
  })
  it('names each missing input; refuses summer bypass and recovery on extract', async () => {
    const doc = await bridgewater()
    const at = (f: (d: any) => void) => { const d: any = structuredClone(doc); f(d); return () => zoneVentilation(d, WEATHER.hours) }
    expect(at((d) => { d.zones[0].ventilation[0].flow_rate = null })).toThrow('zones[0].ventilation[0].flow_rate: required')
    expect(at((d) => { d.zones[0].ventilation[0].flow_rate_basis = null })).toThrow('flow_rate_basis: required')
    expect(at((d) => { d.zones[0].ventilation[0].flow_rate_basis = 'per_bed' })).toThrow('unknown basis "per_bed"')
    expect(at((d) => { d.zones[0].ventilation[0].recovery_sensible_pct = null })).toThrow('recovery_sensible_pct: required for MVHR')
    expect(at((d) => { d.zones[0].ventilation[1].recovery_sensible_pct = 50 })).toThrow('extract ventilation has no heat recovery')
    expect(at((d) => { d.zones[0].ventilation[0].control_schedule_ref = null })).toThrow('control_schedule_ref: required')
    expect(at((d) => { d.zones[0].ventilation[0].control_schedule_ref = 'nope' })).toThrow('schedule profile "nope" does not exist')
    expect(at((d) => { d.zones[0].ventilation[0].summer_bypass = true })).toThrow('summer bypass is not modelled yet')
    expect(at((d) => { d.zones[0].ventilation[1].flow_rate_basis = 'per_person'; d.zones[0].profile_refs.occupancy = null })).toThrow('zones[0].profile_refs.occupancy')
  })
})

describe('analytic MVHR', () => {
  it('heating at a steady setpoint rises by ρc·q·(1 − η)·ΔT and the line says so', async () => {
    // Bridgewater one zone, constant weather: copy the Denver year and hold it at 0 °C, no sun, no wind.
    const doc: any = await bridgewater()
    const w = structuredClone(WEATHER)
    w.hours.dry_bulb.fill(0); w.hours.wind_speed.fill(0)
    for (const k of ['global_horizontal', 'direct_normal', 'diffuse_horizontal'] as const) (w.hours as any)[k]?.fill(0)
    for (const k of Object.keys(w.hours)) if (/(_wh|horizontal|normal|irradiance)/.test(k)) (w.hours as any)[k].fill?.(0)
    doc.zones[0].setpoints.cool_c = 40
    const off = runModel(doc, w, LIB, REFEREE_OPTIONS)
    const on = runModel(doc, w, LIB, { ...REFEREE_OPTIONS, ventilation: 'document' })
    const H = w.hours.count, last = H - 1
    const dT = doc.zones[0].setpoints.heat_c - 0
    const hand = K.rho_c_air * ((1425 * 0.2 + 2208 + 210) / 1000) * dT
    expect(on.zones[0].hourly.heating_w[last] - off.zones[0].hourly.heating_w[last]).toBeCloseTo(hand, 3)
    const lines = on.zones[0].breakdown.filter((l) => l.term === 'mechanical_ventilation')
    expect(lines.map((l) => l.ventilation_id)).toEqual(doc.zones[0].ventilation.map((v: any) => v.id))
    expect(on.zones[0].closure.max_wh).toBeLessThanOrEqual(1)
  })
})

describe('runModel with ventilation and gains', () => {
  for (const zoning of ['single', 'per_storey'] as const) {
    it(`Bridgewater ${zoning}: closes per zone, one line per entry, raises heating; 'none' is unchanged`, async () => {
      const doc = await bridgewater(zoning)
      const base = runModel(doc, WEATHER, LIB, REFEREE_OPTIONS)
      const both = runModel(doc, WEATHER, LIB, { ...REFEREE_OPTIONS, internal_gains: 'profiles', ventilation: 'document' })
      const vent = runModel(doc, WEATHER, LIB, { ...REFEREE_OPTIONS, ventilation: 'document' })
      both.zones.forEach((z) => {
        expect(z.breakdown.filter((l) => l.term === 'mechanical_ventilation').length).toBe(3)
        expect(z.closure.max_wh).toBeLessThanOrEqual(1)
      })
      const heat = (r: typeof base) => r.zones.reduce((s, z) => s + z.annual.heating_kwh, 0)
      expect(heat(vent)).toBeGreaterThan(heat(base))
      expect(heat(both)).toBeGreaterThan(0)
      const none = runModel(doc, WEATHER, LIB, { ...REFEREE_OPTIONS, ventilation: 'none' })
      expect(none.zones.map((z) => z.annual.heating_kwh)).toEqual(base.zones.map((z) => z.annual.heating_kwh))
    })
  }
})
