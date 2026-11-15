# Brief 105 — Simulate v2: the drawn building runs (editor to multi-room engine, gains, ventilation, per-floor accuracy)

Brief 3 of the engine sequence (design note Notion `418d645e-05cc-811e-ad6b-fa8846f12148`, Rev A.7). Written
15 Nov 2026 by Linzie's agent thread. Linzie, 19:58: "yep lets gp", approving the merge of #29, #30 and #31 and this
next step. Coordinator: connect the new geometry and zoning editor to the multi-room engine, so that a drawn building
with fabric and space types runs and shows results instantly; do the per-floor accuracy work alongside it.

Branch `chris/105-editor-engine`, cut from `main` at `9fda85d` (Briefs 103 and 104 merged). The editor prototype
lives on `sim2/geometry-prototype`, owned by the editor thread, which is still working on it.

## Scope statement (CLAUDE.md process rule 10)

This brief touches the new Simulate v2 engine (`frontend/src/thermal/`) and the v2 editor (`frontend/src/sim2/`).
It does **not** touch today's Building, Operation or Systems modules, or their engines:

- `instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `solarCalc.js`, `wallModel.js`,
  `thermalBridges.js`, `thermalMass.js`, `openingCoefficients.js`;
- `nza_engine/`.

Today's tool runs unchanged, and the anchor stays at 133.2.

The design note's Engine 3 scope applies, with Engine 2 as its base:

- internal gains from profiles;
- ventilation per zone (MVHR with heat recovery, MEV, natural as ACH, infiltration from q50).

Systems (delivered energy, fuel) stay Engine 4. This brief reports **demand** (heating and cooling per zone) and the
breakdown.

## Why this brief

Engine 2 solves several rooms together. The editor prototype draws a building, puts rooms in zones, applies fabric
from the library and gives rooms space types (use, profiles, systems). It writes a valid model document. Nothing yet
runs that document.

Three things stand between the drawing and a result:

1. **The engine has no internal gains and no mechanical ventilation.**
   - Engine 2 refuses `other_gains` on the multi-zone path.
   - Space types carry occupancy, lighting and equipment profiles and a ventilation system, and none of them reach
     the balance.
2. **The document cannot yet carry what a space type means in watts.**
   - The library's profiles are shapes only: hourly fractions by day type.
   - The editor has a "people per m²" box, but the schema has no field for it. It has none for lighting or
     equipment W/m² either.
3. **There is no seam from the editor to the engine.** That seam needs:
   - library constructions with their layers (the editor's snapshot has U and g only);
   - a weather file in the browser;
   - a worker;
   - a results panel.

Per-room accuracy is also open (Brief 104 review, F2 and F3):

- storey cooling is up to ±31 % against the full EnergyPlus referee;
- the roof storey's heat in through its floor is −40 % like for like;
- the engine's own one-hour step error is unmeasured.

Room-level results on screen must say plainly that they are **not yet validated**.

## Goal

1. **A drawn building runs.** Draw, add fabric, give space types, and the editor shows heating and cooling demand per
   zone and for the building, with the breakdown. It updates within about a second of an edit.
   - Where an input is missing (a construction left unassigned, no weather), the panel says what is missing and
     shows no number (CLAUDE.md rules 2 and 3).
2. **Internal gains from profiles, per zone, on both engine paths.**
   - occupancy: people per m² × W per person, sensible, convective / radiant split;
   - lighting and equipment: W/m² × the profile's hourly fraction.
3. **Ventilation per zone, on both engine paths.**
   - MVHR: flow, heat recovery effectiveness, schedule.
   - MEV: flow, schedule.
   - Natural: ACH.
   - Infiltration from q50, as now.
4. **Per-floor accuracy, measured and improved where the physics says so.** Nothing is tuned.
   - the engine's own sub-hourly step error;
   - a TARP-form inside convection option;
   - the roof-storey slab gap diagnosed.
5. **Gates against EnergyPlus for gains and ventilation:**
   - Bridgewater five storeys with gains and ventilation;
   - the cooled-room twin with gains.

## Decisions this brief takes (flagged for review; the design note is updated at close)

1. **Schema 2.3, zone gains and ventilation in physical units.**
   - Each zone gets `gains`, with fields:
     - `people_per_m2`
     - `sensible_w_per_person`
     - `lighting_w_per_m2`
     - `equipment_w_per_m2`
     - `radiant_fraction` (one per kind)
   - Each value is `null` until stated. A zone with a profile ref but a null density refuses to run, naming the
     field.
   - The editor's space type writes them.
   - Ventilation entries keep the 2.x shape (`kind`, `flow_rate`, `flow_rate_basis`, `recovery_sensible_pct`,
     `control_schedule_ref`).
   - The upgrade 2.2 → 2.3 adds `gains` with nulls.
2. **Profiles reach the engine as hourly fractions,** expanded from the library shape over the weather year:
   - by day type (weekday, Saturday, Sunday);
   - with monthly multipliers;
   - with holidays ignored until the library has them.

   One expansion function is shared by both paths and by the referee script.
3. **Constructions come with their layers.** The run seam resolves each `construction_ref.key` to the library body
   (the 102 export, which has layers).
   - An `unassigned:*` key is an input missing: no run, and the panel names the element.
   - A U-value the user typed (`u_value_override`) is honoured as today for outside elements (scaled insulation
     layer). It is refused for interzone elements, as now.
4. **Weather in the browser.** Weather is chosen from NZA Sim's own store:
   - the EPWs in the library (Supabase Storage) when signed in;
   - otherwise one committed, freely licensed UK EPW (Climate.OneBuilding, with its licence recorded).

   No silent default: the panel shows which file and station.
5. **The run happens in a web worker,** debounced on edit. The worker holds the parsed weather and library.
6. **Ownership with the editor thread.**
   - This brief owns:
     - `frontend/src/thermal/`;
     - a new `frontend/src/sim2/run/` (worker, seam, results panel);
     - `validation/energyplus/105_*`.
   - The editor thread owns `frontend/src/sim2/geometry/` and `frontend/src/sim2/library/`.
   - The panel is mounted in the editor by one agreed line. Changes either side needs from the other are asked for,
     not made.
7. **Labels.**
   - Per-zone figures carry "estimate"; per-room accuracy has a ⓘ with the open item.
   - The building total is shown first.

## Parts

### Part 0 — Reconnaissance (read-only)

Files: `docs/audit/105/00_reconnaissance.md`. Commit: `105 P0: reconnaissance`.

- What the editor's `buildDocument` writes today for a two-zone, one-storey example, and what the engine refuses in it.
- Library bodies: where the layered constructions, profiles and system templates live (Brief 102 export, Supabase
  `library_items`), and what the editor's snapshot lacks.
- Weather: the EPWs available, their licence, and size for the browser.
- Today's engine gains and ventilation conventions (Operation and Systems scopes): which quantities exist, in what
  units, so 2.3 states the same physics.

### Part 1 — Schema 2.3

Files: `frontend/src/thermal/schema/{model,upgrade}.ts`, tests. Commit: `105 P1: schema 2.3, zone gains and ventilation inputs`.

### Part 2 — Internal gains on both paths

Files: `frontend/src/thermal/engine/{gains,model,network,zone}.ts`, tests, `validation/energyplus/105_gains_referee.py`,
`docs/audit/105/02_gains.md`. Commit: `105 P2: internal gains from profiles`.

- An analytic case: a steady gain into a free-floating zone, against the hand value.
- One zone and five zones: closure per zone per hour, with a breakdown line per gain kind (Rule 9).
- Bridgewater five storeys with today's fixture profiles, against the five-zone referee with the same gains.

### Part 3 — Ventilation on both paths

Files: `frontend/src/thermal/engine/{air,model,network}.ts`, tests, referee extension, `docs/audit/105/03_ventilation.md`.
Commit: `105 P3: ventilation per zone`.

- Analytic MVHR case: H_ve = ρ c q (1 − η) while running.
- Bridgewater five storeys with its MVHR and MEV against the referee.

### Part 4 — The run seam

Files: `frontend/src/sim2/run/{seam,worker,library,weather}.ts`, tests, `docs/audit/105/04_seam.md`.
Commit: `105 P4: run seam (library, weather, worker)`.

- `simulate(doc) → { results } | { missing: [{ path, what }] }`.
- Library resolution as in decision 3.
- The weather choice as in decision 4.

### Part 5 — Results in the editor

Files: `frontend/src/sim2/run/ResultsPanel.tsx`, plus one mount line agreed with the editor thread, and browser
verification at 1440×900. Commit: `105 P5: results in the editor`.

- On a drawn two-zone building with fabric and space types: totals, per zone, and the breakdown.
- Rerun time after an edit, measured.
- Empty states for each missing input.

### Part 6 — Per-floor accuracy

Files: engine options, tests, referee runs, `docs/audit/105/06_per_floor.md`. Commit: `105 P6: per-floor accuracy`.

- **Sub-hourly step.** An engine-only run at 15-minute steps with interpolated weather. It measures the 1-hour
  error on Bridgewater five storeys and on BESTEST 900.
- **Inside convection, TARP form,** as a run option. Measured per storey against r2_z and against r2_z with the
  same form.
- **Roof-storey slab gap** (0.77 against 1.28 MWh like for like): instrumented hour by hour, and attributed.
- **Defaults.** Whether any of these become `REFEREE_OPTIONS` or default options is decided by the measurement,
  with the reason recorded.

### Part 7 — Close

- Files: STATUS.md, `current.md`, this brief moved to `archive/105_editor-engine_COMPLETED.md`, `docs/audit/105/`,
  the design note Rev A.8.
- Independent review by a separate thread before close.
- PR into `main`.
- Commit: `105 P7: close`.

## Verification (falsifiable)

1. `npx vitest run src/thermal src/sim2` passes. Every 103 and 104 test passes with unchanged numbers when gains and
   ventilation are absent.
2. Gains and ventilation analytic cases to rounding; closure per zone per hour with the new breakdown lines.
3. Bridgewater five storeys with gains and ventilation within ±10 % of the referee in total, per storey reported.
4. A drawn building in the editor shows results; an edit reruns within about 1 s on IT15; missing inputs show named
   empty states.
5. Per-floor: the step error and the TARP effect measured, and the roof slab gap attributed or recorded with a magnitude.
6. No file of today's engine touched; `_brief93_anchor.mjs --fixture` gives 133.2.

## What MUST NOT happen

- No edit to today's engine files or to `nza_engine/`.
- No number tuned to match EnergyPlus.
- No default hidden inside the engine: a missing density, construction or weather is a named error.
- No edit to the editor thread's files without its agreement.
- Nothing touches NZA Decoded or NZA Decoded Test. No service-role key anywhere. No lockfile or `node_modules` commit.
- No `git rebase`, `reset --hard`, `clean` or force push.

## When to escalate (stop and report)

- A 103 or 104 number changes with gains and ventilation absent.
- The Bridgewater gate with gains and ventilation misses and the miss cannot be attributed after three approaches.
- A weather file whose licence does not allow it in the repo.
- Anything that would change a number a client sees in today's tool.
