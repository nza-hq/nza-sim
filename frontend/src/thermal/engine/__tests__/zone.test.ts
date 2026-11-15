/**
 * Brief 103 Part 3: the one-zone ISO 52016-1 balance against hand calculations.
 *
 * Each case builds its zone from plain numbers and checks the engine against a calculation written out in the test.
 * Closure (|Σ terms − demand − Δstorage| ≤ 1 Wh) is checked on every hour of every case.
 */
import { describe, expect, it } from 'vitest'
import { ENGINE_CONSTANTS as K } from '../constants'
import { iso6946U, opaqueElement, windowElement, type Element, type Layer } from '../elements'
import { runZone, type ZoneInputs } from '../zone'

const H = 24 * 30
const flat = (v: number, n = H) => new Float64Array(n).fill(v)
const WALL: Layer[] = [  // the anchor's external wall, outside first
  { kind: 'Material:NoMass', thermal_resistance: 6.759 },
  { kind: 'Material', thickness: 0.15, conductivity: 1.13, density: 2300, specific_heat: 1000 },
  { kind: 'Material', thickness: 0.013, conductivity: 0.16, density: 950, specific_heat: 840 },
]
const wall = (id: string, area: number) => opaqueElement({ id, area_m2: area, tilt_deg: 90, boundary: 'outside', layers: WALL, stated_u: null, emissivity: 0.9, path: id })

function zone(elements: Element[], over: Partial<ZoneInputs> = {}): ZoneInputs {
  return {
    elements, air_capacity_j_per_k: 1e6, bridging_w_per_k: 0, hours: H,
    theta_e: flat(0), theta_ground: 10, ventilation_w_per_k: flat(0),
    solar_absorbed_w_per_m2: elements.map(() => flat(0)), solar_transmitted_w: flat(0), other_gains: null,
    setpoints: { heat_c: null, cool_c: null }, control: 'air', hc_convective_fraction: 1, initial_c: 20, warmup_days: 0,
    ...over,
  }
}
/** Sky loss is a real term; the steady cases switch it off by setting emissivity's h_re share to zero via f_sky. */
const noSky = (e: Element): Element => ({ ...e, f_sky: 0 })
/** R from the inside surface to the outdoor air, per m²: the element's chain plus the outside film. */
const Rchain = (e: Element) => 1 / e.g_boundary + Array.from(e.g).reduce((s, g) => s + 1 / g, 0)
const closes = (r: ReturnType<typeof runZone>) => expect(Math.max(...r.closure_wh)).toBeLessThanOrEqual(1)

describe('(b) a wall\'s U from its layers is the ISO 6946 hand value', () => {
  it('the anchor wall: 1 / (0.04 + 6.759 + 0.15/1.13 + 0.013/0.16 + 0.13)', () => {
    const hand = 1 / (0.04 + 6.759 + 0.15 / 1.13 + 0.013 / 0.16 + 0.13)
    expect(iso6946U(WALL, 90, 'outside')).toBeCloseTo(hand, 12)
    expect(wall('w', 10).u_w_per_m2k).toBeCloseTo(hand, 12)
    // roof (upward, R_si 0.10) and a ground floor (no outside film, R_si 0.17)
    expect(iso6946U(WALL, 0, 'outside')).toBeCloseTo(1 / (0.04 + 6.759 + 0.15 / 1.13 + 0.013 / 0.16 + 0.10), 12)
    expect(iso6946U(WALL, 180, 'ground')).toBeCloseTo(1 / (6.759 + 0.15 / 1.13 + 0.013 / 0.16 + 0.17), 12)
  })
  it('a stated U resizes only the most resistive layer and keeps every mass', () => {
    const e = opaqueElement({ id: 'w', area_m2: 1, tilt_deg: 90, boundary: 'outside', layers: WALL, stated_u: 0.2, emissivity: 0.9, path: 'w' })
    const insul = 1 / 0.2 - (0.04 + 0.15 / 1.13 + 0.013 / 0.16 + 0.13)
    expect(1 / e.g[0]).toBeCloseTo(insul, 12)  // insulation is the first segment
    expect(Array.from(e.c).reduce((s, c) => s + c, 0)).toBeCloseTo(2300 * 1000 * 0.15 + 950 * 840 * 0.013, 6)
    expect(() => opaqueElement({ id: 'w', area_m2: 1, tilt_deg: 90, boundary: 'outside', layers: WALL, stated_u: 9, emissivity: 0.9, path: 'w' })).toThrow('above what the other layers')
  })
  it('refuses a layer with mass but no conductivity, naming it', () => {
    expect(() => iso6946U([{ kind: 'Material', thickness: 0.1, density: 1, specific_heat: 1 }], 90, 'outside', 'c')).toThrow('c.layers[0]')
  })
})

