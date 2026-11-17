# Brief 115 — Linzie's two tests on the community centre

17 Nov 2026. Linzie asked for two tests on the community centre example, run in our own engine with EnergyPlus as the referee: **windows open all winter**, and **passive cooling against a cooling system**.

- **Whole building, our engine:** [`scripts/115_community_centre.mts`](../../../scripts/115_community_centre.mts) on [`docs/examples/community_centre.plan.json`](../../examples/community_centre.plan.json), through the product's path (plan → document → run seam, 4 steps an hour). Results are in [`04_community_centre.json`](04_community_centre.json).
- **Referee, the open-plan office against EnergyPlus AirflowNetwork:** spec [`115_office_spec.json`](../../../validation/energyplus/115_office_spec.json), committed before the first run (3d577c3). EnergyPlus model [`115_office_referee.py`](../../../validation/energyplus/115_office_referee.py). Engine side [`officeBox.ts`](../../../frontend/src/thermal/engine/__tests__/officeBox.ts) and the gates in [`officeReferee.test.ts`](../../../frontend/src/thermal/engine/__tests__/officeReferee.test.ts). Results are in `04_office_energyplus.json` and `04_office_engine.json`.

The weather is London Gatwick IWEC (sha256 `c61a0a1e…dffc`). It is not redistributable, so it is never committed. The referee test runs when `NZA_GATWICK_EPW` names the file, and skips otherwise.

**Nothing was tuned.** One mistake was found and fixed in the referee's engine side before any comparison was kept: the first run left out `internal_gains: 'profiles'`, so the engine room had no gain. It was fixed by adding the option. No engine figure changed.

## Inputs added to the plan (stated, none from a library default)

| Input | Value |
|---|---|
| Air method | weather-driven, with crack exponent 0.67 and suburban terrain |
| Single-sided turbulence | off (EnergyPlus has no counterpart) |
| Windows | every glazing type top-hung, 30 % of the glass opens, 20°, Cd 0.6, plus a 4,000 mm² trickle vent (Cd 0.6) |
| Heating hours, setbacks, design conditions, VRF outputs | as the 120/P4 example run "B" |

## Test 1: windows open all winter (whole building, our engine)

| Run | Heating | Dec–Feb heating | Gas | Electricity | EUI kWh/m² |
|---|---|---|---|---|---|
| Windows shut | 20,139 kWh | 12,567 kWh | 20,700 kWh | 50,529 kWh | 104.1 |
| Open a quarter, every hour | 67,003 kWh | 33,134 kWh | 51,327 kWh | 55,761 kWh | 156.6 |
| Wide open, every hour | 173,171 kWh | 76,204 kWh | 116,648 kWh | 70,042 kWh | 272.9 |

The heating holds its setpoints and fights the open windows; nothing shuts them. Wide open, the heating is 8.6 times that with the windows shut. In the open-plan office, the windows' own line is −42.6 MWh against 40.5 MWh of heating.

## Test 2: passive cooling against a cooling system (whole building, our engine)

The office and meeting room as designed (cooled, windows shut), with no cooling at all, with no cooling and windows that open above 22 °C in their in-use hours ("passive"), and with both ("mixed mode"). Hours are in use, at operative temperature.

| Run | Office: hours above 25 °C | Office: warmest | Office: cooling | Meeting room: hours above 25 °C | Meeting room: warmest | Meeting room: cooling |
|---|---|---|---|---|---|---|
| Cooled, windows shut | 0 | 24.7 °C | 681 kWh | 0 | 23.9 °C | 428 kWh |
| No cooling, windows shut | 518 | 27.7 °C | — | 484 | 27.1 °C | — |
| Passive (no cooling, windows) | 4 | 25.1 °C | — | 6 | 25.4 °C | — |
| Mixed mode | 0 | 24.5 °C | 49 kWh | 0 | 23.7 °C | 92 kWh |

The passive windows take the office from 518 hours above 25 °C to 4, and its cooling from 681 kWh to none. The heating rises 70 kWh in the office (the windows open on warm winter afternoons, and the room then needs heat). The comms room has no windows and keeps about 11.5 MWh of cooling in every case.

## The referee: the open-plan office against EnergyPlus

The open-plan office was built as one room in both models from the same inputs:

