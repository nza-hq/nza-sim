# Brief 108: final report (emitters per room)

**What it does.** Each zone can list its emitters, for example two radiators rated 500 W at 75/65/20 °C, or an electric heater. Heating systems state their design flow and return temperatures. Then:
- **A zone's heating is limited to what its emitters give.** Wet emitters are rated by EN 442 at their system's flow and return. Each hour they are rated at the room's temperature from the hour before, at their design water flow, so a colder room draws more (review F1, Linzie's decision of 15 Nov). When the emitters give less than the room needs, the room runs below its setpoint. The hours more than 0.5 °C below and the lowest temperature are reported, on Engines 1 and 2, every solver path.
- **Sizing.** For each zone the panel shows its peak need (a second run with the emitters unlimited), what the emitters give, the shortfall, and the rating at ΔT 50 that would cover the peak.
- **A what-if.** It runs the same rooms at a second flow and return pair, so a boiler-to-heat-pump switch shows which rooms fall short.
- **The emitters' radiant share.** It feeds the heat balance.

**Evidence:**
- **By hand** ([`02_capped.md`](02_capped.md), test (g)). The EN 442 rating, a capped zone's steady state, and a capped neighbour's extra heat, on both engines. Closure holds every hour.
- **Against EnergyPlus at a fixed limit** ([`03_referee.md`](03_referee.md)). Within the gate on the cooled room (heating −3.3 to −3.7 %, as uncapped) and on Bridgewater's capped top storey (+2.6 %, 388 against 345 hours below).
- **The radiant share** ([`08_radiant.md`](08_radiant.md)). Annual heat is within 3.4 % of EnergyPlus's radiant baseboard.
- **Hourly re-rating** ([`09_hotwater.md`](09_hotwater.md)). Checked against EnergyPlus's hot-water baseboard on a 50 °C loop: within the gate, and the coldest hour warms by +1.09 K over a fixed limit in both programs.
- **Sizing** ([`04_sizing.md`](04_sizing.md)). On Bridgewater, radiators sized for 70/60 give 45 % at 50/40. That leaves 2,501 storey-hours below the setpoint (2,845 before the hourly re-rating). Stating the rating the panel gives leaves none.
- **The panel** ([`05_panel.md`](05_panel.md)). Checked in the browser at 1440×900, and on the editor's branch (it places the component).
- **Independent review** ([`06`](06_independent_review.md)). No tuning. Every finding is fixed or stated ([`07`](07_review_response.md)). F1 was fixed by the hourly re-rating. F2's annual heat is refereed; its hours below are not (EnergyPlus's own radiant baseboard misses its setpoint when unlimited).
- **Tests and today's engine.** 228 thermal and sim2 tests pass, and the build is clean. With no emitters stated, Brief 107's gate is unchanged. No file of today's engine is touched; anchor 133.2 (`_brief93_anchor.mjs`, fixture `bridgewater_anchor_v2.yaml`).

**Open, carried forward:**
- **Hours below with a radiant share** are not refereed (F2). Nor is an exponent above 1 against a program (EnergyPlus has no EN 442 radiator); that is checked by hand.
- **The peak is the weather file's coldest hour**, not a BS EN 12831 design day (F4, stated on the panel).
- **A heat pump's efficiency does not change with flow temperature.** Nor do weather-compensated flow temperatures, pipework or cooling emitters. All are out of scope, as the brief says.
- **Setbacks** are refused until Brief 109.
- **Re-measure the 50-zone speed target with emitters on IT15.** An edit with a what-if is three runs.
