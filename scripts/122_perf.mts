/**
 * Brief 122 P3: speed of the monthly estimate (static). Budget: fifty rooms under 10 ms in the container.
 * The 50-room grid of Brief 104 (scripts/104_grid50.mts) at Fabric only (levelDocument, 21 °C), on the committed
 * Chicago O'Hare TMY3. "first": the first call on a weather file (it works out the sun on each orientation, then keeps
 * it); "cached": median of 21 calls after it, which is what an edit costs. The hourly run's Fabric only on the same
 * document for comparison (median of 3).
 *
 * Run from frontend/:  npx vite-node ../scripts/122_perf.mts [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import { parseEpw, REFEREE_OPTIONS, runModel } from '../frontend/src/thermal/engine/index'
import { runMonthly } from '../frontend/src/thermal/engine/monthly'
import { levelDocument, MONTHLY_OPTIONS, RUN_OPTIONS } from '../frontend/src/sim2/run/seam'
import { grid50, PERF_PARTITION } from './104_grid50.mts'

const root = path.resolve(__dirname, '..')
const spec = JSON.parse(readFileSync(path.join(root, 'validation/energyplus/115_air_spec.json'), 'utf8'))
const weather = await parseEpw(new Uint8Array(readFileSync(path.join(root, spec.weather.file))))
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const lib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((c: any) => [c.name, c.config_json]))
lib[PERF_PARTITION.name] = PERF_PARTITION
const five = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: null },
  building_id: 'bridgewater-anchor',
}, { zoning: 'per_storey' })).document
const now = () => performance.now()
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const out: any[] = []
for (const [name, raw] of [['five_storeys', five], ['fifty_rooms', grid50(five)]] as const) {
  const doc = levelDocument(ModelDocument.parse(raw), 'fabric', 21)
  let t = now(); const first = runMonthly(doc, weather, lib, MONTHLY_OPTIONS); const firstMs = now() - t
  const ms: number[] = []
  for (let i = 0; i < 21; i++) { t = now(); runMonthly(doc, weather, lib, MONTHLY_OPTIONS); ms.push(now() - t) }
  const hms: number[] = []
  let heat = 0
  for (let i = 0; i < 3; i++) { t = now(); const r = runModel(doc, weather, lib, { ...RUN_OPTIONS, ...REFEREE_OPTIONS, internal_gains: 'profiles', ventilation: 'document' }); hms.push(now() - t); heat = r.zones.reduce((s, z) => s + z.annual.heating_kwh, 0) }
  const row = {
    name, zones: doc.zones.length, first_ms: +firstMs.toFixed(2), cached_median_ms: +med(ms).toFixed(2), budget_ms: name === 'fifty_rooms' ? 10 : null,
    pass: name === 'fifty_rooms' ? med(ms) < 10 : null, hourly_median_ms: +med(hms).toFixed(0),
    monthly_heating_kwh: Math.round(first.zones.reduce((s, z) => s + z.heating_kwh, 0)), hourly_heating_kwh: Math.round(heat),
  }
  out.push(row); console.log(JSON.stringify(row))
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ source: 'scripts/122_perf.mts', weather: spec.weather.file, cases: out }, null, 1) + '\n')
