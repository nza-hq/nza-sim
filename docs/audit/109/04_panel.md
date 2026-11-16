# Brief 109 Part 4: the heating hours panel

16 Nov 2026. Each zone's heating hours are now in the run summary, and a separate panel shows them. The editor places the panel with one line: `<HeatingHours summary={summary} />`.

## The summary (`sim2/run/seam.ts`)

`summary.zones[i].hours` is set for a zone that is heated to hours and null for any other zone:

- `setpoint_c` and `setback_c`;
- `in_use_hours`;
- `unmet_in_use_hours`: hours in use more than 0.5 °C (`UNMET_K`) below that hour's setpoint, the engine's own count (Rule 11);
- `min_in_use_c`: the lowest air temperature in use;
- `morning_peak` and `steady_peak` ({w, hour}). The morning peak is the largest heating at the first in-use hour of a day. The steady peak is the largest at any other in-use hour. When heating is at its limit, many hours tie, and the first one is shown;
- `recovery` ({mornings, median_h, not_reached}). A cold morning is a day whose hours start with the room more than 0.5 °C below its setpoint, taken from the coldest quarter of days by mean outdoor temperature. The median counts whole hours until the room is within 0.5 °C, and not_reached counts the mornings that never get there that day.

The seam also explains a refused setback in words, naming the zone and what to choose, and names the two new underfloor fields ("the floor its pipes are in", "the layer its pipes run along").

## The panel (`sim2/run/HeatingHours.tsx`)

Per zone it shows four things:

- a head, either "N h below" or "holds its setpoint";
- the hours in use, the hours below and the lowest temperature;
- the two peaks, each with its day and hour;
- the time back on a cold morning.

The panel title carries the one word *estimate*, and the basis sits behind ⓘ. It renders nothing when no zone is heated to hours.

## Browser check

Bridgewater, five storeys, run through the seam with office hours and a 16 °C setback. Storeys 4 and 5 have a 40 kW electric limit each. The panel was rendered in the results panel's frame at 1440×900, with 0 console errors (`04_panel.png`):

| storey | head | lowest in use | morning peak | steady peak | cold morning |
|---|---|---|---|---|---|
| 1 | holds its setpoint | 21.0 °C | 328.4 kW (Mon 22 Jan, 07:00) | 30.3 kW (Mon 22 Jan, 08:00) | back in the first hour |
| 2 | holds its setpoint | 21.0 °C | 292.8 kW | 26.6 kW | back in the first hour |
| 3 | holds its setpoint | 21.0 °C | 284.3 kW | 25.9 kW | back in the first hour |
| 4 | 141 h below | 17.1 °C | 40.0 kW (at its limit) | 40.0 kW | 3 hours |
| 5 | 270 h below | 16.4 °C | 40.0 kW (at its limit) | 40.0 kW | 5 hours; 1 of 27 mornings not back that day |

Every zone is in use for 3,132 hours a year. The panel's figures are the summary's, unrounded except for display.

## Tests

- `seam.test.ts`: the hours summary agrees with the engine's own counts, and a setback is refused in words.
- `heatingHours.test.tsx` (4 tests): nothing is shown without hours; the engine calendar is used (1 Jan is a Monday); a zone that holds its setpoint; a zone that falls short, including mornings that never get back.
