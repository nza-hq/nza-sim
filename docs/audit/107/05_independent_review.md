# Brief 107 — independent review (systems by zone group)

Reviewed 15 Nov 2026 by a separate thread, read-only on the code. The review covers `chris/107-systems` from `f2a20bc` (106 P3) to `77f8f8a` (107 P4).

**Files read:**
- the brief, and `docs/audit/107/00` to `04`;
- `engine/systems.ts`, the `gains.ts` and `ventilation.ts` additions, and `sim2/run/seam.ts` and `ResultsPanel.tsx`;
- `scripts/107_gate.mts`, `02_gate.json`, `scripts/107_tolerances.py` and `03_tolerances.json`;
- today's `systemsEngine.js` (the share, control factor and fan paths), and Brief 104/105's referee files.

**What I ran:**
- `vitest run src/thermal src/sim2`: 167 pass, 2 skip. The skips are the anchor-EPW tests; the EPW is not in this container.
- Ten probes on the systems function. The probe file was deleted afterwards.
- Six mutations of `systems.ts`. Each was restored, and the working tree was clean afterwards.

`107_gate.mts` could not be re-run without the anchor EPW. Every figure in `02_gate.md` and `03_tolerances.md` was re-derived by hand from the JSON instead (see "Arithmetic checked" below).

No code was changed.

## Verdicts

| Check | Verdict |
|---|---|
| **No tuning (Rule 10)** | **Confirmed.** Efficiencies and shares are read from the document. The P2(b) attribution is plain arithmetic: Δdemand × Σ(share ÷ efficiency) ÷ floor. The "everything else 0.00" is a real residual computed by `runSystems`, not forced. No constant in `systems.ts` is fitted; the only constants are today's 4.18/3600 and today's ±0.5 % share tolerance. |
| **One EUI exposure (Rule 11)** | **Confirmed.** The EUI is exposed once (`readSystemsEui`), read once in `seam.ts`, and the panel reads only `s.energy.eui_kwh_per_m2`. Nothing else in `sim2/` computes an EUI. The doc keeps it distinct from the instant engine's and from EnergyPlus's. One small note is under F8. |
| **Every term shown (Rule 9)** | **Mostly.** The end-use lines sum to the totals by fuel, and the panel shows every line, including ungrouped fans, the pump, and thin electricity. **But** the "served equals demand" invariant is display-against-display (F2), and hot water can silently drop out of the sum (F1). |
| **No filled-in defaults (Rules 2/3)** | **Mostly.** Today's fallbacks are refusals, each named by its path, and tests cover them: 60/10/40 °C, 80 L, 21/24 °C, unknown source counted as electricity, efficiency 0 giving 0. **Exceptions:** hot water is silently omitted (F1), a null control factor becomes 1 (F3), and a zero floor gives EUI 0 (F8). |
| **Gate P2(a) like with like** | **Yes, with notes (F6, F9).** The same annual demand and the same document, compared end use by end use against today's `calculateInstant` on the fixture. The heating and cooling rows are pure arithmetic. The independent content is hot water, fans, lighting, small power and auxiliary, which v2 computes itself from `gains.ts` and `ventilation.ts`; they agree to < 0.5 kWh. Only one configuration is exercised. |
| **Gate P2(b) attribution** | **Correct.** Re-derived: heating (114.546 − 102.7) × (0.95/3 + 0.05) ÷ 4215.96 = +1.03; cooling (62.725 − 92.4)/3 ÷ 4215.96 = −2.35; EUI 131.886. |
| **Tolerance table caveats stated plainly** | **Mostly.** The "shared input" rows, the duplicated electricity rows, and "the EUI's 0.0 % flatters" are all said clearly. **Missing:** Brief 104 F1, the referee's alignment to Engine 2 (F5). The EUI ±5 % row is a new tolerance nobody agreed beforehand. |
| **Today's engine untouched** | **Confirmed.** The diff touches no file under `utils/` or `nza_engine/`, and 133.2 is reproduced in the gate (133.202 unrounded). |
| **Scope (CLAUDE.md Systems)** | **Fits.** Scalar efficiencies, proportional split, tap-mix, thin entries. No capacity, no carbon. |

## Findings

