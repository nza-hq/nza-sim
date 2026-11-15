# Brief 104 — Simulate v2 Engine 2: several zones solved together, starting from the Bridgewater cooling gap

> **CLOSED 15 Nov 2026.** Final report: [`../../audit/104/08_final_report.md`](../../audit/104/08_final_report.md). Independent review: [`../../audit/104/07_independent_review.md`](../../audit/104/07_independent_review.md).

Brief 2 of the engine sequence (design note Notion `418d645e-05cc-811e-ad6b-fa8846f12148`, Rev A.6). Written
15 Nov 2026 by Linzie's agent thread. Linzie, 18:06: "Keep going". Coordinator: start with the unexplained ~12 %
Bridgewater cooling gap.

Branch `chris/104-engine-2`, cut from `chris/103-engine-1` at `139777c`. PR #30, which carries 103, is open and not
merged, so 104's PR stacks on it. When #30 merges, merge `main` into this branch; never rebase.

## Why this brief

Engine 1 (Brief 103) runs one zone. It agrees with the EnergyPlus referee on Bridgewater heating (−0.5 %). Its
cooling is +12.2 % (15.32 against 13.65 MWh), and that miss is **open**:

- Interior slab mass that one zone does not have is **consistent with** the miss. Removing the slabs' mass in the
  referee moves its cooling by +6.6 MWh.
- The cause is not proven. BESTEST 900, which has one zone and no slabs, shows a residual of the same sign: +0.39 MWh
  cooling against EnergyPlus run with Engine 1's own simplifications.
- The independent review asked that this be attributed, not bracketed (`docs/audit/103/08_independent_review.md`,
  finding 1). Rule 13 applies: more layers may remain.

Engine 2 is the design note's next brief: zones that exchange heat through partitions and floors. Bridgewater's
referee *is* five zones, so the multi-zone engine is also the direct test of the slab explanation. This brief
therefore starts by attributing the gap with EnergyPlus experiments alone, before any engine code. It then builds the
multi-zone engine, and compares Bridgewater as five zones against the five-zone referee.

## Goal

1. **The cooling gap attributed, term by term,** with EnergyPlus experiments that change one thing at a time:
   - zone count;
   - slab mass;
   - sky;
   - inside long-wave exchange;
   - time step.

   A named cause with a magnitude, or a recorded statement of what is left.
2. **Schema 2.2.** The model document carries:
   - surfaces between two zones (`partition`, `floor` / `ceiling` pairs, with `zone_b` a zone id);
   - **internal mass**: interior construction wholly inside one zone, both faces in that zone.
3. **The engine solves several zones together, coupled through those surfaces.**
   - Entry point `runModel(document, weather, library, options) → ModelResults`, with per-zone results.
   - `runZoneModel` stays as the one-zone path and gives identical numbers.
   - One factorisation per run wherever coefficients do not change.
   - Per-zone ideal heating and cooling, solved exactly.
4. **Gates:**
   - multi-zone analytic cases to rounding;
   - Z identical uncoupled zones give Z × the one-zone result;
   - the cooled-room-among-heated-rooms case against an EnergyPlus twin;
   - Bridgewater as five floor zones against the five-zone referee, per zone and in total;
   - 50 coupled zones in under 2 s in a browser worker.

## Scope

**In:**

- EnergyPlus attribution runs under `validation/energyplus/`;
- schema 2.2 and its upgrade from 2.1;
- a converter option that zones a `building_config` box per storey;
- the multi-zone solver;
- per-zone results and breakdown lines, including the interzone transfer as a line;
- the analytic, twin and Bridgewater gates;
- performance.

**Out (later briefs; do not start them):**

- the unconditioned loft buffer zone and the three roof cases. These need a ventilated unconditioned zone, which is
  Brief 105's air-flow work. Recorded as a deferral from the design note's Engine 2 list.
- ventilation systems and internal gains (105);
- systems, delivered energy and fuel (106);
- any UI (107+);
- inter-zone air exchange beyond conduction (scope fence).

**Module scope (CLAUDE.md process rule 10).** This is the Building module, State 1 envelope-only physics, extended to
several zones. Interior partitions, floors and internal mass are envelope and fabric. No occupancy, HVAC, mechanical
ventilation, operable openings, controls or efficiencies. Each zone's comfort band is the demand constraint, as in
Engine 1.

## Design decisions already agreed (do not reopen)

- ISO 52016-1 hourly; EnergyPlus is the referee and never the product engine. One TypeScript engine, identical in
  Node and in a browser.
- The model document is the seam: the engine reads nothing else.
- Inputs fail loudly. A default lives in the document, never in the engine.
- Every term is a breakdown line, and a result whose hour or whose breakdown does not close is refused
  (`checkClosure`, 103 P6c).
