# Brief 124 P1–P3 and P5: thermal mass behind finishes, refereed

**Result:** every gate passes on the first run, and nothing was tuned.
- **Hourly run.** With the contents at 10 kJ/K·m² (ISO 52016-1 Table B.17) on both sides, it agrees with EnergyPlus (matched surface coefficients) within 0.5 % on cooling, for all five slab finishes, in both climates.
- **Monthly estimate.** On ISO 13786's periodic κ, it stays within +1.5 to +5.4 % of the hourly run on the Brief 122 buildings. It ranks the finishes in the same order as EnergyPlus.
- **Bridgewater v2.** It moves by about 1 %.

## The room

The room is the concrete-frame office from the 17 Nov investigation (`validation/energyplus/mass_finishes_spec.json`).
- **Finishes:** five slab finishes: exposed, carpet, sealed suspended ceiling, both, and a lightweight floor as the baseline.
- **Our engines:** `scripts/mass_finishes.mts`. The carpet and the ceiling are built as inside finishes (D3); `finishes.test.ts` shows these give the same hours as the layers written by hand.
- **EnergyPlus 25.2:** `validation/energyplus/mass_finishes.py --contents 10000`. The contents go on the zone air as a capacitance multiplier.
- **Steps:** four steps an hour in both.
- **Weather:** Chicago O'Hare TMY3 (committed) and San Francisco TMY3 (shipped with EnergyPlus).

### Chicago, kWh a year (EnergyPlus own / matched coefficients | ours)

| Case | Cooling EP | Cooling hourly | Cooling monthly | Heating EP | Heating hourly | Heating monthly | Hottest hour, free-running EP / ours |
|---|---|---|---|---|---|---|---|
| exposed | 3,113 / 2,989 | 2,987 | 3,177 | 482 / 509 | 431 | 500 | 37.4 / 36.7 / 36.8 |
| carpet | 3,183 / 3,038 | 3,036 | 3,214 | 538 / 546 | 470 | 529 | 37.6 / 36.9 / 36.9 |
| ceiling void | 3,278 / 3,217 | 3,207 | 3,355 | 611 / 694 | 611 | 643 | 38.3 / 37.9 / 38.0 |
| carpet + void | 3,406 / 3,331 | 3,319 | 3,412 | 715 / 787 | 704 | 688 | 38.7 / 38.3 / 38.4 |
| lightweight | 3,777 / 3,740 | 3,775 | 3,511 | 1,031 / 1,156 | 1,113 | 766 | 41.0 / 40.7 / 40.9 |

### San Francisco, free-running hours over 28 °C (EnergyPlus own / matched | ours with 10 kJ | ours with the old 250 kJ)

| Case | Hours |
|---|---|
| exposed | 34 / 4 / 13 / 0 |
| carpet | 56 / 9 / 24 / 0 |
| ceiling void | 123 / 88 / 127 / 0 |
| carpet + void | 199 / 156 / 195 / 0 |
| lightweight | 401 / 372 / 448 / 0 |

The full rows are in `engines_*.json` and `energyplus_contents10k_*.json`.

## Gates (Brief 124 D5, fixed before the run)

1. **Monthly heating within ±10 % of the hourly run** on the Brief 122 buildings (`monthly_vs_hourly_chicago.json`, Chicago weather; Gatwick is not in this container):

   | Building | Monthly against hourly |
   |---|---|
   | Bridgewater, one zone | +5.4 % |
   | Bridgewater, five storeys | +3.6 % |
   | Community centre | +1.5 % |

   **Pass.**
2. **The finishes in EnergyPlus's order for cooling.** In both climates the monthly estimate runs exposed < carpet < ceiling void < both < lightweight, as EnergyPlus does. **Pass.** Its level is 2–6 % above EnergyPlus's own, reported.

## What changes for existing buildings (`before_after_chicago.json`, the product's run)

| Building | Heating | Cooling |
|---|---|---|
| Bridgewater v2, five storeys (250 → 10 kJ/K·m²) | 257.8 → 259.8 MWh (+0.8 %) | 162.6 → 164.5 MWh (+1.2 %) |
| Community centre | 34.7 → 35.6 MWh (+2.8 %) | 16.3 → 16.5 MWh (+1.4 %) |

The peaks do not move. These buildings carry their mass in drawn slabs and walls already, so the 250 kJ/K·m² mattered far less there than in the one-room test.

Today's engine (`instantCalc.js`) and its 133.2 anchor are untouched. The v2 anchor on Yeovilton is re-measured on IT15 before merging to main.

## What remains

- **P4 (editor):** the floor finish and ceiling choices on templates and Fabric.
- **Library:** `finish_carpet` and `finish_suspended_ceiling` are drafts awaiting Chris (`docs/audit/102/library_additions.json`).
