# Brief 108 — independent review (emitters cap each room's heating)

Reviewed 15 Nov 2026 by a separate thread, read-only on the code. The review covers `chris/108-emitters` from `0cabd02` (P1) and `43fb5f0` (P2) to `cbedbd9` (P5).

**Files read:**
- the brief, and `docs/audit/108/00` to `05` (with `03_referee.json`, `04_sizing.json`);
- `engine/emitters.ts`, the 108 changes to `engine/network.ts`, `zone.ts`, `model.ts`, `results.ts`, and `schema/model.ts`;
- `sim2/run/seam.ts` (`emitterSummary`, the what-if), `EmitterSizing.tsx`, `client.ts`, `worker.ts`;
- `validation/energyplus/108_capped_referee.py`, `108_bridgewater_capped.py`, `108_capped_spec.json`, `scripts/108_referee.mts`;
- the tests `emitters.test.ts`, `sizing.test.ts`, `seam.test.ts`, `emitterSizing.test.tsx`.

**What I ran:**
- `vitest run src/thermal src/sim2`: 210 pass, 2 skip (the anchor EPW is not in this container).
- Six mutations of `network.ts` and `zone.ts` (below). Each was restored.
- One probe file (radiant share's effect on demand, held zones' control temperature beside a capped zone). Deleted afterwards.
- The EN 442 arithmetic in `04_sizing.md` by hand, and every row of `03_referee.md` against `03_referee.json`.

No code was changed. The working tree was clean afterwards.

## Verdicts

