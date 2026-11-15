# Brief 104 Part 1b: window solar from the window's own optics

**Answer.** On the same building with the same simplifications, Engine 1 now agrees with EnergyPlus to within
1 % on heating and 2 % on cooling (Bridgewater, 21–24 °C band). Before this part the cooling figure was 64 % higher
(15.32 against 9.33 MWh). Four published methods closed the gap. Nothing was fitted:

1. **The window's own optics.** EnergyPlus's Simple Window Model gives transmittance and absorptance from U and
   SHGC. It replaces ISO 52016-1's g × F_W.
2. **The same method's angular curves.** The beam is transmitted and absorbed at its own angle of incidence; diffuse
   uses the hemispherical average.
3. **Perez sky.** This is ISO 52010-1's own sky model, and EnergyPlus's. It replaces the isotropic sky inherited from
   today's engine.
4. **Inside solar absorptance as a document input** (schema 2.2). Solar inside the zone is shared over the surfaces
   by area × absorptance. What reaches a window from inside partly leaves through it.

The referee was also brought into line with the document in one respect: its frame is represented the way the
document states it (below).

**What this does not close.** Engine 1 has one zone and no floor slabs. The real Bridgewater referee has five zones
and four slabs. Against that referee Engine 1 is now 4 % higher on heating and 18 % *lower* on cooling. EnergyPlus
itself shows the same difference between those two buildings (Table 4), so it is the building, not the engine. That is
what Part 5 (five zones) has to close.

Scripts:

- [`validation/energyplus/104_attribution.py`](../../../validation/energyplus/104_attribution.py), new flags
  `frame_split`, `docmass` and `inside_alpha_NN`, runs in [`01_attribution.json`](01_attribution.json);
- [`104_superposition.py`](../../../validation/energyplus/104_superposition.py) `--base e1_like_r1_ts4`, with
  [`scripts/104_superposition.mts`](../../../scripts/104_superposition.mts).

EnergyPlus 25.2.0 and the anchor EPW throughout.

## What changed in Engine 1

