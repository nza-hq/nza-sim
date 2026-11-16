# Brief 120 Part 2: the plant limit against EnergyPlus

16 Nov 2026. Spec [`validation/energyplus/120_plant_spec.json`](../../../validation/energyplus/120_plant_spec.json), fixed before any run. EnergyPlus 25.2.0, `DistrictHeating:Water` at its nominal capacity feeding two hot-water baseboards (108's radiators: 50/40 °C, rated at a 20 °C room, n = 1, all convective), Denver weather. Engine 2: the same rooms and radiators on one heating system with `capacity_kw`. Results: [`02_energyplus.json`](02_energyplus.json) (`120_plant_referee.py`), [`02_referee.json`](02_referee.json) (`scripts/120_referee.mts`).

## Result: the gate fails, for two different reasons

| Case | Room | EnergyPlus heat MWh / unmet h | Engine 2 heat MWh / unmet h | Heat | Unmet |
|---|---|---|---|---|---|
| free (2600 W, never short) | west | 1.931 / 27 | 1.859 / 23 | −3.7 % | −4 h |
| | east | 1.928 / 26 | 1.860 / 24 | −3.5 % | −2 h |
| binds (1600 W, two 1100 W radiators) | west | 1.883 / 487 | 1.815 / 460 | −3.6 % | −27 h |
| | east | 1.880 / 485 | 1.815 / 460 | −3.4 % | −25 h |
| unequal (1600 W; 1600 W and 900 W radiators) | west | 1.927 / 173 | 1.832 / 446 | −5.0 % | **+273 h** |
| | east | 1.835 / 587 | 1.799 / 462 | −2.0 % | **−125 h** |

Plant short hours: EnergyPlus 779.5 (binds) and 765 (unequal); Engine 2 676 in both. Lowest flow temperature in EnergyPlus: 35.8 °C (binds), 33.7 °C (unequal).

### 1. The heating miss is 108's, not the plant's

The free case never touches the plant and is identical to Brief 108's "mild" hot-water case (same rooms, same radiators): −3.7 % and −3.5 % there too. That is Brief 104's open cooled-room gap. What the plant itself does, binds minus free, agrees:

| Room | EnergyPlus | Engine 2 |
|---|---|---|
| west | −0.048 MWh, +460 h | −0.044 MWh, +437 h |
| east | −0.048 MWh, +459 h | −0.045 MWh, +436 h |

### 2. Sharing between unequal rooms is wrong (decision 1)

With equal radiators both engines give each room half the plant in its short hours (0.503 and 0.500). With unequal radiators they part:

| Room | Radiator | EnergyPlus share | Engine 2 share |
|---|---|---|---|
| west | 1600 W | 0.561 | 0.522 |
| east | 900 W | 0.445 | 0.478 |

The brief's decision 1 shares a short plant in proportion to what each room asks. EnergyPlus does what a wet system does: the plant cannot hold its flow temperature, the water reaches every radiator cooler, and each radiator gives what its size gives at that cooler water. The room with the bigger radiator keeps more. The brief expected EnergyPlus to be "close to proportional" and asked P2 to measure how close: for equal rooms it is; for unequal rooms it is not, and the unmet hours move by 273 h and 125 h.

No constant was changed to get closer (Rule 10). The next step is a method change, not a tuning: share a short plant through a common flow temperature (Part 2b).

## Part 2b: a short plant shares through one lower flow temperature

`network.ts` (`plantLimit`, `flowFor`), `emitters.ts` (`at_flow`), `model.ts`. A heating plant whose every zone has wet emitters on it now does what EnergyPlus's loop does. When it cannot give what the rooms ask, the water reaches every radiator at one lower flow temperature. That temperature is found so the radiators' own output at it, each room taking no more than it asks, equals what the plant has. Each radiator keeps its design water flow, as in Brief 108. A plant without radiators in every room it serves still shares in proportion to ask, and reports no flow temperature. Nothing was fitted: the radiators' EN 442 output at the cooler water is the same function 108 refereed.

| Case | Room | EnergyPlus heat MWh / unmet h / share | Engine 2 heat MWh / unmet h / share | Heat | Unmet (tolerance) |
|---|---|---|---|---|---|
| binds | west | 1.883 / 487 / 0.503 | 1.815 / 459 / 0.500 | −3.6 % | −28 h (±48.7) ✓ |
| | east | 1.880 / 485 / 0.503 | 1.815 / 461 / 0.500 | −3.4 % | −24 h (±48.5) ✓ |
| free | west | 1.931 / 27 | 1.859 / 23 | −3.7 % | −4 h (±10) ✓ |
| | east | 1.928 / 26 | 1.860 / 24 | −3.5 % | −2 h (±10) ✓ |
| unequal | west (1600 W) | 1.927 / 173 / 0.561 | 1.857 / 158 / 0.561 | −3.7 % | −15 h (±17.3) ✓ |
| | east (900 W) | 1.835 / 587 / 0.445 | 1.774 / 557 / 0.439 | −3.3 % | −30 h (±58.7) ✓ |

Lowest flow temperature: binds EnergyPlus 35.8 °C, Engine 2 36.0 °C; unequal 33.7 °C and 33.9 °C. (In the free case EnergyPlus's loop drifts to 38.8 °C without being short; Engine 2 holds 50 °C.)

**Review F7 (re-run 16 Nov):** EnergyPlus's lowest flow is now also taken over its short steps only (`min_flow_c_short_steps`), so a step with the pump off cannot set it. It is the same: 35.8 °C (binds) and 33.7 °C (unequal). The comparison stands.

**Gate verdict.** Unmet hours pass in every room and case. Annual heating fails its ±3 % in every room, by −3.3 % to −3.7 %, and it fails by the same amount in the free case, where the plant does nothing. That miss is Brief 108's hot-water case and Brief 104's open cooled-room gap, not the plant. What the plant does (binds minus free, and the unequal sharing) agrees. Plant short hours: Engine 2 675–676 against EnergyPlus 765–780 (−12 %), recorded open. **Review F9:** counted the same way (what the plant gave at or above 99.9 % of its capacity, read from `PlantResults.zones`), Engine 2 gives 678 (binds) and 676 (unequal) against 779.5 and 765.25: still −13 % and −12 %. The definitions now match, so the gap is not a counting difference; EnergyPlus counts quarter-hour steps and Engine 2 hours here. Still open.

Tests: `plant.test.ts` adds the unequal-radiator case (the bigger radiator keeps more than 0.53 of the plant in its short hours; proportional sharing gave 0.522 and fails it) and a plant without radiators in every room states no flow temperature.
