# Brief 120: system (plant) capacity limits — final report

16 Nov 2026, branch `chris/120-plant-capacity` (112 merged in). Asked by Linzie, 16 Nov 18:42: "We need the capacity, not just of the heat emitters, but also of the system as well." Engine parts P0–P5 and P7 here; P6 (the panel) is the editor thread's.

## What was built

- **Schema 2.9.** `capacity_kw` on a heating or cooling system now limits it (before, "not modelled"). `dhw_priority_group_id`: a boiler that heats a hot water system first. `storage_litres` on a hot water system, with its `capacity_kw` as the water heater's output (Linzie 19:19). Older documents upgrade with nothing filled; capacity applies only where stated.
- **The limit (Engine 2).** Each step, a system that cannot give its rooms what they ask gives what it has. A boiler feeding radiators in every room shares through one lowered flow temperature, so bigger radiators keep more (P2b, as EnergyPlus does); other plants share in proportion to ask.
- **Top-up (Linzie 19:48).** What a short system cannot give in a room is covered by the room's other systems: those with no capacity in full, else those with spare in proportion to their shares, up to their spare. No order. Each system's give to each room is recorded and Systems takes its energy from it.
- **Hot water.** Heated first: it takes the boiler's capacity before the rooms, and is itself limited to it (shortfall shown). A dedicated water heater with a store refills it hour by hour; the store starts the year as it ends.
- **Results.** Per system: peak ask, hours short, lowest flow temperature, hot water heated first and short. Per room: unmet hours split into system only, both, and the room's own emitters. The design heat loss line per system against its capacity.

## Evidence

| Check | Result |
|---|---|
| P2 EnergyPlus referee (two rooms, radiators, `DistrictHeating:Water` at capacity) | Unmet hours pass in every room and case. Annual heating misses ±3 % by −3.3 to −3.7 %, the same with the plant doing nothing (Brief 104/108's open gap). Shares 0.561 vs 0.561; lowest flow 36.0/33.9 °C vs 35.8/33.7 °C (also over EnergyPlus's short steps only). [`02_referee.md`](02_referee.md) |
| Plant short hours | −12 to −13 % against EnergyPlus, counted the same way. Open. |
| Community centre, boiler at design loss | Short 398 h, nearly all morning warm-ups (peak ask 30 kW vs 15.8 kW); the year's heating falls 1.4 %. [`04_example.md`](04_example.md) |
| Bridgewater, heat pump capped at 30 kW beside its boiler | Heat pump short 3,042 h; the boiler tops up; no room short because of a system. 1.3 s. |
| Today's engine | Untouched; anchor 133.2; 107 gate unchanged. |
| Tests | 426 v2 tests; build clean. |
| Independent review | 12 findings, all answered. [`05_review_response.md`](05_review_response.md) |

## Open, and owed

- Cooling capacity is shared in proportion to ask and has no EnergyPlus referee (review F11). A held-out wet case (three rooms, 70/50, n = 1.3) is owed too.
- Plant short hours −13 % against EnergyPlus.
- A water heater's store: no usable fraction or standing loss input yet (shown as assumptions, F5).
- P6 panel (editor thread): the capacity field and the system-short mark.