| Change | Where | Source |
|---|---|---|
| Normal-incidence T, A, R from U and SHGC | `glazing.ts` `simpleGlazingOptics` | Arasteh, Kohler and Griffith, LBNL-2804E (2009); EnergyPlus Engineering Reference "Simple Window Model". Reproduces EnergyPlus's EIO for the Bridgewater window (test). |
| T(θ) and R(θ) by curves A–J and the 28-cell U × SHGC map; diffuse values by EnergyPlus's 10° average | `glazing.ts` `simpleGlazingAngular` | The same paper; coefficients and map as EnergyPlus 25.2.0 holds them (`WindowManager.cc`, `TransAndReflAtPhi`, `DiffuseAverage`). |
| Window solar, `glazing_solar: 'optical'`: the beam at T(θ), sky and ground diffuse at T_dif, pane absorbs A(θ) / A_dif (the window network splits it inward and outward), no F_W | `model.ts` | as above |
| Perez anisotropic sky, `solar.sky: 'perez'` | `solar.ts` | Perez et al. (1990), as ISO 52010-1 specifies; coefficients, air mass and the 85° cap as EnergyPlus 25.2.0 (`SolarShading.cc`, `AnisoSkyViewFactors`). |
| Inside solar shared by area × absorptance (windows: T_dif + A_dif). The floor's sun patch reflects (1 − α). Solar leaving through windows is the breakdown line `solar_lost_through_glazing`. The pane's share is `glazing_solar_absorbed`. | `zone.ts` | The sum of the reflections. It is the same rule EnergyPlus uses for interior diffuse (ISABSF). |
| `inside_solar_absorptance` on every opaque surface, **schema 2.2**. The 2.0 and 2.1 upgrades fill 0.7. | `schema/model.ts`, `upgrade.ts`, `fromBuildingConfig.ts` | 0.7 is what today's EnergyPlus path uses. `nza_engine/generators/epjson_assembler.py` states no inside-layer absorptance, so EnergyPlus's Material default applies. Today's instant engine has no such input. |
| `RunOptions.solar_convective_fraction` (absent: ISO Annex B's 0.1) | `model.ts`, `zone.ts` | EnergyPlus gives no transmitted solar straight to the air. |
| `REFEREE_OPTIONS` adds `glazing_solar: 'optical'`, `solar.sky: 'perez'`, `solar_convective_fraction: 0` | `model.ts` | Both referees use the Simple Window Model or a window that it represents (Part 0, 103 P6), the Perez sky and no solar to the air. These are the referee's conventions, as the beam on the floor already was. |

**The default run options are unchanged.** That means g × F_W, the isotropic sky and 0.1 to the air. Only the inside
absorptance (a document input) applies everywhere. Today's tool is untouched: no file under `frontend/src/utils/`
or `nza_engine/` changed.

## The referee, aligned to the document

| Run (EnergyPlus, five zones, four slabs) | Heating | Cooling | Change |
|---|---|---|---|
| r0, the 103 referee | 90.46 | 13.65 | |
| `frame_split` | 90.13 | 13.65 | The 103 referee spread the frame as SHGC 0.441 = g 0.55 × 0.8 over the whole opening. The document says glass on 80 % at g 0.55 and frame on 20 %. Split, each window becomes a glass sub-window (SHGC 0.55, U 1.4) and a frame sub-window (U 1.4, no solar). Transmitted solar 103.4 → 110.8 MWh, because the angular curve for SHGC 0.55 is E, not the E/J mix for 0.441. |
| `docmass` | 89.65 | 12.85 | the document's 250 kJ/m²K internal heat capacity, which the 103 referee lacked (Part 1) |
| **r1 = both** | **89.35** | **12.88** | the referee Part 5 starts from |

Both alignments move the referee *away* from Engine 1's old 15.32. That is one sign they are alignments and not
tuning.

## Table 1: the same building, the same simplifications (the comparison that tests the engine)

EnergyPlus run `e1_like_r1_ts4` is:

- the document's frame;
- one zone, no slabs, the document's mass;
- Engine 1's four ISO simplifications: fixed sky, area-weighted long-wave, ISO convection with h_ce 20;
- at EnergyPlus's own 4 steps an hour. The 1 h step measures EnergyPlus's scheme, not Engine 1's (Part 1).

The shared input, inside solar absorptance, is swept in **both** engines. Agreement has to hold at every value, not
only at one.

| Inside absorptance | EnergyPlus heating | Engine 1 heating | Δ | EnergyPlus cooling | Engine 1 cooling | Δ |
|---|---|---|---|---|---|---|
| 0.5 | 94.97 | 94.62 | −0.4 % | 9.26 | 9.31 | +0.5 % |
| **0.7** (the document's) | **93.50** | **92.90** | **−0.6 %** | **10.34** | **10.56** | **+2.1 %** |
| 0.99 | 92.42 | 91.58 | −0.9 % | 11.18 | 11.60 | +3.8 % |

At 0.7, before this part, Engine 1 gave 90.27 / 15.05 (103's options, with the inside absorptance in place).

## Table 2: Engine 1, each new piece taken out of `REFEREE_OPTIONS` in turn (Bridgewater, 21–24 °C, MWh)

| Engine 1 run | Heating | Cooling | Transmitted | Lost back out |
|---|---|---|---|---|
| **`REFEREE_OPTIONS` now** (optical windows, Perez sky, no solar to air) | **92.90** | **10.56** | **110.43** | **6.28** |
| … with g × F_W windows | 89.38 | 14.18 | 136.01 | 0 |
| … with the isotropic sky | 94.41 | 10.56 | 109.26 | 6.19 |
| … with 0.1 of transmitted solar to the air | 91.95 | 11.40 | 110.43 | 5.65 |
| 103's options (all three taken out) | 90.27 | 15.05 | 134.57 | 0 |

- The windows are the piece that matters for cooling: −3.6 MWh.
- Transmitted solar is now 110.43 MWh in Engine 1 against 110.44 in EnergyPlus (`e1_like_r1_ts4`, Surface Window
  Transmitted Solar Radiation Energy).
- The Perez sky moves heating by −1.5 MWh and cooling by nothing to two decimals.

## Table 3: the constant-setpoint decomposition, again

Both engines are held at 22 °C. Drivers are switched off one at a time, identically in both. MWh net (cooling −
heating).

| Run | Engine 1 | EnergyPlus | Engine 1 − EnergyPlus (Part 1 → now) |
|---|---|---|---|
| all drivers | −84.11 | −85.22 | +13.40 → **+1.11** |
| no window solar | −193.15 | −193.29 | +2.57 → +0.14 |
| no opaque solar | −91.95 | −97.65 | +18.36 → +5.70 |
| no sun at all | −200.99 | −205.72 | +7.51 → +4.73 |

- **Window solar's effect on the load** is now 109.0 MWh in Engine 1 against 108.1 in EnergyPlus. In Part 1 the
  difference was +10.8; it is now +0.97.
- **July by hour,** Engine 1 − EnergyPlus: within ±1.2 kW between 08:00 and 20:00. In Part 1 it peaked at +7.5 kW.
- **Two terms remain, and they mostly cancel in the annual total:**
  - with no sun, Engine 1 needs 4.7 MWh less heating;
  - opaque solar counts 4.6 MWh less in Engine 1.
  
  They are individually about 5 % of heating. They are carried into Part 5's instrumentation (see Open).

## Table 4: against the real referee

| | Heating | Cooling |
|---|---|---|
| Referee r1 (five zones, four slabs, document frame and mass) | 89.35 | 12.88 |
| EnergyPlus with Engine 1's building: one zone, no slabs (`e1_building_r1`) | 89.30 | 10.04 |
| Engine 1 (`REFEREE_OPTIONS`) | 92.90 (+4.0 %) | 10.56 (−18 %) |

- **EnergyPlus loses 2.84 MWh of cooling when the building is one zone without slabs.** Engine 1 sits 0.5 MWh above
  that building. So the miss against r1 is the building Engine 1 cannot yet describe. Brief 104 Part 5 gives it the
  five zones and slabs.
- **Engine 1 is 4 % above `e1_building_r1` on heating and 5 % on cooling.** EnergyPlus's own physics (DOE-2/TARP
  convection, its sky, exact long-wave) is the difference. These are 103 P6b's ISO simplifications, still open.
- **The 103 gate (b) "+12 %" was a coincidence of three errors.** Engine 1 kept 22 % too much window solar. It lacked
  the slabs. The referee lacked the mass. None of them is there now.

## BESTEST, re-recorded

`REFEREE_OPTIONS` changed, so BESTEST moves. Interior absorptance is 0.6 in both, per the specification. MWh.

| Case | Engine 1 103 | Engine 1 now | EnergyPlus, same ISO simplifications and simple window (`all_three`) | ASHRAE 140 range |
|---|---|---|---|---|
| 600 heating | 4.547 | **4.574** (−2.3 %) | 4.683 | 3.993–4.504 (above) |
| 600 cooling | 5.628 | **5.510** (−0.5 %) | 5.540 | 5.432–6.162 (**in**) |
| 900 heating | 2.186 | **2.048** (−1.6 %) | 2.082 | 1.379–1.814 (above) |
| 900 cooling | 2.755 | **2.424** (+2.3 %) | 2.370 | 2.267–2.714 (**in**) |

- **Cooling is now in range for both cases.** In 103, 900 cooling was above the range.
- **Heating stays above the range.** EnergyPlus is above it too when it has the same ISO simplifications. With its
  own convection it is in range (600 4.289, 900 1.652). That is the open convection item from 103, not window solar.
- **Without the Perez sky, BESTEST transmitted 9.11 MWh against EnergyPlus's 9.69** (Denver is clear and high, so
  circumsolar matters). With it, cooling moved from 5.013 to 5.510 on 600.

## Remainder from Part 1, reported again

| Part 1 term | Then | Now |
|---|---|---|
| Window solar kept (constant 22 °C) | +10.8 MWh | +0.97 |
| Solar convective fraction | 0.65 MWh of cooling | 0 under the referee's convention (recorded as an option, 0.1 by default) |
| Remainder, e1_like → Engine 1 | 0.95 MWh (+10 %) | +0.22 MWh (+2.1 %) against `e1_like_r1_ts4` |

## Open, carried to Part 5

1. **The no-sun term (+4.7 MWh, less heating in Engine 1) and the opaque-solar term (−4.6 MWh).** Candidates:
   - air heat capacity (Engine 1 0.33 Wh/m³K; EnergyPlus uses outdoor density, review finding 6);
   - outside surface balance with h_ce 20 against EnergyPlus's handling of the same;
   - ground.
   They cancel in the annual total here, but would not in every building.
2. **ISO simplifications against EnergyPlus's own physics:** +4 % heating, +5 % cooling on one zone (103 P6b,
   unchanged).
3. **Not checked against EnergyPlus output directly:**
   - Engine 1's Perez irradiance per surface (only through the totals: transmitted solar 110.43 against 110.44);
   - the diffuse window properties (EnergyPlus does not report them in the EIO).
