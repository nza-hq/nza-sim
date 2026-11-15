/**
 * Brief 104 Part 2: schema 2.2's surfaces between zones and internal mass, and the per-storey converter.
 * Pure: no engine import, no network, no database.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { fromBuildingConfig, type ConverterInput } from '../fromBuildingConfig'
import { modelHash } from '../hash'
import { ModelDocument } from '../model'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const FIXTURE = parseYaml(readFileSync(repo('validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const input = (): ConverterInput => {
  const fx = structuredClone(FIXTURE)
  return {
    building_config: fx.building_config, construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
    library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA },
    building_id: 'bridgewater-anchor',
  }
}
const sumBy = (d: ModelDocument, kind: string) => d.surfaces.filter((s) => s.kind === kind).reduce((t, s) => t + s.area_m2, 0)
const vents = (d: ModelDocument) => d.surfaces.flatMap((s) => s.openings).reduce((t, o) => t + (o.kind === 'permanent_vent' ? o.area_m2 : 0), 0)

describe('per-storey zoning of the Bridgewater anchor', () => {
  it('the default and an explicit "single" give the same document and hash as before', async () => {
    const a = (await fromBuildingConfig(input())).document
    const b = (await fromBuildingConfig(input(), { zoning: 'single' })).document
    expect(b).toEqual(a)
    expect(await modelHash(b)).toBe(await modelHash(a))
    expect(a.zones).toHaveLength(1)
  })
  it('five storeys joined by four ceilings; every area sums to the single-zone one', async () => {
    const one = (await fromBuildingConfig(input())).document
    const per = (await fromBuildingConfig(input(), { zoning: 'per_storey' })).document
    expect(per.zones.map((z) => z.id)).toEqual(['z1', 'z2', 'z3', 'z4', 'z5'])
    expect(per.zones.every((z) => z.storeys === 1 && z.height_m === one.zones[0].height_m)).toBe(true)
    expect(per.zones.reduce((t, z) => t + z.area_m2, 0)).toBeCloseTo(one.zones[0].area_m2, 9)
    for (const k of ['wall', 'glazing', 'roof', 'ground']) expect(sumBy(per, k)).toBeCloseTo(sumBy(one, k), 9)
    expect(vents(per)).toBeCloseTo(vents(one), 12)
    const ceilings = per.surfaces.filter((s) => s.kind === 'ceiling')
    expect(ceilings.map((s) => [s.zone_a, s.zone_b])).toEqual([['z1', 'z2'], ['z2', 'z3'], ['z3', 'z4'], ['z4', 'z5']])
    expect(ceilings.every((s) => s.construction_ref.key === 'interior_floor_ceiling' && s.tilt_deg === 0 && s.area_m2 === 58.8 * 14.34)).toBe(true)
    expect(per.surfaces.find((s) => s.kind === 'roof')!.zone_a).toBe('z5')
    expect(per.surfaces.find((s) => s.kind === 'ground')!.zone_a).toBe('z1')
    // Each storey lists its own walls and glazing, and both of its slabs.
    expect(per.zones[2].surfaces.filter((id) => id.startsWith('ceiling_'))).toEqual(['ceiling_z2', 'ceiling_z3'])
    expect(per.library_refs.some((r) => r.key === 'interior_floor_ceiling')).toBe(true)
    expect(per.system_groups.every((g) => g.zones.length === 5)).toBe(true)
    // Every storey gets each ventilation entry with a fifth of the building's flow (Brief 105 Part 3); rooms are
    // divided evenly (Part 2, schema 2.3).
    for (const z of per.zones) expect(z.ventilation).toEqual(one.zones[0].ventilation.map((v) => ({ ...v, flow_rate: v.flow_rate! / 5 })))
    expect(one.zones[0].ventilation.map((v) => [v.flow_rate, v.flow_rate_basis])).toEqual([[1425, 'constant'], [2208, 'constant'], [210, 'constant']])
    expect(per.zones.map((z) => z.rooms)).toEqual(per.zones.map(() => 138 / 5))
    expect(per.zones.reduce((t, z) => t + z.rooms!, 0)).toBeCloseTo(one.zones[0].rooms!, 12)
  })
  it('is deterministic and fails loudly without the interior construction', async () => {
    const a = await modelHash((await fromBuildingConfig(input(), { zoning: 'per_storey' })).document)
    const b = await modelHash((await fromBuildingConfig(input(), { zoning: 'per_storey' })).document)
    expect(b).toBe(a)
    const x = input(); x.library_constructions = x.library_constructions.filter((c: any) => c.name !== 'interior_floor_ceiling')
    await expect(fromBuildingConfig(x, { zoning: 'per_storey' })).rejects.toThrow('interior_floor_ceiling')
    await expect(fromBuildingConfig(input(), { zoning: 'per_room' as never })).rejects.toThrow('options.zoning')
  })
})

describe('schema 2.2 refuses malformed interzone surfaces and internal mass', () => {
  const per = async () => structuredClone((await fromBuildingConfig(input(), { zoning: 'per_storey' })).document) as any
  const fails = (d: unknown, msg: string) => {
    const r = ModelDocument.safeParse(d)
    expect(r.success).toBe(false)
    expect(r.error!.issues.map((i) => i.message).join(' | ')).toContain(msg)
  }
  const slab = (d: any) => d.surfaces.find((s: any) => s.id === 'ceiling_z1')
  it('a slab listed by only one of its zones, or by a zone it does not face, or twice', async () => {
    let d = await per(); d.zones[1].surfaces = d.zones[1].surfaces.filter((x: string) => x !== 'ceiling_z1')
    fails(d, 'not listed by its zone "z2"')
    d = await per(); d.zones[3].surfaces.push('ceiling_z1')
    fails(d, 'listed by zone "z4", which it does not face')
    d = await per(); d.zones[0].surfaces.push('ceiling_z1')
    fails(d, 'lists surface "ceiling_z1" twice')
  })
  it('a wall or glazing joining two zones; a slab joining a zone to itself; wrong tilts', async () => {
    let d = await per(); const w = d.surfaces.find((s: any) => s.id === 'wall_north_z1'); w.zone_b = 'z2'; d.zones[1].surfaces.push(w.id)
    fails(d, 'a wall cannot join two zones')
    d = await per(); slab(d).zone_b = 'z1'; d.zones[1].surfaces = d.zones[1].surfaces.filter((x: string) => x !== 'ceiling_z1')
    fails(d, 'joins zone "z1" to itself')
    d = await per(); slab(d).tilt_deg = 180
    fails(d, 'must have tilt 0')
    d = await per(); slab(d).kind = 'floor'
    fails(d, 'must have tilt 180')
  })
  it('an interzone surface with outside-face fields, openings, or no second absorptance; a one-face surface with one', async () => {
    let d = await per(); slab(d).solar_absorptance = 0.6
    fails(d, 'has no outside face')
    d = await per(); slab(d).openings = [{ kind: 'permanent_vent', area_m2: 1, cd: 0.6, flow_mode: 'single_sided' }]
    fails(d, 'to carry openings')
    d = await per(); slab(d).inside_solar_absorptance_b = null
    fails(d, 'needs inside_solar_absorptance_b')
    d = await per(); d.surfaces.find((s: any) => s.id === 'roof').inside_solar_absorptance_b = 0.7
    fails(d, 'inside_solar_absorptance_b must be null')
  })
  it('internal mass: zone_b = zone_a, faces_up stated and matching its tilt; faces_up nowhere else', async () => {
    const mass = (over: object = {}) => ({
      id: 'mass_z1', kind: 'internal_mass', zone_a: 'z1', zone_b: 'z1', facade: null, area_m2: 100, azimuth_deg: null, tilt_deg: 180,
      construction_ref: { key: 'interior_floor_ceiling' }, g_value: null, openings: [], solar_absorptance: null, thermal_emissivity: null,
      frame_fraction: null, inside_solar_absorptance: 0.7, inside_solar_absorptance_b: 0.7, faces_up: true, ...over,
    })
    const withMass = async (over: object = {}) => { const d = await per(); d.surfaces.push(mass(over)); d.zones[0].surfaces.push('mass_z1'); return d }
    expect(ModelDocument.safeParse(await withMass()).success).toBe(true)
    expect(ModelDocument.safeParse(await withMass({ faces_up: false, tilt_deg: 90 })).success).toBe(true)
    fails(await withMass({ faces_up: null }), 'needs faces_up')
    fails(await withMass({ tilt_deg: 90 }), 'must have tilt 180')
    fails(await withMass({ zone_b: 'outside' }), 'must have zone_b equal to zone_a')
    const d = await per(); d.surfaces.find((s: any) => s.id === 'roof').faces_up = true
    fails(d, 'faces_up is for internal mass only')
  })
})
