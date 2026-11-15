/**
 * Brief 107 Part 2: v2 systems against today's systems path on Bridgewater.
 *
 * Run from frontend/:  npx vite-node ../scripts/107_gate.mts
 * Needs the anchor EPW in data/weather/current (checked by sha). Writes docs/audit/107/02_gate.json.
 *
 * (a) Path by path: today's calculateInstant (as _brief93_anchor.mjs --fixture) gives each end use. v2's runSystems
 *     is fed today's annual heating and cooling demand (flat over the hours; only the annual total enters an annual
 *     end use) on the converted one-zone document, with the gains' electricity and the fans from v2's own gains.ts and
 *     ventilation.ts on the anchor weather's calendar. Each end use must agree to today's rounding (1 kWh).
 * (b) On Engine 2's own demand (Bridgewater as five storeys, the editor's run options), the EUI against 133.2, with the
 *     difference attributed: each service's demand difference through its systems' shares and efficiencies.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { SYSTEM_TEMPLATES_LIBRARY } from '../frontend/src/data/systemTemplatesLibrary.js'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import {
  parseEpw, readBuildingCoolingKwh, readBuildingHeatingKwh, readEndUseKwh, readSystemsEui, runModel, runSystems,
  type ModelResults, type SystemsResults,
} from '../frontend/src/thermal/engine/index'
import { RUN_OPTIONS } from '../frontend/src/sim2/run/seam'

const root = path.resolve(__dirname, '..')
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const epwPath = path.join(root, 'data/weather/current', fx.building_config.weather_file)
const weather = await parseEpw(new Uint8Array(readFileSync(epwPath)))
if (weather.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')

// ── Today's path, as _brief93_anchor.mjs --fixture ─────────────────────────────────────────────────────────────
const building = structuredClone(fx.building_config)
const lines = readFileSync(epwPath, 'utf-8').split(/\r?\n/)
const latitude = parseFloat(lines[0].split(',')[6])
const data = lines.slice(8).filter((l) => l.trim().length > 0)
const N = data.length
const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
const temperature = new Float32Array(N), direct_normal = new Float32Array(N), diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
data.forEach((l, i) => {
  const p = l.split(',')
  month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
  temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14]); diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
})
const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
const libraryData = {
  constructions: (fx.library_constructions ?? []).map((c: any) => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K, y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
    g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: SYSTEM_TEMPLATES_LIBRARY, library_systems: building?.library_systems ?? [], library_schedules: building?.library_schedules ?? [],
}
const today: any = calculateInstant(
  building, fx.construction_choices, {}, libraryData, weatherData, computeHourlySolarByFacade(weatherData, latitude, building.orientation ?? 0), null,
  { comfortBand: { lower_c: fx.comfort_band?.lower_c ?? 20, upper_c: fx.comfort_band?.upper_c ?? 26 }, _skipInterventions: true, engine: 'v2.5' },
)
const c = today.consumption, b = c.brief40
const fuelOf = (sys: any[], fuel: string) => sys.filter((s) => s.source_fuel === fuel).reduce((a, s) => a + s.source_energy_mwh, 0)
const TODAY = {
  heating_electricity: fuelOf(b.heating.systems, 'electricity'),
  cooling_electricity: fuelOf(b.cooling.systems, 'electricity'),
  dhw_electricity: fuelOf(b.dhw.systems, 'electricity'),
  dhw_gas: fuelOf(b.dhw.systems, 'gas'),
  dhw_circulation: c.dhw.circulation_pump_mwh,
  fans: b.ventilation.total_fan_electrical_mwh,
  lighting: b.lighting.total_delivered_electrical_mwh,
  small_power: b.small_power.total_delivered_electrical_mwh,
  auxiliary: (today.heat_balance.annual.gains.internal.auxiliary.electricity_kwh ?? 0) / 1000,
  electricity: c.total.electricity_mwh, gas: c.total.gas_mwh, eui: c.total.kwh_per_m2_yr,
  heating_demand: c.space_heating.demand_mwh, cooling_demand: c.space_cooling.demand_mwh, dhw_demand: b.dhw.demand_at_comfort_mwh,
}

// ── v2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const convert = async (zoning?: 'per_storey') => ModelDocument.parse((await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA },
  building_id: 'bridgewater-anchor',
}, zoning ? { zoning } : {})).document)
const H = weather.hours.count
const endUses = (s: SystemsResults) => {
  const fuel = (u: string, f: string) => s.end_uses.filter((l) => l.end_use === u && l.fuel === f).reduce((a, l) => a + l.kwh, 0) / 1000
  return {
    heating_electricity: fuel('heating', 'electricity'), cooling_electricity: fuel('cooling', 'electricity'),
    dhw_electricity: fuel('dhw', 'electricity'), dhw_gas: fuel('dhw', 'gas'), dhw_circulation: readEndUseKwh(s, 'dhw_circulation') / 1000,
    fans: readEndUseKwh(s, 'fans') / 1000, lighting: readEndUseKwh(s, 'lighting') / 1000, small_power: readEndUseKwh(s, 'small_power') / 1000,
    auxiliary: readEndUseKwh(s, 'auxiliary') / 1000, electricity: s.by_fuel.electricity / 1000, gas: s.by_fuel.gas / 1000, eui: readSystemsEui(s),
    dhw_demand: (s.dhw?.demand_kwh ?? 0) / 1000,
  }
}
const sys = (doc: ModelDocument, r: ModelResults) => {
  const a = runSystems(doc, r, weather.hours)
  if (!a.ok) throw new Error(JSON.stringify(a.missing))
  return a.systems
}

// (a) today's demand, flat
const one = await convert()
const fed = { zones: [{ zone_id: one.zones[0].id, hourly: { heating_w: new Float64Array(H).fill((TODAY.heating_demand * 1e6) / H), cooling_w: new Float64Array(H).fill((TODAY.cooling_demand * 1e6) / H) } }] } as unknown as ModelResults
const A = endUses(sys(one, fed))
const pathByPath = Object.fromEntries(Object.keys(A).filter((k) => k in TODAY).map((k) => {
  const t = (TODAY as any)[k], v = (A as any)[k]
  return [k, { today: +t.toFixed(3), v2: +v.toFixed(3), diff_kwh: +((v - t) * (k === 'eui' ? 4216 : 1000)).toFixed(1) }]
}))

// (b) Engine 2's own demand, five storeys, the editor's run options
const lib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((x: any) => [x.name, x.config_json]))
const five = await convert('per_storey')
const r2 = runModel(five, weather, lib, RUN_OPTIONS)
const S2 = sys(five, r2)
const B = endUses(S2)
const heat2 = readBuildingHeatingKwh(r2) / 1000, cool2 = readBuildingCoolingKwh(r2) / 1000
const floor = S2.floor_m2
// Attribution: each service's demand difference through its groups' shares and efficiencies.
const perDemand = (service: string) => five.system_groups.filter((g) => g.enabled && g.service === service && g.share_pct > 0).reduce((a, g) => a + g.share_pct / 100 / g.efficiency_metric!, 0)
const attr = {
  heating_demand_mwh: { today: TODAY.heating_demand, engine2: +heat2.toFixed(3), eui: +(((heat2 - TODAY.heating_demand) * perDemand('heating') * 1000) / floor).toFixed(2) },
  cooling_demand_mwh: { today: TODAY.cooling_demand, engine2: +cool2.toFixed(3), eui: +(((cool2 - TODAY.cooling_demand) * perDemand('cooling') * 1000) / floor).toFixed(2) },
  everything_else_eui: +(B.eui - TODAY.eui - (((heat2 - TODAY.heating_demand) * perDemand('heating') + (cool2 - TODAY.cooling_demand) * perDemand('cooling')) * 1000) / floor).toFixed(2),
}
const out = {
  source: 'scripts/107_gate.mts', epw_sha256: EPW_SHA, floor_m2: floor,
  path_by_path: pathByPath,
  engine2_five_storeys: { end_uses: Object.fromEntries(Object.entries(B).map(([k, v]) => [k, +(+v).toFixed(3)])), eui: +B.eui.toFixed(2), today_eui: TODAY.eui, attribution: attr },
}
writeFileSync(path.join(root, 'docs/audit/107/02_gate.json'), JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
