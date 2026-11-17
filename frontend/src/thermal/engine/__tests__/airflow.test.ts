/**
 * Brief 115 P2/P3: weather-driven air, by hand.
 *
 * - q50: the cracks put the room's stated leakage through at 50 Pa (at reference air).
 * - Still and isothermal: nothing moves.
 * - One window, still air, warm room: two-way flow by the stack, in = out, and the textbook value
 *   (2/3)·Cd·W·√(2·ρ·g·Δρ)·(H/2)^1.5 per direction with the neutral plane at mid-height.
 * - Cross-flow, isothermal: two equal windows in series take half the wind pressure each.
 * - The effective-area function (the one Rule 11 read).
 * - Window rules: temperature (with EnergyPlus's modulation) and timetable.
 * - runModel: a three-room building under weather-driven air closes (Rule 9) with its own lines; Rule 8 refusals and
 *   the open-above check refuse by name; 'today' is untouched.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AIR, airWeather, buildAirModels, turbulenceFlow, cpAt, cpTable, rhoAir, swamiChandra, windFactor, windowEffectiveArea, zoneAirStep, type AirWeather, type ZoneAirModel } from '../airflow'
import { REFEREE_OPTIONS, runModel } from '../model'
import { readZoneTermKwh } from '../results'
import { ModelDocument } from '../../schema/model'
import { levelDocument } from '../../../sim2/run/seam'
import { cooledRoomDocument } from './cooledRoom'
import { MOS, readMos } from './denver'

const W = readMos(fs.readFileSync(MOS))
const RHO_REF = rhoAir(101325, 20, 0)

/** One hour of made-up weather. */
function wx(te: number, U = 0, dir = 180): AirWeather {
  return { dry_bulb: [te], wind_speed: [U], wind_direction: [dir], w: new Float64Array([0]), p_hour: [101325], p_std: 101325 }
}
const flat = (cp: number) => new Float64Array(36).fill(cp)
const box = (x: Partial<ZoneAirModel>): ZoneAirModel => ({ n: 0.65, cracks: [], vents: [], windows: [], rule: null, turbulence: false, cp: [flat(0)], wind10: 1, ...x })

describe('Brief 115: the pieces', () => {
  it('wind at 10 m in open country is the weather file\'s; higher and rougher as EnergyPlus', () => {
    expect(windFactor(10, 'open')).toBeCloseTo(1, 12)
    expect(windFactor(10, 'city')).toBeCloseTo(Math.pow(27, 0.14) * Math.pow(10 / 460, 0.33), 12)
    expect(windFactor(0, 'open')).toBe(0)
  })
  it('Swami–Chandra: +0.6·ln(2.734)·… windward, negative leeward; tables read between by straight lines', () => {
    expect(swamiChandra(0, 0)).toBeCloseTo(0.6 * Math.log(1.248 + 0.769 + 0.717), 12)
    expect(swamiChandra(Math.PI, 0)).toBeLessThan(0)
    const t = cpTable(180, 0)
    expect(cpAt(t, 180)).toBeCloseTo(swamiChandra(0, 0), 12)
    expect(cpAt(t, 185)).toBeCloseTo(0.5 * (t[18] + t[19]), 12)
  })
  it('the effective area: openable fraction × the angle factor; sliding and louvre 1; gaps named', () => {
    const c = (a: number) => 2.6e-7 * a ** 3 - 1.19e-4 * a ** 2 + 1.86e-2 * a
    expect(windowEffectiveArea({ openable_fraction: 0.5, style: 'side_hung', opening_angle_deg: 30 }, 'o')).toBeCloseTo(0.5 * c(30), 12)
    expect(windowEffectiveArea({ openable_fraction: 0.5, style: 'top_hung', opening_angle_deg: 90 }, 'o')).toBeCloseTo(0.5 * Math.min(1, c(90)), 12)
    expect(windowEffectiveArea({ openable_fraction: 0.4, style: 'sliding' }, 'o')).toBe(0.4)
    expect(() => windowEffectiveArea({ openable_fraction: 0.4 }, 'o')).toThrow('o.style')
    expect(() => windowEffectiveArea({ openable_fraction: 0.4, style: 'side_hung', opening_angle_deg: null }, 'o')).toThrow('o.opening_angle_deg')
  })
})

