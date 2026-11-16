# Brief 109 Part 2 — Setbacks against EnergyPlus

16 Nov 2026. Engine 2 with office hours (weekdays 07:00–19:00, setback outside) against EnergyPlus 25.2.0.

- Cases:
  - the cooled-room twin: setback 15 °C, with three heating limits (unlimited, tight, mild);
  - Bridgewater as five storeys: 21 °C in use, 16 °C setback, cooling 24 °C in use only.
- Each runs at 1 and 4 steps an hour.
- The gate is the spec's (`validation/energyplus/109_setback_spec.json`). It is unchanged.
- Numbers: `02_referee.json`, from `scripts/109_setback.mts`.
- Referees: `validation/energyplus/109_setback_referee.py` and `109_bridgewater_setback.py`.

## Result

The gate passes on every case against EnergyPlus run with its EulerMethod zone air scheme, at 4 steps an hour. The engines use the same first-order step, so this is the like-for-like comparison.

At 1 step an hour, which is how the product runs today, everything passes except one line in one case. On the cooled room with the mild limit, hours below in use come out 52–54 h short of EnergyPlus's 244–248 h (−21 to −22 %). The gate allows ±50 h or ±20 %.

Against EnergyPlus's default third-order scheme, Bridgewater's morning peak misses by 36–42 %. The cause is measured below. It is a numerical overshoot in that scheme, not a property of the building.

| Bridgewater (EnergyPlus Euler) | heating, 1 step | morning peak, 1 step | heating, 4 steps | morning peak, 4 steps |
|---|---|---|---|---|
| Floor 1 | −2.5 % | −10.4 % | −2.1 % | −10.1 % |
| Floor 2 | −6.0 % | −13.4 % | −5.7 % | −13.3 % |
| Floor 3 | −5.3 % | −12.8 % | −5.0 % | −12.7 % |
| Floor 4 | −4.6 % | −11.9 % | −4.3 % | −11.9 % |
| Floor 5 | +3.5 % | −4.7 % | +3.9 % | −4.5 % |
| Building | −2.5 % | | −2.2 % | |

Across all five storeys, hours below in use are 0 in both, and the lowest temperature in use is within 0.01 K. The worst profile hour equals the morning peak line.

| Cooled room (EnergyPlus Euler) | 1 step | 4 steps |
|---|---|---|
| unlimited | heating −5.2 %, morning peak −10.2 % | heating −4.6 %, morning peak −7.5 % |
| tight (800 W) | hours below in use −62 h of 496 (passes: 12.5 %), lowest in use +0.27 K | −44 h, +0.23 K |
| mild (1,100 W) | **−54 h of 248 (fails ±50 h / ±20 %)**, +0.15 K | −31 h, +0.15 K |

West room shown; the east room is within 4 h and 0.04 K of it (east, mild, 1 step: −52 h of 244).

For the cooled room, heating is within −3.8 % to −5.2 % in every case. The baseline difference without setbacks was −4 % (Brief 104).

## Two findings in the referee, both measured

### 1. EnergyPlus's ideal-loads heating over-reports a setpoint step

In EnergyPlus, "Zone Ideal Loads Zone Sensible Heating" is m·cp·(T_supply − T_zone), with T_zone taken before the step solves. On a step from 16 to 21 °C it counts the temperature rise a second time.

Bridgewater top storey, 22 Jan, first quarter hour after 07:00 (EulerMethod, time-step outputs):

| | kW |
|---|---|
| ideal loads reported | 1,389.7 |
| heat that entered the zone air (heat balance: system air transfer) | 1,231.2 |
| of which stored in the air and internal mass | 1,206.9 |

The heat balance closes to 0.0 kW without the extra 158.5 kW. As an hourly mean, that is 39.6 kW added to the morning hour. Over the year, reported heating is 0.5–0.8 MWh (3 %) above what entered the air on each storey.

In steady hours the two are equal to 0.1 kW. Earlier referees held constant setpoints, so they are not affected beyond steady-state rounding.

The referees now report the zone air heat balance's system terms, time step by time step: heating where positive, cooling where negative, averaged to the hour. The ideal-loads figures are kept beside them as `ideal_loads_reported`.

### 2. The third-order zone air scheme overshoots on a step

EnergyPlus's default is ThirdOrderBackwardDifference. Bridgewater top storey, 22 Jan 07:00, heat into the air per quarter hour:

- **Third order:** 1,876.5 kW, then −502.7 kW (cooling), then 0. The room's hour mean is 23.59 °C against a 21 °C setpoint.
- **Euler:** 1,231.2 kW, then 29.5 kW, 28.4 kW and 27.9 kW. Hour mean 20.99 °C.

Unlimited ideal loads under the third-order form overshoot the setpoint by about 2.6 K, and cooling pulls the room back. Both engines step with backward Euler, so the gate is read against EnergyPlus's EulerMethod. Both schemes are reported.

Annual heating differs less between the schemes (Floor 1: 24.94 against 24.05 MWh), because the overshoot's heat is mostly lost later. The morning peak takes the whole overshoot.

## Not attributed yet (for the review)

**Overnight cooling, Bridgewater.** Engine 2 cools more slowly overnight than EnergyPlus.
- Floor 3, 22 Jan, 06:00: Engine 2 is at 16.58 °C against EnergyPlus's 16.00 °C. So the engine's morning step is 4.42 K, not 5 K.
- Averaged over weekdays, the morning peak is 10–13 % low on Floors 1–4 and 4.5 % low on Floor 5.
- ~~On the cooled room, whose referee uses the engine's fixed ISO inside convection (flag `iso_conv`), the same line is within 1 % in the limited cases.~~ [Edit, review F4: in the limited cases the morning peak is the limit, so it agrees by construction. The unlimited cooled room, with convection matched, is also −10 % (west) and −9.9 % (east) at 1 step. Inside convection is unlikely to be the whole story; the runs that separate it are in `06_review_response.md`.]

**Cooling, Bridgewater.** Not gated in this brief, which is about heating hours. Engine 2 is +30 % (Floor 1) to −4 % (Floor 5) against EnergyPlus. This is the open cooling-miss finding from Brief 103, not new.

**One step an hour.** The product runs at 1 step an hour. At 1 step, the mild cooled-room case under-counts hours below in use by 22 %. At 4 steps it passes.
- Four steps cost 528 ms against 355 ms on Bridgewater's five storeys in this container.
- Whether the product should move to 4 steps when emitters are capped is a question for Part 4 and the review. It is not changed here.
