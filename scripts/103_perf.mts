/**
 * Brief 103 Part 4 / decision 7: the performance budget.
 *
 * Run from frontend/:  npx vite-node ../scripts/103_perf.mts
 * Needs the anchor EPW in data/weather/current (local data) and the pre-installed Chromium (Playwright).
 *
 * 1. One zone (the Bridgewater anchor document), a full year: median of 5 after one warm-up, in Node and in a
 *    Chromium Web Worker (the engine bundled with esbuild, nothing else in the worker).
 * 2. Scaling: 1, 10 and 50 copies of the zone, each solved as its own zone (today's engine path).
 * 3. What a coupled 50-zone model would cost if it were one dense matrix: the per-hour substitution timed at the
 *    node counts of 1, 10 and 50 zones, so Brief 104 can see why the zones must stay block-structured.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { parseEpw, runZoneModel, REFEREE_OPTIONS } from '../frontend/src/thermal/engine/index'
import { luFactor, luSolve } from '../frontend/src/thermal/engine/linalg'

const root = path.resolve(__dirname, '..')
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const epwPath = path.join(root, 'data/weather/current/GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw')
const epwBytes = new Uint8Array(readFileSync(epwPath))
const { document: doc } = await fromBuildingConfig({
  building_config: fx.building_config, construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: path.basename(epwPath), file_hash: 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2' },
  building_id: 'bridgewater-anchor',
})
const lib = Object.fromEntries(fx.library_constructions.map((c: any) => [c.name, c.config_json]))
const weather = await parseEpw(epwBytes)
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const time = (f: () => void) => { const t = performance.now(); f(); return performance.now() - t }

const out: Record<string, unknown> = { node: process.version, cpu: execFileSync('nproc').toString().trim() + ' cores' }
runZoneModel(doc, weather, lib, REFEREE_OPTIONS)
const one = Array.from({ length: 5 }, () => time(() => runZoneModel(doc, weather, lib, REFEREE_OPTIONS)))
out.node_one_zone_ms = { median: median(one), runs: one }
const scale: Record<number, number> = {}
for (const n of [1, 10, 50]) scale[n] = time(() => { for (let i = 0; i < n; i++) runZoneModel(doc, weather, lib, REFEREE_OPTIONS) })
out.node_independent_zones_ms = scale

// Dense coupled estimate: per-hour substitution at n nodes, × 8,760 hours (plus one factorisation).
const r = runZoneModel(doc, weather, lib, REFEREE_OPTIONS)
const nodesPerZone = 44
const dense: Record<number, number> = {}
for (const z of [1, 10, 50]) {
  const n = nodesPerZone * z
  const a = new Float64Array(n * n)
  for (let i = 0; i < n; i++) { a[i * n + i] = 4; if (i > 0) { a[i * n + i - 1] = -1; a[(i - 1) * n + i] = -1 } }
  const tf = time(() => luFactor(a, n))
  const lu = luFactor(a, n), b = new Float64Array(n).fill(1), x = new Float64Array(n)
  const reps = Math.max(5, Math.floor(20000 / z / z))
  const ts = time(() => { for (let k = 0; k < reps; k++) luSolve(lu, b, x) }) / reps
  dense[z] = Math.round(tf + ts * 8760)
}
out.dense_coupled_estimate_ms = dense
void r

// Browser worker.
const dir = mkdtempSync(path.join(tmpdir(), 'nza103-'))
execFileSync(path.join(root, 'frontend/node_modules/.bin/esbuild'), [path.join(root, 'frontend/src/thermal/engine/index.ts'), '--bundle', '--format=esm', `--outfile=${dir}/engine.mjs`], { stdio: 'pipe' })
const engineSrc = readFileSync(`${dir}/engine.mjs`, 'utf8')
const workerSrc = `${engineSrc}
self.onmessage = async (e) => {
  const { doc, lib, epw, options } = e.data
  const w = await parseEpw(new Uint8Array(epw))
  const t = () => performance.now()
  runZoneModel(doc, w, lib, options)
  const runs = []; for (let i = 0; i < 5; i++) { const s = t(); runZoneModel(doc, w, lib, options); runs.push(t() - s) }
  const scale = {}; for (const n of [1, 10, 50]) { const s = t(); for (let i = 0; i < n; i++) runZoneModel(doc, w, lib, options); scale[n] = t() - s }
  const r = runZoneModel(doc, w, lib, options)
  self.postMessage({ runs, scale, heating_kwh: r.annual.heating_kwh, cooling_kwh: r.annual.cooling_kwh })
}`
writeFileSync(`${dir}/worker.mjs`, workerSrc)
const { chromium } = await import('playwright')
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {})
const page = await browser.newPage()
// A localhost page is a secure context, so the worker has crypto.subtle (parseEpw's sha256).
const http = await import('node:http')
const server = http.createServer((_q, a) => { a.writeHead(200, { 'content-type': 'text/html' }); a.end('<!doctype html><title>perf</title>') })
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()))
await page.goto(`http://127.0.0.1:${(server.address() as any).port}/`)
const res: any = await page.evaluate(async ({ src, doc, lib, epw, options }) => {
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  const w = new Worker(url, { type: 'module' })
  return await new Promise((resolve, reject) => { w.onmessage = (e) => resolve(e.data); w.onerror = (e) => reject(`worker: ${e.message} ${e.filename}:${e.lineno}`); w.postMessage({ doc, lib, epw, options }) })
}, { src: workerSrc, doc, lib, epw: Array.from(epwBytes), options: REFEREE_OPTIONS })
await browser.close()
server.close()
out.worker_one_zone_ms = { median: median(res.runs), runs: res.runs }
out.worker_independent_zones_ms = res.scale
out.same_numbers = { node: [r.annual.heating_kwh, r.annual.cooling_kwh], worker: [res.heating_kwh, res.cooling_kwh], identical: r.annual.heating_kwh === res.heating_kwh && r.annual.cooling_kwh === res.cooling_kwh }
console.log(JSON.stringify(out, null, 2))
writeFileSync(path.join(root, 'docs/audit/103/04_performance.json'), JSON.stringify(out, null, 2) + '\n')