describe('Brief 115: one room, one step', () => {
  it('q50: Σk·50^n is the stated leakage at reference air, kg/s', () => {
    const doc: any = structuredClone(cooledRoomDocument().doc)
    doc.building.air = { method: 'weather_driven', exponent: 0.67, single_sided_turbulence: false }
    doc.building.site.terrain = 'suburban'
    doc.zones.forEach((z: any) => { z.infiltration_q50 = 5; z.infiltration_ach = null })
    const area = [60, 40, 60]
    const ms = buildAirModels(doc, area, () => { throw new Error('no schedules') })
    ms.forEach((m, i) => {
      const k = m.cracks.reduce((s, c) => s + c.k, 0)
      expect(k * Math.pow(50, 0.67)).toBeCloseTo((RHO_REF * 5 * area[i]) / 3600, 12)
      expect(m.cracks.length % AIR.crack_bands).toBe(0)
    })
  })
  it('still and isothermal: no flow on any line', () => {
    const m = box({ cracks: [{ z: 0.5, wind: 1, facade: 0, k: 0.01 }, { z: 2.5, wind: 1, facade: 0, k: 0.01 }], vents: [{ z: 2, wind: 1, facade: 0, cdA: 0.01 }] })
    const out = new Float64Array(4)
    const st = zoneAirStep(m, wx(20), 0, 20, 20, out)
    expect(Math.abs(st.m_in)).toBeLessThan(1e-9)
    out.forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-6))
  })
  it('one window, still air, warm room: two-way, the textbook flow', () => {
    const Hh = 1.2, Wd = 0.8, cd = 0.6
    const m = box({
      windows: [{ z_ref: 1, wind: 1, facade: 0, cd, width: Wd, height: Hh, max_factor: 1 }],
      rule: { rule: 'timetable', open_fraction: 1, open_above_c: null, hours: null, modulation: null },
    })
    const out = new Float64Array(4)
    const st = zoneAirStep(m, wx(0), 0, 20, 0, out)
    const rO = rhoAir(101325, 0, 1e-5), rZ = rhoAir(101325, 20, 1e-5), rm = Math.sqrt(rO * rZ)
    const hand = (2 / 3) * cd * Wd * Math.sqrt(2 * rm * AIR.g * (rO - rZ)) * Math.pow(Hh / 2, 1.5)
    expect(st.open_factor).toBe(1)
    expect(st.m_in / hand).toBeGreaterThan(0.98)
    expect(st.m_in / hand).toBeLessThan(1.02)
    expect(out[2]).toBeCloseTo(st.m_in * 1004.84, 6)
  })
  it('single-sided turbulence (review F2): De Gids–Phaff C₃ in quadrature with the windows\' own flow, hand values', () => {
    expect(turbulenceFlow(1)).toBeCloseTo(0.05, 12)                 // ½·1·√0.01
    const Hh = 1.2, Wd = 0.8, cd = 0.6
    const win = { z_ref: 1, wind: 1, facade: 0, cd, width: Wd, height: Hh, max_factor: 1 }
    const rule = { rule: 'timetable' as const, open_fraction: 1, open_above_c: null, open_above_h: null, hours: null, modulation: null }
    // Still and isothermal: the windows carry nothing, so the line is the turbulence alone, ρ·½·A·√C₃.
    const o0 = new Float64Array(4)
    const s0 = zoneAirStep(box({ windows: [win], rule, turbulence: true }), wx(20), 0, 20, 20, o0)
    const rho20 = rhoAir(101325, 20, 0)
    expect(s0.m_in).toBeCloseTo(rho20 * 0.5 * Wd * Hh * 0.1, 9)
    // Warm room: √(q_w² + q_t²) − q_w on top of the two-way flow.
    const off = new Float64Array(4), on = new Float64Array(4)
    const a = zoneAirStep(box({ windows: [win], rule }), wx(0), 0, 20, 0, off)
    const b = zoneAirStep(box({ windows: [win], rule, turbulence: true }), wx(0), 0, 20, 0, on)
    const qt = rhoAir(101325, 0, 1e-5) * 0.5 * Wd * Hh * 0.1
    expect(b.m_in).toBeCloseTo(Math.sqrt(a.m_in ** 2 + qt ** 2), 9)
    expect(on[2]).toBeCloseTo(off[2], 9)
    expect(on[3]).toBeGreaterThan(0)
  })
  it('cross-flow, isothermal: equal windows in series take half the wind pressure each', () => {
    const cd = 0.6, A = 0.5, U = 4
    const m = box({
      cp: [flat(0.6), flat(-0.3)],
      windows: [
        { z_ref: 1, wind: 1, facade: 0, cd, width: A, height: 1, max_factor: 1 },
        { z_ref: 1, wind: 1, facade: 1, cd, width: A, height: 1, max_factor: 1 },
      ],
      rule: { rule: 'timetable', open_fraction: 1, open_above_c: null, hours: null, modulation: null },
    })
    const st = zoneAirStep(m, wx(20, U), 0, 20, 20, new Float64Array(4))
    const rho = rhoAir(101325, 20, 1e-5)
    const dp = (0.9 * 0.5 * rho * U * U) / 2
    expect(st.m_in).toBeCloseTo(cd * A * Math.sqrt(2 * rho * dp), 6)
  })
  it('temperature rule: shut below open-above or when colder than outside; EnergyPlus\'s modulation between', () => {
    const m = box({
      windows: [{ z_ref: 1, wind: 1, facade: 0, cd: 0.6, width: 1, height: 1, max_factor: 1 }],
      rule: { rule: 'temperature', open_fraction: 0.8, open_above_c: 22, open_above_h: null, hours: null, modulation: { lower_dk: 5, upper_dk: 15, min_fraction: 0.2 } },
    })
    const f = (room: number, te: number) => zoneAirStep(m, wx(te), 0, room, te, new Float64Array(4)).open_factor
    expect(f(21, 10)).toBe(0)
    expect(f(25, 26)).toBe(0)
    expect(f(25, 22)).toBeCloseTo(0.8, 12)          // ΔT 3 ≤ 5: full
    expect(f(25, 15)).toBeCloseTo(0.8 * (0.2 + 0.5 * 0.8), 12) // ΔT 10: halfway
    expect(f(25, 5)).toBeCloseTo(0.8 * 0.2, 12)     // ΔT 20 ≥ 15: least
    m.rule!.hours = new Float64Array([0])
    expect(f(25, 22)).toBe(0)
    m.rule!.hours = new Float64Array([0.5])          // the opening profile's value scales how far they open
    expect(f(25, 22)).toBeCloseTo(0.4, 12)
    m.rule!.hours = null
    m.rule!.open_above_h = new Float64Array([26])    // a temperature profile's hour in place of open_above_c
    expect(f(25, 22)).toBe(0)
    expect(f(27, 22)).toBeCloseTo(0.8, 12)
  })
})

