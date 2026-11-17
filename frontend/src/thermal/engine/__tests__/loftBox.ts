/**
 * Brief 123 P5: the referee box (validation/energyplus/123_roof_spec.json) as a model document, one per case, built from
 * the same inputs as the EnergyPlus model (123_roof_referee.py). x east, y north; south facade y = 0.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ConstructionBody } from '../elements'
import { ModelDocument } from '../../schema/model'
import { SPEC as CR } from './cooledRoom'

const repo = (p: string) => path.resolve(__dirname, '../../../../..', p)
export const ROOF_SPEC = JSON.parse(fs.readFileSync(repo('validation/energyplus/123_roof_spec.json'), 'utf8'))
export const ROOF_SPEC_PATH = repo('validation/energyplus/123_roof_spec.json')

const layers = (c: number[][]) => c.map(([d, k, cp, rho]) => (rho > 0 ? { kind: 'Material', thickness: d, conductivity: k, density: rho, specific_heat: cp } : { kind: 'Material:NoMass', thermal_resistance: d / k }))
const rad = (d: number) => (d * Math.PI) / 180

export function roofGeometry(roof: 'flat' | 'gable_cold' | 'mono_warm', S: any = ROOF_SPEC) {
  const W = S.width_x_m, D = S.depth_y_m
  if (roof === 'gable_cold') {
    const rise = (D / 2) * Math.tan(rad(S.gable.pitch_deg))
    return { rise, slope_m2: W * (D / 2) / Math.cos(rad(S.gable.pitch_deg)), gable_m2: 0.5 * D * rise, loft_m3: 0.5 * D * rise * W }
  }
  if (roof === 'mono_warm') {
    const rise = D * Math.tan(rad(S.mono.pitch_deg))
    return { rise, slope_m2: W * D / Math.cos(rad(S.mono.pitch_deg)), gable_m2: 0.5 * D * rise, loft_m3: 0.5 * D * rise * W }
  }
  return { rise: 0, slope_m2: 0, gable_m2: 0, loft_m3: 0 }
}

export function loftBoxDocument(caseName: string, S: any = ROOF_SPEC) {
  const c = S.cases[caseName]
  if (!c) throw new Error(`no case ${caseName}`)
  const roof = c.roof as 'flat' | 'gable_cold' | 'mono_warm'
  const W = S.width_x_m, D = S.depth_y_m, Hh = S.height_m
  const g = roofGeometry(roof, S)
  const lib: Record<string, ConstructionBody> = {
    wall: { layers: layers(CR.constructions.wall) as any }, floor: { layers: layers(CR.constructions.floor) as any },
    window: { u_value_W_per_m2K: CR.window.u_w_per_m2k, g_value: CR.window.shgc, layers: [] },
  }
  for (const k of Object.keys(S.constructions)) lib[k] = { layers: layers(S.constructions[k]) as any }
  const ia = CR.inside_solar_absorptance
  const surf = (id: string, kind: string, zone_a: string, zone_b: string, area: number, az: number | null, tilt: number, key: string, x: Record<string, unknown> = {}) => ({
    id, kind, zone_a, zone_b, facade: null, area_m2: area, azimuth_deg: az, tilt_deg: tilt, construction_ref: { key },
    g_value: null, openings: [] as any[], solar_absorptance: zone_b === 'outside' ? CR.solar_absorptance : null, thermal_emissivity: zone_b === 'outside' ? CR.thermal_emissivity : null,
    frame_fraction: null, inside_solar_absorptance: ia, inside_solar_absorptance_b: null, faces_up: null, ...x,
  })
  const win = (f: string) => S.windows.filter((w: any) => w.facade === f).reduce((t: number, w: any) => t + w.width_m * w.height_m, 0)
  const warm = roof === 'mono_warm'
  // Mono-pitch, high side north: the north wall is Hh + rise tall, the east and west walls carry the triangle.
  const surfaces: any[] = [
    surf('south', 'wall', 'room', 'outside', W * Hh - win('south'), 180, 90, 'wall'),
    surf('north', 'wall', 'room', 'outside', W * (Hh + (warm ? g.rise : 0)) - win('north'), 0, 90, 'wall'),
    surf('east', 'wall', 'room', 'outside', D * Hh + (warm ? g.gable_m2 : 0), 90, 90, 'wall'),
    surf('west', 'wall', 'room', 'outside', D * Hh + (warm ? g.gable_m2 : 0), 270, 90, 'wall'),
    surf('floor', 'floor', 'room', 'outside', W * D, null, 180, 'floor', { solar_absorptance: 0 }),
  ]
  for (const w of S.windows) {
    surfaces.push(surf(`${w.facade}_window`, 'glazing', 'room', 'outside', w.width_m * w.height_m, w.facade === 'south' ? 180 : 0, 90, 'window', {
      solar_absorptance: null, frame_fraction: 0, inside_solar_absorptance: null,
    }))
  }
  const zones: any[] = []
  const room = {
    id: 'room', name: 'room', floor: 0, storeys: 1, polygon: [[0, 0], [W, 0], [W, D], [0, D]], area_m2: W * D,
    // A warm roof: the room is open to the slope, so its volume includes the void.
    height_m: warm ? (W * D * Hh + g.loft_m3) / (W * D) : Hh, use_type: 'test', rooms: null,
    profile_refs: { occupancy: null, lighting: [], equipment: [], auxiliary: [] },
    setpoints: { heat_c: S.heat_c, cool_c: c.cool ? S.cool_c : null, setback_c: null, hours_ref: null, control_strategy: 'active_setpoint' },
    ventilation: [], infiltration_q50: null, infiltration_ach: S.room_ach, internal_heat_capacity_j_per_k_m2: 0, emitters: [],
    surfaces: [] as string[],
  }
  zones.push(room)
  if (roof === 'flat') surfaces.push(surf('roof', 'roof', 'room', 'outside', W * D, null, 0, 'flat_roof'))
  if (warm) surfaces.push(surf('slope', 'roof', 'room', 'outside', g.slope_m2, 180, S.mono.pitch_deg, 'warm_slope'))
  if (roof === 'gable_cold') {
    surfaces.push(surf('ceiling', 'ceiling', 'room', 'loft', W * D, null, 0, 'ceiling', { inside_solar_absorptance_b: ia }))
    surfaces.push(surf('slope_s', 'roof', 'loft', 'outside', g.slope_m2, 180, S.gable.pitch_deg, 'tiles'))
    surfaces.push(surf('slope_n', 'roof', 'loft', 'outside', g.slope_m2, 0, S.gable.pitch_deg, 'tiles'))
    surfaces.push(surf('gable_e', 'wall', 'loft', 'outside', g.gable_m2, 90, 90, 'wall'))
    surfaces.push(surf('gable_w', 'wall', 'loft', 'outside', g.gable_m2, 270, 90, 'wall'))
    zones.push({
      id: 'loft', name: 'loft', floor: 1, storeys: 1, polygon: [[0, 0], [W, 0], [W, D], [0, D]], area_m2: W * D, height_m: g.loft_m3 / (W * D),
      use_type: 'loft', rooms: null, profile_refs: { occupancy: null, lighting: [], equipment: [], auxiliary: [] },
      setpoints: { heat_c: null, cool_c: null, setback_c: null, hours_ref: null, control_strategy: null },
      ventilation: [], infiltration_q50: null, infiltration_ach: S.loft_ach, internal_heat_capacity_j_per_k_m2: 0, emitters: [],
      surfaces: [] as string[], conditioning: 'unconditioned', unconditioned_kind: 'ventilated_loft',
    })
  }
  for (const z of zones) z.surfaces = surfaces.filter((s) => s.zone_a === z.id || s.zone_b === z.id).map((s) => s.id)
  const doc = ModelDocument.parse({
    schema_version: '2.12',
    building: {
      id: `loft-box-${caseName}`, name: `Loft box ${caseName}`, decoded_building_key: null,
      site: { lat: 41.98, lon: -87.92, name: 'Chicago O\'Hare', exposure: null, ground: { method: 'annual_mean_outdoor' } },
      orientation_deg: 0, reported_floor_area_m2: null, thermal_bridging: { mode: 'absent', multiplier: null, alpha_pct: null },
      thermal_mass: { mode: null, category: null }, opening_defaults: {}, air: { method: 'today', exponent: null, single_sided_turbulence: null },
    },
    zones, surfaces, system_groups: [], profiles: [], controls: [],
    services: { heating: { setpoint_mode: 'follow_comfort', setpoint_c: null }, cooling: { setpoint_mode: 'follow_comfort', setpoint_c: null }, dhw: { storage_setpoint_c: null, tap_outlet_temp_c: null, cold_supply_temp_c: null, load_shape: null, circulation_pump_w: null } },
    weather_ref: { kind: 'epw', station_id: '725300', file_name: 'USA_IL_Chicago-OHare.Intl.AP.725300_TMY3.epw', file_hash: S.weather.sha256 },
    library_refs: [],
  })
  return { doc, lib, geometry: g }
}