- its size (11 m of south facade, 12 m deep, 3.2 m high);
- its hours, Monday to Friday 07:00–18:00, heating 21 °C with a 16 °C setback, and cooling 24 °C in hours only;
- its window rule (open above 22 °C in hours);
- q50 5, suburban terrain, and Gatwick weather.

These are the stated differences from the community centre:

- It is a stand-alone box, with outside walls on all sides and an exposed floor.
- It uses the Brief 104 constructions.
- It has one gain, 20 W/m² in hours and 1 W/m² outside them, with 0.3 radiant.
- Each facade has one sliding window in the middle band, 1.0 m tall: 10 m wide on the south and 8 m on the north. Its openable fraction is the community centre's top-hung window as the engine reads it: 0.3 × C(20°) = 0.098.
- There are no trickle vents.
- Temperatures are air temperatures on both sides.

Own effects are each case minus "shut" (heating) or minus "cooled" (cooling).

| Test | Gate | Engine | EnergyPlus | Miss | Verdict |
|---|---|---|---|---|---|
| Windows open all year: own effect on heating | ±10 % | +41,916 kWh | +41,940 kWh | −0.1 % | pass |
| … on December to February heating | ±10 % | +18,756 kWh | +18,749 kWh | 0.0 % | pass |
| Passive: hours above 25 °C in use | ±10 % or ±20 h | 203 | 197 | +6 h | pass |
| Passive: warmest hour in use | 0.5 K | 30.47 °C | 30.20 °C | +0.27 K | pass |
| Mixed mode: windows' own effect on cooling | ±10 % | −1,746 kWh | −1,742 kWh | +0.2 % | pass |

Not gated, for the record:

| Case | Heating, engine | Heating, EnergyPlus | Cooling, engine | Cooling, EnergyPlus | Air (t), engine | Air (t), EnergyPlus | Hours open, engine | Hours open, EnergyPlus |
|---|---|---|---|---|---|---|---|---|
| Shut | 2,766 | 2,777 | — | — | 684 | 686 | 0 | 0 |
| Wide | 44,682 | 44,718 | — | — | 21,817 | 21,808 | 8,760 | 8,760 |
| Cooled | 2,791 | 2,800 | 2,360 | 2,321 | 669 | 671 | 0 | 0 |
| Passive | 4,083 | 3,429 | — | — | 3,484 | 3,219 | 1,479 | 1,466 |
| Mixed | 4,090 | 3,430 | 614 | 578 | 3,302 | 3,034 | 1,437 | 1,424 |

**The passive windows' own effect on heating is twice EnergyPlus's (+1,317 kWh against +652 kWh). This is the control's time step, measured, not tuned.** On an autumn afternoon the room passes 22 °C and the windows open. Our engine decides once per step (a quarter of an hour), so the windows stay open for the whole step. The room falls below 21 °C and the heating runs while they are still open. EnergyPlus's venting control is decided on its system time step, which shortens to minutes when temperatures move fast. Its windows shut within minutes, and its hourly open factors are not multiples of a quarter hour (0.0184, 0.0143).

Running the engine at finer steps closes the gap:

| Steps an hour | Own effect on heating | Hours above 25 °C | Windows' effect on cooling |
|---|---|---|---|
| 4 | +1,317 kWh | 203 | −1,746 kWh |
| 12 | +739 kWh | 198 | −1,769 kWh |
| 30 | +290 kWh | 199 | −1,771 kWh |
| 60 | +127 kWh | 199 | −1,772 kWh |

EnergyPlus's +652 kWh sits between 4 and 12 steps. The hours above 25 °C and the cooling saved do not move. The passive year's air (+8 %) comes from the same cause.

This is a property of a window that reacts on a fixed step, not of the air physics. A real person shuts a window in neither one minute nor fifteen. In the whole building it is +70 kWh in the office (2.5 % of its heating). It is reported, not gated, and is a candidate for a follow-up: a window that shuts when its room calls for heat.

## What this does not test

- The trickle vents are not in the referee.
- Top-hung geometry is not in the referee. Its effective area is unit-tested in `airflow.test.ts`. The referee uses a sliding window with the same effective area.
- The office's partitions to its neighbours are not in the referee, because the box is stand-alone.
- The whole building is not refereed in EnergyPlus.
