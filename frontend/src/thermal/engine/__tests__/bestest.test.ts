/**
 * Brief 103 Part 4 gate: the published reference case (decision 4), ASHRAE Standard 140 / BESTEST Cases 600 and 900.
 *
 * Inputs: the open LBNL Modelica Buildings library's BESTEST models (BSD licence; Buildings.ThermalZones.Detailed.
 * Validation.BESTEST, Cases6xx/Case600FF.mo, Cases9xx/Case900FF.mo, Data/Win600.mo, Glass600.mo,
 * ExteriorWallCase900.mo, FloorCase900.mo, read 15 Nov 2026), which implement the Standard 140 specification.
 * Reference ranges: the same models' `staRes` records (ASHRAE 140 reference programs, the edition that uses the
 * Denver TMY3 725650 weather file).
 *
 * Weather: USA_CO_Denver.Intl.AP.725650_TMY3.mos from the same library (local data under data/weather/reference,
 * not in git; sha256 pinned below; the case skips when absent, as the anchor EPW does).
 *
 * Known differences, stated and not tuned (Rule 10): constant g with ISO's F_W 0.9 (Standard 140 specifies angular
 * transmittance); transmitted solar is spread over inside surfaces by area with none lost back out of the window;
 * ISO 52016-1 Table 25 surface coefficients instead of the specification's; the floor's outside face keeps the
 * outside film and long-wave exchange (no solar, no sky).
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ModelDocument } from '../../schema/model'
import { REFEREE_OPTIONS, runZoneModel, type RunOptions } from '../model'
import type { Weather } from '../types'

import { LIB, MOS, MOS_SHA, readMos, window600 } from './denver'

function doc(wall: string, floor: string) {
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
    schema_version: '2.3',
    building: { id: 'bestest', name: 'BESTEST', decoded_building_key: null, site: { lat: 39.83, lon: -104.65, name: 'Denver', exposure: null, ground: { method: 'annual_mean_outdoor' } }, orientation_deg: 0, reported_floor_area_m2: null, thermal_bridging: { mode: 'absent', multiplier: null, alpha_pct: null }, thermal_mass: { mode: null, category: null }, opening_defaults: {} },
    zones: [{
      id: 'z', name: 'Case', floor: 0, storeys: 1, polygon: [[0, 0], [8, 0], [8, 6], [0, 6]], area_m2: 48, height_m: 2.7, use_type: 'test', rooms: null,
      profile_refs: { occupancy: null, lighting: [], equipment: [], auxiliary: [] },
      setpoints: { heat_c: 20, cool_c: 27, setback_c: null, hours_ref: null, control_strategy: 'active_setpoint' },
      // 0.5 ach at Denver's altitude is 0.414 ach of sea-level air (as the Modelica case); no internal mass beyond air.
      ventilation: [], infiltration_q50: null, infiltration_ach: 0.414, internal_heat_capacity_j_per_k_m2: 0,
      surfaces: surfaces.map((x) => x.id),
    }],
    surfaces, system_groups: [], profiles: [],
    services: { heating: { setpoint_mode: 'follow_comfort', setpoint_c: null }, cooling: { setpoint_mode: 'follow_comfort', setpoint_c: null }, dhw: { storage_setpoint_c: null, tap_outlet_temp_c: null, cold_supply_temp_c: null, demand_basis: null, litres_per_person_per_day: null, litres_per_m2_per_day: null, load_shape: null, circulation_pump_w: null } },
    weather_ref: { kind: 'epw', station_id: '725650', file_name: 'USA_CO_Denver.Intl.AP.725650_TMY3.mos', file_hash: MOS_SHA },
    library_refs: [],
  })
}

/** 200 W continuous, 60 % radiant (Case600FF.mo qRadGai 120 W, qConGai 80 W). */
const OPTIONS: RunOptions = { ...REFEREE_OPTIONS, other_gains: { w: new Float64Array(8760).fill(200), convective_fraction: 0.4 } }

// Ranges: Case600.mo / Case900.mo staRes (MWh, kW).
const RANGES = {
  600: { heat: [3.993, 4.504], cool: [5.432, 6.162], peakHeat: [3.020, 3.359], peakCool: [5.422, 6.481] },
  900: { heat: [1.379, 1.814], cool: [2.267, 2.714], peakHeat: [2.443, 2.778], peakCool: [2.556, 3.376] },
} as const

