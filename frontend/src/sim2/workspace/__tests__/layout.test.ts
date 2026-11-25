import { describe, expect, it } from 'vitest'
import { STEP_TABS, tabFor } from '../layout'
import { AREAS, SHOWN_STEPS, areaOf, BUILDING_VIEWS } from '../steps'

describe('what each step shows in the middle', () => {
  it('Results (Brief 128) has the whole model views; Load profiles and Explore live there', () => {
    expect(STEP_TABS.results).toEqual(['heat-flow', 'monthly', 'profiles', 'explore'])
    expect(tabFor('results', 'drawing')).toBe('heat-flow')
    expect(tabFor('results', 'explore')).toBe('explore')
    for (const s of BUILDING_VIEWS) { expect(STEP_TABS[s]).not.toContain('explore'); expect(STEP_TABS[s]).not.toContain('profiles') }
    expect(tabFor('systems', 'explore')).toBe('drawing')
  })
  it('steps without results keep no tabs', () => {
    for (const s of ['site', 'shape', 'profiles', 'check', 'interventions'] as const) expect(STEP_TABS[s]).toEqual([])
  })
})

describe('four areas (Brief 128)', () => {
  it('every shown step belongs to exactly one area', () => {
    expect(AREAS.map((a) => a.id)).toEqual(['site', 'building', 'library', 'results'])
    for (const s of SHOWN_STEPS) expect(AREAS.filter((a) => (a.steps as readonly string[]).includes(s.id))).toHaveLength(1)
    expect(areaOf('fabric')).toBe('building')
    expect(areaOf('profiles')).toBe('library')
    expect(areaOf('results')).toBe('results')
  })
})
