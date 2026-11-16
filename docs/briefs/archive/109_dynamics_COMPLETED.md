# Brief 109 — Simulate v2: heating hours and setbacks, morning warm-up, underfloor heating in the slab

Written 15 Nov 2026 by Linzie's project agent. Linzie, 15 Nov 23:57: "Keep going."

**Where it comes from.**
- Linzie's follow-up to Brief 108 (15 Nov 21:35): heat should not arrive instantly. Brief 108 handed three things to this brief:
  - underfloor heat into the slab;
  - emitter warm-up;
  - morning boost within capacity.
- The design note's contract has had `setpoints { heat_c, cool_c, setback_c, hours_ref }` since Rev A. The engines refuse `setback_c` and `hours_ref` today ("not modelled yet").
- The end goal is realistic hourly load profiles to compare with meters ([[load-profiles-goal]]). A building heated 24 hours a day at one setpoint does not have a meter's shape: no morning peak, no night fall.

## Scope (CLAUDE.md process rule 10)

This brief works in the Systems module: service setpoints and the hours a heating or cooling service runs, and how emitters deliver their heat. It changes the Simulate v2 engines (Engines 1 and 2) and the v2 run seam. Today's engine (`instantCalc.js`, `systemsEngine.js`, `nza_engine/`) is not touched, and the anchor stays 133.2.

- **Building module boundary.** The Building module's "comfort band" demand has no controls, setbacks or hours. In v2 that is Brief 111's "Fabric only" level: every zone heated at one temperature all day. That level stays exactly as it is. A zone's hours and setback apply from "+ Spaces" up.
- **Underfloor heating in the slab** is how an installed emitter gives its heat (Systems). The floor's construction is still the Building module's. The emitter only says which layer the pipes are in.
- **Out of scope:**
  - optimum start, which learns how early to start. A fixed early start is just the schedule;
  - weather compensation;
  - a radiator's own water and metal heat capacity (Part 0 measures it; at an hourly step it is expected to be negligible, and it is stated, not modelled);
  - cooling emitters;
  - ventilation hours (they already follow their own schedules).

## BEFORE DOING ANYTHING

- [ ] Read CLAUDE.md (Systems scope, Rules 8, 9, 10), Brief 108's final report, and the control code: Engine 1 in `zone.ts` (`phi`, `capAt`) and Engine 2 in `network.ts` (the active set, the warm start, `capW`).
- [ ] Branch `chris/109-dynamics`, stacked on `chris/108-emitters`.
- [ ] No file of today's engine changes. Run `scripts/_brief93_anchor.mjs --fixture validation/fixtures/bridgewater_anchor_v2.yaml` at the start and at the close: 133.2.

## Part 0 — Reconnaissance

- **File:** `docs/audit/109/00_reconnaissance.md`.
- **Where the engines assume one setpoint for the year:**
  - Engine 1's `phi`;
  - Engine 2's active set and warm start;
  - the unmet-hours count;
  - the sizing peak (Brief 108 P4);
  - Brief 111's levels.
- **The schedule.** `hours_ref` names a profile of kind `schedule`. Its day values are fractions of 0 to 1 by hour, weekday/Saturday/Sunday, on the same calendar as gains (`gains.ts` `calendar`).
- **Decisions to settle, each written down with a reason:**
  1. **Meaning of the schedule value.** The proposal is that the hour's heating setpoint is setback_c + f × (heat_c − setback_c). So 1 means heat_c and 0 means setback_c. With no setback stated, 0 means heating off.
  2. **Cooling outside the hours.** The proposal is that cooling runs only where f > 0. Cooling a building to 24 °C at night is not what a scheduled system does. A zone that wants cooling all night states no hours.
  3. **Unmet hours.** These are counted against each hour's own setpoint. They are also counted a second way, only in hours where f = 1 ("in use"). The panel shows the in-use count, because that is what an occupant feels.
  4. **The sizing peak with a setback.** The peak is the morning recovery, which can exceed the steady peak. The proposal is that it is reported as it is: the panel says which hour it was, and gives the steady-state peak beside it.
  5. **Underfloor heating in the slab.** The underfloor emitter names the surface and the layer its pipes are in. Its heat goes into that layer's node, not the air or the room's surfaces. The proposal is that this is in Engine 2 only; Engine 1, which runs one-zone documents, refuses it by name.
  6. **A radiator's own heat capacity.** Work out how big the effect is for a typical steel panel. The working figure is about 5 kJ/K per 1 kW at ΔT 50, a time constant of about 10–15 minutes. Then decide whether it is negligible at a one-hour step.
- **The EnergyPlus objects for the referees.** Thermostat setpoints from `Schedule:Compact`. Underfloor heating: `ZoneHVAC:LowTemperatureRadiant:VariableFlow` with `ConstructionProperty:InternalHeatSource`. Check that both run in 25.2.0, and how EnergyPlus counts unmet hours against a scheduled setpoint.
- **Commit:** `109 P0: reconnaissance`.

## Part 1 — Hours and setbacks on Engines 1 and 2

