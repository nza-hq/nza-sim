# Brief 103: independent review of Engine 1

Reviewer: a separate thread, given only the brief, the code and the evidence (no conclusions from the builder).
Branch reviewed: `chris/103-engine-1` at `194f6e0` (P6b). Read-only on that branch. 15 Nov 2026.

## Summary

- **No tuning found.** No engine file changed in the Part 5, Part 6 or Part 6a commits (checked with `git show --stat`).
  Engine constants are ISO/Annex B defaults with sources, unchanged since Part 4 apart from Part 6b's additions. Gate
  (a) reads Engine 1's conductances from Engine 1's own result, not State 1's. BESTEST's range gate is reported, not
  asserted, and the recorded values are regression locks, not targets.
- **The hourly closure check is real.** A mutation test (below) shows it catches solver and bookkeeping errors. It
  does not catch a physics error that is applied consistently, which no closure check can.
  Two gaps: nothing fails loudly at run time, and the Rule 9 integrand-against-display sum is never asserted.
- **The Part 6b choice is mostly principled.** Beam on the floor: yes. Wind convection off: yes. The reason given for
  leaving inside convection by heat flow off applies just as much to the default it keeps. The chosen set is also the
  one that lands nearest, so that call should be recorded as open, not settled.
- **The cooling miss diagnosis is incomplete.** BESTEST 900 is a single zone with no slabs. It shows the same-sign
  residual against EnergyPlus with the same simplifications, so the interior-slab explanation cannot be the whole
  story.

## Findings, most severe first

### 1. Medium-high: the cooling-miss attribution to interior slabs is bracketing, not attribution

`docs/audit/103/06_anchor_envelope.md` ("Diagnosis of the cooling miss"), `07_bestest_referee.md` ("Results with the
referee options as now set").

- The slab perturbation shows that slab mass is a large effect: +6.64 MWh cooling when it is removed. Engine 1's
  +1.67 MWh sits inside that range. This shows the slabs *could* explain the miss, not that they *do*.
- **BESTEST 900 is one zone with no interior slabs.** It still shows Engine 1 above EnergyPlus-with-Engine-1's-three-
  simplifications, by +0.10 MWh heating (+5 %) and +0.39 MWh cooling (+16 %). The sign is the same: less solar stored,
  sooner to load. Part of the Bridgewater miss may be this same unexplained heavy-mass residual.
- **One open candidate ruled out here.** I refined `max_sublayer_m` from 0.05 m to 0.01 m and to 0.005 m on BESTEST.
  Case 900 moved from 2.186 / 2.755 to 2.189 / 2.760 MWh. Node count is converged and is not the cause.
- **Still open, all cheap to test on 900:**
  - the inside long-wave star network, where EnergyPlus uses view factors;
  - the fixed 11 K sky, where EnergyPlus uses the EPW's infrared (Denver's sky is cold and dry);
  - the 1-hour implicit Euler step, against EnergyPlus's 15-minute CTF. This one is not in the audit's list.
- Rule 13 applies. Record the slab explanation as "consistent with", and keep the 900 residual open as a named item
  for 104. Do not report it as closed.

### 2. Medium: the closure check never fails loudly, and the Rule 9 sum is never asserted

`frontend/src/thermal/engine/model.ts:194-214`, `zone.ts:340`, `__tests__/bestest.test.ts:144`, `zone.test.ts:34`.

- The brief says the hourly closure "fails loudly beyond a stated residual". `runZoneModel` computes `closure.max_wh`
  and returns it, and nothing throws. Only the tests check it, and only on the cases they run.
- `closure.sum_kwh` is the integrand-against-display check that CLAUDE.md Rule 9 asks for: the breakdown lines summed.
  Nothing anywhere asserts it.
- **Mutation evidence.** Each mutation below was applied to a copy of the engine, then BESTEST 600 and 900 were run.

