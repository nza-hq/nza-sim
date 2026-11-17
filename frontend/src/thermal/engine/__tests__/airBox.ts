/**
 * Brief 115 P4: the referee room at Chicago O'Hare (validation/energyplus/115_air_spec.json) as a model document, one per case, built
 * from the same inputs as the EnergyPlus model (115_air_referee.py). Constructions and window are the Brief 104 cooled
 * room's.
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ModelDocument } from '../../schema/model'
import { cooledRoomDocument, SPEC as CR } from './cooledRoom'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
export const AIR_SPEC = JSON.parse(fs.readFileSync(repo('validation/energyplus/115_air_spec.json'), 'utf8'))
export const AIR_SPEC_PATH = repo('validation/energyplus/115_air_spec.json')

export function airBoxDocument(caseName: string, S: any = AIR_SPEC) {
  const c = S.cases[caseName]
  if (!c) throw new Error(`no case ${caseName}`)
  const { lib } = cooledRoomDocument()
  const Wd = S.width_m, D = S.depth_m, Hh = S.height_m
  const ia = CR.inside_solar_absorptance
  const wins: { facade: 'south' | 'north'; w: any }[] = []
  if (['single', 'cross', 'shut'].includes(c.windows)) wins.push({ facade: 'south', w: S.window })
  if (c.windows === 'cross') wins.push({ facade: 'north', w: S.cross_window })
  const az = { south: 180, north: 0, east: 90, west: 270 } as const
  const winArea = (f: string) => wins.filter((x) => x.facade === f).reduce((t, x) => t + x.w.width_m * x.w.height_m, 0)
  const outside = (id: string, kind: string, area: number, azd: number | null, tilt: number, key: string, x: Record<string, unknown> = {}) => ({
    id, kind, zone_a: 'room', zone_b: 'outside', facade: null, area_m2: area, azimuth_deg: azd, tilt_deg: tilt, construction_ref: { key },
    g_value: null, openings: [] as any[], solar_absorptance: CR.solar_absorptance, thermal_emissivity: CR.thermal_emissivity, frame_fraction: null,
    inside_solar_absorptance: ia, inside_solar_absorptance_b: null, faces_up: null, ...x,
  })
  const surfaces: any[] = [
    outside('south', 'wall', Wd * Hh - winArea('south'), 180, 90, 'wall'),
    outside('north', 'wall', Wd * Hh - winArea('north'), 0, 90, 'wall'),
    outside('east', 'wall', D * Hh, 90, 90, 'wall'),
    outside('west', 'wall', D * Hh, 270, 90, 'wall'),
    outside('roof', 'roof', Wd * D, null, 0, 'roof'),
    outside('floor', 'floor', Wd * D, null, 180, 'floor', { solar_absorptance: 0 }),
  ]
  for (const { facade, w } of wins) {
    // EnergyPlus's SimpleOpening takes the window's centroid as its bottom: the engine's sill is that centroid (spec note).
    const sill = w.energyplus_z0_m + w.height_m / 2
    surfaces.push(outside(`${facade}_window`, 'glazing', w.width_m * w.height_m, az[facade], 90, 'window', {
      solar_absorptance: null, frame_fraction: 0, inside_solar_absorptance: null,
      openings: [{ kind: 'operable', openable_fraction: S.window.openable_fraction, cd: S.window.cd, style: S.window.style, sill_m: sill, head_m: sill + w.height_m }],
    }))
  }
  const controls: any[] = []
  if (wins.length) {
    const open = c.windows === 'shut' ? 0 : S.rule.open_fraction
    const m = c.modulation ? S.modulation : null
    controls.push({
      id: 'win', target: { kind: 'window', ref: 'room' }, controller: 'manual', rule: 'temperature', open_fraction: open, open_above_c: S.rule.open_above_c,
      modulation: m ? { full_open_below_dk: m.lower_dk, min_open_above_dk: m.upper_dk, min_fraction: m.min_fraction } : null,
    })
  }
  const doc = ModelDocument.parse({
    schema_version: '2.12',
    building: {
      id: `air-box-${caseName}`, name: `Air box ${caseName}`, decoded_building_key: null,
      site: { lat: 41.98, lon: -87.92, name: 'Chicago O\'Hare', exposure: null, ground: { method: 'annual_mean_outdoor' }, terrain: S.terrain.engine },
      orientation_deg: 0, reported_floor_area_m2: null, thermal_bridging: { mode: 'absent', multiplier: null, alpha_pct: null },
      thermal_mass: { mode: null, category: null }, opening_defaults: {},
      air: { method: 'weather_driven', exponent: S.exponent, single_sided_turbulence: false },
    },
    zones: [{
      id: 'room', name: 'room', floor: 0, storeys: 1, polygon: [[0, 0], [Wd, 0], [Wd, D], [0, D]], area_m2: Wd * D, height_m: Hh, use_type: 'test', rooms: null,
      profile_refs: { occupancy: null, lighting: [], equipment: [], auxiliary: [] },
      setpoints: { heat_c: S.heat_c, cool_c: c.cool ? S.cool_c : null, setback_c: null, hours_ref: null, control_strategy: 'active_setpoint' },
      ventilation: [], infiltration_q50: c.q50 ?? S.q50, infiltration_ach: null, internal_heat_capacity_j_per_k_m2: 0, emitters: [],
      surfaces: surfaces.map((s) => s.id),
    }],
    surfaces, system_groups: [], profiles: [], controls,
    services: { heating: { setpoint_mode: 'follow_comfort', setpoint_c: null }, cooling: { setpoint_mode: 'follow_comfort', setpoint_c: null }, dhw: { storage_setpoint_c: null, tap_outlet_temp_c: null, cold_supply_temp_c: null, load_shape: null, circulation_pump_w: null } },
    weather_ref: { kind: 'epw', station_id: '725300', file_name: 'USA_IL_Chicago-OHare.Intl.AP.725300_TMY3.epw', file_hash: S.weather.sha256 },
    library_refs: [],
  })
  return { doc, lib }
}
