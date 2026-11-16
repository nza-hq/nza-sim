/**
 * Brief 109 Part 2: Engine 2 with office hours and a night setback against EnergyPlus: the cooled room (three cases)
 * and Bridgewater as five storeys, each at 1 and 4 steps an hour.
 *
 * Run from frontend/:  npx vite-node ../scripts/109_setback.mts
 * Reads docs/audit/109/02_cooled_room_energyplus.json (validation/energyplus/109_setback_referee.py),
 * docs/audit/109/02_bridgewater_energyplus.json (validation/energyplus/109_bridgewater_setback.py) and the spec
 * (validation/energyplus/109_setback_spec.json). Each case's limits are an all-convective fixed-output emitter (108 P3).
 * EnergyPlus's figures are the heat that entered the zone air, under both its zone air schemes; the gate is the
 * spec's, read against EulerMethod (the engines' own first-order step). Writes docs/audit/109/02_referee.json.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import { REFEREE_OPTIONS, runModel, zoneSetpointHours } from '../frontend/src/thermal/engine/model'
import { cooledRoomDocument } from '../frontend/src/thermal/engine/__tests__/cooledRoom'
import { MOS, readMos } from '../frontend/src/thermal/engine/__tests__/denver'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { parseEpw } from '../frontend/src/thermal/engine/index'
import { RUN_OPTIONS } from '../frontend/src/sim2/run/seam'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const SB = JSON.parse(read('validation/energyplus/109_setback_spec.json').toString())
const EP = JSON.parse(read('docs/audit/109/02_cooled_room_energyplus.json').toString())
if (EP.setback_spec_sha256 !== sha(read('validation/energyplus/109_setback_spec.json'))) throw new Error('EnergyPlus results are of another setback spec')
const W = readMos(readFileSync(MOS))

export function summarise(heat: ArrayLike<number>, t: ArrayLike<number>, sp: ArrayLike<number>, use: ArrayLike<number>, weekday: (d: number) => boolean, tol: number) {
  const wd = Array.from({ length: 365 }, (_, d) => d).filter(weekday)
  let unmet = 0, unmetUse = 0, mn = Infinity, mnUse = Infinity, tot = 0, peak = 0
  for (let h = 0; h < 8760; h++) {
    tot += heat[h]; peak = Math.max(peak, heat[h]); mn = Math.min(mn, t[h])
    if (use[h]) mnUse = Math.min(mnUse, t[h])
    if (t[h] < sp[h] - tol) { unmet++; if (use[h]) unmetUse++ }
  }
  const prof = Array.from({ length: 24 }, (_, i) => wd.reduce((s, d) => s + heat[d * 24 + i], 0) / wd.length)
  const morning = wd.reduce((s, d) => { let m = 0; for (let i = 0; i < 24; i++) m = Math.max(m, heat[d * 24 + i]); return s + m }, 0) / wd.length
  return { heat_mwh: tot / 1e6, peak_w: peak, unmet_hours: unmet, unmet_hours_in_use: unmetUse, min_c: mn, min_in_use_c: mnUse, weekday_morning_peak_w: morning, weekday_profile_w: prof }
}
export type Summary = ReturnType<typeof summarise>

/** The spec's gate, each line with its numbers. */
export function gate(e: Summary, p: Summary) {
  const dPeak = Math.max(...p.weekday_profile_w)
  const prof = Math.max(...e.weekday_profile_w.map((v, i) => Math.abs(v - p.weekday_profile_w[i]))) / dPeak
  const du = Math.abs(e.unmet_hours_in_use - p.unmet_hours_in_use)
  const lines = {
    heating_pct: +((e.heat_mwh / p.heat_mwh - 1) * 100).toFixed(1),
    morning_peak_pct: +((e.weekday_morning_peak_w / p.weekday_morning_peak_w - 1) * 100).toFixed(1),
    unmet_in_use_diff_h: e.unmet_hours_in_use - p.unmet_hours_in_use,
    min_in_use_diff_k: +(e.min_in_use_c - p.min_in_use_c).toFixed(2),
    profile_worst_pct_of_peak: +(prof * 100).toFixed(1),
  }
  const pass = {
    heating: Math.abs(lines.heating_pct) <= 10, morning_peak: Math.abs(lines.morning_peak_pct) <= 15,
    unmet_in_use: du <= 50 || du / Math.max(p.unmet_hours_in_use, 1) <= 0.2, min_in_use: Math.abs(lines.min_in_use_diff_k) <= 1, profile: prof <= 0.15,
  }
  return { ...lines, pass, all: Object.values(pass).every(Boolean) }
}

