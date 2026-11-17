/**
 * Brief 115 P5: speed of weather-driven air (budgets: one room < 100 ms, 50 rooms with windows < 2 s), median of 5 in
 * Node after one untimed run. Weather: the committed Chicago O'Hare TMY3 EPW (the anchor EPW is not needed here).
 *
 * Cases:
 *   one_room         the R2 referee room (airBox R2_single): leakage and one window by temperature, 1 step an hour.
 *   one_room_4       the same at 4 steps an hour (the referee's setting).
 *   fifty_rooms      Brief 104's 50-room grid of Bridgewater (scripts/104_grid50.mts), every room weather-driven:
 *                    q50 5, each glazing surface a side-hung window (half of it, 30°, Cd 0.6, sill 0.9 m, head 2.4 m)
 *                    opening above its heating setpoint + 2 K; 1 step an hour.
 *   fifty_rooms_today the same grid under today's method, for the cost of the air model.
 *
 * Run from frontend/:  npx vite-node ../scripts/115_perf.mts [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import { parseEpw, readBuildingCoolingKwh, readBuildingHeatingKwh, REFEREE_OPTIONS, runModel } from '../frontend/src/thermal/engine/index'
import { airBoxDocument } from '../frontend/src/thermal/engine/__tests__/airBox'
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
const today = ModelDocument.parse(grid50(five))
const wd: any = structuredClone(today)
wd.building.air = { method: 'weather_driven', exponent: 0.67, single_sided_turbulence: true }
wd.building.site.terrain = 'suburban'
for (const z of wd.zones) { z.infiltration_q50 = 5; z.infiltration_ach = null }
for (const s of wd.surfaces) {
  s.openings = s.openings.filter((o: any) => o.kind !== 'permanent_vent' || (o.height_m = 2.4, true))
  if (s.kind === 'glazing' && s.zone_b === 'outside') s.openings.push({ kind: 'operable', openable_fraction: 0.5, cd: 0.6, style: 'side_hung', opening_angle_deg: 30, sill_m: 0.9, head_m: 2.4 })
}
wd.controls = wd.zones.filter((z: any) => wd.surfaces.some((s: any) => s.zone_a === z.id && s.kind === 'glazing' && s.zone_b === 'outside'))
  .map((z: any) => ({ id: `win_${z.id}`, target: { kind: 'window', ref: z.id }, controller: 'manual', rule: 'temperature', open_fraction: 1, open_above_c: (z.setpoints.heat_c ?? 20) + 2 }))
const fifty = ModelDocument.parse(wd)
const box = airBoxDocument('R2_single')
const lib2 = { ...lib, ...box.lib }

const four = { ...REFEREE_OPTIONS, time_step: { steps_per_hour: 4, theta_e_between: 'linear' as const } }
const cases = [
  { name: 'one_room', budget_ms: 100, doc: box.doc, opts: REFEREE_OPTIONS },
  { name: 'one_room_4', budget_ms: null, doc: box.doc, opts: four },
  { name: 'fifty_rooms', budget_ms: 2000, doc: fifty, opts: REFEREE_OPTIONS },
  { name: 'fifty_rooms_today', budget_ms: null, doc: today, opts: REFEREE_OPTIONS },
]
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const out = cases.map((c) => {
  runModel(c.doc, weather, lib2, c.opts)
  const ms: number[] = []
  let r: any
  for (let i = 0; i < 5; i++) { const t = performance.now(); r = runModel(c.doc, weather, lib2, c.opts); ms.push(performance.now() - t) }
  const open = r.zones.reduce((s: number, z: any) => s + (z.air?.hours_windows_open ?? 0), 0)
  const row = { name: c.name, zones: c.doc.zones.length, median_ms: Math.round(median(ms)), ms: ms.map(Math.round), budget_ms: c.budget_ms, heating_kwh: readBuildingHeatingKwh(r), cooling_kwh: readBuildingCoolingKwh(r), room_hours_windows_open: open }
  console.log(JSON.stringify(row))
  return row
})
const file = process.argv[2]
if (file) writeFileSync(file, JSON.stringify({ source: 'scripts/115_perf.mts', node: process.version, cases: out }, null, 1) + '\n')
