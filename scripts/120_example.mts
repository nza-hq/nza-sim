/**
 * Brief 120 Part 4: the community centre (16 Nov worked example, run B: heating hours, design heat loss, cooling units)
 * with its gas boiler given a capacity, from its rooms' design heat loss downwards, and Bridgewater with its heat pump
 * capped. Reports what moves: hours the boiler is short, each room's unmet hours split into "system short" and "own",
 * the lowest flow temperature, and energy.
 *
 * Run from frontend/:  npx vite-node ../scripts/120_example.mts <community_centre.plan.json> <weather.epw> <out.json>
 * The plan is docs/examples/community_centre.plan.json on chris/example-model (not merged); the weather is any EPW (the
 * example used London Gatwick IWEC, which is not redistributable; this run records the one it used).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan } from '../frontend/src/sim2/geometry/plan'
import { weatherFromBytes } from '../frontend/src/sim2/run/weather'
import { simulate } from '../frontend/src/sim2/run/seam'

const [planPath, epw, outPath] = process.argv.slice(2)
const fx = JSON.parse(readFileSync(planPath, 'utf8'))
const built = buildDocument(upgradePlan(fx.plan))
if (!built.ok) throw new Error(JSON.stringify(built.issues))
const weather = await weatherFromBytes(new Uint8Array(readFileSync(epw)), path.basename(epw), 'local')

// Run B of the worked example (scripts/example_community_centre.mts on chris/example-model), as there.
const hours = (from: number, to: number) => Array.from({ length: 24 }, (_, h) => (h >= from && h < to ? 1 : 0))
const off = Array(24).fill(0)
const SCHEDULES = [
  { id: 'hours_office', kind: 'schedule', label: 'Office hours', day_types: { weekday: hours(7, 18), saturday: off, sunday: off } },
  { id: 'hours_cafe', kind: 'schedule', label: 'Café hours', day_types: { weekday: hours(8, 18), saturday: hours(8, 18), sunday: hours(9, 17) } },
  { id: 'hours_hall', kind: 'schedule', label: 'Hall hours', day_types: { weekday: hours(8, 22), saturday: hours(8, 22), sunday: hours(9, 18) } },
]
const HOURS: Record<string, [string, number] | null> = {
  'Café': ['hours_cafe', 16], Kitchen: ['hours_cafe', 14], Reception: ['hours_office', 16], 'Open-plan office': ['hours_office', 16],
  'Meeting room': ['hours_office', 16], WCs: ['hours_office', 14], 'Main hall': ['hours_hall', 14], 'Comms room': null, Store: null,
}
function runB(doc0: any) {
  const d = structuredClone(doc0)
  d.profiles.push(...SCHEDULES)
  for (const z of d.zones) {
    const h = HOURS[z.name]
    if (h && z.setpoints.heat_c != null) { z.setpoints.hours_ref = h[0]; z.setpoints.setback_c = h[1] }
    z.design_internal_c = z.setpoints.heat_c != null ? 'follow_heat_c' : 18
    for (const e of z.emitters) if (e.kind === 'vrf_indoor') e.cooling_output_w = 3600
  }
  d.building.design = { outdoor: { from_weather: 'heating_99_6' }, warm_up_w_per_m2: null, vent_wind_m_s: null }
  return d
}

function run(doc: any) {
  const r = simulate(doc, { weather })
  if (!r.ok) throw new Error(JSON.stringify(r.missing))
  const s = r.summary
  if (!s.energy?.ok) throw new Error(JSON.stringify(s.energy))
  return {
    run_ms: Math.round(s.run_ms), steps_per_hour: s.steps_per_hour, eui: +s.energy.eui_kwh_per_m2.toFixed(1), heating_kwh: Math.round(s.building.heating_kwh),
    plants: s.plants.map((p) => ({ label: p.label, capacity_kw: p.capacity_kw, peak_ask_kw: +(p.peak_ask_w / 1000).toFixed(1), hours_short: +p.hours_short.toFixed(1), delivered_kwh: Math.round(p.delivered_kwh), min_flow_c: p.min_flow_c == null ? null : +p.min_flow_c.toFixed(1) })),
    design: s.design_heat_loss?.ok ? s.design_heat_loss.systems.map((x) => ({ label: x.label, capacity_kw: x.capacity_w / 1000, rooms_kw: +(x.rooms_w / 1000).toFixed(1), hot_water_kw: +(x.hot_water_w / 1000).toFixed(1) })) : null,
    rooms: s.zones.filter((z) => z.short.heating).map((z) => ({ room: z.name, heating_kwh: Math.round(z.heating_kwh), ...z.short.heating! })),
    fuel: s.energy.systems.filter((g) => g.service === 'heating').map((g) => ({ label: g.label, fuel_kwh: Math.round(g.fuel_kwh) })),
  }
}

const B = runB(built.doc)
const boiler = B.system_groups.find((g: any) => g.service === 'heating' && g.source === 'gas')
if (!boiler) throw new Error('no gas boiler in the example')
// The boiler's rooms' design heat loss, from the run itself (its design line needs a capacity, so give a large one first).
const probe = structuredClone(B)
probe.system_groups.find((g: any) => g.id === boiler.id).capacity_kw = 1000
const free = run(probe)
const designKw = free.design![0].rooms_kw
const cases: Record<string, unknown> = { uncapped_1000kw: free }
for (const f of [1, 0.75, 0.5]) {
  const d = structuredClone(B)
  d.system_groups.find((g: any) => g.id === boiler.id).capacity_kw = +(designKw * f).toFixed(1)
  cases[`capped_${Math.round(f * 100)}pct_of_design`] = run(d)
}
const out = { source: 'scripts/120_example.mts', weather: { file: weather.file_name, station: weather.station, sha256: weather.sha256 }, boiler: { id: boiler.id, label: boiler.label, zones: boiler.zones, design_flow_c: boiler.design_flow_c }, design_kw: designKw, cases }
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
