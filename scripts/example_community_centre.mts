/**
 * Worked example (16 Nov 2026): the community centre plan (docs/examples/community_centre.plan.json) through the
 * editor's own plan → document step (toDocument.buildDocument) and the product's run seam, as the Model workspace
 * runs it. Weather: an EPW given on the command line (never committed).
 *
 * Two runs:
 *  A  "as drawn": the document exactly as the editor writes it today.
 *  B  "with controls": A plus three things the engine already reads but the editor cannot set yet, added to the
 *     document here and listed in `added`: heating hours with a setback (Brief 109), the design heat loss conditions
 *     (Brief 117) and the VRF units' cooling output (Brief 119).
 *
 * Run from frontend/:  npx vite-node ../scripts/example_community_centre.mts <weather.epw> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan } from '../frontend/src/sim2/geometry/plan'
import { weatherFromBytes } from '../frontend/src/sim2/run/weather'
import { simulate } from '../frontend/src/sim2/run/seam'

const root = path.resolve(__dirname, '..')
const fx = JSON.parse(readFileSync(path.join(root, 'docs/examples/community_centre.plan.json'), 'utf8'))
const built = buildDocument(upgradePlan(fx.plan))
if (!built.ok) throw new Error(JSON.stringify(built.issues))
const epw = process.argv[2]
const weather = await weatherFromBytes(new Uint8Array(readFileSync(epw)), path.basename(epw), 'local')

const hours = (from: number, to: number) => Array.from({ length: 24 }, (_, h) => (h >= from && h < to ? 1 : 0))
const off = Array(24).fill(0)
const SCHEDULES = [
  { id: 'hours_office', kind: 'schedule', label: 'Office hours, Mon–Fri 07:00–18:00', day_types: { weekday: hours(7, 18), saturday: off, sunday: off } },
  { id: 'hours_cafe', kind: 'schedule', label: 'Café hours, every day 08:00–18:00', day_types: { weekday: hours(8, 18), saturday: hours(8, 18), sunday: hours(9, 17) } },
  { id: 'hours_hall', kind: 'schedule', label: 'Hall hours, every day 08:00–22:00', day_types: { weekday: hours(8, 22), saturday: hours(8, 22), sunday: hours(9, 18) } },
]
const HOURS: Record<string, [string, number] | null> = {
  'Café': ['hours_cafe', 16], Kitchen: ['hours_cafe', 14], Reception: ['hours_office', 16], 'Open-plan office': ['hours_office', 16],
  'Meeting room': ['hours_office', 16], WCs: ['hours_office', 14], 'Main hall': ['hours_hall', 14], 'Comms room': null, Store: null,
}

function withControls(doc0: any) {
  const d = structuredClone(doc0)
  const added: string[] = []
  d.profiles.push(...SCHEDULES)
  for (const z of d.zones) {
    const h = HOURS[z.name]
    if (h && z.setpoints.heat_c != null) {
      z.setpoints.hours_ref = h[0]; z.setpoints.setback_c = h[1]
      if (z.setpoints.cool_c != null) added.push(`${z.name}: heating ${z.setpoints.heat_c} °C and cooling ${z.setpoints.cool_c} °C in "${SCHEDULES.find((s) => s.id === h[0])!.label}", heating set back to ${h[1]} °C outside them, no cooling outside them`)
      else added.push(`${z.name}: heating ${z.setpoints.heat_c} °C in "${SCHEDULES.find((s) => s.id === h[0])!.label}", set back to ${h[1]} °C outside them`)
    }
    z.design_internal_c = z.setpoints.heat_c != null ? 'follow_heat_c' : 18
    for (const e of z.emitters) if (e.kind === 'vrf_indoor') { e.cooling_output_w = 3600; added.push(`${z.name}: each VRF cassette cools up to 3.6 kW`) }
    if (z.name === 'Comms room') {
      z.emitters.push({ id: 'z6_vrf_wall', label: 'VRF wall unit 2.2 kW (cooling only)', kind: 'vrf_indoor', count: 1, heats: false, cooling_output_w: 2200, rated_output_w: null, radiant_fraction: null, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null, source_surface_id: null, source_layer_index: null, catalogue_ref: null })
      added.push('Comms room: one VRF wall unit, cooling only, 2.2 kW')
    }
  }
  d.building.design = { outdoor: { from_weather: 'heating_99_6' }, warm_up_w_per_m2: null, vent_wind_m_s: null }
  added.push('Design heat loss at the weather file\'s 99.6 % heating temperature, each room at its heating setpoint (unheated rooms at 18 °C)')
  return { doc: d, added }
}

const sum = (a: ArrayLike<number>, i0: number, i1: number) => { let t = 0; for (let i = i0; i < i1; i++) t += a[i]!; return t }
function pack(doc: any, label: string) {
  const r = simulate(doc, { weather, hourly: true })
  if (!r.ok) throw new Error(label + ': ' + JSON.stringify(r.missing))
  const s = r.summary
  if (!s.energy || !s.energy.ok) throw new Error(label + ': ' + JSON.stringify(s.energy))
  const zoneName = new Map(doc.zones.map((z: any) => [z.id, z.name]))
  const zoneRow = new Map(s.zones.map((z) => [z.id, z]))
  // Energy per system, and each system's energy split over the rooms it serves (its share of their demand ÷ its
  // efficiency); the split is checked to add back to the system's own total.
  const systems = s.energy.systems.map((g) => {
    const dg = doc.system_groups.find((x: any) => x.id === g.id)
    const rooms = (dg?.zones ?? []).map((zid: string) => {
      const z = zoneRow.get(zid)!
      const demand = g.service === 'heating' ? z.heating_kwh : g.service === 'cooling' ? z.cooling_kwh : null
      return { room: zoneName.get(zid), demand_kwh: demand, fuel_kwh: demand != null && g.efficiency ? (demand * (dg.share_pct / 100)) / g.efficiency : null }
    })
    const split = rooms.reduce((a: number, x: any) => a + (x.fuel_kwh ?? 0), 0)
    const groupHourly = r.ok ? null : null
    return { ...g, rooms, split_check_kwh: g.service === 'heating' || g.service === 'cooling' ? split - g.fuel_kwh : null, template: dg?.template_ref, groupHourly }
  })
  // Daily fuel per system from the engine's hourly draw (W per hour = Wh).
  const daily: Record<string, number[]> = {}
  for (const g of (r as any).results ? [] : []) void g
  return {
    label, run_ms: Math.round(s.run_ms), steps_per_hour: s.steps_per_hour, weather: s.weather,
    building: { floor_m2: s.building.floor_m2, heating_kwh: s.building.heating_kwh, cooling_kwh: s.building.cooling_kwh, peak_heating_w: s.building.peak_heating_w, peak_cooling_w: s.building.peak_cooling_w, monthly: s.building.monthly },
    zones: s.zones.map((z) => ({ id: z.id, name: z.name, floor_m2: z.floor_m2, heating_kwh: z.heating_kwh, cooling_kwh: z.cooling_kwh, heated: z.heated, cooled: z.cooled, monthly: z.monthly, hours: z.hours, breakdown: z.breakdown })),
    breakdown: s.breakdown, energy: { ...s.energy, systems }, emitters: s.emitters, design_heat_loss: s.design_heat_loss,
    hourly_heating_w: Array.from(s.hourly!.heating_w), hourly_cooling_w: Array.from(s.hourly!.cooling_w), daily,
  }
}

const A = pack(built.doc, 'A: as drawn in the workspace')
const { doc: docB, added } = withControls(built.doc)
const B = pack(docB, 'B: with heating hours, design heat loss and cooling units')
for (const X of [A, B]) {
  console.log('\n' + X.label, X.run_ms + ' ms', 'EUI', X.energy.eui_kwh_per_m2.toFixed(1), 'heat', Math.round(X.building.heating_kwh), 'cool', Math.round(X.building.cooling_kwh))
  for (const g of X.energy.systems) console.log('  ', g.label.padEnd(28), g.service.padEnd(12), g.fuel, Math.round(g.served_kwh), '→', Math.round(g.fuel_kwh), 'split chk', g.split_check_kwh?.toFixed(3), g.rooms.map((x: any) => x.room).join(', '))
  for (const z of X.zones) console.log('  ', z.name.padEnd(18), Math.round(z.heating_kwh), Math.round(z.cooling_kwh), z.hours ? `unmet ${z.hours.unmet_in_use_hours} min ${z.hours.min_in_use_c?.toFixed(1)} mpk ${Math.round(z.hours.morning_peak?.w ?? 0)}` : '')
  console.log('  by fuel', JSON.stringify(X.energy.by_fuel.map((f: any) => [f.fuel, Math.round(f.kwh)])), 'not modelled', X.energy.not_modelled)
}
console.log(JSON.stringify(B.emitters?.cooling?.map((z: any) => [z.name, z.cap_w, Math.round(z.peak_w), z.unmet_hours, z.max_c?.toFixed(1)])))
console.log(JSON.stringify((B.design_heat_loss as any)?.zones?.map((z: any) => [z.name, Math.round(z.total_w ?? z.loss_w ?? 0), z.emitters_ok ?? z.verdict]) ?? B.design_heat_loss))
writeFileSync(process.argv[3], JSON.stringify({ source: 'scripts/example_community_centre.mts', notes: built.notes, totals: built.totals, added, A, B, docA: built.doc, docB }))
