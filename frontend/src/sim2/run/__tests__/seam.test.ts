/**
 * Brief 105 Part 4: simulate(doc) gives results, or every missing input at once in plain words; the run is Engine 2
 * with gains and ventilation, and its summary is the engine's own numbers (Rule 11: read through the helpers).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { runModel } from '../../../thermal/engine/model'
import { logMeanDeltaT } from '../../../thermal/engine/emitters'
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
  it('each zone\'s own breakdown closes, shows heat from the other zones, and those lines cancel across the building (Brief 106 P2)', async () => {
    const r = simulate(await doc(), { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    let interzone = 0, interzoneGross = 0
    for (const z of r.summary.zones) {
      const sum = z.breakdown.reduce((s, l) => s + l.kwh, 0)
      const gross = z.breakdown.reduce((s, l) => s + Math.abs(l.kwh), 0)
      expect(Math.abs(sum)).toBeLessThan(1e-6 * gross)
      expect(z.breakdown.find((l) => l.term === 'heating')?.kwh ?? 0).toBeCloseTo(z.heating_kwh, 6)
      const iz = z.breakdown.find((l) => l.term === 'interzone')
      expect(iz).toBeDefined()
      interzone += iz!.kwh; interzoneGross += Math.abs(iz!.kwh)
    }
    expect(interzoneGross).toBeGreaterThan(0)
    expect(Math.abs(interzone)).toBeLessThan(1e-6 * interzoneGross)
    expect(r.summary.breakdown.some((l) => l.term === 'interzone')).toBe(false)
  })
  it('energy used by the installed systems, and what they still need while demand still shows (Brief 107 P4)', async () => {
    const r = simulate(await doc(), { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    const e = r.summary.energy
    if (!e.ok) throw new Error(JSON.stringify(e.missing))
    expect(e.by_fuel.map((f) => f.fuel).sort()).toEqual(['electricity', 'gas'])
    expect(e.by_fuel.reduce((a, f) => a + f.kwh, 0)).toBeCloseTo(e.total_kwh, 6)
    expect(e.end_uses.reduce((a, l) => a + l.kwh, 0)).toBeCloseTo(e.total_kwh, 6)
    expect(e.eui_kwh_per_m2).toBeCloseTo(e.total_kwh / r.summary.building.floor_m2, 9)
    expect(e.systems.find((s) => s.service === 'heating' && s.fuel === 'electricity' && s.efficiency === 3)).toBeDefined()
    const d = await doc()
    d.system_groups = d.system_groups.filter((g: any) => g.service !== 'heating')
    const r2 = simulate(d, { weather: WEATHER })
    if (!r2.ok) throw new Error('demand should still show')
    expect(r2.summary.building.heating_kwh).toBeGreaterThan(0)
    expect(r2.summary.energy.ok).toBe(false)
    if (!r2.summary.energy.ok) expect(r2.summary.energy.missing[0].what).toMatch(/^No heating system serves /)
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
  it('a draft construction runs and is named in the summary', async () => {
    const d = await doc()
    const draft = CONSTRUCTIONS.find((c) => c.draft)!
    expect(draft.key).toBe('interior_wall_block_plastered')
    expect(draft.body_hash).toBe('0204c0d2fdb03e86fe74164514a58eff776cfc6be7e562494b49c4628ec1cdb3')
    const r0 = simulate(d, { weather: WEATHER })
    expect(r0.ok && r0.summary.drafts).toEqual([])
    // Two storeys joined by an internal wall of the draft construction (each storey's share of a 30 m² wall).
    d.surfaces.push({ ...structuredClone(d.surfaces.find((s: any) => s.kind === 'ceiling')), id: 'iw', kind: 'partition', tilt_deg: 90, area_m2: 30, construction_ref: { key: draft.key } })
    d.zones[0].surfaces.push('iw'); d.zones[1].surfaces.push('iw')
    d.library_refs.push({ kind: 'construction', key: draft.key, version: null, body_hash: draft.body_hash })
    const r = simulate(d, { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    expect(r.summary.drafts).toEqual([draft.draft])
  })
  it('an older document is refused, not upgraded with today\'s gain fallbacks (review F1)', async () => {
    const d = await doc()
    d.schema_version = '2.2'
    for (const p of d.profiles) delete p.radiant_fraction
    const r = simulate(d, { weather: WEATHER })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.missing.map((m) => m.path)).toEqual(['schema_version'])
  })
  it('a 2.3 document runs, upgraded by adding empty emitter lists only (Brief 108)', async () => {
    const d = await doc()
    const now = simulate(d, { weather: WEATHER })
    d.schema_version = '2.3'
    for (const z of d.zones) delete z.emitters
    const r = simulate(d, { weather: WEATHER })
    if (!r.ok || !now.ok) throw new Error(JSON.stringify(r))
    expect(r.summary.zones).toEqual(now.summary.zones)
  })
  it('emitters: each zone\'s output against its peak, the rating that covers it, and the same rooms at 70/60 (Brief 108 P4)', async () => {
    expect((simulate(await doc(), { weather: WEATHER }) as any).summary.emitters).toBeNull()
    const withRads = async (rated: (zi: number) => number) => {
      const d = await doc()
      const hp = d.system_groups.find((g: any) => g.service === 'heating' && g.source === 'ambient_air')
      hp.design_flow_c = 50; hp.design_return_c = 40
      d.zones.forEach((z: any, zi: number) => {
        z.emitters = [{ id: `${z.id}_rads`, kind: 'radiator', count: 1, rated_output_w: rated(zi), radiant_fraction: 0.3, system_group_id: hp.id, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.3 }]
      })
      return d
    }
    const r = simulate(await withRads(() => 20000), { weather: WEATHER, what_if: { design_flow_c: 70, design_return_c: 60 } })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    const em = r.summary.emitters!
    const wi = em.what_if!
    if (!wi.ok) throw new Error(JSON.stringify(wi.missing))
    expect(em.zones.map((z) => z.id)).toEqual(['z1', 'z2', 'z3', 'z4', 'z5'])
    const f = (fl: number, rt: number) => Math.pow(logMeanDeltaT(fl, rt, 21) / logMeanDeltaT(75, 65, 20), 1.3)
    em.zones.forEach((z, i) => {
      const w = wi.zones[i]
      expect(z.cap_w).toBeCloseTo(20000 * f(50, 40), 6)
      expect(w.cap_w).toBeCloseTo(20000 * f(70, 60), 6)
      expect(w.peak_w).toBe(z.peak_w)  // the unlimited run does not depend on the design temperatures
      // The limit follows the room (review F1): never above the radiators' output at the coldest the room fell to.
      const fr = (fl: number, rt: number, room: number) => Math.pow(logMeanDeltaT(fl, rt, room) / logMeanDeltaT(75, 65, 20), 1.3)
      expect(r.results.zones[i].annual.peak_heating_w).toBeLessThanOrEqual(20000 * fr(50, 40, Math.min(21, z.min_c)) * (1 + 1e-9))
      expect(z.shortfall_w).toBeCloseTo(Math.max(0, z.peak_w - z.cap_w), 9)
      expect(w.unmet_hours!).toBeLessThanOrEqual(z.unmet_hours!)
      expect(z.unmet_hours).toBe(r.results.zones[i].annual.unmet_heating_hours)
      expect(z.needed_rated_w! * f(50, 40)).toBeCloseTo(z.peak_w, 6)
      expect(w.needed_rated_w! * f(70, 60)).toBeCloseTo(z.peak_w, 6)
    })
    expect(em.zones.some((z) => z.shortfall_w > 0 && z.unmet_hours! > 0)).toBe(true)
    expect(wi.heating_kwh).toBeGreaterThan(r.summary.building.heating_kwh)
    expect(r.summary.energy.ok && wi.energy.ok).toBe(true)
    // The rating each zone needs at 50/40, stated: no unmet hours anywhere, and nothing short.
    const need = em.zones.map((z) => z.needed_rated_w! * (1 + 1e-9))
    const r2 = simulate(await withRads((zi) => need[zi]), { weather: WEATHER })
    if (!r2.ok) throw new Error(JSON.stringify(r2.missing))
    for (const z of r2.summary.emitters!.zones) { expect(z.unmet_hours).toBe(0); expect(z.shortfall_w).toBe(0) }
  })
  it('a what-if that cannot run says why, and the run itself still shows', async () => {
    const d = await doc()
    const hp = d.system_groups.find((g: any) => g.service === 'heating' && g.source === 'ambient_air')
    hp.design_flow_c = 50; hp.design_return_c = 40
    d.zones[0].emitters = [{ id: 'r', kind: 'radiator', count: 1, rated_output_w: 20000, radiant_fraction: 0.3, system_group_id: hp.id, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.3 }]
    const r = simulate(d, { weather: WEATHER, what_if: { design_flow_c: 30, design_return_c: 20 } })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    expect(r.summary.emitters!.zones).toHaveLength(1)
    const wi = r.summary.emitters!.what_if!
    expect(wi.ok).toBe(false)
    if (!wi.ok) expect(wi.missing[0].what).toBe(`The heating system "${hp.label}": the return (20 °C) must be above Storey 1's heating setpoint (21 °C), and the flow at or above the return.`)
    const n = await doc()
    const hn = n.system_groups.find((g: any) => g.service === 'heating' && g.source === 'ambient_air')
    n.zones[1].emitters = [{ id: 'r', kind: 'radiator', count: null, rated_output_w: 1000, radiant_fraction: 0.3, system_group_id: hn.id, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.3 }]
    const rn = simulate(n, { weather: WEATHER })
    expect(rn.ok ? [] : rn.missing.map((m) => m.what)).toEqual(['Set how many there are for the emitter "r" in "Storey 2".'])
    n.zones[1].emitters[0].count = 1
    const rc = simulate(n, { weather: WEATHER })
    expect(rc.ok ? [] : rc.missing.map((m) => m.what)).toEqual([`Set the flow temperature its emitters run at for the heating system "${hn.label}".`])
    d.zones[0].emitters = [{ id: 'e', kind: 'electric', count: 4, rated_output_w: 2000, radiant_fraction: 0.5, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
    hp.design_flow_c = null; hp.design_return_c = null
    const e = simulate(d, { weather: WEATHER, what_if: { design_flow_c: 70, design_return_c: 60 } })
    if (!e.ok) throw new Error(JSON.stringify(e.missing))
    expect(e.summary.emitters!.zones[0].note).toMatch(/fixed-output/)
    expect(e.summary.emitters!.what_if).toEqual({ ok: false, flow_c: 70, return_c: 60, missing: [{ path: 'system_groups', what: expect.stringMatching(/^No heating system states flow and return/) }] })
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

describe('saving weather to the organisation', () => {
  it('names a file as the bucket policy accepts (0007_weather_upload.sql)', async () => {
    const { organisationFileName } = await import('../weather')
    const ok = /^[A-Za-z0-9._-]{1,120}\.epw$/
    for (const [a, b] of [['GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw', 'GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw'], ['my weather (2).EPW', 'my_weather_2.epw'], ['../../x.epw', '.._.._x.epw'], ['@@@.epw', 'weather.epw']]) {
      expect(organisationFileName(a)).toBe(b)
      expect(organisationFileName(a)).toMatch(ok)
    }
    expect(organisationFileName('x'.repeat(300))).toMatch(ok)
  })
})
