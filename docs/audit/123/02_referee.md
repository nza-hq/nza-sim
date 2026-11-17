# Brief 123 P5 — the unheated loft and the warm mono-pitch against EnergyPlus

**Result: 10 of the 11 gates pass on the first run, and one misses.** Nothing was tuned.

- **The miss:** the loft's own effect on summer cooling. The engine's loft takes 94 kWh off the room's cooling, and EnergyPlus's takes 65 kWh. The gate is ±15 %, so this misses by +46 %. In energy it is 29 kWh, which is 1.8 % of the room's cooling.
- **The rest:**
  - Annual heating and cooling are within 2.2 % on every case.
  - The heat through the ceiling to the loft is within 0.6 %.
  - The loft's air is within 0.02 K on the annual mean, with an hourly RMSE of 0.51 K.
  - The monthly estimate is within 2.3 % of the 15-minute run.

**Inputs.**
- The spec, `validation/energyplus/123_roof_spec.json`, was committed before any run (758f7e6).
- EnergyPlus 25.2.0 was run by `validation/energyplus/123_roof_referee.py`, which wrote `02_energyplus.json`.
- Our engine was run by `frontend/src/thermal/engine/__tests__/loftReferee.test.ts`, which wrote `03_engine.json`.
- Weather: Chicago O'Hare TMY3 (committed; sha `3cc3dc0c…`).
- Both sides use 4 steps an hour and fixed ISO convection. EnergyPlus uses EulerMethod zone air.

**The box.**
- 20 × 10 m, 3 m to the ceiling, with windows on the long sides.
- The walls, floor and windows are the Brief 104 cooled room's.
- The room is heated to 21 °C, and cooled at 24 °C in F0c, L2 and M2.
- No internal gains.
- The cases:

| Case | Roof |
|---|---|
| F0 | Flat |
| L1 | Gable at 35° over a ventilated cold loft: bare tiles, 3 air changes an hour, ceiling with 270 mm of mineral wool |
| M1 | Mono-pitch at 10°, insulated at the slope, with the room open to it |

## Gates

| Case | Quantity | Engine | EnergyPlus | Difference | Gate | |
|---|---|---|---|---|---|---|
| L1 | Room's heating, kWh | 15,324 | 15,658 | −2.1 % | ±5 % | pass |
| L1 | Heat through the ceiling to the loft, kWh | 2,662 | 2,680 | −0.6 % | ±10 % | pass |
| L1 | Loft air, annual mean | 11.43 °C | 11.41 °C | +0.02 K | 0.5 K | pass |
| L1 | Loft air, hourly RMSE | 0.51 K | | | ≤ 1.0 K | pass |
| L1 | Loft air, hottest hour | 44.6 °C | 43.4 °C | +1.2 K | 1.5 K | pass |
| L1 | Loft's own effect on heating (L1 − F0), kWh | −87 | −79 | +9.8 % | ±10 % | pass (by a small margin) |
| L2 | Room's cooling, kWh | 1,567 | 1,595 | −1.8 % | ±10 % | pass |
| L2 | Loft's own effect on cooling (L2 − F0c), kWh | −94 | −65 | +46 % | ±15 % | **miss** |
| M1 | Room's heating, kWh | 19,447 | 19,887 | −2.2 % | ±5 % | pass |
| M2 | Room's cooling, kWh | 1,634 | 1,638 | −0.3 % | ±10 % | pass |
| L1, M1 | Monthly estimate against the 15-minute run, heating | +2.3 %, +1.8 % | | | ±10 % | pass |

The flat-roof base cases, reported beside the own effects (the room-level gaps of Briefs 103 to 108):

| Case | Quantity | Engine | EnergyPlus | Difference |
|---|---|---|---|---|
| F0 | Heating, kWh | 15,410 | 15,736 | −2.1 % |
| F0c | Cooling, kWh | 1,661 | 1,660 | +0.1 % |

## The miss: the loft's own effect on cooling

Both own effects are small. A loft in place of a flat roof changes the room's heating by about 0.5 % and its cooling by about 4–6 %. So a few tens of kWh decide the percentage.

