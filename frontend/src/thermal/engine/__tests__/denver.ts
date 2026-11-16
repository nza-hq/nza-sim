/**
 * The Denver reference weather and the BESTEST constructions, shared by the BESTEST gate (Brief 103) and the
 * multi-zone cooled room (Brief 104 Part 4). Moved here unchanged from bestest.test.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ConstructionBody } from '../elements'
import type { Weather } from '../types'
import { ModelDocument } from '../../schema/model'

// Committed (validation/fixtures/weather/README.md), so this gate runs from a fresh checkout.
export const MOS = path.resolve(__dirname, '../../../../../validation/fixtures/weather/USA_CO_Denver.Intl.AP.725650_TMY3.mos')
export const MOS_SHA = '13f5a77b445b558dd162880a98e00ecaffe3bf567d88ca8581dfa88b589fbb48'
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** The Modelica table: row k (t = k·3600 s) holds TMY3 hour k (hour ending); row 0 repeats hour 1, so hour 8760 is absent and repeats 8759. */
export function readMos(bytes: Buffer): Weather {
  const rows = bytes.toString('latin1').split('\n').filter((l) => l && !l.startsWith('#') && l.split('\t').length > 20).map((l) => l.trim().split(/\s+/).map(Number))
  if (rows.length !== 8760) throw new Error(`expected 8760 rows, found ${rows.length}`)
  const n = 8760, f = () => new Float64Array(n)
  const w: Weather = {
    header: { city: 'Denver Intl Ap', region: 'CO', country: 'USA', source: 'TMY3', wmo: '725650', latitude: 39.83, longitude: -104.65, time_zone: -7, elevation: 1650 },
    hours: { count: n, year: new Int16Array(n), month: new Int8Array(n), day: new Int8Array(n), hour: new Int8Array(n), dry_bulb: f(), dew_point: f(), relative_humidity: f(), pressure: f(), global_horizontal: f(), direct_normal: f(), diffuse_horizontal: f(), wind_direction: f(), wind_speed: f(), total_sky_cover: f(), opaque_sky_cover: f() },
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  let i = 0
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= MONTH_DAYS[m - 1]; d++) for (let hr = 1; hr <= 24; hr++, i++) {
    const r = rows[Math.min(i + 1, n - 1)]
    const H = w.hours
    H.year[i] = 1990; H.month[i] = m; H.day[i] = d; H.hour[i] = hr
    H.dry_bulb[i] = r[1]; H.dew_point[i] = r[2]; H.relative_humidity[i] = r[3]; H.pressure[i] = r[4]
    H.global_horizontal[i] = r[8]; H.direct_normal[i] = r[9]; H.diffuse_horizontal[i] = r[10]; H.wind_speed[i] = r[16]
  }
  return w
}

export const L = (thickness: number, conductivity: number, specific_heat: number, density: number) =>
  density > 0 ? { kind: 'Material', thickness, conductivity, density, specific_heat } : { kind: 'Material:NoMass', thermal_resistance: thickness / conductivity }
// Outside first, as the library stores them (Modelica's material[1] is the outside layer).
export const LIB: Record<string, ConstructionBody> = {
  wall600: { layers: [L(0.009, 0.14, 900, 530), L(0.066, 0.04, 840, 12), L(0.012, 0.16, 840, 950)] },
  roof600: { layers: [L(0.019, 0.14, 900, 530), L(0.1118, 0.04, 840, 12), L(0.010, 0.16, 840, 950)] },
  floor600: { layers: [L(1.003, 0.04, 0, 0), L(0.025, 0.14, 1200, 650)] },
  wall900: { layers: [L(0.009, 0.14, 900, 530), L(0.0615, 0.04, 1400, 10), L(0.100, 0.51, 1000, 1400)] },
  floor900: { layers: [L(1.007, 0.04, 0, 0), L(0.080, 1.13, 1000, 1400)] },
}

/**
 * The window's U and normal-incidence g from Glass600 (3.048 mm, k 1.0, τ 0.834, ρ 0.075, ε 0.84) and a 12 mm air
 * gap: EN 673 for U (gap h_r + λ/s, ISO 6946 films), ISO 9050 §5.4.4 for the secondary heat transfer of a double pane.
 */
