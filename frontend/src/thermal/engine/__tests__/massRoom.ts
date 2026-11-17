/**
 * Brief 124: the concrete-frame office room of the 17 Nov thermal-mass investigation as a model document, from
 * validation/energyplus/mass_finishes_spec.json (which validation/energyplus/mass_finishes.py builds for EnergyPlus).
 * The slab and the partition join the room to identical neighbours, so both their faces are in the room (internal
 * mass). `finishes`: the carpet and the suspended ceiling as inside finishes on the structure (Brief 124 D3) instead of
 * layers of the slab's own construction; the layer stack is the same.
 */
import { ModelDocument, SCHEMA_VERSION } from '../../schema/model'
import type { Weather } from '../types'

const FINISH_MATERIALS = ['carpet', 'void', 'tile']
const layer = ([d, k, cp, rho]: number[]) => (rho > 0 ? { kind: 'Material', thickness: d, conductivity: k, density: rho, specific_heat: cp } : { kind: 'Material:NoMass', thermal_resistance: d / k })

export function build(SPEC: any, weather: Weather, weatherFile: string, caseName: string, contents: number, conditioned: boolean, opts: { finishes?: boolean } = {}) {
  const W = SPEC.width_m, D = SPEC.depth_m, H = SPEC.height_m
  const win = SPEC.window.width_m * SPEC.window.height_m
  const lib: Record<string, any> = {
    ext: { layers: SPEC.external_wall.map(layer) },
    part: { layers: SPEC.partition.map(layer) },
    slab: { layers: SPEC.cases[caseName].filter((m: string) => !opts.finishes || !FINISH_MATERIALS.includes(m)).map((m: string) => layer(SPEC.materials[m])) },
    // Brief 124 D3: the same finishes as library-style finish constructions, layers from the structure to the room.
    finish_carpet: { layers: [layer(SPEC.materials.carpet)] },
    finish_suspended_ceiling: { layers: [layer(SPEC.materials.void), layer(SPEC.materials.tile)] },
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
    { ...base, id: 'slab', kind: 'internal_mass', zone_a: 'room', zone_b: 'room', area_m2: W * D, azimuth_deg: null, tilt_deg: 180, construction_ref: { key: 'slab' }, solar_absorptance: null, thermal_emissivity: null, inside_solar_absorptance_b: 0.6, faces_up: true,
      ...(opts.finishes ? {
        inside_finish: SPEC.cases[caseName].includes('carpet') ? { key: 'finish_carpet' } : null,
        inside_finish_b: SPEC.cases[caseName].includes('void') ? { key: 'finish_suspended_ceiling' } : null,
      } : {}) },
  ]
  const [on, off] = SPEC.gains.weekday_on
  const day = Array.from({ length: 24 }, (_, h) => (h >= on && h < off ? 1 : 0))
  const zero = Array(24).fill(0)
  const doc = ModelDocument.parse({
    schema_version: SCHEMA_VERSION,
    building: { id: 'mass', name: 'Mass behind finishes', decoded_building_key: null, site: { lat: weather.header.latitude, lon: weather.header.longitude, name: weather.header.city, exposure: null, ground: { method: 'annual_mean_outdoor' }, terrain: null }, air: { method: 'today', exponent: null, single_sided_turbulence: null }, orientation_deg: 0, reported_floor_area_m2: null, thermal_bridging: { mode: 'absent', multiplier: null, alpha_pct: null }, thermal_mass: { mode: null, category: null }, opening_defaults: {} },
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
    weather_ref: { kind: 'epw', station_id: weather.header.wmo, file_name: weatherFile, file_hash: weather.sha256 },
    library_refs: [],
  })
  return { doc, lib }
}

