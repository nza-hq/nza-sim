import { describe, expect, it } from 'vitest'
import { STEP_TABS, tabFor } from '../layout'
import { INPUT_STEPS, OUTPUT_STEPS } from '../steps'

describe('what each step shows in the middle', () => {
  it('Results (Brief 128) has the whole model views; Load profiles and Explore live there', () => {
    expect(STEP_TABS.results).toEqual(['heat-flow', 'monthly', 'profiles', 'explore'])
    expect(tabFor('results', 'drawing')).toBe('heat-flow')
    expect(tabFor('results', 'explore')).toBe('explore')
    for (const s of ['shape', 'fabric', 'spaces', 'systems', 'controls'] as const) { expect(STEP_TABS[s]).not.toContain('explore'); expect(STEP_TABS[s]).not.toContain('profiles') }
    expect(tabFor('systems', 'explore')).toBe('drawing')
  })
  it('steps without results keep no tabs', () => {
    for (const s of ['site', 'shape', 'profiles', 'check', 'interventions'] as const) expect(STEP_TABS[s]).toEqual([])
  })
})

describe('the left pillar (Linzie, 25 Nov 2026 10:35)', () => {
  it('inputs above the line, Results below; Site is called Project and Shape is called Building', () => {
    expect(INPUT_STEPS.map((s) => s.name)).toEqual(['Project', 'Building', 'Fabric', 'Profiles', 'Spaces', 'Systems', 'Controls'])
    expect(OUTPUT_STEPS.map((s) => s.id)).toEqual(['results'])
  })
})