const r3 = (o: Record<string, any>): Record<string, any> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => +x.toFixed(1)) : v && typeof v === 'object' ? r3(v) : +(+v).toFixed(3)]))
// The product runs one step an hour; EnergyPlus runs four, and its hourly air temperature is the mean of its steps.
// Both are compared: four steps an hour is like for like (as Brief 105 found for the per-floor referee).
const out: Record<string, unknown> = {}
// EnergyPlus under its default zone air scheme (third order) and under Euler, the engines' own first-order step.
const ALGS = ['EulerMethod', 'ThirdOrderBackwardDifference'] as const
for (const steps of [1, 4]) for (const [name, caps] of Object.entries<Record<string, number> | null>(SB.cooled_room.cases)) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  d.profiles.push({ id: 'hours', kind: 'schedule', day_types: SB.hours })
  for (const z of d.zones) { z.setpoints.hours_ref = 'hours'; if (z.setpoints.heat_c != null) z.setpoints.setback_c = SB.cooled_room.setback_c }
  if (caps) for (const z of d.zones) if (caps[z.id]) z.emitters = [{ id: `${z.id}_e`, kind: 'electric', count: 1, rated_output_w: caps[z.id], radiant_fraction: 0, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
  const m = ModelDocument.parse(d)
  const r = runModel(m, W, lib, steps === 1 ? REFEREE_OPTIONS : { ...REFEREE_OPTIONS, time_step: { steps_per_hour: steps, theta_e_between: 'linear' } })
  const sh = zoneSetpointHours(m, W.hours)
  const rooms: Record<string, unknown> = {}
  r.zones.forEach((z, zi) => {
    const p = EP.runs.EulerMethod[name].zones[z.zone_id]
    if (z.zone_id === 'middle') {
      let outside = 0
      for (let h = 0; h < 8760; h++) if (Number.isNaN(sh[zi]!.hourly.cool_c[h])) outside += z.hourly.cooling_w[h]
      rooms.middle = { engine2: { cool_mwh: +(z.annual.cooling_kwh / 1000).toFixed(3), cooling_outside_hours_wh: outside }, energyplus: { cool_mwh: +p.cool_mwh.toFixed(3), cooling_outside_hours_wh: p.cooling_outside_hours_wh }, cooling_pct: +((z.annual.cooling_kwh / 1000 / p.cool_mwh - 1) * 100).toFixed(1) }
      return
    }
    const e = summarise(z.hourly.heating_w, z.hourly.theta_air_c, sh[zi]!.hourly.heat_c, sh[zi]!.in_use, (dd) => dd % 7 < 5, SB.unmet_tolerance_k)
    // The engine's own counts must equal this script's (one definition, Rule 11).
    if (e.unmet_hours_in_use !== z.annual.unmet_heating_hours_in_use || e.unmet_hours !== z.annual.unmet_heating_hours) throw new Error(`${z.zone_id}: counts differ from the engine's`)
    rooms[z.zone_id] = { engine2: r3(e), ...Object.fromEntries(ALGS.map((a) => [a, { energyplus: r3(EP.runs[a][name].zones[z.zone_id]), gate: gate(e, EP.runs[a][name].zones[z.zone_id]) }])), closure_max_wh: z.closure.max_wh }
  })
  out[`${name}, ${steps} step${steps > 1 ? 's' : ''} an hour`] = { caps, steps_per_hour: steps, rooms }
}
// ── Bridgewater, five storeys (Brief 105's gate referee), to the same hours with a 16 °C setback ───────────────────
const EPB = JSON.parse(read('docs/audit/109/02_bridgewater_energyplus.json').toString())
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
if (EPB.setback_spec_sha256 !== sha(read('validation/energyplus/109_setback_spec.json'))) throw new Error('Bridgewater EnergyPlus results are of another setback spec')
const fx = parse(read('validation/fixtures/bridgewater_anchor_v2.yaml').toString())
const weather = await parseEpw(new Uint8Array(read(path.join('data/weather/current', fx.building_config.weather_file))))
if (weather.sha256 !== EPW_SHA || EPB.epw_sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const five = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA }, building_id: 'bridgewater-anchor',
}, { zoning: 'per_storey' })).document as any
const blib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((x: any) => [x.name, x.config_json]))
five.profiles.push({ id: 'hours', kind: 'schedule', day_types: SB.hours })
for (const z of five.zones) {
  if (z.setpoints.heat_c !== SB.bridgewater.heat_c || z.setpoints.cool_c !== SB.bridgewater.cool_c) throw new Error(`${z.id}: setpoints ${z.setpoints.heat_c}/${z.setpoints.cool_c}, not the spec's`)
  z.setpoints.hours_ref = 'hours'; z.setpoints.setback_c = SB.bridgewater.setback_c
}
const bm = ModelDocument.parse(five)
const bsh = zoneSetpointHours(bm, weather.hours)
const bw: Record<string, unknown> = {}
for (const steps of [1, 4]) {
  const r = runModel(bm, weather, blib, steps === 1 ? RUN_OPTIONS : { ...RUN_OPTIONS, time_step: { steps_per_hour: steps, theta_e_between: 'linear' } })
  const storeys: Record<string, unknown> = {}
  let eh = 0, ph = 0
  r.zones.forEach((z, i) => {
    const ez = `Floor_${i + 1}`, p = EPB.runs.EulerMethod.zones[ez]
    const e = summarise(z.hourly.heating_w, z.hourly.theta_air_c, bsh[i]!.hourly.heat_c, bsh[i]!.in_use, (dd) => dd % 7 < 5, SB.unmet_tolerance_k)
    eh += e.heat_mwh; ph += p.heat_mwh
    storeys[ez] = { engine2: r3(e), ...Object.fromEntries(ALGS.map((a) => [a, { energyplus: r3(EPB.runs[a].zones[ez]), gate: gate(e, EPB.runs[a].zones[ez]) }])), cooling_pct: +((z.annual.cooling_kwh / 1000 / p.cool_mwh - 1) * 100).toFixed(1), closure_max_wh: z.closure.max_wh }
  })
  bw[`${steps} step${steps > 1 ? 's' : ''} an hour`] = { building_heating_pct: +((eh / ph - 1) * 100).toFixed(1), storeys, run_ms: +r.run_ms.toFixed(0) }
}
const res = { source: 'scripts/109_setback.mts', gate: SB.gate, cooled_room: out, bridgewater_five_storeys: bw }
writeFileSync(path.join(root, 'docs/audit/109/02_referee.json'), JSON.stringify(res, null, 1) + '\n')
for (const [n, c] of Object.entries<any>(out)) for (const [z, v] of Object.entries<any>(c.rooms)) for (const a of ALGS) if (v[a]) console.log(n, z, a.slice(0, 5), JSON.stringify(v[a].gate))
for (const [n, c] of Object.entries<any>(bw)) { console.log('BW', n, c.building_heating_pct, c.run_ms); for (const [z, v] of Object.entries<any>(c.storeys)) for (const a of ALGS) console.log('  ', z, a.slice(0, 5), JSON.stringify(v[a].gate), v.engine2.peak_w, v[a].energyplus.peak_w, v.cooling_pct) }
