# Brief 107 Part 0 — reconnaissance: today's systems path, and what the v2 document holds

**Sources.**
- Today's path: `frontend/src/utils/systemsEngine.js` (`computeSystemsDelivered` and its helpers) and its State 3 caller in `instantCalc.js` (around line 4985).
- Today's numbers for Bridgewater: from `_brief93_anchor.mjs --fixture`, with the consumption block dumped from the same call.
- The document side: `scripts/107_recon.mts`, which prints what the converted document holds as one zone and per storey.

## How today's 133.2 is made

EUI = (electricity 404.144 + gas 157.428 MWh) ÷ 4,216 m² = 133.2 kWh/m². Every service runs on the v40 path (`consumption.source_path` is v40 throughout).

| End use | Today's formula | Bridgewater, MWh | v2 document |
|---|---|---|---|
| Heating | demand (State 2, after MVHR recovery) × share ÷ efficiency, per system | 102.7 × 95 % ÷ 3 = 32.522; × 5 % ÷ 1 = 5.135 | Two `system_groups`, `service: heating`, shares 95/5, `efficiency_metric` 3/1, `source` ambient_air/electricity |
| Cooling | demand × share ÷ efficiency | 92.4 × 100 % ÷ 3 = 30.8 (a second system at 0 %) | Two groups, shares 100/0 |
| DHW | tap-mix: occupants × L/person/day × hot fraction × ΔT × 4.18/3600 × 365; × share ÷ η | 257.335; gas 52 % ÷ 0.85 = 157.428; heat pump 48 % ÷ 3 = 41.174 | `services.dhw` (60 / 42 / 10 °C, per_person 55 L), occupants = rooms 138 × 2.5 per room × rate 1 = 345; two groups 52/48 |
| DHW circulation pump | W × 8760 (State 3, not `computeSystemsDelivered`) | 0.120 kW × 8760 = 1.051 | `services.dhw.circulation_pump_w` 120 |
| Ventilation fans | SFP × flow (l/s) × 8760 h, every enabled entry | 22.469 + 17.408 + 0.736 = 40.613 | Each zone's `ventilation[]`: `sfp_w_per_l_s`, `flow_rate`, `control_schedule_ref: always_on` |
| Lighting | the gains' electricity, split by share × control factor (normalised) | 39.014 | `lighting` group; electricity from `gains.ts` (see gap 1) |
| Small power | as lighting | 186.136 | `small_power` group |
| Auxiliary | its gains' electricity, straight to electricity | 27.699 (external lighting 1.5 W/m², gain fraction 0) | `auxiliary` group; the profile `aux_external_lighting_…` |

Check: electricity 32.522 + 5.135 + 30.8 + 41.174 + 1.051 + 40.613 + 39.014 + 186.136 + 27.699 = 404.144. Gas 157.428. Both match the headline.

## Gaps and decisions for Part 1

1. **Electricity of the gains.** `gains.ts` returns heat (× gain fraction) only. Auxiliary's gain fraction is 0, so its electricity cannot be recovered from the heat.
   - Part 1 adds the electricity (before the gain fraction) beside each profile's heat, from the same loop.
   - This is not a second exposure of one quantity (Rule 11): heat and electricity are two quantities, computed once each.
2. **Today's fallbacks are not ported.** The Systems scope says no silent fallbacks, and CLAUDE.md Rules 2 and 3 apply. These fallbacks become named refusals:
   - DHW 60 / 10 / 40 °C, 80 L or 1.1 L/m²;
   - a heating setpoint of 21 °C and a cooling setpoint of 24 °C;
   - an unknown `source` treated as electricity;
   - an efficiency of 0 giving 0.
3. **Fan hours.** Today's fans run 8,760 h whatever the schedule. In v2, fans run on their entry's schedule, the one ventilation heat loss already uses (one source for both).
   - Bridgewater's entries are all `always_on`, so the two agree there.
   - The difference is stated for scheduled entries.
4. **The control factor (thin entries).** Today, `share × control_factor` only splits the electricity between systems: the total is the gains' electricity whatever the factor, because lighting controls act through the gains (daylight factor).
   - This is ported as it is, with the behaviour stated.
5. **Service setpoints.** In v2 the zones' setpoints are the run's.
   - `services.heating` and `services.cooling` with `setpoint_mode: 'custom'` would need a second run (today's `state2Recompute`). It is refused in Part 1, named, and carried forward.
   - Bridgewater is `follow_comfort`.
6. **Several zones.** A group serves the zones in its `zones` list. For each zone and service with demand, the enabled groups covering it must total 100 % (½ point tolerance, as today); otherwise the run is refused, naming the zone.
   - The editor (a23418d) gives each zone one group per service at 100 %.
   - The converter gives every zone every group at today's shares.
7. **DHW in several zones.** Per person, from each zone's own occupants (rooms × density × rate, as `gains.ts` reads them); per m², from its floor.
   - Each zone's DHW is served by the DHW groups covering it.
   - The building total is the sum, so per storey it equals the single-zone figure.
8. **Hourly.**
   - Heating and cooling are delivered hour by hour from the zones' hourly demand.
   - DHW is flat (today's `flat`). `follow_occupancy` shapes it by the zone's occupancy presence (today's B4).
   - Fans follow their schedule. Lighting, small power and auxiliary follow their gains.
   - So the hourly electricity profile is the sum of these.
9. **Carbon is out of scope.** It goes to the design note's Results brief, so today's `carbon_kgCO2_per_m2` is not reproduced.

## What the gate in Part 2 can and cannot show

Fed today's annual demand (102.7 / 92.4), each end use must equal the table above. That is the arithmetic, path by path.

On Engine 2's own demand the EUI moves by the demand difference times each system's efficiency, plus any difference in gains electricity (expected none: `gains.ts` equals today's `computeHourlyGains`). Part 2 states that difference and attributes it.
