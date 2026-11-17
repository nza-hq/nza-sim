/**
 * Brief 115: the two tests Linzie asked for on the community centre example (docs/examples/community_centre.plan.json),
 * run in our own engine through the product's path: the plan with the editor's Brief 115 inputs (Fabric window
 * opening and trickle vent, Site terrain, Controls window rules) → the editor's plan → document step → the run seam.
 *
 *   Test 1, windows open all winter: the windows open every hour, a quarter of their widest ("cracked") and fully
 *   ("wide"), against the same building with them shut. The heating fights the open windows (nothing shuts them).
 *   Test 2, passive cooling against a cooling system: the office and meeting room as designed (cooled, windows shut);
 *   with no cooling and windows that open above 22 °C in the hours the rooms are in use ("passive"); and both
 *   ("mixed mode"). The comms room has no windows and keeps its cooling in every case.
 *
 * Every run states: heating and cooling demand, gas and electricity, EUI, December to February heating, and for the
 * office, meeting room, café and hall the hours in use above 25 °C and 28 °C (operative) and the warmest hour in use.
 *
 * Inputs added to the plan (all stated here, none from a library default): site suburban; cracks' exponent 0.67;
 * single-sided turbulence off (EnergyPlus has no counterpart, so the referee can compare like with like); every window
 * type top-hung, 30 % of the glass opens, 20° (the editor's P6 trial), Cd 0.6, with a 4,000 mm² trickle vent (Cd 0.6);
 * heating hours, setbacks, design conditions and VRF outputs as the 120/P4 example run "B".
 *
 * Run from frontend/:  npx vite-node ../scripts/115_community_centre.mts <weather.epw> <out.json>
 * Weather: London Gatwick IWEC (not redistributable: never committed).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan } from '../frontend/src/sim2/geometry/plan'
import { weatherFromBytes } from '../frontend/src/sim2/run/weather'
import { simulate } from '../frontend/src/sim2/run/seam'
import { zoneSetpointHours } from '../frontend/src/thermal/engine/model'

const root = path.resolve(__dirname, '..')
const fx = JSON.parse(readFileSync(path.join(root, 'docs/examples/community_centre.plan.json'), 'utf8'))
const epw = process.argv[2]
const weather = await weatherFromBytes(new Uint8Array(readFileSync(epw)), path.basename(epw), 'local')

// ─── The plan with the Brief 115 inputs ────────────────────────────────────────────────────────────────────────────
type Rule = { rule: 'temperature' | 'timetable'; open_fraction: number; open_above_c: number | null }
function planWith(rule: Rule) {
  const plan: any = upgradePlan(structuredClone(fx.plan))
  plan.building = { ...plan.building, air_method: 'weather_driven', air_exponent: 0.67, single_sided_turbulence: false, terrain: 'suburban' }
  for (const t of plan.fabric_types) if (t.element === 'glazing') {
    t.opening = { style: 'top_hung', openable_fraction: 0.3, opening_angle_deg: 20, cd: 0.6 }
    t.trickle = { area_mm2: 4000, cd: 0.6, flow_mode: null }
  }
  for (const s of plan.spaces) s.windows = { ...rule, hours: null, controller: 'manual' }
  const built = buildDocument(plan)
  if (!built.ok) throw new Error(JSON.stringify(built.issues))
  return { doc: built.doc as any, notes: built.notes }
}

// ─── Run "B" of the 120/P4 example: heating hours, setbacks, design conditions, VRF outputs ────────────────────────
const hrs = (from: number, to: number) => Array.from({ length: 24 }, (_, h) => (h >= from && h < to ? 1 : 0))
const off = Array(24).fill(0)
const SCHEDULES = [
  { id: 'hours_office', kind: 'schedule', label: 'Office hours, Mon–Fri 07:00–18:00', day_types: { weekday: hrs(7, 18), saturday: off, sunday: off } },
  { id: 'hours_cafe', kind: 'schedule', label: 'Café hours, every day 08:00–18:00', day_types: { weekday: hrs(8, 18), saturday: hrs(8, 18), sunday: hrs(9, 17) } },
  { id: 'hours_hall', kind: 'schedule', label: 'Hall hours, every day 08:00–22:00', day_types: { weekday: hrs(8, 22), saturday: hrs(8, 22), sunday: hrs(9, 18) } },
]
const HOURS: Record<string, [string, number] | null> = {
  'Café': ['hours_cafe', 16], Kitchen: ['hours_cafe', 14], Reception: ['hours_office', 16], 'Open-plan office': ['hours_office', 16],
  'Meeting room': ['hours_office', 16], WCs: ['hours_office', 14], 'Main hall': ['hours_hall', 14], 'Comms room': null, Store: null,
}
function withB(doc0: any) {
  const d = structuredClone(doc0)
  d.profiles.push(...structuredClone(SCHEDULES))
  for (const z of d.zones) {
    const h = HOURS[z.name]
    if (h && z.setpoints.heat_c != null) { z.setpoints.hours_ref = h[0]; z.setpoints.setback_c = h[1] }
    z.design_internal_c = z.setpoints.heat_c != null ? 'follow_heat_c' : 18
    for (const e of z.emitters) if (e.kind === 'vrf_indoor') e.cooling_output_w = 3600
    if (z.name === 'Comms room') z.emitters.push({ id: 'z6_vrf_wall', label: 'VRF wall unit 2.2 kW (cooling only)', kind: 'vrf_indoor', count: 1, heats: false, cooling_output_w: 2200, rated_output_w: null, radiant_fraction: null, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null, source_surface_id: null, source_layer_index: null, catalogue_ref: null })
  }
  d.building.design = { outdoor: { from_weather: 'heating_99_6' }, warm_up_w_per_m2: null, vent_wind_m_s: null }
  return d
}
/** Windows may open only in the hours the room is in use (its heating hours), for the passive and mixed cases. */
function inUseHours(d: any) {
  for (const c of d.controls ?? []) if (c.target.kind === 'window') {
    const z = d.zones.find((x: any) => x.id === c.target.ref)
    c.hours_ref = HOURS[z.name]?.[0] ?? null
  }
}
/** No cooling in the office and meeting room: their cooling setpoints and the cooling systems' share of them go (Rule 8). */
function noCooling(d: any, names: string[]) {
  const ids = new Set(d.zones.filter((z: any) => names.includes(z.name)).map((z: any) => z.id))
  for (const z of d.zones) if (ids.has(z.id)) {
    z.setpoints.cool_c = null
    z.emitters = z.emitters.filter((e: any) => e.heats !== false).map((e: any) => (e.cooling_output_w != null ? { ...e, cooling_output_w: null } : e))
  }
  d.system_groups = d.system_groups.map((g: any) => g.service === 'cooling' ? { ...g, zones: g.zones.filter((z: string) => !ids.has(z)) } : g).filter((g: any) => g.service !== 'cooling' || g.zones.length)
}

