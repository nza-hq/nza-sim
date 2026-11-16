# Brief 109 Part 4: the heating hours panel

16 Nov 2026. Each zone's heating hours are now in the run summary, and a separate panel shows them. The editor places the panel with one line: `<HeatingHours summary={summary} />`.

## The summary (`sim2/run/seam.ts`)

`summary.zones[i].hours` is set for a zone that is heated to hours and null for any other zone:

- `setpoint_c` and `setback_c`;
- `in_use_hours`;
- `unmet_in_use_hours`: hours in use more than 0.5 °C (`UNMET_K`) below that hour's setpoint, the engine's own count (Rule 11);
- `min_in_use_c`: the lowest control temperature in use (air, or operative under operative control);
- `morning_peak` and `later_peak` ({w, hour}), and `limited`. The morning peak is the largest heating at the first in-use hour of a day. The later peak is the largest at any other in-use hour of the same run; it is not the peak without the setback, which is the emitter sizing's (review F8). When heating is at its limit, many hours tie, and the first one is shown. For an unlimited zone the panel calls the first hour's figure "heat to recover in the first hour" (review F2);
- `recovery` ({mornings, median_h, not_reached}). Cold mornings are the coldest quarter, by mean outdoor temperature, of the days whose hours start with the room more than 0.5 °C below its setpoint. The median counts whole hours until the room is within 0.5 °C, and not_reached counts the mornings that never get there that day.

The seam also explains a refused setback in words, naming the zone and what to choose, and names the two new underfloor fields ("the floor its pipes are in", "the layer its pipes run along").

## The panel (`sim2/run/HeatingHours.tsx`)

Per zone it shows four things:

- a head, either "N h below" or "holds its setpoint";
- the hours in use, the hours below and the lowest temperature;
- the two peaks, each with its day and hour;
- the time back on a cold morning.

The panel title carries the one word *estimate*, and the basis sits behind ⓘ. It renders nothing when no zone is heated to hours.

## Browser check

Redone after the review (`06_review_response.md`) with `scripts/109_panel.mts`, which runs the product's seam on the anchor weather and writes `04_panel_summary.json`. The setup is Bridgewater's five storeys, office hours, a 16 °C setback, and storeys 4 and 5 limited to 40 kW each. Because a limited zone is heated to hours, the run is in quarter hours (review F3). Rendered in the results panel's frame at 1440×900 with 0 console errors (`04_panel.png`):

| storey | head | lowest in use | first in-use hour | later peak | cold morning |
|---|---|---|---|---|---|
| 1 | holds its setpoint | 21.0 °C | heat to recover 329.1 kW (Mon 22 Jan, 07:00) | 30.1 kW | back in the first hour |
| 2 | holds its setpoint | 21.0 °C | heat to recover 295.2 kW | 26.6 kW | back in the first hour |
| 3 | holds its setpoint | 21.0 °C | heat to recover 293.6 kW | 26.4 kW | back in the first hour |
| 4 | 149 h below | 16.7 °C | morning peak 40.0 kW (at its limit) | 40.0 kW | 3 hours |
| 5 | 262 h below | 16.3 °C | morning peak 40.0 kW (at its limit) | 40.0 kW | 4 hours; 1 of 28 mornings not back that day |

Every zone is in use for 3,132 hours a year. The emitters on storeys 4 and 5 are sized on the year without the setback: 17.9 kW and 22.5 kW needed against 40 kW, so the sizing says they are enough, and the hours below are the warm-up.

The first version of this check, before the review, ran at one step an hour and gave 141 h / 17.1 °C / 3 h and 270 h / 16.4 °C / 5 h. Its script was not kept, so it has been replaced by this one.

## Tests

- `seam.test.ts`: the hours summary agrees with the engine's own counts, and a setback is refused in words.
- `heatingHours.test.tsx` (4 tests): nothing is shown without hours; the engine calendar is used (1 Jan is a Monday); a zone that holds its setpoint; a zone that falls short, including mornings that never get back.
