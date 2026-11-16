/**
 * Brief 103 Part 2: schema 2.1 states today's hidden constants, and a stored 2.0 document upgrades to exactly them.
 * Brief 104 Part 1b: schema 2.2 adds each opaque surface's inside solar absorptance; 2.0 and 2.1 upgrade to it.
 * Brief 105 Part 1: schema 2.3 states today's internal-gain fallbacks and each gain profile's radiant fraction.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { fromBuildingConfig } from '../fromBuildingConfig'
import { modelHash } from '../hash'
import { ModelDocument, SCHEMA_VERSION } from '../model'
import { TODAY, stateTodaysGainInputs, upgradeDocument } from '../upgrade'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const FIXTURE = parseYaml(readFileSync(repo('validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'

async function anchor() {
  const fx = structuredClone(FIXTURE)
  return (await fromBuildingConfig({
    building_config: fx.building_config, construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
    library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA },
    building_id: 'bridgewater-anchor',
  })).document
}

/** What a 2.2 document looked like: the 2.3 one without radiant fractions (Bridgewater states every other gain input). */
function to22(d: any) {
  const o = structuredClone(d)
  o.schema_version = '2.2'
  for (const p of o.profiles) delete p.radiant_fraction
  return o
}

/** What a 2.1 document looked like: the 2.2 one without inside solar absorptance. */
function to21(d: any) {
  const o = to22(d)
  o.schema_version = '2.1'
  for (const s of o.surfaces) { delete s.inside_solar_absorptance; delete s.inside_solar_absorptance_b; delete s.faces_up }
  return o
}

/** What a 2.0 document looked like: the 2.1 one with the 2.1 fields taken out. */
function downgrade(d: any) {
  const o = to21(d)
  o.schema_version = '2.0'
  for (const s of o.surfaces) { delete s.solar_absorptance; delete s.thermal_emissivity; delete s.frame_fraction }
  for (const z of o.zones) delete z.internal_heat_capacity_j_per_k_m2
  delete o.building.site.ground
  return o
}

