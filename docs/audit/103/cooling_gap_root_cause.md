# Why NZA Sim and EnergyPlus disagree on cooling (and heating)

14 Nov 2026. Read-only investigation for Brief 103. Repo `nza-hq/nza-sim` at `chris/103-engine-1` (`3b84614`); engine `frontend/src/utils/instantCalc.js` as on `main`. Weather: Yeovilton EPW copied read-only from IT15, sha256 `c6571102…8cf2` (matches the anchor). No repo file changed, nothing pushed. EnergyPlus was not run here (not allowed in this environment), so every EnergyPlus number below comes from runs already recorded in the repo.

## Update 23:40: EnergyPlus confirmation runs (EP 25.2.0, same EPW, 0 errors; detail in `ep_confirm_results.md`)

The 98-C figures (107.2 / 88.3) turned out to be from a **VRF** model, not ideal-load demand. Re-run with IdealLoads on the same matched inputs, flat 21/24 band:

| Heating / cooling, MWh | Full Bridgewater | Envelope only |
|---|---|---|
| **EnergyPlus, IdealLoads** | **112.7 / 85.3** | **68.7 / 34.8** |
| NZA today | 87.7 / 101.1 (−22 % / +19 %) | 59.4 / 50.7 (−14 % / +46 %) |
| NZA with bridging in the balance | 102.7 / 92.4 (**−9 % / +8 %**) | 76.0 / 41.9 (+11 % / +20 %) |
| NZA State 1 (Building page) | — | 129.2 / 98.6 (**1.9× / 2.8×**) |

**Timestep (EP side):**
- 10 steps/h is identical to 4 steps/h (112.7 / 85.3).
- Hourly gives 114.5 / 80.5 (+1.6 % / −5.7 %).

**What the runs confirm:**
- **Timestep is not the cause of any large gap.** It is a few percent at most, on cooling only.
- **The bridging bug is real and is the biggest single cause.** It closes over half of the full-model gap (heating −22 % → −9 %, cooling +19 % → +8 %).
- **State 1 is the wrong method to gate against.** It is 2.8× EnergyPlus on envelope-only cooling.
- **The remaining ~9 % after the bridging fix is a genuine method difference, not a mismatch in inputs.** Candidates are the internal-mass / gain-coupling assumptions; adding mass in EnergyPlus moved it less than 2 %. The ±15–20 % bands Part 0 proposed for an EnergyPlus referee would still hold.
- **"Within about 5 %" in the text below is superseded:** the corrected figure is about 9 %.

## In plain English

1. **The "+56 % cooling" figure is out of date.** It comes from a May 2026 test (`docs/validation/state1_static_vs_dynamic_post_part3_v1.md`) on an older engine and a different building: 3,457 m² instead of 4,216 m², 0.2 ACH, no thermal bridging, no vents, comfort band 21/25. The two models were not given the same building, and the engine has been rebuilt several times since. Brief 98-A later declared all pre-July comparisons void for this reason. That figure should be dropped.
2. **The best like-for-like comparison we have is Brief 98-C** (July, branch `chris/engine-convergence`, not merged). EnergyPlus was given the same Bridgewater inputs as NZA Sim. The result: heating NZA 87.7 vs EnergyPlus 107.2 MWh (NZA 18 % lower), and cooling NZA 101.1 vs EnergyPlus 88.3 MWh (NZA 14 % higher). Every earlier big gap (8×, +62 %, +108 %) turned out to be EnergyPlus being fed different inputs.
3. **Most of that remaining gap is a bug in NZA Sim, not its method.** Thermal bridging (24 MWh a year of heat loss on Bridgewater) is shown in the heat-loss breakdown, but it is left out of the calculation that sets the room temperature, so it never reaches heating or cooling demand. Changing the thermal-bridge multiplier from 0 to 6 leaves the anchor's demand at exactly 87.7 / 101.1. With bridging put into that calculation, NZA gives heating 102.7 / cooling 92.4, which is within about 5 % of EnergyPlus on both.
4. **The timestep is not the cause.** NZA Sim run at 10-minute and 5-minute steps gives the same answer as hourly to within 0.2 %. Its building takes days to respond, not minutes, so hourly steps are fine. This also supports an hourly ISO 52016-1 Engine 1.
5. **The Building-page number (State 1) uses a method that really does overstate cooling.** It is the number Brief 103 proposed to gate Engine 1 against. For the same envelope and weather, State 1 gives 98.6 MWh of cooling, while NZA Sim's own hour-by-hour calculation gives 41.9 MWh (bridging fixed). State 1 counts any hour where the sun beats the heat loss as cooling demand. It ignores the 21–24 °C band and ignores the building storing heat. Engine 1 is meant to replace exactly this method, so its numbers should not be the target.