- Nothing is tuned to the referee (Rule 10). A choice that lands nearer the referee needs a reason that would hold if
  it did not.
- `REFEREE_OPTIONS` puts the beam on floor-facing inside surfaces. Inside and outside convection stay ISO's fixed
  values unless Part 1's evidence says otherwise.

## Decisions this brief takes (flagged for review; the design note is updated at close)

1. **Attribution comes before code.** Part 1 changes no engine file. Its result decides whether Part 2 adds anything
   beyond zones and internal mass, for example an infrared sky option.
2. **Interzone surfaces are one element with two inside faces.**
   - A partition or floor between zones A and B is one layered chain. Its first node faces A and its last node faces
     B. Both are inside surfaces, each in its own zone's long-wave and convective network.
   - The document lists the surface once, with `zone_a` and `zone_b`. Each zone's `surfaces` list names it.
   - A `floor` / `ceiling` pair is one surface. `kind: 'floor'` means it is zone_a's floor and zone_b's ceiling, and
     tilt is taken from zone_a's side.
3. **Internal mass** is `kind: 'internal_mass'` with `zone_b` equal to `zone_a`.
   - It is a layered chain with both faces in the same zone.
   - Its area is one face's area.
   - It takes solar and long-wave like any inside surface. Whether it counts as floor-facing for the beam is a field:
     `faces_up: boolean`.
4. **Bridgewater is zoned per storey.** `fromBuildingConfig(cfg, { zoning: 'per_storey' })` gives five zones joined by
   four `floor` surfaces. They use the library's `interior_floor_ceiling` construction, the one the referee uses.
   - Walls and glazing are split per storey by height.
   - The roof goes on the top zone and the ground floor on the bottom zone.
   - Bridging is allocated per element as in the referee: each zone takes its own walls' and roof's junction lengths.
   - Infiltration and vents are allocated by each zone's share of envelope area. ~~This is what the referee does; Part
     0 confirms this.~~ **Corrected at close (review F1):** Part 0 found the opposite: the referee gives every zone the
     same rate. The Part 5 gate's referee (r2_z) was aligned to Engine 2's allocation; against the unaligned referee
     cooling is +12.3 %. Which allocation is the better default is a design choice (design note Rev A.7).
5. **Solver.** Each zone keeps its static condensation onto its interface nodes: air plus inside surfaces, with
   interzone elements contributing to both zones.
   - The coupled interface system is sparse and block-structured. It is factorised once per run, with a fill-reducing
     order, by sparse LU or a banded solve. Part 3 picks one by measurement.
   - Each zone's hourly ventilation is a rank-one change, so all of them together are a rank-Z Woodbury update.
   - Per-zone ideal loads are found exactly by superposition over the zones whose air leaves its band. The active set
     is iterated until it is consistent, which takes at most Z passes. The pass count is recorded.
6. **Performance budget:**
   - one zone: unchanged, under 100 ms;
   - Bridgewater's five zones: under 150 ms in a worker;
   - 50 coupled zones (a 10 × 5 grid of rooms over five floors): under 2 s in a worker.

   Missing a budget is an escalation.

## Principles

- **Rule 9:** the interzone transfer is a breakdown line in each zone. The building total cancels it exactly, and a
  test asserts that.
- **Rule 11:** one canonical exposure per quantity. Building totals are the sum of zones, read through one helper.
- **Rule 13:** the Part 1 result is attribution or an explicit remainder, never "consistent with".
- One Part = one commit, pushed after each. Do not stop for Linzie between Parts, except for a decision that changes
  her goal or anything irreversible.

## BEFORE DOING ANYTHING

- [ ] Read this brief, CLAUDE.md, STATUS.md (top: 103), the design note Rev A.6, and
      `docs/audit/103/{06_anchor_envelope,07_bestest_referee,08_independent_review,09_review_response,10_final_report}.md`.
- [ ] Read `frontend/src/thermal/engine/{zone,model,elements}.ts` and `validation/energyplus/103_referee.py`.
- [ ] `git status` is clean, `npx vitest run src/thermal` passes, and `_brief93_anchor.mjs --fixture` gives 133.2.
- [ ] The brief is on disk and `current.md` points at it (this commit).

## Parts

### Part 0 — Reconnaissance (read-only)

File: `docs/audit/104/00_reconnaissance.md`. Commit: `104 P0: reconnaissance`.

1. Read the referee's zones and surfaces as built:
   - per zone: floor area, walls, windows, roof, ground and slab areas, and which construction each uses;
   - how infiltration, vents and bridging are allocated per zone.
2. The interior slab construction, layer by layer, with its R and its heat capacity per m².
3. The schema 2.1 fields that already allow interzone surfaces, and what 2.2 must add.

### Part 1 — Attribute the cooling gap (EnergyPlus only; no engine change)

