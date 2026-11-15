# Brief 108 Part 4: sizing

**Commit:** `108 P4: sizing`. Script `scripts/108_sizing.mts`; numbers in `04_sizing.json` (anchor weather, sha `c657…8cf2`).

## What the seam now reports

`simulate(doc, { weather, what_if? })` gives `summary.emitters`, null when no zone states emitters. For each zone that does:

- **peak_w**: the zone's highest hourly heating with its emitters' radiant share kept and their output not limited. This
  comes from a second run of the same document with the run option `emitter_limit: 'none'`. Nothing in the document is
  changed or muted. The option only takes the limit away (Rule 8 is about suppressing a state, and this is a sizing run,
  labelled as one).
- **cap_w**: the emitters' output at the design flow and return in the room at its heating setpoint (Part 2).
- **shortfall_w** = max(0, peak − cap).
- **rated_now_w**: the wet emitters' total rating converted to EN 442's standard 75/65/20 °C.
- **needed_rated_w**: the rating at 75/65/20 that covers the peak at the design temperatures,
  (peak − fixed-output units) ÷ (ΔT_design / ΔT_standard)^n, with ΔT the log-mean water-to-room difference. Null, with
  a `note` in words, when the zone has only fixed-output units, wet emitters on two heating systems, or two exponents.
- From the capped run: unmet hours (more than 0.5 K below the setpoint), the lowest temperature and the hours at the cap.

**What-if.** `what_if: { design_flow_c, design_return_c }` copies the document, replaces the design temperatures on every
heating system that states them, and changes nothing else. It reruns capped and unlimited, and reports the same lines
plus the building's heating and energy. A what-if that cannot run (a return at or below a room's setpoint, or no system
with design temperatures) says why, and the main results still show.

Emitter and design-temperature gaps now come back in words, e.g. "Set how many there are for the emitter "r" in
"Storey 2"." or "The heating system "…": the return (20 °C) must be above Storey 1's heating setpoint (21 °C)…".

## Linzie's case on Bridgewater

Each storey is given panel radiators (n = 1.3, 30 % radiant) sized to give exactly its peak at 70/60 °C, as for a gas
boiler. Then the air source heat pump is run at 50/40 °C. Room 21 °C. Outputs in kW.

| Storey | Peak | Rated now (75/65/20) | Output 70/60 | Unmet h 70/60 | Output 50/40 | Short 50/40 | Unmet h 50/40 | Lowest °C 50/40 | Rating needed for 50/40 |
|---|---|---|---|---|---|---|---|---|---|
| Storey 1 | 23.2 | 27.4 | 23.2 | 0 | 10.4 | 12.8 | 634 | 18.0 | 61.0 |
| Storey 2 | 18.9 | 22.4 | 18.9 | 0 | 8.5 | 10.4 | 500 | 18.3 | 49.9 |
| Storey 3 | 19.0 | 22.5 | 19.0 | 0 | 8.5 | 10.5 | 481 | 18.2 | 50.0 |
| Storey 4 | 19.0 | 22.5 | 19.0 | 0 | 8.5 | 10.5 | 517 | 18.1 | 50.1 |
| Storey 5 | 24.9 | 29.5 | 24.9 | 0 | 11.2 | 13.7 | 713 | 17.3 | 65.7 |

At 50/40 the same radiators give 45 % of their 70/60 output, (23.8 / 43.9)^1.3. They hold 21 °C in mild weather and
run out in the cold: 2845 unmet storey-hours, as low as 17.3 °C on the top floor. The rating
needed is 2.23 times what is there.

| Building | Heating kWh | Unmet storey-hours | Energy kWh | EUI kWh/m² |
|---|---|---|---|---|
| 50/40 | 111,760 | 2845 | 555,005 | 131.6 |
| 70/60 | 116,703 | 0 | 556,818 | 132.1 |

Energy is lower at 50/40 only because less heat is delivered: the rooms are colder. The heat pump's efficiency is the
stated SCOP at both pairs. Its rise at a lower flow temperature is not modelled, and the EUI comparison must be read
with that in mind. (A flow-temperature-dependent SCOP is a Systems change, proposed for a later brief, not tuned here.)

**Verification.** Stating each storey's needed rating at 50/40 and running again leaves 0 unmet hours on every storey
and no shortfall (`verify_needed_rating_at_50_40`).

## Tests

- `thermal/engine/__tests__/sizing.test.ts` (8):
  - the unlimited run equals emitters far above the peak, value for value, radiant share kept;
  - output, shortfall and needed rating by hand at 50/40;
  - the needed rating stated leaves no unmet hours, and 10 % less does;
  - 70/60 needs a smaller rating, in the ratio of the factors;
  - fixed-only units, a fixed unit beside radiators, two exponents and two systems.
- `sim2/run/__tests__/seam.test.ts` (2 new): Bridgewater per storey with the 70/60 what-if, and the needed rating
  verified; a what-if that cannot run says why, and gaps come back in words.
- Full suite: 207 pass. A document without emitters gives `emitters: null` and every other number unchanged.