| # | Severity | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| F1 | **Medium** | **Hot water is silently left out for zones no hot water system covers, and entirely when no hot water system exists.** Heating with no system is refused by name. Hot water is just dropped, with `ok: true` and nothing on the panel. A hotel whose editor forgets one storey's hot water group loses that storey's hot water from the EUI without a word. | Probe P1, three zones, the hot water group covering west only: demand 610 kWh against 1,831 kWh, `ok: true`. Probe P2, `services.dhw` filled with no hot water group: hot water 0, pump 0, no message. `systems.ts:180`: "hot water only where a system serves it". | Once any hot water group exists or `services.dhw` is filled, refuse each zone with hot water demand (occupants or floor) that no hot water group covers, naming it as heating does. Or show a named line "Hot water not served: Zone 3". Without hot water systems, the panel should say "no hot water system" rather than show nothing. |
| F2 | **Medium** | **The Rule 9 "served equals the demand it takes" check is display against display.** `zone_demand` is written inside `serve()` from the same `kwh` that feeds `served_kwh`, so a zone dropped before `serve()` vanishes from both sides. There is no run-time check in `runSystems` or the seam that served heating and cooling equal the model's building demand (the integrand). This is exactly the pattern CLAUDE.md Rule 9 warns about. | Mutation M3 (skip zone 2's heating at the demand step): the invariant test **passed**. Only the hand-number test caught it. M2 (drop one group's serve) was caught, because that one does split the two sides. | Compare, per service, Σ served against `readBuildingHeatingKwh` / `readBuildingCoolingKwh(results)` (and hot water against the tap-mix total over all zones), and throw like `checkClosure`. Test it with M3. |
| F3 | Low–Medium | **A lighting or small-power control factor does not change energy.** This is ported from today and stated in `00`/`01`, but not on screen. A user who sets PIR controls at 0.5 sees no saving: the factor only re-splits electricity between groups. **Also, a null `control_factor` becomes 1** (`systems.ts:115`, a filled default, Rule 3), which matters only for the split. | Probe P3: control factor 0.5 and 1 give the same lighting, 3,153.6 kWh. Probe P4: null is accepted. | Refuse a control factor ≠ 1 until it is modelled, or say on the panel that controls act through the gains (daylight) and the factor only splits. Refuse null when more than one group shares a zone. |
| F4 | Low | **Some inputs are silently ignored:** `capacity_kw`, `control_schedule_ref` and `control_mechanism` on groups, and `defrost_penalty_kwh` on ventilation. Meanwhile `summer_bypass` is refused (Brief 105), so the handling is inconsistent. Capacity is outside the Systems scope, but nothing tells a user who fills it in. This matters for Brief 108 (emitter caps). | Probe P5, capacity 0.1 kW against ~1 kW demand: no change. Probe P6, a schedule ref to a profile that does not exist: accepted. | Refuse non-null values that are not modelled (as for `summer_bypass`), or list them as "not used yet" in the ⓘ. At minimum, validate that `control_schedule_ref` exists. |
| F5 | Low | **The tolerance table leaves out Brief 104 F1.** The gate referee (`r2_z_gains_vent_std`) copies Engine 2's per-storey infiltration and bridging split into EnergyPlus; against r2, cooling was +12 %. `03_tolerances.md` cites only Brief 104 F2. **Also, the EUI ±5 % tolerance** was not agreed before the result, unlike the ±10 % for demand, which comes from Brief 105's verification item 3. The doc itself says the EUI row is two-thirds shared input. | `03_tolerances.md` "What this table can and cannot show"; `docs/audit/104/08_final_report.md` caveat F1. | Add one line on the referee's allocation alignment (Brief 104 F1). Mark the EUI row "information, not a gate", or record who agreed ±5 %. |
| F6 | Low | **Gate and test coverage is one configuration.** The P2(a) gate runs one zone, per person, flat hot water, always-on fans, control factor 1. Not gated against today: `follow_occupancy` hot water (no test anywhere in the repo), per m² (by hand only), a multi-group split of thin entries. **Hourly shapes are untested:** every hand demand is flat. | Mutation M1 (heating's hourly fuel time-reversed): all 42 systems and sim2 tests **passed**. `electricity_w` is not shown yet, so nobody sees the error today. It will matter for peaks, tariffs and hourly output. | Add a non-flat demand case (e.g. one hot hour) and a `follow_occupancy` case. Check `electricity_w` hour by hour, not only its sum. |
| F7 | Low | **The ⓘ text "it matches today's tool given the same demand" is broader than the evidence.** It held on the Bridgewater fixture. Scheduled fans differ by design (v2 follows the schedule; today runs 8,760 h), and today's fallbacks are refusals here. | `ResultsPanel.tsx` ⓘ, `00` gap 3. | "…matches today's tool on the Bridgewater test building given the same demand; fans follow their schedule." |
| F8 | Low | **`readSystemsEui` returns 0 when the floor area is 0.** That is a filled number: probe P9 gives EUI 0 alongside an 876 kWh pump. Also, floor area is summed twice, in `seam.ts:156` and in `systems.ts:304`. It is the same formula, and the seam test ties the two, but it is a second exposure. | Probe P9. | Refuse (or return null) on zero floor area. Take floor area from one place. |
| F9 | Info | **Labels in P2(a).** Auxiliary is compared with today's heat-balance gains electricity, and the pump with State 3, not with `computeSystemsDelivered` (the recon says this for the pump). These are the right comparisons, because those are what today's 404.144 sums, but the brief's wording says "`computeSystemsDelivered`". `diff_kwh` on the EUI row (6.4) compares against a figure rounded to 0.1, so it has no meaning. | `107_gate.mts:67,71,105`. | Say so in `02_gate.md`. Drop the EUI `diff_kwh`. |

## Arithmetic checked (from the JSON, by hand)

- **Recon sum.** 32.522 + 5.135 + 30.8 + 41.174 + 1.051 + 40.613 + 39.014 + 186.136 + 27.699 = **404.144** ✓
- **Hot water.** 257.335 × 0.52 ÷ 0.85 = 157.429 ✓, and × 0.48 ÷ 3 = 41.174 ✓
- **Five-storey EUI.** (398.596 + 157.428) ÷ 4,215.96 = **131.886** ✓
- **EnergyPlus-side EUI.** 556.024 − 42.000 − 20.908 + 43.692 + 19.128 = 555.936 → **131.866** ✓
- **Today against the referee.** 102.7 ÷ 119.16 − 1 = −13.8 % ✓; 92.4 ÷ 57.383 − 1 = +61.0 % ✓

## Mutations

| # | Mutation of `systems.ts` | Caught? |
|---|---|---|
| M1 | Heating's hourly fuel time-reversed | **No** (F6) |
| M2 | One heating group skipped in serving | Yes (2 tests) |
| M3 | One zone's heating dropped before serving | Yes, but only by the hand-number test. **The Rule 9 invariant passed** (F2). |
| M4 | Thin entries metered from heat, not electricity | Yes |
| M5 | Pump left out of the hourly electricity | Yes |
| M6 | One zone's hot water dropped | Yes |

## Before Part 5 closes

- **F1 and F2 should be fixed or explicitly accepted by Linzie.** Both let a number on screen be lower than it should be, with no message.
- **F3–F8 can be stated, or fixed cheaply.**
- **F4 and F3 feed Brief 108 (emitters).** Emitter caps will be the first capacity input that is actually used, so the "silently ignored" handling should be settled before then.

## In plain English (for Linzie)

The new part turns the heating and cooling the building needs into the energy it actually uses: gas, electricity, hot water, fans, lights and plug-in equipment, and from those the EUI.

- **The core is sound.** I re-did the sums myself, and fed the same building the old tool's demand. Every end use comes out the same as the old tool, to within a kilowatt-hour. Nothing was adjusted to get a nicer answer, and the EUI is worked out in one place only.
- **Two gaps should be closed before this is signed off.**
  1. **Hot water can quietly go missing.** If a floor is left without a hot water system, that floor's hot water just disappears from the total. A missing heating system is flagged, but a missing hot water system is not.
  2. **The engine's self-check is weaker than it looks.** It confirms that the figures agree with each other, not with the building's actual demand. A whole room could drop out and the self-check would still pass. The other tests happened to catch it.
- **Smaller points.** Lighting "controls" don't reduce energy yet, and the screen doesn't say so. A few boxes, like system capacity, are ignored without a message, which matters for the radiator-sizing work coming next. One caveat about the EnergyPlus comparison should be added to the write-up.
