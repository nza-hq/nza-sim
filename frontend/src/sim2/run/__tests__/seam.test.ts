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
import { designHeatLoss } from '../../../thermal/engine/designHeatLoss'
import { ModelDocument } from '../../../thermal/schema/model'
import { fromBuildingConfig } from '../../../thermal/schema/fromBuildingConfig'
import { MOS, readMos } from '../../../thermal/engine/__tests__/denver'
import { bodyFromLibrary, CONSTRUCTIONS } from '../library'
import { facingOf, QUARTER_HOUR_OPTIONS, RUN_OPTIONS, simulate } from '../seam'
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
  it('monthly, by surface kind, window sun by facing, and hourly on request: regroupings that sum back (Brief 109)', async () => {
    const d = await doc()
    const r = simulate(d, { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    const s = r.summary
    expect(s.hourly).toBeNull()
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
    // Months sum to the year, for the building and each zone.
    expect(s.building.monthly.heating_kwh).toHaveLength(12)
    expect(sum(s.building.monthly.heating_kwh)).toBeCloseTo(s.building.heating_kwh, 6)
    expect(sum(s.building.monthly.cooling_kwh)).toBeCloseTo(s.building.cooling_kwh, 6)
    for (const z of s.zones) { expect(sum(z.monthly.heating_kwh)).toBeCloseTo(z.heating_kwh, 6); expect(sum(z.monthly.cooling_kwh)).toBeCloseTo(z.cooling_kwh, 6) }
    expect(s.building.monthly.heating_kwh[0]).toBeGreaterThan(s.building.monthly.heating_kwh[6])  // January heats more than July
    // By surface kind, plus the lines that name no surface, gives the breakdown term by term (Rule 9: same lines).
    const check = (bySurface: typeof s.by_surface, breakdown: typeof s.breakdown, lines: { term: string; surface_id: string | null; kwh: number }[]) => {
      for (const b of breakdown) {
        const fromSurfaces = bySurface.filter((l) => l.term === b.term).reduce((x, l) => x + l.kwh, 0)
        const noSurface = lines.filter((l) => l.term === b.term && l.surface_id == null).reduce((x, l) => x + l.kwh, 0)
        expect(fromSurfaces + noSurface).toBeCloseTo(b.kwh, 6)
      }
    }
    check(s.by_surface, s.breakdown, r.results.zones.flatMap((z) => z.breakdown).filter((l) => l.term !== 'interzone'))
    r.results.zones.forEach((z, i) => check(s.zones[i].by_surface, s.zones[i].breakdown, z.breakdown))
    expect(new Set(s.by_surface.map((l) => l.kind))).toEqual(new Set(['wall', 'roof', 'ground', 'glazing']))
    expect(s.by_surface.some((l) => l.term === 'interzone')).toBe(false)
    // An intermediate storey sees the slab below as its floor and the one above as its ceiling, from its own side.
    const mid = s.zones[2].by_surface.filter((l) => l.term === 'interzone').map((l) => l.kind).sort()
    expect(mid).toEqual(['ceiling', 'floor'])
    // Window sun by facing sums to the window lines; Bridgewater has windows on four facades and no rooflights.
    const tr = s.breakdown.find((l) => l.term === 'solar_transmitted')!.kwh
    expect(s.window_solar.map((w) => w.facing)).toEqual(['N', 'E', 'S', 'W'])
    expect(s.window_solar.reduce((x, w) => x + w.transmitted_kwh, 0)).toBeCloseTo(tr, 6)
    // Per square metre of glass, the south-west (azimuth 222°, sector S) takes more sun than the north-east (42°, sector N).
    const area = (f: string) => d.surfaces.filter((x: any) => x.kind === 'glazing' && facingOf(x) === f).reduce((a: number, x: any) => a + x.area_m2, 0)
    const per = (f: string) => s.window_solar.find((w) => w.facing === f)!.transmitted_kwh / area(f)
    expect(per('S')).toBeGreaterThan(1.5 * per('N'))
    // Hourly on request: the building's 8,760 values, summing to the year and peaking at the stated peak.
    const h = simulate(d, { weather: WEATHER, hourly: true })
    if (!h.ok || !h.summary.hourly) throw new Error('no hourly')
    expect(h.summary.hourly.heating_w).toHaveLength(8760)
    expect(Array.from(h.summary.hourly.heating_w).reduce((x, y) => x + y, 0) / 1000).toBeCloseTo(s.building.heating_kwh, 6)
    expect(Math.max(...h.summary.hourly.cooling_w)).toBeCloseTo(s.building.peak_cooling_w, 6)
  })
  it('heating hours: hours below in use, morning and later peaks with when, and a cold morning\'s time back (Brief 109 P4)', async () => {
    const d = await doc()
    expect(simulate(d, { weather: WEATHER }).ok && (simulate(d, { weather: WEATHER }) as any).summary.zones.every((z: any) => z.hours === null)).toBe(true)
    const HOURS = JSON.parse(readFileSync(repo('validation/energyplus/109_setback_spec.json'), 'utf8')).hours
    d.profiles.push({ id: 'hours', kind: 'schedule', day_types: HOURS })
    for (const z of d.zones) { z.setpoints.hours_ref = 'hours'; z.setpoints.setback_c = 16 }
    const r = simulate(d, { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    r.summary.zones.forEach((z, i) => {
      const h = z.hours!, res = r.results.zones[i]
      expect(h.setpoint_c).toBe(d.zones[i].setpoints.heat_c); expect(h.setback_c).toBe(16)
      expect(h.in_use_hours).toBe(res.annual.in_use_hours)
      expect(h.unmet_in_use_hours).toBe(res.annual.unmet_heating_hours_in_use)
      // The peaks are the engine's own hours, in use, the morning one at the start of the hours (07:00 here).
      expect(h.morning_peak!.w).toBe(res.hourly.heating_w[h.morning_peak!.hour])
      expect(h.morning_peak!.hour % 24).toBe(7)
      expect(h.later_peak!.w).toBe(res.hourly.heating_w[h.later_peak!.hour])
      expect(h.morning_peak!.w).toBeGreaterThan(h.later_peak!.w)
      expect(h.recovery!.mornings).toBeGreaterThan(20)
      expect(h.recovery!.median_h).toBe(0)  // unlimited heating holds the setpoint from the first hour
    })
    // With the heating limited, the room takes longer to come back.
    for (const z of d.zones) z.emitters = [{ id: `${z.id}_e`, kind: 'electric', count: 1, rated_output_w: 15000, radiant_fraction: 0, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
    const c = simulate(d, { weather: WEATHER })
    if (!c.ok) throw new Error(JSON.stringify(c.missing))
    const h0 = c.summary.zones[0].hours!.recovery!
    expect((h0.median_h ?? 99) + h0.not_reached).toBeGreaterThan(0)
    // Review F1 (decision 4): emitters are sized on the steady run, heated at every hour with no setback, not on the
    // Monday-morning recovery; and their hours below are the hours in use (review F6).
    const steady = structuredClone(d)
    for (const z of steady.zones) { z.setpoints.hours_ref = null; z.setpoints.setback_c = null }
    // Review F3: a limited zone heated to hours runs in quarter hours; the same building unlimited keeps one step.
    expect(r.summary.steps_per_hour).toBe(1); expect(c.summary.steps_per_hour).toBe(4)
    const s = simulate(steady, { weather: WEATHER, options: QUARTER_HOUR_OPTIONS })
    if (!s.ok) throw new Error(JSON.stringify(s.missing))
    c.summary.emitters!.zones.forEach((z, i) => {
      expect(z.peak_w).toBe(s.summary.emitters!.zones[i].peak_w)
      expect(z.peak_w).toBeLessThan(r.summary.zones[i].hours!.morning_peak!.w / 2)
      expect(z.in_use).toBe(true); expect(s.summary.emitters!.zones[i].in_use).toBe(false)
      expect(z.unmet_hours).toBe(c.results.zones[i].annual.unmet_heating_hours_in_use)
      expect(z.min_c).toBe(c.results.zones[i].annual.min_control_in_use_c)
    })
  })
  it('underfloor heating in the floor between two storeys, from the upper storey; the lower half refused (109 review F5)', async () => {
    const d = await doc()
    const hp = d.system_groups.find((g: any) => g.service === 'heating' && g.source === 'ambient_air')
    hp.design_flow_c = 45; hp.design_return_c = 35
    // ceiling_z1: zone_a z1 below, zone_b z2 above; its layers run from z2's face (carpet, screed, concrete, …).
    const ufh = (layer: number) => {
      d.zones[1].emitters = [{ id: 'z2_ufh', kind: 'underfloor', count: 1, rated_output_w: 400000, radiant_fraction: null, system_group_id: hp.id, rated_flow_c: 45, rated_return_c: 35, rated_room_c: 21, exponent_n: 1.1, source_surface_id: 'ceiling_z1', source_layer_index: layer }]
      return simulate(d, { weather: WEATHER })
    }
    const r = ufh(0)
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    expect(r.results.engine).toBe('thermal-2')
    const z2 = r.results.zones[1]
    expect(z2.emitters?.slab).toEqual({ surface_id: 'ceiling_z1', layer_index: 0, share: 1 })
    expect(z2.breakdown.find((l) => l.term === 'heating')!.kwh).toBeCloseTo(z2.annual.heating_kwh, 9)
    for (const z of r.results.zones) expect(z.closure.max_wh).toBeLessThanOrEqual(1)
    const no = ufh(2)
    if (no.ok) throw new Error('ran')
    expect(no.missing[0].path).toBe('zones[1].emitters[0].source_layer_index')
    expect(no.missing[0].what).toMatch(/half/)
  })
  it('a pre-heat hour (part value) is neither in use nor set back: not counted, and not the first hour (109 review F9)', async () => {
    const d = await doc()
    const HOURS = JSON.parse(readFileSync(repo('validation/energyplus/109_setback_spec.json'), 'utf8')).hours
    const first = HOURS.weekday.findIndex((f: number) => f === 1)
    HOURS.weekday[first - 1] = 0.5
    d.profiles.push({ id: 'hours', kind: 'schedule', day_types: HOURS })
    for (const z of d.zones) {
      z.setpoints.hours_ref = 'hours'; z.setpoints.setback_c = 16
      z.emitters = [{ id: `${z.id}_e`, kind: 'electric', count: 1, rated_output_w: 15000, radiant_fraction: 0, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
    }
    const r = simulate(d, { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    const z = r.results.zones[0], h = r.summary.zones[0].hours!, sp = d.zones[0].setpoints.heat_c
    let use = 0, below = 0
    for (let i = 0; i < 8760; i++) {
      const day = Math.floor(i / 24) % 7, f = (day < 5 ? HOURS.weekday : day === 5 ? HOURS.saturday : HOURS.sunday)[i % 24]
      if (f !== 1) continue
      use++; if (z.hourly.theta_air_c[i] < sp - 0.5) below++
    }
    expect(h.in_use_hours).toBe(use)
    expect(h.unmet_in_use_hours).toBe(below)
    expect(h.unmet_in_use_hours).toBeLessThan(z.annual.unmet_heating_hours!)  // the part hour is counted against its own setpoint only there
    expect(h.morning_peak!.hour % 24).toBe(first)
  })
  it('a setback refused in words (Brief 109 P4)', async () => {
    const d = await doc()
    d.zones[0].setpoints.setback_c = 16
    const r = simulate(d, { weather: WEATHER })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.missing[0].what).toMatch(/^Choose the hours ".+" is heated in, so its setback knows when to apply\.$/)
    d.profiles.push({ id: 'h', kind: 'schedule', day_types: { weekday: Array(24).fill(0.5), saturday: Array(24).fill(0), sunday: Array(24).fill(0) } })
    d.zones[0].setpoints.hours_ref = 'h'; d.zones[0].setpoints.setback_c = null
    const r2 = simulate(d, { weather: WEATHER })
    if (r2.ok) throw new Error('ran')
    expect(r2.missing[0].what).toMatch(/^The schedule "h", weekday, hour 0: a part value \(0\.5\) needs a setback/)
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

describe('Brief 117: the design heat loss in the summary', () => {
  const design = async (over: (d: any) => void = () => {}) => {
    const d = await doc()
    const hp = d.system_groups.find((g: any) => g.service === 'heating' && g.source === 'ambient_air')
    hp.design_flow_c = 50; hp.design_return_c = 40
    d.zones.forEach((z: any) => {
      z.emitters = [{ id: `${z.id}_rads`, kind: 'radiator', count: 1, rated_output_w: 30000, radiant_fraction: 0.3, system_group_id: hp.id, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.3 }]
      z.design_internal_c = 'follow_heat_c'
    })
    d.building.design = { outdoor: { stated_c: -3 }, warm_up_w_per_m2: 5, vent_wind_m_s: 4 }
    over(d)
    return d
  }
  it('only on the full run: the fabric and spaces copies have none', async () => {
    const d = await design()
    for (const level of ['fabric', 'spaces'] as const) {
      const r = simulate(d, { weather: WEATHER, level, fabric_heat_c: 21 })
      if (!r.ok) throw new Error(JSON.stringify(r.missing))
      expect(r.summary.design_heat_loss).toBeNull()
    }
    const r = simulate(d, { weather: WEATHER })
    expect(r.ok && r.summary.design_heat_loss?.ok).toBe(true)
  })
  it('none without design conditions', async () => {
    const r = simulate(await doc(), { weather: WEATHER })
    expect(r.ok && r.summary.design_heat_loss).toBeNull()
  })
  it('the engine\'s own figures (Rule 11), terms summing to each room (Rule 9), and the emitters against them', async () => {
    const d = await design()
    const r = simulate(d, { weather: WEATHER, what_if: { design_flow_c: 70, design_return_c: 60 } })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    const dh = r.summary.design_heat_loss!
    if (!dh.ok) throw new Error(JSON.stringify(dh.missing))
    const direct = designHeatLoss(ModelDocument.parse(d), r.results.zones, W)
    expect(dh.building_w).toBe(direct.building_w)
    expect(dh).toMatchObject({ outdoor_c: -3, outdoor_source: 'stated', warm_up_w_per_m2: 5, what_if: { design_flow_c: 70, design_return_c: 60 } })
    const f = (fl: number, rt: number) => Math.pow(logMeanDeltaT(fl, rt, 21) / logMeanDeltaT(75, 65, 20), 1.3)
    dh.zones.forEach((z, i) => {
      expect(z.total_w).toBe(direct.zones[i].total_w)
      expect(z.terms.reduce((s, t) => s + t.w, 0)).toBeCloseTo(z.total_w, 6)
      expect(z.terms.find((t) => t.term === 'warm_up')!.w).toBeCloseTo(5 * z.floor_m2, 9)
      expect(z.emitters!.peak_w).toBe(z.total_w)
      expect(z.emitters!.cap_w).toBeCloseTo(30000 * f(50, 40), 6)
      expect(z.emitters!.design).toEqual({ flow_c: 50, return_c: 40, room_c: 21 })
      expect(z.emitters!.needed_rated_w).toBeCloseTo(z.total_w / f(50, 40), 6)
      expect(z.what_if_emitters!.cap_w).toBeCloseTo(30000 * f(70, 60), 6)
    })
  })
  it('a design temperature away from the setpoint rates the emitters at it', async () => {
    const r = simulate(await design((d) => { d.zones[0].design_internal_c = 18 }), { weather: WEATHER })
    if (!r.ok || !r.summary.design_heat_loss?.ok) throw new Error('no design heat loss')
    const z = r.summary.design_heat_loss.zones[0]
    expect(z).toMatchObject({ internal_c: 18, internal_source: 'stated' })
    expect(z.emitters!.design!.room_c).toBe(18)
    expect(z.emitters!.cap_w).toBeCloseTo(30000 * Math.pow(logMeanDeltaT(50, 40, 18) / logMeanDeltaT(75, 65, 20), 1.3), 6)
  })
  it('what it still needs, in words; the year\'s results are still there', async () => {
    const r = simulate(await design((d) => { d.zones[1].design_internal_c = null }), { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    expect(r.summary.design_heat_loss).toEqual({ ok: false, missing: [{ path: 'zones[1].design_internal_c', what: 'State the design temperature for "Storey 2", or let it follow its heating setpoint.' }] })
    expect(r.summary.emitters).not.toBeNull()
    const v = simulate(await design((d) => { d.building.design.vent_wind_m_s = null }), { weather: WEATHER })
    expect(v.ok && v.summary.design_heat_loss).toEqual({ ok: false, missing: [{ path: 'building.design.vent_wind_m_s', what: 'State the wind speed at which the permanent vents are counted for the design heat loss.' }] })
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

describe('Brief 119: cooling units in the emitter summary', () => {
  it('the engine\'s own cap, the unlimited run\'s peak, the limited run\'s hours above (Rule 11)', async () => {
    const d = await doc()
    const z3 = d.zones[2]
    z3.emitters = [{ id: 'z3_vrf', kind: 'vrf_indoor', count: 4, heats: false, cooling_output_w: 3000, rated_output_w: null, radiant_fraction: null, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
    const r = simulate(d, { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    const em = r.summary.emitters!
    expect(em.zones).toEqual([])  // a cooling-only unit is not a heating emitter
    expect(em.cooling).toHaveLength(1)
    const c = em.cooling[0], z = r.results.zones[2]
    const free = simulate(d, { weather: WEATHER, options: { ...RUN_OPTIONS, emitter_limit: 'none' } })
    if (!free.ok) throw new Error('free run')
    expect(c).toMatchObject({ id: z3.id, cap_w: 12000, unmet_hours: z.annual.unmet_cooling_hours, max_c: z.annual.max_control_c, hours_at_cap: z.cooling_units!.hours_at_cap })
    expect(c.peak_w).toBe(free.results.zones[2].annual.peak_cooling_w)
    expect(c.shortfall_w).toBeCloseTo(c.peak_w - 12000, 9)
    expect(c.unmet_hours).toBeGreaterThan(0)
  })
})
