/**
 * Brief 103 Part 2: schema 2.1 states today's hidden constants, and a stored 2.0 document upgrades to exactly them.
 * Brief 104 Part 1b: schema 2.2 adds each opaque surface's inside solar absorptance; 2.0 and 2.1 upgrade to it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { fromBuildingConfig } from '../fromBuildingConfig'
import { modelHash } from '../hash'
import { ModelDocument, SCHEMA_VERSION } from '../model'
import { TODAY, upgradeDocument } from '../upgrade'

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

/** What a 2.1 document looked like: the 2.2 one without inside solar absorptance. */
function to21(d: any) {
  const o = structuredClone(d)
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

describe('schema 2.1 and 2.2', () => {
  it('the converter writes today\'s constants into the document', async () => {
    const d = await anchor()
    expect(d.schema_version).toBe('2.2')
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
    expect(SCHEMA_VERSION).toBe('2.2')
    expect(TODAY.inside_solar_absorptance).toBe(0.7)
    expect(TODAY.internal_heat_capacity_j_per_k_m2).toBe(250_000)
  })
})
