import { describe, expect, it } from 'vitest'
import { STEP_TABS, tabFor } from '../layout'

describe('what each step shows in the middle', () => {
  it('Explore (Brief 127) is on the steps with systems, beside Load profiles', () => {
    expect(STEP_TABS.systems).toContain('explore')
    expect(STEP_TABS.controls).toContain('explore')
    expect(tabFor('systems', 'explore')).toBe('explore')
  })
  it('steps without results keep no tabs, and Fabric and Spaces stay without energy views', () => {
    for (const s of ['site', 'shape', 'profiles', 'check', 'interventions'] as const) expect(STEP_TABS[s]).toEqual([])
    expect(STEP_TABS.fabric).not.toContain('explore')
    expect(tabFor('fabric', 'explore')).toBe('drawing')
  })
})