- **Files:** `engine/model.ts` (resolve each zone's hourly heating and cooling setpoints from `hours_ref` and `setback_c`, and stop refusing them), `engine/zone.ts` and `engine/network.ts` (setpoints become hourly arrays; a constant setpoint is the same arrays filled), `engine/results.ts`.
- **What the engines produce:**
  - each hour's heating and cooling setpoints;
  - hours below, counted against each hour's own setpoint and "in use" (decision 3);
  - the lowest temperature in use.
- **Refusals.** A missing or unknown `hours_ref`, a profile of another kind, or a setback above `heat_c` are each refused by name. Nothing is defaulted.
- **Emitter limits still apply every hour** (Brief 108's re-rating at the room's temperature). The morning boost is the emitters at their limit until the room is back to setpoint. Nothing extra is modelled.
- **Tests:**
  - With no hours stated, every result equals Brief 108's, value for value.
  - A step: one zone, held at a constant outside temperature, after a setback.
    - Engine 1 follows its own analytic response through the hour's step, to 0.01 K.
    - Engine 2 equals Engine 1 to rounding.
  - Closure holds every hour on every solver path, including the hour the setpoint changes.
  - A zone with a schedule of all 1s equals the unscheduled run exactly.
- **Commit:** `109 P1: heating hours and setbacks`.

## Part 2 — EnergyPlus referee for hours and setbacks

- **Files:** `validation/energyplus/109_setback_referee.py`, `109_setback_spec.json` (chosen before any comparison), `scripts/109_setback.mts`, and `docs/audit/109/02_referee.md` plus its JSON.
- **The cooled room:**
  - heated 07:00 to 19:00 on weekdays at 20 °C, with a setback of 15 °C;
  - with ideal loads unlimited, and with Brief 108's 800 W and 1,100 W limits (`LimitCapacity`).
- **Bridgewater, five storeys** (Brief 105's gate referee), heated to its schedule with a 16 °C setback.
- **Gate** (proposed now, before any run):
  - annual heating ±10 %;
  - the average weekday morning peak ±15 %;
  - hours below in use: ±20 % or ±50 h;
  - the lowest temperature in use: ±1 K;
  - the average weekday 24-hour heating profile, hour by hour: within 15 % of EnergyPlus's daily peak.
- **Commit:** `109 P2: referee`.

## Part 3 — Underfloor heating in the slab

- **Schema 2.5.** An `underfloor` emitter gains `source_surface_id` and `source_layer_index` (the layer its pipes run in). Both are null for every other kind; for underfloor, both are required. The 2.4 → 2.5 upgrade fills nothing: a 2.4 underfloor emitter is refused by name until those are stated.
- **Engine 2:**
  - The emitter's heat enters that layer's node (the floor's own conduction carries it up into the room and down into the ground, or into the room below).
  - The control is the zone's thermostat, as for every emitter.
  - The limit is the emitter's EN 442 output, re-rated at the room's temperature (Brief 108's `at()`). This is stated as an approximation and refereed below.
- **Engine 1** refuses an underfloor emitter in a slab, by name (decision 5). *As built: a document with underfloor heating runs on Engine 2, one zone included, as sub-hourly steps and TARP already do (`03_ufh.md`).*
- **Tests:**
  - closure every hour, with the heat put into the slab as its own breakdown line (Rule 9);
  - a steady state by hand: in a constant cold, heat in the slab equals the room's losses plus the downward loss;
  - a step response that lags an air-heated zone's.
- **Referee:** `validation/energyplus/109_ufh_referee.py`. The cooled room, with its heated rooms' ground floors carrying `ZoneHVAC:LowTemperatureRadiant:VariableFlow` in the same layer *(as built: `ZoneHVAC:LowTemperatureRadiant:Electric`, a fixed limit, so the room-temperature rating is measured but not refereed; `03_ufh.md`)*, heated to Part 2's schedule. Same gate as Part 2.
- **Commit:** `109 P3: underfloor heating in the slab`.

## Part 4 — Run seam and panel

- **Files:** `sim2/run/seam.ts` (passes hours and setbacks; `explain` gains plain words for them), `sim2/run/EmitterSizing.tsx`. *As built: a separate `sim2/run/HeatingHours.tsx`; EmitterSizing changed in P5 (sizing on the year without the setback, in-use counts).*
- **The panel shows:**
  - the hours below in use;
  - the morning peak and the steady peak, with the hour each happened;
  - for each zone with a setback, how long it takes to get back to setpoint on a typical cold morning.
- **The editor's own setpoint and hours inputs** belong to the editor thread. It is told when Part 1 lands. `ResultsPanel.tsx` and `run.css` are the editor thread's files and are not touched here.
- **Browser check** at 1440×900.
- **Commit:** `109 P4: seam and panel`.

## Part 5 — Independent review

A separate thread reviews docs, code and referees, with mutations, before the close. Its findings are answered in `docs/audit/109/06_review_response.md`.

## Part 6 — Close

- STATUS, `current.md`, the archive, and design note Rev A.11 in Notion.
- The CLAUDE.md Systems scope gains one line: "Heating hours and setbacks per zone (Brief 109): a zone's heating setpoint follows its schedule between heat_c and setback_c, and cooling runs only in its hours; underfloor heating can put its heat into a floor layer. Simulate v2 only."
- A PR. It is merged only with Linzie's approval.
- **Commit:** `109 P6: close`.

## Verification (falsifiable)

1. All tests pass. With no hours stated, every result equals Brief 108's, value for value.
2. Analytic step response to 0.01 K; closure every hour.
3. Every referee is within its printed gate. If a referee misses, the cause is found and stated. Nothing is tuned (Rule 10).
4. No file of today's engine is touched. The anchor is 133.2.
5. Speed: five storeys with a schedule stays within Brief 104's budget (measured in the container now; on IT15 when it is next on).
