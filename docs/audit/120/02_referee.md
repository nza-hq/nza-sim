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
