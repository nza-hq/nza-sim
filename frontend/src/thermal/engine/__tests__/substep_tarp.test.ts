/**
 * Brief 105 Part 6: sub-hourly steps and TARP inside convection on the network solver.
 *
 * - One step an hour stated is the same run as the option absent, value for value.
 * - Steps converge at first order (implicit Euler): halving the step halves the error against a fine run.
 * - The hour's outputs are means of its steps, and every hour still closes.
 * - TARP: a zone with one face, held at 20 °C, settles where its heating equals Walton's coefficient at the face's
 *   own temperature difference, for a wall, a cool floor, a cool ceiling and a warm floor.
 */
import { describe, expect, it } from 'vitest'
import { ENGINE_CONSTANTS as K } from '../constants'
import { opaqueElement, type Layer } from '../elements'
import { runNetwork, type NetworkElement, type NetworkInputs, type NetworkZone } from '../network'

const BLOCK: Layer[] = [
  { kind: 'Material:NoMass', thermal_resistance: 2 },
  { kind: 'Material', thickness: 0.1, conductivity: 0.51, density: 1400, specific_heat: 1000 },
]
const last = (a: Float64Array) => a[a.length - 1]
const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0)

function face(id: string, tilt: number, boundary: 'outside' | 'ground', zone: number, H: number, area = 20): NetworkElement {
  return {
    element: opaqueElement({ id, area_m2: area, tilt_deg: tilt, boundary, layers: BLOCK, stated_u: null, emissivity: boundary === 'ground' ? null : 0.9, path: id }),
    zone_a: zone, zone_b: null, solar_absorbed_w_per_m2: new Float64Array(H), inside_solar_absorptance: 0.6, inside_solar_absorptance_b: null,
  }
}
function inputs(H: number, zones: Partial<NetworkZone>[], elements: NetworkElement[], te: ArrayLike<number>, more: Partial<NetworkInputs> = {}): NetworkInputs {
  const zero = new Float64Array(H)
  return {
    zones: zones.map((z) => ({
      air_capacity_j_per_k: 5e4, bridging_w_per_k: 2, ventilation_w_per_k: zero, solar_transmitted_w: zero, solar_beam_w: null,
      other_gains: null, setpoints: { heat_c: null, cool_c: null }, initial_c: 15, ...z,
    })),
    elements, hours: H, theta_e: te, theta_ground: 10, control: 'air', hc_convective_fraction: 1, solar_convective_fraction: 0, warmup_days: 10, ...more,
  }
}

describe('sub-hourly steps', () => {
  const H = 24 * 6
  const te = Float64Array.from({ length: H }, (_, h) => 5 + 8 * Math.sin((h / 24) * 2 * Math.PI) + (h % 24 === 7 ? 6 : 0))
  const zones: Partial<NetworkZone>[] = [{ setpoints: { heat_c: 19, cool_c: 23 } }, {}]
  const els = [face('w0', 90, 'outside', 0, H), face('r0', 0, 'outside', 0, H), face('w1', 90, 'outside', 1, H), face('g1', 180, 'ground', 1, H)]
  const run = (more: Partial<NetworkInputs>) => runNetwork(inputs(H, zones, els, te, more))

  it('one step an hour stated is the run with the option absent', () => {
    const a = run({}), b = run({ steps_per_hour: 1, theta_e_between: 'linear', inside_convection: 'fixed' })
    a.zones.forEach((z, i) => {
      expect(Array.from(b.zones[i].heating_w)).toEqual(Array.from(z.heating_w))
      expect(Array.from(b.zones[i].theta_air)).toEqual(Array.from(z.theta_air))
      expect(Array.from(b.zones[i].closure_wh)).toEqual(Array.from(z.closure_wh))
    })
  })
  it('halving the step halves the error against a fine run (first order), and every hour closes', () => {
    const fine = run({ steps_per_hour: 60 })
    const err = (N: number) => {
      const r = run({ steps_per_hour: N })
      for (const z of r.zones) expect(Math.max(...z.closure_wh)).toBeLessThan(1e-6)
      // heating of the held zone, and the free zone's air temperature
      return [Math.abs(sum(r.zones[0].heating_w) - sum(fine.zones[0].heating_w)), sum(r.zones[1].theta_air.map((t, h) => Math.abs(t - fine.zones[1].theta_air[h])))]
    }
    const e = [1, 2, 4, 8].map(err)
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 3; j++) {
        const ratio = e[j][i] / e[j + 1][i]
        expect(ratio).toBeGreaterThan(1.6)
        expect(ratio).toBeLessThan(2.6)
      }
    }
  })
  it('linear and hold are the same when the outdoor temperature does not change', () => {
    const flat = new Float64Array(H).fill(3)
    const a = runNetwork(inputs(H, zones, els, flat, { steps_per_hour: 4, theta_e_between: 'hold' }))
    const b = runNetwork(inputs(H, zones, els, flat, { steps_per_hour: 4, theta_e_between: 'linear' }))
    expect(Array.from(b.zones[0].heating_w)).toEqual(Array.from(a.zones[0].heating_w))
  })
  it('refuses a step count that is not a whole number from 1 to 60', () => {
    expect(() => run({ steps_per_hour: 0 })).toThrow('steps_per_hour')
    expect(() => run({ steps_per_hour: 2.5 })).toThrow('steps_per_hour')
    expect(() => run({ inside_convection: 'doe2' as any })).toThrow('inside_convection')
  })
})