describe('(a) steady state: heat flow equals the hand conductances × ΔT', () => {
  it('one construction all round, air control: Σ A·ΔT/(R_chain + 1/h_ci) + H_tb·ΔT + H_ve·ΔT', () => {
    // With every inside surface the same, they share one temperature, so long-wave exchange between them is zero
    // and the air reaches each surface by convection alone.
    const els = [wall('a', 100), wall('b', 50), wall('c', 30)].map(noSky)
    const r = runZone(zone(els, { bridging_w_per_k: 40, ventilation_w_per_k: flat(120), setpoints: { heat_c: 20, cool_c: 26 }, warmup_days: 60 }))
    const dT = 20
    const hand = els.reduce((s, e) => s + (e.area_m2 * dT) / (Rchain(e) + 1 / e.h_ci), 0) + 40 * dT + 120 * dT
    expect(r.heating_w[H - 1]).toBeCloseTo(hand, 6)
    expect(r.theta_air[H - 1]).toBeCloseTo(20, 9)
    expect(r.terms.bridging_w[H - 1]).toBeCloseTo(-40 * dT, 9)
    closes(r)
  })
  it('a wall and a window, air control: the two-surface network solved by hand (Cramer)', () => {
    const w = noSky(wall('w', 80)), g = noSky(windowElement({ id: 'g', area_m2: 20, tilt_deg: 90, u: 1.4, emissivity: 0.9, path: 'g' }))
    const r = runZone(zone([w, g], { setpoints: { heat_c: 20, cool_c: 26 }, warmup_days: 60 }))
    // Inside-surface balances, per m², θ_e = 0, θ_a = 20, A_tot = 100:
    //   h_ci(θa − θi) + h_ri·Σ_k (A_k/A_tot)(θk − θi) = θi / R_i
    const At = 100, hr = K.h_ri, Ta = 20
    const a11 = w.h_ci + hr * (20 / At) + 1 / Rchain(w), a12 = -hr * (20 / At)
    const a21 = -hr * (80 / At), a22 = g.h_ci + hr * (80 / At) + 1 / Rchain(g)
    const b1 = w.h_ci * Ta, b2 = g.h_ci * Ta
    const det = a11 * a22 - a12 * a21
    const t1 = (b1 * a22 - a12 * b2) / det, t2 = (a11 * b2 - b1 * a21) / det
    const hand = 80 * w.h_ci * (Ta - t1) + 20 * g.h_ci * (Ta - t2)
    expect(r.heating_w[H - 1]).toBeCloseTo(hand, 6)
    closes(r)
  })
  it('operative control: θ_op = (θ_a + θ_s)/2 on the setpoint, hand-solved for one construction', () => {
    const e = noSky(wall('w', 100))
    const r = runZone(zone([e], { setpoints: { heat_c: 20, cool_c: 26 }, control: 'operative', warmup_days: 60 }))
    // q = h_ci(θa − θs) = θs / R ; θa + θs = 40  →  θs = 40·h_ci / (2·h_ci + 1/R)
    const R = Rchain(e), ts = (40 * e.h_ci) / (2 * e.h_ci + 1 / R)
    expect(r.heating_w[H - 1]).toBeCloseTo((100 * ts) / R, 6)
    expect(r.theta_op[H - 1]).toBeCloseTo(20, 9)
    closes(r)
  })
})