**Verdict.** The main NZA Sim engine (the one that gives 132.6) is not fundamentally wrong. It is mis-set by one missing term, and once that is fixed it agrees with EnergyPlus to about 5 % when both get the same inputs. The State 1 envelope-only method is the weak one. So for Brief 103: validate Engine 1 against EnergyPlus (envelope-only, same inputs), with ISO 52016-1 as the method. Do not use State 1 demand as the gate, and do not use the 56 % figure.

**Confidence.** High on points 1, 4 and 5 and on the bridging bug itself, because I measured them directly on today's engine. Medium on the "within about 5 %" after the fix, because the EnergyPlus side is the July 98-C run, which I could not repeat here. One EnergyPlus run would settle it (see the end of this report).

---

## 1. Every recorded NZA-vs-EnergyPlus comparison

| When | Doc | Same inputs? | Heating (NZA vs EP) | Cooling (NZA vs EP) | Status |
|---|---|---|---|---|---|
| May 2026 | `docs/validation/state1_static_vs_dynamic_post_part3_v1.md` | **No.** GIA 3,457, 0.2 ACH, no bridging or vents, band 21/25, engine `1d6fc79` | 123.6 vs 110.2 | 39.5 vs 61.7 (EP **+56 %**) | Void (pre-98-A). This is the source of the 56 %. |
| Jun 2026 | `docs/audit/81_…box.md` | Box: yes for envelope. But the MVHR is modelled differently: EP uses IdealLoads outdoor air with heat recovery and no bypass | 2.49 vs 3.28 (−24 %) | 1.41 vs 0.68 (+108 %) | Open. Reproduced today: still 2.5 / 1.4. Briefs 82–85 traced it to the free-floating zone and summer ventilation, and ruled out thermal mass. |
| Jul 2026 | `docs/audit/95_cooling_deltas.md` | No (stale config) | 87.7 vs 96.4 | 101.1 vs 130.3 | Void per 98-A |
| Jul 2026 | `docs/audit/98A_valid_comparison.md` | Partly. Gains and ventilation were wrong on the EP side | 87.7 vs 52.9 | 101.1 vs 66.6 | Superseded |
| Jul 2026 | 98-A2 (branch) | Partly. EP people gain was 1 % of NZA's, and 2 of 3 vent systems were missing | 87.7 vs 10.3 | 101.1 vs 163.8 | Superseded |
| **Jul 2026** | **`docs/audit/98R_reconciliation.md` / `98C_after.md` (branch `chris/engine-convergence`)** | **Yes.** People, lights, equipment, DHW, 3 vent systems, 21/24 band, airtightness, bridging (as ψ-adjusted U, 278 W/K) and vents all inherited | **87.7 vs 107.2 (−18 %)** | **101.1 vs 88.3 (+14.5 %)** | **Best current reference** |

The lesson from the history: every large gap so far was a modelling-input mismatch on the EnergyPlus side, not physics.

## 2. Hypothesis (a): timestep

**What I did.** Ran today's engine with State 2 at Δt = 3600/k s on a weather series with each hour repeated k times. I tried both step-held and linearly interpolated temperature, then divided the energy sums by k. Patch: `cooling_gap_scripts/experiment_patch.diff` (the `__SUB` lines). Script: `ts2.mjs`.

| Run (Bridgewater anchor, State 2/3 demand, MWh) | Heating | Cooling |
|---|---|---|
| Hourly (today) | 87.72 | 101.10 |
| 6 steps/h (10 min), step-held weather | 87.73 | 101.12 |
| 6 steps/h, interpolated temperature | 87.68 | 101.01 |
| 12 steps/h (5 min), interpolated temperature | 87.68 | 101.00 |

**Why.** NZA's demand each hour is `(C/Δt + ΣUA)·(T_set − T_free)`. That rearranges to "loss at setpoint − gains + recharge of the stored heat". The storage term cancels out over a run of conditioned hours. The zone time constant C/ΣUA is tens of hours, so Δt/τ is about 0.02. Halving or sixth-ing the step cannot move the annual total.

**Verdict: rejected for NZA's side.** The EnergyPlus side has not been tested (it runs at 4 steps/h in `nza_engine`, `epjson_assembler.py:2096`, and 6 in the box harness). Run A below checks it.

