# Brief 114: Simulate v2, the Controls step and back-of-house energy

Written 16 Nov 2026 by the journey-planning thread, from Linzie's ask of 16 Nov 00:57. She wants:
- a place for **back-of-house auxiliary energy with defaults**: pumps (inverter-driven or not) and fans (continuous
  or scheduled);
- **"almost a little BMS section"**: one place to see how the whole building is controlled (a central BMS or local
  controllers, and what tells each system to run), so there is "a single place to view everything all at once".

The plan page has the table and a picture: https://claude.ai/artifact/HkeZfzSEfSZVSUqWAqJuyF ("Controls and back
of house").

**Numbering:** this brief takes 114. Natural ventilation and air leakage (its own thread) takes 115. The meter check
moves to 116 or later. 113 stays the decodED link.
**Owners:**
- P1–P3 belong to the building thread (schema, `thermal/engine/systems.ts`, `sim2/run/`).
- P4–P5 belong to the editor thread.

**Order:** after Brief 112, because it builds on the same table.

## The decision: Controls is its own step, between Systems and Check

The new split is a four-way one, and each field still lives on exactly one step:

- **Spaces = demand.** What the room needs.
- **Systems = the kit.** What is installed, how big it is, and how efficient.
- **Controls = how the kit is told to run.** Who controls it, what it follows, and what it is set to.
- **Profiles = when.** The hour-by-hour patterns that Spaces and Controls pick from.

This takes **actual setpoints, setbacks, optimum start (109) and lighting controls** out of the Systems step and
puts them in Controls. That amends Brief 112 Part 5 (see below). Systems becomes purely "what is installed".
Controls becomes the single overview Linzie asked for, and it is also where most interventions on operation will
start (switching fans to demand control, or tightening heating hours).

Why a step and not just a view over Systems: if Controls were only a view, every control field would be edited in
two places. That breaks "one field, one place", and it hides the operating logic inside each system's card.
Linzie's wording ("a single place to view everything") favours a step whose centre view *is* the overview.

## The table (v4)

| Topic | Spaces: demand | Systems: kit | Controls: how it runs | Profiles: when |
|---|---|---|---|---|
| People | people/m², heat per person | | | occupancy |
| Equipment | W/m² | | | equipment use |
| Lighting | lux needed | W/m² per 100 lux | presence detection, daylight dimming, time clock | when light is needed |
| Heating and cooling | comfort needed | plant, efficiency, flow temperatures | set to, setback, optimum start, controller | heating and cooling hours |
| Emitters | shown on the room | set per room, kW, re-rated | TRVs, room thermostats, zone valves | follows heating hours |
| Fresh air | l/s per person | MVHR / MEV, SFP, heat recovery | continuous, scheduled or demand (CO₂); summer bypass | ventilation hours |
| Windows (natural vent) | | | the window rule: temperature, adaptive or timetable; how far; minimum time open or closed; by hand or automated | allowed opening hours, open-above temperature |
| Pumps | | per system: power, fixed or variable speed (inverter) | continuous, with demand, or scheduled | plant hours |
| Fans (back of house) | | SFP or W | continuous or scheduled | plant hours |
| Hot water | litres per person per day | heater, storage, losses, circulation pump | circulation pump timer | draw-off |
| Other building loads | | lifts, external lighting | external lighting: dusk to dawn, time clock | |

Air leakage and bridging stay in Fabric. Brief 115 places the rest of natural ventilation: q50 and its method, trickle vents and each window's physical opening (style, openable share, restrictor, Cd) on the window type in Fabric; window positions and heights in Shape; terrain and shielding in Site. Nothing goes in Systems.

## What exists today (main d11115f)

- Pumps exist today only as an **"Auxiliary" gain preset**: "Pumps", 1 W/m², always on, with a gain fraction of 1.0
  (`loadTypeLibrary.js`, Brief 72 P7). It is not tied to any system, and inverters are not modelled.
- The engine's end uses already include `pumps` and `ventilation_fans` (`schema/results.ts`).
  - Fans are SFP × flow × hours (`systems.ts`).
  - The only pump is the hot water circulation pump, `services.dhw.circulation_pump_w`, which runs all year.
- The other auxiliary presets are external lighting, catering, small power and lifts.
- The building-wide `control_strategy` field (active setpoint or free-running, Brief 64) is today's only "controls"
  input.

## Rules this must keep

- **Defaults are stated, never silent.** A "Use defaults" choice fills in values, and each one shows as "default,
  from <source>" until it is edited. The source must be a named published one (for example the UK NCM auxiliary
  energy figures by system type). P1 names it and records the values. Nothing is filled in at run time; a missing
  value is a refusal named by its path, as in Brief 107.
- **No double count.** A document that has both the old "Pumps" auxiliary gain and system-linked pumps is refused
  by name. The upgrade keeps old auxiliary profiles as they are, stated, so old models still run.
