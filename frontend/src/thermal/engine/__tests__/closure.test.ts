/**
 * Brief 103 review findings 2 and 8: the engine refuses an unbalanced result, and a missing bridging multiplier.
 */
import { describe, expect, it } from 'vitest'
import { checkClosure, CLOSURE_MAX_WH } from '../model'
import { computeBridging } from '../bridging'
import type { BreakdownLine } from '../results'

const line = (term: string, kwh: number): BreakdownLine => ({ term, surface_id: null, kwh } as BreakdownLine)

describe('checkClosure', () => {
  const balanced = [line('heating', 1000), line('conduction_walls', -1500), line('solar_transmitted', 600), line('storage', -100)]
  it('passes a balanced breakdown and returns its sum', () => {
    expect(checkClosure(balanced, 1e-9).sum_kwh).toBeCloseTo(0, 9)
  })
  it('refuses a breakdown with a line missing (the Brief 28 door-bug class)', () => {
    expect(() => checkClosure(balanced.filter((l) => l.term !== 'solar_transmitted'), 1e-9)).toThrow('closure.sum_kwh')
  })
  it('refuses an hourly residual over the limit, and a NaN', () => {
    expect(() => checkClosure(balanced, CLOSURE_MAX_WH * 1.01)).toThrow('closure.max_wh')
    expect(() => checkClosure(balanced, NaN)).toThrow('closure.max_wh')
  })
})

describe('bridging: the multiplier is an input, not an engine default', () => {
  const args = { polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][], storeys: 1, storey_height_m: 3, glazing_areas_m2: [], area_ua_w_per_k: 100 }
  it('refuses iso14683_auto with no multiplier, naming the path', () => {
    expect(() => computeBridging({ ...args, tb: { mode: 'iso14683_auto', multiplier: null, alpha_pct: null } } as any)).toThrow('building.thermal_bridging.multiplier')
  })
  it('accepts a stated multiplier', () => {
    expect(computeBridging({ ...args, tb: { mode: 'iso14683_auto', multiplier: 1, alpha_pct: null } } as any).multiplier).toBe(1)
  })
})
