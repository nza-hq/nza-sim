/**
 * Brief 125: EnergyPlus's outside film. The DOE-2 samples are EnergyPlus 25.2's own outputs on the extended school
 * (London St James Park TMYx, 4 steps an hour): z3_wall_1 (south, MediumRough, centroid 1.6 m, Suburbs) and its glass,
 * the face's temperature at the step before, the site's wind and direction, and the coefficient EnergyPlus reported.
 */
import { describe, expect, it } from 'vitest'
import { doe2Film, filmStep, naturalFilm, outsideFace, outsideFaceZ, rainInputs } from '../outsideConvection'
import { EP_TERRAIN, siteTerrain, wetBulb, windFactorAt } from '../airflow'
import { ENGINE_CONSTANTS as K } from '../constants'

const EP = [
  { glazing: false, dT: 2.9113, v: 0.0, dir: 6.75, h: 1.8707 }, { glazing: false, dT: 3.3604, v: 2.5, dir: 272.0, h: 5.7073 },
  { glazing: false, dT: 4.0826, v: 3.1, dir: 237.5, h: 6.641 }, { glazing: false, dT: 7.6268, v: 2.1, dir: 333.5, h: 5.3441 },
  { glazing: false, dT: 11.9722, v: 0.0, dir: 55.75, h: 2.997 }, { glazing: false, dT: 3.4514, v: 3.1, dir: 251.0, h: 6.6306 },
  { glazing: true, dT: 3.3986, v: 0.0, dir: 6.75, h: 1.9697 }, { glazing: true, dT: 2.0716, v: 2.5, dir: 272.0, h: 4.3046 },
  { glazing: true, dT: 0.8319, v: 3.1, dir: 237.5, h: 4.7954 }, { glazing: true, dT: 3.9645, v: 2.1, dir: 333.5, h: 4.1221 },
  { glazing: true, dT: 6.3907, v: 0.0, dir: 55.75, h: 2.4312 }, { glazing: true, dT: 1.0668, v: 3.1, dir: 251.0, h: 4.8239 },
]

