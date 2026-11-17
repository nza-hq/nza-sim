/**
 * Brief 124 P3: Bridgewater v2 (five storeys) and the community centre, the full run (the product's level and time
 * step) with the old 250 kJ/K·m² contents against ISO 52016-1's 10 kJ/K·m². The same document otherwise, the same
 * weather. Bridgewater's anchor weather (Yeovilton TMYx) is not in this container, so the weather is the first
 * argument and the figures are a relative measure; the anchor itself is re-measured on IT15.
 *
 * Run from frontend/:  npx vite-node ../scripts/124_before_after.mts <weather.epw> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { CONSTRUCTIONS } from '../frontend/src/sim2/run/library'
import { simulate } from '../frontend/src/sim2/run/seam'
import { weatherFromBytes } from '../frontend/src/sim2/run/weather'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan } from '../frontend/src/sim2/geometry/plan'
import { LEGACY_INTERNAL_HEAT_CAPACITY_J_PER_K_M2 } from '../frontend/src/thermal/schema/upgrade'

const root = path.resolve(__dirname, '..')
const epw = process.argv[2], outFile = process.argv[3]
const weather = await weatherFromBytes(new Uint8Array(readFileSync(epw)), path.basename(epw), 'local')
if (!('weather' in weather)) throw new Error('weather')
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const bw: any = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: weather.file_name, file_hash: weather.sha256 }, building_id: 'bridgewater-anchor',
}, { zoning: 'per_storey' })).document
for (const r of bw.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash
const cc = JSON.parse(readFileSync(path.join(root, 'docs/examples/community_centre.plan.json'), 'utf8'))
const centre: any = buildDocument(upgradePlan(structuredClone(cc.plan))).doc

const out: Record<string, unknown> = { source: 'scripts/124_before_after.mts', weather: { file: weather.file_name, sha256: weather.sha256 }, cases: {} }
for (const [name, doc] of [['bridgewater_five_storeys', bw], ['community_centre', centre]] as const) {
  const row: Record<string, unknown> = {}
  for (const c of [LEGACY_INTERNAL_HEAT_CAPACITY_J_PER_K_M2, 10_000]) {
    const d = structuredClone(doc)
    for (const z of d.zones) if (z.conditioning !== 'unconditioned') z.internal_heat_capacity_j_per_k_m2 = c
    const r = simulate(d, { weather })
    if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.missing)}`)
    const s = r.summary
    row[c === 10_000 ? 'contents_10k' : 'legacy_250k'] = {
      heating_kwh: Math.round(s.building.heating_kwh), cooling_kwh: Math.round(s.building.cooling_kwh),
      peak_heating_kw: +(s.building.peak_heating_w / 1000).toFixed(1), peak_cooling_kw: +(s.building.peak_cooling_w / 1000).toFixed(1),
      floor_m2: s.building.floor_m2,
    }
  }
  ;(out.cases as any)[name] = row
  console.log(name, JSON.stringify(row))
}
writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n')
