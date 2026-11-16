# Brief 114 P2: pumps against EnergyPlus

Script `validation/energyplus/114_pump_referee.py`, spec `114_pump_spec.json` (gate written before either program ran), EnergyPlus 25.2.0 in the container; results [`02_energyplus.json`](02_energyplus.json); engine side `frontend/src/thermal/engine/__tests__/pumpReferee.test.ts`, results [`02_engine.json`](02_engine.json).

**Case.** Brief 108's hot-water referee: the cooled room's west and east rooms on hot-water radiators at 50/40 ('mild', 1100 W each), Denver TMY3. The loop's pump at 200 W design power; its design flow is the radiators' summed design flow. The pump puts no heat in the water in either program (EnergyPlus: motor efficiency 0.001 and no motor heat to the fluid, because EnergyPlus always adds the shaft work to the water). Engine 2: the same document with the heating system's `pumps`, design load its busiest hour (no capacity stated).

| Variant | EnergyPlus kWh | Engine kWh | Difference | Gate | |
|---|---|---|---|---|---|
| Fixed speed, with demand | 788.3 (4,035 h with any pump step) | 783.0 (3,915 h) | −0.7 % | ±5 % | pass |
| Fixed speed, continuous | 1,752.0 (all year) | 1,310.4 (9 months) | −25.2 % | ±1 % | **fail** |
| Variable speed, with demand | 326.1 | 317.2 | −2.7 % | ±15 % | pass |
| Fixed, continuous in the same season (added after the first run) | 1,310.4 | 1,310.4 | 0.0 % | ±1 % | pass |

**The continuous fail is a definition, recorded as found.** EnergyPlus's Continuous pump runs every hour its loop is available, here all year. The brief defines "continuous" as every hour of the system's season, the months with any load (here January–May and September–December). Given the same season as a flow schedule (written after seeing the first result, and said so in the spec), EnergyPlus gives exactly the engine's figure. The Controls view should say "runs all through its season (the months it has load)"; a pump left on all year needs `runs: 'schedule'` with an all-day schedule.

**Load fraction against flow fraction.** EnergyPlus's variable pump follows the water flow; the engine follows the heat load (the brief's choice). For these radiators the two are nearly the same: over the heating hours EnergyPlus's flow fractions sum to 1,645.6 and its own load fractions to 1,632.5 (+0.8 %); by load decile the mean flow fraction is within 0.01–0.09 of the load (`flow_vs_load_deciles`). The −2.7 % is mostly the engine's 3 % fewer heating hours (3,915 h against 4,035 h of any heating step: an hour counts in EnergyPlus if any ten-minute step heats). This is one radiator type at exponent 1 and 50/40; a radiator at n = 1.3 and 70/50 throttles differently and is not checked here.

**Fixed with demand.** The engine counts whole hours with heat (3,915); EnergyPlus runs its pump only in the steps with load, 3,941 equivalent hours over 4,035 hours with any step. They land within 0.7 %.

Not tuned: nothing in the engine was changed after any run.
