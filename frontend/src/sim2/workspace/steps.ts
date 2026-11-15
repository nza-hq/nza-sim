/** The seven steps of the Model workspace (plan agreed with Linzie, 15 Nov 21:53) and the shelf under them. */
export const STEPS = [
  { id: 'site', n: 1, name: 'Site', line: 'Weather and exposure' },
  { id: 'shape', n: 2, name: 'Shape', line: 'Outline, rooms and zones' },
  { id: 'fabric', n: 3, name: 'Fabric', line: 'Walls, roof, floor, windows, air' },
  { id: 'spaces', n: 4, name: 'Spaces', line: 'What each room is used for' },
  { id: 'systems', n: 5, name: 'Systems', line: 'Heating, cooling, air, hot water' },
  { id: 'check', n: 6, name: 'Check', line: 'Against the meters' },
  { id: 'interventions', n: 7, name: 'Interventions', line: 'What to change, in order' },
] as const
export type StepId = (typeof STEPS)[number]['id']
export const isStep = (s: string | null): s is StepId => STEPS.some((x) => x.id === s)

/** Today's pages that hold what the shelf names. */
export const SHELF = [
  { to: '/gains', name: 'Profiles', line: "Today's occupancy, lighting and equipment" },
  { to: '/library', name: 'Library', line: 'Constructions, systems, profiles' },
  { to: '/results', name: 'Reports', line: "Today's results pages" },
] as const
