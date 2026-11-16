# Brief 109 Part 0: reconnaissance

## Where the engines assume one setpoint for the year

| Place | What it does today | What changes |
|---|---|---|
| `model.ts` (around line 396) | Refuses `setback_c` and `hours_ref` by name ("not modelled yet"). | Resolves them into each zone's hourly heating and cooling setpoints. |
| `zone.ts` (Engine 1) | `setpoints: { heat_c, cool_c }` constants. `phi` holds `heat_c` or `cool_c`. The warm-up repeats day 1 (`step(h, false)` for h 0–23). | The setpoints become arrays, read for the hour. The warm-up reads hours 0–23 of them, so it repeats day 1's schedule. |
| `network.ts` (Engine 2) | `heatC`/`coolC` constant per zone. The active set is warm-started from the hour before. The held-zone equation is (x_a + x_star)/2 = setpoint. | The same arrays, read per hour. The warm start stays valid: it is a starting guess, and the iteration settles it each hour (count capped at 3Z + 3, refused past that). |
| `model.ts` (around line 543) | Unmet hours and the lowest temperature are counted against the constant `heat_c`. | Counted against each hour's own setpoint, plus a count "in use" (decision 3). |
| Sizing peak (`seam.ts`, Brief 108 P4) | The peak hour of an unlimited run. | With a setback, that is the morning recovery (decision 4). |
| Brief 111's levels (`chris/111-results-levels`) | "Fabric only" copies the document with every zone at one temperature. | That copy must also clear `hours_ref` and `setback_c`. This is noted for when 111 resumes: it is on another branch and not this brief's file. |

**Today's tool has no setbacks.** `instantCalc.js` has no setback or heating-hours term. The converter (`fromBuildingConfig.ts`) writes `setback_c: null` and `hours_ref: null`. So no Bridgewater figure moves, and the anchor stays 133.2.

**The calendar.** `gains.ts` `calendar()` maps every weather hour to its day type (1 January is a Monday, as for the gains), its hour of day, and its month and day. A `schedule` profile's `day_types` (weekday, Saturday, Sunday; 24 values each) are read on it. A `schedule` profile has no exceptions or monthly multipliers (schema 2.4), so a heating schedule has no holidays yet; that is stated.

## Decisions

1. **What the schedule value means.** The hour's heating setpoint = setback_c + f × (heat_c − setback_c), for f from 0 to 1. So 1 means heat_c and 0 means setback_c. With no setback stated, an hour at f = 0 has its heating off. A value outside 0–1 is refused.
   - *Why:* this is the shape of a heating timer with a frost or night setting, and an in-between value is how a pre-heat ramp is written.
2. **Cooling runs only in an hour with f > 0.** At f > 0 the setpoint is `cool_c`, unchanged.
   - *Why:* a scheduled system off at night does not cool at night. A zone that wants cooling around the clock states no hours.
3. **Hours below are counted two ways.**
   - Against each hour's own setpoint, as Brief 108 counts them: this is the engine's check that the limit bites.
   - "In use": hours with f = 1 that are more than 0.5 K below heat_c. This is what an occupant feels, and the panel shows it.
   - The lowest temperature is reported in use and over all hours.
4. **The sizing peak with a setback.** It is reported as found, and it is usually the morning recovery. The panel gives the hour it happened and, beside it, the steady peak (the same run without the setback). A recovery peak above the steady one is what a heat-pump designer needs to see. It is not hidden.
5. **Underfloor heating in the slab.** This is Engine 2 only. Engine 1 (one-zone documents) refuses it by name. Engine 1 has elements and nodes too, but one engine is enough to referee first.
   - **Control.** The zone's thermostat sets the heat into the slab as an ideal controller, limited to 0 ≤ φ ≤ the emitter's output. Ideal means the air (or operative) temperature is held whenever the limit allows.
   - **EnergyPlus differs.** Its radiant systems control by a throttling range around the setpoint. The referee uses a small throttling range, 0.5 K, and the difference is stated, not tuned.
   - **Output.** The re-rating at the room's temperature (Brief 108) is an approximation for a slab, where the water heats the screed, not the air. Its effect is measured in the referee.
6. **A radiator's own heat capacity is not modelled; stated.** This is an estimate from typical published sizes, not a measured rating: a double-panel convector 600 × 1,000 mm gives about 1.7 kW at ΔT 50 and holds about 5.6 l of water (23 kJ/K) and about 27 kg of steel (12 kJ/K). That is about 35 kJ/K. Its output rises by about 1.3 × 1,700 / 50 ≈ 44 W per kelvin at ΔT 50. So its time constant is 35,000 / 44 ≈ 800 s, about 13 minutes.
   - **Effect at a one-hour step.** The water and steel delay the heat; they do not lose it. The worst case is a start from cold: the first hour gives about 13 / 60 ≈ 22 % less, and that heat comes out over the next hour or two. Annual heat and in-use hours below are unaffected to first order. The morning profile's first hour is high by up to about a fifth.
   - **Recorded as a known limit** for the load-profile work. Underfloor heating in a screed is hours, not minutes, and is modelled in Part 3.

## EnergyPlus for the referees (25.2.0)

- **Scheduled thermostats:** `ThermostatSetpoint:SingleHeating` with a `Schedule:Compact` setpoint.
  - The 108 referees already use `Schedule:Constant`; the setback is a second value.
  - Cooling off outside the hours is a setpoint of 99 °C, which EnergyPlus never reaches, in a `ThermostatSetpoint:DualSetpoint`.
  - EnergyPlus's "Zone Heating Setpoint Not Met Time" uses the hour's own setpoint. The referees count hours below from hourly zone air, as Brief 108 does, both ways.
- **Underfloor heating in a slab:**
  - `ConstructionProperty:InternalHeatSource`: the heat source sits after layer k, with `tube_spacing` and `dimensions_for_the_ctf_calculation` = 1.
  - With either `ZoneHVAC:LowTemperatureRadiant:Electric` (no plant loop, capacity in W; the simplest like for like) or `…:VariableFlow` on a hot-water loop (Brief 108's loop).
  - Both objects exist in the schema; the run is in Part 3. The proposal is the electric one first, because it isolates the slab physics from the loop.
