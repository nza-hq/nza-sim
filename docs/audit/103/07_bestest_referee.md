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

# Part 6b: three surface-physics options, and which the referee comparison uses

Engine 1 gains three run options (`RunOptions.surface_physics`). Each one replaces one of the simplifications
measured above. With the option absent, Engine 1 behaves exactly as before, and every analytic test is unchanged.

1. **`beam_on_floor`.** The beam part of transmitted solar lands on the floor-facing inside surfaces (tilt above
   120°), by area. Diffuse and ground-reflected solar are still spread over every inside surface by area.
2. **`outside_convection: 'wind'`.** h_ce = 4 + 4·v, ISO 6946:2017 Annex C, from the weather file's hourly wind.
   Windows included; the ground link is untouched.
3. **`inside_convection: 'by_heat_flow'`.** ISO 52016-1 Table 25 by the actual direction of heat flow, taken from
   the previous hour. A floor warmer than the air, or a ceiling cooler than it, takes 5.0 W/m²K; otherwise 0.7. Walls
   stay at 2.5.

When the coefficients change, the solver rebuilds its factorisation for that hour. Every run still closes its
balance to 1e-10 Wh or better. New tests in `zone.test.ts` cover each option: an hourly h_ce equal to the fixed value
gives the same run, steady heating is unchanged by direction of heat flow, the beam keeps the annual gain, and bad
inputs are refused.

## Table 3: each option on Engine 1, MWh

| Options | 600 heating | 600 cooling | 900 heating | 900 cooling | Bridgewater heating | Bridgewater cooling |
|---|---|---|---|---|---|---|
| None (Part 4 / 6) | 4.698 | 5.725 | 2.436 | 2.976 | 89.91 | 15.45 |
| Beam on floor | **4.547** | **5.628** | **2.186** | **2.755** | **89.98** | **15.32** |
| Wind-driven outside convection | 4.682 | 5.833 | 2.398 | 3.059 | 90.07 | 15.26 |
| Inside convection by heat flow | 4.774 | 5.725 | 2.360 | 2.770 | 89.90 | 15.30 |
| Beam and heat flow | 4.789 | 6.251 | 2.281 | 3.112 | 89.45 | 16.33 |
| All three | 4.775 | 6.353 | 2.245 | 3.189 | 89.61 | 16.13 |
| *EnergyPlus as specified* | *4.289* | *6.016* | *1.652* | *2.507* | *90.46* | *13.65* |

## What the referee comparison uses: the beam on the floor, nothing else

The choice rests on what makes Engine 1 and EnergyPlus the same model. It does not rest on which row lands nearest.

- **The beam on the floor: on.** Both referees put it there: FullInteriorAndExterior in the BESTEST twin and in the
  Bridgewater referee. Spreading it by area, including onto the window, is a modelling difference between the two.
  It moves Case 900 toward EnergyPlus in both heating and cooling. It also moves Case 600 heating from 4.698 to
  4.547, away from the earlier near-match. That near-match was two differences cancelling.
- **Wind-driven outside convection: available, off.** ISO 6946's 4 + 4v averages about 20 W/m²K at Denver's wind,
  so it hardly changes anything. EnergyPlus's DOE-2 coefficient runs lower (Table 2). Choosing between two ISO forms
  does not make Engine 1 use EnergyPlus's correlation. It also costs speed: the hourly rebuild takes the Bridgewater
  year from about 25 to about 170 ms, over the 100 ms target.
- **Inside convection by heat flow: available, off.** Table 25's 5.0 for a sunlit floor is a design value, much
  higher than TARP's natural convection for a few kelvin of difference. With the beam on the floor it releases the
  sun to the air at once, and cooling rises on every case. On its own it helps 900, but turning it on for that
  reason would be choosing by the number.

## Results with the referee options as now set

- **BESTEST 600:** 4.547 / 5.628 MWh. Cooling is in range; heating is 0.04 above (4.504).
- **BESTEST 900:** 2.186 / 2.755 MWh. Heating is 0.37 above range (1.814); cooling is 0.04 above (2.714).
  - Against EnergyPlus with the same simplifications (2.082 / 2.370), the residual is +0.10 heating and +0.39
    cooling.
  - Still open: the inside long-wave network, the fixed 11 K sky, and the node count in heavy layers. Not chased in
    103; Brief 104's multi-zone work revisits each.
- **Bridgewater gate (b):** heating 89.98 vs 90.46 (−0.5 %, pass); cooling 15.32 vs 13.65 (+12.2 %, miss).
  - The diagnosis in `06_anchor_envelope.md` stands: interior slab mass that one zone does not have.
  - The beam now lands on the ground floor only. In the building it lands on five floors.
- **Gate (a):** unchanged at 0.000 % on every path. It reads conductances, which no option touches.
- **Speed:** the Bridgewater year takes 35 ms median in Node and 25 ms in a browser worker. 50 independent zones take
  0.91 s and 1.02 s. Node and worker give identical numbers.
- **Today's tool is unchanged.** No file of today's engine changed.

`bestest.test.ts` RECORDED moves from 4.698 / 5.725 and 2.436 / 2.976 to the values above, with the reason written
next to it.