describe('TARP inside convection', () => {
  it('one face per zone, held at 20 °C: the heating is h(ΔT)·A·ΔT with Walton\'s h for the face\'s own ΔT', () => {
    const H = 48, A = 20
    // A wall and a ceiling under a 0 °C outside; a floor on 10 °C ground; a floor on 35 °C ground (a warm floor).
    const els = [face('wall', 90, 'outside', 0, H, A), face('ceil', 0, 'outside', 1, H, A), face('floor', 180, 'ground', 2, H, A), face('warm', 180, 'ground', 3, H, A)]
    const held = { setpoints: { heat_c: 20, cool_c: 20 }, bridging_w_per_k: 0 }
    const base = inputs(H, [held, held, held, held], els, new Float64Array(H), { inside_convection: 'tarp', warmup_days: 60 })
    // The warm floor's own ground: run it apart with θ_ground 35.
    const r = runNetwork({ ...base, zones: base.zones.slice(0, 3), elements: els.slice(0, 3) })
    const w = runNetwork({ ...base, zones: base.zones.slice(0, 1), elements: [{ ...els[3], zone_a: 0 }], theta_ground: 35 })
    const tarp = (dT: number, unstable: boolean, cos: number) => {
      const a = Math.cbrt(Math.abs(dT))
      return unstable ? (K.tarp_unstable_a * a) / (K.tarp_unstable_b - cos) : (K.tarp_stable_a * a) / (K.tarp_stable_b + cos)
    }
    const check = (z: { theta_air: Float64Array; theta_mrt: Float64Array; heating_w: Float64Array; cooling_w: Float64Array }, unstable: boolean, cos: number) => {
      // One face: the radiant star is the face, so θ_mrt is its temperature. Heat into the face from the air.
      const dT = last(z.theta_air) - last(z.theta_mrt)
      const q = last(z.heating_w) - last(z.cooling_w)
      expect(q).toBeCloseTo(tarp(dT, unstable, cos) * A * dT, 6)
      return dT
    }
    expect(check(r.zones[0], false, 0)).toBeGreaterThan(0)   // a cool wall: 1.31·|ΔT|^⅓ (either form at cos 0)
    expect(check(r.zones[1], true, 1)).toBeGreaterThan(0)    // a cool ceiling looks down: unstable
    expect(check(r.zones[2], false, 1)).toBeGreaterThan(0)   // a cool floor looks up: stable
    expect(check(w.zones[0], true, 1)).toBeLessThan(0)       // a warm floor looks up: unstable (the zone is cooled)
    for (const z of [...r.zones, ...w.zones]) expect(Math.max(...z.closure_wh)).toBeLessThan(1e-6)
  })
})