describe('Brief 125: the outside film as EnergyPlus works it out', () => {
  it("EnergyPlus's wind at the face's height (its Surface Outside Face Outdoor Air Wind Speed: 1.1974 m/s at 2.5 m/s)", () => {
    expect(windFactorAt(1.6, 'Suburbs') * 2.5).toBeCloseTo(1.1974, 3)
    expect(windFactorAt(0, 'Suburbs')).toBe(0)
  })
  it("DOE-2 against EnergyPlus's own coefficients, windward and leeward, wall and glass (within 0.02 W/m²K)", () => {
    for (const s of EP) {
      const f = outsideFace(1.6, 'Suburbs', 180, 90, s.glazing)
      expect(Math.abs(doe2Film(f, s.dT, s.v, s.dir) - s.h)).toBeLessThan(0.02)
    }
  })
  it('no wind: natural convection only; a flat roof is always windward; never below EnergyPlus’s 0.1', () => {
    const wall = outsideFace(1.6, 'Suburbs', 180, 90, false)
    expect(doe2Film(wall, 3, 0, 0)).toBeCloseTo(naturalFilm(3, 0), 12)
    expect(naturalFilm(3, 0)).toBeCloseTo(1.31 * Math.cbrt(3), 2)
    const roof = outsideFace(6, 'Suburbs', 0, 0, false)
    const v = 3, V = windFactorAt(6, 'Suburbs') * v, hn = naturalFilm(-2, 1)
    expect(doe2Film(roof, -2, v, 180)).toBeCloseTo(hn + K.doe2_roughness_opaque * (Math.hypot(hn, K.doe2_windward_a * Math.pow(V, K.doe2_windward_b)) - hn), 10)
    expect(doe2Film(wall, 0, 0, 0)).toBe(K.h_ce_min)
  })
  it('heights: walls at mid-zone, roofs at the top, exposed floors at the floor', () => {
    const z = { floor: 1, height_m: 3, storeys: 2 }
    expect(outsideFaceZ(z, 90)).toBe(6)
    expect(outsideFaceZ(z, 30)).toBe(9)
    expect(outsideFaceZ(z, 180)).toBe(3)
  })
  it("the site's terrain: the translator's mapping, Suburbs when unstated", () => {
    expect(siteTerrain({ terrain: 'urban' })).toEqual({ terrain: 'City', stated: true })
    expect(siteTerrain({ terrain: null, exposure: 'sheltered' })).toEqual({ terrain: 'City', stated: true })
    expect(siteTerrain({})).toEqual({ terrain: 'Suburbs', stated: false })
    expect(EP_TERRAIN.City.exponent).toBe(0.33)
  })
  it('rain, read between hours as EnergyPlus does: the weather code ≥ 0.5, or precipitation ≥ 0.8 mm', () => {
    const n = 4
    const r = rainInputs({
      count: n, present_weather_observation: Float64Array.of(9, 0, 9, 9),
      present_weather_codes: ['999999999', '919999999', '999999999', '999999999'], liquid_precipitation_mm: Float64Array.of(0, 0, 0, 2),
    })
    expect(Array.from(r.rain_code!)).toEqual([0, 1, 0, 0])
    const wx = { wind_speed: new Float64Array(n), wind_direction: new Float64Array(n), w: new Float64Array(n).fill(0.006), pressure: new Float64Array(n).fill(101325), ...r }
    const st = { v: 0, dir: 0, rain: false, wet_bulb: 0 }
    // Hour 1 (coded): its first quarter is 0.25 of the code, then 0.5 and on; hour 2's first half still 0.75 and 0.5.
    expect([0.25, 0.5, 0.75, 1].map((f) => filmStep(wx, 1, f, 10, st).rain)).toEqual([false, true, true, true])
    expect([0.25, 0.5, 0.75, 1].map((f) => filmStep(wx, 2, f, 10, st).rain)).toEqual([true, true, false, false])
    // Hour 3: 2 mm, read from 0: 0.5, 1.0, 1.5, 2.0 mm.
    expect([0.25, 0.5, 0.75, 1].map((f) => filmStep(wx, 3, f, 10, st).rain)).toEqual([false, true, true, true])
    const wet = filmStep(wx, 1, 1, 10, st)
    expect(wet.wet_bulb).toBeLessThan(10)
    expect(rainInputs({ count: 2 })).toEqual({ rain_code: null, precipitation_mm: null })
  })
  it('the wet bulb (20 °C, 50 % RH at sea level ≈ 13.7 °C; saturated air: the dry bulb)', () => {
    const pv = 0.5 * 610.94 * Math.exp((17.625 * 20) / (20 + 243.04))
    const w = (0.621945 * pv) / (101325 - pv)
    expect(wetBulb(20, w, 101325)).toBeCloseTo(13.7, 0)
    const ws = (0.621945 * 610.94 * Math.exp((17.625 * 5) / (5 + 243.04))) / (101325 - 610.94 * Math.exp((17.625 * 5) / (5 + 243.04)))
    expect(wetBulb(5, ws, 101325)).toBeCloseTo(5, 3)
  })
  it('wind between hours on a line, direction the short way round', () => {
    const wx = { wind_speed: Float64Array.of(2, 4), wind_direction: Float64Array.of(350, 10), w: Float64Array.of(0.006, 0.006), pressure: Float64Array.of(101325, 101325), rain_code: null, precipitation_mm: null }
    const st = filmStep(wx, 1, 0.5, 10, { v: 0, dir: 0, rain: false, wet_bulb: 0 })
    expect(st.v).toBeCloseTo(3, 12)
    expect(st.dir).toBeCloseTo(0, 9)
    expect(st.rain).toBe(false)
  })
})

