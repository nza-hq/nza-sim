/**
 * The Brief 104 cooled room as a model document (validation/energyplus/104_cooled_room_spec.json), shared by the
 * multi-zone gate (multizone.test.ts (e)) and the gains twin (cooled_room_gains.test.ts). Moved here unchanged.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ConstructionBody } from '../elements'
import { ModelDocument } from '../../schema/model'
import { MOS_SHA } from './denver'

const repo = (p: string) => path.resolve(__dirname, '../../../../..', p)
export const SPEC = JSON.parse(fs.readFileSync(repo('validation/energyplus/104_cooled_room_spec.json'), 'utf8'))

export function cooledRoomDocument() {
  const layers = (c: number[][]) => c.map(([d, k, cp, rho]) => (rho > 0 ? { kind: 'Material', thickness: d, conductivity: k, density: rho, specific_heat: cp } : { kind: 'Material:NoMass', thermal_resistance: d / k }))
  const lib: Record<string, ConstructionBody> = {
    wall: { layers: layers(SPEC.constructions.wall) }, roof: { layers: layers(SPEC.constructions.roof) },
    floor: { layers: layers(SPEC.constructions.floor) }, partition: { layers: layers(SPEC.constructions.partition) },
    window: { u_value_W_per_m2K: SPEC.window.u_w_per_m2k, g_value: SPEC.window.shgc, layers: [] },
  }
  const D = SPEC.depth_m, Hh = SPEC.height_m
  const ia = SPEC.inside_solar_absorptance
  const outside = (id: string, zone: string, kind: string, area: number, az: number | null, tilt: number, key: string, x: Record<string, unknown> = {}) => ({
    id, kind, zone_a: zone, zone_b: 'outside', facade: null, area_m2: area, azimuth_deg: az, tilt_deg: tilt, construction_ref: { key },
    g_value: null, openings: [], solar_absorptance: SPEC.solar_absorptance, thermal_emissivity: SPEC.thermal_emissivity, frame_fraction: null,
    inside_solar_absorptance: ia, inside_solar_absorptance_b: null, faces_up: null, ...x,
  })
  const rooms: any[] = SPEC.rooms
  const surfaces: any[] = []
  const zones = rooms.map((r, i) => {
    const w = r.x1 - r.x0, win = r.window_width_m * SPEC.window.height_m
    const own = [
      outside(`${r.id}_south`, r.id, 'wall', w * Hh - win, 180, 90, 'wall'),
      outside(`${r.id}_north`, r.id, 'wall', w * Hh, 0, 90, 'wall'),
      outside(`${r.id}_roof`, r.id, 'roof', w * D, null, 0, 'roof'),
      outside(`${r.id}_floor`, r.id, 'floor', w * D, null, 180, 'floor', { solar_absorptance: 0 }),
      outside(`${r.id}_window`, r.id, 'glazing', win, 180, 90, 'window', { solar_absorptance: null, frame_fraction: 0, inside_solar_absorptance: null }),
    ]
    if (i === 0) own.push(outside(`${r.id}_west`, r.id, 'wall', D * Hh, 270, 90, 'wall'))
    if (i === rooms.length - 1) own.push(outside(`${r.id}_east`, r.id, 'wall', D * Hh, 90, 90, 'wall'))
    surfaces.push(...own)
    return {
      id: r.id, name: r.id, floor: 0, storeys: 1, polygon: [[r.x0, 0], [r.x1, 0], [r.x1, D], [r.x0, D]], area_m2: w * D, height_m: Hh, use_type: 'test', rooms: null,
      profile_refs: { occupancy: null, lighting: [], equipment: [], auxiliary: [] },
      setpoints: { heat_c: r.heat_c, cool_c: r.cool_c, setback_c: null, hours_ref: null, control_strategy: 'active_setpoint' },
      ventilation: [], infiltration_q50: null, infiltration_ach: SPEC.infiltration_ach_sea_level_air, internal_heat_capacity_j_per_k_m2: 0, emitters: [],
      surfaces: own.map((s) => s.id),
    }
  })
  for (let i = 0; i + 1 < rooms.length; i++) {
    const a = rooms[i].id, b = rooms[i + 1].id
    surfaces.push({
      id: `${a}_to_${b}`, kind: 'partition', zone_a: a, zone_b: b, facade: null, area_m2: D * Hh, azimuth_deg: null, tilt_deg: 90,
      construction_ref: { key: 'partition' }, g_value: null, openings: [], solar_absorptance: null, thermal_emissivity: null, frame_fraction: null,
      inside_solar_absorptance: ia, inside_solar_absorptance_b: ia, faces_up: null,
    })
    zones[i].surfaces.push(`${a}_to_${b}`); zones[i + 1].surfaces.push(`${a}_to_${b}`)
  }
  const doc = ModelDocument.parse({
    schema_version: '2.4',
    building: { id: 'cooled-room', name: 'Cooled room', decoded_building_key: null, site: { lat: 39.83, lon: -104.65, name: 'Denver', exposure: null, ground: { method: 'annual_mean_outdoor' } }, orientation_deg: 0, reported_floor_area_m2: null, thermal_bridging: { mode: 'absent', multiplier: null, alpha_pct: null }, thermal_mass: { mode: null, category: null }, opening_defaults: {} },
    zones, surfaces, system_groups: [], profiles: [],
    services: { heating: { setpoint_mode: 'follow_comfort', setpoint_c: null }, cooling: { setpoint_mode: 'follow_comfort', setpoint_c: null }, dhw: { storage_setpoint_c: null, tap_outlet_temp_c: null, cold_supply_temp_c: null, demand_basis: null, litres_per_person_per_day: null, litres_per_m2_per_day: null, load_shape: null, circulation_pump_w: null } },
    weather_ref: { kind: 'epw', station_id: '725650', file_name: 'USA_CO_Denver.Intl.AP.725650_TMY3.mos', file_hash: MOS_SHA },
    library_refs: [],
  })
  return { doc, lib }
}

