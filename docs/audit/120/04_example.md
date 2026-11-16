# Brief 120 Part 4: a real project with its boiler capped

16 Nov 2026. `scripts/120_example.mts`, results [`04_example.json`](04_example.json).

**Building.** The 16 Nov worked example: a 684 m² community centre, run B (heating hours with setbacks, design heat loss at the weather's 99.6 % temperature, VRF cooling outputs). Plan from `docs/examples/community_centre.plan.json` on `chris/example-model`. Its "Gas boiler 1" (70 °C flow) heats the café, kitchen, WCs and main hall through radiators.

**Weather.** Yeovilton (the anchor EPW, sha c6571102…cf2), not the example's London Gatwick, which is not redistributable and not in this container. Absolute numbers differ from the example report for that reason.

**Cases.** The boiler uncapped (1,000 kW), then at 100 %, 75 % and 50 % of its rooms' design heat loss (15.8 kW, read from the run's own design line, `design_heat_loss.systems`).

| Boiler | Hours short | Lowest flow | Year's heating, building | Boiler gas | Unmet hours (system only / both / own): café, kitchen, WCs, hall |
|---|---|---|---|---|---|
| uncapped | 0 | 70 °C | 14,112 kWh | 11,990 kWh | 54 (0/0/54), 564 (0/0/564), 179 (0/0/179), 133 (0/0/133) |
| 15.8 kW (design) | 398 | 48.1 °C | 13,909 kWh | 11,750 kWh | 140 (0/140/0), 673 (0/434/239), 295 (0/188/107), 246 (0/246/0) |
| 11.9 kW (75 %) | 551 | 41.6 °C | 13,727 kWh | 11,534 kWh | 204 (0/204/0), 778 (0/586/192), 387 (0/279/108), 353 (0/353/0) |
| 7.9 kW (50 %) | 875 | 34.0 °C | 13,299 kWh | 11,021 kWh | 385 (0/385/0), 960 (0/869/91), 589 (0/481/108), 559 (0/559/0) |

The peak ask column was removed (editor's finding, 16 Nov): a capped run's ask includes cold rooms asking for their whole recovery in one step, so it is not a sizing figure. The uncapped run's peak heating, 30 kW, is the real peak. Unmet hours split three ways (review F3): **system only** (the boiler held the room, and its own radiators were not at their limit), **both** (the boiler held it, and the room's own radiators were at their limit in its ask too), **own** (only the room's radiators). Re-run 16 Nov after review F1 and F3; the year's numbers did not move, since the boiler is the only heating system in these rooms.

## What it shows

1. **A boiler sized to the design heat loss is short in the mornings.** The rooms are set back overnight, and at the start of the day they ask for 30 kW, nearly twice the 15.8 kW design loss. The boiler at 15.8 kW is short for about 400 hours, almost all of them warm-ups. That is the usual reason heating plant is sized above the steady design loss (the brief's warm-up margin, MIS 3005-D's optional W/m²), now visible per hour.
2. **The year's heat barely moves.** Halving the boiler to 7.9 kW takes the year's heating down only 5.8 % (14,112 to 13,299 kWh). The rooms are colder for longer and catch up later; the boiler still delivers most of the year's heat. This answers Linzie's question (18:42) of whether a boiler can give a building that much heat over a year: the size limit shows up as cold hours, not as a large drop in annual energy.
3. **The split tells you what to fix (corrected at review F3).** The first version said the café and hall were short only because of the boiler. That was wrong: uncapped, their own radiators already leave them short 54 and 133 hours, and the old two-way split relabelled those hours. Split three ways, every hour the boiler holds a room is also an hour its radiators are at their limit in a morning warm-up ("both"), in every room: a bigger boiler would help, and so would bigger radiators. The kitchen has hours short on its own radiators alone too (239 at design size, the 108 finding from the example report).
4. **The shortfall is shown in hours, not kWh (review F4).** The engine's sum of what the rooms asked and did not get over the short hours (4,151 at design size, against a 203 kWh fall in the year's heating) counts a cold room's deficit again every hour until it recovers. It is not an energy, so it is renamed `asked_not_given_step_sum_kwh` in the engine and left out of the summary. The hours short and the peak ask against the capacity are shown; a year's difference needs two runs, as here.

## Bridgewater

Five storeys with radiators on the heat pump (50/40 °C) beside its gas boiler, the heat pump capped at 30 kW (seam test `Brief 120 P3`). Under the first rule (each system holds its own share) the rooms were short 3,825 hours. Under top-up (review F1, Linzie 19:48) the heat pump is short 3,042 hours and the boiler covers what it cannot: no room is short because of a system, the rooms' heating is the uncapped run's, and the heat pump's energy is what it gave (`PlantResults.zones`). Run time 1.3 s, against 1.8 s uncapped. Bridgewater as stored states no capacity, so the anchor and the 107 gate do not move.

## Window test

Brief P4 asks for the "windows open" office once Brief 115 lands. Until then, P2's EnergyPlus case is the check (`02_referee.md`).