describe('(c) a step change: the free-floating air node follows the hand recursion to its steady state', () => {
  it('massless envelope: θ_{n+1} − θ∞ = (θ_n − θ∞)·(C/Δt)/(C/Δt + K)', () => {
    const g = noSky(windowElement({ id: 'g', area_m2: 50, tilt_deg: 90, u: 1.4, emissivity: 0.9, path: 'g' }))
    const C = 5e6, Hve = 30, Te = 10
    const r = runZone(zone([g], { air_capacity_j_per_k: C, ventilation_w_per_k: flat(Hve), theta_e: flat(Te), initial_c: 20 }))
    const Kair = (50 / (Rchain(g) + 1 / g.h_ci)) + Hve
    const f = (C / 3600) / (C / 3600 + Kair)
    let t = 20
    for (let h = 0; h < H; h++) { t = Te + (t - Te) * f; expect(r.theta_air[h]).toBeCloseTo(t, 9) }
    expect(r.theta_air[H - 1]).toBeCloseTo(Te, 6)
    closes(r)
  })
  it('a massive zone with a constant solar gain settles on the hand steady state (air and surface balances)', () => {
    const e = noSky(wall('w', 200)), Q = 3000, Te = 5
    const r = runZone(zone([e], { theta_e: flat(Te), solar_transmitted_w: flat(Q), bridging_w_per_k: 25, initial_c: 5, warmup_days: 200 }))
    // air:     f·Q + h_ci·A(θs − θa) + Htb(θe − θa) = 0
    // surface: (1−f)·Q + h_ci·A(θa − θs) − A(θs − θe)/R = 0
    const f = K.solar_convective_fraction, A = 200, hA = e.h_ci * A, R = Rchain(e)
    const a11 = hA + 25, a12 = -hA, b1 = f * Q + 25 * Te
    const a21 = -hA, a22 = hA + A / R, b2 = (1 - f) * Q + (A * Te) / R
    const det = a11 * a22 - a12 * a21
    expect(r.theta_air[H - 1]).toBeCloseTo((b1 * a22 - a12 * b2) / det, 4)
    expect(r.heating_w.every((v) => v === 0) && r.cooling_w.every((v) => v === 0)).toBe(true)
    closes(r)
  })
})

describe('(d) zero envelope: no demand and a constant temperature', () => {
  it('adiabatic elements, no sun, no air exchange', () => {
    const adiabatic = (e: Element): Element => ({ ...e, g_boundary: 0, f_sky: 0 })
    const r = runZone(zone([adiabatic(wall('a', 100)), adiabatic(wall('b', 40))], { initial_c: 21, setpoints: { heat_c: 20, cool_c: 24 } }))
    expect(Math.max(...r.heating_w, ...r.cooling_w)).toBe(0)
    for (let h = 0; h < H; h++) expect(Math.abs(r.theta_air[h] - 21)).toBeLessThan(1e-9)
    closes(r)
  })
})

describe('the sky term and sources', () => {
  it('a horizontal outside face loses F_sky·h_re·Δθ_er·A to the sky every hour', () => {
    const roof = opaqueElement({ id: 'r', area_m2: 100, tilt_deg: 0, boundary: 'outside', layers: WALL, stated_u: null, emissivity: 0.9, path: 'r' })
    const r = runZone(zone([roof], { setpoints: { heat_c: 20, cool_c: 26 } }))
    expect(r.terms.sky_w[0][5]).toBeCloseTo(-1 * 4.14 * 11 * 100, 9)
    closes(r)
  })
  it('refuses inverted setpoints, a missing hour, and negative ventilation', () => {
    const e = wall('w', 10)
    expect(() => runZone(zone([e], { setpoints: { heat_c: 25, cool_c: 20 } }))).toThrow('heating 25 above cooling 20')
    expect(() => runZone(zone([e], { theta_e: flat(0, 10) }))).toThrow('theta_e')
    const v = flat(1); v[7] = -1
    expect(() => runZone(zone([e], { ventilation_w_per_k: v }))).toThrow('hour 7 is negative')
  })
})
