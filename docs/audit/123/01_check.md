# Brief 123 P3 — EnergyPlus beside NZA Sim on the two check buildings

Source: `scripts/123_energyplus.mts` (from `frontend/`), output [`01_check.json`](01_check.json). EnergyPlus 25.2.0 (Linux), 15-minute steps, about 4 s a run, 0 severe errors in all three. Weather: Bridgewater on Yeovilton TMYx (sha c657…8cf2, the anchor's); the community centre on London Gatwick IWEC (not committed). Nothing was tuned to agree.

| Run | Heating MWh, NZA Sim · EnergyPlus | Cooling MWh | Peak heating kW | Peak cooling kW | EUI kWh/m² |
|---|---|---|---|---|---|
| Bridgewater, five storeys | 114.5 · 126.7 (−9.6 %) | 62.7 · 56.6 (+10.8 %) | 96.5 · 103.5 | 101.7 · 98.1 | 131.9 · 132.5 |
| Community centre as drawn | 23.5 · 22.3 (+5.0 %) | 13.0 · 13.2 (−1.5 %) | 15.0 · 14.3 | 5.5 · 5.3 | 108.5 · 107.5 |
| Community centre, run B hours | 20.3 · 19.7 (+2.9 %) | 12.8 · 13.0 (−1.8 %) | 48.8 · 45.6 | 14.1 · 33.0 | 104.3 · 103.8 |

## Two fixes found by the first runs (the translator's, not the engine's)

1. **Permanent vents.** EnergyPlus's WindandStackOpenArea autocalculated effectiveness is a cross-flow figure; on Bridgewater's single-sided trickle vents it gave about twenty times the run's air. The translator now gives each vent the run's own coefficient (m³/s per m/s ÷ area), so the vent physics is the model's and EnergyPlus moves that air through its own zone balance.
2. **MVHR.** EnergyPlus's ideal-loads heat recovery bypasses itself whenever that helps, which halved Bridgewater's cooling. The model states no summer bypass, so MVHR is carried as outdoor air at flow × (1 − recovery) with no exchanger.

With these, Bridgewater's air terms agree within about 1 % (EnergyPlus infiltration 31.5, vents 18.7, mechanical outdoor air 311.9 MWh against the run's 29.7, 18.3, 310.5). The remaining heating gap is therefore not the air. Its cause is not established here (Rule 10). The cooling gap is in line with the +12 % cooling difference recorded in Brief 103.

## Open

- **Community centre B, peak cooling 14.1 kW · 33.0 kW.** EnergyPlus's peak is the open-plan office's first hour of cooling on 20 August (24.1 kW in the hour ending 08:00, uncapped split unit; cooling runs only in its hours from Brief 109). The office's annual cooling is 0.6 · 0.9 MWh. Not yet explained; next step is the office's hourly air and surface temperatures in both for that morning.
- Overhangs and fins are not carried, so shaded windows get more sun in EnergyPlus (named in the notes).
