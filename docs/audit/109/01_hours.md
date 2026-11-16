# Brief 109 Part 1: heating hours and setbacks on Engines 1 and 2

**Commit:** `109 P1: heating hours and setbacks`.

## What changed

- **`model.ts` `zoneSetpointHours`** resolves each zone's `setpoints.hours_ref` (a `schedule` profile) and `setback_c` into hourly setpoints, on the gains calendar (decisions 1 and 2 of Part 0):
  - Heating: setback_c + f × (heat_c − setback_c). With no setback, f must be 0 (off) or 1 (heat_c).
  - Cooling: cool_c where f > 0, and off where f = 0.
  - Each refusal is by name:
    - an unknown or non-schedule `hours_ref`;
    - a setback with no hours, or with no heating setpoint, or above the heating setpoint;
    - a value outside 0–1;
    - a part value with no setback;
    - hours with neither setpoint.
- **Engines.** `zone.ts` (Engine 1) and `network.ts` (Engine 2) take `setpoint_hours: { heat_c, cool_c }`, one value per hour, NaN where a service is off. They are checked by one shared `checkSetpointHours`.
  - Engine 1 reads the hour's setpoint where it read the constant one. A NaN compares false, so that service does nothing.
  - Engine 2 sets each zone's setpoint at the start of each hour's steps. A zone held by a service that has just switched off is released before the active set iterates.
  - The warm-up repeats hours 0–23, as before.
- **`results.ts`** gains three fields:
  - `in_use_hours`;
  - `unmet_heating_hours_in_use`, the hours at the full setpoint more than 0.5 K below it;
  - `min_control_in_use_c`.

  `unmet_heating_hours` is now counted against each hour's own setpoint (decision 3). Hours at the emitters' limit are counted only where heating is on.

## Evidence (`setbacks.test.ts`, 8 tests)

- **(a) By hand.** The zone's only heat store is its air (massless walls), in a constant 0 °C.
  - Heated 07:00–19:00 at 20 °C with a 15 °C setback, and limited to 22 k W.
  - Every hour of the last day equals the backward-Euler recursion T₊ = (C/Δt·T + k·θe + φ)/(C/Δt + k), with φ clipped to [0, cap]: within 0.01 K and 0.1 W.
  - 07:00 is at the limit and below the setpoint; 03:00 is held at 15 °C.
  - Engine 2 on the same zone equals Engine 1 to 1e-6 K, also with heating off outside the hours.
  - Closure is ≤ 1e-6 Wh every hour.
- **(b) A schedule of all 1s is no schedule.** On the cooled room, every hourly heating, cooling and air temperature is identical, and `in_use_hours` is 8,760.
- **(c) The cooled room with office hours and a 15 °C setback:**
  - The middle room cools only in its hours.
  - Unlimited, the heated rooms never fall below the hour's setpoint.
  - The setback saves heat against heating all day, and the cooled room cools less.
  - With 900 W heaters, hours below in use are counted, never exceed the all-hours count, and equal a count by hand from the hourly temperatures.
  - The one-zone west room runs on Engine 1.
  - Closure holds every hour.
- **(d) Refusals.** Seven gaps, each with its path and words.
- **With no hours stated, nothing moves.** All 228 earlier tests pass unchanged, except one: its refusal (a setback "not modelled yet") is now the new refusal for a setback with no hours, which the test checks instead. 236 tests pass.

**Not yet:** the EnergyPlus referee (Part 2), the panel (Part 4), and the sizing peak with a setback (decision 4, Part 4).
