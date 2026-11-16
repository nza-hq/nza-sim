# Brief 114 — answer to the independent review

16 Nov 2026. Review: `04_independent_review.md` in the project folder `nza-sim/114/`. Every finding is answered below, with the code and test that answer it. Nothing was tuned: no figure was changed to move a result toward EnergyPlus or NCM.

**After the answers:** the v2 suites give 453 tests, 451 pass and 2 skip (the anchor EPW is not in this container). The build is clean. `scripts/114_gate.mts` gives the same Bridgewater digest as before 114 (`2da3e6b5…e58b`, EUI 148.33 on Denver), so a document that states nothing new runs as before. The EnergyPlus referee's engine figures (`02_engine.json`) are unchanged.

## Medium findings

**F1: demand fans now run only inside their hours.** Fixed.
- **Schema.** `runs: 'demand'` now needs `control_schedule_ref`, either `always_on` or a schedule profile. That ref gives the hours the fans may run. Message: "fans on demand need the hours they may run: always_on or a schedule profile".
- **Engine** (`ventilation.ts`). Running fraction = hours value × min(1, max(least share, presence)). Outside the hours it is 0, so the least share applies only inside them.
- **Test** (`pumps.test.ts`, "review F1"). Office hours 08–18 on weekdays, people 09–17 at 0.8, least share 0.2: every hour matches by hand, and it is 0 outside the hours. The "same as a schedule of that shape" test uses `always_on`.
- **Editor.** The ventilation form must ask for the hours when "demand" is chosen. The editor thread has been told.

**F2: "Use defaults" pairs NCM's W/m² with NCM's hours.** Fixed.
- **Shared hours.** When every room the system serves shares one heating-hours schedule (`setpoints.hours_ref`, Brief 109), `defaultPumps` fills `runs: 'schedule'` with that schedule. This is NCM's pairing for the Actual building (para 103: the hours the heating setpoint is above the setback).
- **Mixed hours.** When the rooms do not share one, there is no single set of hours to pair, so it fills "with demand". `default_from` then says so: "hours: with demand, as the rooms served have no one set of heating hours (NCM pairs the W/m² with the heating hours)".
- **Cooling.** A cooling system's `default_from` now says its figure is "Both − LTHW only over the cooling hours (this tool's pairing, not NCM's)".
- **Tests.** "review F2" covers shared hours and mixed hours.

**F3: the inverter's saving is shown as ideal, and compared with NCM.** Answered, and a choice is put to Linzie.
- **What was added.** `PUMP_CURVE.note` gives the panel line: "ideal: power in proportion to load, no minimum speed (EnergyPlus default); NCM Table 14 implies a 17–50 % saving". The editor thread is asked to show it beside any variable-speed pump.
- **The comparison:**

| | Variable ÷ fixed |
|---|---|
| This engine, EnergyPlus referee | 0.40–0.41 |
| This engine, Bridgewater (2.29 / 6.41 kWh/m²) | 0.36 |
| NCM Table 14, differential sensor across the pump | 0.83 (heating) / 0.83 (both) |
| NCM Table 14, sensor in the system | 0.67 / 0.61 |
| NCM Table 14, multiple sensors | 0.50 / 0.50 |

- **Why they differ.** The referee checks that the engine matches EnergyPlus running the same curve. It does not check the curve itself. The curve was named in the brief and is kept.
- **The choice for Linzie.** Should the curve stay ideal, or have a stated least power? This was asked on a card. The recommendation is to keep the ideal curve, shown as such. A stated minimum would need a named source, and calibration against meters will show which is right for a building. No engine change is made unless she chooses otherwise.

**F4: pumps are never sized on a warm-up hour.** Fixed.
- **Design load, in order:**
  1. the system's capacity;
  2. for a heating system, its share of its rooms' design heat loss (Brief 117), when the building states design conditions;
  3. otherwise the busiest hour.
- **How it is passed.** `runSystems` takes the design heat loss from the seam: `energyOf` calls `designHeatLoss` once and passes `systemRoomsDesignW` per heating system. The design panel uses the same function, so there is one calculation.
- **W per kW** is now refused by name when there is neither a capacity nor a design heat loss: "W per kW needs the system's capacity (kW), or the building's design conditions for its design heat loss".
- **A stated W** keeps the busiest hour as the variable pump's design load. It is shown as `design_from: 'peak'` with `design_w`, so the panel can say "sized on the busiest hour, x kW".
- **Tests.**
  - `pumps.test.ts`: the refusal, and design heat loss 3 kW at 5 W/kW giving 15 W.
  - `levels.test.ts`, Bridgewater through the seam: refused without design conditions. With them, `design_w` equals the rooms' design heat loss × share, and the rated W is 1/100 of it.

## Low and Low–Medium findings

**F5: what "continuous" means.** Put to Linzie on a card: all year (EnergyPlus's meaning) or the system's season.
- **Current build.** It stays as built (the months with any load) until she answers. The recommendation is the season, taken from the rooms' heating hours rather than inferred from load. In UK weather, inferred from load it is all year in most buildings anyway.
- **Process.** From the next brief, the referee spec is committed on its own before the first run, as in 120.

**F6: wider double-count refusal.** Fixed for names; the rest is noted.
- **What is refused.** An old auxiliary profile named for pumps or circulators beside system pumps. One named for lifts beside a `lift` other load. One named for external, outdoor or car park lighting beside an `external_lighting` other load. Each is refused with "counted twice".
- **What is not caught.** A profile named otherwise, such as "Plant room". The Controls view lists both side by side, so a person can see it.
- **Hot water pumps.** A hot water system's `pumps` are its primary pumps; `services.dhw.circulation_pump_w` is the secondary circulation. This is said in `auxiliaryDefaults.ts`. Stating the same pump in both places cannot be told apart from two pumps, so it is not refused.
- **Tests.** The "circulators" case, and the lift case.

**F7: pump heat into the water is now stated.** Fixed. Whenever a system states pumps, `not_modelled` has "pump heat into the water (not counted)". Test: "review F7".

**F8: one exposure of each kWh (Rule 11).** Fixed.
- **Engine.** `PumpResult` and `OtherLoadResult` no longer carry `kwh`. The figure is the end-use line's, read through `readEntryKwh(systems, end_use, entry_id)`.
- **Seam.** `energy.pumps[].kwh` and `energy.other_loads[].kwh` are filled from that helper, so the panel's reads are unchanged.
- **New fields.** `PumpResult` gains `season_months` (the months a continuous pump runs). `design_from` can now be `design_heat_loss`.
- **Test.** The engine record has no `kwh`, and the end use equals the sum of `readEntryKwh`.

**F9: citations corrected.**
- Table 14 is on p. 32.
- The hours rule is para 103 (para 62 is the Notional twin).
- The SFPs at paras 66–67 are the Notional building's. For the Actual building, NCM leaves SFP to the user (paras 108–109).
- Para 58(d) gives a Notional secondary circulation pump.
- Corrected in `auxiliaryDefaults.ts`, `01_schema.md` and `00_reconnaissance.md`. The sha256 of the PDF is still to be added when it is read on IT15.

**F10: demand fans at full flow in the design heat loss.** Fixed. `designHeatLoss.ts` takes a demand entry at its full design flow, whatever the people. Test (`designHeatLoss.test.ts`, "review F10"): a room whose presence never passes 0.1 still gets the full-flow line.

**F11: the branch is up to date with 120.** Fixed. 120's tip was merged into 114 (merge, not rebase).
