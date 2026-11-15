/** Brief 104 Part 1b: the Simple Window Model, its normal-incidence optics checked against EnergyPlus's own derivation (eplusout.eio, 25.2.0) and its angular dependence. */
import { describe, expect, it } from 'vitest'
import { simpleGlazingAngular, simpleGlazingOptics } from '../glazing'

describe('simpleGlazingOptics (EnergyPlus Simple Window Model)', () => {
  it('the Bridgewater window, U 1.4 and SHGC 0.441, as EnergyPlus derives it', () => {
    const o = simpleGlazingOptics(1.4, 0.441)
    // eplusout.eio: WindowMaterial:Glazing BRIDGWATER_GLAZING_PANE thickness 4.58837E-002, conductivity 8.51890E-002;
    // WindowConstruction solar transmittance at normal incidence 0.357; pane absorptance 1 − 0.35579 − 0.45481.
    expect(o.thickness_m).toBeCloseTo(0.0458837, 6)
    expect(o.thickness_m / o.r_layer).toBeCloseTo(0.085189, 5)
    expect(o.t_sol).toBeCloseTo(0.357, 3)
    expect(o.a_sol).toBeCloseTo(1 - 0.35579 - 0.45481, 3)
    expect(o.t_sol + o.inward_fraction * o.a_sol).toBeCloseTo(0.441, 12)  // SHGC = T + N·A by construction
  })
  it('stays physical across the method\'s range, including the interpolated U band', () => {
    for (const u of [0.8, 1.4, 2.9, 3.4, 4.0, 4.5, 5.8, 6.5]) for (const g of [0.1, 0.3, 0.5, 0.7, 0.85]) {
      const o = simpleGlazingOptics(u, g)
      expect(o.t_sol).toBeGreaterThanOrEqual(0); expect(o.t_sol).toBeLessThan(g)
      expect(o.a_sol).toBeGreaterThanOrEqual(0); expect(o.r_sol).toBeGreaterThanOrEqual(0)
      expect(o.t_sol + o.inward_fraction * o.a_sol).toBeCloseTo(g, 10)
    }
  })
  it('refuses inputs outside the method, naming the path', () => {
    expect(() => simpleGlazingOptics(0, 0.5, 'surfaces[3]')).toThrow('surfaces[3].u')
    expect(() => simpleGlazingOptics(1.4, 1.2, 'surfaces[3]')).toThrow('surfaces[3].g_value')
  })
})

describe('simpleGlazingAngular (the method\'s curves A–J and its 28-cell map)', () => {
  const deg = (d: number) => Math.cos((d * Math.PI) / 180)
  it('is the normal-incidence optics at 0°, falls with angle, and is zero at grazing', () => {
    const o = simpleGlazingOptics(1.4, 0.55), a = simpleGlazingAngular(1.4, 0.55, o)
    expect(a.at(1)).toEqual({ t: o.t_sol, r: o.r_sol })
    let prev = Infinity
    for (const d of [0, 15, 30, 45, 60, 75, 89]) { const t = a.at(deg(d)).t; expect(t).toBeLessThanOrEqual(prev + 1e-12); prev = t }
    expect(a.at(0).t).toBe(0)
  })
  it('U 1.4 with SHGC above 0.45 is curve E (cell 1): T(60°) = T0 · (1.51c + 2.49c² − 5.87c³ + 2.88c⁴)', () => {
    const o = simpleGlazingOptics(1.4, 0.55), c = 0.5
    expect(simpleGlazingAngular(1.4, 0.55, o).at(c).t).toBeCloseTo(o.t_sol * (1.51 * c + 2.49 * c ** 2 - 5.87 * c ** 3 + 2.88 * c ** 4), 12)
  })
  it('diffuse values are EnergyPlus\'s 10° average (a constant property averages to the quadrature\'s 0.995)', () => {
    const o = simpleGlazingOptics(1.4, 0.55), a = simpleGlazingAngular(1.4, 0.55, o)
    let w = 0
    const d = Math.PI / 18
    for (let i = 0; i < 9; i++) w += 0.5 * d * (Math.sin(2 * i * d) + Math.sin(2 * (i + 1) * d))
    expect(w).toBeCloseTo(0.98983, 5)
    expect(a.t_dif + a.r_dif + a.a_dif).toBeCloseTo(w, 12)
    expect(a.t_dif / o.t_sol).toBeGreaterThan(0.8); expect(a.t_dif / o.t_sol).toBeLessThan(0.9)
  })
  it('every cell of the map gives physical values (each U band, each SHGC band)', () => {
    for (const u of [0.8, 1.42, 1.5, 1.7, 2.5, 3.41, 4.0, 4.54, 5.5]) for (const g of [0.2, 0.27, 0.32, 0.4, 0.47, 0.52, 0.57, 0.62, 0.7]) {
      let o
      try { o = simpleGlazingOptics(u, g) } catch { continue }  // outside the normal-incidence method
      const a = simpleGlazingAngular(u, g, o)
      for (const d of [10, 40, 70, 85]) {
        const p = a.at(deg(d))
        expect(p.t).toBeGreaterThanOrEqual(0); expect(p.r).toBeGreaterThanOrEqual(0); expect(p.t + p.r).toBeLessThanOrEqual(1)
      }
      expect(a.t_dif).toBeLessThan(o.t_sol)
    }
  })
})