## 3. Hypothesis (b): a flaw in NZA's method, or different inputs

| Candidate | Finding | Evidence |
|---|---|---|
| No thermal mass | **False.** State 2/3 is an hourly implicit-Euler RC model: 2-node walls plus a lumped 250 kJ/K·m² internal mass (1.05 GJ/K on Bridgewater). EP has no internal mass, only the construction layers. Setting NZA's mass to 0 moves cooling +7 % and heating +4 %. That is a real but modest effect. | `instantCalc.js:2613-2685, 3217-3271`; `ts2.mjs` mass 250k→0: heating 87.7→91.4, cooling 101.1→108.1 |
| Monthly or quasi-steady | **False for State 2/3** (8,760 hourly dynamic steps). **True for State 1** (§5). | `instantCalc.js:1571-1650` vs `3633-3735` |
| Solar, internal gains, schedules | Gains are inherited byte-for-byte in 98-C: people 120.4, lights 39.0, equipment 186.1. Solar: EP has an external-shading limitation (Brief 23 H3) and a different window-reporting basis. This is a small residual. | 98R Table A/B |
| Setpoints | Matched in 98-C (flat 21/24; EP's overnight setback removed). Before that it was a real input mismatch. | 98R gap #6 |
| Ventilation and free cooling | Matched in 98-C (3 systems at v40 flows, MVHR as flow×(1−HRE), the same as NZA). Total vent loss NZA 293 vs EP 336 (+15 %), which is the gated-vs-all-hours reporting basis. | 98R Table A |
| Cooling system / COP | Not part of demand. It affects delivered electricity only (EP VRF curves vs NZA flat SEER). | 98R 🔴 #1–2 |
| **Thermal bridging missing from the zone balance** | **Bug.** H_TB (ISO 14683, 278 W/K on Bridgewater) is reported as a 24.0 MWh loss line, but it is not in `C_coef`/`D_coef`, the air-node balance that sets `T_air_free` and so the demand. EP includes it (98-C P5). | Below |

### The bridging bug

`instantCalc.js:3217-3234`: `C_coef` includes walls, roof, floor, glazing, leakage, permanent vents and mech vent, but not `total_H_TB_W_per_K`. Since Brief 69 Part 2, demand comes only from `-C_coef·(T_set − T_air_free)` (`:3705`, `:3720`). The at-setpoint sum that does include `TB_heat_h` (`:3567`) is overwritten. Brief 69 fixed exactly this problem for mechanical ventilation. Bridging was missed.

Proof (`tb.mjs`), changing only `thermal_bridges.multiplier`:

| Multiplier | Bridging loss line (kWh) | State 1 heat / cool | State 2/3 heat / cool |
|---|---|---|---|
| 0 | 8,002 | 116.8 / 102.2 | **87.7 / 101.1** |
| 3 (anchor) | 24,006 | 129.2 / 98.6 | **87.7 / 101.1** |
| 6 | 48,012 | 148.1 / 93.7 | **87.7 / 101.1** |

With H_TB added to the air-node balance (scratch patch `__TBFIX`, `tbfix.mjs`):

| Bridgewater, matched inputs (MWh) | Heating | Cooling | EUI |
|---|---|---|---|
| NZA today | 87.7 | 101.1 | 132.6 |
| NZA with bridging in the balance | **102.7** | **92.4** | 133.2 |
| EnergyPlus 98-C | 107.2 | 88.3 | — |
| Gap today → after fix | −18 % → **−4.2 %** | +14.5 % → **+4.6 %** | |

So about three quarters of the heating gap and two thirds of the cooling gap is this one missing term. The remaining ±5 % sits within the named residuals: internal mass (±7 % on cooling), EP's shading limitation, the glazing/solar reporting basis, the ground model (EP's ground object vs NZA's annual-mean T_out) and EP's sub-hourly surface heat balance. None of those needs to be invoked to explain a large gap any more (CLAUDE.md Rule 10).

The box (2 W/K of bridging) moves only 2.5→2.6 MWh heating with the fix, so the box's +108 % cooling is a separate, smaller-building issue. Briefs 82–85 tied it to the summer MVHR/free-float behaviour (EP's IdealLoads heat recovery with no economiser vs NZA's symmetric (1−HRE)). It stays open but does not affect Bridgewater.

## 4. Are the two models given the same building, weather and schedules?

- **Weather:** same EPW in both (Yeovilton TMYx 2011–2025, sha matches).
- **Bridgewater (98-C):** the same on every demand-side input listed in 98R Table B, with three named exceptions: external shading (EP limitation), infiltration volume basis (small), and bridging represented as ψ-adjusted U in EP vs an extra conductance in NZA. The fact that NZA does not use bridging in its demand at all is the bug above.
- **Thermal mass:** different by construction. NZA has a 250 kJ/K·m² lumped mass; EP has layers only (98R row `thermal_mass_category`). This is worth ±7 % on cooling. Brief 103 should decide which assumption Engine 1 and the EP referee share, and state it in both.
- **The May "56 %" run:** not the same building (see §1).

## 5. The State 1 method (what Brief 103 proposed to gate on)

Same envelope, weather and 21/24 band. No internal gains and no mech vent in either run (`s1s2.mjs`, `s1db.mjs`):

| Method | Heating | Cooling |
|---|---|---|
| State 1 (Building page, quasi-steady hourly) | 129.2 | 98.6 |
| NZA's own dynamic State 2 engine, same envelope | 59.4 | 50.7 |
| …with bridging in the balance | 76.0 | 41.9 |

Where State 1's 98.6 MWh of cooling comes from:
- **81.1 MWh** is booked in hours when the building is losing heat to outside (outdoor below the setpoint), whenever that hour's sun exceeds the heat loss at **21 °C**.
  - 16.3 MWh of that would vanish if the zone were allowed to float up to 24 °C first (the band).
  - Most of the rest would be stored in the structure and used later in a dynamic model.
- **17.5 MWh** comes from hours when it is warmer outside than 24 °C.

The same logic inflates heating: sun in one hour cannot offset heat loss in another. This is a true method limitation, separate from the bridging bug. It supports Part 0's §8 proposal to drop State 1 demand as a gate, but for this reason, not because of the 56 % figure.

## 6. What this means for Brief 103

1. Replace the "+56 %" citation in `00_reconnaissance.md` §8 and STATUS.md with the 98-C figures and this finding.
2. Gate Engine 1 on: (a) conductances and losses at setpoint, term by term, against State 1 (pure algebra, ±1 %); and (b) demand against an **EnergyPlus envelope-only referee on the same inputs** (Run B). Show State 1 demand for information only. The Part 0 proposal stands, with corrected evidence.
3. Separately, and Chris's call because it moves the anchor (132.6 → 133.2): fix the bridging omission in State 2's `C_coef`/`D_coef`. Rule 14 requires the same change in all three engine locations. I did not change any repo code.
4. Decide one internal-mass assumption for Engine 1 and the EP referee (e.g. add `InternalMass` to EP, or take mass from the constructions in both), and write it into the model document.

## 7. EnergyPlus runs that would settle it (for Chris's PC, EP 25.2 or 26.1)

- **Run A (timestep, decisive for hypothesis (a) on the EP side).**
  - Model: the 98-C matched-inputs Bridgewater model (`chris/engine-convergence`, fixture `report_baseline_v1`).
  - Run it three times, changing only `Timestep` (`epjson_assembler.py:2096`): 1, 4 (today) and 10 per hour.
  - Report annual IdealLoads heating and cooling.
  - Prediction: within 3 % of each other. If they differ by more than 10 %, timestep matters on the EP side and I am wrong.
- **Run B (Engine 1's referee, decisive for §5).**
  - Same model and inputs, envelope only: no People, Lights or ElectricEquipment, mech-vent ZoneVentilation removed.
  - Keep infiltration (0.0692 ACH), permanent vents and ψ-adjusted U. IdealLoads at 21/24.
  - Prediction: close to NZA's dynamic 76 / 42 and far from State 1's 129 / 99.
- **Run C (optional, the mass question).**
  - Run B again plus an `InternalMass` object equal to NZA's 250 kJ/K·m² × 4,216 m².
  - This shows how much of the residual is the mass assumption.

## Method and reproduction

Scripts are in `/mnt/project-files/nza-sim/103/cooling_gap_scripts/`. They run against a scratch copy of `frontend/src` with `experiment_patch.diff` applied. All flags are off by default, so the patched copy reproduces 87.7 / 101.1 / 132.6 exactly. Run them with `SRC=<scratch src> node <script>`, with the EPW in `data/weather/current/` and PyYAML in `validation/.venv` (as `_brief93_anchor.mjs --fixture` needs). The box result was reproduced via `validation/nza_sim/load_fixture.mjs`.
