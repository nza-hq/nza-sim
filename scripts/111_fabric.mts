/**
 * Brief 111 Part 2: Fabric only on Bridgewater (five storeys) against EnergyPlus set up the same way.
 *
 * Run from frontend/:  npx vite-node ../scripts/111_fabric.mts
 * The seam's own fabric level (simulate(doc, { level: 'fabric', fabric_heat_c: 21 })) on the anchor weather, against
 * docs/audit/111/02_fabric_energyplus.json (validation/energyplus/111_fabric_referee.py). Writes docs/audit/111/02_fabric.json.
 * Tolerance: the existing table's building ±10 %; per storey stated (Brief 104/105: per-storey not yet validated).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { parseEpw } from '../frontend/src/thermal/engine/index'
import { CONSTRUCTIONS } from '../frontend/src/sim2/run/library'
import { simulate } from '../frontend/src/sim2/run/seam'

const root = path.resolve(__dirname, '..')
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const EP = JSON.parse(readFileSync(path.join(root, 'docs/audit/111/02_fabric_energyplus.json'), 'utf8'))
if (EP.epw_sha256 !== EPW_SHA) throw new Error('EnergyPlus results are of another weather file')
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const file = fx.building_config.weather_file
const w = await parseEpw(new Uint8Array(readFileSync(path.join(root, 'data/weather/current', file))))
if (w.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const doc: any = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: file, file_hash: EPW_SHA }, building_id: 'bridgewater-anchor',
}, { zoning: 'per_storey' })).document
for (const r of doc.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash
const r = simulate(doc, { weather: { weather: w, file_name: file, station: w.location?.city ?? '', sha256: w.sha256, source: 'local' }, level: 'fabric', fabric_heat_c: EP.heat_c })
if (!r.ok) throw new Error(JSON.stringify(r.missing))
const pct = (a: number, b: number) => +((a / b - 1) * 100).toFixed(1)
const storeys = Object.fromEntries(r.summary.zones.map((z, i) => {
  const e = EP.zones[`Floor_${i + 1}`]
  return [`Floor_${i + 1}`, { engine2_mwh: +(z.heating_kwh / 1000).toFixed(3), energyplus_mwh: +e.heating_mwh.toFixed(3), diff_pct: pct(z.heating_kwh / 1000, e.heating_mwh) }]
}))
const heat = r.summary.building.heating_kwh / 1000
const out = {
  source: 'scripts/111_fabric.mts', epw_sha256: EPW_SHA, heat_c: EP.heat_c, level: r.summary.level,
  building: { engine2_mwh: +heat.toFixed(3), energyplus_mwh: +EP.heating_mwh.toFixed(3), diff_pct: pct(heat, EP.heating_mwh), tolerance_pct: 10, pass: Math.abs(pct(heat, EP.heating_mwh)) <= 10 },
  cooling: { engine2_mwh: r.summary.building.cooling_kwh / 1000, energyplus_mwh: EP.cooling_mwh },
  storeys,
  breakdown_kwh: Object.fromEntries(r.summary.breakdown.map((l) => [l.term, +l.kwh.toFixed(0)])),
}
writeFileSync(path.join(root, 'docs/audit/111/02_fabric.json'), JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
