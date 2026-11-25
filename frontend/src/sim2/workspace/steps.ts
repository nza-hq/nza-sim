/** The steps of the Model workspace (plan agreed with Linzie, 15 Nov 21:53; Profiles added on her ask, 16 Nov 00:12; Controls by Brief 114, between Systems and Check)
 * and the shelf under them. */
export const STEPS = [
  { id: 'site', n: 1, name: 'Site', line: 'Weather and exposure' },
  { id: 'shape', n: 2, name: 'Shape', line: 'Outline, rooms and zones' },
  { id: 'fabric', n: 3, name: 'Fabric', line: 'Walls, roof, floor, windows, air' },
  { id: 'profiles', n: 4, name: 'Profiles', line: 'When things happen, hour by hour' },
  { id: 'spaces', n: 5, name: 'Spaces', line: 'What each room is used for' },
  { id: 'systems', n: 6, name: 'Systems', line: 'Heating, cooling, air, hot water' },
  { id: 'controls', n: 7, name: 'Controls', line: 'How the systems are told to run' },
  // Brief 128: the whole model's results, in their own area.
  { id: 'results', n: 8, name: 'Results', line: 'Heat flow, monthly, load profiles, explore' },
  // Not built yet: hidden from the navigation until they are (Linzie, 19 Nov 2026 19:16, "hide the pages that we don't
  // need until we build them"). Their addresses still open the step's placeholder.
  { id: 'check', n: 9, name: 'Check', line: 'Against the meters', later: true },
  { id: 'interventions', n: 10, name: 'Interventions', line: 'What to change, in order', later: true },
] as const
export type StepId = (typeof STEPS)[number]['id']
/** The steps shown in the navigation: the built ones. */
export const SHOWN_STEPS = STEPS.filter((s) => !('later' in s && s.later))
export const isStep = (s: string | null): s is StepId => STEPS.some((x) => x.id === s)

/**
 * Brief 128 (Linzie, 25 Nov 2026: "four areas is right"): the navigation is four areas, not nine steps. Building is one
 * canvas with five views; the steps stay as the address (?step=) and as the views, so links and saved layouts still work.
 */
export const BUILDING_VIEWS = ['shape', 'fabric', 'spaces', 'systems', 'controls'] as const satisfies readonly StepId[]
export const AREAS = [
  { id: 'site', name: 'Site', line: 'Place, weather and project', steps: ['site'] },
  { id: 'building', name: 'Building', line: 'Shape, fabric, spaces, systems, controls', steps: [...BUILDING_VIEWS] },
  { id: 'library', name: 'Library', line: 'Profiles: when things happen', steps: ['profiles'] },
  { id: 'results', name: 'Results', line: 'Heat flow, monthly, load profiles, explore', steps: ['results', 'check', 'interventions'] },
] as const satisfies ReadonlyArray<{ id: string; name: string; line: string; steps: readonly StepId[] }>
export type AreaId = (typeof AREAS)[number]['id']
export const areaOf = (s: StepId): AreaId => AREAS.find((a) => (a.steps as readonly StepId[]).includes(s))!.id
export const isBuildingView = (s: StepId) => (BUILDING_VIEWS as readonly StepId[]).includes(s)
/** The Building view last open on this computer, so Building reopens where it was left. */
const VIEW_KEY = 'nza-sim.building-view'
export const lastBuildingView = (): StepId => {
  try { const v = localStorage.getItem(VIEW_KEY); return v && isStep(v) && isBuildingView(v) ? v : 'shape' } catch { return 'shape' }
}
export const rememberBuildingView = (s: StepId) => { if (isBuildingView(s)) try { localStorage.setItem(VIEW_KEY, s) } catch { /* private window */ } }

/** Today's pages that hold what the shelf names. */
export const SHELF = [
  { to: '/gains', name: "Today's profiles", line: "Today's occupancy, lighting and equipment pages" },
  { to: '/library', name: 'Library', line: 'Constructions, systems, profiles' },
  { to: '/results', name: 'Reports', line: "Today's results pages" },
] as const

// @ts-expect-error untyped JS from today's app
import { MODULE_THEMES } from '../../data/moduleThemes.js'
/** Brief 110b row 1: each step wears the accent of today's module it stands for. */
export const STEP_ACCENT: Record<StepId, string> = {
  site: MODULE_THEMES.weather.accent, shape: MODULE_THEMES.building.accent, fabric: MODULE_THEMES.building.accent,
  profiles: MODULE_THEMES.profiles.accent, spaces: MODULE_THEMES.gains.accent, systems: MODULE_THEMES.systems.accent, controls: MODULE_THEMES.systems.accent, results: MODULE_THEMES.consumption.accent, check: MODULE_THEMES.consumption.accent,
  interventions: MODULE_THEMES.interventions.accent,
}
/** The step the workspace opens on when the address names none. */
export const DEFAULT_STEP: StepId = 'shape'
