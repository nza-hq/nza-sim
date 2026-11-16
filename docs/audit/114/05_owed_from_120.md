# Owed from Brief 120 (review F11): cooling capacity and a held-out wet case

16 Nov 2026. Both run in the container on Denver TMY3, EnergyPlus 25.2.0. Nothing in the engine was changed for or after these runs.

## Cooling capacity against EnergyPlus

Script `scripts/114_cooling_capacity.mts`, output [`05_cooling_capacity.json`](05_cooling_capacity.json). The cooled room's middle room on one cooling system whose `capacity_kw` is Brief 119's cap, against Brief 119's committed EnergyPlus run (ideal loads at LimitCapacity) under 119's gate.

| Case | Cooling | Hours above | Highest | Gate | Plant limit = unit limit |
|---|---|---|---|---|---|
| tight (800 W) | +3.8 % | +80 h of 299 | +0.92 K | fails (hours) | identical, value for value |
| mild (1,100 W) | +4.4 % | +18 h | +0.66 K | passes | identical |

With one room on the system, the plant limit gives exactly what Brief 119's unit limit gives, so the plant's cooling direction is right, and the result against EnergyPlus is 119's: the tight miss was attributed there to the engine's unlimited cooling peak being 5.2 % above EnergyPlus's (Brief 104's open cooled-room gap). **Still unrefereed:** how a short cooling plant shares between several rooms (in proportion to ask). EnergyPlus would need a chilled-water loop with fan coils for that; not built.

## Held-out wet case

Spec `validation/energyplus/114_heldout_spec.json` (chosen before any run): 70/50 water, radiators 1,500 W west and 700 W east, plant 1,300 W; 120's model and gate otherwise unchanged. EnergyPlus `validation/energyplus/114_heldout_referee.py` → [`05_heldout_energyplus.json`](05_heldout_energyplus.json); engine `scripts/114_heldout.mts` → [`05_heldout.json`](05_heldout.json).

| Room | Heating | Unmet hours | Lowest | Share of the plant when short |
|---|---|---|---|---|
| west | −3.4 % (gate ±3 %) | 371 vs 423 (−52 h, tolerance 42 h) | +0.31 K | 0.595 vs 0.592 |
| east | −3.2 % | 1,235 vs 1,279 (−44 h, tolerance 128 h) | +0.03 K | 0.405 vs 0.413 |
| plant | | short 1,310 h vs 1,445 h (−9 %) | lowest flow in short steps 42.6 vs 41.9 °C | |

**It fails the gate narrowly, and the miss is the rooms, not the plant.** The same rooms with a plant far above any ask (`heldout_free`, added after the first run to attribute the miss, and said so in the spec) miss by −3.7 % and −4.0 %: the engine's heating in these radiator rooms is already 3–4 % below EnergyPlus with no limit (the open gap Briefs 104, 108 and 120 report). What the plant itself does, how it shares between unequal radiators at a lowered flow temperature, matches EnergyPlus to within 0.01 of share on held-out water temperatures and sizes. Short hours are −9 % (120: −13 %).

**Not refereed:** exponent 1.3. EnergyPlus's water baseboard is effectiveness-NTU at a fixed UA, which behaves as exponent 1, so a panel radiator's n = 1.3 has no EnergyPlus counterpart here; three heated rooms would need 104's referee model changed (its middle room is cooled).
