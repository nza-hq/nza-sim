# Brief 108 Part 2: heating limited to the emitters' output

**Rating** (`frontend/src/thermal/engine/emitters.ts`):
- A wet emitter gives Q = Q_rated × (ΔT / ΔT_rated)^n.
  - ΔT is the log-mean water-to-room difference at its heating system's `design_flow_c` / `design_return_c` and the zone's heating setpoint (decision 2, a design rating).
  - When flow equals return, ΔT is flow − room.
- A VRF indoor unit or an electric heater gives count × its stated output.
- A zone's cap is the sum of its emitters. Its heating radiant share is the emitters' radiant fractions weighted by output.
- **Refused by name:** a missing count, output, radiant share, rating, exponent, design flow or return; a return at or below the room; a switched-off system; a zone with emitters but no heating setpoint.

**Engine 1** (`zone.ts`):
- φ = min(heating needed, cap).
- Heating reaches the room by the zone's own convective share (1 − radiant share), through its own response vector. Cooling keeps the run's share.

**Engine 2** (`network.ts`):
- A fourth state in the active set, "heating at its limit": the zone is free, with the cap as a known heat input.
  - A held zone needing more than its cap moves to it.
  - A zone at its limit that would rise above its setpoint returns to held.
  - The pass limit is now 3Z + 3.
- Heating and cooling each have their own split and response columns (EW/RW, EWc/RWc). The columns are copied where the splits are equal, so a document without emitters solves exactly as before.
- The admittance (Cholesky) form still runs when all heating and cooling go to the air.
- The capped input is carried on every path:
  - air control, admittance;
  - air control, dense;
  - operative control;
  - sub-hourly steps.

**Results** (`ZoneResults`):
- `annual.unmet_heating_hours`: hours the control temperature is more than 0.5 K below the heating setpoint (`UNMET_K`). It is null for a zone with no heating setpoint.
- `annual.min_control_c`.
- `emitters`: { cap_w, radiant_fraction, hours_at_cap, each emitter's output }, or null when the zone states none.
- **Moved to Part 4:** the uncapped peak, which needs the seam's second run.
- **The heating line is the heat actually given.** Closure (hourly and over the year) is unchanged in form and holds in every test.

**Setbacks** (`setpoints.setback_c`, `hours_ref`) were silently ignored by the v2 engines. They are now refused by name until Brief 109 models them. The converter writes them as null, so Bridgewater is unaffected.

**Tests** (`engine/__tests__/emitters.test.ts`, 12 new; 196 pass in total):
- EN 442 by hand: 49.83 K, and 379 W for a 1,000 W radiator at 50/40 in a 21 °C room.
- One zone in steady cold weather settles at cap / k on Engine 1 and Engine 2, within 0.01 K (the brief's verification item 2). Also on the dense path and under operative control.
- Two zones, one capped: the capped zone floats at (cap + 20·UA) / (UA + H₁), and its neighbour heats 20·H₀ + UA·(20 − T₁), both by hand.
- A cap at twice the peak leaves every hourly value equal, on both engines.
- The cooled room with its heated rooms capped at 60 % of the peak, on four solver paths:
  - heating is never above the cap;
  - closure holds every hour;
  - there are more unmet hours, a lower minimum temperature and less heating than the same run uncapped.

**Unchanged:** `107_gate.mts` gives the same figures (`02_gate.json` unchanged). No file of today's engine is touched; anchor 133.2.
