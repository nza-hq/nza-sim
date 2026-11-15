# Brief 107 Part 1 — systems by zone group (`engine/systems.ts`)

`runSystems(doc, results, hours)` returns either the energy each installed system draws, or every missing input named by its path. It reads each zone's hourly heating and cooling from the model results. It reads the gains' electricity and the ventilation's running hours from `gains.ts` and `ventilation.ts`, the same functions the demand run uses.

## What each end use is

| End use | Formula | Notes |
|---|---|---|
| Heating, cooling | each zone's hourly demand × the share of each enabled group covering the zone ÷ the group's efficiency | Shares per zone and service must total 100 % (± 0.5, today's tolerance). A zone with demand and no group is refused. |
| Hot water | per zone it serves: (occupants × L/person/day, or L/m²/day × floor) × hot fraction × (store − cold) × 4.18/3600 × 365, × share ÷ η | Hot fraction = (tap − cold) ÷ (store − cold). Flat over the hours, or by the zone's occupancy presence (`follow_occupancy`). Zones that no hot water group covers have no hot water. |
| Hot water pump | `circulation_pump_w` × every hour | Only when any zone has hot water. |
| Fans | SFP × flow × the fraction of each hour the entry runs | Mechanical entries (MVHR, MEV). Natural entries have no fan. |
| Lighting, small power, auxiliary | the gains' electricity (before the gain fraction), split between the groups covering the zone by share × control factor, normalised | As today, the total is the electricity whatever the control factor. With no group, the electricity still counts, under no group. |

## Changes to the engine's existing files

These were made so nothing is calculated twice:

- `gains.ts`: each lighting, equipment and auxiliary profile now also returns `electric_w`, its electricity before the gain fraction, from the same loop as its heat. Each zone returns its occupants and hourly presence. The heat values are unchanged, and every gains test passes.
- `ventilation.ts`: each entry returns `running`, the scheduled fraction of each hour, from the same loop as its conductance.

## Refusals, where today's path falls back

Each case below is refused, named by its path:

- an unknown `source`;
- a missing or zero efficiency on a group with a share;
- hot water inputs (store, tap, cold, basis, litres, load shape, pump) when a hot water system is installed;
- a tap temperature outside cold to store;
- a custom service setpoint (the zones' setpoints are the run's; a second run is not modelled yet);
- a fan without an SFP;
- thin entries on a fuel other than electricity.

## Outputs

- **Per group:** heat (or electricity) served, kWh; fuel drawn, kWh; hourly fuel, W.
- **Ungrouped:** fans, the pump, and thin electricity that no group names.
- **End-use lines:** by fuel.
- **Building totals:** by fuel; the hourly electricity.
- **Read through helpers (Rule 11):** `readSystemsTotalKwh`, `readSystemsEui`, `readEndUseKwh`. The v2 EUI is its own boundary, not the instant engine's and not EnergyPlus's.

## Tests (`systems.test.ts`, by hand on the cooled room's three zones)

- **Heating:** 60/40 between a heat pump (3) and a boiler (0.9) over the outer rooms.
- **Cooling:** at 2.5.
- **Hot water:** at 2 L/m², 60/40/10 °C (hot fraction 0.6), with a 100 W pump.
- **Fans:** 100 l/s at SFP 1, always on, and on a weekday 08–18 schedule, which is exact to the scheduled hours.
- **Lighting:** 5 W/m² at gain fraction 0.5 and control factor 0.5. The electricity is the full 5 W/m².
- **Invariants:** served equals the demand taken per service, the end-use lines sum to the totals by fuel, and the hourly electricity sums to the annual electricity.
- **Refusals:** each one above.

All 168 thermal and sim2 tests pass.
