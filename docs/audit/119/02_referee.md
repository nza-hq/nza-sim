# Brief 119 Part 2 — cooling limited by the room's units, against EnergyPlus

16 Nov 2026. EnergyPlus 25.2.0, `ZoneHVAC:IdealLoadsAirSystem` with `Cooling Limit = LimitCapacity`. Caps and gate fixed in [`validation/energyplus/119_cooling_spec.json`](../../../validation/energyplus/119_cooling_spec.json) before any run. EnergyPlus results [`02_energyplus.json`](02_energyplus.json) (`validation/energyplus/119_cooling_referee.py`); engine side and gate [`02_referee.json`](02_referee.json) (`scripts/119_referee.mts`). The limit is a cooling-only VRF indoor unit (`heats: false`), all convective, as ideal loads are.

**Gate:** each limited zone, annual cooling ±10 %, hours more than 0.5 K above the cooling setpoint ±20 % or ±50 h, highest air temperature ±1 K (108's heating gate, mirrored).

## Results

| case | zone | cooling engine / EP, MWh | Δ | hours above engine / EP | Δ h | highest Δ K | gate |
|---|---|---|---|---|---|---|---|
| cooled room, unlimited | middle | 1.409 / 1.348 | +4.5 % | 0 / 0 | 0 | 0 | pass |
| cooled room, tight (800 W) | middle | 1.368 / 1.318 | +3.8 % | 379 / 299 | **+80 (+27 %)** | +0.92 | **fail** |
| cooled room, mild (1,100 W) | middle | 1.405 / 1.345 | +4.4 % | 51 / 33 | +18 | +0.66 | pass |
| Bridgewater, storey 3 at 12,000 W | Floor_3 | 14.39 / 13.21 | +8.9 % | 54 / 43 | +11 | +0.06 | pass |

Bridgewater's other storeys are not limited; their cooling is the engine's known gap against EnergyPlus (Floor_1 +28.8 %, Floor_2 +13.5 %, Floor_5 −7.3 %, unchanged by the limit: the same in the unlimited run). That is Brief 103's open cooling finding, not this brief's.

One line fails: the tight cooled room's hours above the setpoint, +80 h of 299.

## Attribution (diagnostic, not tuning: nothing in the engine changed)

The engine's unlimited cooling peak in the middle room is 1,411 W against EnergyPlus's 1,341 W (+5.2 %), so the same 800 W is a smaller share of the engine's need (56.7 %) than of EnergyPlus's (59.7 %), and more hours exceed it. Runs of the engine only:

| run | cap W | hours above | highest °C |
|---|---|---|---|
| one step an hour (the product) | 800 | 379 | 28.22 |
| four steps an hour | 800 | 363 | 28.03 |
| cap at EnergyPlus's share of the engine's own peak (800 × 1,411 / 1,341) | 842 | 310 | 27.88 |
| EnergyPlus | 800 | 299 | 27.30 |

With the cap at the same share of each model's own peak, the hours above are within 11 h. So the miss is the engine's unlimited cooling peak being 5 % above EnergyPlus's (the open cooling finding from Briefs 103 and 109: inside convection overnight and the morning), not the limit's mechanics. At the milder cap the same 5 % moves fewer hours, and passes. The step length is worth 16 h.

**Sizing meaning:** with cooling units well below the need (about 55 %), the engine counts up to about a quarter more overheating hours than EnergyPlus. That is on the cautious side for a sizing question (it says "too small" a little early), and it is said on the panel with the count.

## Notes

- EnergyPlus's ideal loads limit cooling by **total** capacity only: epJSON has no `maximum_sensible_cooling_capacity`, and the first run, which set it, was silently ignored and gave 0 W cooling (the capacity then reads 0). The referee sets `maximum_total_cooling_capacity`. With dehumidification off the latent part is 0.004 MWh in the cooled room and about 1 MWh a storey at Bridgewater (gains carry moisture there); in the limited hours the sensible cooling still reaches the 12,000 W cap exactly.
- The engine's cooling is sensible only; latent cooling is out of scope (brief).
