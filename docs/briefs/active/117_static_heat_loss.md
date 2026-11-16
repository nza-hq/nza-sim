# Brief 117 — Simulate v2: design heat loss per room (BS EN 12831-1) and whether the emitters meet it

Written 16 Nov 2026 by Linzie's project agent. Linzie, 10:57: "We need a static heat loss calculation that oversizes the radiators to warm the room up quickly. We also need to know, for lowering flow temperatures from a boiler at 80° to a heat pump at 55°, whether the existing radiators give us enough heat output." At 10:58 she chose to build it next, before Brief 112.

**Where it comes from.**
- Brief 108 sizes emitters on the weather file's coldest hour, from an hourly run, with no warm-up allowance. Its review (F4) already noted that this is not a design-day calculation.
- In the UK, heat pump sizing is a room-by-room design heat loss to BS EN 12831-1 (the method behind MCS MIS 3005-D and the CIBSE/MCS heat loss calculators), at a design outdoor temperature, with an optional reheat allowance.
- So the product gets two modes, side by side:
  - **Design heat loss** (this brief): static, per room, at a design day, with a warm-up allowance. It gives each room's design output.
  - **Year-round check** (Brief 108, built): the existing emitters re-rated at a flow temperature, run hour by hour.
- For each room, both compare the existing emitters' output at the chosen flow and return temperatures (EN 442, as 108) with the need, and give the rating that would cover it.

## Scope (CLAUDE.md process rule 10)

This brief works in the Systems module: emitter sizing and the design load an installed system must meet. It reads the Building module's fabric (U-values, areas, bridging, air leakage) and does not change it. It adds a new static calculation beside Engines 1 and 2 and does not change them. It adds a design block to the v2 document (schema bump, no filled defaults) and a mode to the emitter panel. Today's engine is not touched, and the anchor stays at 133.2.

**Out of scope:**
- choosing the heat pump unit;
- domestic hot water sizing;
- pipe sizing and the flow rate per radiator;
- a cooling design load.

## BEFORE DOING ANYTHING

- [ ] Read CLAUDE.md (Systems scope, Rules 9, 10, 11), Brief 108's final report, and BS EN 12831-1:2017 clauses 6 to 8 with Annex B (default values) and the national annex conventions used by MCS and CIBSE (design temperatures, ground, reheat).
- [ ] Branch `chris/117-static-heat-loss`, stacked on `chris/109-dynamics` (PR #37). The calculation does not depend on 109's physics; the stacking avoids conflicts in the seam.
- [ ] Anchor at the start and at the close: 133.2.

## Part 0 — Reconnaissance

Answer in writing (`docs/audit/117/00_reconnaissance.md`):
1. Which per-element quantities the v2 model already resolves and can feed the design calculation by one read path (Rule 11): areas, U-values, interzone surfaces, bridging, q50, ventilation entries.
2. The EN 12831-1 terms per room, each with its clause and how it maps onto the document:
   - transmission to outside;
   - transmission to the ground, by the standard's ground method;
   - transmission to unheated spaces and to rooms at other design temperatures;
   - ventilation and infiltration (design air flow, heat recovery by supply temperature);
   - reheat (heating-up capacity).
3. Design outdoor temperature. Either stated by the user, or computed from the chosen EPW as the 99.6 % annual heating dry bulb (CIBSE/ASHRAE convention), stated on screen as such. Never filled silently.
4. The reheat allowance: the standard's f_RH by setback and reheat time (Annex), or a stated W/m².
5. The decisions, numbered, before any code.

## Part 1 — The calculation and its schema

- Schema 2.6: a building-level `design` block with:
  - outdoor_c, or `{ from_weather: 'heating_99_6' }`;
  - ground method inputs;
  - reheat `{ setback_k, reheat_h }` or null.
- Per zone:
  - the design internal temperature (stated, or `follow_heat_c`);
  - for each adjacent unheated space, its design temperature or the standard's temperature factor.
- The 2.5 → 2.6 upgrade fills nothing. Without a design block, the design mode is not shown and says what to state.
- `frontend/src/thermal/engine/designHeatLoss.ts`: a pure function. Per room it returns every term as a line (Rule 9) and their sum, plus the building total, where heat between rooms cancels.
- **Tests.** Hand calculations for one room and for two rooms with a partition between rooms at different design temperatures. Every refusal by name.
- **Commit:** `117 P1: design heat loss`.

## Part 2 — Referee

- EnergyPlus `SizingPeriod:DesignDay` at the same design outdoor temperature, with no solar, no gains and constant conditions, heated by ideal loads. Run long enough to be steady. Use the cooled room and Bridgewater five storeys, with infiltration and ventilation set as EnergyPlus constants equal to the calculation's design flows.
- **Gate (stated before running):**
  - each room's transmission plus ventilation is within ±3 % of EnergyPlus's steady load;
  - the building total is within ±2 %.
- The ground term and the reheat allowance are not refereed this way. The ground term is checked by hand against the standard's worked example, and the reheat allowance against the standard's table.
- **Commit:** `117 P2: referee`.

## Part 3 — Seam and panel

- The run seam returns `summary.design_heat_loss`, with per-room lines and totals, and, for zones with emitters, their output at the design temperatures and the room's design internal temperature (108's EN 442 rating, one function).
- The emitter panel gains a mode switch: **Design heat loss** | **Year-round check**. Design heat loss shows each room's terms, the total with and without the warm-up allowance, what the existing emitters give at the base flow and return and at the what-if pair (for example 80/70 against 55/45), the shortfall, and the rating at ΔT 50 that covers it.
- Words follow the house style: a number has a label and the word *estimate*, and the basis sits behind ⓘ.
- Browser check at 1440×900 on Bridgewater and on the editor's two-zone fixture.
- **Commit:** `117 P3: seam and panel`.

## Part 4 — Independent review

A separate thread reviews the brief against the standard, the code, the referee and the panel words, with mutations. Findings are answered in `docs/audit/117/05_review_response.md`.

## Part 5 — Close

- STATUS, `current.md`, the archive, and the design note in Notion.
- CLAUDE.md gets a Systems scope line: "Design heat loss per room (Brief 117): BS EN 12831-1 transmission, ventilation and reheat at a stated design outdoor temperature, against the emitters' EN 442 output. Simulate v2 only."
- A PR, merged only with Linzie's approval.
- **Commit:** `117 P5: close`.

## Verification (falsifiable)

1. All tests pass. With no design block, every result equals 109's value for value.
2. The hand calculations agree to rounding, and each term is a breakdown line that sums to the total.
3. The EnergyPlus gate passes, or the miss is found and stated. Nothing is tuned (Rule 10).
4. No file of today's engine is touched, and the anchor is 133.2.
