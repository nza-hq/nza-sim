/**
 * Thermal mass behind finishes (Linzie 17 Nov 2026): one concrete-frame office room, four slab finishes, through our
 * monthly (instant) and hourly (15-minute) engines. Spec: validation/energyplus/mass_finishes_spec.json.
 *
 * Run from frontend/:  npx vite-node ../scripts/mass_finishes.mts <epw> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { upgradeDocument } from '../frontend/src/thermal/schema/upgrade'
import { parseEpw, REFEREE_OPTIONS, runModel, type RunOptions } from '../frontend/src/thermal/engine/index'
import { runMonthly } from '../frontend/src/thermal/engine/monthly'

const root = path.resolve(__dirname, '..')
const SPEC = JSON.parse(readFileSync(path.join(root, 'validation/energyplus/mass_finishes_spec.json'), 'utf8'))
const [epwPath, outPath] = process.argv.slice(2)
const bytes = readFileSync(epwPath)
const weather = await parseEpw(bytes)

const HOURLY: RunOptions = { ...REFEREE_OPTIONS, internal_gains: 'profiles', ventilation: 'document', time_step: { steps_per_hour: 4, theta_e_between: 'linear' } }
const MONTHLY = { solar: REFEREE_OPTIONS.solar, glazing_solar: REFEREE_OPTIONS.glazing_solar ?? 'g_value', internal_gains: 'profiles' } as any

const layer = ([d, k, cp, rho]: number[]) => (rho > 0 ? { kind: 'Material', thickness: d, conductivity: k, density: rho, specific_heat: cp } : { kind: 'Material:NoMass', thermal_resistance: d / k })

function build(caseName: string, contents: number, conditioned: boolean) {
  const W = SPEC.width_m, D = SPEC.depth_m, H = SPEC.height_m
  const win = SPEC.window.width_m * SPEC.window.height_m
  const lib: Record<string, any> = {
    ext: { layers: SPEC.external_wall.map(layer) },
    part: { layers: SPEC.partition.map(layer) },
    slab: { layers: SPEC.cases[caseName].map((m: string) => layer(SPEC.materials[m])) },
    window: { u_value_W_per_m2K: SPEC.window.u_w_per_m2k, g_value: SPEC.window.shgc, layers: [] },
  }
  const base = { facade: null, g_value: null, openings: [], frame_fraction: null, inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null, faces_up: null, solar_absorptance: 0.6, thermal_emissivity: 0.9 }
  const surfaces: any[] = [
    { ...base, id: 'south', kind: 'wall', zone_a: 'room', zone_b: 'outside', area_m2: W * H - win, azimuth_deg: 180, tilt_deg: 90, construction_ref: { key: 'ext' } },
    { ...base, id: 'north', kind: 'wall', zone_a: 'room', zone_b: 'outside', area_m2: W * H, azimuth_deg: 0, tilt_deg: 90, construction_ref: { key: 'ext' } },
    { ...base, id: 'window', kind: 'glazing', zone_a: 'room', zone_b: 'outside', area_m2: win, azimuth_deg: 180, tilt_deg: 90, construction_ref: { key: 'window' }, solar_absorptance: null, frame_fraction: 0, inside_solar_absorptance: null },
    // East and west: one stud partition to identical neighbours, both faces in this room.
    { ...base, id: 'partition', kind: 'internal_mass', zone_a: 'room', zone_b: 'room', area_m2: D * H, azimuth_deg: null, tilt_deg: 90, construction_ref: { key: 'part' }, solar_absorptance: null, thermal_emissivity: null, inside_solar_absorptance_b: 0.6, faces_up: false },
    // Floor and ceiling: one slab to identical rooms above and below; zone_a face = this floor (up), zone_b face = the ceiling.
    { ...base, id: 'slab', kind: 'internal_mass', zone_a: 'room', zone_b: 'room', area_m2: W * D, azimuth_deg: null, tilt_deg: 180, construction_ref: { key: 'slab' }, solar_absorptance: null, thermal_emissivity: null, inside_solar_absorptance_b: 0.6, faces_up: true },
  ]
  const [on, off] = SPEC.gains.weekday_on
  const day = Array.from({ length: 24 }, (_, h) => (h >= on && h < off ? 1 : 0))
  const zero = Array(24).fill(0)
  const doc = upgradeDocument({
    schema_version: '2.10',
    building: { id: 'mass', name: 'Mass behind finishes', decoded_building_key: null, site: { lat: weather.header.latitude, lon: weather.header.longitude, name: weather.header.city, exposure: null, ground: { method: 'annual_mean_outdoor' } }, orientation_deg: 0, reported_floor_area_m2: null, thermal_bridging: { mode: 'absent', multiplier: null, alpha_pct: null }, thermal_mass: { mode: null, category: null }, opening_defaults: {} },
    zones: [{
      id: 'room', name: 'room', floor: 0, storeys: 1, polygon: [[0, 0], [W, 0], [W, D], [0, D]], area_m2: W * D, height_m: H, use_type: 'office', rooms: null,
      profile_refs: { occupancy: null, lighting: [], equipment: ['gains'], auxiliary: [] },
      setpoints: conditioned ? { heat_c: SPEC.setpoints.heat_c, cool_c: SPEC.setpoints.cool_c, setback_c: null, hours_ref: null, control_strategy: 'active_setpoint' } : { heat_c: null, cool_c: null, setback_c: null, hours_ref: null, control_strategy: null },
      ventilation: [], infiltration_q50: null, infiltration_ach: conditioned ? SPEC.infiltration_ach : SPEC.free_running_ach, internal_heat_capacity_j_per_k_m2: contents, emitters: [],
      surfaces: surfaces.map((s) => s.id),
    }],
    surfaces,
    system_groups: [],
    profiles: [{ id: 'gains', kind: 'equipment', schedule: { weekday: day, saturday: zero, sunday: zero }, relationship_to_occupancy: 'independent', area_share: 1, gain_fraction: 1, active: { value: SPEC.gains.w_per_m2, unit: 'w_per_m2' }, baseload: { value: 0, unit: 'w_per_m2' }, radiant_fraction: SPEC.gains.radiant_fraction }],
    services: { heating: { setpoint_mode: 'follow_comfort', setpoint_c: null }, cooling: { setpoint_mode: 'follow_comfort', setpoint_c: null }, dhw: { storage_setpoint_c: null, tap_outlet_temp_c: null, cold_supply_temp_c: null, load_shape: null, circulation_pump_w: null } },
    weather_ref: { kind: 'epw', station_id: weather.header.wmo, file_name: path.basename(epwPath), file_hash: weather.sha256 },
    library_refs: [],
  })
  return { doc, lib }
}

const out: Record<string, any> = { epw: path.basename(epwPath), epw_sha256: weather.sha256, cases: {} }
for (const c of Object.keys(SPEC.cases)) {
  const row: Record<string, any> = {}
  for (const contents of [0, 250_000]) {
    const k = contents === 0 ? 'fabric_only' : 'app_default_250k'
    const a = build(c, contents, true)
    const r = runModel(a.doc, weather, a.lib, HOURLY).zones[0]
    const m = runMonthly(a.doc, weather, a.lib, MONTHLY).zones[0] as any
    const f = build(c, contents, false)
    const fr = runModel(f.doc, weather, f.lib, HOURLY).zones[0]
    const t = Array.from(fr.hourly.theta_air_c)
    row[k] = {
      hourly: { heat_kwh: r.annual.heating_kwh, cool_kwh: r.annual.cooling_kwh, peak_cool_w: Math.max(...Array.from(r.hourly.cooling_w)) },
      monthly: { heat_kwh: m.heating_kwh, cool_kwh: m.cooling_kwh, c_m_mj_per_k: m.c_m_j_per_k / 1e6, tau_h: m.tau_h },
      free: { max_c: Math.max(...t), hours_over_26: t.filter((x) => x > 26).length, hours_over_28: t.filter((x) => x > 28).length },
    }
  }
  out.cases[c] = row
  console.log(c, JSON.stringify(row))
}
writeFileSync(outPath, JSON.stringify(out, null, 1))