What we checked:
- **It is not the loft running too cool.** At midday in summer the engine's loft is the warmer, by +0.43 K. At night it is the cooler, by −0.10 K. In the hours the room is cooled, the loft's mean is 28.15 °C in the engine against 27.97 °C in EnergyPlus. A warmer loft would add cooling, not take it off.
- **The heat through the ceiling over the year agrees:** 2,460 kWh out of the room in the engine against 2,471 kWh in EnergyPlus.

So the gap is on the room side, in when the ceiling's heat arrives against when the room needs cooling. It is not in how much heat arrives. The heavy ceiling (plasterboard under 270 mm of wool) in place of the flat roof changes how the room's surfaces store the sun from the windows. That is where the free-running summer gap of Briefs 104 to 108 already sits.

This is stated, not proven, and it stays open. Nothing was tuned. The test holds the miss where it was measured, so any change to it is seen.

## The loft on clear winter nights

The brief first said the loft lies between outside and the room on a winter night. On a clear night the bare tiles see the sky and the loft falls a little below outside. For example, at 03:00 on 16 January the engine's loft is −6.6 °C, EnergyPlus's is −6.9 °C, and outside is −5.6 °C. EnergyPlus has the loft below outside in 3,575 hours of the year. The test now says what the physics does, and the brief says why.

## What the monthly estimate leaves out: the sun on the slopes

The monthly estimate takes the loft by ISO 13789's adjustment factor b, without solar. On L1 its ceiling loss is 2,680 kWh against the run's 2,662 kWh, and its heating is +2.3 % against the run (gated, pass).

In summer the sun on the slopes matters more, and the monthly estimate leaves it out:

| | Monthly cooling, kWh | 15-minute run cooling, kWh | Difference |
|---|---|---|---|
| F0c (flat roof) | 1,529 | 1,661 | −8 % |
| L2 (cold loft) | 1,250 | 1,567 | −20 % |

On the flat roof the monthly estimate's cooling is already 8 % low (its utilisation factor). The loft takes it to 20 % low, because a hot loft's heat into the room on summer days is not in the estimate. For scale, in the run the loft's slopes and gables absorb 201.5 MWh of sun over the year (at their outside faces; the sky takes back 95.6 MWh), and almost all of it leaves again through the tiles and the loft's air.

This is reported, not gated, as the brief set. The estimate's notes say "solar on a cold roof's slopes is not counted".

## What was built (P4)

- **Schema.** `zones[].conditioning` (`'conditioned'` by default) and `unconditioned_kind` (`'ventilated_loft'`) are added to 2.11 with defaults, so saved plans read unchanged and there is no version bump.
  - An unconditioned zone is refused, by name, if it has any setpoint or control strategy, emitter, ventilation entry, profile reference, system group or window control, or a q50.
  - It must state its air changes and its kind.
- **The hourly run.**
  - The loft floats, with no heating or cooling line at all (not zero lines).
  - The ceiling counts in the room's envelope area for its leakage, under today's method and under weather-driven air. It is tested under today's method: the room's leakage is equal with and without the loft.
  - The loft's leakage is its own air changes.
- **The monthly estimate.** It follows ISO 13789:2017 6.4: b = H_ue / (H_iu + H_ue), and each room's ceiling line is b·U·A·Δθ.
  - The loft is a zone with no heating.
  - Its lines (fabric, bridging, air, and the heat arriving through the ceiling) are split by conductance and close each month.
- **The seam.**
  - Fabric only heats the conditioned rooms and leaves the loft unheated.
  - Preflight asks the loft for no setpoints.
  - The floor area and EUI count conditioned zones only.
  - `Summary.zones[].unconditioned` marks the loft.
- **Design heat loss.**
  - A ventilated loft with no stated temperature sits at the outdoor design temperature, and its source is shown as `outdoor_design`. This is how the MCS calculator takes a roof; it is not verified here against a published copy.
  - The room's line is its own: "Ceiling to the loft".
- **Unchanged:** today's engine (`instantCalc.js`) and the Bridgewater anchor. The full suite passes: 537 tests, 6 skipped.

**Still open.**
- The 3 air changes an hour figure (ISO 13789 clause 9.4 / BR 443) is not yet checked against a published copy. It stays stated, editable and labelled.
- The cooling own-effect miss (above).
