# Brief 114 P0: reconnaissance and decisions

16 Nov 2026, branch `chris/114-controls` from `chris/120-plant-capacity` (6928471; 112 merged in). Brief: [`docs/briefs/active/114_controls-and-back-of-house.md`](../../briefs/active/114_controls-and-back-of-house.md). Linzie, 16 Nov 00:57: a place for back-of-house auxiliary energy with defaults (pumps, inverter or not; fans, continuous or not), and "almost a little BMS section": one place to see how the whole building is controlled.

**Scope (CLAUDE.md process rule 10).** Systems module: pump and fan energy, and the building's other electrical loads, are "energy delivered by installed equipment" and "control mechanism" per system (Systems scope). The control map records controllers; it changes no physics in Building or Operation. Simulate v2 only; today's engine is not touched.

## What exists (before 114)

- Pumps: only the DHW circulation pump (`services.dhw.circulation_pump_w`, all year) and today's "Lifts / pumps" auxiliary gain preset in `loadTypeLibrary.js` (today's tool). The v2 editor writes no auxiliary profiles. Bridgewater's only auxiliary profile is External lighting (gain fraction 0).
- Fans: SFP × flow × the hours its `control_schedule_ref` schedule says (`ventilation.ts`, `systems.ts`).
- Controls: `control_mechanism` and `control_schedule_ref` on system groups are listed as "not modelled"; zone setpoints, setbacks and heating hours live on the zone (Brief 109).
- 424 v2 tests pass, 2 skip (anchor EPW not in this container; the proxy blocks its download).

## Decisions (ours; Linzie said "do what we think is best")

1. **Fields stay where the engine reads them; the Controls step edits them there.** Zone setpoints, setbacks, heating hours (Brief 109), lighting controls (daylight factor, presence via the lighting profile's relationship) keep their document paths. The brief's "one field, one place" is met at the step level: the Controls step is where they are edited, the Systems step no longer shows them. Moving them in the document would need an upgrade and a gains change for no change in a number. (Answers 112 review F3 for the workspace; the document path is unchanged and that is stated.)
2. **Defaults source:** NCM Modelling Guide 2021 (England), Table 14 (p. 32) pump power density W/m² over the heating hours (para 103), and paras 66–67 Notional-building SFP (citations corrected after review F9) (`thermal/catalogue/auxiliaryDefaults.ts`). The rated power is the constant-speed row; the variable-speed rows already include the inverter's saving, which here comes from the part-load curve, so they are not used (that would count it twice). Cooling = "Both" − "LTHW only" (stated subtraction). No default for hot water pumps (none published) or for systems with no water circuit (NCM Table 13: split, VRF).
3. **Variable-speed curve:** EnergyPlus Pump:VariableSpeed's default coefficients (0, 1, 0, 0) on the hour's load ÷ design load (capacity, else the busiest hour). The brief named this referee; the referee showed EnergyPlus's flow fraction tracks the load fraction closely for radiators at 50/40 (02_referee.md).
4. **"Continuous"** is every hour of the months in which the system has any load (the brief's "season"), not all year. EnergyPlus's Continuous pump runs all year; that difference is reported.
5. **Fans on demand** follow the share of the zone's people present (its occupancy profile), never below a stated least share. This also changes the ventilation heat loss in those hours, as it must: it is the same running fraction.
6. **Other loads** (lifts, external lighting) are new, document-level `other_loads`, end use "auxiliary". Their heat warms no room. Old auxiliary profiles are kept as stated, so Bridgewater does not move. External lighting "dusk to dawn" = hours with no daylight in the weather file (global horizontal 0 Wh/m²).
7. **The controller is recorded, not used** ("Recorded, not yet used in the calculation"), listed among the inputs not modelled. Window entries carry Brief 115's fields; the rule waits for 115.

## Plan

P1 schema 2.10 → P2 engine (`pumps.ts`, `systems.ts`, `ventilation.ts`) and its EnergyPlus referee → P3 gates (Bridgewater byte for byte, three levels) → independent review → P4 workspace (editor thread) → P5 close. Owed from Brief 120 (cooling-capacity referee, held-out wet case) follow the review.
