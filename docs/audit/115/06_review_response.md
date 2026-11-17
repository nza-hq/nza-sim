# Brief 115 — answers to the independent review

The review is [`05_independent_review.md`](05_independent_review.md) (project files, `nza-sim/115/`). Every finding is answered here: fixed in code with a test, documented, or put to Linzie. Nothing was tuned to a referee number.

| # | Answer | Where |
|---|---|---|
| F1 | **Fixed.** When air is weather-driven and any room has an opening window, the run is in quarter hours, so the window rule decides every 15 minutes (the step the referees passed at). Speed re-measured at 4 steps an hour (below). The choice of speed against right is on a card for Linzie; quarter hours is built and recommended. | `sim2/run/seam.ts` `runOptionsFor`; `scripts/115_perf.mts`; `05_performance.json` |
| F2 | **Fixed.** The single-sided term is now De Gids–Phaff's constant turbulence part, C₃ = 0.01 m²/s²: q_t = ½·A·√C₃. It is combined with the window's own flow in quadrature, √(q_w² + q_t²), and the line shows only the increase. A hand-value test checks a still, isothermal room (ρ·½·A·0.1) and a warm room (the quadrature sum). Effect on R2 single (Chicago): year's air 469 → 551 t, hours above 28 °C 141 → 117. It stays on by default for new plans, as Linzie chose on 16 Nov 08:34; the reviewer's condition (a hand-value test) is met. Not refereed: EnergyPlus has no such term, and the line says so. | `airflow.ts` `turbulenceFlow`, `AIR.c_turb`; `airflow.test.ts` |
| F3 | **Fixed.** Under weather-driven air a room's extract fans are a fixed extract flow in its pressure balance: their air arrives through the cracks, vents and windows and shows on those lines; the MEV line is 0 so nothing is counted twice. A `natural` ventilation entry in a room with opening windows is refused by name ("the room's opening windows give its natural ventilation under weather-driven air; remove this entry"). If the fans cannot draw their air at some hour the run stops and says which hour. | `airflow.ts` (`extract`), `model.ts`; `airflow.test.ts` |
| F4 | **Fixed.** A room with leakage but no outside wall (a WC or store under the roof) keeps today's leakage, q50 ÷ 20, and the result says so (`air.leakage = 'q50_over_20'`). Its extract fans keep their own conductance. The editor thread is adding the note on screen. | `airflow.ts` `fixed_leakage`; `model.ts`; `airflow.test.ts` |
| F5 | **Diagnosed** (below). The sentence in `02_referee.md` is corrected. | `02_referee.md` |
| F6 | Documented: cross-flow's extra warmth is F5's threshold effect. The hours-above-28 °C gate stays as the brief set it; degree-hours is suggested for later specs. | below |
| F7 | Fixed with F1: the product decides windows every 15 minutes, and the editor shows "windows decide every 15 minutes" beside the window line. The follow-up "the window shuts when the room calls for heat" stays owed. | seam; editor thread |
| F8 | **Fixed.** Under a temperature rule an opening profile may hold only 0 or 1 (when the window may open), and a part value is refused by name. Part values stay for timetable rules, which EnergyPlus's Constant control with an opening-factor schedule can express. The Profiles step offers only on/off profiles under a temperature rule (editor, PR #55). | `airflow.ts` `openingProfile`; `airflow.test.ts` |
| F9 | Documented. The spec's R1 heating gate is ±5 % against the brief's ±3 %; it passes at −0.1 % either way, and the deviation is stated here and in the final report. The convection (iso_conv) goes into the spec at its next change. The owed list is kept (below). | — |
| F10 | **Fixed.** A test checks that `windowEffectiveArea(0.3, top_hung, 20°)` is within 5e-4 of the office spec's 0.098. The stale comment on `buildAirModels` is fixed and `hours_ref` is typed. `hours_windows_open` stays as a convenience count beside `window_open_fraction`; it is noted as derived. | `officeReferee.test.ts`; `airflow.ts` |
| F11 | Noted for the final report: the office's mixed-mode test is the meaningful cooling check. | — |

## F1: speed at quarter hours

Measured in the container (`05_performance.json`). The budgets are IT15's, so the IT15 measure is still owed.

| Case | Time | Budget |
|---|---|---|
| One room, 4 steps an hour | ~216 ms | 100 ms |
| 50 rooms, 4 steps an hour | ~11 s | 2 s |
| 50 rooms, today's leakage, 4 steps an hour | 5.1 s | — |

Quarter hours is about four times slower. It is right where hourly is not (F1's office misses every gate at 1 step an hour). The choice is Linzie's and is on a card.

## F5: cross-flow's +12 % air, diagnosed

EnergyPlus was run on R2 cross with its system step fixed at 15 minutes and every quarter hour written out (window state, room temperature, flows). The engine's flow equations were then fed EnergyPlus's own state step by step, and the engine's own run was compared with EnergyPlus's step by step.

1. **The flow, given the same state, is +2.5 %.** With EnergyPlus's room temperature and window state at each step, the engine's air is 0.999 of EnergyPlus's in shut steps, 1.026 in partly open hours and 1.023 in fully open hours.
2. **The windows open in 7 % more steps.** Over the year the engine's windows are open in 4,074 quarter hours against EnergyPlus's 3,806. All 268 extra steps are in hours where the window opens for part of the hour; in fully open and fully shut hours the counts are equal.
3. **The cause is the room's warm bias at the 22 °C limit.** The engine's room is 0.07 K warmer than EnergyPlus's in shut summer hours and 0.055 K warmer in the partly open hours. This is the free-running summer gap of Briefs 103 to 108, the same one behind the hours above 28 °C. EnergyPlus has 355 shut steps whose room was within 0.06 K below 22 °C at the step before; a 0.055 K bias opens most of them, which is the 268.

So 1.07 × 1.025 ≈ +10 % of the +11.7 % is attributed; about 2 % remains (the extra air also cools the room, which changes later decisions). The cross-flow heating gap (+4.4 % against about +1 % elsewhere) is probably the same extra opening, but that is not yet checked step by step, so it is stated as open. Nothing was tuned. The fix belongs to the room's summer gap, which is open from Brief 104, not to the air model.

## Owed before 115 closes

- R1 per storey on Bridgewater (±10 %) and Bridgewater's weather-driven second anchor.
- R3 night cooling.
- The IT15 speed measure at quarter hours.
- P7 air arrows on the drawing (editor).
- The follow-up "the window shuts when the room calls for heat" (F7).