// ─── Running and reading ───────────────────────────────────────────────────────────────────────────────────────────
const WATCH = ['Open-plan office', 'Meeting room', 'Café', 'Main hall']
const DJF = (m: number) => m === 12 || m === 1 || m === 2
function run(label: string, doc: any) {
  const r = simulate(doc, { weather, hourly: true })
  if (!r.ok) throw new Error(label + ': ' + JSON.stringify(r.missing))
  const s = r.summary, res = r.results
  if (!s.energy || !s.energy.ok) throw new Error(label + ': ' + JSON.stringify(s.energy))
  const H = weather.weather.hours
  const sp = zoneSetpointHours(doc, H)
  let djf = 0
  const bh = s.hourly!.heating_w
  for (let h = 0; h < H.count; h++) if (DJF(H.month[h])) djf += bh[h] / 1000
  const zones = res.zones.map((z, i) => {
    const name = doc.zones[i].name, inUse = sp[i]?.in_use ?? null
    const t = z.hourly.theta_operative_c
    let a25 = 0, a28 = 0, max = -Infinity, n = 0
    for (let h = 0; h < t.length; h++) if (!inUse || inUse[h]) { n++; if (t[h] > 25) a25++; if (t[h] > 28) a28++; if (t[h] > max) max = t[h] }
    const line = (term: string) => z.breakdown.filter((l) => l.term === term).reduce((a, l) => a + l.kwh, 0)
    return {
      name, heating_kwh: z.annual.heating_kwh, cooling_kwh: z.annual.cooling_kwh, in_use_hours: n, hours_above_25: a25, hours_above_28: a28, max_in_use_c: max,
      hours_windows_open: z.air?.hours_windows_open ?? null,
      air_kwh: { leakage: line('infiltration'), vents: line('permanent_vents'), windows: line('window_ventilation'), mechanical: line('mechanical_ventilation') },
    }
  })
  const fuel = Object.fromEntries(s.energy.by_fuel.map((f) => [f.fuel, f.kwh]))
  const out = {
    label, steps_per_hour: s.steps_per_hour, run_ms: Math.round(s.run_ms), floor_m2: s.building.floor_m2,
    heating_kwh: s.building.heating_kwh, cooling_kwh: s.building.cooling_kwh, heating_djf_kwh: djf, peak_heating_w: s.building.peak_heating_w,
    gas_kwh: fuel.gas ?? 0, electricity_kwh: fuel.electricity ?? 0, eui_kwh_per_m2: s.energy.eui_kwh_per_m2,
    zones: zones.filter((z) => WATCH.includes(z.name)),
    all_zones: zones,
  }
  console.log(`\n${label}  (${out.run_ms} ms, ${out.steps_per_hour}/h)  heat ${Math.round(out.heating_kwh)} kWh (Dec–Feb ${Math.round(djf)})  cool ${Math.round(out.cooling_kwh)}  gas ${Math.round(out.gas_kwh)}  elec ${Math.round(out.electricity_kwh)}  EUI ${out.eui_kwh_per_m2.toFixed(1)}`)
  for (const z of out.zones) console.log(`   ${z.name.padEnd(17)} heat ${Math.round(z.heating_kwh).toString().padStart(6)} cool ${Math.round(z.cooling_kwh).toString().padStart(5)}  >25 ${z.hours_above_25.toString().padStart(4)} h  >28 ${z.hours_above_28.toString().padStart(4)} h  max ${z.max_in_use_c.toFixed(1)}  open ${z.hours_windows_open} h  windows ${z.air_kwh.windows.toFixed(0)} kWh`)
  return out
}

