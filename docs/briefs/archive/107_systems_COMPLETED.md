# Brief 107 — Simulate v2 Engine 4: systems by zone group, delivered energy by end use and fuel

Written 15 Nov 2026 by Linzie's project agent (Linzie, 14 Nov 22:50: "we write the briefs now"; 15 Nov 21:15: carry on with the next items). Design note: Notion `418d645e-05cc-811e-ad6b-fa8846f12148`, Rev A.8, sequence item 4 ("systems by zone group, DHW, outputs by end use and hour, the breakdown invariant; EnergyPlus referee with the tolerance table").

## Scope (CLAUDE.md process rule 10)

- **Systems module.** The work fits the Systems scope in CLAUDE.md:
  - delivered energy from demand through scalar efficiencies;
  - a proportional split across systems serving the same service (no capacity, lead/lag or schedule hand-off);
  - the DHW tap-mix model;
  - lighting and small power as thin entries reading the gains;
  - fuel split and EUI.
- **Applied to v2.** It applies that scope to Simulate v2's document: `system_groups`, `services`, and the zones' demand from Engine 1 and 2.
- **Out of scope:**
  - carbon (the design note's Results brief);
  - renewables;
  - plant curves, part load, and distribution or standby losses (the design note's scope fence);
  - any change to today's `systemsEngine.js`, `instantCalc.js` or `nza_engine/` (read and ported only);
  - the editor's files.
- The anchor stays 133.2.

## BEFORE DOING ANYTHING

- [ ] Read CLAUDE.md (Systems scope, Rules 9 and 11), STATUS.md (Briefs 103–106), and the design note Rev A.8.
- [ ] Read `frontend/src/utils/systemsEngine.js` `computeSystemsDelivered` and its State 3 caller in `instantCalc.js`, and the converter's systems mapping (`thermal/schema/fromBuildingConfig.ts`).
- [ ] Read the editor's `toDocument.ts` on `sim2/geometry-prototype` for the system groups it writes (ids `service_<system id>`, share 100, `source`, `efficiency_metric`, `template_ref`).
- [ ] Branch `chris/107-systems`.

## Part 0 — Reconnaissance

- **File:** `docs/audit/107/00_reconnaissance.md`.
- Map `computeSystemsDelivered` path by path for heating, cooling, DHW, ventilation fans, lighting, small power, auxiliary and the DHW circulation pump. For each path, record:
  - each input;
  - where the v2 document holds it, or that it does not;
  - the formula.
- List what the document lacks for each path, as candidate schema 2.4 fields.
- **Commit:** `107 P0: reconnaissance`.

## Part 1 — `engine/systems.ts`

- **What it does.** A pure function takes the document, the model results, and the gains and ventilation it already computes. It returns, per system group and hourly, the demand served and the energy delivered, plus each group's fuel.
  - Heating and cooling: served = share × the group's zones' hourly ideal-load demand; delivered = served ÷ efficiency.
  - DHW: CLAUDE.md's tap-mix model, by profile.
  - Lighting and small power: the electricity of the gains already computed (no second gains calculation, Rule 11).
  - Ventilation fans: SFP × flow × hours run.
- **Missing inputs are refused and named, never filled:**
  - a zone with demand that no enabled group serves;
  - shares for a zone's service that do not total 100 %;
  - a missing efficiency or fuel.
- **Breakdown invariant (Rule 9).** Per group and per service, served equals the demand it takes. The sum over services of delivered energy equals the annual total by fuel. Both are tested.
- **Tests:** analytic cases (one zone, two groups at 60/40, a COP of 3, DHW tap-mix by hand).
- **Commit:** `107 P1: systems by zone group`.

## Part 2 — Gate against today's systems path

- **Path by path.** Feed today's State 2 demand for Bridgewater (the fixture, via `_brief93_anchor.mjs`'s inputs) into `systems.ts` through the converted document. Each end use must equal `computeSystemsDelivered` to rounding.
- **EUI on Engine 2.** Then run Engine 2 demand through the same systems and state the EUI against 133.2.
  - The difference is attributed term by term to demand differences already recorded in Briefs 103–105.
  - Nothing is tuned (Rule 10).
- **File:** `docs/audit/107/02_gate.md`.
- **Commit:** `107 P2: gate against today's systems`.

## Part 3 — The tolerance table against EnergyPlus

- **What is compared.** Bridgewater as five storeys, per end use, NZA | EP | Δ%. EnergyPlus's ideal-load demand goes through the same scalar efficiencies, and EnergyPlus supplies its own lighting and equipment electricity.
- **Tolerances.** Each end use has an agreed tolerance, printed. Demand terms carry Brief 105's numbers.
- **What this comparison can show.** With scalar efficiencies, the delivered numbers can disagree only where demand or gains disagree. The doc says so plainly, and the table is the evidence.
- **File:** `docs/audit/107/03_tolerances.md`.
- **Commit:** `107 P3: tolerance table`.

## Part 4 — Results panel: delivered energy

- **What it shows:**
  - delivered energy by end use and by fuel;
  - the EUI (kWh/m² a year);
  - each system group's served and delivered energy;
  - "estimate" on each figure, and the basis behind ⓘ.
- **One quantity, one exposure (Rule 11).** The v2 EUI is a separate boundary from the instant engine's and from the EnergyPlus simulation EUI. It is read through one helper.
- **Missing systems.** Where none are stated, the panel shows demand only and says what is missing.
- **Browser check** at 1440×900 on the editor's fixture.
- **Commit:** `107 P4: delivered energy in the panel`.

## Part 5 — Close

- An independent review by a separate thread.
- Update STATUS.md and `current.md`, move this brief to `archive/107_systems_COMPLETED.md`, update `docs/audit/107/`, and write the design note Rev A.9.
- Open a PR into main; it is merged only with Linzie's approval.
- **Commit:** `107 P5: close`.

## Verification (falsifiable)

1. All thermal and sim2 tests pass. Demand results are unchanged.
2. The analytic systems cases agree to rounding. Served equals demand per group, and delivered sums to the totals by fuel.
3. Fed today's demand, every end use equals `computeSystemsDelivered` to rounding.
4. On Engine 2's demand, the EUI is stated against 133.2, with the difference attributed.
5. The tolerance table is printed.
6. The panel shows delivered energy, with named empty states.
7. No file of today's engine is touched, and `_brief93_anchor.mjs --fixture` gives 133.2.

## Deliverables

1. Reconnaissance (P0).
2. `engine/systems.ts` with tests (P1).
3. Gate document (P2).
4. Tolerance table (P3).
5. Panel (P4).
6. STATUS, current.md, archive, design note Rev A.9 and the review (P5).