import { opaqueElement, windowElement, type Layer } from '../elements'
import { runNetwork, type NetworkInputs } from '../network'

describe('Brief 125: the film in the network solver', () => {
  const H = 24 * 4
  const LAYERS: Layer[] = [
    { kind: 'Material', thickness: 0.1, conductivity: 0.8, density: 1800, specific_heat: 900 },
    { kind: 'Material:NoMass', thermal_resistance: 0.3 },
  ]
  const te = Float64Array.from({ length: H }, (_, h) => 4 + 4 * Math.sin((h / 24) * 2 * Math.PI))
  const el = (id: string, tilt: number) => ({
    // Emissivity 0.01: almost no long-wave to the sky, so these checks see convection alone (a calm face at night is
    // otherwise cooled below the air by the sky and loses more than a windy one, which is right but not what is tested).
    element: opaqueElement({ id, area_m2: 30, tilt_deg: tilt, boundary: 'outside', layers: LAYERS, stated_u: null, emissivity: 0.01, path: id }),
    zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: new Float64Array(H), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null,
  })
  const base = (more: Partial<NetworkInputs> = {}): NetworkInputs => ({
    zones: [{ air_capacity_j_per_k: 5e4, bridging_w_per_k: 0, ventilation_w_per_k: new Float64Array(H), solar_transmitted_w: new Float64Array(H), solar_beam_w: null, other_gains: null, setpoints: { heat_c: 20, cool_c: null }, initial_c: 20 }],
    elements: [el('w', 90), el('r', 0)], hours: H, theta_e: te, theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0,
    warmup_days: 10, steps_per_hour: 4, theta_e_between: 'linear', ...more,
  })
  const weather = (v: number, rainy: boolean, w = 0.004) => ({
    wind_speed: new Float64Array(H).fill(v), wind_direction: new Float64Array(H).fill(180), w: new Float64Array(H).fill(w), pressure: new Float64Array(H).fill(101325),
    rain_code: rainy ? new Float64Array(H).fill(1) : null, precipitation_mm: null,
  })
  const faces = [outsideFace(1.5, 'Suburbs', 180, 90, false), outsideFace(3, 'Suburbs', 0, 0, false)]
  const heat = (r: ReturnType<typeof runNetwork>) => r.zones[0].heating_w.reduce((s, x) => s + x, 0)

  it('no face named: the run with the option absent, value for value', () => {
    const a = runNetwork(base()), b = runNetwork(base({ outside_convection: { faces: [null, null], weather: weather(3, false) } }))
    expect(Array.from(b.zones[0].heating_w)).toEqual(Array.from(a.zones[0].heating_w))
  })
  it('every step closes; more wind loses more; calm loses less than the fixed 20 W/m²K; wet faces sit at the wet bulb', () => {
    const calm = runNetwork(base({ outside_convection: { faces, weather: weather(0, false) } }))
    const windy = runNetwork(base({ outside_convection: { faces, weather: weather(6, false) } }))
    // Rain: dry air (wet bulb well below the air) loses more than saturated air (wet bulb = the air).
    const wetDry = runNetwork(base({ outside_convection: { faces, weather: weather(6, true, 0.0005) } }))
    const wetSat = runNetwork(base({ outside_convection: { faces, weather: weather(6, true, 0.02) } }))
    const fixed = runNetwork(base())
    for (const r of [calm, windy, wetDry, wetSat]) expect(Math.max(...r.zones[0].closure_wh)).toBeLessThan(1e-6)
    expect(heat(windy)).toBeGreaterThan(heat(calm))
    expect(heat(calm)).toBeLessThan(heat(fixed))
    expect(heat(wetDry)).toBeGreaterThan(heat(wetSat))
  })
  it('refuses a film on the ground or between zones, by name', () => {
    const g = base()
    g.elements[1] = { ...g.elements[1], element: opaqueElement({ id: 'g', area_m2: 30, tilt_deg: 180, boundary: 'ground', layers: LAYERS, stated_u: null, emissivity: null, path: 'g' }) }
    expect(() => runNetwork({ ...g, outside_convection: { faces, weather: weather(3, false) } })).toThrow(/outside_convection\.faces\[1\]: only an element facing outside air/)
  })
})

