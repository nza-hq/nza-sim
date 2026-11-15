# Brief 104 Part 1: the Bridgewater cooling gap, attributed

**Answer.** Engine 1's cooling miss (15.32 MWh against the referee's 13.65) is mainly about **how much of the
sunshine through the windows the zone keeps**. The concrete floor slabs are not the main cause. Brief 103 put
forward the slabs as the likely cause; that idea was wrong.

- **Engine 1 keeps 134.6 MWh of window solar a year. EnergyPlus keeps about 122.5.** The difference has two parts:
  - EnergyPlus loses some of the transmitted sunlight back out through the windows. It lands on the inside of the
    glass and leaves (9.4 MWh).
  - Its angle-dependent glazing admits a little less than Engine 1's flat 0.9 factor on g.
- **When Engine 1 is given EnergyPlus's amount of kept solar, the two agree** on the same building with the same
  simplifications: heating within 0.6 %, cooling 0.95 MWh higher (+10 %).
- **The 103 near-match (+12 %) was a net of differences pulling both ways.** The referee has slabs that Engine 1's
  one zone lacks. Engine 1 has 250 kJ/m²K of internal mass on its air node that the referee lacks. And Engine 1
  keeps more sun.
- Nothing was tuned. Engine 1's constants are unchanged. The diagnostic overrides below were used only to measure,
  and are printed as such by the script.

Scripts:

- [`validation/energyplus/104_attribution.py`](../../../validation/energyplus/104_attribution.py), output
  [`01_attribution.json`](01_attribution.json): one-change EnergyPlus runs.
- [`validation/energyplus/104_superposition.py`](../../../validation/energyplus/104_superposition.py) and
  [`scripts/104_superposition.mts`](../../../scripts/104_superposition.mts): both engines at a constant setpoint,
  drivers switched off one at a time, compared hour by hour.

All runs use EnergyPlus 25.2.0 and the anchor EPW (sha `c6571102…cf2`).

## Table 1: from the referee to Engine 1's building, one step at a time (EnergyPlus)

Each row adds one change to the row above. The comfort band is 21–24 °C. Results in MWh.

| Step | Heating | Cooling | Δ cooling | What changed |
|---|---|---|---|---|
| r0, the 103 referee (five zones, four slabs) | 90.46 | 13.65 | | |
| one zone, slabs kept inside it | 90.57 | 13.39 | −0.27 | zone count |
| one zone, slabs removed | 91.02 | 12.40 | −0.99 | the slabs (the beam then lands on the ground floor only) |
| + Engine 1's internal mass on the air node (250 kJ/m²K × floor) | 89.59 | **10.15** | −2.25 | an input Engine 1 has and the referee did not |
| + fixed sky, area long-wave, 1 h step, ISO convection (e1_like) | 94.71 | **9.33** | −0.81 | Engine 1's four simplifications |
| **Engine 1** | 89.98 | **15.32** | **+5.99** | |

- **Zone count does not matter.** The same slabs in one zone change cooling by 0.27 MWh.
- **The slabs are worth about 1 MWh, not 6.6.** 103's 6.6 MWh came from keeping the slabs' resistance while removing
  their mass, which is not a building.
- **Engine 1's internal mass lowers the referee's cooling by 2.25 MWh** when it is put into EnergyPlus. The
  document carries today's 250 kJ/m²K (TODAY), and the 103 referee never had it. So the referee did not have quite
  the same building. See "What changes", item 2.

One-change runs on the five-zone referee (cooling MWh, against 13.65):

| Change | Cooling | Heating |
|---|---|---|
| fixed sky (dry bulb − 11 K) | 13.75 | 90.18 |
| area-weighted long-wave | 13.27 | 90.69 |
| one time step per hour | 10.97 | 93.12 |
| ISO convection (h_ce 20, h_ci by tilt) | 14.89 | 93.32 |
| FullInteriorAndExterior | 13.30 | 90.81 |

The time step is the largest single setting in EnergyPlus. At one step per hour EnergyPlus's own result moves
2.7 MWh. Engine 1's 1 h step is implicit Euler, which is not EnergyPlus's scheme, so this row measures EnergyPlus's
sensitivity, not Engine 1's.

## Table 2: Engine 1 against e1_like, decomposed (constant 22 °C setpoint, net load = cooling − heating)

At a constant setpoint the load is linear in its drivers. Each driver is switched off in both engines identically.

| Run | Engine 1 net MWh | EnergyPlus net MWh | Engine 1 − EnergyPlus |
|---|---|---|---|
| all drivers | −74.55 | −87.95 | **+13.40** |
| no window solar | −193.49 | −196.05 | +2.57 |
| no opaque solar | −82.05 | −100.41 | +18.36 |
| no solar at all | −200.99 | −208.50 | +7.51 |

