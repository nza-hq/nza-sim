# Brief 120 Part 4: a real project with its boiler capped

16 Nov 2026. `scripts/120_example.mts`, results [`04_example.json`](04_example.json).

**Building.** The 16 Nov worked example: a 684 m² community centre, run B (heating hours with setbacks, design heat loss at the weather's 99.6 % temperature, VRF cooling outputs). Plan from `docs/examples/community_centre.plan.json` on `chris/example-model`. Its "Gas boiler 1" (70 °C flow) heats the café, kitchen, WCs and main hall through radiators.

**Weather.** Yeovilton (the anchor EPW, sha c6571102…cf2), not the example's London Gatwick, which is not redistributable and not in this container. Absolute numbers differ from the example report for that reason.

**Cases.** The boiler uncapped (1,000 kW), then at 100 %, 75 % and 50 % of its rooms' design heat loss (15.8 kW, read from the run's own design line, `design_heat_loss.systems`).

| Boiler | Hours short | Peak ask | Lowest flow | Year's heating, building | Boiler gas | Unmet hours (system short / own): café, kitchen, WCs, hall |
|---|---|---|---|---|---|---|
| uncapped | 0 | 30.0 kW | 70 °C | 14,112 kWh | 11,990 kWh | 54 (0/54), 564 (0/564), 179 (0/179), 133 (0/133) |
| 15.8 kW (design) | 398 | 30.1 kW | 48.1 °C | 13,909 kWh | 11,750 kWh | 140 (140/0), 673 (434/239), 295 (188/107), 246 (246/0) |
| 11.9 kW (75 %) | 551 | 30.2 kW | 41.6 °C | 13,727 kWh | 11,534 kWh | 204 (204/0), 778 (586/192), 387 (279/108), 353 (353/0) |
| 7.9 kW (50 %) | 875 | 30.5 kW | 34.0 °C | 13,299 kWh | 11,021 kWh | 385 (385/0), 960 (869/91), 589 (481/108), 559 (559/0) |

## What it shows

1. **A boiler sized to the design heat loss is short in the mornings.** The rooms are set back overnight, and at the start of the day they ask for 30 kW, nearly twice the 15.8 kW design loss. The boiler at 15.8 kW is short for about 400 hours, almost all of them warm-ups. That is the usual reason heating plant is sized above the steady design loss (the brief's warm-up margin, MIS 3005-D's optional W/m²), now visible per hour.
2. **The year's heat barely moves.** Halving the boiler to 7.9 kW takes the year's heating down only 5.8 % (14,112 to 13,299 kWh). The rooms are colder for longer and catch up later; the boiler still delivers most of the year's heat. This answers Linzie's question (18:42) of whether a boiler can give a building that much heat over a year: the size limit shows up as cold hours, not as a large drop in annual energy.
3. **The split tells you what to fix.** The café and hall are only ever short because of the boiler (own 0). The kitchen is short on its own radiators too (239 hours at design, the 108 finding from the example report), so a bigger boiler alone would not fix it.
4. **"Short kWh" is not energy saved.** The plant's `short_kwh` sums, over its short hours, what the rooms asked at their setpoints and did not get: 4,151 kWh at design size, against a 203 kWh fall in the year's heating. A room left cold asks again the next hour. It measures how short the boiler was, not what a bigger boiler would burn. The panel (editor's P6) should say so. The year-on-year difference needs two runs, as here.

## Bridgewater

Five storeys with radiators on the heat pump (50/40 °C) and the heat pump capped at 30 kW (seam test `Brief 120 P3`): 3,825 hours short, each storey's unmet hours split, and the design line against 30 kW. Run time 1.3 s, against 1.7 s uncapped. Bridgewater as stored states no capacity, so the anchor and the 107 gate do not move.

## Window test

Brief P4 asks for the "windows open" office once Brief 115 lands. Until then, P2's EnergyPlus case is the check (`02_referee.md`).