export function window600() {
  const tau = 0.834, rho = 0.075, a = 1 - tau - rho, eps = 0.84, sig = 5.67e-8, Tm = 283.15
  const hr = (4 * sig * Tm ** 3) / (2 / eps - 1), hg = 0.025 / 0.012, Lam = hr + hg
  const Rse = 0.04, Rsi = 0.13
  const U = 1 / (Rse + Rsi + 2 * 0.003048 + 1 / Lam)
  const den = 1 - rho * rho
  const T = (tau * tau) / den, A1 = a + (a * tau * rho) / den, A2 = (a * tau) / den
  const he = 1 / Rse, hi = 1 / Rsi
  const qi = ((A1 + A2) / he + A2 / Lam) / (1 / hi + 1 / he + 1 / Lam)
  return { U, g: T + qi }
}

/** The BESTEST Case 600/900 document (moved here from bestest.test.ts for Brief 105 Part 6's measurement script). */
export function bestestDoc(wall: string, floor: string) {
  const win = window600()
  LIB.window600 = { u_value_W_per_m2K: win.U, g_value: win.g, layers: [] }
  const s = (id: string, kind: string, area: number, az: number | null, tilt: number, key: string, x: Record<string, unknown> = {}) => ({
    id, kind, zone_a: 'z', zone_b: 'outside', facade: null, area_m2: area, azimuth_deg: az, tilt_deg: tilt,
    construction_ref: { key }, g_value: null, openings: [], solar_absorptance: 0.6, thermal_emissivity: 0.9, frame_fraction: null, inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null, faces_up: null, ...x,
  })
  const surfaces = [
    s('south', 'wall', 8 * 2.7 - 12, 180, 90, wall), s('east', 'wall', 6 * 2.7, 90, 90, wall), s('west', 'wall', 6 * 2.7, 270, 90, wall),
    s('north', 'wall', 8 * 2.7, 0, 90, wall), s('roof', 'roof', 48, null, 0, 'roof600'),
    s('floor', 'floor', 48, null, 180, floor, { solar_absorptance: 0 }),
    s('window', 'glazing', 12, 180, 90, 'window600', { solar_absorptance: null, frame_fraction: 0, inside_solar_absorptance: null }),
  ]
  return ModelDocument.parse({
    schema_version: '2.9',
    building: { id: 'bestest', name: 'BESTEST', decoded_building_key: null, site: { lat: 39.83, lon: -104.65, name: 'Denver', exposure: null, ground: { method: 'annual_mean_outdoor' } }, orientation_deg: 0, reported_floor_area_m2: null, thermal_bridging: { mode: 'absent', multiplier: null, alpha_pct: null }, thermal_mass: { mode: null, category: null }, opening_defaults: {} },
    zones: [{
      id: 'z', name: 'Case', floor: 0, storeys: 1, polygon: [[0, 0], [8, 0], [8, 6], [0, 6]], area_m2: 48, height_m: 2.7, use_type: 'test', rooms: null,
      profile_refs: { occupancy: null, lighting: [], equipment: [], auxiliary: [] },
      setpoints: { heat_c: 20, cool_c: 27, setback_c: null, hours_ref: null, control_strategy: 'active_setpoint' },
      // 0.5 ach at Denver's altitude is 0.414 ach of sea-level air (as the Modelica case); no internal mass beyond air.
      ventilation: [], infiltration_q50: null, infiltration_ach: 0.414, internal_heat_capacity_j_per_k_m2: 0, emitters: [],
      surfaces: surfaces.map((x) => x.id),
    }],
    surfaces, system_groups: [], profiles: [],
    services: { heating: { setpoint_mode: 'follow_comfort', setpoint_c: null }, cooling: { setpoint_mode: 'follow_comfort', setpoint_c: null }, dhw: { storage_setpoint_c: null, tap_outlet_temp_c: null, cold_supply_temp_c: null, load_shape: null, circulation_pump_w: null } },
    weather_ref: { kind: 'epw', station_id: '725650', file_name: 'USA_CO_Denver.Intl.AP.725650_TMY3.mos', file_hash: MOS_SHA },
    library_refs: [],
  })
}
