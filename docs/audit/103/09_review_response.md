# Brief 103: response to the independent review

The review is [`08_independent_review.md`](08_independent_review.md). It found no tuning, and it confirmed that the
closure check is real. Each finding below says what changed in commit `103 P6c`, or what is now recorded as open.

| # | Finding | Response |
|---|---|---|
| 1 | Cooling-miss attribution is bracketing, not attribution | **Recorded as open.** The interior slabs are "consistent with" the Bridgewater miss, not proven its cause. BESTEST 900's one-zone residual has the same sign: +0.10 MWh heating and +0.39 MWh cooling against EnergyPlus with the same simplifications. It is a named open item for 104. Candidates: inside long-wave (star network against view factors), the fixed 11 K sky against the EPW's infrared, and the 1 h implicit step against EnergyPlus's 15 min. The review ruled out node count (converged at 0.005 m). |
| 2 | Closure never fails loudly; the Rule 9 sum is not asserted | **Fixed.** `runZoneModel` now refuses a result through `checkClosure`. It throws if any hour misses by more than 1 Wh, or if the breakdown lines, demand included, do not sum to zero. The tolerance is 1e-9 of the gross plus 1 Wh. `closure.test.ts` shows a dropped line is refused, the review's "breakdown drops the sky lines" mutation. BESTEST asserts the sum too. |
| 3 | The inside-convection choice is lopsided | **Recorded as open.** See the next section. |
| 4 | y-factor on glazing only; risk of double bridging | **Fixed by refusal.** Engine 1 applies no y-factor, and a library construction with a y-factor other than 1 is refused, naming the surface and the library item. Part 4 applied it to glazing only. Bridging comes from `building.thermal_bridging` alone, so it cannot count twice. Today's State 1 applies y-factors to every element. How the document should carry them is a question for 104. Bridgewater's are null, so its numbers are unchanged. |
| 5 | BESTEST and anchor gates skip silently | **Fixed.** The Denver `.mos` is committed in `validation/fixtures/weather/` (BSD-3 via LBNL Modelica Buildings; NREL TMY3), so BESTEST always runs. The anchor EPW stays in gitignored `data/`. Its block now prints `SKIPPED` when the file is absent, and `NZA_REQUIRE_REFERENCE_DATA=1` turns that into a failure. Peaks are added to `07_bestest_referee.md`. |
| 6 | −0.5 % heating is net of offsetting differences | **Recorded.** Added to the gate (b) note in `06_anchor_envelope.md`. |
| 7 | Shared assumptions are outside gate (b) | **Recorded.** These inputs are unvalidated by gate (b): the ground model (annual mean outdoor, no ISO 13370; worth 3.7 MWh), unscaled EPW wind (5.0 MWh), the frame fraction and the absorptance. |
| 8 | Defaults inside the engine | **Fixed for the bridging multiplier.** The engine now requires it in `iso14683_auto` mode. The converter and the 2.0 upgrade write today's 1 (`TODAY.bridging_multiplier`, from `thermalBridges.js` 182). The `initial_c` fallback is left as it is; it is harmless after the warm-up. The one-zone beam is noted under finding 1. |
| 9 | Leap years | Noted. The effect is negligible, and the weather parser refuses nothing here. Left for 104. |

## Inside convection (finding 3), as it stands

Neither ISO form is EnergyPlus's TARP:

- **By tilt**, the default: a sunlit floor gets 0.7 W/m²K, well below TARP.
- **By heat flow** (Table 25): it gets 5.0, well above TARP.

`REFEREE_OPTIONS` keeps by tilt because it is the ISO 52016-1 default and the option-free behaviour. Matching
EnergyPlus is not the reason. Beside the gate result:

| Bridgewater, MWh | Heating | Cooling |
|---|---|---|
| Referee | 90.46 | 13.65 |
| Beam on floor (gate, as run) | 89.98 | 15.32 |
| Beam on floor and heat flow | 89.45 | 16.33 |

The settling candidate for 104 is a natural-convection correlation of TARP's form, an option that follows the
temperature difference. The beam on the floor stays as it is: both referees put it there.
