# Brief 107 Part 3 — tolerance table against EnergyPlus

Script: `scripts/107_tolerances.py`, which writes [`03_tolerances.json`](03_tolerances.json).
- **Building:** Bridgewater as five storeys.
- **NZA side:** Engine 2 plus v2 systems ([`02_gate.json`](02_gate.json)).
- **EnergyPlus side:** Brief 105's five-zone referee with gains and ventilation ([`../105/02_gains_referee.json`](../105/02_gains_referee.json)). Its ideal-load demand goes through the same systems (heating 95 % at SCOP 3 and 5 % direct electric; cooling at SEER 3).

## Against the gate referee (same air density)

| End use | NZA, MWh | EnergyPlus, MWh | Δ | Tolerance | |
|---|---|---|---|---|---|
| Heating demand | 114.546 | 119.160 | −3.9 % | ±10 % | pass |
| Cooling demand | 62.725 | 57.383 | +9.3 % | ±10 % | pass |
| Heating electricity | 42.000 | 43.692 | −3.9 % | ±10 % | pass |
| Cooling electricity | 20.908 | 19.128 | +9.3 % | ±10 % | pass |
| Hot water, heat pump | 41.174 | 41.174 | | shared input | |
| Hot water, gas | 157.428 | 157.428 | | shared input | |
| Hot water pump | 1.051 | 1.051 | | shared input | |
| Fans | 40.613 | 40.613 | | shared input | |
| Lighting | 39.014 | 39.014 | | shared input | |
| Small power | 186.136 | 186.136 | | shared input | |
| Auxiliary | 27.699 | 27.699 | | shared input | |
| **EUI, kWh/m²** | **131.89** | **131.86** | **0.0 %** | ±5 % | pass |

With EnergyPlus's default outdoor air density, the demand rows miss (−11.4 % / +10.2 %, Brief 105's attributed air-density convention). The EUI is still −0.6 %.

## What this table can and cannot show

- **Scalar efficiencies leave no new physics.** With them, a delivered row can disagree only where its demand does, so the heating and cooling electricity rows repeat the demand rows exactly.
- **Shared rows are not independent checks.** The referee takes its gains from `gains.ts` (Brief 105 decision 2) and has no hot water or fans. So "shared input" rows agree by construction. They are listed so that every term of the EUI is on the table (Rule 9).
- **What does check them.** Lighting, small power, auxiliary, hot water and fans are checked against today's engine path by path in Part 2. Gains heat is checked against EnergyPlus in Brief 105.
- **The EUI's 0.0 % flatters.** About two-thirds of the EUI is shared input. Heating (−1.7 MWh) and cooling (+1.8 MWh) also happen to cancel. The demand rows are the meaningful ones, and they carry Brief 105's numbers and caveats (per storey not yet validated; Brief 104 F2).
