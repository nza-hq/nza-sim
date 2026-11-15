# Brief 103 Part 5: the EnergyPlus fabric-only referee

**Result:** on the same building Engine 1 reads, EnergyPlus gives **90.46 MWh heating and 13.65 MWh cooling** a year
(zone sensible, flat 21 / 24 °C). This replaces Run Bi (68.7 / 34.8) as the gate (b) reference. Run Bi was not the
same building: five of its inputs differed from the model document. Each one's effect is measured below, one change
at a time. Together they move heating by −21.8 MWh and cooling by +20.2 MWh. The window frame is the largest.

- Driver: [`validation/energyplus/103_referee.py`](../../../validation/energyplus/103_referee.py).
- Record: [`validation/energyplus/results/103_referee_fabric_only.json`](../../../validation/energyplus/results/103_referee_fabric_only.json).
- `nza_engine/` is unchanged. The driver calls `assemble_epjson` as it is and edits only the returned epJSON dict.

## Set-up

| | |
|---|---|
| EnergyPlus | 25.2.0-cf7368216c (Linux build of the same release as IT15's) |
| Fixture | `validation/fixtures/report_baseline_v1.yaml`, sha256 `c0b0bc87…` (full hash in the JSON) |
| Weather | Yeovilton TMYx 2011–2025, sha256 `c6571102…cf2` |
| Model | `assemble_epjson(mode="full", systems_config={"mode": "ideal_loads"})`: 5 floor zones, IdealLoads, 4 timesteps per hour |
| Demand read | `Zone Ideal Loads Zone Sensible Heating / Cooling Energy`, summed over the 5 zones |

**Where it ran (a deviation from the brief).** The brief said IT15. It ran in this project's cloud container, with
the official Linux build of the same EnergyPlus release, so it needed nothing from Linzie's or Chris's machine. To show
the container gives IT15's answer, the `bi_repro` variant puts back all of Run Bi's inputs. It gives **68.69 MWh
heating and 34.84 MWh supply-air cooling**, against IT15's 68.7 / 34.8. The louvre loss is 12.79 MWh against
IT15's 12.79.

**Sensible, not supply-air total.** Run Bi read `Supply Air Total`, which includes latent cooling: IdealLoads cools its
supply to 13 °C and condenses moisture even with dehumidification off. Engine 1 has no moisture balance, so the referee
reads sensible demand. On r0 the two agree for heating (90.46) and differ by 0.78 MWh for cooling (13.65 sensible,
14.44 total).

## What the referee is, and the checks it prints

The referee takes every input from the model document Engine 1 reads. Physics that belongs to EnergyPlus stays as
EnergyPlus does it: convection and radiation, solar distribution, angle-dependent glazing, conduction transfer
functions, and the interior floor slabs.

| Input | Run Bi | Referee (r0) |
|---|---|---|
| Window frame | none: SHGC 0.55 over the whole opening | the document's `frame_fraction` 0.2 as Engine 1 reads it: whole-window U 1.4 over the opening, solar through the glass only, so SHGC = 0.55 × 0.8 = 0.44. No frame U is invented. |
| Ground | EnergyPlus default 18 °C | the document's `annual_mean_outdoor`: EPW mean dry bulb **11.258 °C**, all 12 months |
| Bridging (H_TB 278.08 W/K, ×3) | uniform ΔU over walls, roof and ground floor | per element (decision 6): roof 35.11 W/K (wall-to-roof); walls 242.97 W/K (intermediate floors 140.43, floor edge 70.21, corners 9.60, window perimeters 22.73); ground floor 0 |
| Wind and outdoor temperature at the zones | Building terrain "Urban": wind scaled to zone height, about 0.25–0.5 × EPW | the EPW values at every zone. `Site:WeatherStation` and `Site:HeightVariation` have exponent 0 and no temperature gradient. The document's louvre flow is Q = K·v on the EPW wind. |
| Outside solar absorptance | library layers' 0.7 (wall and roof) | the document's: wall 0.6, roof 0.7. Emissivity 0.9. |

Checks the driver prints for each variant. All pass on all eight.

- **Systems:** no system objects other than IdealLoads; IdealLoads in 5 of 5 zones.
- **Gains deleted, not muted:** People, Lights, ElectricEquipment and operable openings are removed. Zone internal heating is 0.0 MWh.
- **Ventilation:** ZoneVentilation holds only the 5 permanent-louvre objects, at 0.0089833 m³/s per m/s each.
- **Thermostat:** a flat 21.0 / 24.0 °C. Infiltration is 0.06925 ach (q50 4.64 ÷ 20) on an always-1 schedule.
- **Bridging total:** Engine 1's junctions give 278.080 W/K, the same as the assembler's `_nza_thermal_bridging_H_TB` (278.080).
- **Bridging applied:** 278.080 W/K, at ISO 6946 films. Wall U goes from 0.140 to 0.283 and roof U from 0.150 to 0.192.
- **Run:** 0 severe and 0 fatal errors, 5 warnings. The warnings are sizing objects absent, ground temperature below 15 °C, detailed sky diffuse not needed, interzone slab layer order, and two unused output variables.

## Results

| Variant (one change from r0) | Heating MWh | Δ | Cooling MWh | Δ |
|---|---|---|---|---|
| **r0: the referee** | **90.46** | | **13.65** | |
| no frame (SHGC 0.55 on the opening) | 79.47 | −10.99 | 28.14 | +14.49 |
| Urban wind and temperature height scaling | 85.44 | −5.02 | 15.28 | +1.63 |
| ground 18 °C | 86.77 | −3.69 | 15.14 | +1.48 |
| uniform bridging (Run Bi's allocation) | 89.78 | −0.68 | 13.10 | −0.55 |
| library absorptance 0.7 on the walls | 89.85 | −0.61 | 14.13 | +0.47 |
| plus 250 kJ/m²K × floor area on each air node | 89.64 | −0.82 | 12.85 | −0.81 |
| **bi_repro: all five of Run Bi's inputs** | **68.69** | −21.77 | **33.81** (34.84 total) | +20.15 |

The five one-at-a-time effects sum to −21.0 MWh heating and +17.5 MWh cooling. The combined run gives −21.8 and +20.2.
They are close to additive. The remainder in cooling is the frame interacting with the wind and the ground: with more
solar, more hours sit above 24 °C.

Monthly r0 heating, Jan to Dec (MWh): 19.84, 14.61, 12.85, 3.55, 0.27, 0, 0, 0, 0.26, 6.10, 14.16, 18.83.
Cooling: 0, 0, 0, 0, 0.03, 3.44, 8.44, 1.73, 0.02, 0, 0, 0.

### Run Bi (uniform) against Part 5 (per element), by element

The allocation alone, uniform against per element with everything else at r0, moves heating by 0.68 MWh and cooling
by 0.55 MWh. These are annual net inside-face conduction losses, in MWh:

| Element | Uniform | Per element | Why |
|---|---|---|---|
| Walls | 33.03 | 42.12 | the walls now carry 242.97 of the 278.08 W/K, not their area share |
| Roof | 16.70 | 13.81 | only the wall-to-roof junction, 35.11 W/K, not an area share of all of it |
| Ground floor | 16.62 | 10.28 | no bridging on the floor; in the uniform case its share was driven by the ground temperature (11.3 °C) |

Total opaque conduction is 66.4 MWh uniform and 66.2 MWh per element, so the allocation moves loss between elements
more than it changes the total. The 6.3 MWh that leaves the floor is the bridging share that the uniform spread drove
from the 11.3 °C ground; per element, that conductance sees the outdoor air, as Engine 1's does. The hourly split of
the small net change between heating and cooling hours was not instrumented further.

## What this means for gate (b)

- Gate (b) now compares Engine 1 with **90.46 / 13.65 MWh**, ±10 %.
- Part 4's first look gave Engine 1 89.9 / 15.4: −0.6 % heating, +12.8 % cooling. That was not measured on the
  Part 6 set-up, so it is not a result yet. Part 6 measures it, term by term, and diagnoses any miss without tuning.
- Two structural differences remain, and are reported rather than closed:
  - **Zones and internal mass.** The referee has five stacked floor zones with 200 mm concrete slabs between them.
    Engine 1 has one zone, with 250 kJ/m²K per m² of floor on the air node. Adding that capacity to the referee's
    air nodes as well moves it by 0.8 MWh each way, so the representation is worth about 1 % of heating.
  - **Surface films.** EnergyPlus computes its own convection (DOE-2 outside, TARP inside) from local wind and
    surface temperatures. Engine 1 uses ISO 52016-1 fixed coefficients.

## Reproduce

```
python3 validation/energyplus/103_referee.py --energyplus <path to energyplus 25.2.0> [--variants r0,bi_repro]
```

Needs the anchor EPW at `data/weather/current/` (checked by sha). Runs take about 3 s each. Run folders go to a
temporary directory, and only the JSON is written into the repo.