| Mutation | max closure Wh/h | breakdown sum kWh | Caught? |
|---|---|---|---|
| none (baseline) | 3e-11 | -2e-10 | n/a |
| right-hand side drops the sky term; record keeps it | 3,910 | -34,200 | yes |
| Sherman–Morrison denominator off by 10 % | 2.4–3.1 | 19–23 | yes (just over 1 Wh) |
| condensation link halved | 5,230–8,330 | 21,600–44,200 | yes |
| convective solar share doubled on the RHS only | 776 | -1,060 | yes |
| h_re doubled everywhere (a consistent physics error) | 3e-11 | -5e-10 | no, as expected |
| **breakdown drops the sky lines** | 3e-11 | **34,200** | **no test fails** |

- The hourly residual is a genuine check of the solver and of term bookkeeping, not a tautology.
- The display-side check works numerically: 34,200 kWh of missing lines shows up in `sum_kwh`. But no test reads it,
  so the Brief 28 door bug class (a term missing from the display) would pass today.
- **Fix:** assert `|closure.sum_kwh|` against a small tolerance in the tests (BESTEST, anchor and one analytic case).
  Either throw in `runZoneModel` when `max_wh > 1`, or have the caller refuse to store a run that fails.

### 3. Medium: the Part 6b inside-convection reasoning is lopsided

`frontend/src/thermal/engine/model.ts:42-53`, `07_bestest_referee.md` "What the referee comparison uses".

- **Beam on the floor: principled.** Both EnergyPlus models use FullInteriorAndExterior, so this makes the two the
  same physics. It also moved 600 heating *away* from its near-match, which is a good sign that the choice was not
  made by the number.
- **Wind convection off: principled.** ISO 4 + 4v is not DOE-2, and it averages about 20 at Denver. The speed cost
  (about 170 ms against the 100 ms budget) is an engineering reason, and the audit states it as one.
- **Inside convection by heat flow off: the reason cuts both ways.** "Table 25's 5.0 on a sunlit floor is far above
  TARP" is true. But the kept default, by tilt, gives the sunlit floor 0.7, which is far *below* TARP.
  - TARP is EnergyPlus's natural-convection correlation. From its published form (EnergyPlus Engineering Reference,
    Walton), I put it at roughly 1.5–3 W/m²K for upward flow at 1–8 K. That figure is inferred, not run.
  - With the beam now on the floor, this coefficient is the one that matters most.
- **The chosen set is also the nearest-landing set.**
  - BESTEST 900 heating and cooling are nearest with beam only.
  - Bridgewater cooling: beam only gives 15.32 MWh. Beam plus heat flow gives 16.33.
  - This is not tuning: every option is an ISO value, and the defaults are unchanged.
- **Ask:** record inside convection as an open structural difference. Show the beam-plus-heat-flow row beside the
  gate result, and do not present "off" as the physics-matching choice. A TARP-like natural-convection option would
  settle it; that is a candidate for 104.

### 4. Medium (latent): the y-factor is applied to glazing but not to opaque elements

`frontend/src/thermal/engine/model.ts:95` (glazing: `pub * y_factor`) against `model.ts:121` (opaque: no y-factor).
Today's `getUValue` applies it to every element (`frontend/src/utils/instantCalc.js:5931`).

- A library construction with a y-factor would give a different opaque U in Engine 1 and in State 1.
- Gate (a) cannot see this, because every `y_factor` in `bridgewater_anchor_v2.yaml` is null.
- A y-factor above 1 on top of ISO 14683 junction ψ (including `window_perimeter`) counts bridging twice.
- **Ask:** decide one rule (probably: no y-factor in Engine 1 when junctions are on). Make it fail loudly, and add a
  fixture with a non-null y-factor to gate (a).

### 5. Low-medium: the reference and anchor gates skip silently without local data

`frontend/src/thermal/engine/__tests__/bestest.test.ts:121` and the anchor block in `epwSolar.test.ts:130`.

- In a fresh checkout, `npm test` is green with 5 tests skipped, so the BESTEST and anchor gates are not enforced
  anywhere automatic.
- I fetched the Denver TMY3 `.mos` from the Modelica Buildings library; its sha matched the pin. BESTEST reproduced
  exactly: 600 gives 4.547 / 5.628 MWh and 900 gives 2.186 / 2.755.
- The anchor EPW download was blocked from this container, so the Bridgewater numbers were not re-run.
- **Not in `07_bestest_referee.md`:** Case 600 peak cooling is 4.978 kW, *below* its range (5.422–6.481). Case 900
  peak heating is 2.827 kW, above its range (max 2.778).