/** The cooled room's three rooms, weather-driven, each window opening by temperature (or a timetable). */
function weatherDriven(rule: 'temperature' | 'timetable' = 'temperature') {
  const d: any = structuredClone(cooledRoomDocument().doc)
  d.building.air = { method: 'weather_driven', exponent: 0.67, single_sided_turbulence: true }
  d.building.site.terrain = 'suburban'
  for (const z of d.zones) { z.infiltration_q50 = 5; z.infiltration_ach = null }
  for (const s of d.surfaces) if (s.kind === 'glazing') s.openings = [{ kind: 'operable', openable_fraction: 0.5, cd: 0.6, style: 'side_hung', opening_angle_deg: 45, sill_m: 0.9, head_m: 2.1 }]
  d.surfaces.find((s: any) => s.id.endsWith('_north') && s.zone_a === d.zones[1].id).openings = [{ kind: 'permanent_vent', area_m2: 0.004, cd: 0.6, flow_mode: 'single_sided', height_m: 2.2 }]
  d.controls = d.zones.map((z: any) => ({ id: `win_${z.id}`, target: { kind: 'window', ref: z.id }, controller: 'manual', rule, open_fraction: 1, open_above_c: rule === 'temperature' ? 26 : null }))
  return d
}
const LIB = cooledRoomDocument().lib
const run = (d: any) => runModel(ModelDocument.parse(d), W, LIB, REFEREE_OPTIONS)