describe('schema 2.1 to 2.6', () => {
  it('the converter writes today\'s constants into the document', async () => {
    const d = await anchor()
    expect(d.schema_version).toBe('2.8')
    for (const s of d.surfaces) {
      if (s.kind === 'wall') expect([s.solar_absorptance, s.thermal_emissivity, s.frame_fraction]).toEqual([0.6, 0.9, null])
      if (s.kind === 'roof') expect([s.solar_absorptance, s.thermal_emissivity, s.frame_fraction]).toEqual([0.7, 0.9, null])
      if (s.kind === 'glazing') expect([s.solar_absorptance, s.thermal_emissivity, s.frame_fraction]).toEqual([null, 0.9, 0.2])
    }
    for (const s of d.surfaces) expect(s.inside_solar_absorptance).toBe(s.kind === 'glazing' ? null : 0.7)
    expect(d.zones.map((z) => z.internal_heat_capacity_j_per_k_m2)).toEqual(d.zones.map(() => 250_000))
    expect(d.building.site.ground).toEqual({ method: 'annual_mean_outdoor' })
  })
  it('a 2.0 document upgrades to the same document the converter writes today, and the same hash', async () => {
    const d = await anchor()
    const old = downgrade(d)
    expect(() => ModelDocument.parse(old)).toThrow()
    const up = upgradeDocument(old)
    expect(up).toEqual(d)
    expect(await modelHash(up)).toBe(await modelHash(d))
    expect(upgradeDocument(d)).toEqual(d)  // a current document passes through
  })
  it('a 2.1 document upgrades to the 2.2 one, and the same hash', async () => {
    const d = await anchor()
    const old = to21(d)
    expect(() => ModelDocument.parse(old)).toThrow()
    const up = upgradeDocument(old)
    expect(up).toEqual(d)
    expect(await modelHash(up)).toBe(await modelHash(d))
  })
  it('a 2.2 document upgrades to the 2.3 one, and the same hash; Bridgewater\'s stated gain inputs are kept', async () => {
    const d = await anchor()
    const gains = d.profiles.filter((p) => p.kind !== 'schedule')
    expect(gains.map((p) => [p.kind, (p as any).radiant_fraction])).toEqual(gains.map((p) => [p.kind, 0.3]))
    const occ: any = d.profiles.find((p) => p.kind === 'occupancy')
    expect([occ.occupancy_rate, occ.sensible_w_per_person, occ.density]).toEqual([1, 75, { value: 2.5, basis: 'per_room' }])
    const old = to22(d)
    expect(() => ModelDocument.parse(old)).toThrow()
    const up = upgradeDocument(old)
    expect(up).toEqual(d)
    expect(await modelHash(up)).toBe(await modelHash(d))
  })
  it('a 2.3 document upgrades to the 2.4 one by adding empty emitter lists, and fills nothing else (Brief 108)', async () => {
    const d = await anchor()
    expect(d.zones.every((z) => z.emitters.length === 0)).toBe(true)
    const old: any = structuredClone(d)
    old.schema_version = '2.3'
    for (const z of old.zones) delete z.emitters
    expect(() => ModelDocument.parse(old)).toThrow()
    const up = upgradeDocument(old)
    expect(up).toEqual(d)
    expect(await modelHash(up)).toBe(await modelHash(d))
  })
  it('a 2.7 document upgrades to the 2.8 one, and its unstated gain inputs stay unstated (Brief 112 review F1)', async () => {
    const d: any = await anchor()
    for (const p of d.profiles) {
      if (p.kind === 'occupancy') { delete p.occupancy_rate; delete p.sensible_w_per_person }
      if (p.kind === 'lighting') { delete p.area_share; delete p.gain_fraction; delete p.daylight_factor }
    }
    const occ = d.profiles.filter((p: any) => p.kind === 'occupancy')
    expect(occ.length).toBeGreaterThan(0)
    const old: any = structuredClone(d)
    old.schema_version = '2.7'
    const hw = occ[0].dhw
    if (hw) Object.assign(old.services.dhw, { demand_basis: hw.basis, [hw.basis === 'per_person' ? 'litres_per_person_per_day' : 'litres_per_m2_per_day']: hw.litres_per_day })
    for (const p of old.profiles) { delete p.dhw; delete p.lux }
    for (const g of old.system_groups) delete g.efficacy_w_m2_per_100lux
    const up: any = upgradeDocument(old)
    expect(up).toEqual(d)
    for (const p of up.profiles.filter((q: any) => q.kind === 'occupancy')) expect([p.occupancy_rate, p.sensible_w_per_person]).toEqual([undefined, undefined])
  })
  it('fills only today\'s fallbacks a profile leaves out, and only those today\'s engine reads for it', () => {
    const occ: any = { id: 'o', kind: 'occupancy', density: { value: 0.1, basis: 'per_m2' } }
    stateTodaysGainInputs(occ)
    expect(occ).toEqual({ id: 'o', kind: 'occupancy', density: { value: 0.1, basis: 'per_m2' }, occupancy_rate: 0.75, sensible_w_per_person: 75, radiant_fraction: 0.3 })
    const light: any = { id: 'l', kind: 'lighting', magnitude: { value: 8, unit: 'w_per_m2' } }
    stateTodaysGainInputs(light)
    expect(light).toMatchObject({ area_share: 1, gain_fraction: 1, relationship_to_occupancy: 'proportional_with_spill', daylight_factor: 0.6, radiant_fraction: 0.3 })
    const timer: any = { id: 'x', kind: 'auxiliary', relationship_to_occupancy: 'independent', radiant_fraction: 0 }
    stateTodaysGainInputs(timer)
    expect(timer.daylight_factor).toBeUndefined()
    expect(timer.radiant_fraction).toBe(0)
    const equip: any = { id: 'e', kind: 'equipment', relationship_to_occupancy: 'independent' }
    stateTodaysGainInputs(equip)
    expect(equip.standby_factor).toBeUndefined()
    const equip2: any = { id: 'e2', kind: 'equipment' }
    stateTodaysGainInputs(equip2)
    expect([equip2.relationship_to_occupancy, equip2.standby_factor]).toEqual(['proportional', 0.1])
    const sched: any = { id: 's', kind: 'schedule' }
    stateTodaysGainInputs(sched)
    expect(sched).toEqual({ id: 's', kind: 'schedule' })
  })
  it('refuses a gain profile without a radiant fraction key, or with one outside 0 to 1', async () => {
    const d: any = await anchor()
    const i = d.profiles.findIndex((p: any) => p.kind === 'lighting')
    const a = structuredClone(d); delete a.profiles[i].radiant_fraction
    expect(() => ModelDocument.parse(a)).toThrow()
    const b = structuredClone(d); b.profiles[i].radiant_fraction = 1.2
    expect(() => ModelDocument.parse(b)).toThrow()
    const c = structuredClone(d); c.profiles[i].radiant_fraction = null
    expect(ModelDocument.parse(c).profiles[i]).toMatchObject({ radiant_fraction: null })
  })
  it('refuses an outside wall without absorptance, glazing without a frame fraction, missing or misplaced inside absorptance, and an unknown version', async () => {
    const d: any = await anchor()
    const wall = d.surfaces.findIndex((s: any) => s.kind === 'wall')
    const glz = d.surfaces.findIndex((s: any) => s.kind === 'glazing')
    const a = structuredClone(d); a.surfaces[wall].solar_absorptance = null
    expect(() => ModelDocument.parse(a)).toThrow('needs solar_absorptance')
    const b = structuredClone(d); b.surfaces[glz].frame_fraction = null
    expect(() => ModelDocument.parse(b)).toThrow('needs frame_fraction and thermal_emissivity')
    const c = structuredClone(d); c.surfaces[wall].inside_solar_absorptance = null
    expect(() => ModelDocument.parse(c)).toThrow('needs inside_solar_absorptance')
    const e = structuredClone(d); e.surfaces[glz].inside_solar_absorptance = 0.5
    expect(() => ModelDocument.parse(e)).toThrow('not inside_solar_absorptance')
    expect(() => upgradeDocument({ ...d, schema_version: '1.0' })).toThrow('schema version "1.0"')
    expect(SCHEMA_VERSION).toBe('2.8')
    expect(TODAY.inside_solar_absorptance).toBe(0.7)
    expect(TODAY.internal_heat_capacity_j_per_k_m2).toBe(250_000)
  })
})
