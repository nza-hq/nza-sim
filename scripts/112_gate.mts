/**
 * Brief 112 Part 4: the demand/energy split on Bridgewater and the two-zone fixture, through the product's seam.
 *
 * Run from frontend/:  npx vite-node ../scripts/112_gate.mts      (needs the anchor EPW in data/weather/current)
 * Writes docs/audit/112/04_gate.json.
 *
 * (a) Bridgewater, five storeys, '+ Systems', as converted (lighting a stated W/m², hot water on the occupancy profile).
 * (b) The same with lighting restated as lux on each space and one efficacy on the lighting system, chosen so that
 *     lux ÷ 100 × efficacy is today's stated W/m² (efficacy 2.0 W/m² per 100 lux, lux = 50 × W/m²). These are NOT survey
 *     values: they are picked to reproduce today's input, so the gate tests the path, not a lighting design.
 *     Every end use and the EUI must equal (a).
 * (c) The three levels on Bridgewater and on the two-zone fixture: each building breakdown closes against its own
 *     demand (Rule 9); lighting heat is absent at '+ Spaces' and present at '+ Systems'.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { parseEpw } from '../frontend/src/thermal/engine/index'
import { simulate, type Level } from '../frontend/src/sim2/run/seam'
import { CONSTRUCTIONS } from '../frontend/src/sim2/run/library'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan, type Plan } from '../frontend/src/sim2/geometry/plan'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(read('validation/fixtures/bridgewater_anchor_v2.yaml').toString())
const w = await parseEpw(new Uint8Array(read(path.join('data/weather/current', fx.building_config.weather_file))))
if (w.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const weather = { weather: w, file_name: fx.building_config.weather_file, station: 'Yeovilton', sha256: w.sha256, source: 'local' } as any

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
const energy = (s: ReturnType<typeof run>) => {
  if (!s.energy?.ok) throw new Error(JSON.stringify(s.energy))
  const e = s.energy
  return { eui_kwh_per_m2: e.eui_kwh_per_m2, total_kwh: e.total_kwh, end_uses: Object.fromEntries(e.end_uses.map((u) => [`${u.end_use}/${u.fuel}`, u.kwh])) }
}

// (a) and (b)
const a = await bridgewater()
const EFF = 2.0
const lightingProfiles = a.profiles.filter((p: any) => p.kind === 'lighting')
const stated = lightingProfiles.map((p: any) => ({ id: p.id, unit: p.magnitude?.unit, w_per_m2: p.magnitude?.value }))
if (stated.some((p: any) => p.unit !== 'w_per_m2')) throw new Error(`lighting not in W/m²: ${JSON.stringify(stated)}`)
const b = structuredClone(a)
for (const p of b.profiles) if (p.kind === 'lighting') { p.lux = 50 * p.magnitude.value; delete p.magnitude }
const lightGroups = b.system_groups.filter((g: any) => g.service === 'lighting')
if (lightGroups.length === 0) throw new Error('Bridgewater has no lighting system')
for (const g of lightGroups) g.efficacy_w_m2_per_100lux = EFF
const ea = energy(run(a)), eb = energy(run(b))
const keys = [...new Set([...Object.keys(ea.end_uses), ...Object.keys(eb.end_uses)])]
const diff = Object.fromEntries(keys.map((k) => [k, (eb.end_uses[k] ?? 0) - (ea.end_uses[k] ?? 0)]))
const maxAbs = Math.max(...Object.values(diff).map(Math.abs), Math.abs(eb.total_kwh - ea.total_kwh))

// (c) levels
const closes = (lines: { kwh: number }[]) => {
  const sum = lines.reduce((s, l) => s + l.kwh, 0), gross = lines.reduce((s, l) => s + Math.abs(l.kwh), 0)
  return { residual_kwh: sum, gross_kwh: gross, closes: Math.abs(sum) < 1e-6 * gross }
}
function levels(d: any) {
  return Object.fromEntries((['fabric', 'spaces', 'systems'] as const).map((l) => {
    const s = run(d, l)
    const lighting = s.breakdown?.find((t: any) => t.term === 'lighting_gains')?.kwh ?? null
    return [l, { heating_kwh: s.building.heating_kwh, cooling_kwh: s.building.cooling_kwh, breakdown: closes(s.breakdown ?? []), lighting_term_kwh: lighting, terms: (s.breakdown ?? []).map((t: any) => t.term) }]
  }))
}
const twoPlan = JSON.parse(read('frontend/src/sim2/geometry/__fixtures__/two_zones.plan.json').toString()) as { plan: Plan }
const two = buildDocument(upgradePlan(twoPlan.plan))
if (two.issues.length) throw new Error(JSON.stringify(two.issues))

const out = {
  source: 'scripts/112_gate.mts', epw_sha256: w.sha256,
  bridgewater_lighting_stated: stated, efficacy_w_m2_per_100lux: EFF, lux: b.profiles.filter((p: any) => p.kind === 'lighting').map((p: any) => ({ id: p.id, lux: p.lux })),
  a_stated_w_per_m2: ea, b_lux_and_efficacy: eb, b_minus_a_kwh: diff, max_abs_difference_kwh: maxAbs, pass_b_equals_a: maxAbs < 1e-6,
  hot_water_on_spaces: a.profiles.filter((p: any) => p.kind === 'occupancy').map((p: any) => ({ id: p.id, dhw: p.dhw })),
  levels: { bridgewater: levels(a), two_zones: levels(two.doc) },
}
writeFileSync(path.join(root, 'docs/audit/112/04_gate.json'), JSON.stringify(out, null, 1) + '\n')
console.log('EUI a', ea.eui_kwh_per_m2.toFixed(3), 'b', eb.eui_kwh_per_m2.toFixed(3), 'max |b−a| kWh', maxAbs)
for (const [k, v] of Object.entries(out.levels)) for (const [l, x] of Object.entries(v as any)) console.log(k, l, 'heat', (x as any).heating_kwh.toFixed(0), 'closes', (x as any).breakdown.closes, 'lighting term', (x as any).lighting_term_kwh)
