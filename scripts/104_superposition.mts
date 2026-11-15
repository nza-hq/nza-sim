/**
 * Brief 104 Part 1 instrumentation: Engine 1 at a constant 22 °C setpoint with drivers switched off, the twin of
 * validation/energyplus/104_superposition.py. Prints annual sums and compares hour by hour with the EnergyPlus runs in
 * the directory given as the first argument (each <name>/net_w.json). Run from frontend/:
 *   npx vite-node ../scripts/104_superposition.mts <runs dir>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { ENGINE_CONSTANTS, parseEpw, REFEREE_OPTIONS, runZoneModel } from '../frontend/src/thermal/engine/index'

// Diagnostic overrides of engine constants, by environment variable only, printed when used (never in a gate).
// K_<constant>=<value>, e.g. K_solar_convective_fraction=0.
for (const [env, v] of Object.entries(process.env)) {
  if (!env.startsWith('K_')) continue
  const key = env.slice(2)
  if (!(key in ENGINE_CONSTANTS)) throw new Error(`no engine constant ${key}`)
  ;(ENGINE_CONSTANTS as any)[key] = Number(v); console.log(`DIAGNOSTIC: ${key} = ${v}`)
}

const root = path.resolve(__dirname, '..')
const runs = process.argv[2]
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/report_baseline_v1.yaml'), 'utf8'))
const epwPath = path.join(root, 'data/weather/current', fx.building_config.weather_file)
const weather = await parseEpw(new Uint8Array(readFileSync(epwPath)))
const lib = Object.fromEntries(fx.library_constructions.map((c: any) => [c.name, c.config_json]))
const { document: base } = await fromBuildingConfig({
  building_config: fx.building_config, construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: path.basename(epwPath), file_hash: weather.sha256 },
  building_id: 'bridgewater-anchor',
})
const variants: Record<string, (d: any) => void> = {
  all: () => {},
  win_dark: (d) => { for (const s of d.surfaces) if (s.kind === 'glazing') s.construction_ref = { ...s.construction_ref, g_value_override: 1e-4 } },
  opaque_dark: (d) => { for (const s of d.surfaces) if (s.solar_absorptance != null) s.solar_absorptance = 0 },
  both_dark: (d) => { variants.win_dark(d); variants.opaque_dark(d) },
}
const out: Record<string, number[]> = {}
const mwh = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0) / 1e6
for (const [name, f] of Object.entries(variants)) {
  const d = structuredClone(base) as any
  d.zones[0].setpoints = { ...d.zones[0].setpoints, heat_c: 22, cool_c: 22 }
  f(d)
  const r = runZoneModel(d, weather, lib, REFEREE_OPTIONS)
  const net = Array.from(r.hourly.cooling_w, (c, h) => c - r.hourly.heating_w[h])
  out[name] = net
  let line = `${name.padEnd(12)} E1 heat ${mwh(r.hourly.heating_w).toFixed(3)} cool ${mwh(r.hourly.cooling_w).toFixed(3)} net ${mwh(net).toFixed(3)}`
  const f2 = path.join(runs, name, 'net_w.json')
  if (existsSync(f2)) {
    const ep: number[] = JSON.parse(readFileSync(f2, 'utf8'))
    const diff = net.map((v, h) => v - ep[h])
    const rms = Math.sqrt(diff.reduce((s, v) => s + v * v, 0) / diff.length)
    // Mean diurnal profile of the difference in July, kW.
    const jul = Array(24).fill(0), n = Array(24).fill(0)
    for (let h = 0; h < diff.length; h++) if (weather.hours.month[h] === 7) { jul[weather.hours.hour[h] - 1] += diff[h]; n[weather.hours.hour[h] - 1]++ }
    const monthly = Array(12).fill(0)
    for (let h = 0; h < diff.length; h++) monthly[weather.hours.month[h] - 1] += diff[h] / 1e6
    line += ` | EP net ${mwh(ep).toFixed(3)} | E1-EP net ${mwh(diff).toFixed(3)} MWh, rms ${(rms / 1000).toFixed(1)} kW`
    line += `\n   monthly E1-EP net MWh ${monthly.map((v) => v.toFixed(2)).join(' ')}`
    line += `\n   July E1-EP by hour kW ${jul.map((v, i) => (v / n[i] / 1000).toFixed(1)).join(' ')}`
  }
  console.log(line)
}
writeFileSync(path.join(runs, 'e1_net_w.json'), JSON.stringify(out))
