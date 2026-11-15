# Brief 108 Part 3: capped heating against EnergyPlus

**Referee.** EnergyPlus's `ZoneHVAC:IdealLoadsAirSystem` with `Heating Limit = LimitCapacity` at each capped room's cap.
- It confirms the convention: EnergyPlus's peak hourly heating equals the cap to within 0.06 W.
- Unmet hours are counted the same way on both sides: hourly zone air more than 0.5 K below the setpoint. EnergyPlus's own `Zone Heating Setpoint Not Met Time`, at a 0.5 K reporting tolerance, agrees with the count to within 3 h.
- The caps are in `validation/energyplus/108_capped_spec.json`. They were chosen before any comparison as round figures below Engine 2's uncapped peaks.
- The caps are given to Engine 2 as an all-convective fixed-output emitter, because ideal loads are all convective.

**Gate** (proposed in the brief, unchanged): annual heating ±10 %, unmet hours ±20 % or ±50 h, lowest temperature ±1 K, for each capped room.

## The cooled room (Denver, Engine 2's surface coefficients; three rooms, the outer two heated at 20 °C)

| Case | Room | Heating MWh, Engine 2 / EnergyPlus | Unmet h | Lowest °C | Pass |
|---|---|---|---|---|---|
| uncapped | west | 1.861 / 1.933 (−3.7 %) | 0 / 0 | 20.0 / 20.0 | yes |
| tight, 800 W (~56 %) | west | 1.815 / 1.880 (−3.4 %) | 460 / 517 (−57 h, −11 %) | 14.23 / 14.02 | yes |
| tight, 800 W | east | 1.815 / 1.877 (−3.3 %) | 461 / 511 | 14.19 / 14.02 | yes |
| mild, 1,100 W (~77 %) | west | 1.859 / 1.930 (−3.7 %) | 26 / 32 | 17.54 / 17.24 | yes |
| mild, 1,100 W | east | 1.859 / 1.927 (−3.5 %) | 26 / 32 | 17.51 / 17.24 | yes |

## Bridgewater, five storeys (Brief 105's gate referee r2_z_gains_vent_std), the top storey capped at 12,000 W (~54 %)

| Storey | Heating MWh, Engine 2 / EnergyPlus, capped | Unmet h | Lowest °C | Pass |
|---|---|---|---|---|
| Floor 5 (capped) | 29.11 / 28.37 (+2.6 %) | 388 / 345 (+43 h) | 18.55 / 18.63 | yes |
| Floor 4 (below it) | 19.60 / 21.07 (−7.0 %) | 0 / 0 | 21.0 / 21.0 | yes |

- **Floors 1 to 3** are within ±9 % in both runs, with no unmet hours.
- **The neighbour picks up heat on both sides.** Capping Floor 5 raises Floor 4's heating by 0.40 MWh in Engine 2 and by 0.26 MWh in EnergyPlus. Each storey's uncapped figure is Brief 105's (Floor 2–4 heating −7 to −9 %, per-storey not yet validated, Brief 104 F1/F2).

**What this shows.** The cap is carried the same way in both models:
- heating stops at the cap;
- the room floats;
- the hours below setpoint and the lowest temperature follow.

The cooled room's capped heating differs from EnergyPlus by the same −3.5 % as uncapped, so the cap adds no error of its own. Engine 2 has about 10 % fewer unmet hours in the tight case, which is consistent with its slightly smaller loss (the same −3.5 %).

**What it does not show:**
- **A radiant share.** Ideal loads cannot give radiant heat, so the emitters' radiant share is tested only analytically and for closure (Part 2), not against a referee.
- **Re-rating.** EN 442 re-rating is arithmetic, tested by hand (Part 2).

**Files:**
- referee scripts `validation/energyplus/108_capped_referee.py` and `108_bridgewater_capped.py`;
- results `03_cooled_room_capped_energyplus.json`, `03_bridgewater_capped_energyplus.json`, and the comparison `03_referee.json` (`scripts/108_referee.mts`);
- the cooled-room gate as a test (`emitters.test.ts` (f)), which runs from a fresh checkout;
- tests: 197 pass.
