# Brief 105 (the drawn building runs): independent review

- **Reviewed:** nza-hq/nza-sim `chris/105-editor-engine` at `ab77375`, against `main` at `9fda85d` (P0 to P6).
- **Reviewer:** a separate thread, 15 Nov 2026. Read-only for code: this file is the only commit.
- **Method:** read the code in `frontend/src/thermal/engine` (gains.ts, ventilation.ts, network.ts sub-steps and
  TARP, model.ts), `frontend/src/thermal/schema` (2.3 and the upgrade), `frontend/src/sim2/run` (seam, library,
  weather, worker, panel) and `validation/energyplus/105_*.py`; ran the tests; applied two mutations; ran the engine
  myself under the editor's real run options. EnergyPlus numbers are taken from the builder's committed outputs; this
  reviewer did not run EnergyPlus.
- **Not available here:** the anchor EPW (gitignored `data/`). My own runs use the committed Denver weather, as the
  seam tests do.

## Plain-English summary

The connection works and is built honestly. A drawn building with fabric and space types runs on the multi-room
engine and shows heating and cooling for the building and each zone, with a breakdown of where the heat goes. Where
an input is missing, it says what, in plain words, and shows no number.

Nothing has been adjusted to make the engine agree with EnergyPlus. People, lighting, equipment and ventilation each
appear as their own lines in the breakdown, and the engine refuses to give a result if the lines do not add up: I
removed one line on purpose, twice, and both times the engine stopped.

The two decisions not to switch on finer time steps or the new "TARP" convection by default are sound. I re-checked
the time-step one myself with people, lighting and ventilation switched on (the builder checked it without them): the
difference is 0.03 %, so it makes no practical difference.

Three things need fixing or care, none of them blocking:

1. **A back door for guessed values.** A building saved in the previous file format (2.2) and later run is quietly
   given today's typical values (occupancy rate, heat per person, and so on) where it left them out, instead of being
   told what is missing. A current-format file is correctly refused. No such saved buildings exist yet, but this should
   be closed before saving buildings from the editor goes live.
2. **The "within 4 % / 10 %" claim on screen needs one qualifier.** It holds once EnergyPlus is set to use the same
   air density as our engine. On EnergyPlus's default setting the building's heating is 11 % off. The setting change is
   reasonable and written down, but the panel should say "with matched air density" or quote both.
3. **Per-zone figures have no breakdown on screen.** The building has one; individual zones show only their heating
   and cooling. Heat moving between zones (often the biggest term for a zone like a store room next to an office) is
   therefore not visible anywhere in the editor.

## Checks asked for, and verdicts

