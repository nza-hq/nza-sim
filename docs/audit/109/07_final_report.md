# Brief 109: final report

16 Nov 2026, branch `chris/109-dynamics`. Linzie's follow-up to 108 was that heat does not arrive instantly. A zone's heating now follows its hours with a night setback. Emitters at their limit carry the morning warm-up. Underfloor heating puts its heat into the floor. All of it is gated against EnergyPlus.

## What was built

- **Hours and setbacks (P1).** On Engines 1 and 2, each hour's heating setpoint is setback_c + f × (heat_c − setback_c), and cooling runs only in the hours. Hours below are counted in use against each hour's own setpoint.
- **Referee (P2).** The cooled room (three limits) and Bridgewater as five storeys, with office hours and a setback. EnergyPlus is read on the zone air heat balance and gated against EulerMethod (both measured, and recorded in the spec after the review).
- **Underfloor heating in the floor (P3).** Schema 2.5 adds `source_surface_id` and `source_layer_index`. Engine 2 puts the heat into the node at that layer's inside face. Closure holds every hour, and a steady state by hand agrees to 1e-6. EnergyPlus `LowTemperatureRadiant:Electric` passes the gate on every case.
- **Seam and panel (P4).** `summary.zones[i].hours` holds in-use hours, hours below, the lowest temperature in use, the morning and later peaks with the hour of each, and the cold-morning recovery. `HeatingHours.tsx` shows them. Setback refusals are in plain words.
- **Review (P5).** Emitters are now sized on the year without the setback. A limited zone heated to hours runs in quarter hours. The overnight cooling gap is attributed to inside convection. Tests were added for a floor between storeys and for a pre-heat hour. Details in `06_review_response.md`.

## Verification

1. **All 256 tests pass and the build is clean.** With no hours stated, Bridgewater five storeys with radiators at 50/40 and a 70/60 what-if gives results identical to Brief 108 on main. That covers every zone's heating, cooling, hours below, lowest temperature, sizing and energy. Both versions were run on the anchor weather and the output compared byte for byte.
2. **Analytic step response** to 0.01 K on both engines (P1). Closure holds every hour.
3. **Every referee passes its gate** at 4 steps an hour against EulerMethod. At 1 step, one line fails: cooled room mild, hours below in use, −54 h. This is why the product now runs a limited zone heated to hours in quarter hours (−31 h). Nothing was tuned.
4. **No file of today's engine changed** (`git diff origin/main...HEAD` over `frontend/src/utils` and `nza_engine` is empty). The anchor is 133.2 on this branch and on main.
5. **Speed is not yet shown within budget.** In this container, five storeys with a schedule take 329 ms at 1 step, against Brief 104's 254.6 ms here and its 150 ms budget, which was met on IT15 at 85 ms. With two limited storeys heated to hours, the whole `simulate` (in quarter hours, plus the sizing run) takes 1.9 s here. **Re-measure on IT15**: the scaled estimate is about 0.11 s and 0.6 s.

## Open items

- Is the 250 kJ/K·m² of contents lumped with the air partly the fabric mass that Engine 2 already models (review F2)? It sets most of an unlimited room's first-hour figure. EnergyPlus is given the same value, so the referee cannot decide it.
- The unlimited cooled room's morning peak is −7.5 % against EnergyPlus at 4 steps, with convection matched. Not attributed.
- Underfloor heating is rated at the room's temperature, so its hours below may be understated by up to about 7 %. Rating it at the source node is left for later.
- Bridgewater cooling is +30 % to −4 % by storey (Brief 103's open finding). Not gated here.
- The editor's inputs for hours, setbacks and underfloor floor and layer belong to the editor thread.