- **Window solar's effect on the load:**
  - Engine 1: −74.55 − (−193.49) = **118.9 MWh**.
  - EnergyPlus: −87.95 − (−196.05) = **108.1 MWh**.
  - The difference, **+10.8 MWh**, is the largest term.
- **Opaque solar** counts 5.0 MWh less in Engine 1. This term goes the other way.
- **With no sun at all,** the remaining 7.5 MWh is smaller heating in Engine 1. It includes Engine 1's 0.33 Wh/m³K
  air against EnergyPlus's outdoor air density (review finding 6).
- **July by hour:** the difference peaks at +7.5 kW at 13:00 and is about +0.5 kW at night. It is a sunshine-hours
  difference.

**Where EnergyPlus's window solar goes** (constant 22 °C run, annual MWh):

- transmitted: 103.1 (beam 34.0, diffuse 69.1);
- absorbed in the glass: 65.4;
- absorbed by the inside surfaces: 93.7 (ground floor 41.2, walls 35.1, roof 17.4).

So **9.4 MWh of transmitted solar leaves again through the windows.**

Of the glass's 65.4, about 0.44 flows inward. That is the normal-incidence ratio from 103 P6, so it is an estimate.
**EnergyPlus keeps about 93.7 + 28.8 ≈ 122.5 MWh. Engine 1 keeps 134.6:** g × (1 − frame) × F_W, with all of it
absorbed inside.

## Table 3: Engine 1 with EnergyPlus's kept solar (diagnostic overrides, not a fix)

| Engine 1 run (21–24 °C band) | Kept solar MWh | Heating | Cooling |
|---|---|---|---|
| as built (F_W 0.9, solar convective fraction 0.1) | 134.6 | 89.98 | 15.32 |
| F_W 0.84 (EnergyPlus's annual angular ratio, 103 P6) | 125.6 | 93.36 | 11.93 |
| F_W 0.82 (kept solar = EnergyPlus's 122.5) | 122.6 | 94.55 | 10.93 |
| F_W 0.82 and convective fraction 0 (EnergyPlus puts none on the air) | 122.6 | 95.25 | 10.28 |
| *e1_like (EnergyPlus with Engine 1's building and simplifications)* | | *94.71* | *9.33* |

**What the 5.99 MWh gap from e1_like to Engine 1 is made of:**

| Part | MWh | How measured |
|---|---|---|
| Window solar kept (134.6 against about 122.5) | **4.39** | Engine 1 run with kept solar matched |
| The 10 % of transmitted solar Engine 1 puts on the air node | 0.65 | Engine 1 run with the convective fraction at 0 |
| **Remainder** | **0.95** (+10 % of 9.33) | not attributed |

**BESTEST** shows the same pattern, from `01_attribution.json`, `bestest`:

- Engine 1 transmits 10.56 MWh; EnergyPlus transmits 9.69.
- EnergyPlus with all of Engine 1's simplifications gives 900: 2.018 / 2.276 and 600: 4.162 / 4.858.
- Engine 1 gives 900: 2.186 / 2.755 and 600: 4.547 / 5.628.
- So Engine 1's cooling is higher by 21 % on 900 and 16 % on 600, with more sun kept.

## Corrections to Brief 103's record

1. **103 named the slabs as the probable cause. They are not the main one.** Removing them from the referee moves
   cooling by 1 MWh. The 6.6 MWh figure was a perturbation no building has.
2. **103 said the window solar agreed "to about 2 %".** That compared Engine 1's admitted solar with EnergyPlus's
   transmitted plus inward glass solar. It missed the 9.4 MWh that EnergyPlus loses back out through the windows.
   The like-for-like figure is about 10 %.
3. **103 said the Bridgewater referee uses FullInteriorAndExterior.** It uses FullExterior (Part 0). Both put the
   beam on the floor, so the conclusion stood.

## What changes (proposed; Part 1b and Part 5)

1. **Engine 1's window solar (Part 1b, added to the brief).** Replace "g × F_W, all kept" with the window's own
   optics, as published, not fitted:
   - Split SHGC into transmittance and inward-flowing absorbed solar by EnergyPlus's documented SimpleGlazingSystem
     method (Engineering Reference, "Simple Window Model").
   - Use angle-dependent transmittance for the beam.
   - Let diffuse solar that falls on a window from inside leave through it, at the window's diffuse transmittance.
   - Re-measure Table 3 with no overrides. The solar convective fraction (ISO Annex B 0.1) is left as is and
     recorded.
2. **The referee carries the document's internal mass (Part 5).** Gate (b)'s "same building" now includes the
   document's 250 kJ/m²K. In 103's five-zone referee that moves cooling from 13.65 to 12.85 (103 P5 `mass_250`).
   This moves the referee *away* from Engine 1, which is one check that it is alignment and not tuning.
3. **Remainder: 0.95 MWh.** Re-measured after item 1. If it stays above 10 % it is instrumented further. Candidates:
   - window conduction with absorbed solar;
   - the ground floor's inside absorptance;
   - the time scheme.
