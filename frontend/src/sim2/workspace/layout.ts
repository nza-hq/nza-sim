/** The workspace's pane widths and centre tab, remembered per browser the way Building remembers its own
 * (BuildingDefinition.jsx loadLayoutPrefs): clamped on read, one localStorage key. */
import type { StepId } from './steps'

export const MODEL_LAYOUT_KEY = 'nza-model-layout'
export const LEFT = { def: 300, min: 220, max: 440 }
export const RIGHT = { def: 380, min: 320, max: 520 }
export const MODEL_CENTRE_TABS = [
  { id: 'drawing', label: 'Drawing' },
  { id: 'heat-flow', label: 'Heat flow' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'profiles', label: 'Load profiles' },
  /** Brief 127: the results explorer (layer any hourly dataset, several views). */
  { id: 'explore', label: 'Explore' },
] as const
export type CentreTab = (typeof MODEL_CENTRE_TABS)[number]['id']

/** What each step shows in the middle (Linzie, 19 Nov 2026 00:00: "think about what it is we want each module to have").
 * Site is site and project only, Shape is geometry only, Profiles is the profile itself: none of them has results, so
 * none has tabs. Fabric and Spaces add Heat flow and Monthly; Load profiles are energy, so only the steps with systems
 * have them, and Explore (Brief 127) sits beside them. An empty list: no tab row. */
export const STEP_TABS: Record<StepId, readonly CentreTab[]> = {
  site: [], shape: [], profiles: [], check: [], interventions: [],
  fabric: ['drawing', 'heat-flow', 'monthly'],
  spaces: ['drawing', 'heat-flow', 'monthly'],
  systems: ['drawing', 'heat-flow', 'monthly'],
  controls: ['drawing', 'heat-flow', 'monthly'],
  // Brief 128: the whole model's results have their own area; Load profiles and Explore live here.
  results: ['heat-flow', 'monthly', 'profiles', 'explore'],
}
/** The steps with the results bar above the middle (what the results include, the estimate, Run). */
export const STEP_HAS_RESULTS = (s: StepId) => STEP_TABS[s].length > 0
/** The tab a step shows: the remembered one if the step has it, else the step's first (the drawing; Heat flow on Results). */
export const tabFor = (s: StepId, remembered: CentreTab): CentreTab => (STEP_TABS[s].includes(remembered) ? remembered : STEP_TABS[s][0] ?? 'drawing')
export type Layout = { left: number; right: number; centre: CentreTab; rightOpen: boolean }

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export function loadLayout(): Layout {
  try {
    const s = JSON.parse(localStorage.getItem(MODEL_LAYOUT_KEY) ?? 'null')
    if (s && typeof s === 'object') {
      return {
        left: clamp(Number(s.left) || LEFT.def, LEFT.min, LEFT.max),
        right: clamp(Number(s.right) || RIGHT.def, RIGHT.min, RIGHT.max),
        centre: MODEL_CENTRE_TABS.some((t) => t.id === s.centre) ? s.centre : 'drawing',
        rightOpen: s.rightOpen !== false,
      }
    }
  } catch { /* private window or blocked storage: defaults */ }
  return { left: LEFT.def, right: RIGHT.def, centre: 'drawing', rightOpen: true }
}
export function saveLayout(l: Layout) {
  try { localStorage.setItem(MODEL_LAYOUT_KEY, JSON.stringify(l)) } catch { /* not remembered, still works */ }
}