export const BESTEST_RESULTS: Record<string, unknown> = {}

describe('ASHRAE 140 / BESTEST (committed reference weather)', () => {
  const weather = readMos(fs.readFileSync(MOS))
  it('reads the pinned weather file', () => {
    expect(weather.sha256).toBe(MOS_SHA)
  })
  it('the window is a 3 mm clear double pane: U about 2.9, g about 0.76', () => {
    const w = window600()
    expect(w.U).toBeGreaterThan(2.8); expect(w.U).toBeLessThan(3.0)
    expect(w.g).toBeGreaterThan(0.74); expect(w.g).toBeLessThan(0.78)
  })
  // The range gate is reported, not asserted: on 15 Nov 2026 (Brief 104 Part 1b) both cases' cooling is in range and heating
  // is above it (as EnergyPlus's own run with the same ISO simplifications is); Brief 103 escalated the heating range (docs/audit/103/04_engine_results.md) rather than tuning toward it (Rule 10).
  // What is asserted: the run closes every hour, and the result is the one recorded in the audit (so any change to
  // the physics shows up here and must be re-recorded with its reason).
  // Re-recorded in Part 6b when REFEREE_OPTIONS put the beam on the floor (was 600: 4.698 / 5.725, 900: 2.436 / 2.976).
  const RECORDED = { 600: { heat: 4.574, cool: 5.510 }, 900: { heat: 2.048, cool: 2.424 } } as const  // Brief 104 Part 1b: optical windows, Perez sky, no solar to air (was 4.547 / 5.628, 2.186 / 2.755)
  for (const [name, wall, floor] of [['600', 'wall600', 'floor600'], ['900', 'wall900', 'floor900']] as const) {
    it(`Case ${name}: closes every hour; result as recorded; range verdict printed`, () => {
      const r = runZoneModel(doc(wall, floor), weather, LIB, OPTIONS)
      const got = { heat: r.annual.heating_kwh / 1000, cool: r.annual.cooling_kwh / 1000, peakHeat: r.annual.peak_heating_w / 1000, peakCool: r.annual.peak_cooling_w / 1000 }
      const rg = RANGES[name]
      const verdict = Object.fromEntries((Object.keys(rg) as (keyof typeof rg)[]).map((k) => [k, `${got[k].toFixed(3)} ${got[k] < rg[k][0] ? 'BELOW' : got[k] > rg[k][1] ? 'ABOVE' : 'in'} [${rg[k][0]}, ${rg[k][1]}]`]))
      console.log(`BESTEST ${name}`, JSON.stringify(verdict))
      expect(r.closure.max_wh).toBeLessThanOrEqual(1)
      // Rule 9: the displayed breakdown, demand included, sums to zero (runZoneModel also refuses a run where it does not).
      expect(Math.abs(r.closure.sum_kwh)).toBeLessThan(1e-3)
      expect(got.heat).toBeCloseTo(RECORDED[name].heat, 3)
      expect(got.cool).toBeCloseTo(RECORDED[name].cool, 3)
    })
  }
})

describe('the engine refuses what it cannot carry', () => {
  const fakeWeather = { hours: { count: 24 } } as unknown as Weather
  it('a library y-factor other than 1, on an opaque element or glazing, naming the surface and the library item', () => {
    const lib = { ...LIB, wall600: { ...LIB.wall600, y_factor: 1.15 } }
    expect(() => runZoneModel(doc('wall600', 'floor600'), fakeWeather, lib, OPTIONS)).toThrow('surfaces[0].construction_ref (library "wall600").y_factor')
    const d = doc('wall600', 'floor600')
    const libG = { ...LIB, window600: { ...LIB.window600, y_factor: 1.1 } }
    expect(() => runZoneModel(d, readMosOnce(), libG, OPTIONS)).toThrow('window600')
  })
  it('a y-factor of exactly 1 (no uplift) is accepted', () => {
    const lib = { ...LIB, wall600: { ...LIB.wall600, y_factor: 1 } }
    expect(runZoneModel(doc('wall600', 'floor600'), readMosOnce(), lib, OPTIONS).annual.heating_kwh).toBeCloseTo(4574, 0)
  })
})
let mosCache: Weather | null = null
function readMosOnce() { return (mosCache ??= readMos(fs.readFileSync(MOS))) }