const shut = withB(planWith({ rule: 'temperature', open_fraction: 0, open_above_c: 22 }).doc)
const cracked = withB(planWith({ rule: 'timetable', open_fraction: 0.25, open_above_c: null }).doc)
const wide = withB(planWith({ rule: 'timetable', open_fraction: 1, open_above_c: null }).doc)
const passive = withB(planWith({ rule: 'temperature', open_fraction: 1, open_above_c: 22 }).doc); inUseHours(passive); noCooling(passive, ['Open-plan office', 'Meeting room'])
const mixed = withB(planWith({ rule: 'temperature', open_fraction: 1, open_above_c: 22 }).doc); inUseHours(mixed)
const passiveNoCoolShut = withB(planWith({ rule: 'temperature', open_fraction: 0, open_above_c: 22 }).doc); noCooling(passiveNoCoolShut, ['Open-plan office', 'Meeting room'])

const R = {
  shut: run('0  Windows shut (baseline, weather-driven air)', shut),
  cracked: run('1a Windows open a quarter, every hour', cracked),
  wide: run('1b Windows wide open, every hour', wide),
  cooled: run('2a Office and meeting room cooled, windows shut (= 0)', shut),
  no_cooling_shut: run('2b No cooling, windows shut', passiveNoCoolShut),
  passive: run('2c No cooling, windows open above 22 °C in use', passive),
  mixed: run('2d Cooled and windows open above 22 °C in use', mixed),
}
const { notes } = planWith({ rule: 'temperature', open_fraction: 0, open_above_c: 22 })
writeFileSync(process.argv[3], JSON.stringify({ source: 'scripts/115_community_centre.mts', weather: { file: path.basename(epw), sha256: weather.sha256 }, notes, runs: R }, null, 1) + '\n')
