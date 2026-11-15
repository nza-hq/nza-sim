/**
 * Brief 105 Part 4: simulate(doc) gives results, or every missing input at once in plain words; the run is Engine 2
 * with gains and ventilation, and its summary is the engine's own numbers (Rule 11: read through the helpers).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { runModel } from '../../../thermal/engine/model'
import { fromBuildingConfig } from '../../../thermal/schema/fromBuildingConfig'
import { MOS, readMos } from '../../../thermal/engine/__tests__/denver'
import { bodyFromLibrary, CONSTRUCTIONS } from '../library'
import { RUN_OPTIONS, simulate } from '../seam'
import type { WeatherChoice } from '../weather'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const FIXTURE = parseYaml(readFileSync(repo('validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const W = readMos(readFileSync(MOS))
const WEATHER: WeatherChoice = { weather: W, file_name: 'denver.mos', station: 'Denver', sha256: W.sha256, source: 'local' }

async function doc(): Promise<any> {
  const d = (await fromBuildingConfig({
    building_config: structuredClone(FIXTURE.building_config), construction_choices: FIXTURE.construction_choices, comfort_band: FIXTURE.comfort_band,
    library_constructions: FIXTURE.library_constructions, weather: { file_name: 'x', file_hash: null }, building_id: 'b',
  }, { zoning: 'per_storey' })).document
  for (const r of d.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash
  return d
}

describe('simulate', () => {
  it('Bridgewater five storeys: results equal runModel\'s, and the building breakdown closes', async () => {
    const d = await doc()
    const r = simulate(d, { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    const lib = Object.fromEntries(CONSTRUCTIONS.map((c) => [c.key, bodyFromLibrary(c.body)]))
    const direct = runModel(d, W, lib, RUN_OPTIONS)
    expect(r.summary.zones.map((z) => z.heating_kwh)).toEqual(direct.zones.map((z) => z.annual.heating_kwh))
    expect(r.summary.building.heating_kwh).toBeCloseTo(direct.zones.reduce((s, z) => s + z.annual.heating_kwh, 0), 9)
    expect(r.summary.building.cooling_kwh).toBeGreaterThan(0)
    const sum = r.summary.breakdown.reduce((s, l) => s + l.kwh, 0)
    const gross = r.summary.breakdown.reduce((s, l) => s + Math.abs(l.kwh), 0)
    expect(Math.abs(sum)).toBeLessThan(1e-6 * gross)
    expect(r.summary.breakdown.map((l) => l.term)).toEqual(expect.arrayContaining(['occupancy_gains', 'mechanical_ventilation', 'heating', 'cooling']))
    expect(r.summary.weather.file_name).toBe('denver.mos')
  })
  it('every missing input at once, in plain words, and no number', async () => {
    const d = await doc()
    d.surfaces.forEach((s: any) => { if (s.kind === 'roof') s.construction_ref.key = 'unassigned:roof' })
    d.building.thermal_bridging.mode = null
    d.zones[1].setpoints.heat_c = null; d.zones[1].setpoints.control_strategy = null
    d.zones[2].infiltration_q50 = null; d.zones[2].infiltration_ach = null
    const r = simulate(d, { weather: null })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.missing.map((m) => m.what)).toEqual([
      'Choose a weather file.',
      'Choose a construction for the roof.',
      'Set the thermal bridging for the building.',
      'Set the heating setpoint for "Storey 2".',
      'Set the air leakage (q50) for "Storey 3".',
    ])
    expect(r).not.toHaveProperty('summary')
  })
  it('a zone with its control stated and only a heating setpoint is heated only: it is not cooled', async () => {
    const d = await doc()
    d.zones[0].setpoints.cool_c = null
    const r = simulate(d, { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    expect(r.summary.zones[0].cooling_kwh).toBe(0)
    expect(r.summary.zones[0].heating_kwh).toBeGreaterThan(0)
    expect(r.summary.zones[1].cooling_kwh).toBeGreaterThan(0)
    d.zones[0].setpoints.heat_c = null
    const both = simulate(d, { weather: WEATHER })
    expect(both.ok ? [] : both.missing.map((m) => m.what)).toEqual(['Set the heating setpoint for "Storey 1".', 'Set the cooling setpoint for "Storey 1".'])
  })
  it('what the engine refuses comes back named, in words', async () => {
    const d = await doc()
    const i = d.profiles.findIndex((p: any) => p.kind === 'lighting')
    d.profiles[i].magnitude = undefined
    const r = simulate(d, { weather: WEATHER })
    expect(r).toEqual({ ok: false, missing: [{ path: `profiles[${i}].magnitude`, what: 'The space type "Lighting" needs a lighting power (W/m²).' }] })
    const v = await doc()
    v.zones[0].ventilation[0].control_schedule_ref = null
    const rv = simulate(v, { weather: WEATHER })
    expect(rv.ok === false && rv.missing[0].what).toBe('Say when the ventilation runs in "Storey 1".')
  })
  it('a document that fails the schema is named, not thrown', () => {
    const r = simulate({ schema_version: '2.3', zones: [] }, { weather: WEATHER })
    expect(r.ok).toBe(false)
    expect(simulate({ schema_version: '9.9' }, { weather: WEATHER })).toEqual({ ok: false, missing: [expect.objectContaining({ path: 'schema_version' })] })
  })
})