Files: `validation/energyplus/104_attribution.py`, `docs/audit/104/01_cooling_gap.md`, and its JSON. Commit:
`104 P1: Bridgewater cooling gap attributed by one-change EnergyPlus runs`.

Each run is the Part 5 referee (r0) with exactly one change. Report annual and monthly heating and cooling for each.

| Run | Change | Question it answers |
|---|---|---|
| r0 | none | baseline, 90.46 / 13.65 |
| one_zone | the five zones merged into one; the slabs become InternalMass in that zone; beam on the floor surfaces | Does zone count matter, with the mass kept? |
| one_zone_no_slab | as one_zone, slabs removed | Is this Engine 1's model, in EnergyPlus? |
| sky_fixed | `WeatherProperty:SkyTemperature`, dry bulb − 11 K | Engine 1's sky |
| lw_area | `ZoneProperty:UserViewFactors:BySurfaceName`, area-weighted | Engine 1's long-wave star network |
| ts_1 | one time step per hour | Engine 1's step |
| iso_conv | h_ce 20, h_ci by tilt | Engine 1's convection (Part 6a measured it on BESTEST only) |
| e1_like | one_zone_no_slab plus sky_fixed, lw_area, ts_1 and iso_conv | EnergyPlus with every Engine 1 simplification |

- The same set on BESTEST 900 (`103_bestest_twin.py` base), so the one-zone residual is attributed too.
- **Done when** the table attributes Engine 1's +1.67 MWh, the difference between Engine 1 and e1_like, and the step
  from e1_like to r0, each with a magnitude. Whatever is left is named as a remainder.
- If e1_like and Engine 1 differ by more than 3 %, instrument hourly before going further.

**Part 1 result (15 Nov):** the gap is mainly window solar kept (Engine 1 134.6 MWh, EnergyPlus about 122.5): 4.39 MWh
of the 5.99 between Engine 1 and EnergyPlus-with-Engine-1's-simplifications. Slabs about 1 MWh; zone count 0.27.
Remainder 0.95 MWh. `docs/audit/104/01_cooling_gap.md`. This adds Part 1b.

### Part 1b — Window solar: the window's own optics (added 15 Nov after Part 1)

Files: `frontend/src/thermal/engine/{glazing,model,zone}.ts` (new `glazing.ts`), tests, `docs/audit/104/01b_window_solar.md`.
Commit: `104 P1b: window solar from the window's optics (SHGC split, angular beam, diffuse lost back out)`.

- The window's normal-incidence transmittance and inward-flowing fraction come from its U and SHGC. Use EnergyPlus's
  documented SimpleGlazingSystem method (Engineering Reference, "Simple Window Model"), cited clause by clause. It is
  a published method, not a fitted one.
- Beam transmittance follows the incidence angle by the same method's angular curves. Diffuse uses the
  hemispherical average.
- Diffuse solar that falls on a window from inside leaves through it at the diffuse transmittance, and is a breakdown
  line (`solar_lost_through_glazing`).
- This replaces F_W for the run options that select it (`glazing_solar: 'optical'`). `REFEREE_OPTIONS` moves to it
  only if both referees model windows this way, which they do.
- **Done when:**
  - BESTEST and Bridgewater are re-measured with no overrides, and every recorded number that moves is re-recorded
    with its reason;
  - the remainder from Part 1 is reported again;
  - the analytic tests are unchanged.

