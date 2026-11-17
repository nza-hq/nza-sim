# Brief 121 P2: referee

No new EnergyPlus run. A setpoint profile reaches the engine as the same hourly setpoint array that Brief 109's hours and setback produce (`zoneSetpointHours` → `setpoint_hours`). That array was refereed against EnergyPlus `Schedule:Compact` setpoints in `docs/audit/109/02_referee.md`.

What ties the two:
- `setpointProfiles.test.ts` runs the Brief 104 cooled room at Denver in quarter hours. A heating profile that holds 20 °C in office hours and 15 °C outside them, and a cooling profile of 24 °C, give Brief 109's run hour for hour (to 1e-6 W) and its year to 1e-9 kWh.
- The community centre office gives the same tie on the product's path (`03_community_centre.md`, "B as a profile" equals "B" to the last digit).

A shaped profile uses no other code. Each hour's value is read back from the run in the test (Monday and Saturday), and its heating falls between the flat profiles at 19 °C and 21 °C.

Nothing was tuned. No engine figure moved: the Bridgewater digest is still `2da3e6b5…e58b` (`scripts/114_gate.mts`).
