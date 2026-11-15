/**
 * Brief 104 Part 6: decision 6's performance budgets, as medians of 5 in Node and in a browser worker.
 *
 * Run from frontend/:  npx vite-node ../scripts/104_perf.mts
 * The browser half bundles scripts/104_perf_worker.mts with esbuild, serves it on a local port and runs it in a
 * Chromium worker through Playwright (PW_EXECUTABLE picks the browser binary, e.g. Edge on Windows). Each case runs
 * once untimed, then five times timed. The totals must be identical in both. Writes docs/audit/104/06_performance.json.
 *
 * Cases: Bridgewater as one zone (Engine 1, budget 100 ms), as five storeys (budget 150 ms in a worker) and as 50
 * coupled rooms (scripts/104_grid50.mts, budget 2 s in a worker), all on REFEREE_OPTIONS and the anchor EPW.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import { parseEpw, readBuildingCoolingKwh, readBuildingHeatingKwh, REFEREE_OPTIONS, runModel } from '../frontend/src/thermal/engine/index'
import { grid50, PERF_PARTITION } from './104_grid50.mts'

const root = path.resolve(__dirname, '..')
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const epw = readFileSync(path.join(root, 'data/weather/current', fx.building_config.weather_file))
const weather = await parseEpw(new Uint8Array(epw))
if (weather.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const lib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((c: any) => [c.name, c.config_json]))
lib[PERF_PARTITION.name] = PERF_PARTITION

const convert = async (zoning: 'single' | 'per_storey') => (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA },
  building_id: 'bridgewater-anchor',
}, { zoning })).document
const five = await convert('per_storey')
const only = process.env.PERF_CASES?.split(',')  // e.g. PERF_CASES=five_zones while iterating; the record runs all three
const cases = [
  { name: 'one_zone', budget_ms: 100, doc: await convert('single') },
  { name: 'five_zones', budget_ms: 150, doc: five },
  { name: 'fifty_zones', budget_ms: 2000, doc: ModelDocument.parse(grid50(five)) },
].filter((c) => !only || only.includes(c.name))
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

const node = cases.map((c) => {
  runModel(c.doc, weather, lib, REFEREE_OPTIONS)
  const ms: number[] = []
  let r: any
  for (let i = 0; i < 5; i++) { const t = performance.now(); r = runModel(c.doc, weather, lib, REFEREE_OPTIONS); ms.push(performance.now() - t) }
  return { name: c.name, ms, heating_kwh: readBuildingHeatingKwh(r), cooling_kwh: readBuildingCoolingKwh(r), engine: r.engine, nodes: r.solver.nodes, zones: c.doc.zones.length, surfaces: c.doc.surfaces.length }
})

const dir = mkdtempSync(path.join(os.tmpdir(), 'nza104perf-'))
await build({ entryPoints: [path.join(root, 'scripts/104_perf_worker.mts')], bundle: true, format: 'esm', platform: 'browser', outfile: path.join(dir, 'worker.js'), logLevel: 'error' })
const worker = readFileSync(path.join(dir, 'worker.js'))
const server = http.createServer((req, res) => {
  if (req.url === '/worker.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(worker); return }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>perf</title>')
})
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
const port = (server.address() as any).port
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {})
let worker_results: any[]
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${port}/`)
  worker_results = await page.evaluate(({ cases, lib, epw, options }) => new Promise((ok, fail) => {
    const w = new Worker('/worker.js', { type: 'module' })
    w.onmessage = (e) => ok(e.data); w.onerror = (e) => fail(new Error(e.message))
    w.postMessage({ cases, lib, epw: new Uint8Array(epw).buffer, options })
  }), { cases: cases.map((c) => ({ name: c.name, doc: c.doc })), lib, epw: [...epw], options: REFEREE_OPTIONS }) as any[]
  worker_results = worker_results.map((r) => ({ ...r, browser: browser.version() }))
} finally { await browser.close(); server.close() }

const rows = cases.map((c, i) => {
  const n = node[i], w = worker_results[i]
  return {
    name: c.name, engine: n.engine, zones: n.zones, surfaces: n.surfaces, nodes: n.nodes, budget_ms: c.budget_ms,
    node_median_ms: +median(n.ms).toFixed(1), worker_median_ms: +median(w.ms).toFixed(1),
    node_ms: n.ms.map((v) => +v.toFixed(1)), worker_ms: w.ms.map((v: number) => +v.toFixed(1)),
    heating_kwh: n.heating_kwh, cooling_kwh: n.cooling_kwh, worker_heating_kwh: w.heating_kwh, worker_cooling_kwh: w.cooling_kwh,
    totals_identical: n.heating_kwh === w.heating_kwh && n.cooling_kwh === w.cooling_kwh,
    within_budget: median(w.ms) <= c.budget_ms && median(n.ms) <= c.budget_ms,
  }
})
const out = { source: 'scripts/104_perf.mts', epw_sha256: EPW_SHA, options: REFEREE_OPTIONS, machine: { platform: process.platform, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, node: process.version, browser: worker_results[0]?.browser }, cases: rows }
if (!only) writeFileSync(path.join(root, 'docs/audit/104/06_performance.json'), JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
