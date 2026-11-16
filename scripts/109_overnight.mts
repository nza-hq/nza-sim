/**
 * Brief 109 review F4: is Bridgewater's slower overnight cooling (Engine 2 about 0.6 K warmer than EnergyPlus by
 * 06:00) the inside convection? Engine 2 at 4 steps an hour, unlimited, with its fixed convection by tilt and with
 * TARP inside (outside stays fixed: wind-driven outside convection runs on one zone only), against EnergyPlus (EulerMethod) with its own convection ('default') and with the
 * engine's fixed coefficients ('iso_conv'). January only: the mean air temperature at 06:00 on weekday mornings
 * (the hour before the heating comes back), and at 18:00 (the last in-use hour) for the start of the night.
 *
 * Run from frontend/:  npx vite-node ../scripts/109_overnight.mts
 * Reads docs/audit/109/02_bridgewater_{default,iso_conv}_energyplus.json (validation/energyplus/109_bridgewater_setback.py
 * --variant ...). Writes docs/audit/109/05_overnight.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import { runModel } from '../frontend/src/thermal/engine/model'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { parseEpw } from '../frontend/src/thermal/engine/index'
import { RUN_OPTIONS } from '../frontend/src/sim2/run/seam'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
const SB = JSON.parse(read('validation/energyplus/109_setback_spec.json').toString())
const fx = parse(read('validation/fixtures/bridgewater_anchor_v2.yaml').toString())
const weather = await parseEpw(new Uint8Array(read(path.join('data/weather/current', fx.building_config.weather_file))))
const five = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: weather.sha256 }, building_id: 'bridgewater-anchor',
}, { zoning: 'per_storey' })).document as any
const lib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((x: any) => [x.name, x.config_json]))
five.profiles.push({ id: 'hours', kind: 'schedule', day_types: SB.hours })
for (const z of five.zones) { z.setpoints.hours_ref = 'hours'; z.setpoints.setback_c = SB.bridgewater.setback_c }
const doc = ModelDocument.parse(five)

const weekdays = Array.from({ length: 31 }, (_, d) => d).filter((d) => d % 7 < 5 && d > 0)
const at = (tz: ArrayLike<number>, hour: number) => weekdays.reduce((s, d) => s + tz[d * 24 + hour], 0) / weekdays.length
const r2 = (x: number) => +x.toFixed(2)
const rows: Record<string, Record<string, { t18: number; t06: number; drop: number }>> = {}
const put = (name: string, zone: string, tz: ArrayLike<number>) => {
  rows[name] ??= {}
  rows[name][zone] = { t18: r2(at(tz, 18)), t06: r2(at(tz, 6)), drop: r2(at(tz, 18) - at(tz, 6)) }
}
const four = { steps_per_hour: 4, theta_e_between: 'linear' as const }
const variants = {
  'engine2, fixed convection by tilt': { ...RUN_OPTIONS, time_step: four },
  'engine2, TARP inside': { ...RUN_OPTIONS, time_step: four, surface_physics: { outside_convection: 'fixed' as const, inside_convection: 'tarp' as const, beam_on_floor: true } },
}
for (const [name, o] of Object.entries(variants)) {
  const r = runModel(doc, weather, lib, o)
  r.zones.forEach((z, i) => put(name, `Floor_${i + 1}`, z.hourly.theta_air_c))
}
for (const v of ['default', 'iso_conv']) {
  const ep = JSON.parse(read(`docs/audit/109/02_bridgewater_${v}_energyplus.json`).toString())
  for (const [z, x] of Object.entries<any>(ep.runs.EulerMethod.zones)) put(`energyplus, ${v === 'default' ? 'its own convection' : 'the engine\'s fixed convection'}`, z, x.tz_jan)
}
writeFileSync(path.join(root, 'docs/audit/109/05_overnight.json'), JSON.stringify({ source: 'scripts/109_overnight.mts', weekday_mornings_january: weekdays.length, rows }, null, 1) + '\n')
for (const [n, zs] of Object.entries(rows)) console.log(n.padEnd(48), Object.entries(zs).map(([z, v]) => `${z.slice(-1)}: ${v.t18}→${v.t06} (${v.drop})`).join('  '))
