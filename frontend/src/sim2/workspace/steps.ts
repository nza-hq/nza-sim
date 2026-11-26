/** The steps of the Model workspace (plan agreed with Linzie, 15 Nov 21:53; Profiles added on her ask, 16 Nov 00:12; Controls by Brief 114, between Systems and Check)
 * and the shelf under them. */
export const STEPS = [
  { id: 'site', n: 1, name: 'Project', line: 'Project, weather, wind and terrain' },
  { id: 'shape', n: 2, name: 'Building', line: 'Outline, rooms and zones' },
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

/** The inputs, in the left pillar's top group; Results sits below the line (Linzie, 25 Nov 2026 10:35: "a left-facing
 * pillar rather than stuff along the top", as today's NZA Sim: inputs, a line, outputs, the library at the bottom). */
export const INPUT_STEPS = SHOWN_STEPS.filter((s) => s.id !== 'results')
export const OUTPUT_STEPS = SHOWN_STEPS.filter((s) => s.id === 'results')

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