- **Ask:** commit the Denver file, which is openly licensed via LBNL, or add a CI step that fetches it by sha so the
  gate stops depending on one machine. Add the peaks to 07.

### 6. Low: the −0.5 % heating agreement is net of offsetting differences

`06_anchor_envelope.md` "Ruled out with numbers".

- Against Engine 1, the referee loses more by infiltration (30.81 against 29.04 MWh) and by vents (18.78 against
  17.83 MWh). Together that is about 2.7 MWh.
- Part of the cause is that Engine 1 uses ρc = 0.33 Wh/m³K, State 1's convention, which gate (a) needs. EnergyPlus
  uses outdoor air density, which is higher in winter.
- Something else must offset that in Engine 1. So the heating "pass" means the errors balance at about ±3 %, not that
  the engine is precise to 0.5 %.
- Say so in the gate table.

### 7. Low: shared assumptions are outside what gate (b) can test

`05_referee.md`.

- Part 5 rightly aligned the referee's inputs to the document: frame fraction, ground at the annual mean outdoor
  11.26 °C, unscaled EPW wind, and the document's absorptance.
- Every one of those changes moved the referee toward Engine 1's Part 4 figure. Each is justified on its own as input
  alignment. I found no change to EnergyPlus physics.
- Gate (b) therefore compares methods on the same assumptions. It cannot judge the assumptions themselves.
  - The ground model alone is worth 3.7 MWh, or 4 % of heating, and there is no ISO 13370 virtual soil layer.
  - The wind exposure is worth 5.0 MWh.
- Name these as unvalidated inputs in the close.

### 8. Low: defaults inside the engine

- `bridging.ts:90`: `multiplier ?? 1` is a default inside the engine. The principle says inputs fail loudly. Bridgewater
  carries its multiplier explicitly (3), so today's result does not depend on this default.
- `model.ts:163`: `initial_c` falls back to the first hour's dry bulb. This is harmless after 25 warm-up days.
- **One-zone beam.** On Bridgewater the beam lands only on the ground floor, about a fifth of the real floor area,
  and that floor is coupled to the ground. The audit states this. It is another reason finding 1 stays open.

### 9. Information: leap years

`solar.ts:74-75`: the day of the year uses a non-leap calendar, so on an 8,784-hour EPW 29 February takes 1 March's
sun. The effect is negligible.

## What was read directly and what was inferred

**Read line by line:**
- the engine: `zone.ts`, `model.ts`, `elements.ts`, `constants.ts`, `air.ts`, `bridging.ts`, `shading.ts`, `solar.ts`,
  `results.ts`;
- the assertions in `zone.test.ts` and `bestest.test.ts`;
- the brief;
- `05_referee.md`, `06_anchor_envelope.md`, `07_bestest_referee.md`;
- `103_referee.py` (constants and `build()`);
- the header and inputs of `scripts/103_anchor_envelope.mts`;
- the P6b diff.

**Skimmed:** `epw.ts` (validation paths only) and `103_bestest_twin.py` (its variant definitions only).

**Not read:** `linalg.ts`, `103_window_solar_diagnostic.py`, the Part 1 store fixes and migration 0005, and the
performance and Playwright evidence. Timings were not re-run.

**Run here:**
- engine tests: 26 passed and 5 skipped without the data;
- BESTEST with the Denver file, matching the sha;
- the closure mutation test and the node-count refinement above.

**Inferred, not run:**
- TARP coefficient magnitudes (finding 3);
- the cause of the infiltration difference (finding 6);
- that the 1-hour step is a candidate for finding 1.

**ISO 52016-1 structure.** Checked against the standard's published structure from knowledge, not against the text,
which is paid. The air node (eq. 27), element chains, the area-weighted inside long-wave network (eq. 30), the sky
term, implicit Euler at 1 h, and ideal unlimited heating and cooling all match. Layer-based nodes are a stated
departure from the five-node mass classes. The Sherman–Morrison and static-condensation algebra checks out (zone.ts
221-222, 301-308), and the mutation test confirms it numerically.
