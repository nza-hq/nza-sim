# Brief 104 (Engine 2, multi-zone): independent review

- **Reviewed:** nza-hq/nza-sim `chris/104-engine-2`, range `139777c..ab1794f` (nine commits, P0 to P6).
- **Reviewer:** a separate thread, 15 Nov 2026. It worked read-only and made no commits to the branch.
- **Method:** the reviewer read the code, ran the tests, applied mutations to a local copy, and re-ran the engine at P5 and P6 to compare them. The builder's audit documents were used for the EnergyPlus numbers only. The reviewer could not run EnergyPlus.
- **Not available here:** the anchor EPW (Yeovilton, gitignored `data/`). Every independent engine run below uses the committed Denver weather (`validation/fixtures/weather/…Denver…mos`).

## Plain-English summary

The multi-room engine does what it says. Heat moving from one room to another is counted once, as a loss from one room and a gain to the next. Every room's energy balance closes every hour. The speed work in Part 6 did not change any result.

No setting in the engine has been adjusted to match EnergyPlus.

Two points need care when the results are described:

1. **The comparison model was changed three times before the gate passed.** The engine passes the ±10 % gate on the Bridgewater totals. It passes only against a version of the EnergyPlus comparison model that was changed three times to describe the building as the engine's document does:
   - One change fixes a real fault in today's EnergyPlus model builder: the floor slabs were built upside down on one side.
   - The other two make EnergyPlus split thermal bridging and air leakage between storeys the way the engine does.

   Each change is reasonable and written down. Against the comparison model as it was first built, cooling is 12 to 16 % high, which fails the gate. So the gate shows that the solver is right. It does not show that the engine's way of splitting leakage and bridging between storeys is right.
2. **Per-room numbers are less reliable than the building total.** Against full EnergyPlus, individual storeys' cooling is off by up to about 30 %, in both directions. The errors partly cancel in the total. When EnergyPlus is given the engine's simpler surface physics, every storey comes within 5 %. That points to the known open item, the surface-physics simplifications carried over from Brief 103, rather than to a bug in the multi-room part.

The five-storey speed budget (150 ms) is still open, as already known.

## Checks asked for, and verdicts

| Check | Verdict | Evidence |
|---|---|---|
| Tuning to EnergyPlus (Rule 10) | **None found** | See section 1. |
| Interzone heat cancels; closure per zone per hour | **Holds, and the check is real** | See section 2. Four mutations were applied and all four were caught. |
| Five-zone gate (P5) is honest | **Honest, but narrower than it reads** | See section 3, findings F1 and F2. |
| Cooled-room twin (P4) is honest | **Honest** | See section 4. One small gap (F5). |
| P6 speed changes left results unchanged | **Confirmed** | See section 5. One zone is bit-identical. Multi-zone results differ by at most 3 × 10⁻¹³ relative. |
| No file of today's engine touched | **Confirmed** | `git diff --name-only 139777c ab1794f` names none of `instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `solarCalc.js`, `wallModel.js`, `thermalBridges.js`, `thermalMass.js`, `openingCoefficients.js` or `nza_engine/`. Every change is under `frontend/src/thermal/`, `scripts/104_*`, `validation/energyplus/104_*`, `docs/` and `STATUS.md`. |
| Tests | **98 pass, 2 skipped** | `npx vitest run src/thermal` at ab1794f. Both skips need the anchor EPW (F4). |

## 1. Tuning

- `constants.ts` is not changed in the range.
- The window optics (`glazing.ts`) are the published Simple Window Model (LBNL-2804E, EnergyPlus Engineering Reference). The coefficients are EnergyPlus's own, including its quirk `BDCD = (B + D + C + D)/4`. Nothing is fitted.
- The inside solar absorptance of 0.7 is EnergyPlus's default material value, which today's EnergyPlus path uses. The schema says so (`schema/model.ts:203`). Part 1b swept it at 0.5, 0.7 and 0.99 in both engines, and agreement holds across the range.
- The one-zone path on `REFEREE_OPTIONS` moved in P1b (BESTEST 600: 4.547/5.628 → 4.574/5.510; 900: 2.186/2.755 → 2.048/2.424). The brief's Part 1b authorises this, and the numbers are re-recorded with their reason. It is not the "103 number changes" escalation: the default options and the one-zone solver are unchanged.
- **BESTEST gives an independent check of P1b.** The reviewer ran the 103 tip and P6 side by side. Measures inside the ASHRAE 140 range went from 3 of 8 to 5 of 8:

  | Case and measure | 103 tip | P6 |
  |---|---|---|
  | 600 cooling | in range | in range |
  | 600 peak cooling | below range | in range |
  | 900 cooling | above range | in range |
  | Heating, both cases | above range | above range |

  BESTEST does not share the referee's model, so this improvement is not by construction.