**Outcome (15 Nov):** done, scope widened as the measurements required, all published methods:
- the angular curves, as planned;
- the Perez sky (ISO 52010-1's own; the isotropic sky had cost 6 % of transmitted solar in Denver);
- inside solar absorptance as a document input (schema 2.2), because what leaves through a window depends on it;
- the referee's convention of no solar straight to the air (`RunOptions.solar_convective_fraction`).

The referee represents the frame as the document states it. Same building, same simplifications: heating −0.6 %,
cooling +2.1 %, at inside absorptance 0.5, 0.7 and 0.99 alike. BESTEST cooling is in range for both cases.
`docs/audit/104/01b_window_solar.md`.

### Part 2 — Schema 2.2: interzone surfaces and internal mass

(Schema 2.2 already exists from Part 1b, with `inside_solar_absorptance`. It is not stored anywhere outside this
branch, so Part 2 adds its kinds to the same 2.2 rather than making a 2.3.)

Files: `frontend/src/thermal/schema/{model,upgrade,fromBuildingConfig}.ts`, tests. Commit: `104 P2: schema 2.2,
interzone surfaces and internal mass; per-storey zoning`.

- `internal_mass` kind, `faces_up`, and the checks for interzone surfaces. Each must:
  - name two existing zones;
  - appear in both zones' lists;
  - not face outside;
  - and a `floor` must have tilt 180 from zone_a's side.
- The 2.1 → 2.2 upgrade is the identity, plus the version number.
- `fromBuildingConfig(..., { zoning: 'per_storey' })` per decision 4. The default stays `'single'`, and the hash and
  output are unchanged for it.
- **Done when** the anchor converts both ways, the per-storey document's areas sum to the single-zone document's
  exactly, and the hash tests pass.

### Part 3 — The multi-zone solver

Files: `frontend/src/thermal/engine/{network,model}.ts` (new `network.ts`), tests. Commit: `104 P3: multi-zone
solver, interzone elements, exact per-zone ideal loads`.

- Decision 5. `runModel` handles any number of zones, and `runZoneModel` calls it.
- Closure is checked per zone every hour, and the building's interzone transfer cancels to rounding.
- **Done when** every 103 test passes unchanged on the one-zone path, with numbers identical to the last digit.

### Part 4 — Multi-zone gates

Files: `frontend/src/thermal/engine/__tests__/multizone.test.ts`, `validation/energyplus/104_cooled_room.py`,
`docs/audit/104/04_multizone_gates.md`. Commit: `104 P4: multi-zone analytic cases and the cooled-room twin`.

- **(a) Two zones, steady state.** A partition of known U, one zone held at 20 °C and the other free. The free zone
  settles on the hand value.
- **(b) Three zones in a row.** Hand-solved steady temperatures.
- **(c)** Z identical uncoupled zones give Z × the one-zone result.
- **(d) Internal mass.** It changes no steady-state result, and its step response follows the hand recursion.
- **(e) The cooled room.** Three rooms in a row: the outer two heated at 20 °C, the middle one cooled at 24 °C. Built
  in EnergyPlus from the same inputs. Annual demand per zone within ±10 %, or diagnosed.

### Part 5 — Bridgewater as five zones against the five-zone referee

Files: `scripts/104_anchor_zones.mts`, `docs/audit/104/05_anchor_zones.md`. Commit: `104 P5: Bridgewater five zones
against the five-zone EnergyPlus referee`.

- Per zone and in total: annual and monthly heating and cooling, Engine 2 against r0. Gate: ±10 % on the totals,
  with per-zone figures reported.
- Engine 2 run as one zone with the slabs as internal mass, against Part 1's one_zone run.
- Every miss is diagnosed by instrumentation and recorded with its magnitude. Nothing is tuned.

### Part 6 — Performance

Files: `scripts/104_perf.mts`, `docs/audit/104/06_performance.md`. Commit: `104 P6: performance`.

Decision 6 budgets, as medians of 5 in Node and in a browser worker (Playwright, `PW_EXECUTABLE`), with totals
identical in both.

### Part 7 — Close

Files: STATUS.md, `current.md`, this brief moved to `archive/104_engine-2_COMPLETED.md`, `docs/audit/104/`, the design
note Rev A.7. Independent review by a separate thread before close. PR `104 — Simulate v2 Engine 2` into `main`
(stacked on #30). Commit: `104 P7: close`.

## Verification (falsifiable)

1. `npx vitest run src/thermal` passes, including every 103 test with unchanged numbers.
2. Part 1's table attributes the 103 cooling miss, with a magnitude per change and a named remainder.
3. The multi-zone analytic cases (a)–(d) match their hand values to rounding. Closure holds per zone per hour, and
   interzone transfers cancel.
4. Cooled-room twin per zone within ±10 %, or diagnosed.
5. Bridgewater five zones against the five-zone referee: totals within ±10 %, or diagnosed, with per-zone figures.
6. Performance within decision 6.
7. `git diff` against the 103 tip touches no file of today's engine (`instantCalc.js`, `systemsEngine.js`,
   `interventionsEngine.js`, `solarCalc.js`, `wallModel.js`, `thermalBridges.js`, `thermalMass.js`,
   `openingCoefficients.js`, `nza_engine/`). `_brief93_anchor.mjs --fixture` gives 133.2.

## What MUST NOT happen

- No edit to today's engine files or to `nza_engine/`. Referee changes live in `validation/energyplus/` only.
- No number tuned to match EnergyPlus, and no default hidden inside the engine.
- No UI change, and no cut-over.
- Nothing touches NZA Decoded or NZA Decoded Test. No service-role key anywhere. No lockfile or `node_modules` commit.
- No `git rebase`, `reset --hard`, `clean` or force push.

## When to escalate (stop and report)

- Part 1 leaves more than a third of the cooling miss unattributed after three approaches (process rule 4).
- A 103 number changes on the one-zone path.
- A performance budget is missed after the sparse design.
- Anything that would change a number a client sees, or widen the scope fence.

## Final report

Include:

- what landed per Part, with commits;
- the attribution table;
- the five-zone gate table;
- divergences from the brief;
- Lessons proposals;
- what 105 (ventilation, gains, the loft buffer) needs from this engine.
