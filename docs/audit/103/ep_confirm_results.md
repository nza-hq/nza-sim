# EnergyPlus confirming runs: results (14 Nov 2026, IT15)

## Setup

- **EnergyPlus:** 25.2.0-cf7368216c, the official release zip (sha256 4136901f…f3cd matches GitHub's digest), installed at `C:\EnergyPlusV25-2-0`. `ENERGYPLUS_DIR` was set per process only.
- **Weather:** sha256 c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2.
- **Code and run folders:** worktree `C:\Users\ChrisScott\Dev\nza-sim-epcheck`, branch `chris/engine-convergence` at 622f437, with its own `data\`. Runs are in `data\simulations\epcheck\`.
- **Driver:** `C:\Users\ChrisScott\Dev\_epcheck_scratch\epcheck_driver.py`, outside the repo.
- **Fixture:** `report_baseline_v1.yaml`.
- Nothing was committed, and no database was touched.

## Results

| Run | Steps/h | Heating MWh | Cooling MWh | vs Run 0 (heat, cool) | Severe | Fatal |
|---|---|---|---|---|---|---|
| 0 | 4 | 107.2 | 88.3 | gate PASS | 0 | 0 |
| A | 1 | 102.2 | 85.7 | −4.63 %, −2.93 % | 0 | 0 |
| A | 6 | 108.8 | 87.8 | +1.53 %, −0.61 % | 0 | 0 |
| A | 10 | 110.5 | 87.1 | +3.10 %, −1.32 % | 0 | 0 |
| B | 4 | 45.9 | 60.5 | −57.2 %, −31.5 % | 0 | 0 |
| C (B + 1.054 GJ/K mass) | 4 | 45.8 | 61.5 | −57.3 %, −30.4 % | 0 | 0 |

## Caveats

1. **These are not IdealLoads.** `derive_systems_for_sim` returns mode "detailed", so every run (Run 0 included) models VRF. The figures are `get_building_summary`'s `annual_heating_kWh` / `annual_cooling_kWh` from the VRF model.
2. **Run B is not a true envelope-only run.**
   - People = 0, but Lights = 19.65 MWh and Electric Equipment = 39.56 MWh are still in the model.
   - The assembler writes default Lights at 2.0 W/m² and ElectricEquipment at 4.5 W/m² on the hotel_bedroom schedules when the profiles are empty.
   - Mech vent: none. There are no `_mechvent_` objects, terminal-unit outdoor-air flow is 0, and outdoor air is per person with 0 people.
   - Zone ventilation is the five permanent-vent louvres only: sensible loss 13.32 MWh, about 16 expected.
   - Infiltration, thermal bridging and the 21/24 band are still in.
3. **Timestep.** Heating has not settled at 10 steps/h (102.2 → 107.2 → 108.8 → 110.5). Cooling stays within 3 %. Heating moves by up to about 5 %, which is a "minor effect" under the spec's bands.
4. **Run C** splits the mass evenly over the five floor zones (522.8 m² of 0.2 m concrete each). Its effect is small: heating −0.3 % and cooling +1.6 % against Run B.

## Reading

- Run B cooling is 60.5 MWh. That is right on the "confirms" line (≤ 60), and it still carries about 59 MWh a year of lighting and equipment gains, so a clean envelope-only run would give lower cooling.
- Against State 1's 98.6 MWh it is already 39 % lower. So State 1's cooling is high.
- Run B heating (45.9) is not comparable to NZA's 76.0 while those gains offset heating.
- For a clean referee, rerun B with the Lights and ElectricEquipment objects deleted from the generated epJSON, ideally with IdealLoads in place of VRF.

---

# Clean reruns with IdealLoads (14 Nov 2026, about 23:50)

- **Same setup as above.** `simple = {**simple, "mode": "ideal_loads"}` was passed into `assemble_epjson`, with no repo edit.
- **HVAC objects.** The epJSON has `ZoneHVAC:IdealLoadsAirSystem` Floor_1–5, no VRF objects, and no outdoor-air specification on the IdealLoads.
- **Setpoints.** `hotel_heating_setpoint` is a flat 21.0 and `hotel_cooling_setpoint` a flat 24.0, all days, all year.
- **Where heating and cooling come from.** Zone Ideal Loads Supply Air Total Heating and Cooling Energy, summed over the 5 zones. The summary and a direct read agree within 0.01 MWh.

| Run | Steps/h | Heating MWh | Cooling MWh | Reference | Δ (heat, cool) | Severe | Fatal |
|---|---|---|---|---|---|---|---|
| 0i (full model) | 4 | 112.7 | 85.3 | Predicted NZA with bridging fixed: 102.7 / 92.4 | +9.7 %, −7.7 % | 0 | 0 |
| 0i | 1 | 114.5 | 80.5 | Run 0i | +1.6 %, −5.7 % (cooling fails the 3 % check) | 0 | 0 |
| 0i | 10 | 112.7 | 85.3 | Run 0i | +0.0 %, +0.0 % (pass) | 0 | 0 |
| Bi (envelope only) | 4 | 68.7 | 34.8 | — | — | 0 | 0 |
| Ci (Bi + 1.054 GJ/K mass) | 4 | 68.6 | 35.5 | Run Bi | −0.1 %, +2.0 % | 0 | 0 |

## Run Bi checks

- **Removed objects.** Lights Floor_1–5 and Equip Floor_1–5 were removed. Their schedules stay in place.
- **Internal gains.** People, Lights and Electric Equipment energy are all 0.00 MWh.
- **Ventilation.**
  - The only ZoneVentilation objects are the 5 natural permanent-vent louvres, at 0.0089833 m³/s each.
  - There is no mech vent.
  - Ventilation sensible loss is 12.79 MWh.
- **Kept in.** Infiltration and thermal bridging are still in.

## Reading

1. **Cooling: the finding holds.** EnergyPlus envelope-only cooling is 34.8 MWh, far under the 60 MWh threshold.
   - Today's State 1 gives 98.6, about 2.8 times EnergyPlus.
   - State 1 heating (129.2) is about 1.9 times EnergyPlus (68.7).
   - State 1 is not a usable gate.
2. **Today's dynamic engine with bridging fixed (76.0 / 41.9) against EnergyPlus envelope-only (68.7 / 34.8):** NZA is +10.6 % on heating and +20 % on cooling. It is close but not matched.
3. **Full model (Run 0i), predicted against EnergyPlus:** NZA 102.7 / 92.4 against EnergyPlus 112.7 / 85.3, so NZA is −8.9 % on heating and +8.3 % on cooling. That is about 9 %, not the "within about 5 %" predicted.
4. **Timestep.**
   - 4 and 10 steps per hour agree exactly with IdealLoads, so the earlier drift came from the VRF model.
   - Only 1 step per hour moves cooling, by −5.7 %.
   - The timestep is not the cause of the State 1 gap.
5. **Extra thermal mass** changes the envelope-only result by 2 % or less.