- **Caveat (finding F6).** Engine and referee now share the window model, so the agreement on transmitted solar (110.43 against 110.44 MWh) holds by construction. It is not evidence for the window model itself; BESTEST above is.

## 2. Interzone heat and closure (`network.ts`)

The reviewer read the design and confirmed it:

- A two-faced element is split at its middle link. Chain nodes `0..ℓ` count in zone_b's storage and the rest in zone_a's (`CZ`, line 373).
- The heat across that link is added to zone_a and taken from zone_b (lines 624–631). Cancellation per element is therefore exact.
- Internal mass, where zone_a equals zone_b, gives no interzone line.
- The star node for long-wave is an exact rewrite of ISO 52016-1 eq. 30. It has no capacity, so it does not disturb storage.

**Mutations.** Each was applied to a local copy and run against `network.test.ts` and `multizone.test.ts`, then reverted:

| Mutation | Caught? |
|---|---|
| Zone_b's interzone share halved | Yes, 4 tests fail |
| A slab's middle node counted in the wrong zone's storage | Yes, 2 tests fail |
| The interzone line dropped from the breakdown (Rule 9) | Yes, 1 test fails (`checkClosure`) |
| Interzone heat scaled by 1.01 | Yes, 3 tests fail |

**Independent run.** Per-storey Bridgewater on Denver weather:

- largest hourly closure miss: 1.5 × 10⁻⁹ Wh per zone;
- building interzone sum: exactly 0;
- 50-room grid: closure 3 × 10⁻¹⁰ Wh, interzone sum 1 × 10⁻¹² kWh.

## 3. Five-zone gate (P5)

The P5 tables and the referee JSON were checked against each other. The figures are quoted correctly.

### F1 (medium). The pass depends on aligning the referee to Engine 2's allocation choices

Engine 2 is 91.21 MWh heating and 14.89 MWh cooling. Against each referee:

| Referee | What it is | Heating | Cooling | Gate (±10 %) |
|---|---|---|---|---|
| r1 | as Part 1 built it | 89.35 (+2.1 %) | 12.88 (**+15.6 %**) | fails |
| r2 | slab fixed only | 89.82 (+1.5 %) | 13.26 (**+12.3 %**) | fails |
| r2_z | slab fixed, plus Engine 2's split of bridging and infiltration by storey | 90.18 (+1.1 %) | 13.81 (+7.9 %) | passes |

- **The slab fix is a genuine referee bug.** Today's assembler gives both faces the same carpet-first construction, and EnergyPlus warns about it. Engine 2's document has the carpet facing up (`fromBuildingConfig.ts`, `perStorey`).
- **The two allocation changes copy Engine 2's choices into EnergyPlus:**
  - infiltration: q50 × each zone's own envelope area;
  - bridging: junctions to the zone they belong to.

  Both keep the building totals the same and both are physically argued. The gate therefore tests the solver given those choices. It does not test the choices themselves.
- **The brief's decision 4 was wrong about the referee.** It said the referee "allocates infiltration by envelope area… Part 0 confirms this". Part 0 correctly found the opposite: the referee uses the same rate in every zone (`00_reconnaissance.md:22`).
- **Recommendation.** The close report should say plainly:
  - the gate is against r2_z, not the brief's r0;
  - why the referee was changed;
  - that cooling is +12 % against r2.

  Correct the brief's decision 4 text. Whether per-envelope or equal-rate infiltration is the better product default is a design choice for the design note, not something this gate decides.

### F2 (medium). Per-zone agreement against the full referee is weak

Engine 2 against r2_z, per storey:

| Storey | Cooling | Heat in through slabs (MWh) |
|---|---|---|
| z1, ground | 1.43 against 1.09 (+31 %) | |
| z2 | 3.69 against 3.05 (+21 %) | |
| z5, roof | 1.77 against 2.25 (−21 %) | 0.77 against 3.44 |

