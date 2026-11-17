/**
 * Brief 121 P3: the community centre's open-plan office heated to an IES-style setpoint profile, against run "B" of the
 * 120/P4 example (21 °C in office hours Mon–Fri 07:00–18:00, 16 °C set back outside them), through the run seam. Today's
 * fixed-method air (as run B); Gatwick weather (not committed).
 *
 *   B          heat_c 21, setback 16, hours_ref office hours (Brief 109's way)
 *   B_profile  the same as a profile (must equal B)
 *   early      a profile: 21 °C from 06:00 (an hour's pre-heat), 19 °C for the last hour (17:00–18:00), 16 °C otherwise
 *
 * Run from frontend/:  npx vite-node ../scripts/121_community_centre.mts <weather.epw> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan } from '../frontend/src/sim2/geometry/plan'
import { weatherFromBytes } from '../frontend/src/sim2/run/weather'
import { simulate } from '../frontend/src/sim2/run/seam'

const root = path.resolve(__dirname, '..')
const fx = JSON.parse(readFileSync(path.join(root, 'docs/examples/community_centre.plan.json'), 'utf8'))
const epw = process.argv[2]
const weather = await weatherFromBytes(new Uint8Array(readFileSync(epw)), path.basename(epw), 'local')
const hrs = (from: number, to: number) => Array.from({ length: 24 }, (_, h) => (h >= from && h < to ? 1 : 0))
const off = Array(24).fill(0)

function base() {
  const built = buildDocument(upgradePlan(structuredClone(fx.plan)) as any)
  if (!built.ok) throw new Error(JSON.stringify(built.issues))
  const d: any = structuredClone(built.doc)
  d.profiles.push({ id: 'hours_office', kind: 'schedule', label: 'Office hours, Mon–Fri 07:00–18:00', day_types: { weekday: hrs(7, 18), saturday: off, sunday: off } })
  for (const z of d.zones) {
    z.design_internal_c = z.setpoints.heat_c != null ? 'follow_heat_c' : 18
    for (const e of z.emitters) if (e.kind === 'vrf_indoor') e.cooling_output_w = 3600
  }
  d.building.design = { outdoor: { from_weather: 'heating_99_6' }, warm_up_w_per_m2: null, vent_wind_m_s: null }
  return { d, office: d.zones.find((z: any) => z.name === 'Open-plan office') }
}
function run(label: string, d: any) {
  const r = simulate(d, { weather, hourly: true })
  if (!r.ok) throw new Error(label + ': ' + JSON.stringify(r.missing))
  const i = d.zones.findIndex((z: any) => z.name === 'Open-plan office')
  const z = r.results.zones[i]
  const out = { label, steps_per_hour: r.summary.steps_per_hour, office_heating_kwh: z.annual.heating_kwh, office_peak_heating_w: z.annual.peak_heating_w,
    office_unmet_heating_hours_in_use: z.annual.unmet_heating_hours_in_use ?? null, building_heating_kwh: r.summary.building.heating_kwh }
  console.log(JSON.stringify(out))
  return out
}

const b = base(); b.office.setpoints.hours_ref = 'hours_office'; b.office.setpoints.setback_c = 16
const p = base()
p.d.profiles.push({ id: 'office_heat_b', kind: 'temperature', purpose: 'heating_setpoint', label: '21 °C in office hours, 16 °C otherwise', day_types: { weekday: hrs(7, 18).map((f) => (f ? 21 : 16)), saturday: Array(24).fill(16), sunday: Array(24).fill(16) } })
Object.assign(p.office.setpoints, { hours_ref: 'hours_office', heat_ref: 'office_heat_b', heat_c: 21, setback_c: null })
const e = base()
const early = hrs(6, 18).map((f, h) => (!f ? 16 : h === 17 ? 19 : 21))
e.d.profiles.push({ id: 'office_heat_early', kind: 'temperature', purpose: 'heating_setpoint', label: 'Pre-heat from 06:00, 19 °C last hour', day_types: { weekday: early, saturday: Array(24).fill(16), sunday: Array(24).fill(16) } })
Object.assign(e.office.setpoints, { hours_ref: 'hours_office', heat_ref: 'office_heat_early', heat_c: 21, setback_c: null })

const R = { B: run('B', b.d), B_profile: run('B as a profile', p.d), early: run('early start, wind-down', e.d) }
writeFileSync(process.argv[3], JSON.stringify({ source: 'scripts/121_community_centre.mts', weather: { file: path.basename(epw), sha256: weather.sha256 }, runs: R }, null, 1) + '\n')
