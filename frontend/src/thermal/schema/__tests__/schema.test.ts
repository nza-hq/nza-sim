/**
 * Brief 102 Part 1 tests: the canonical hash, the converter on the Bridgewater anchor fixture, and the schema's
 * referential checks. Pure: no engine import, no network, no database.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { canonicalJSON, CanonicalJSONError } from '../canonical'
import { fromBuildingConfig, type ConverterInput, type TraceEntry } from '../fromBuildingConfig'
import { libraryHash, modelHash, weatherHash } from '../hash'
import { ModelDocument } from '../model'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const FIXTURE = parseYaml(readFileSync(repo('validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const READS: string[] = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/engine_reads_part0.json', import.meta.url)), 'utf8')).reads
// The anchor EPW's sha256 (docs/audit/102/00_reconnaissance.md (b)); the file itself is not in git.
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'

const clone = <T>(v: T): T => structuredClone(v)
function input(): ConverterInput {
  const fx = clone(FIXTURE)
  return {
    building_config: fx.building_config,
    construction_choices: fx.construction_choices,
    comfort_band: fx.comfort_band,
    library_constructions: fx.library_constructions,
    weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA },
    building_id: 'bridgewater-anchor',
  }
}

function at(root: unknown, path: string): unknown {
  let v = root
  for (const s of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (v == null) return undefined
    v = (v as Record<string, unknown>)[s]
  }
  return v
}
const norm = (p: string) => p.replace(/\[\d+\]/g, '[]')

/**
 * Engine reads the converter deliberately does not carry, each with its reason. Every one was perturbed on the
 * anchor in Part 1 and moved nothing (docs/audit/102/01_model_document.md "Excluded inputs").
 */
const EXCLUDED: { match: (r: string) => boolean; why: string }[] = [
  { match: (r) => r.startsWith('building_config.interventions'), why: 'patches over a model version, not part of one (_skipInterventions)' },
  { match: (r) => /^building_config\.systems_config_v25\.(heating|cooling)(\.|$)/.test(r), why: 'shadowed by v40 heating/cooling' },
  { match: (r) => /^building_config\.systems_config_v25\.dhw(\.|$)/.test(r) && r !== 'building_config.systems_config_v25.dhw.circulation_pump_w', why: 'shadowed by v40 dhw (the circulation pump is carried)' },
  { match: (r) => /^building_config\.systems_config_v40\.\w+\[\]\.[a-z_0-9]+ \(in\)$/.test(r), why: 'stale service-level field guard: the converter refuses the config, as the engine does' },
  { match: (r) => r.startsWith('libraryData.system_templates'), why: 'the built-in template table; values move nothing with v40 present' },
  { match: (r) => r.startsWith('libraryData.constructions'), why: 'carried by reference: library_refs[].body_hash pins the whole item' },
]

describe('canonical JSON and hashes', () => {
  it('ignores key order', async () => {
    const { document } = await fromBuildingConfig(input())
    const reversed = JSON.parse(JSON.stringify(document), (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    )
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(document))
    expect(await modelHash(reversed)).toBe(await modelHash(document))
  })

  it('changes with one U-value (a per-project override, and the library item itself)', async () => {
    const base = await fromBuildingConfig(input())
    const h0 = await modelHash(base.document)

    const i1 = input()
    i1.construction_choices.external_wall = { library_id: 'bridgwater_ext_wall', u_value_override: 0.25 }
    const h1 = await modelHash((await fromBuildingConfig(i1)).document)
    expect(h1).not.toBe(h0)

    const i2 = input()
    const wall = i2.library_constructions.find((c) => c.name === 'bridgwater_ext_wall') as Record<string, any>
    if (wall.config_json?.u_value_W_per_m2K !== undefined) wall.config_json.u_value_W_per_m2K += 0.01
    else wall.u_value_W_per_m2K += 0.01
    const d2 = (await fromBuildingConfig(i2)).document
    expect(await libraryHash(d2.library_refs)).not.toBe(await libraryHash(base.document.library_refs))
    expect(await modelHash(d2)).not.toBe(h0)
  })

  it('is stable: converting twice gives the same hash', async () => {
    const a = await fromBuildingConfig(input())
    const b = await fromBuildingConfig(input())
    expect(await modelHash(a.document)).toBe(await modelHash(b.document))
    expect(canonicalJSON(a.document)).toBe(canonicalJSON(b.document))
  })

  it('pins weather by the file bytes, not the name', async () => {
    const { document } = await fromBuildingConfig(input())
    expect(await weatherHash(document.weather_ref)).toBe(EPW_SHA)
  })

  it('refuses values JSON cannot round-trip', () => {
    expect(canonicalJSON({ a: -0 })).toBe('{"a":0}')
    expect(() => canonicalJSON({ a: Number.NaN })).toThrow(CanonicalJSONError)
    expect(() => canonicalJSON({ a: new Date(0) })).toThrow(CanonicalJSONError)
    expect(() => canonicalJSON([1, undefined])).toThrow(CanonicalJSONError)
  })
})