- The building total passes partly because these errors offset.
- Against `r2_z_e2like` (EnergyPlus with Engine 2's convection, sky and long-wave), every storey is within 5 % on heating and cooling. The reviewer checked all ten figures. This locates most of the per-zone miss in the open surface-physics item from Brief 103.
- **Even with the same simplifications, the heat through the roof storey's floor is 0.77 against 1.28 MWh (−40 %).** The slab crossings in z2 to z4 are within about 10 %.
- The brief gates totals only, so this is compliant. But per-room results are the purpose of Engine 2.
- **Recommendation:** carry the z5 slab-crossing gap into Brief 105 as an open item with its magnitude. Nothing should present per-room demand as validated to ±10 % yet.

### F3 (medium, Rule 13). The 1-hour time step is unmeasured on the engine side

- The `_e2like` referees run EnergyPlus at 4 steps an hour. At 1 step, EnergyPlus's five-zone cooling falls from 14.42 to 13.09 MWh (−9 %). Against that run, Engine 2 would be +13.8 %.
- The builder's reason for using 4 steps is stated, and it was stated in Part 1 before it mattered: a 1-step run measures EnergyPlus's own scheme. That reason holds.
- What is missing is the engine's own step error. Engine 2 is 1 h implicit Euler (`DT = 3600`, `network.ts:115`).
- **Recommendation:** an engine-only test at 15-minute steps with interpolated weather. It needs no referee, and it would show how much of the remaining +3 % cooling (and the BESTEST heating excess) is the step.

## 4. Cooled-room twin (P4 e)

The twin is honest:

- Both models read one spec file (`104_cooled_room_spec.json`), and EnergyPlus's results are committed.
- The test builds Engine 2's document from the spec and computes it live (`multizone.test.ts:182–260`).
- The gate is against EnergyPlus with ISO convection, which is labelled as such. EnergyPlus's own run is reported alongside: the heated rooms are +9.9 % and +10.4 %. The 14 % swing in EnergyPlus from convection alone is measured.
- The infiltration conversion from 0.5 to 0.414 ach is stated: the same mass flow at Denver's air density.

**F5 (low).** The test checks that `spec_sha256` exists in the EnergyPlus JSON, but not that it matches the spec file. An edited spec would leave the committed EnergyPlus results stale, and the test would still pass. Compare the hash.

The internal-mass finding is a correct correction of the brief, recorded with its size and not forced to zero. A brief assumption ("no steady-state change") turned out wrong: mass faces join the long-wave exchange, and steady heating rises 2.7 %.

## 5. P6: results unchanged

The reviewer ran the engines at P5 (`f781af1`) and P6 (`ab1794f`) on the same documents with Denver weather. The cases were one zone, five storeys and the 50-room grid, under `REFEREE_OPTIONS`; one zone and five storeys were also run under operative control with half-radiant loads.

| Case | Largest relative difference, P5 to P6 |
|---|---|
| One zone | 0, bit-identical |
| Five storeys, air control | ≤ 1.1 × 10⁻¹³ |
| Five storeys, operative control | ≤ 1.0 × 10⁻¹³ |
| 50 rooms | ≤ 2.7 × 10⁻¹³ |

- The P6 claim holds. The non-admittance (operative) path was covered as well as the referee's admittance path.
- The active-set pass counts change, as P6 records. That is expected from warm-starting and has no effect on results.

**Speed (known open).** The five-storey budget was missed in the container, at 167–219 ms against 150 ms. The reviewer did not re-time it. The IT15 measurement is pending.

## 6. Other observations

**F4 (low).** Two tests skip on a fresh checkout because they need the anchor EPW:

- the per-storey Bridgewater check: closure per zone, slabs cancel, junction lengths sum (`network.test.ts:155`);
- the anchor EPW gate.

None of the five-zone numbers is asserted in CI. This is the same pattern as Brief 103's review finding 5. **Suggestion:** run the per-storey check on the committed Denver weather as well, so closure and cancellation on the real document always run. The reviewer's Denver run above shows it works.

**Rule 11.** Building totals have one read path: `readBuildingHeatingKwh` / `readBuildingCoolingKwh` sum the zones. `ModelResults` stores no second total.

**Scope.** All of P1b's widening (Perez sky, inside absorptance, no solar to the air) is published method or a stated document input, and it is recorded. There are no UI, systems or gains changes. Other gains are refused on the multi-zone path.

## Findings to carry

| # | Severity | Finding | Suggested owner |
|---|---|---|---|
| F1 | medium | The gate passes only against a referee aligned to Engine 2's per-storey infiltration and bridging allocation; +12 % cooling against r2. Correct the brief's decision 4 text. | P7 close report, design note A.7 |
| F2 | medium | Per-storey cooling up to ±31 % against the full referee. Roof-storey slab heat 0.77 against 3.44 MWh (against 1.28 with the same simplifications). | Brief 105 open item |
| F3 | medium | Engine 2's own 1 h step error is unmeasured; EnergyPlus moves 9 % between 4 steps and 1. | Engine-only sub-hourly test |
| F4 | low | The per-storey Bridgewater test skips without the anchor EPW; run it on Denver too. | P7 or 105 |
| F5 | low | The cooled-room test does not compare the spec hash. | P7 |
| F6 | info | The window model is shared with the referee, so transmitted-solar agreement is by construction. BESTEST is the independent check, and it improved. | Note in design note |
| — | open (known) | Five-storey speed budget. | IT15 measurement |