| Check | Verdict |
|---|---|
| **No tuning (Rule 10)** | **Confirmed.** No engine constant changed in P2 to P5. The gate tolerances (±10 %, ±20 % or ±50 h, ±1 K) are the brief's, unchanged. The caps in `108_capped_spec.json` are round fractions of Engine 2's uncapped peaks (56 %, 77 %, 54 %). Git cannot show they were chosen before the comparison (spec and results share commit `b464928`), but nothing in them looks fitted. No exotic mechanism is used to explain a gap. |
| **Rule 8: the sizing run (`emitter_limit: 'none'`)** | **Acceptable. It is removal, not muting.** `capOf` returns `null`, so `heating_cap_w` is absent and the engine takes the same `Infinity` path as a zone that states no emitters. No wide number is set and no object is left in. Keeping the radiant share is right: the peak is what *these* emitters would have to give, delivered the way they deliver it. It is labelled a sizing run. One small gap: an unknown value (e.g. `'off'`) is silently treated as `'cap'` (F8). |
| **Rule 9: closure under the cap** | **Holds, and it is a real integrand check.** Each hour's closure sums every physical term plus the injected φ and compares it with stored heat from node temperatures. The final full solve takes ventilation at `xa` from the reduced solve, so a wrong reduced solve breaks closure (M2 and M6 were caught that way). The heating line is the capped φ itself. **But** closure cannot see a wrong *control* row: a held zone's operative temperature can be off its setpoint while every hour still closes (M1, F5). |
| **Engine 2 mode-2 active set** | **Correct on reading, and tested on the main paths.** The three solver paths (admittance, dense air control, operative) each add the capped zone's known heat at the right responses (`EW`/`RW` for heating, `EWc`/`RWc` for cooling). Transitions are 1→2 when φ > cap, and 2→1 when the zone would rise above its setpoint at the cap. A zone cannot sit at mode 2 above its setpoint. The pass guard rose from 2Z+2 to 3Z+3 and still throws. Analytic tests (c) and (d) pin the air-control path to 1e-7 K. The operative path and the "emitters plus cooling" case are only checked qualitatively (F5). |
| **EN 442 maths (`emitters.ts`)** | **Correct.** Q = Q_rated × (ΔT_lm / ΔT_lm,rated)^n, with the log mean, a fallback to the plain difference when flow = return, and a refusal when the return is at or below the room. Checked by hand: 75/65/20 is 49.83 K; 70/60/21 is 43.8 K; 50/40/21 is 23.65 K; factor 50/40 against 70/60 is 0.449; Storey 1 needs 23.2 ÷ 0.379 = 61.2 kW (doc: 61.0, rounding of the peak). `needed_rated_w` = (peak − fixed) ÷ factor is right. The method choice (log mean, not catalogues' arithmetic ΔT) moves results by 1.5 to 3 % at heat pump temperatures; it is stated in `00`. **The design-room simplification is not "a little" at low flow temperatures (F1).** |
| **EnergyPlus referee (`03_referee.md`)** | **Sound for what it covers.** `LimitCapacity` with `Maximum Sensible Heating Capacity` is EnergyPlus's convention, and EnergyPlus's peak equals the cap to 0.06 W. Unmet hours use the same 0.5 K on both sides (EnergyPlus's own Not Met Time agrees within 3 h). Every row of the md matches the JSON. **Not covered:** the radiant share, which moves annual heating by 5 to 13 % (F2), and the peaks the sizing depends on (F4). |
| **What-if and refusals (`seam.ts`)** | **Work as described.** A copy of the document, only `design_flow_c`/`design_return_c` changed on heating groups that state them; the main results still show when the what-if cannot run; refusals come back in words. Setbacks and setpoint hours are refused before the run (before 108 they were silently ignored, so this is an improvement). **But** the energy comparison it shows is easy to misread (F3), and every heating system is moved to the one pair (F6). |
| **Schema and refusals (Rules 2/3)** | **Confirmed.** Nothing is defaulted. A wet emitter must name an enabled heating group that serves its zone; a fixed-output unit names none; missing ratings, design temperatures or a heating setpoint are refused by path. The 2.3 → 2.4 upgrade adds empty lists only. |
| **Today's engine untouched** | **Confirmed.** No file under `utils/` or `nza_engine/` changes in 108. |
| **Stated limits** | SCOP does not vary with flow temperature (stated in `04` and the ⓘ); setbacks refused until Brief 109; editor forms pending. All three are honestly stated. |

## Findings

| # | Severity | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| F1 | **Medium** | **At heat pump temperatures, the cap understates what the radiators give when the room is cold, so unmet hours and lowest temperatures are pessimistic.** The cap is rated with the room at its setpoint all year (decision 2), which `00` calls "slightly" understating. At 50/40 the log-mean ΔT is small, so a cooler room raises it a lot. This is the exact case Linzie wants to judge. EnergyPlus's `LimitCapacity` has the same simplification, so the referee cannot catch it. | Bridgewater at 50/40 (`04_sizing.md`): Storey 5 floats to 17.3 °C. The log mean there is 27.4 K against 23.65 K at 21 °C, so the same radiators give (27.4/23.65)^1.3 = **+21 %**. Storey 1 at 18.0 °C: **+17 %**. At 70/60 the same 3 K drop gives only about +9 %. So the 2,845 unmet storey-hours at 50/40 are overstated, by an amount not yet measured. | Either rate the cap each hour at the zone's control temperature from the hour before (a fixed-point the active set already supports, as cap_w becomes cap_w(θ)), or keep the design rating and say on the panel: "at these temperatures the real shortfall is smaller in the coldest hours". The *needed rating* (sized at the setpoint) is right either way. |
| F2 | **Medium** | **The radiant share changes annual heating by 5 to 13 % and has no referee.** Stating radiators at 30 % radiant raises heating even when the cap is never reached (under air control, heat put into walls drives more fabric loss). This is a new physics path in both engines, tested only for closure and "colder when capped". `03` says ideal loads cannot give radiant heat, which is true, but EnergyPlus has `ZoneHVAC:Baseboard:RadiantConvective:Electric` (capacity plus fraction radiant), which could referee both the cap and the radiant share at once. | Probe, cooled-room west, uncapped, air control: radiant 0 / 0.3 / 0.6 gives 1,861 / 1,969 / 2,097 kWh in Engine 2 (+5.8 %, +12.7 %) and 1,801 / 1,894 / 2,003 kWh in Engine 1. Mutation M4 (Engine 1 heating split ignored, so the radiant share is lost): **every test passed**, though the result moved 0.8 %. | Add a referee case with `ZoneHVAC:Baseboard:RadiantConvective:Electric` at 30 % radiant, capped and uncapped, on the cooled room, and add an Engine 1 test that pins the radiant split (an analytic one-zone steady state works). Until then, say in the ⓘ that the radiant share moves demand and is not yet checked against EnergyPlus. |
| F3 | **Medium** | **The what-if's "Energy used" row shows less energy at the lower flow temperature, with no reason beside it.** At 50/40 energy falls because the rooms are colder, not because anything is more efficient. The only caveat is behind the ⓘ and says something different (SCOP does not vary). A reader comparing a boiler at 70/60 with a heat pump at 50/40 would read it as a saving. | `05_panel_whatif.png`: 555.0 against 556.8 MWh energy, 111.8 against 116.7 MWh heating, beside 2,845 unmet storey-hours. `04_sizing.md` says it correctly ("lower only because less heat is delivered"), but the panel does not. Also, the system is unchanged: the what-if runs the same boiler at 50/40, not a heat pump. | Put a line under the building table whenever a pair has unmet hours: "Less heat is delivered at X/Y because rooms run colder; this is not a saving." Consider hiding "Energy used" for a pair with unmet hours, and say in the form that only temperatures change, not the system. |
| F4 | Low–Medium | **The sizing rests on the peak, and the peak is neither gated against EnergyPlus nor a design condition.** (a) The gate covers annual heating, unmet hours and lowest temperature, but the "needed rating" is driven by the peak. The JSON has it: Engine 2's peaks are +2.1 to +5.9 % against EnergyPlus on Bridgewater and −3.2 % on the cooled room. (b) The peak is the weather file's coldest hour of a typical year, not a design outdoor temperature (UK radiator sizing uses BS EN 12831's). A typical year is usually milder than design, so "enough" can mean undersized in a cold snap. | `03_referee.json`, `peak_w` in every row. The ⓘ says "highest hourly heat with its emitters unlimited" and does not name the weather. | Print the peak against EnergyPlus in the gate (no new tolerance unless agreed). In the ⓘ, say the peak is for the chosen weather file, not a design-day calculation. |
| F5 | Low | **Three solver branches are untested in a way that would fail.** M1 (drop the capped zone's radiant heat from a held zone's operative-control row), M4 (above) and M5 (cooling-held zone's operative response taken from heating's split) all survive. M1's effect in the test geometry is tiny (2e-5 K), because the two capped rooms only touch through the middle room. M5 needs a zone with both emitters and cooling, which no test has. | Mutation table below. | One operative-control test with two adjacent zones, one capped and one held, that checks the held zone's operative temperature equals its setpoint to 1e-6 K. One test with a zone that has emitters and a cooling setpoint. |
| F6 | Low | **The what-if moves every heating system to the one pair.** A building with a boiler at 70/60 for radiators and underfloor at 45/35 gets both set to, say, 50/40, so the underfloor gets hotter. The building table header uses the first zone's pair only. | `seam.ts`, `for (const g of w.system_groups) if (g.service === 'heating' && g.design_flow_c != null)`; `EmitterSizing.tsx` `firstPair`. | Let the what-if name the system it changes (default: all, stated), and label the header per system when they differ. |
| F7 | Low | **A zone can be capped by only some of the systems that heat it.** If a zone is served by a wet group with listed radiators and also by an electric group with no listed heaters, the whole zone is capped at the radiators' output, with no message. | `zoneEmitters` sums only listed emitters; the schema check covers emitter→group, not group→emitters. | When a zone states emitters, refuse (by name) any heating group serving it that has none there, or note it in the panel. |
| F8 | Low | **`emitter_limit` is not checked.** Any value other than `'none'` means "cap". `internal_gains` refuses unknown values; this should too (CLAUDE.md lesson 11 on silently ignored mode parameters). | `model.ts:399`. | Refuse anything other than `'cap'`, `'none'` or absent. |
| F9 | Low | **Rule 11: the lowest temperature is exposed twice.** Under air control `annual.min_control_c` equals `annual.theta_air_c.min`. They are the same quantity at two paths. | `model.ts`, `results.ts`. | Keep `min_control_c` only for operative control, or document `theta_air_c.min` as the canonical one under air control and read it through one helper. |
| F10 | Low | **Cost of a run with emitters.** Every edit now runs the building twice, four times with a what-if. The second unlimited run at the what-if temperatures gives the same peak (the limit is off and only design temperatures changed), except where fixed and wet emitters are mixed and the radiant weighting moves slightly. Radiant shares above 0 also turn off Engine 2's fast admittance path. | `seam.ts` `sized()`; `network.ts` `admittance` now needs every heating split all-convective. | Reuse the base unlimited run for the what-if when no zone mixes fixed and wet emitters. Re-measure the 50-zone < 2 s target with emitters on IT15. |
| F11 | Info | The setback refusal reads "a heating setback is not modelled yet (Brief 109)", which names a brief number to the user. | `model.ts` | Plain words: "Setbacks (a lower night setpoint) are not modelled yet." |

## Mutations

| # | Mutation | Result |
|---|---|---|
| M1 | Operative path: drop the capped zones' radiant term from held zones' control rows | **Survived** (all 210 pass) |
| M2 | Dense air path: drop the capped zone's known heat from the right-hand side | Caught (2 fail, by closure) |
| M3 | A capped zone never returns to heating at its setpoint | Caught (6 fail) |
| M4 | Engine 1: heating uses cooling's (all-convective) split, ignoring the radiant share | **Survived** |
| M5 | `control()` uses heating's response for a cooling-held zone | **Survived** (no test has emitters plus cooling) |
| M6 | Air-control path: drop the capped zone's known heat | Caught (4 fail) |

## Arithmetic checked

- `03_referee.md` against `03_referee.json`: every heating, unmet and lowest-temperature figure matches. East tight is −50 h exactly, −9.8 %, so it passes on the percentage.
- `04_sizing.md`: rated now 23.2 ÷ (43.8/49.83)^1.3 = 27.4 kW; output at 50/40 = 23.2 × 0.449 = 10.4 kW; needed = 23.2 ÷ 0.379 = 61.2 kW (61.0 in the doc, from the unrounded peak).

## Before Part 6 closes

1. F1 and F3 are the ones that matter for Linzie's boiler-to-heat-pump question. F3 is a wording change. F1 is either a model change (re-rate each hour) or a plain caveat on the panel. Her call which.
2. F2: add the radiant baseboard referee, or say plainly that the radiant share is unrefereed.
3. F5 and F8: small tests and one refusal.
4. The rest can be logged in STATUS as known issues.

## In plain English (for Linzie)

The radiator cap works. If a room has 1 kW of radiators, the model never gives it more than 1 kW, the room runs colder when it needs more, and the hours it is too cold are counted. EnergyPlus does the same thing and agrees within a few percent. The radiator sums for lower water temperatures are right, and nobody has nudged numbers to make things match.

Three things to fix or explain before you rely on it for heat pump advice:

1. **It is a little too gloomy about heat pumps.** When a room cools down, real radiators give out more heat, about a fifth more at heat pump temperatures. The model holds the output fixed, so it shows more cold hours than there would really be. The "how big should the new radiators be" figure is still right.
2. **The energy comparison can mislead.** At heat pump temperatures it shows slightly *less* energy used. That is only because the rooms are colder, not a saving. The screen needs to say so.
3. **One setting is unchecked.** How much heat a radiator gives as warmth to the walls (versus warming the air) changes the heating bill by 5 to 13 %. EnergyPlus can check it, and that check should be added.
