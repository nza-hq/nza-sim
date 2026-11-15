# Brief 105 — final report

**The drawn building runs.** A building drawn in the v2 editor, with fabric from the library and space types with their gains, now shows heating and cooling for the building and for each zone, with the full breakdown, a moment after each edit. Missing inputs are listed by name in plain words instead of being filled in.

## The brief's verification

| # | Check | Result |
|---|---|---|
| 1 | `npx vitest run src/thermal src/sim2` passes; 103 and 104 numbers unchanged without gains and ventilation | 156 tests pass. The 103 and 104 gates are unchanged (one step an hour, fixed convection, gains and ventilation absent). |
| 2 | Gains and ventilation analytic cases; closure per zone per hour | [`02_gains.md`](02_gains.md), [`03_ventilation.md`](03_ventilation.md): gains equal today's `computeHourlyGains` to < 1e-9 W; every zone closes every hour with the new lines. |
| 3 | Bridgewater five storeys with gains and ventilation within ±10 % of the referee | −3.9 % heating, +9.3 % cooling like for like (same air density); with EnergyPlus's default density −11.4 % / +10.2 %. Per storey in [`03_ventilation.md`](03_ventilation.md). The cooling remainder is Brief 104's F2. |
| 4 | A drawn building shows results; an edit reruns within about 1 s; named empty states | [`05_panel.md`](05_panel.md): the editor's two-zone plan gives 9.3 MWh heating; a rerun shows in about 0.4 s in the container, including a 250 ms pause after the last edit. Not yet timed on IT15. |
| 5 | Per-floor: step error and TARP measured; roof slab gap attributed | [`06_per_floor.md`](06_per_floor.md): step error ≤0.1 % on Bridgewater; TARP brings the worst storey's cooling error from 31 % to 17 %; the slab gap is 1.83 MWh convection form, 0.52 other surface physics, 0.31 not attributed (1.3 % of z5's heating). |
| 6 | No file of today's engine touched; anchor 133.2 | No change to `instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `solarCalc.js`, `wallModel.js`, `thermalBridges.js`, `thermalMass.js`, `openingCoefficients.js` or `nza_engine/`. `_brief93_anchor.mjs --fixture` gives 133.2. |

## Also delivered

- Weather: a local EPW never leaves the browser; editors and admins can save one to their organisation's private bucket (migrations 0006 and 0007, applied on NZA Sim dev only). The upload button has not been tried signed in, because the container has no signed-in session; the storage policy was checked with SQL.
- A drafted internal wall, built only from layers already in Chris's library, runs and is named in the panel as a draft awaiting Chris.
- Cooled-room twin with gains: each room within 4.3 % of EnergyPlus with the same surface coefficients.

## Independent review

[`07_independent_review.md`](07_independent_review.md); response [`08_review_response.md`](08_review_response.md). No tuning. F1, F2, F5, F7 and F8 fixed, F4 stated, F9 a note.

## Carried forward

- A per-zone breakdown on tap, including heat from neighbouring zones (F3).
- A pin for every construction a document uses, or the unpinned ones listed (F6).
- A fast TARP, so per-storey figures can lose their "not yet validated" note.
- MVHR summer bypass (F9).
- Chris to check the drafted internal wall.
- Saving and reloading plans; the rerun time on IT15.
