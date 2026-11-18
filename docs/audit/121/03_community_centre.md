# Brief 121 P3: the community centre office on a setpoint profile

Gatwick IWEC weather (not committed), through the run seam, 4 steps an hour. Script: [`scripts/121_community_centre.mts`](../../../scripts/121_community_centre.mts). Results: [`03_community_centre.json`](03_community_centre.json).

| Office heating | Heating | Peak | Hours below setpoint in use |
|---|---|---|---|
| B: 21 °C in office hours, 16 °C set back (Brief 109's way) | 2,499 kWh | 8.53 kW | 171 |
| B as a profile | 2,499 kWh | 8.53 kW | 171 (identical) |
| IES-style profile: 21 °C from 06:00 (an hour's pre-heat), 19 °C for the last hour, 16 °C otherwise | 2,549 kWh | 8.52 kW | 85 |

The hour's pre-heat halves the cold hours at the start of the day, at a cost of 50 kWh a year (+2 %). The radiators are the same; the peak does not move, because the recovery now starts an hour earlier rather than harder.