| Check | Verdict | Evidence |
|---|---|---|
| No tuning to EnergyPlus (Rule 10) | **None found** | §1 |
| Every term in the breakdown (Rule 9) | **Holds in the engine; one display gap** | §2, F3 |
| No fallbacks or invented inputs (Rules 2, 3) | **Holds for 2.3 documents; one route around it** | §3, F1, F4–F6 |
| Sub-hourly steps not a default | **Decision holds; re-measured with gains and ventilation** | §4.1 |
| TARP not a default | **Decision holds; one reason should be restated** | §4.2, F7 |
| Gate (verification 3) | **Passes like for like only; disclosed** | §5, F2 |
| No file of today's engine or the editor thread's touched | **Confirmed** | `git diff --name-only 9fda85d ab77375` names none of `instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `solarCalc.js`, `wallModel.js`, `thermalBridges.js`, `thermalMass.js`, `openingCoefficients.js`, `nza_engine/`, `sim2/geometry/` or `sim2/library/` |
| 103 and 104 numbers unchanged | **Confirmed** | No `expect` line was removed or changed in the 103/104 tests; the changes to `bestest.test.ts` and `multizone.test.ts` move document builders to shared helpers only |
| Tests | **150 pass, 2 skipped** | `npx vitest run src/thermal src/sim2/run` at ab77375. Both skips need the anchor EPW |

## 1. Tuning

- `constants.ts` only gains the TARP constants: Walton's published correlations (9.482, 7.238, 1.810, 1.382) and
  EnergyPlus's 0.1 W/m²K floor. I checked them against the EnergyPlus Engineering Reference form, including the
  stable/unstable choice by face orientation and sign of ΔT, and the second face of a slab using its own tilt
  (`tilt_b_deg`). Nothing is fitted.
- The air heat capacity stays at today's 0.33 Wh/m³K. Part 3 measured that EnergyPlus's 1,210 J/m³K would close the
  heating gap to −0.5 % and did **not** change the engine; the 1,210 value appears only in a diagnostic script.
- `REFEREE_OPTIONS` is unchanged. The radiant fraction 0.3 written by the 2.2 → 2.3 upgrade is today's
  `TUNE_SOLAR_RAD_FRAC` (instantCalc.js ~2606), whose comment states that internal gains use the solar split. The
  constant's name says "TUNE"; it is carried over faithfully, not tuned here, but it is not a measured property of
  people or equipment. Worth recording in the library when space types get real radiant fractions.
- **Referee-side changes:** `std_density` (Density Basis = Standard on every ZoneVentilation and ZoneInfiltration),
  and the per-floor `r2_z_e2like` / `e2tarp` variants that give EnergyPlus Engine 2's simplifications. Each is a
  referee setting named in the run and its results reported alongside the default. This aligns the comparison, not
  the engine (see F2 for what it means for the gate).

## 2. Every term in the breakdown (Rule 9)

- Gains: one line per profile (`occupancy_gains`, `lighting_gains`, `equipment_gains`, `auxiliary_gains`, each with its
  `profile_id`). The solver takes their sum hour by hour (`total_w`) with an hourly convective share.
- Ventilation: one `mechanical_ventilation` line per entry, split from the zone's air term by conductance, as
  infiltration and vents already were.
- **The integrand-vs-display check is real and runs on every run**, not only in tests: `checkClosure` throws if the
  breakdown lines do not sum to zero, and the seam turns that into an error rather than a number. Two mutations:
  - dropping the first gain profile's line: caught (`the breakdown lines sum to −120,409 kWh, not zero`);
  - under-reporting each ventilation line by 10 %: caught in every case.
- The seam's building breakdown leaves out `interzone` (it cancels between zones, checked by the seam test to 1e-6 of
  the gross).
- **F3 (display):** see findings.

## 3. Fallbacks and invented inputs (Rules 2, 3)

- gains.ts and ventilation.ts name every required input by path and refuse; the 9 + 9 refusal cases are tested.
  The panel shows no number when anything is missing.
- Weather: no committed EPW; local file or the organisation's private bucket; the panel always names file and station.
- Constructions: `unassigned:*`, unknown keys and changed bodies are refused, each once.
- Heated-only zones run only when `control_strategy` is stated with one setpoint (suppression by absence, Rule 8).
- **F1** is the one real route around this; F4 to F6 are small inherited defaults.

## 4. The Part 6 decisions

### 4.1 Sub-hourly steps not a default: holds

The builder measured the one-hour step error envelope only. The editor runs with gains and ventilation, which add
hourly on/off steps and a large ventilation conductance, so I re-ran Bridgewater five storeys (Denver weather) on the
seam's `RUN_OPTIONS`:

| | Heating MWh | Cooling MWh | Worst storey | Peak heating, worst storey |
|---|---|---|---|---|
| 1 step an hour (as shipped) | 196.845 | 180.161 | | |
| 12 steps, linear θ_e | 196.787 | 180.212 | heating +0.04 %, cooling −0.03 % | +0.3 % (z5) |
| 1 step against 12, total | **+0.03 %** | **−0.03 %** | | |

Envelope only, the same comparison gives +0.04 % / −0.07 %. 12 steps cost 2.6× the run time. The reason recorded
(Engine 2's own step error is negligible; the EnergyPlus 1-step/4-step swing is EnergyPlus's step, not ours) holds.

### 4.2 TARP not a default: holds, but restate the reason

- **For the editor:** speed rules it out today. The 50-zone document goes from 2.0 s to 50 s (25× over budget). The
  doc does not say so, but five storeys at 1.0–1.2 s is also about 7× over Brief 104's 150 ms five-storey budget.
- **For `REFEREE_OPTIONS`:** the doc's reason is "so Brief 104's gate numbers stand", and speed. Neither is the real
  argument, because a referee run offline has no speed budget. The real reason is that `RUN_OPTIONS` is built from
  `REFEREE_OPTIONS` (seam.ts line 29), so the gate tests exactly what the editor ships. Keeping them equal is right;
  the doc should say that is why (F7).
- Adopting TARP later would choose EnergyPlus's own published correlation, not fit a number. That is acceptable under
  Rule 10, with one caveat already in the doc: on BESTEST 900, TARP moves heating from 2.048 to 1.963 MWh, still
  above the ASHRAE 140 range (1.379–1.814), so TARP alone does not fix BESTEST 900 heating.
- The roof slab gap is attributed to 0.31 MWh (1.3 % of z5 heating) with what was ruled out, which meets
  verification 5.

## 5. The gains-and-ventilation gate

- Like for like (standard density): −3.9 % heating, +9.3 % cooling. Passes, cooling narrowly.
- EnergyPlus defaults: −11.4 % / +10.2 %. Fails on both.
- The attribution is good: the heating gap is wholly the air heat capacity convention (−0.5 % with 1,210 J/m³K in a
  diagnostic run), and the cooling remainder (+6.5 %) is Brief 104's F2 on a larger base.
- Per storey, z1 cooling is +28.7 % (10.14 against 7.88 MWh), within the panel's "up to 31 %".
- The open decision Part 3 flags (outdoor-density mass flow for Engine 3) is genuinely open and should be decided
  before Engine 4, since it moves this building's heating by about 4 %.

## Findings

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| F1 | Medium | **The seam fills today's fallbacks into any 2.2 document.** `simulate` upgrades an older document, and `upgradeDocument` runs `stateTodaysGainInputs` on every profile. Tested: Bridgewater with every gain input removed and `schema_version: '2.2'` runs (207.9 MWh heating, against 196.8 with its own values); the same document as 2.3 is refused ("needs an occupancy rate"). The fill is right for documents converted from today's tool (the Brief 103 pattern), but the seam cannot tell a converted document from an editor one. No editor documents are saved yet, and the editor writes the current version, so nothing is wrong today. | Before saving plans lands: either refuse to upgrade in the seam (ask the person to re-save) or make the upgrade fill only documents whose origin is the converter, and leave the rest null so the engine names them. |
| F2 | Low | **The panel's ⓘ says "heating within 4 %, cooling within 10 %"** without saying that it is against EnergyPlus set to standard air density. On defaults it is −11 % / +10 %. | Add "with the same air density" or quote both. |
| F3 | Low–medium | **No per-zone breakdown is displayed.** The engine has one per zone (including interzone heat), but the panel shows per-zone heating and cooling only. Rule 9 asks that every term entering a displayed demand appears in a displayed breakdown; for a zone, heat from its neighbours is not visible anywhere. | A per-zone breakdown on tap, reading the engine's zone lines. |
| F4 | Low | **A gain profile with no schedule of its own silently uses the occupancy schedule** (gains.ts lines 193–199). A port of today's behaviour, stated in a code comment but not among the "stated differences" in 02_gains.md. | State it in the doc, or make the document say so (e.g. the editor writes the schedule it means). |
| F5 | Low | **Small inherited defaults inside gains.ts:** a schedule exception missing a day's array reads as 0 (`?? 0`, exceptions are unvalidated records); `gain_fraction` outside 0–1 is clamped, not refused; `area_share` and `standby_factor` are not range-checked; daylight hours 9–16 are fixed in code. | Validate exceptions in the schema; refuse out-of-range values. |
| F6 | Low | **An unpinned construction runs on whatever the library holds.** The body-hash check applies only where `library_refs` pins the key. | Require a pin for every construction the document uses, or report the unpinned ones. |
| F7 | Note | 06_per_floor.md gives speed and "Brief 104's gate numbers stand" as the reasons TARP does not join `REFEREE_OPTIONS`. | Record the coupling to `RUN_OPTIONS` as the reason, and the five-storey speed miss. |
| F8 | Note | With sub-steps, an hour's closure is the absolute value of the mean of the steps' signed residuals, so residuals of opposite sign within an hour could cancel. Off by default; the tests pass. | Take the maximum per step if sub-steps are ever used for a gate. |
| F9 | Note | Ventilation uses a fixed 0.33 Wh/m³K and a summer bypass is refused rather than modelled. Both stated. MVHR therefore recovers heat all year, which raises cooling in mild hours for any building that would have a bypass. | Expect refusals from library MVHR templates with `summer_bypass: true` until it is modelled. |

None of these blocks the close. F1 should be done before the editor can save and reload buildings.

## Addendum: `3713087` (pushed during the review)

`105 P5: draft library constructions run, named in the panel` adds one drafted internal wall
(`interior_wall_block_plastered`, in `docs/audit/102/library_additions.json`) to the seam's library, built only from
layers already in Chris's library (the floor's plaster, the cavity wall's block). A run that uses it says so under the
breakdown ("Uses a draft construction, awaiting Chris"). This is a library item with its provenance and a visible
label, not a default inside the engine, so it is consistent with Rules 2 and 3. Nothing above changes.
