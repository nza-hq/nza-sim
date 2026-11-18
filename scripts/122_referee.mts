/**
 * Brief 122 P2: the monthly estimate (static) against the hourly run's Fabric only, same document, same weather.
 * Gates stated in the brief before this first run: annual heating within ±10 %; cooling reported, not gated (Fabric
 * only has no cooling); each line's own effect reported. Never tuned.
 *
 * Cases: Bridgewater (fixture validation/fixtures/bridgewater_anchor_v2.yaml) as one zone and as five storeys, and the
 * community centre example (docs/examples/community_centre.plan.json) as saved and with today's air method. Fabric
 * only at 21 °C.
 * Weather: the anchor's Yeovilton TMYx is not in this container (data/ is local only, and the host is blocked), so
 * every case runs on London Gatwick IWEC (not redistributable: never committed), passed as the first argument.
 *
 * Run from frontend/:  npx vite-node ../scripts/122_referee.mts <weather.epw> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { CONSTRUCTIONS } from '../frontend/src/sim2/run/library'
import { instantEstimate, levelDocument, simulate } from '../frontend/src/sim2/run/seam'
import { weatherFromBytes } from '../frontend/src/sim2/run/weather'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan } from '../frontend/src/sim2/geometry/plan'
import { ModelDocument } from '../frontend/src/thermal/schema/model'

const root = path.resolve(__dirname, '..')
const epw = process.argv[2], outFile = process.argv[3]
const weather = await weatherFromBytes(new Uint8Array(readFileSync(epw)), path.basename(epw), 'local')
if (!('weather' in weather)) throw new Error('weather')
const HEAT_C = 21

const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
async function bridgewater(zoning: 'single' | 'per_storey') {
  const d: any = (await fromBuildingConfig({
    building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
    library_constructions: fx.library_constructions, weather: { file_name: weather.file_name, file_hash: weather.sha256 }, building_id: 'bridgewater-anchor',
  }, { zoning })).document
  for (const r of d.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash
  return d
}
const cc = JSON.parse(readFileSync(path.join(root, 'docs/examples/community_centre.plan.json'), 'utf8'))
function centre(today: boolean) {
  const plan: any = upgradePlan(structuredClone(cc.plan))
  if (today) plan.building = { ...plan.building, air_method: 'today' }
  const b = buildDocument(plan)
  return b.doc
}

const cases: [string, unknown][] = [
  ['bridgewater_one_zone', await bridgewater('single')],
  ['bridgewater_five_storeys', await bridgewater('per_storey')],
  ['community_centre_as_saved', centre(false)],
  ['community_centre_today_air', centre(true)],
]
const pct = (a: number, b: number) => (b === 0 ? null : +((a / b - 1) * 100).toFixed(1))
const out: Record<string, unknown> = { source: 'scripts/122_referee.mts', weather: { file: weather.file_name, sha256: weather.sha256 }, heat_c: HEAT_C, gate_heating_pct: 10, cases: {} }
for (const [name, raw] of cases) {
  const h = simulate(raw, { weather, level: 'fabric', fabric_heat_c: HEAT_C })
  if (!h.ok) throw new Error(`${name}: ${JSON.stringify(h.missing)}`)
  const doc = levelDocument(ModelDocument.parse(raw), 'fabric', HEAT_C)
  const m = instantEstimate(doc, { weather })
  if (!m.ok) throw new Error(`${name}: ${JSON.stringify(m.missing)}`)
  const e = m.estimate, s = h.summary
  // A second call: the weather's sun is cached, as on every edit after the first.
  const again = instantEstimate(doc, { weather })
  const lines: Record<string, { monthly_kwh: number; hourly_kwh: number | null }> = {}
  for (const l of e.breakdown) lines[l.term] = { monthly_kwh: Math.round(l.kwh), hourly_kwh: null }
  for (const l of s.breakdown) (lines[l.term] ??= { monthly_kwh: 0, hourly_kwh: null }).hourly_kwh = Math.round(l.kwh)
  const d = pct(e.building.heating_kwh, s.building.heating_kwh)
  ;(out.cases as any)[name] = {
    zones: doc.zones.length, air_method: doc.building.air.method,
    heating: { monthly_kwh: Math.round(e.building.heating_kwh), hourly_kwh: Math.round(s.building.heating_kwh), diff_pct: d, pass: d != null && Math.abs(d) <= 10 },
    monthly_heating_kwh: { monthly: e.monthly.heating_kwh.map(Math.round), hourly: s.building.monthly.heating_kwh.map(Math.round) },
    zones_heating: e.zones.map((z, i) => ({ name: z.name, monthly_kwh: Math.round(z.heating_kwh), hourly_kwh: Math.round(s.zones[i].heating_kwh), diff_pct: pct(z.heating_kwh, s.zones[i].heating_kwh) })),
    lines_kwh: lines,
    ms: { first: +e.run_ms.toFixed(2), cached: +(again.ok ? again.estimate.run_ms : NaN).toFixed(2), hourly: s.run_ms },
    notes: e.notes,
  }
  console.log(name, JSON.stringify((out.cases as any)[name].heating), (out.cases as any)[name].ms)
}
writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n')