import { iso15099Inside, outdoorAirRhoCp, outsideLongwave, radiantH, simpleGlazingLayerR, skyInfrared, windowLayout } from '../outsideConvection'

/**
 * Brief 126: EnergyPlus 25.2's own outputs on the plain school (London TMYx, 4 steps an hour), z3_wall_1 (south,
 * emissivity 0.9) and its glass (Simple Window Model, 0.84): the outside face's temperature at the step before, the
 * outdoor air, the file's infrared and EnergyPlus's sky temperature, its sky / air / ground coefficients; and the inside
 * face, the room air and EnergyPlus's inside convection coefficient (TARP; the glass ISO 15099, 3.16 m high).
 */
const EP126 = [
  { glazing: false, ts: 7.5514, te: 8.4, ir: 322, tsky: 1.37, sky: 1.5441, air: 0.6641, ground: 2.2674, tin: 16.9209, tz: 20, hin: 1.8997 },
  { glazing: false, ts: 10.2609, te: 6.9, ir: 300, tsky: -3.4442, sky: 1.5274, air: 0.6684, ground: 2.2822, tin: 18.9781, tz: 20, hin: 1.2707 },
  { glazing: false, ts: 14.1921, te: 8.7, ir: 297, tsky: -4.121, sky: 1.5552, air: 0.6891, ground: 2.3527, tin: 22.7426, tz: 21.4627, hin: 1.4393 },
  { glazing: false, ts: 31.3945, te: 19.1, ir: 378, tsky: 12.5978, sky: 1.8572, air: 0.7945, ground: 2.7127, tin: 26.0984, tz: 26.6338, hin: 1.0858 },
  { glazing: false, ts: 18.5519, te: 12.3, ir: 345, tsky: 6.146, sky: 1.6801, air: 0.7184, ground: 2.4528, tin: 17.7867, tz: 20, hin: 1.7227 },
  { glazing: true, ts: 7.4818, te: 8.4, ir: 322, tsky: 1.37, sky: 1.4406, air: -0.6301, ground: 2.1155, tin: 14.8805, tz: 20, hin: 1.635 },
  { glazing: true, ts: 8.9707, te: 6.9, ir: 300, tsky: -3.4442, sky: 1.4154, air: -0.6189, ground: 2.1154, tin: 14.4143, tz: 20, hin: 1.6823 },
  { glazing: true, ts: 11.0035, te: 8.7, ir: 297, tsky: -4.121, sky: 1.4262, air: -0.6317, ground: 2.159, tin: 16.5862, tz: 21.4627, hin: 1.623 },
  { glazing: true, ts: 25.0911, te: 19.1, ir: 378, tsky: 12.5978, sky: 1.6775, air: -0.7184, ground: 2.4517, tin: 29.2194, tz: 26.6338, hin: 1.3724 },
  { glazing: true, ts: 15.2618, te: 12.3, ir: 345, tsky: 6.146, sky: 1.5408, air: -0.659, ground: 2.2502, tin: 19.0768, tz: 20, hin: 1.0593 },
]

