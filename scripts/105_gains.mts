/**
 * Brief 105 Part 2: Bridgewater's five storeys with internal gains, against the five-zone EnergyPlus referee given
 * the same gains.
 *
 * Run from frontend/:
 *   npx vite-node ../scripts/105_gains.mts -- export <dir>   writes <dir>/gains.csv and <dir>/gains.json (each zone's
 *                                                            gain per profile, hour by hour, from gains.ts) for
 *                                                            validation/energyplus/105_gains_referee.py
 *   npx vite-node ../scripts/105_gains.mts -- compare        runs Engine 2 and writes docs/audit/105/02_gains.json
 *
 * The referee is given the gains gains.ts computes (Schedule:File), not its own schedules: decision 2 of the brief
 * (one expansion of the profiles, shared by the engine and the referee). What the referee checks is the heat
 * balance's response to the same gains, with each profile's radiant fraction. That gains.ts is today's engine's gains
 * is checked hour by hour in frontend/src/thermal/engine/__tests__/gains.test.ts.
 *
 * Needs the anchor EPW in data/weather/current (local data, checked by sha).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { parseEpw, REFEREE_OPTIONS, runModel, zoneGains, type ModelResults } from '../frontend/src/thermal/engine/index'

const root = path.resolve(__dirname, '..')
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const weather = await parseEpw(new Uint8Array(readFileSync(path.join(root, 'data/weather/current', fx.building_config.weather_file))))
if (weather.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const lib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((c: any) => [c.name, c.config_json]))
const H = weather.hours.count
const convert = async (zoning: 'single' | 'per_storey') => (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA },
  building_id: 'bridgewater-anchor',
}, { zoning })).document

const args = process.argv.slice(2).filter((a) => a !== '--')
const five = await convert('per_storey')

if (args[0] === 'export') {
  const dir = path.resolve(args[1])
  mkdirSync(dir, { recursive: true })
  const g = zoneGains(five, weather.hours)
  const cols: { zone: string; storey: number; kind: string; profile_id: string; radiant_fraction: number; column: number; annual_kwh: number }[] = []
  const series: Float64Array[] = []
  g.forEach((zg, zi) => zg?.gains.forEach((x) => {
    series.push(x.w)
    cols.push({ zone: five.zones[zi].id, storey: five.zones[zi].floor + 1, kind: x.kind, profile_id: x.profile_id, radiant_fraction: x.radiant_fraction, column: series.length, annual_kwh: x.w.reduce((s, v) => s + v, 0) / 1000 })
  }))
  const lines = [cols.map((c) => `${c.zone}_${c.profile_id}`).join(',')]
  for (let h = 0; h < H; h++) lines.push(series.map((s) => s[h].toPrecision(12)).join(','))
  writeFileSync(path.join(dir, 'gains.csv'), lines.join('\n') + '\n')
  writeFileSync(path.join(dir, 'gains.json'), JSON.stringify({ epw_sha256: EPW_SHA, hours: H, columns: cols }, null, 1) + '\n')
  console.log(`wrote ${cols.length} columns × ${H} hours to ${dir}`)
} else if (args[0] === 'compare') {
  const ref = JSON.parse(readFileSync(path.join(root, 'docs/audit/105/02_gains_referee.json'), 'utf8'))
  const run = (gains: boolean) => runModel(five, weather, lib, { ...REFEREE_OPTIONS, internal_gains: gains ? 'profiles' : 'none' })
  const summ = (r: ModelResults) => ({
    heating_mwh: r.zones.reduce((s, z) => s + z.annual.heating_kwh, 0) / 1000,
    cooling_mwh: r.zones.reduce((s, z) => s + z.annual.cooling_kwh, 0) / 1000,
    zones: Object.fromEntries(r.zones.map((z) => [z.zone_id, { heating_mwh: z.annual.heating_kwh / 1000, cooling_mwh: z.annual.cooling_kwh / 1000 }])),
  })
  const pct = (a: number, b: number) => (100 * (a - b)) / b
  const out: any = { source: 'scripts/105_gains.mts', epw_sha256: EPW_SHA, options: 'REFEREE_OPTIONS', comparisons: {} }
  for (const [label, gains, refName] of [['without gains (Brief 104 gate, r2_z)', false, 'r2_z'], ['with gains (r2_z_gains)', true, 'r2_z_gains']] as const) {
    const e = summ(run(gains)), r = ref.runs[refName]
    if (!r) throw new Error(`referee run ${refName} missing`)
    const zones = Object.fromEntries(Object.entries(e.zones).map(([zid, v], i) => {
      const rz = r.zones[`Floor_${i + 1}`]
      return [zid, { engine: v, referee: { heating_mwh: rz.heating_mwh, cooling_mwh: rz.cooling_mwh }, heating_pct: pct(v.heating_mwh, rz.heating_mwh), cooling_pct: pct(v.cooling_mwh, rz.cooling_mwh) }]
    }))
    out.comparisons[label] = {
      referee_run: refName, engine: { heating_mwh: e.heating_mwh, cooling_mwh: e.cooling_mwh },
      referee: { heating_mwh: r.heating_mwh, cooling_mwh: r.cooling_mwh },
      heating_pct: pct(e.heating_mwh, r.heating_mwh), cooling_pct: pct(e.cooling_mwh, r.cooling_mwh), zones,
    }
    console.log(`${label}: heat ${e.heating_mwh.toFixed(2)} vs ${r.heating_mwh} (${pct(e.heating_mwh, r.heating_mwh).toFixed(1)} %), cool ${e.cooling_mwh.toFixed(2)} vs ${r.cooling_mwh} (${pct(e.cooling_mwh, r.cooling_mwh).toFixed(1)} %)`)
    for (const [zid, z] of Object.entries(zones)) console.log(`   ${zid} heat ${(z as any).engine.heating_mwh.toFixed(2)}/${(z as any).referee.heating_mwh} cool ${(z as any).engine.cooling_mwh.toFixed(2)}/${(z as any).referee.cooling_mwh}`)
  }
  writeFileSync(path.join(root, 'docs/audit/105/02_gains.json'), JSON.stringify(out, null, 1) + '\n')
} else {
  throw new Error('usage: 105_gains.mts -- export <dir> | compare')
}
