/**
 * Brief 103 Part 6: the Bridgewater envelope.
 *   Table 1, gate (a): each path's conductance (W/K) and annual loss at the setpoint convention, today's State 1
 *     against Engine 1, within 1 %.
 *   Table 2, gate (b): annual and monthly heating and cooling, the EnergyPlus referee (Part 5) against Engine 1,
 *     within ±10 %. State 1 is an information column.
 *
 * Run from frontend/:  npx vite-node ../scripts/103_anchor_envelope.mts
 * (vite-node, not node, because the engine is TypeScript with extensionless imports; the brief named a .mjs.)
 * Needs the anchor EPW in data/weather/current (local data, checked by sha). Writes docs/audit/103/06_anchor_envelope.json.
 *
 * State 1's conductances are not in its result, so they are read back from its own outputs: each path's annual
 * heating loss at the setpoint divided by that path's driving degree-hours under State 1's stated convention
 * (instantCalc.js losses_at_setpoint: sol-air for walls and roof, T_out for glazing, leakage, vents and bridging,
 * T_ground for the floor; vents weighted by the hourly wind speed). Bridging's H_TB is also printed as State 1 reports it.
 * Engine 1's setpoint losses use its OWN conductances and its own solar (solarOnSurface, which equals today's
 * solarCalc to Float32) under the same convention, so gate (a) is algebra on the two engines' inputs.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
// @ts-expect-error plain JS module
import { calculateInstant } from '../frontend/src/utils/instantCalc.js'
// @ts-expect-error plain JS module
import { computeHourlySolarByFacade } from '../frontend/src/utils/solarCalc.js'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import {
  ENGINE_CONSTANTS as K, parseEpw, readZoneConductances, readZoneCoolingKwh, readZoneHeatingKwh, readZoneHourlyCoolingW,
  readZoneHourlyHeatingW, readZoneTermKwh, readZoneBreakdown, REFEREE_OPTIONS, runZoneModel, solarOnSurface,
} from '../frontend/src/thermal/engine/index'

const root = path.resolve(__dirname, '..')
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const load = (p: string) => parse(readFileSync(path.join(root, p), 'utf8'))
const fx = load('validation/fixtures/bridgewater_anchor_v2.yaml')
const fxReport = load('validation/fixtures/report_baseline_v1.yaml')
const referee = JSON.parse(readFileSync(path.join(root, 'validation/energyplus/results/103_referee_fabric_only.json'), 'utf8'))
const r0 = referee.variants.r0

// ── The two fixtures carry the same envelope (State 1 was measured on anchor_v2, the referee built report_baseline_v1).
const ENVELOPE_KEYS = ['length', 'width', 'num_floors', 'floor_height', 'orientation', 'wwr', 'openings', 'thermal_bridges',
  'fabric', 'infiltration_ach', 'shading_fin', 'shading_overhang', 'weather_file', 'thermal_mass_category', 'thermal_mass_mode']
const pick = (f: any) => ({
  bc: Object.fromEntries(ENVELOPE_KEYS.map((k) => [k, f.building_config[k]])), cc: f.construction_choices, cb: f.comfort_band,
  lib: Object.values(f.construction_choices).map((n) => f.library_constructions.find((c: any) => c.name === n)),
})
const sameEnvelope = JSON.stringify(pick(fx)) === JSON.stringify(pick(fxReport))
if (!sameEnvelope) throw new Error('anchor_v2 and report_baseline_v1 envelopes differ')

// ── Weather: Engine 1's parser, and today's Float32 arrays for State 1.
const epwPath = path.join(root, 'data/weather/current', fx.building_config.weather_file)
const epwBytes = new Uint8Array(readFileSync(epwPath))
const weather = await parseEpw(epwBytes)
if (weather.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const N = weather.hours.count
const legacy: any = {
  temperature: Float32Array.from(weather.hours.dry_bulb), direct_normal: Float32Array.from(weather.hours.direct_normal),
  diffuse_horizontal: Float32Array.from(weather.hours.diffuse_horizontal), wind_speed: Float32Array.from(weather.hours.wind_speed),
  month: weather.hours.month, day: weather.hours.day, hour: weather.hours.hour,
}
const b = fx.building_config
const hourlySolar = computeHourlySolarByFacade(legacy, weather.header.latitude, b.orientation ?? 0)

// ── State 1 (today's envelope-only engine).
const libraryData = {
  constructions: fx.library_constructions.map((c: any) => ({
    name: c.name, u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
    y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0, g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers,
  })),
  system_templates: [], library_systems: [], library_schedules: [],
}
const s1: any = calculateInstant(b, fx.construction_choices, {}, libraryData, legacy, hourlySolar, null,
  { comfortBand: fx.comfort_band, mode: 'envelope-only', _skipInterventions: true })
const las = s1.losses_at_setpoint

// ── Engine 1.
const { document: doc } = await fromBuildingConfig({
  building_config: fx.building_config, construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: path.basename(epwPath), file_hash: EPW_SHA },
  building_id: 'bridgewater-anchor',
})
const lib = Object.fromEntries(fx.library_constructions.map((c: any) => [c.name, c.config_json]))
const e1 = runZoneModel(doc, weather, lib, REFEREE_OPTIONS)
const cond = readZoneConductances(e1)
const { document: docReport } = await fromBuildingConfig({
  building_config: fxReport.building_config, construction_choices: fxReport.construction_choices, comfort_band: fxReport.comfort_band,
  library_constructions: fxReport.library_constructions, weather: { file_name: path.basename(epwPath), file_hash: EPW_SHA },
  building_id: 'bridgewater-anchor',
})
const e1Report = runZoneModel(docReport, weather, Object.fromEntries(fxReport.library_constructions.map((c: any) => [c.name, c.config_json])), REFEREE_OPTIONS)
if (readZoneHeatingKwh(e1Report) !== readZoneHeatingKwh(e1) || readZoneCoolingKwh(e1Report) !== readZoneCoolingKwh(e1)) {
  throw new Error('Engine 1 differs between anchor_v2 and report_baseline_v1')
}

// ── Drivers under State 1's setpoint convention.
const T_HEAT = fx.comfort_band.lower_c, T_COOL = fx.comfort_band.upper_c, H_OUT = 25 // instantCalc.js extWallModel/roofModel h_out
const tOut = legacy.temperature as Float32Array
let tSum = 0; for (let h = 0; h < N; h++) tSum += tOut[h]
const tGround = tSum / N
const dh = (f: (h: number) => number) => { let hs = 0, cs = 0; for (let h = 0; h < N; h++) { const t = f(h); hs += Math.max(0, T_HEAT - t); cs += Math.max(0, t - T_COOL) } return { heat: hs, cool: cs } }
const parity = { albedo: 0.2, sun_day: 'mid_month' as const, solar_time: 'clock' as const }
const surf = (id: string) => doc.surfaces.find((s) => s.id === id)!
const solAirDH = (id: string) => {
  const s = surf(id)
  const I = solarOnSurface(weather, s.azimuth_deg ?? 0, s.tilt_deg, parity).total
  return dh((h) => tOut[h] + (s.solar_absorptance! * Math.fround(I[h])) / H_OUT)
}
const outDH = dh((h) => tOut[h])
let windHeat = 0, windCool = 0
for (let h = 0; h < N; h++) { const v = legacy.wind_speed[h]; windHeat += v * Math.max(0, T_HEAT - tOut[h]); windCool += v * Math.max(0, tOut[h] - T_COOL) }
const groundDH = { heat: N * Math.max(0, T_HEAT - tGround), cool: N * Math.max(0, tGround - T_COOL) }

const hOf = (id: string) => cond.elements.find((e) => e.surface_id === id)!.h_w_per_k
const faces = [['north', 'F1'], ['east', 'F2'], ['south', 'F3'], ['west', 'F4']] as const
type Row = { path: string; s1_w_per_k: number; e1_w_per_k: number; s1_heat_kwh: number; e1_heat_kwh: number; s1_cool_kwh: number; e1_cool_kwh: number; note?: string }
const rows: Row[] = []
const add = (r: Row) => rows.push(r)

// External walls, per face, summed.
{
  let s1H = 0, e1H = 0, e1Heat = 0, e1Cool = 0, s1Heat = 0, s1Cool = 0
  for (const [f, F] of faces) {
    const d = solAirDH(`wall_${f}`)
    const lf = las.external_wall.by_face[F]
    s1H += lf.heating_loss_kwh * 1000 / d.heat
    s1Heat += lf.heating_loss_kwh; s1Cool += lf.cooling_gain_kwh
    e1H += hOf(`wall_${f}`); e1Heat += hOf(`wall_${f}`) * d.heat / 1000; e1Cool += hOf(`wall_${f}`) * d.cool / 1000
  }
  add({ path: 'external walls (sol-air)', s1_w_per_k: s1H, e1_w_per_k: e1H, s1_heat_kwh: s1Heat, e1_heat_kwh: e1Heat, s1_cool_kwh: s1Cool, e1_cool_kwh: e1Cool })
}
{
  const d = solAirDH('roof')
  add({ path: 'roof (sol-air)', s1_w_per_k: las.roof.heating_loss_kwh * 1000 / d.heat, e1_w_per_k: hOf('roof'),
    s1_heat_kwh: las.roof.heating_loss_kwh, e1_heat_kwh: hOf('roof') * d.heat / 1000, s1_cool_kwh: las.roof.cooling_gain_kwh, e1_cool_kwh: hOf('roof') * d.cool / 1000 })
}
add({ path: 'ground floor (T_ground)', s1_w_per_k: las.ground_floor.heating_loss_kwh * 1000 / groundDH.heat, e1_w_per_k: hOf('ground'),
  s1_heat_kwh: las.ground_floor.heating_loss_kwh, e1_heat_kwh: hOf('ground') * groundDH.heat / 1000, s1_cool_kwh: las.ground_floor.cooling_gain_kwh, e1_cool_kwh: hOf('ground') * groundDH.cool / 1000 })
{
  let s1H = 0, e1H = 0
  for (const [f, F] of faces) { s1H += las.glazing.by_face[F].heating_loss_kwh * 1000 / outDH.heat; e1H += hOf(`glazing_${f}`) }
  add({ path: 'glazing (T_out)', s1_w_per_k: s1H, e1_w_per_k: e1H, s1_heat_kwh: las.glazing.heating_loss_kwh, e1_heat_kwh: e1H * outDH.heat / 1000,
    s1_cool_kwh: las.glazing.cooling_gain_kwh, e1_cool_kwh: e1H * outDH.cool / 1000 })
}
add({ path: 'fabric leakage (q50 / 20)', s1_w_per_k: las.fabric_leakage.heating_loss_kwh * 1000 / outDH.heat, e1_w_per_k: cond.infiltration.h_w_per_k,
  s1_heat_kwh: las.fabric_leakage.heating_loss_kwh, e1_heat_kwh: cond.infiltration.h_w_per_k * outDH.heat / 1000,
  s1_cool_kwh: las.fabric_leakage.cooling_gain_kwh, e1_cool_kwh: cond.infiltration.h_w_per_k * outDH.cool / 1000 })
{
  const kE1 = cond.vents.reduce((s, v) => s + v.m3s_per_ms, 0) * K.rho_c_air // W/K per m/s
  const kS1 = las.permanent_vents.heating_loss_kwh * 1000 / windHeat
  add({ path: 'permanent vents (W/K per m/s of wind)', s1_w_per_k: kS1, e1_w_per_k: kE1, s1_heat_kwh: las.permanent_vents.heating_loss_kwh,
    e1_heat_kwh: kE1 * windHeat / 1000, s1_cool_kwh: las.permanent_vents.cooling_gain_kwh, e1_cool_kwh: kE1 * windCool / 1000 })
}
add({ path: 'thermal bridging (T_out)', s1_w_per_k: las.thermal_bridging.total_H_TB_W_per_K, e1_w_per_k: cond.bridging.total_w_per_k,
  s1_heat_kwh: las.thermal_bridging.heating_loss_kwh, e1_heat_kwh: cond.bridging.total_w_per_k * outDH.heat / 1000,
  s1_cool_kwh: las.thermal_bridging.cooling_gain_kwh, e1_cool_kwh: cond.bridging.total_w_per_k * outDH.cool / 1000,
  note: `State 1's own loss ÷ degree-hours gives ${(las.thermal_bridging.heating_loss_kwh * 1000 / outDH.heat).toFixed(3)} W/K` })

// Transmitted solar: Engine 1 as run (REFEREE_OPTIONS), and with today's sun convention, and without F_W.
const solarRun = readZoneTermKwh(e1, 'solar_transmitted')
const e1Parity = runZoneModel(doc, weather, lib, { ...REFEREE_OPTIONS, solar: parity })
const solarParity = readZoneTermKwh(e1Parity, 'solar_transmitted')
const solarS1 = las.glazing.solar_transmission_kwh

const pct = (a: number, b: number) => (100 * (a - b)) / b
const fmt = (v: number, d = 1) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d })
const ok1 = (a: number, b: number) => (b === 0 ? Math.abs(a) < 0.05 : Math.abs(pct(a, b)) <= 1)

const lines: string[] = []
lines.push('Table 1, gate (a): State 1 against Engine 1, per path (heating and cooling losses at 21 / 24 °C)', '')
lines.push('| Path | State 1 W/K | Engine 1 W/K | Δ % | State 1 heat kWh | Engine 1 heat kWh | Δ % | State 1 cool kWh | Engine 1 cool kWh | Within 1 % |')
lines.push('|---|---|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  const pass = ok1(r.e1_w_per_k, r.s1_w_per_k) && ok1(r.e1_heat_kwh, r.s1_heat_kwh) && ok1(r.e1_cool_kwh, r.s1_cool_kwh)
  lines.push(`| ${r.path} | ${fmt(r.s1_w_per_k, 3)} | ${fmt(r.e1_w_per_k, 3)} | ${pct(r.e1_w_per_k, r.s1_w_per_k).toFixed(3)} | ${fmt(r.s1_heat_kwh)} | ${fmt(r.e1_heat_kwh)} | ${pct(r.e1_heat_kwh, r.s1_heat_kwh).toFixed(3)} | ${fmt(r.s1_cool_kwh)} | ${fmt(r.e1_cool_kwh)} | ${pass ? 'yes' : '**no**'} |`)
}
lines.push(`| transmitted solar, kWh | ${fmt(solarS1)} | ${fmt(solarRun)} as run | ${pct(solarRun, solarS1).toFixed(2)} | | | | | | ${ok1(solarRun, solarS1) ? 'yes' : '**no**'} |`)
lines.push(`| transmitted solar, today's sun convention ÷ F_W ${K.glazing_angle_factor} | ${fmt(solarS1)} | ${fmt(solarParity / K.glazing_angle_factor)} | ${pct(solarParity / K.glazing_angle_factor, solarS1).toFixed(3)} | | | | | | ${ok1(solarParity / K.glazing_angle_factor, solarS1) ? 'yes' : '**no**'} |`)
lines.push('', `Bridging note: ${rows.find((r) => r.path.startsWith('thermal'))!.note}`, '')

// ── Table 2, gate (b).
const monthly = (w: Float64Array) => { const m = new Array(12).fill(0); for (let h = 0; h < N; h++) m[weather.hours.month[h] - 1] += w[h] / 1e6; return m }
const e1HeatM = monthly(readZoneHourlyHeatingW(e1)), e1CoolM = monthly(readZoneHourlyCoolingW(e1))
const e1Heat = readZoneHeatingKwh(e1) / 1000, e1Cool = readZoneCoolingKwh(e1) / 1000
lines.push('Table 2, gate (b): EnergyPlus referee (Part 5, r0) against Engine 1, MWh', '')
lines.push('| | Referee | Engine 1 | Δ % | Within ±10 % | State 1 (information) |', '|---|---|---|---|---|---|')
lines.push(`| Heating | ${r0.heating_mwh.toFixed(2)} | ${e1Heat.toFixed(2)} | ${pct(e1Heat, r0.heating_mwh).toFixed(1)} | ${Math.abs(pct(e1Heat, r0.heating_mwh)) <= 10 ? 'yes' : '**no**'} | ${s1.demand.heating_demand_mwh} |`)
lines.push(`| Cooling | ${r0.cooling_mwh.toFixed(2)} | ${e1Cool.toFixed(2)} | ${pct(e1Cool, r0.cooling_mwh).toFixed(1)} | ${Math.abs(pct(e1Cool, r0.cooling_mwh)) <= 10 ? 'yes' : '**no**'} | ${s1.demand.cooling_demand_mwh} |`)
lines.push('', '| Month | Referee heat | Engine 1 heat | Referee cool | Engine 1 cool |', '|---|---|---|---|---|')
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
for (let m = 0; m < 12; m++) lines.push(`| ${MON[m]} | ${r0.heating_monthly_mwh[m].toFixed(2)} | ${e1HeatM[m].toFixed(2)} | ${r0.cooling_monthly_mwh[m].toFixed(2)} | ${e1CoolM[m].toFixed(2)} |`)

// Breakdown terms side by side (information for the diagnosis).
const bd = readZoneBreakdown(e1)
const termBy = (term: string, pred: (id: string | null) => boolean = () => true) => bd.filter((l) => l.term === term && pred(l.surface_id)).reduce((s, l) => s + l.kwh, 0) / 1000
const e1Terms = {
  conduction_walls: termBy('conduction', (id) => !!id?.startsWith('wall_')), conduction_roof: termBy('conduction', (id) => id === 'roof'),
  conduction_ground: termBy('conduction', (id) => id === 'ground'), conduction_glazing: termBy('conduction', (id) => !!id?.startsWith('glazing_')),
  opaque_solar_absorbed: termBy('opaque_solar_absorbed'), sky_longwave: termBy('sky_longwave'), bridging: termBy('bridging'),
  infiltration: termBy('infiltration'), permanent_vents: termBy('permanent_vents'), solar_transmitted: termBy('solar_transmitted'), storage: termBy('storage'),
}
lines.push('', 'Engine 1 breakdown, MWh (positive = into the zone):', '', ...Object.entries(e1Terms).map(([k, v]) => `- ${k}: ${v.toFixed(3)}`))
lines.push('', `Referee terms, MWh: ${JSON.stringify({ inside_face_conduction_net: r0.inside_face_conduction_net_mwh, window_heat: r0.window_heat_mwh, window_transmitted_solar: r0.window_transmitted_solar_mwh, infiltration: r0.infiltration_mwh, permanent_vents: r0.permanent_vents_mwh })}`)
console.log(lines.join('\n'))

writeFileSync(path.join(root, 'docs/audit/103/06_anchor_envelope.json'), JSON.stringify({
  brief: '103 Part 6', fixtures: ['validation/fixtures/bridgewater_anchor_v2.yaml', 'validation/fixtures/report_baseline_v1.yaml'], same_envelope: sameEnvelope,
  weather_sha256: EPW_SHA, options: REFEREE_OPTIONS, t_ground_c: tGround,
  gate_a: rows, transmitted_solar_kwh: { state1: solarS1, engine1_as_run: solarRun, engine1_today_sun: solarParity, f_w: K.glazing_angle_factor },
  gate_b: { referee: { heating_mwh: r0.heating_mwh, cooling_mwh: r0.cooling_mwh, heating_monthly_mwh: r0.heating_monthly_mwh, cooling_monthly_mwh: r0.cooling_monthly_mwh },
    engine1: { heating_mwh: e1Heat, cooling_mwh: e1Cool, heating_monthly_mwh: e1HeatM, cooling_monthly_mwh: e1CoolM, closure_max_wh: e1.closure.max_wh },
    state1_information: s1.demand },
  engine1_breakdown_mwh: e1Terms,
}, null, 1) + '\n')