describe('Brief 126: the sky, the inside film and the window, as EnergyPlus works them out', () => {
  it("the sky's temperature from the file's infrared, and Clark and Allen's where it is missing", () => {
    for (const s of EP126) expect(Math.pow(s.ir / K.sigma, 0.25) - 273.15).toBeCloseTo(s.tsky, 3)
    const est = skyInfrared({ count: 2, dry_bulb: [5, 5], dew_point: [0, 0], opaque_sky_cover: [0, 10], horizontal_infrared: Float64Array.of(300, NaN) })
    expect(est.ir[0]).toBe(300)
    expect(est.estimated).toBe(1)
    const e = (0.787 + 0.764 * Math.log(273.15 / 273)) * (1 + 0.224 - 0.35 + 0.28)
    expect(est.ir[1]).toBeCloseTo(e * K.sigma * 278.15 ** 4, 9)
  })
  it("each face's long-wave to sky, air and ground against EnergyPlus's own coefficients (to 0.001 W/m²K)", () => {
    for (const s of EP126) {
      const f = outsideFace(1.6, 'Suburbs', 180, 90, s.glazing, s.glazing ? 0.84 : 0.9)
      const lw = outsideLongwave(f, s.ts, s.te, s.tsky, { total: 0, sky: 0 })
      expect(lw.sky).toBeCloseTo(s.sky, 3)
      expect(f.view_ground * radiantH(f.emissivity, s.ts, s.te)).toBeCloseTo(s.ground, 3)
      // EnergyPlus reports a window's air coefficient with the opposite sign, from its own window heat balance; its size
      // is within 0.02 of the formula (the wall's to 0.001).
      expect(Math.abs(f.view_air * radiantH(f.emissivity, s.ts, s.te) - Math.abs(s.air))).toBeLessThan(s.glazing ? 0.02 : 0.001)
      expect(Math.abs(lw.total - (s.sky + Math.abs(s.air) + s.ground))).toBeLessThan(s.glazing ? 0.02 : 0.001)
    }
  })
  it("inside convection: TARP on the wall, ISO 15099 on the glass, against EnergyPlus's (within 0.03 W/m²K)", () => {
    for (const s of EP126) {
      const h = s.glazing ? iso15099Inside(s.tin, s.tz, 3.16, 90, 101325, 0.006) : 1.31 * Math.cbrt(Math.abs(s.tin - s.tz))
      expect(Math.abs(h - s.hin)).toBeLessThan(s.glazing ? 0.03 : 0.3)  // the wall's from the step before (EnergyPlus iterates within it)
    }
  })
  it("the Simple Window Model's glass layer and the outdoor air's heat capacity", () => {
    expect(simpleGlazingLayerR(5.7)).toBeCloseTo(1 / 5.7 - 1 / (0.359073 * Math.log(5.7) + 6.949915) - 1 / (0.025342 * 5.7 + 29.163853), 12)
    expect(simpleGlazingLayerR(2.8)).toBeCloseTo(0.18631, 4)
    expect(simpleGlazingLayerR(6.5)).toBeCloseTo(1 / 6.5 - 1 / (1.788041 * 6.5 - 2.886625) - 1 / (0.025342 * 6.5 + 29.163853), 12)
    expect(outdoorAirRhoCp(20, 101325, 0)).toBeCloseTo((101325 / (287 * 293.15)) * 1004.84, 6)
    expect(outdoorAirRhoCp(0, 101325, 0.004) / K.rho_c_air).toBeGreaterThan(1.07)
  })
  it("a window's glass height as the translator draws it", () => {
    const byId = new Map([
      ['w', { id: 'w', kind: 'wall', zone_a: 'z', zone_b: 'outside', area_m2: 20, tilt_deg: 90, azimuth_deg: 180 }],
      ['g', { id: 'g', kind: 'glazing', zone_a: 'z', zone_b: 'outside', area_m2: 4, tilt_deg: 90, azimuth_deg: 180 }],
      ['r', { id: 'r', kind: 'glazing', zone_a: 'z', zone_b: 'outside', area_m2: 1, tilt_deg: 90, azimuth_deg: 0 }],
    ])
    const l = windowLayout({ id: 'z', height_m: 3.2, storeys: 1, surfaces: ['w', 'g', 'r'] }, byId)
    expect(l.get('g')).toEqual({ host: 'w', height_m: 3.2 - 0.04 })
    expect(l.has('r')).toBe(false)  // no wall facing north to sit in
  })
})

