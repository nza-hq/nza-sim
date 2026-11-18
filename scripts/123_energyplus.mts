/**
 * Brief 123: "Run in EnergyPlus" on the two check buildings, through the same seam the workspace uses
 * (sim2/run/energyplus.ts) and the same runner (frontend/plugins/energyplusRunner.js).
 *
 *   bridgewater   the anchor fixture, five storeys as five zones, Yeovilton TMYx (data/weather/current, checked by sha)
 *   community     the worked example community centre (docs/examples/community_centre.plan.json) as drawn, and with
 *                 run B's hours and setbacks (Brief 120 P4); any EPW (the example used London Gatwick IWEC, not committed)
 *
 * Run from frontend/:  npx vite-node ../scripts/123_energyplus.mts <community weather.epw> <out.json> [<runs dir>]
 * Needs EnergyPlus (ENERGYPLUS_DIR, or the usual install folders).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan } from '../frontend/src/sim2/geometry/plan'
import { weatherFromBytes, type WeatherChoice } from '../frontend/src/sim2/run/weather'
import { simulate } from '../frontend/src/sim2/run/seam'
import { energyPlusInput, energyPlusSummary } from '../frontend/src/sim2/run/energyplus'
import { CONSTRUCTIONS, type LibraryItem } from '../frontend/src/sim2/run/library'
// @ts-expect-error plain JS module
import { runEnergyPlus } from '../frontend/plugins/energyplusRunner.js'

const root = path.resolve(__dirname, '..')
const [communityEpw, outPath, runsArg] = process.argv.slice(2)
const runs = runsArg ?? path.join(os.tmpdir(), 'nza-123')

async function compare(label: string, doc: any, weather: WeatherChoice, epwPath: string, constructions?: LibraryItem[]) {
  const ours = simulate(doc, { weather, constructions })
  if (!ours.ok) throw new Error(`${label}: ${JSON.stringify(ours.missing)}`)
  const prep = energyPlusInput(doc, ours.results, { weather, constructions })
  if (!prep.ok) throw new Error(`${label}: ${JSON.stringify(prep.missing)}`)
  const out = await runEnergyPlus({ ...prep.input, epw: readFileSync(epwPath, 'utf8') }, path.join(runs, label))
  const ep = energyPlusSummary(prep.doc, ours.results, prep.input, out, weather, 'systems')
  const s = ours.summary
  const pct = (a: number, b: number) => (b === 0 ? null : +((a / b - 1) * 100).toFixed(1))
  const row = {
    label, energyplus: ep.version, ep_run_s: +ep.run_s.toFixed(1), warnings: ep.warnings, severe: ep.severe, severe_text: ep.severe_text,
    nza_steps_per_hour: s.steps_per_hour,
    heating_kwh: { nza: Math.round(s.building.heating_kwh), ep: Math.round(ep.building.heating_kwh), diff_pct: pct(s.building.heating_kwh, ep.building.heating_kwh) },
    cooling_kwh: { nza: Math.round(s.building.cooling_kwh), ep: Math.round(ep.building.cooling_kwh), diff_pct: pct(s.building.cooling_kwh, ep.building.cooling_kwh) },
    peak_heating_kw: { nza: +(s.building.peak_heating_w / 1000).toFixed(1), ep: +(ep.building.peak_heating_w / 1000).toFixed(1) },
    peak_cooling_kw: { nza: +(s.building.peak_cooling_w / 1000).toFixed(1), ep: +(ep.building.peak_cooling_w / 1000).toFixed(1) },
    eui: { nza: s.energy?.ok ? +s.energy.eui_kwh_per_m2.toFixed(1) : null, ep: ep.energy?.ok ? +ep.energy.eui_kwh_per_m2.toFixed(1) : null },
    zones: s.zones.map((z, i) => ({
      zone: z.name, heating_kwh: [Math.round(z.heating_kwh), Math.round(ep.zones[i].heating_kwh)], cooling_kwh: [Math.round(z.cooling_kwh), Math.round(ep.zones[i].cooling_kwh)],
      unmet_heating_in_use: [z.hours?.unmet_in_use_hours ?? ours.results.zones[i].annual.unmet_heating_hours_in_use, ep.zones[i].unmet_heating_hours_in_use],
    })),
    monthly_heating_kwh: { nza: s.building.monthly.heating_kwh.map(Math.round), ep: ep.building.monthly.heating_kwh.map(Math.round) },
    notes: ep.notes,
  }
  console.log(JSON.stringify({ ...row, zones: undefined, notes: undefined, monthly_heating_kwh: undefined }))
  return row
}

// Bridgewater: the anchor fixture, per storey.
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const bwEpw = path.join(root, 'data/weather/current', fx.building_config.weather_file)
const bwWeather = await weatherFromBytes(new Uint8Array(readFileSync(bwEpw)), path.basename(bwEpw), 'local')
if (bwWeather.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const conv = await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA }, building_id: 'bridgewater-anchor',
}, { zoning: 'per_storey' })
const bw: any = conv.document
// Pinned to the committed library export's bodies, as the 114 gate does (the fixture's own hashes are of its config_json).
for (const r of bw.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash

// The community centre, as drawn (A) and with run B's hours (Brief 120 P4).
const plan = JSON.parse(readFileSync(path.join(root, 'docs/examples/community_centre.plan.json'), 'utf8'))
const built = buildDocument(upgradePlan(plan.plan))
if (!built.ok) throw new Error(JSON.stringify(built.issues))
const ccWeather = await weatherFromBytes(new Uint8Array(readFileSync(communityEpw)), path.basename(communityEpw), 'local')
const hours = (from: number, to: number) => Array.from({ length: 24 }, (_, h) => (h >= from && h < to ? 1 : 0))
const off = Array(24).fill(0)
const B = structuredClone(built.doc) as any
B.profiles.push(
  { id: 'hours_office', kind: 'schedule', label: 'Office hours', day_types: { weekday: hours(7, 18), saturday: off, sunday: off } },
  { id: 'hours_cafe', kind: 'schedule', label: 'Café hours', day_types: { weekday: hours(8, 18), saturday: hours(8, 18), sunday: hours(9, 17) } },
  { id: 'hours_hall', kind: 'schedule', label: 'Hall hours', day_types: { weekday: hours(8, 22), saturday: hours(8, 22), sunday: hours(9, 18) } },
)
const HOURS: Record<string, [string, number] | null> = {
  'Café': ['hours_cafe', 16], Kitchen: ['hours_cafe', 14], Reception: ['hours_office', 16], 'Open-plan office': ['hours_office', 16],
  'Meeting room': ['hours_office', 16], WCs: ['hours_office', 14], 'Main hall': ['hours_hall', 14], 'Comms room': null, Store: null,
}
for (const z of B.zones) {
  const h = HOURS[z.name]
  if (h && z.setpoints.heat_c != null) { z.setpoints.hours_ref = h[0]; z.setpoints.setback_c = h[1] }
  for (const e of z.emitters) if (e.kind === 'vrf_indoor') e.cooling_output_w = 3600
}

const result = {
  source: 'scripts/123_energyplus.mts',
  weather: { bridgewater: { file: path.basename(bwEpw), sha256: bwWeather.sha256 }, community: { file: path.basename(communityEpw), sha256: ccWeather.sha256 } },
  runs: [
    await compare('bridgewater', bw, bwWeather, bwEpw),
    await compare('community_A', built.doc, ccWeather, communityEpw),
    await compare('community_B', B, ccWeather, communityEpw),
  ],
}
writeFileSync(outPath, JSON.stringify(result, null, 1) + '\n')
