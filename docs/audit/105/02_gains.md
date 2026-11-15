# Brief 105 Part 2: internal gains from profiles

## What was built

**`frontend/src/thermal/engine/gains.ts` gives each zone's gains, hour by hour, from the profiles it refers to.** It
is a port of today's engine's gains (`instantCalc.js` `computeHourlyGains` and its helpers), with three stated
differences:

1. **Per zone.** Densities are scaled by the zone's own area and rooms. A building total (`basis: 'total'`,
   `unit: 'total_w'`) is shared by floor area among the zones that refer to the profile.
2. **No fallbacks.** A missing input is a named error. Schema 2.3 writes today's fallbacks into converted documents
   (Part 1), so those documents run with today's values.
3. **No occupancy, no occupancy-driven gains.** A zone with no occupancy profile can still have gains that do not
   follow occupancy. One that does follow occupancy is refused, and the error names the zone's occupancy ref. Today's
   engine instead returns zero for every gain when there is no occupancy.

**How the engine uses them.**
- `RunOptions.internal_gains: 'profiles'` turns gains on, on both solvers.
- Absent, or `'none'`, means the envelope-only run, as in Briefs 103 and 104. Every earlier number is unchanged.
- Each profile has its own radiant fraction, so a zone's convective share can change by the hour. The solvers now
  accept the share as one number or as an hourly array.
- **Breakdown:** one line per profile (`occupancy_gains`, `lighting_gains`, `equipment_gains`, `auxiliary_gains`,
  each with its `profile_id`). The closure check sums them with every other line (Rule 9).

**The per-storey converter now divides the room count evenly** (schema 2.3 allows a share, for example
138 / 5 = 27.6 rooms a storey). Per-room gains therefore add up to the building's. Ventilation stays on z1 until
Part 3.

**Not here, as today:**
- latent heat;
- the Systems scalar on lighting and small power, which is Engine 4's (1 for Bridgewater).

## Checks (`engine/__tests__/gains.test.ts`, 10 tests)

| Check | Result |
|---|---|
| Bridgewater, one zone: every hour of each kind against today's `computeHourlyGains` (read-only import) | Largest difference < 1e-9 W, over about 345 MWh a year |
| Five storeys against one zone, hour by hour | Sum equal, < 1e-9 W |
| A building total shared by area among the zones that refer to it | As stated |
| A missing input named, for 9 cases (radiant fraction, sensible heat, rate, rooms, daylight, baseload, standby, unknown relationship, occupancy-driven gain without occupancy) | Each named by its path |
| A steady convective gain into a free-floating zone | Settles at Q / (Σ A/(R + 1/h_ci) + H_tb + H_ve) to 6 decimals |
| One share as a number against the same share as an hourly array, on both solvers | Identical hours |
| A share varying by the hour | Closes |
| `runModel` with gains, one zone and five | Closes per zone. Profile lines sum to the gains. Heating falls, cooling rises. `'none'` is identical to absent |

The thermal suite is 114 tests, all passing. That is the 104 from Part 1 unchanged, plus these 10.

## Against EnergyPlus

**Method.**
- `validation/energyplus/105_gains_referee.py` runs Brief 104's gate referee (r2_z) with one OtherEquipment per zone
  and profile, driven by a Schedule:File holding the profile's hourly gain from `gains.ts`
  (`scripts/105_gains.mts -- export`).
- Each OtherEquipment has the profile's radiant fraction, latent 0 and lost 0.
- **What this tests:** decision 2 of the brief gives one expansion of the profiles for both the engine and the
  referee. So the referee checks the heat balance's response to the same gains, not the schedule arithmetic, which
  the test above checks against today's engine.
- The comparison is in `scripts/105_gains.mts -- compare`, written to `02_gains.json`. The referee's own output is
  `02_gains_referee.json`. Weather is the anchor EPW, with EnergyPlus 25.2.0.

**Results, MWh a year:**

| | Engine 2 heating | EnergyPlus heating | Engine 2 cooling | EnergyPlus cooling |
|---|---|---|---|---|
| No gains (Brief 104 gate) | 91.21 | 90.18 (+1.1 %) | 14.89 | 13.81 (+7.9 %) |
| With gains | 0.00 | 0.00 | 228.65 | 223.68 (**+2.2 %**) |

**With gains, per storey cooling:**

| Storey | Engine 2 | EnergyPlus | Difference |
|---|---|---|---|
| z1 | 35.78 | 33.56 | +6.6 % |
| z2 | 53.00 | 50.40 | +5.2 % |
| z3 | 54.21 | 52.46 | +3.3 % |
| z4 | 51.77 | 50.47 | +2.6 % |
| z5 | 33.88 | 36.79 | −7.9 % |

**Reading it.**
- **The gains are large against an envelope with no mechanical ventilation.** They come to about 69 MWh a storey a
  year: equipment baseload 5.04 W/m² around the clock (37 MWh), people (24 MWh) and lighting (8 MWh). Both models
  need no heating at all.
- **The building total is within 2.2 %. Each storey is within ±8 %.** The pattern by storey (ground and roof storeys
  furthest apart) is the one Brief 104 carried forward (F2), and Part 6 takes it up.
- **This is not yet the brief's gate (verification 3).** That gate is "Bridgewater five storeys with gains and
  ventilation". Ventilation is Part 3, where Bridgewater's 3.8 m³/s of mechanical extract and supply remove much of
  this heat, so the gate is run there with heating and cooling both present.

## Stated after the independent review (F4, F5)

- **A lighting, equipment or auxiliary profile with no schedule of its own follows the zone's occupancy schedule**
  (gains.ts, as today's helpers do). A zone with no occupancy profile then refuses the gain, naming the zone's
  occupancy reference. The editor's space types write their own schedules.
- **Refused, not read as defaults** (changed after review): an exception day active on a date with no values for that
  day type (today read 0); a gain fraction or standby factor outside 0 to 1 (today clamped the gain fraction); a
  negative area share. Bridgewater's values are inside these ranges, so its hours are unchanged.
