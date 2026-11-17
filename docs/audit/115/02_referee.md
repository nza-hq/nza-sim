# Brief 115 P4 — referees R1 (air leakage) and R2 (windows by temperature)

17 Nov 2026. EnergyPlus 25.2.0 AirflowNetwork, MultizoneWithoutDistribution, 4 steps an hour. Spec [`validation/energyplus/115_air_spec.json`](../../../validation/energyplus/115_air_spec.json) (committed before the first run, 09b9b5c); EnergyPlus model [`115_air_referee.py`](../../../validation/energyplus/115_air_referee.py); engine side [`airBox.ts`](../../../frontend/src/thermal/engine/__tests__/airBox.ts) and the gates in [`airReferee.test.ts`](../../../frontend/src/thermal/engine/__tests__/airReferee.test.ts). Results: `02_energyplus.json` (EnergyPlus, gated), `02_energyplus_base.json` (EnergyPlus's own convection, for the record), `02_engine.json` (engine).

**Nothing was tuned.** No engine figure was changed to move a result toward EnergyPlus. Two things changed in the referee after its first run, and one engine bug was found and fixed. All three are listed under "What changed after the first run", with the reason for each.

## The room

A single room, 5 × 6 × 3 m, with the Brief 104 constructions. In EnergyPlus each wall is split into three 1 m bands, so each band's crack sits at the engine's crack height. The site terrain is suburban, the crack exponent 0.67, the heating 20 °C, and the weather Chicago O'Hare TMY3.

The window is 2.0 × 0.9 m in the middle band of the south wall (plus the same on the north wall for "cross"). It is sliding, half of it opens, and its Cd is 0.6. It opens above 22 °C when the room is warmer than outside. Pressure coefficients are EnergyPlus "Input" arrays holding the engine's own Swami–Chandra tables, so both sides use the same Cp.

EnergyPlus's SimpleOpening takes the window's centroid (1.5 m) as the bottom of the opening. The engine's sill is therefore 1.5 m and its head 2.4 m, and EnergyPlus's external node is at 1.95 m (the engine's wind height). Both models then have the same opening.

## Results (engine against EnergyPlus)

| Case | Gate | Engine | EnergyPlus | Miss | Verdict |
|---|---|---|---|---|---|
| R1 q50 5 | hourly inflow R² ≥ 0.95 | | | R² 0.9999 | pass |
| | year's inflow ±5 % | 269.7 t | 269.9 t | −0.07 % | pass |
| | leakage's own effect on heating ±5 % | 932.7 kWh | 933.7 kWh | −0.1 % | pass |
| R1 q50 10 | hourly R² | | | 1.000 | pass |
| | year's inflow | 539.3 t | 539.6 t | −0.06 % | pass |
| | own effect on heating | 1,867.9 kWh | 1,870.0 kWh | −0.1 % | pass |
| R2 single-sided | hours open ±5 % | 1,810 | 1,849 | −2.1 % | pass |
| | peak within 0.5 K | 31.68 °C | 31.37 °C | +0.31 K | pass |
| | hours above 28 °C ±10 % | 141 | 119 | +18 % | **fail** (see below) |
| | (year's inflow, not gated) | 469.1 t | 468.1 t | +0.2 %, hourly R² 0.97 | — |
| R2 single, modulated | hours open | 1,816 | 1,854 | −2.0 % | pass |
| | peak | 31.68 | 31.38 | +0.30 K | pass |
| | hours above 28 °C | 141 | 120 | +18 % | **fail** |
| R2 cross | hours open | 1,640 | 1,680 | −2.4 % | pass |
| | peak | 31.18 | 30.86 | +0.32 K | pass |
| | hours above 28 °C | 95 | 82 | +16 % | **fail** |
| | (year's inflow, not gated) | 3,049 t | 2,731 t | +11.7 %, hourly R² 0.92 | open |
| R2 cooled at 26 °C | windows' own effect on cooling ±5 % | −67.3 kWh | −69.4 kWh | −3.1 % | pass |

Heating and cooling are compared as each line's own effect: the case with the line, minus the same case without it. This follows Briefs 114 and 119. The room's whole heating carries the open fabric gap of Briefs 103 to 108: here the engine's heating is about 1 % above EnergyPlus's in every case, including the case with no air at all.

**The miss on hours above 28 °C is the room, not the air.** The same room with no air at all (R1_tight) already spends +8 % more hours above 28 °C in the engine (222 against 205), with a peak 0.23 K higher. The free-running summer gap of Briefs 103 to 108 shows up in the warmest hours. It is reported as a fail as written. The test holds it between the misses recorded here, so any change shows; that is not a pass.

**Cross-flow: the year's air is +12 %.** In the hours when both models have the windows fully open, they agree to within 2 % (481 hours, sorted by wind speed). The gap is in the hours where the windows open for only part of the hour. There the engine's windows are open about 8 % longer (1,019 full-open-equivalent hours against 940). The control decides each quarter hour from the room's temperature at the step before, as EnergyPlus's does. The cross-flown room swings near its 22 °C limit, so a small difference in its temperature changes when the window shuts. This is open: not tuned, and not yet diagnosed to a term.

## What changed after the first run

1. **Weather: Denver to Chicago O'Hare.** The Denver `.mos` file's wind-direction column (C16) holds values from 0 to 36,990, which are not degrees. The engine's test reader had not read that column at all (every hour was 0°). On the first run, R1's year matched to 0.07 %, but its hours did not (R² 0.92), and the engine's flow rose against EnergyPlus's as the wind got stronger. The referee now uses the Chicago O'Hare TMY3 EPW that ships with EnergyPlus 25.2.0, committed under `validation/fixtures/weather/` (sha256 `3cc3dc0c…309f`), whose wind directions are real. No earlier brief read the Denver wind direction, so the earlier referees are not affected. The test reader now reads column C16 as stated.
2. **EnergyPlus convection: its own (DOE-2 / TARP) to Brief 104's `iso_conv`.** That is 20 W/m²K outside, and inside by tilt (2.5 / 5.0 / 0.7), as the engine's `REFEREE_OPTIONS`. On the first run, EnergyPlus's room ran 1.5 K warmer at the top of summer, a known fabric difference, and the windows opened 18 % more hours because of it. Leakage flows do not depend on it: EnergyPlus's own convection gives the same R1 inflow to 0.2 %. The base-convection results are kept in `02_energyplus_base.json`.
3. **Engine bug fixed: the room-pressure solve could stop before it balanced.** With a window open, EnergyPlus's derivative factors for a two-way opening are not the true slope, and Newton crept along one side of its bracket. After 100 steps the room's pressure was still off, and the window's flow was counted unbalanced, up to 3,000 kg/h at an hour where the balance gives 100 kg/h. Now any step outside the bracket, or two steps that fail to halve it, gives way to bisection. A solve that has not settled after 200 steps refuses the run by name ("the room's air pressure did not settle at hour h"); nothing is accepted unbalanced. This fixed R2's year of air from +16 % to +0.2 %.

Also mirrored after the first run: EnergyPlus reads hourly weather on a straight line between hours at each sub-step. The engine already did this for the outdoor temperature (`theta_e_between: 'linear'`). Weather-driven air now reads the wind speed and direction the same way, with the direction taken the short way round. At one step an hour (the product's default) nothing changes. This took R1's hourly R² from 0.949 to 0.9999. It is a method choice for runs of more than one step an hour, applied to every document, not a fit.

## Differences kept on purpose (stated)

- **A window with almost no temperature difference.** When the room and outside differ in density by less than 1e-4 kg/m³ (about 0.03 K), EnergyPlus treats an open window as its closed crack (`SimpleOpening::calculate`, `generic_crack` with the closed-crack coefficient). The engine keeps it an open orifice (Cd·A·√(2ρΔp)), which is the physics. This happens rarely, because a window opens only when the room is warmer than outside.
- **Single-sided turbulence** (EN 16798-7) is not in EnergyPlus and is switched off in the referee.
- **Not refereed here (owed):** Bridgewater's five storeys (R1 per storey) and R3 (night cooling). Both are listed in the final report.
