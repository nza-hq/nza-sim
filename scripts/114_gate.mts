/**
 * Brief 114 Part 3: gates through the product's seam.
 *
 * Run from frontend/:  npx vite-node ../scripts/114_gate.mts [out.json]
 * Weather: the anchor EPW in data/weather/current when present (sha checked), else the Denver TMY3 .mos the engine
 * tests use (validation/fixtures/weather), named in the output.
 *
 * (a) Bridgewater five storeys at '+ Systems' as converted (no pumps, no other loads, no controls): a sha256 of every
 *     zone's hourly heating, cooling and air temperature and every end use, to compare with the same script on the
 *     commit before Brief 114 (byte for byte).
 * (b) The same with pumps on every heating and cooling system at the NCM default (Table 14 constant-speed W/m²,
 *     thermal/catalogue/auxiliaryDefaults.ts; none is published for hot water), once fixed and once variable speed,
 *     running with demand: heating, cooling and every other end use unchanged; the pumps line is the only difference.
 *     A path test: Bridgewater's systems are VRF and electric panels, which have no water circuit (NCM Table 13), so
 *     "Use defaults" (defaultPumps) would fill none; the pumps are put on regardless to exercise the line.
 * (c) The three levels with those pumps, on Bridgewater and the two-zone fixture: closure at each level (Rule 9), and
 *     pumps only at '+ Systems' (Rule 8).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { parseEpw } from '../frontend/src/thermal/engine/index'
import { simulate, type Level } from '../frontend/src/sim2/run/seam'
import { CONSTRUCTIONS } from '../frontend/src/sim2/run/library'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan, type Plan } from '../frontend/src/sim2/geometry/plan'
import { MOS, readMos } from '../frontend/src/thermal/engine/__tests__/denver'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(read('validation/fixtures/bridgewater_anchor_v2.yaml').toString())
const epwPath = path.join(root, 'data/weather/current', fx.building_config.weather_file)
const w = existsSync(epwPath) ? await parseEpw(new Uint8Array(readFileSync(epwPath))) : readMos(readFileSync(MOS))
if (existsSync(epwPath) && w.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const weatherName = existsSync(epwPath) ? `anchor EPW ${fx.building_config.weather_file}` : 'Denver TMY3 .mos (anchor EPW not in this container)'
const weather = { weather: w, file_name: 'gate', station: weatherName, sha256: w.sha256, source: 'local' } as any

async function bridgewater(): Promise<any> {
  const d: any = (await fromBuildingConfig({
    building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
    library_constructions: fx.library_constructions, weather: { file_name: 'x', file_hash: null }, building_id: 'b',
  }, { zoning: 'per_storey' })).document
  for (const r of d.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash
  return d
}
const run = (d: unknown, level: Level = 'systems') => {
  const r = simulate(d, { weather, level, fabric_heat_c: level === 'fabric' ? 21 : null })
  if (!r.ok) throw new Error(`${level}: ${JSON.stringify(r.missing)}`)
  return r.summary
}
const energy = (s: any) => {
  if (!s.energy?.ok) throw new Error(JSON.stringify(s.energy))
  return { eui_kwh_per_m2: s.energy.eui_kwh_per_m2, total_kwh: s.energy.total_kwh, end_uses: Object.fromEntries(s.energy.end_uses.map((u: any) => [`${u.end_use}/${u.fuel}`, u.kwh])) }
}
function digest(s: any): string {
  const h = createHash('sha256')
  h.update(JSON.stringify(energy(s)))
  h.update(JSON.stringify(s.building))
  for (const z of s.zones ?? []) h.update(JSON.stringify(z))
  return h.digest('hex')
}

// (a)
const a = await bridgewater()
const sa = run(a)
const ea = energy(sa)

// (b) NCM default pumps (dynamic import: absent on the commit before 114, where only (a) runs)
let b: any = null
if (existsSync(path.join(root, 'frontend/src/thermal/catalogue/auxiliaryDefaults.ts'))) {
  const { defaultPumpWPerM2, NCM_SOURCE } = await import('../frontend/src/thermal/catalogue/auxiliaryDefaults')
  const withPumps = (d: any, speed: 'fixed' | 'variable') => {
    const x = structuredClone(d)
    for (const g of x.system_groups) if (['heating', 'cooling'].includes(g.service) && g.enabled) g.pumps = { power: { w_per_m2: defaultPumpWPerM2(g.service) }, speed, runs: 'with_demand', schedule_ref: null, default_from: NCM_SOURCE }
    return x
  }
  const out: any = {}
  for (const speed of ['fixed', 'variable'] as const) {
    const s = run(withPumps(a, speed))
    const e = energy(s)
    const keys = [...new Set([...Object.keys(ea.end_uses), ...Object.keys(e.end_uses)])]
    const diff = Object.fromEntries(keys.map((k) => [k, (e.end_uses[k] ?? 0) - (ea.end_uses[k] ?? 0)]).filter(([, v]) => v !== 0))
    out[speed] = { eui_kwh_per_m2: e.eui_kwh_per_m2, eui_change: e.eui_kwh_per_m2 - ea.eui_kwh_per_m2, changed_lines_kwh: diff, only_pumps_changed: Object.keys(diff).every((k) => k.startsWith('pumps/')),
      heating_same: s.building.heating_kwh === sa.building.heating_kwh, cooling_same: s.building.cooling_kwh === sa.building.cooling_kwh,
      pumps: (s as any).energy.pumps.map((p: any) => ({ id: p.id, label: p.label, rated_w: p.rated_w, hours_run: p.hours_run, kwh: p.kwh })) }
  }
  // (c)
  const closes = (lines: { kwh: number }[]) => {
    const sum = lines.reduce((t, l) => t + l.kwh, 0), gross = lines.reduce((t, l) => t + Math.abs(l.kwh), 0)
    return Math.abs(sum) < 1e-6 * gross
  }
  const levels = (d: any) => Object.fromEntries((['fabric', 'spaces', 'systems'] as const).map((l) => {
    const s: any = run(d, l)
    return [l, { closes: closes(s.breakdown ?? []), pumps_kwh: s.energy?.ok ? s.energy.end_uses.filter((u: any) => u.end_use === 'pumps').reduce((t: number, u: any) => t + u.kwh, 0) : null }]
  }))
  const twoPlan = JSON.parse(read('frontend/src/sim2/geometry/__fixtures__/two_zones.plan.json').toString()) as { plan: Plan }
  const two = buildDocument(upgradePlan(twoPlan.plan))
  if (two.issues.length) throw new Error(JSON.stringify(two.issues))
  out.levels = { bridgewater: levels(withPumps(a, 'variable')), two_zones: levels(withPumps(two.doc, 'fixed')) }
  b = out
}

const result = { source: 'scripts/114_gate.mts', weather: weatherName, weather_sha256: w.sha256, a_digest: digest(sa), a_eui_kwh_per_m2: ea.eui_kwh_per_m2, a_end_uses: ea.end_uses, b }
const file = process.argv[2] ?? path.join(root, 'docs/audit/114/03_gate.json')
writeFileSync(file, JSON.stringify(result, null, 1) + '\n')
console.log(JSON.stringify({ digest: result.a_digest, eui: ea.eui_kwh_per_m2, b: b && { fixed: b.fixed.eui_change, variable: b.variable.eui_change, only: [b.fixed.only_pumps_changed, b.variable.only_pumps_changed], levels: b.levels } }))