describe('building_config → one-zone model document (Bridgewater anchor fixture)', () => {
  it('carries every value it copies verbatim', async () => {
    const inp = input()
    const { document, trace } = await fromBuildingConfig(inp)
    const roots = { building_config: inp.building_config, construction_choices: inp.construction_choices, comfortBand: inp.comfort_band }
    const values = trace.filter((t) => t.kind === 'value')
    expect(values.length).toBeGreaterThan(300)
    const wrong = values.filter((t) => JSON.stringify(at(roots, t.src)) !== JSON.stringify(at(document, t.doc)))
    expect(wrong).toEqual([])
  })

  it('covers every path the engine reads (Part 0 trace), field by field, or excludes it with a reason', async () => {
    const { trace } = await fromBuildingConfig(input())
    const traced = new Set(trace.map((t: TraceEntry) => norm(t.src)))
    const covered = (r: string) => {
      const base = r.replace(/ \(in\)$/, '')
      for (const t of traced) if (t === base || t.startsWith(`${base}.`) || t.startsWith(`${base}[`)) return true
      return false
    }
    const uncovered = READS.filter((r) => !covered(r) && !EXCLUDED.some((e) => e.match(r)))
    // What is left must be reads the engine made of a field this fixture does not have (`x ?? default`). For each,
    // set it and show the converter then carries it, verbatim, to the document.
    const roots0 = { building_config: input().building_config }
    const notAbsent = uncovered.filter((r) => at(roots0, r.replace(/\[\]/g, '[0]')) !== undefined)
    expect(notAbsent).toEqual([])
    const sentinel = (leaf: string): unknown =>
      leaf === 'flow_mode' ? 'single_sided' : leaf === 'summer_bypass' ? true : leaf === 'schedule' ? 'sentinel_schedule' : 0.375
    const dropped: string[] = []
    for (const r of uncovered) {
      const i = input()
      const path = r.replace(/\[\]/g, '[0]').replace(/\[(\d+)\]/g, '.$1').split('.')
      let o: any = { building_config: i.building_config }
      for (const s of path.slice(0, -1)) o = o[s] ??= {}
      const leaf = path[path.length - 1]
      o[leaf] = sentinel(leaf)
      const { document, trace } = await fromBuildingConfig(i)
      const hit = trace.find((t) => norm(t.src) === r && t.kind === 'value')
      if (!hit || JSON.stringify(at(document, hit.doc)) !== JSON.stringify(sentinel(leaf))) dropped.push(r)
    }
    expect(dropped).toEqual([])
    // An exclusion must not hide something the converter carries anyway (keeps the list honest).
    const excludedButTraced = READS.filter((r) => EXCLUDED.some((e) => e.match(r)) && traced.has(r.replace(/ \(in\)$/, '')))
    expect(excludedButTraced).toEqual([])
  })

  it('builds the expected box', async () => {
    const { document: d } = await fromBuildingConfig(input())
    const bc = FIXTURE.building_config
    expect(d.zones).toHaveLength(1)
    expect(d.zones[0].area_m2).toBeCloseTo(bc.length * bc.width * bc.num_floors, 9)
    expect(d.surfaces.map((s) => s.id)).toEqual([
      'wall_north', 'glazing_north', 'wall_east', 'glazing_east', 'wall_south', 'glazing_south', 'wall_west', 'glazing_west', 'roof', 'ground',
    ])
    const north = d.surfaces.filter((s) => s.facade === 'north').reduce((a, s) => a + s.area_m2, 0)
    expect(north).toBeCloseTo(bc.length * bc.floor_height * bc.num_floors, 9)
    expect(d.surfaces.find((s) => s.id === 'wall_east')!.azimuth_deg).toBe((90 + bc.orientation) % 360)
    expect(d.surfaces.find((s) => s.id === 'wall_north')!.openings).toEqual([{ kind: 'permanent_vent', area_m2: 1.1, cd: 0.49 }])
    expect(d.library_refs.map((r) => r.key).sort()).toEqual(Object.values(FIXTURE.construction_choices).map(String).sort())
  })

  it('refuses a stale service-level field on a system entry', async () => {
    const i = input()
    ;(i.building_config as any).systems_config_v40.dhw[0].tap_outlet_temp_c = 45
    await expect(fromBuildingConfig(i)).rejects.toThrow(/service-level field "tap_outlet_temp_c"/)
  })

  it('refuses a v25-only project and a missing construction', async () => {
    const i = input()
    delete (i.building_config as any).systems_config_v40
    await expect(fromBuildingConfig(i)).rejects.toThrow(/v25-only/)
    const j = input()
    j.construction_choices.roof = 'no_such_roof'
    await expect(fromBuildingConfig(j)).rejects.toThrow(/not in the library/)
  })
})

describe('schema referential checks', () => {
  it('rejects a zone with no surfaces', async () => {
    const { document } = await fromBuildingConfig(input())
    const bad = clone(document) as any
    bad.zones[0].surfaces = []
    const r = ModelDocument.safeParse(bad)
    expect(r.success).toBe(false)
    expect(r.error!.issues.map((x) => x.message)).toContain('a zone must have at least one surface')
  })

  it('rejects a surface naming a missing zone', async () => {
    const { document } = await fromBuildingConfig(input())
    const bad = clone(document) as any
    bad.surfaces[0].zone_a = 'z_missing'
    const r = ModelDocument.safeParse(bad)
    expect(r.success).toBe(false)
    expect(r.error!.issues.map((x) => x.message)).toContain('surface "wall_north" names zone "z_missing", which does not exist')
  })

  it('rejects an unknown key rather than storing and hashing it', async () => {
    const { document } = await fromBuildingConfig(input())
    const bad = clone(document) as any
    bad.zones[0].colour = 'blue'
    expect(ModelDocument.safeParse(bad).success).toBe(false)
  })
})
