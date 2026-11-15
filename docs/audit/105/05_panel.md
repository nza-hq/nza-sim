# Brief 105 Part 5 — results in the editor

`frontend/src/sim2/run/ResultsPanel.tsx` (+ `run.css`). The editor mounts it with one line inside `gl-root`:
`<ResultsPanel doc={built.doc} />` (import from `'../run/ResultsPanel'`). The editor thread adds that line on its branch;
this branch carries only the panel.

## What it shows

- **Weather.** A local EPW (read in the browser, never uploaded) or, when signed in, one of the organisation's files.
- **Missing inputs**, all at once and in plain words, when the run cannot happen. No number is shown then.
- **Building heating and cooling**, each labelled "estimate": MWh a year, kWh/m², peak kW.
- **By zone**, with ⓘ: not yet validated per zone (storeys within 31 % for cooling against EnergyPlus); the building within 4 % / 10 %.
  A zone with no cooling setpoint reads "not cooled" (and "not heated" the other way round), not 0.
- **Where the heat goes**: every breakdown term of the building (Rule 9), heat between zones left out as it cancels.
  The outside faces' three terms (sun on them, radiation to the sky, conduction) are large and mostly cancel, so they
  show as one net line, "Walls, roof and floor", opened with a tap to see all three.
- The run time.

## Seam change: heated-only zones

`preflight` asked for both setpoints in every zone. A zone that states its control (`control_strategy`) and only a
heating setpoint is now run as heated only: its cooling setpoint stays null and Engine 2 (zone.ts / network.ts, already)
models no cooling there. That is suppression by absence, not a widened setpoint (Rule 8). With no control stated, or
neither setpoint, both are still asked for. Test: `seam.test.ts` "heated only".

## Browser check (1440×900, scratch worktree = this branch + the editor's 124e8cb, never pushed)

The editor's two-zone fixture (`two_zones.plan.json`: 20 × 10 m, Office 21/24 °C with MVHR, Store heated to 16 °C,
q50 5, bridging ×1, normal exposure) loaded with `window.sim2.loadPlan`, Yeovilton TMYx through the file input.

1. As the editor writes it today the panel refuses, and says why:
   - "Choose a construction for the wall between zones." The editor writes `unassigned:partition`, and the library has
     no internal wall construction (only `interior_floor_ceiling`).
   - Then, one at a time from the engine, the space type's gain fields the editor leaves out: radiant fraction,
     area share, gain fraction, how it follows occupancy, standby factor and the always-on equipment power.
     A scratch probe lists all eleven.
2. With those stated in the scratch copy only (a partition of `cavity_wall_standard`; today's values for the gain fields):
   - Heating 9.1 MWh (45 kWh/m², peak 4 kW); cooling 0.0 MWh (40 kWh, peak 2 kW).
   - Zone 1 (Office, 120 m²) 6.5 MWh heating; Zone 2 (Store, 80 m², 16 °C) 2.6 MWh, "not cooled".
   - Walls, roof and floor −9.7 MWh net (sun on them +221.0, conduction −115.0, sky −115.7); air leakage −3.4,
     ventilation −2.2, bridges −1.5; equipment +2.9, people +1.3, lighting +0.7.
   - q50 5 → 10 raises heating to 12.3 MWh.
3. Rerun after an edit: 340–400 ms on screen, of which 250 ms is the debounce; the run itself 70–115 ms.
4. No page errors. (The 500s in the console are the old ProjectContext calling a backend that is not running here.)

The scratch filler and partition key were never committed.

## Left for the editor (sent to its thread)

- A construction for walls between zones, and an internal wall in the library (a library item, not a default).
- The gain fields above, stated by the space type (today's values are in `upgrade.ts` `stateTodaysGainInputs`).
- Equipment `baseload` always written (0 W/m² when there is none).

## Known

- Engine errors arrive one at a time (the first refusal stops the run); the seam's own checks list theirs together.
