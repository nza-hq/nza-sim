/**
 * Brief 105 Part 4: the seam's library. The epJSON layers of every library construction become exactly the layers the
 * Bridgewater fixture holds for it (today's database), value for value; unassigned, unknown and re-hashed keys are
 * named missing inputs.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { fromBuildingConfig } from '../../../thermal/schema/fromBuildingConfig'
import { bodyFromLibrary, CONSTRUCTIONS, resolveConstructions } from '../library'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const FIXTURE = parseYaml(readFileSync(repo('validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))

describe('epJSON layers to engine layers', () => {
  const fx = new Map((FIXTURE.library_constructions as any[]).map((c) => [c.name, c.config_json]))
  it('the library has the fixture\'s fifteen constructions', () => {
    expect(CONSTRUCTIONS.map((c) => c.key).sort()).toEqual([...fx.keys()].sort())
  })
  for (const item of CONSTRUCTIONS) {
    it(`${item.key}: layers, U and g as the fixture holds them`, () => {
      const want = fx.get(item.key)
      const got = bodyFromLibrary(item.body, item.key)
      const strip = (l: any) => Object.fromEntries(Object.entries(l).filter(([k]) => ['name', 'kind', 'thickness', 'conductivity', 'density', 'specific_heat', 'thermal_resistance'].includes(k)))
      expect(got.layers!.map(strip)).toEqual(want.layers.map(strip))
      expect([got.u_value_W_per_m2K, got.g_value]).toEqual([want.u_value_W_per_m2K, want.g_value])
    })
  }
  it('refuses a fragment it cannot read, naming where', () => {
    const b = structuredClone(CONSTRUCTIONS.find((c) => c.key === 'bridgwater_ext_wall')!.body)
    b.epjson.Construction.bridgwater_ext_wall.layer_2 = 'nope'
    expect(() => bodyFromLibrary(b, 'x')).toThrow('x.epjson.Construction.layer_2: layer "nope"')
    delete b.epjson
    expect(() => bodyFromLibrary(b, 'x')).toThrow('x.epjson: has no epjson layers')
  })
})

describe('resolveConstructions', () => {
  async function doc() {
    return (await fromBuildingConfig({
      building_config: structuredClone(FIXTURE.building_config), construction_choices: FIXTURE.construction_choices, comfort_band: FIXTURE.comfort_band,
      library_constructions: FIXTURE.library_constructions, weather: { file_name: 'x', file_hash: null }, building_id: 'b',
    }, { zoning: 'per_storey' })).document
  }
  /**
   * fromBuildingConfig pins the body today's database holds (layers), not the export's (epJSON), so its pins are a
   * different body by hash. The editor pins the export's. Re-pinned to the export, Bridgewater resolves cleanly.
   */
  const repin = (d: any) => { for (const r of d.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash; return d }
  it('a converted document pins today\'s database body: every construction is reported as changed, not run', async () => {
    const m = resolveConstructions(await doc()).missing
    expect(m.length).toBe(5)
    expect(m.every((x) => x.what.includes('has changed in the library'))).toBe(true)
  })
  it('Bridgewater pinned to the library export resolves to it', async () => {
    const d = repin(await doc())
    const r = resolveConstructions(d)
    expect(r.missing).toEqual([])
    expect(Object.keys(r.library).sort()).toEqual([...new Set(d.surfaces.map((s) => s.construction_ref.key))].sort())
  })
  it('names unassigned, unknown and changed constructions once each', async () => {
    const d: any = repin(await doc())
    const w = d.surfaces.findIndex((s: any) => s.kind === 'wall')
    d.surfaces.forEach((s: any) => { if (s.kind === 'wall') s.construction_ref.key = 'unassigned:external_wall' })
    const g = d.surfaces.findIndex((s: any) => s.kind === 'glazing')
    d.surfaces.forEach((s: any) => { if (s.kind === 'glazing') s.construction_ref.key = 'no_such_glass' })
    const roofRef = d.library_refs.find((r: any) => r.key === d.surfaces.find((s: any) => s.kind === 'roof').construction_ref.key)
    roofRef.body_hash = '0'.repeat(64)
    const m = resolveConstructions(d).missing
    expect(m).toEqual([
      { path: `surfaces[${w}].construction_ref.key`, what: 'Choose a construction for the outside wall.' },
      { path: `surfaces[${g}].construction_ref.key`, what: 'The construction "no_such_glass" is not in the library.' },
      expect.objectContaining({ what: expect.stringContaining('has changed in the library since it was chosen') }),
    ])
  })
})
