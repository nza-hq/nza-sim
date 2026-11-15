/**
 * Brief 105 Part 3, attribution only: Engine 2 on Bridgewater's five storeys with the air's heat capacity per m³ set,
 * in this process only, to EnergyPlus's standard-density value (1.2041 kg/m³ × 1004.84 J/kgK, dry air at 20 °C and
 * standard pressure) instead of today's 0.33 Wh/m³K (1188 J/m³K). It changes no engine file and no default: it
 * measures how much of the gap to the referee is the air heat capacity convention.
 *
 * Run from frontend/:  npx vite-node ../scripts/105_air_heat_capacity.mts
 * Writes docs/audit/105/03_air_heat_capacity.json. Needs the anchor EPW in data/weather/current.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { ENGINE_CONSTANTS as K, parseEpw, REFEREE_OPTIONS, runModel } from '../frontend/src/thermal/engine/index'
const root = path.resolve(__dirname, '..')
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const weather = await parseEpw(new Uint8Array(readFileSync(path.join(root, 'data/weather/current', fx.building_config.weather_file))))
const lib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((c: any) => [c.name, c.config_json]))
const doc = (await fromBuildingConfig({ building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band, library_constructions: fx.library_constructions, weather: { file_name: 'x', file_hash: null }, building_id: 'b' }, { zoning: 'per_storey' })).document
const rows: any[] = []
for (const rc of [1188, 1204.1 * 1.00484]) {
  ;(K as any).rho_c_air = rc
  for (const [g, v] of [[false, true], [true, true], [false, false]] as const) {
    const r = runModel(doc, weather, lib, { ...REFEREE_OPTIONS, internal_gains: g ? 'profiles' : 'none', ventilation: v ? 'document' : 'none' })
    const h = r.zones.reduce((s, z) => s + z.annual.heating_kwh, 0) / 1000, c = r.zones.reduce((s, z) => s + z.annual.cooling_kwh, 0) / 1000
    rows.push({ rho_c_j_per_m3k: rc, gains: g, ventilation: v, heating_mwh: h, cooling_mwh: c, zones: r.zones.map((z) => ({ id: z.zone_id, heating_mwh: z.annual.heating_kwh / 1000, cooling_mwh: z.annual.cooling_kwh / 1000 })) })
    console.log(rc.toFixed(1), g ? 'gains' : '     ', v ? 'vent' : '    ', h.toFixed(2), c.toFixed(2), r.zones.map((z) => (z.annual.heating_kwh / 1000).toFixed(2) + '/' + (z.annual.cooling_kwh / 1000).toFixed(2)).join(' '))
  }
}
writeFileSync(path.join(root, 'docs/audit/105/03_air_heat_capacity.json'), JSON.stringify({ source: 'scripts/105_air_heat_capacity.mts', rows }, null, 1) + '\n')
