# Brief 127: the results explorer (layer any hourly dataset)

Linzie, 18 Nov 2026 12:34: "What layers of visualisation can we build in at each stage, other than Sankey diagrams? ... I'm really interested in visualising load shapes just because it helps me see if the tool is working."
Linzie, 19 Nov 2026 00:30: "if we want to view specific things like airflow or internal room temperatures, heat gains from occupancy, this is one thing IES did really well. You could check and layer lots of different data points ... at the space level ... a wall or window or group of windows."

Plan page (18–19 Nov): https://claude.ai/artifact/39XRDnugLYCShBYXxRfiHF (source `/mnt/project-files/nza-sim/viz/`). This brief is piece 1 of its build order.

## Scope (CLAUDE.md process rule 10)

This brief covers results display in Simulate v2's Model workspace only (`frontend/src/sim2/run`). It adds no physics and changes no engine number. It gathers hourly arrays that the engine (`thermal/engine`) and the systems engine already produce, and draws them.
- Building module: not touched.
- Systems module: read only. `energyOf` hands back the systems engine's own result, so no second run is made.
- Today's pages: not touched.

## BEFORE DOING ANYTHING

1. Read CLAUDE.md (Rules 2, 9 and 11), STATUS.md, and this brief.
2. Work off `main` after PRs #71, #72 and #73, on branch `sim2/127-results-explorer`.
3. Use the extended school example with Yeovilton TMYx. Never commit an EPW.

## Parts

### P1: the dataset catalogue
- **Files:** `frontend/src/sim2/run/series.ts` (new), `seam.ts`, `worker.ts`, `client.ts`, `ResultsPanel.tsx`.
- `seriesCatalogue(doc, results, weather, setpointHours, systems)` gives every hourly dataset as `{ id, scope, owner, label, unit, agg, from, values: Float32Array }`. It also gives the calendar, with days numbered from Monday as the engine's own calendar numbers them.
- **Weather:** outdoor temperature, global horizontal sun, wind, humidity.
- **Building:**
  - heating and cooling demand (`readBuildingHourlyW`)
  - each fuel and each end use (summed as Energy used sums them)
- **Systems:**
  - fuel drawn (`fuel_w`)
  - heat or cooling given to rooms (the capacity check's `given_w`)
  - pumps
- **Rooms:**
  - heating and cooling
  - air, operative and radiant temperature
  - heat from other rooms
  - heating and cooling setpoints, and hours in use (`zoneSetpointHours`)
  - air in and windows open, under weather-driven air
  - each capacity system's share
  - the room's fans and small power lines
- `Summary.series` is filled only when the run asks (`series: true`). The shown run asks; previewed changes do not. The Pop Out channel drops it.
- **Verify:** `__tests__/series.test.ts` checks that each series sums back to the figure the summary already shows. That covers each room's heating and cooling, building heating, every fuel and end use, every system's fuel kWh and every plant's delivered kWh. It also checks that temperatures and weather equal the engine's arrays.

### P2: the Explore tab
- **Files:** `frontend/src/sim2/run/Explore.tsx` (new), `EmbeddedResults.tsx`, `workspace/layout.ts`, `geometry/GeometryLab.tsx` (one prop), `run.css`.
- **Pick (left):** a room, then weather, whole building and each system. Up to 8 datasets are layered at once, each in a fixed colour from a palette that has been checked for colour blindness. Hovering a dataset says where its numbers come from.
- **Views:**
  - **Lines:** day, week, month or year. There is one panel per unit, and all panels share one time axis, so a chart never has two y-scales.
  - **Carpet:** day × hour.
  - **Typical day:** by month and weekday, Saturday or Sunday.
  - **Against outdoor:** by the day or by the hour.
  - **Monthly:** kWh for loads; the monthly mean for temperatures.
  - **Duration:** the year's hours sorted from highest to lowest.
- The room chosen on the left (`focusZone`) sets the defaults: that room's operative temperature, heating and cooling, plus outdoor temperature. With no room chosen, the defaults are each fuel plus outdoor temperature.
- **Verify:** at 1440×900, open the school example and load the weather on Site. On Systems, open Explore, then try every view and choose the Kitchen.

### P3: docs
- Add a STATUS.md entry and mark this brief done.

## Next pieces (not this brief)
2. A page for each system: heating against cooling, a duration curve against capacity, served against drawn.
3. A room heat map on the plan, across the steps.
4. Engine outputs for the "why" layer:
   - the heat balance by hour, per room and per surface (walls, windows, window groups by facade), which unlocks element-level layering
   - system energy by room for every system
   - EnergyPlus hourly read-back
5. Part-load efficiency (COP against outdoor temperature), then meters on the Check step.