- **Record what the calculation doesn't use yet, and say so.** At first, the controller type (central BMS, local
  controller, time clock, manual) does not change any number. It is recorded and shown. The Controls view labels
  it "Recorded, not yet used in the calculation". It earns its place in the meter check and when comparing against
  BMS trend logs.
- **Rule 8.** Pump and fan energy arrive at "+ Systems". Pump heat into the water is ignored, and that is stated.
- **The anchor holds.** Bridgewater stays at 133.2, because it keeps today's stated auxiliary loads and adds no
  system pumps. A second fixture exercises the new pumps.

## Parts

**P1 Schema (building thread).** This is a version bump.
- Each heating, cooling and hot water system gains
  `pumps: { power: {w} | {w_per_kw_capacity}, speed: 'fixed' | 'variable', runs: 'continuous' | 'with_demand' | 'schedule', schedule_ref? }`.
- Ventilation entries gain `runs: 'continuous' | 'schedule' | 'demand'`. The `hours` field already exists.
- A `controls` block records the controller for each system:
  `central_bms | local | time_clock | manual`, with an optional note.
- Lifts and external lighting move from gains.auxiliary to building-level `other_loads` under Systems. Their
  magnitudes and profiles stay as stated.
- The "Pumps" auxiliary preset is retired from the picker. Old documents keep it and are refused only if system
  pumps are also present.
- Name the defaults source and commit its table.
- **The shared shape of a controls entry (agreed with Brief 115).** Every entry in `controls` names what it controls
  and how:
  `{ id, target: { kind: 'system' | 'ventilation' | 'lighting' | 'window', ref }, controller: 'central_bms' | 'local' | 'time_clock' | 'manual' | 'photocell', hours_ref?, ...kind fields }`.
  - A `window` entry adds
    `{ rule: 'temperature' | 'adaptive' | 'timetable', open_fraction, open_above_ref?, min_open_h?, min_closed_h?, operation: 'by_hand' | 'automated', modulation?: { full_open_below_dk, min_open_above_dk, min_fraction }, adaptive_category?: 'I' | 'II' | 'III' }`,
    and its `ref` is a window type or a zone. `hours_ref` is the allowed opening hours. `open_fraction` is a fraction
    of the window type's restricted maximum. `modulation` reduces the opening as the outside gets much colder than the
    inside (EnergyPlus venting open-factor modulation). `adaptive_category` (EN 16798-1) is required when `rule` is
    `'adaptive'`.
  - Brief 115 P1 owns the window fields' meanings and the physics.
  - Brief 114 P1 owns the entry shape.
  - Whichever lands first writes the shape, and the other adds to it.

**P2 Engine (building thread).**
- The pumps end use, per system:
  - **fixed speed:** rated power × the hours it runs;
  - **variable speed:** rated power × a part-load curve on that hour's load fraction. Propose the curve, state it,
    and referee it against EnergyPlus `Pump:VariableSpeed` with its default coefficients on a one-zone case.
- The hours a pump runs come from `runs`:
  - **continuous:** all hours in the heating or cooling season;
  - **with demand:** hours with load above zero;
  - **schedule:** the profile's hours.
- Fans honour `runs` the same way.

**P3 Gates (building thread).**
- Bridgewater: 133.2 unchanged.
- A new two-zone fixture with a fixed and a variable pump, against EnergyPlus.
- Check that closure and Rule 9 hold at all three levels.

**P4 Workspace (editor thread).**
- **Systems step.** Each system card gains a "Pumps and fans" block, and a new "Other building loads" group holds
  lifts and external lighting. "Use defaults" fills the stated values and labels each with its source.
- **Controls step (new tab, between Systems and Check).**
  - The left tree lists the systems.
  - The centre **Control map** shows:
    - one row per system: what controls it, what it follows (a profile or its own times), what it is set to, and
      how it runs;
    - a week timeline of when each system runs, laid over the occupancy profile.
    - Flags in words where they don't line up. For example, "Fans run 24 h; the building is occupied 10 h", or
      "Heating comes on 2 h before anyone arrives".
  - The right inspector edits the selected system's controls with preview-then-apply.
- Setpoints, setbacks, optimum start and lighting controls are on Controls only, not on Systems.

**P5 Close.** STATUS, archive, the CLAUDE.md Systems scope line, an independent review, and a PR that merges only
with Linzie's approval.

## Amendment to Brief 112

Part 5's Systems step loses "lighting controls" and "actual setpoints". Both move to the Controls step from Brief
114. If 114 hasn't landed when 112 P5 is built, they stay on Systems for now, with a note to move them.

## Not in scope

- Real BMS logic: PID loops, sequencing, lead/lag and interlocks.
- Reading live BMS data.
- Pump heat to the water.
- Distribution losses.
