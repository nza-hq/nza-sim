# Brief 108 Part 0 — reconnaissance

## Rating an emitter at other temperatures (EN 442-2)

- **Output:** Q = Q_rated × (ΔT / ΔT_rated)^n.
- **ΔT:** the log-mean temperature difference between water and room, ΔT = (T_flow − T_return) / ln((T_flow − T_room) / (T_return − T_room)).
- **Rated condition:** EN 442 rates at 75 / 65 / 20 °C, which gives ΔT_rated = 49.83 K by the log mean, or 50 K by the arithmetic mean that catalogues quote. The rated flow, return and room temperatures are inputs, so a catalogue's own rating is used as given.
- **Exponent n:** typically 1.3 for panel radiators, 1.1 for underfloor and 1.0 for fan coils. It is an input with no default (Rules 2 and 3).
- **Worked example.** A 1,000 W radiator rated at 75/65/20 run at 50/40 with the room at 21 °C:
  - ΔT = 10 / ln(29 / 19) = 23.65 K;
  - output = 1,000 × (23.65 / 49.83)^1.3 = 379 W, 38 % of its rating.

  This is the effect Linzie asked to see.
- **Return at or below the room temperature.** The log mean is then undefined (no heat can flow at that return). It is refused, naming the system.

## Where the cap enters each engine

- **Engine 1** (`zone.ts`, about line 349): each hour `phi` is the heating needed to hold the setpoint. The cap is `phi = min(phi, cap)`. When it binds, the zone's temperature follows from the same solve, with the heating fixed.
- **Engine 2** (`network.ts`, active set about lines 618–633): each zone is free (0), held at heating (1) or held at cooling (−1).
  - A fourth state, "heating at its limit", treats the zone as free with a known heat input.
  - A held zone whose φ exceeds its cap moves to it. A capped zone whose temperature rises above its setpoint returns to held.
  - The existing pass limit guards convergence.
- **Closure and breakdown.** These are unchanged in form. The heating line is the heat actually given.

## What today's tool has

`capacity_kw` exists on v40 systems (and on v2 `system_groups`), but today's engine never reads it. The repo has no emitter model. Nothing is ported.

## The EnergyPlus referee

- **The object.** `ZoneHVAC:IdealLoadsAirSystem` has `Heating Limit` (`NoLimit`, `LimitFlowRate`, `LimitCapacity`, `LimitFlowRateAndCapacity`) and `Maximum Sensible Heating Capacity` (W).
  - `LimitCapacity` at each zone's cap is the like-for-like referee: a fixed maximum heat to the zone, below which the zone floats.
- **Outputs to read.** EnergyPlus reports unmet hours as `Zone Heating Setpoint Not Met Time` (it counts hours at 0.2 K below by default; `OutputControl:ReportingTolerances` sets it). The referee sets that tolerance to the 0.5 K this brief uses.

## Decisions that refine the brief

(Decision 1 is widened by Linzie's follow-up of 21:35. Kinds are `radiator`, `underfloor`, `fan_coil`, `vrf_indoor`, `electric` and `other`. `vrf_indoor` and `electric` have a fixed output. Every emitter states a `radiant_fraction`. The time response is Brief 109.)


1. **Which system feeds an emitter.**
   - A wet emitter (radiator, underfloor, fan coil) names its heating system group (`system_group_id`), and is rated at that group's design flow and return.
   - An electric emitter (`kind: 'electric'`) has a fixed output and no temperatures.
   - The zone's cap is the sum of all its emitters. The proportional split between systems (Brief 107) still divides the heat given.
   - So the schema's emitter is: `{ id, label?, kind: 'radiator' | 'underfloor' | 'fan_coil' | 'electric' | 'other', count, rated_output_w, system_group_id | null, rated_flow_c | null, rated_return_c | null, rated_room_c | null, exponent_n | null }`.
   - For a wet kind, the group and the four rating fields are required. For `electric`, they must be null.
   - `other` is wet (it has a group and is rated) unless stated otherwise in a later brief.
2. **Room temperature for the rating.** The zone's heating setpoint, held for the year (a design rating). Real output rises a little as a room cools below the setpoint, so this slightly understates the output in the coldest hours.
   - This keeps the cap a fixed number of watts, which is what EnergyPlus's `LimitCapacity` takes, so the two compare like for like.
   - A temperature-dependent cap is a possible follow-up.
3. **A zone without emitters is uncapped (ideal loads), as now.** A zone with emitters but no heating setpoint is refused: there is nothing to rate at.
4. **Unmet hours.** An hour counts when the zone's control temperature is more than 0.5 K below its heating setpoint. Reported per zone with the lowest temperature and the hours at the cap.
