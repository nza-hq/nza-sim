/**
 * Brief 129: the clubhouse proof that every profile type works in the model (Linzie, 25 Nov 2026). Shared by the
 * opt-in test (profileTypesProof.test.ts) and the script that writes the table (scripts/sim2_profile_proof.ts), which
 * runs outside the test runner because a weather-driven clubhouse year blocks a test worker longer than its heartbeat.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { upgradePlan, type Plan } from '../plan'
import { buildDocument } from '../toDocument'
import { simulate } from '../../run/seam'
import { parseEpw } from '../../../thermal/engine/epw'
import { profile } from '../../library/library'

export type ProofRow = { type: string; template: string; change: string; what: string; before: number; after: number }
type Fig = { heating_kwh: number; cooling_kwh: number; end: Record<string, number>; dhw_peak_w: number; dhw_night_share: number }
export function figures(r: any): Fig {
  const e = r.summary.energy
  const end: Record<string, number> = {}
  for (const u of e?.ok ? e.end_uses : []) end[u.end_use] = (end[u.end_use] ?? 0) + u.kwh
  const dhw = (e?.ok ? e.hourly : []).filter((x: any) => x.end_use === 'dhw')
  const H = dhw[0]?.w.length ?? 0
  let peak = 0, night = 0, all = 0
  for (let h = 0; h < H; h++) {
    const w = dhw.reduce((a: number, x: any) => a + x.w[h], 0)
    peak = Math.max(peak, w); all += w
    if (h % 24 < 5) night += w
  }
  return { heating_kwh: r.summary.building.heating_kwh, cooling_kwh: r.summary.building.cooling_kwh, end, dhw_peak_w: peak, dhw_night_share: all ? night / all : 0 }
}


/** Runs the rows named in `only` (all when empty), calling `onRow` as each one finishes. */
export async function runProof(FIXTURE: string, EPW: string, only: readonly string[] = [], out?: string) {
  const want = (t: string) => !only.length || only.includes(t)
  const weather = await (async () => { const w = await parseEpw(new Uint8Array(readFileSync(EPW))); return { weather: w, file_name: 'sample-chicago.epw', station: 'Chicago', sha256: w.sha256, source: 'local' as const } })()
  const base0 = upgradePlan(JSON.parse(readFileSync(FIXTURE, 'utf8')).plan) as Plan
  const add = (p: Plan, key: string): Plan => ({ ...p, profiles: [...new Set([...(p.profiles ?? []), key])] })
  const onSpace = (p: Plan, name: string, patch: Record<string, unknown>): Plan => ({ ...p, spaces: p.spaces.map((s) => (s.name === name ? { ...s, ...patch } : s)) })
  // Windows need an opening to open: Block 1's sashes (sliding), and the weather-driven air method, in the baseline for windows.
  const sash = base0.fabric_types.find((t) => t.element === 'glazing' && t.name.startsWith('Block 1'))!.id
  const openable = (p: Plan): Plan => ({
    ...p,
    building: { ...p.building, air_method: 'weather_driven', air_exponent: 0.67, single_sided_turbulence: false, terrain: p.building.terrain ?? 'suburban' },
    fabric_types: p.fabric_types.map((t) => (t.id === sash ? { ...t, opening: { style: 'sliding', openable_fraction: 0.5, opening_angle_deg: null, cd: 0.6 } } : t)),
  } as Plan)
  const run = (p: Plan) => {
    const b = buildDocument(p)
    const r = simulate(b.doc, { weather }) as any
    if (!r.ok) throw new Error(JSON.stringify(r.missing ?? r).slice(0, 600))
    return figures(r)
  }
  for (const k of ['office_occupancy', 'office_lighting', 'hotel_bedroom_equipment', 'hotel_dhw_demand', 'hotel_heating_setpoint', 'hotel_cooling_setpoint', 'general_window_opening_day', 'school_ventilation_day']) if (!profile(k)) throw new Error(`template ${k} is not in the library`)

  const base = run(base0)
  const rows: ProofRow[] = []
  const row = (type: string, template: string, change: string, what: string, before: number, after: number) => {
    rows.push({ type, template, change, what, before, after })
    // Written as it goes, so a long run's rows are kept even if a later one stops.
    if (out) writeFileSync(out, JSON.stringify({ weather: 'sample-chicago.epw', rows }, null, 1))
    console.log(`${type}: ${what} ${before.toFixed(3)} -> ${after.toFixed(3)}`)
  }

  if (want('Occupancy')) {
    const occ = run(add(onSpace(base0, 'Lounge and bar', { occupancy: 'office_occupancy' }), 'office_occupancy'))
    row('Occupancy', 'office_occupancy', 'Lounge and bar follows the office occupancy template', 'Heating, kWh a year', base.heating_kwh, occ.heating_kwh)
  }
  if (want('Lighting')) {
    const lit = run(add(onSpace(base0, 'Lounge and bar', { lighting: 'office_lighting', light_relationship: 'independent' }), 'office_lighting'))
    row('Lighting', 'office_lighting', 'Lounge and bar lighting follows its own profile', 'Lighting electricity, kWh a year', base.end.lighting ?? 0, lit.end.lighting ?? 0)
  }
  if (want('Equipment')) {
    const eq = run(add(onSpace(base0, 'Lounge and bar', { equipment: 'hotel_bedroom_equipment', equip_relationship: 'independent' }), 'hotel_bedroom_equipment'))
    row('Equipment', 'hotel_bedroom_equipment', 'Lounge and bar equipment follows its own profile', 'Small power electricity, kWh a year', base.end.small_power ?? 0, eq.end.small_power ?? 0)
  }
  if (want('Hot water')) {
    const hw = run(add({ ...base0, dhw: { ...base0.dhw!, shape: 'hotel_dhw_demand' } }, 'hotel_dhw_demand'))
    row('Hot water', 'hotel_dhw_demand', 'Hot water drawn by the hot water profile, not with occupancy', 'Share of hot water drawn midnight to 5 am', base.dhw_night_share, hw.dhw_night_share)
  }
  if (want('Heating setpoint')) {
    const hs = run(add(onSpace(base0, 'Lounge and bar', { heat_profile: 'hotel_heating_setpoint' }), 'hotel_heating_setpoint'))
    row('Heating setpoint', 'hotel_heating_setpoint', 'Lounge and bar heated to the hotel setpoint profile', 'Heating, kWh a year', base.heating_kwh, hs.heating_kwh)
  }
  if (want('Cooling setpoint')) {
    const cs = run(add(onSpace(base0, 'Office (DX cooled)', { cool_profile: 'hotel_cooling_setpoint' }), 'hotel_cooling_setpoint'))
    row('Cooling setpoint', 'hotel_cooling_setpoint', 'Offices cooled to the hotel cooling setpoint profile', 'Cooling, kWh a year', base.cooling_kwh, cs.cooling_kwh)
  }
  if (want('Window opening')) {
    // Every room with an opening window needs a rule, so every space gets one: open a tenth, at any hour (before) or only
    // in the template's hours (after).
    const rule = (hours: string | null) => ({ rule: 'timetable', open_fraction: 0.1, open_above_c: null, hours, controller: 'manual' })
    const w0 = openable(base0)
    const anyHour = run({ ...w0, spaces: w0.spaces.map((sp) => ({ ...sp, windows: rule(null) })) } as Plan)
    const win = run(add({ ...w0, spaces: w0.spaces.map((sp) => ({ ...sp, windows: rule('general_window_opening_day') })) } as Plan, 'general_window_opening_day'))
    row('Window opening', 'general_window_opening_day', 'Block 1 sashes open a tenth, only 08:00 to 18:00 instead of at any hour', 'Heating, kWh a year', anyHour.heating_kwh, win.heating_kwh)
  }
  if (want('Availability')) {
    const kx = base0.systems.find((x) => x.service === 'ventilation' && x.name.startsWith('Kitchen'))!.id
    const av = run(add({ ...base0, systems: base0.systems.map((x) => (x.id === kx ? { ...x, schedule: 'school_ventilation_day' } : x)) }, 'school_ventilation_day'))
    row('Availability', 'school_ventilation_day', 'Kitchen extract runs to the school-day availability template', 'Fan electricity, kWh a year', base.end.fans ?? 0, av.end.fans ?? 0)
  }

  return { rows }
}
