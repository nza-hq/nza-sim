# Brief 103 Part 6a: BESTEST in EnergyPlus, the same inputs as Engine 1

**EnergyPlus puts every BESTEST result inside the published ranges, from the inputs Engine 1 reads.** So the inputs
are right, and Engine 1's misses on Case 900 (Part 4) come from Engine 1's model of the building, not from the
specification as built here.

**Each of Engine 1's three ISO 52016-1 simplifications was put into EnergyPlus one at a time.** Together they move
EnergyPlus from 4.289 to **4.683** MWh heating on Case 600. Engine 1 gives **4.698**, so on the light case Engine 1
is the referee with those three simplifications. On Case 900, the heavy case, they explain about two thirds of the
heating gap (1.652 → 2.082, against Engine 1's 2.436). The rest is open; see "What is left".

- Script: [`validation/energyplus/103_bestest_twin.py`](../../../validation/energyplus/103_bestest_twin.py), run
  with `--energyplus <path>` (EnergyPlus 25.2.0, Linux). Output: [`bestest_energyplus.json`](bestest_energyplus.json).
- Weather: the Denver TMY3 `.mos` Engine 1's test reads (sha `13f5a77b…`), written back as an EPW row for row.
- Inputs: those in `bestest.test.ts`. The window is the specification's two Glass600 panes with 12 mm air, with
  EnergyPlus's own angular optics. EnergyPlus also uses its own convection (DOE-2 outside, TARP inside), its own sky
  long-wave and its beam solar on the floor (FullInteriorAndExterior).
- Nothing was tuned. The three one-change variants are ISO 52016-1's own values, put into EnergyPlus.

## Table 1: EnergyPlus as specified, against the ranges

| Case | Heating MWh | Cooling MWh | Range heating | Range cooling | In range |
|---|---|---|---|---|---|
| 600 | 4.289 | 6.016 | 3.993–4.504 | 5.432–6.162 | yes |
| 900 | 1.652 | 2.507 | 1.379–1.814 | 2.267–2.714 | yes |

Free-floating (min / max / mean °C): 600FF −12.45 / 63.15 / 25.00, 900FF 1.41 / 43.90 / 25.18, all in range.
Transmitted solar is 9.650 MWh.

## Table 2: one ISO simplification at a time, in EnergyPlus

| Variant | 600 heating | 600 cooling | 900 heating | 900 cooling |
|---|---|---|---|---|
| As specified | 4.289 | 6.016 | 1.652 | 2.507 |
| Outside convection fixed at h_ce 20 | 4.435 | 5.447 | 1.901 | 2.146 |
| Inside convection fixed by tilt (Table 25) | 4.500 | 5.986 | 1.811 | 2.659 |
| The window as one U and g (simple glazing) | 4.297 | 6.119 | 1.649 | 2.581 |
| All three | 4.683 | 5.540 | 2.082 | 2.370 |
| *Engine 1 (Part 4)* | *4.698* | *5.725* | *2.436* | *2.976* |

- **Outside convection is the largest single effect** (+0.25 MWh heating on 900). EnergyPlus's wind-driven
  coefficient is lower than 20 W/m²K over most of the year.
- **Inside convection by tilt** adds +0.16 MWh on 900.
- **The window as one U and g** hardly matters. Engine 1's window is not the problem.
- **What all three do not include:** EnergyPlus still puts the sun's beam on the floor. Engine 1 spreads all
  transmitted solar over every inside surface by area, including the window itself.

## What is left on Case 900

With all three simplifications, EnergyPlus gives 2.082 / 2.370 MWh. Engine 1 gives 2.436 / 2.976. Part 6b tests the
beam-on-floor difference. Other candidates, not measured here:

- the inside long-wave exchange (Engine 1: a star network by area; EnergyPlus: view factors);
- the sky (Engine 1: a fixed 11 K; EnergyPlus: the weather file's infrared);
- the node count in the heavy layers.