describe('Brief 126: TARP in the network, at a fixed factorisation', () => {
  const H = 24 * 4
  const LAYERS: Layer[] = [
    { kind: 'Material', thickness: 0.1, conductivity: 0.8, density: 1800, specific_heat: 900 },
    { kind: 'Material:NoMass', thermal_resistance: 0.3 },
  ]
  const te = Float64Array.from({ length: H }, (_, h) => 4 + 4 * Math.sin((h / 24) * 2 * Math.PI))
  const base = (more: Partial<NetworkInputs> = {}): NetworkInputs => ({
    zones: [{ air_capacity_j_per_k: 5e4, bridging_w_per_k: 0, ventilation_w_per_k: new Float64Array(H).fill(10), solar_transmitted_w: new Float64Array(H), solar_beam_w: null, other_gains: null, setpoints: { heat_c: 20, cool_c: null }, initial_c: 20 }],
    elements: [
      { element: opaqueElement({ id: 'w', area_m2: 30, tilt_deg: 90, boundary: 'outside', layers: LAYERS, stated_u: null, emissivity: 0.9, path: 'w' }), zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: new Float64Array(H), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null },
      { element: windowElement({ id: 'g', area_m2: 6, tilt_deg: 90, u: 2.8, emissivity: 0.84, path: 'g', glass: 'energyplus', optics: { interior_transmitted: 0.5, interior_absorbed: 0.1 } }), zone_a: 0, zone_b: null, solar_absorbed_w_per_m2: new Float64Array(H), inside_solar_absorptance: null, inside_solar_absorptance_b: null, window_height_m: 1.5 },
    ],
    hours: H, theta_e: te, theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0,
    warmup_days: 10, steps_per_hour: 4, theta_e_between: 'linear', inside_convection: 'tarp', ...more,
  })
  it('every step closes; a window needs its glass height; outdoor air carries more heat on a cold day', () => {
    const r = runNetwork(base())
    expect(Math.max(...r.zones[0].closure_wh)).toBeLessThan(1e-6)
    const b = base(); b.elements[1] = { ...b.elements[1], window_height_m: null }
    expect(() => runNetwork(b)).toThrow(/elements\[1\]\.window_height_m/)
    const o = runNetwork(base({ outdoor_air: { pressure: new Float64Array(H).fill(101325), w: new Float64Array(H).fill(0.004) } }))
    const vent = (x: typeof r) => x.zones[0].terms.ventilation_w.reduce((s, v) => s + v, 0)
    expect(vent(o) / vent(r)).toBeGreaterThan(1.05)
    expect(Math.max(...o.zones[0].closure_wh)).toBeLessThan(1e-6)
  })
  it("EnergyPlus's sky on the outside faces: every step closes; a clear (cold) sky loses more than an overcast one", () => {
    const faces = [outsideFace(1.5, 'Suburbs', 180, 90, false, 0.9), outsideFace(1.5, 'Suburbs', 180, 90, true, 0.84)]
    const wx = (ir: number) => ({ wind_speed: new Float64Array(H).fill(2), wind_direction: new Float64Array(H).fill(180), w: new Float64Array(H).fill(0.004), pressure: new Float64Array(H).fill(101325), rain_code: null, precipitation_mm: null, sky_ir: new Float64Array(H).fill(ir) })
    const clear = runNetwork(base({ outside_convection: { faces, weather: wx(250) } }))
    const cloudy = runNetwork(base({ outside_convection: { faces, weather: wx(330) } }))
    for (const r of [clear, cloudy]) expect(Math.max(...r.zones[0].closure_wh)).toBeLessThan(1e-6)
    const heat = (x: typeof clear) => x.zones[0].heating_w.reduce((s, v) => s + v, 0)
    expect(heat(clear)).toBeGreaterThan(heat(cloudy))
    expect(clear.element_terms[0].sky_wh).toBeLessThan(cloudy.element_terms[0].sky_wh)
  })
})