describe('Brief 115: runModel under weather-driven air', () => {
  it('closes per room with leakage, vents, windows and turbulence as their own lines (Rule 9)', () => {
    const r = run(weatherDriven())
    for (const z of r.zones) {
      expect(z.engine).toBe('thermal-2')
      expect(Math.abs(z.closure.sum_kwh)).toBeLessThan(1e-3)
      expect(readZoneTermKwh(z, 'infiltration')).toBeLessThan(0)
      expect(z.breakdown.some((l) => l.term === 'window_ventilation')).toBe(true)
      expect(z.air!.inflow_kg_per_h.every((v) => v >= 0)).toBe(true)
    }
    // West and east are heated only and float above 26 °C in summer: their windows open. The middle room is cooled to
    // 24 °C, never above 26: its windows never open (as EnergyPlus's venting control would leave them).
    expect(r.zones[0].air!.hours_windows_open).toBeGreaterThan(0)
    expect(r.zones[1].air!.hours_windows_open).toBe(0)
    expect(readZoneTermKwh(r.zones[1], 'permanent_vents')).toBeLessThan(0)
  })
  it('windows open by temperature cut the cooling against windows shut', () => {
    const open = run(weatherDriven())
    const shut = weatherDriven(); for (const c of shut.controls) c.open_fraction = 0
    const s = run(shut)
    const cool = (r: any) => r.zones.reduce((t: number, z: any) => t + z.annual.cooling_kwh, 0)
    expect(cool(open)).toBeLessThan(cool(s))
    expect(s.zones.every((z: any) => z.air.hours_windows_open === 0)).toBe(true)
  })
  it('refuses by name: no terrain, no q50, no window rule, open-above not above the heating setpoint', () => {
    const a = weatherDriven(); a.building.site.terrain = null
    expect(() => ModelDocument.parse(a)).toThrow()
    const b = weatherDriven(); b.zones[0].infiltration_q50 = null; b.zones[0].infiltration_ach = 0.5
    expect(() => run(b)).toThrow('zones[0].infiltration_q50')
    const c = weatherDriven(); c.controls = c.controls.slice(1)
    expect(() => run(c)).toThrow('give it a window rule')
    const d = weatherDriven(); d.controls[0].open_above_c = d.zones[0].setpoints.heat_c
    expect(() => run(d)).toThrow('controls[0].open_above_c')
  })
  it('window operation as profiles: how far each hour (a schedule) and the temperature it opens above (a temperature profile)', () => {
    // A timetable at half every hour opens as far as open_fraction 0.5 with no profile.
    const half = weatherDriven('timetable'); for (const c of half.controls) c.open_fraction = 0.5
    const prof = weatherDriven('timetable')
    prof.profiles.push({ id: 'half', kind: 'schedule', day_types: { weekday: Array(24).fill(0.5), saturday: Array(24).fill(0.5), sunday: Array(24).fill(0.5) } })
    for (const c of prof.controls) c.hours_ref = 'half'
    const a = run(half), b = run(prof)
    a.zones.forEach((z, i) => expect(b.zones[i].annual.heating_kwh).toBeCloseTo(z.annual.heating_kwh, 6))
    // A temperature profile that holds 26 °C every hour gives the same as open_above_c 26.
    const flat26 = weatherDriven()
    flat26.profiles.push({ id: 't26', kind: 'temperature', day_types: { weekday: Array(24).fill(26), saturday: Array(24).fill(26), sunday: Array(24).fill(26) } })
    for (const c of flat26.controls) { c.open_above_c = null; c.open_above_ref = 't26' }
    const c0 = run(weatherDriven()), c1 = run(flat26)
    c0.zones.forEach((z, i) => expect(c1.zones[i].air!.hours_windows_open).toBe(z.air!.hours_windows_open))
    // Refused by name: both thresholds, a missing profile, a timetable with a threshold, a profile not above heating.
    const both = structuredClone(flat26); both.controls[0].open_above_c = 26
    expect(() => ModelDocument.parse(both)).toThrow('keep one')
    const missing = structuredClone(flat26); missing.controls[0].open_above_ref = 'nope'
    expect(() => ModelDocument.parse(missing)).toThrow(/temperature profile .{0,2}nope.{0,2} does not exist/)
    const tt = weatherDriven('timetable'); tt.controls[0].open_above_c = 24
    expect(() => ModelDocument.parse(tt)).toThrow('opens by its hours')
    const low = structuredClone(flat26); low.profiles.at(-1).day_types.sunday[3] = low.zones[0].setpoints.heat_c
    expect(() => run(low)).toThrow('controls[0].open_above_ref')
  })
  it('a vent under weather-driven air needs cd and height, not today\'s flow_mode', () => {
    const d = weatherDriven()
    const v = d.surfaces.find((s: any) => s.openings.some((o: any) => o.kind === 'permanent_vent')).openings[0]
    delete v.flow_mode
    expect(() => run(d)).not.toThrow()
    delete v.cd
    expect(() => ModelDocument.parse(d)).toThrow('needs cd')
  })
  it('Rule 8: at fabric and + spaces the windows are removed, not closed', () => {
    const d = ModelDocument.parse(weatherDriven())
    for (const level of ['fabric', 'spaces'] as const) {
      const l = levelDocument(d, level, 20)
      expect(l.surfaces.every((s) => s.openings.every((o) => o.kind !== 'operable'))).toBe(true)
      expect(l.controls.some((c) => c.target.kind === 'window')).toBe(false)
      const r = runModel(l, W, LIB, REFEREE_OPTIONS)
      expect(r.zones.every((z) => z.breakdown.every((x) => x.term !== 'window_ventilation'))).toBe(true)
    }
  })
  it('the air weather: standard pressure from elevation, humidity from the dew point', () => {
    const a = airWeather(W.hours, 1650)
    expect(a.p_std).toBeCloseTo(101325 * Math.pow(1 - 2.25577e-5 * 1650, 5.2559), 6)
    expect(a.w.every((x) => x >= 0 && x < 0.03)).toBe(true)
  })
})
