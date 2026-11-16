# Brief 108 review F1: radiator output that follows the room, against EnergyPlus

**What changed (4e7b3c5).** Each hour, a zone's wet emitters are rated at the zone's control temperature at the end of
the hour before, not at its setpoint. The water flow stays at its design value, so in a colder room the emitter gives
more and the water returns cooler. `emitter_rating: 'setpoint'` keeps the old fixed limit for tests.

**Referee.** EnergyPlus 25.2.0, `ZoneHVAC:Baseboard:RadiantConvective:Water` on a plant loop held at 50 °C
(`validation/energyplus/108_hotwater_referee.py`, spec `108_hotwater_spec.json`).
- The room is the cooled room of Brief 104 (Denver; west and east heated at 20 °C).
- Each heated room has one radiator. It gives 800 W ("tight") or 1,100 W ("mild") at 50/40 °C with the room at 20 °C, the same limits as Part 3. Exponent 1, all convective.
- Why exponent 1 and no radiant share: EnergyPlus's water baseboard works by effectiveness-NTU at a fixed UA. At full flow its output is k × (water in − room air). Engine 2's EN 442 radiator at exponent 1 and constant flow gives the same shape, with k = design output / (flow − setpoint). So the two programs are running the same radiator, and only the way each solves the hour is being tested. The radiant share's hours below are F2's open item (08_radiant.md) and are kept out.
- EnergyPlus's rating inputs are worked out from its documented sizing (Engineering Reference 15.4.3.3) before any comparison. The run then measures what it actually did.
  - k at full flow was 26.72 W/K (tight) against 26.67 intended, and 36.72 against 36.67 (mild): +0.2 %.
  - Maximum water flow was 0.0191 and 0.0263 kg/s, as intended.
  - The water reached the radiators at 49.95 to 50.00 °C.
- No tuning: nothing in Engine 2 was changed for this comparison.

**Gate** (Part 3's, unchanged): annual heating ±10 %, hours below ±20 % or ±50 h, lowest temperature ±1 K. A new check is added: the re-rating's own effect on the lowest temperature, against a fixed limit, must agree within 0.2 K in the two programs.

| Case | Room | Heating MWh, Engine 2 / EnergyPlus | Hours below | Lowest °C | Peak W | Pass |
|---|---|---|---|---|---|---|
| tight | west | 1.825 / 1.892 (−3.5 %) | 413 / 464 (−51 h, −11 %) | 15.32 / 15.11 | 925 / 932 | yes |
| tight | east | 1.825 / 1.889 (−3.4 %) | 416 / 458 (−42 h) | 15.30 / 15.10 | 926 / 932 | yes |
| mild | west | 1.859 / 1.931 (−3.7 %) | 23 / 27 | 18.03 / 17.81 | 1,172 / 1,182 | yes |
| mild | east | 1.860 / 1.928 (−3.5 %) | 24 / 26 | 18.02 / 17.81 | 1,173 / 1,182 | yes |

**The re-rating's own effect.** For each program, the hourly rating is compared with the same radiator held at its setpoint output (EnergyPlus: Part 3's `LimitCapacity` runs at 800 and 1,100 W):

| Case, room | Hours below: Engine 2 / EnergyPlus | Lowest temperature rises: Engine 2 / EnergyPlus | Peak output rises: Engine 2 / EnergyPlus |
|---|---|---|---|
| tight, west | 460 → 413 / 517 → 464 | +1.09 / +1.09 K | +15.6 / +16.5 % |
| tight, east | 461 → 416 / 511 → 458 | +1.10 / +1.09 K | +15.7 / +16.5 % |
| mild, west | 26 → 23 / 32 → 27 | +0.50 / +0.57 K | +6.6 / +7.4 % |
| mild, east | 26 → 24 / 32 → 26 | +0.50 / +0.57 K | +6.6 / +7.4 % |

**What this shows.**
- Both programs run warmer by the same amount in the coldest hour, and lose about the same number of hours below.
- What is left is the cooled room's known gap: −3.5 % heating and about 10 % fewer hours below, the same as uncapped and as Part 3. The hourly rating adds no error of its own.
- Engine 2's peak is about 1 % lower than EnergyPlus's. That is because its coldest hour is 0.2 K warmer, and output rises 26.7 W for each kelvin the room cools.
- Rated at the setpoint, Engine 2's hours below happen to land closer to EnergyPlus's hot-water count (460 against 464). That is chance: two errors cancel, the fixed limit's pessimism and the room's smaller loss. Part 3 shows that, like for like, Engine 2 has 11 % fewer hours below than EnergyPlus.

**What it does not show.**
- An exponent above 1. EnergyPlus has no EN 442 radiator. At n = 1.3 the rise is larger; that is the EN 442 arithmetic of tests (g) and (g2), checked by hand.
- The radiant share's hours below (F2).
- Engine 1, which uses the same `at()` and the same one-hour lag. Test (g) checks it against an analytic steady state.

**Files.**
- `validation/energyplus/108_hotwater_referee.py` and `108_hotwater_spec.json`; EnergyPlus results in `09_hotwater_energyplus.json`.
- `scripts/108_hotwater.mts`, which writes `09_hotwater.json`.
- The gate as test (i) in `emitters.test.ts`, which runs from a fresh checkout.
- EnergyPlus warnings: four per run, plus their two recurring-summary lines. One is the partition's layer order, as in every cooled-room run. One is the pump's zero power, which is on purpose so it adds no heat. Two are a psychrometric wet-bulb calculation that fails to converge, once each, at 10:23 on 13 March and 11:45 on 14 March. At those times the radiators are throttling down to nothing as the sun warms the rooms, and the rooms are held at 20.0 °C. No severe errors.
