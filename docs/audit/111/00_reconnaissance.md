# Brief 111 Part 0: reconnaissance (Parts 1 and 2)

**Where the run is built.** `frontend/src/sim2/run/seam.ts`, `simulate(input, deps)` works in this order:
1. it parses (or upgrades a 2.3 document);
2. `preflight` names what is missing;
3. `runModel(doc, weather, library, RUN_OPTIONS)` runs the engine;
4. `Summary` holds per-zone and building breakdowns (Brief 106);
5. `energyOf` runs the systems (Brief 107).

The worker (`worker.ts`) and the client (`client.ts`) pass the document through. A level is one more input to `simulate`, applied to a copy of the document before preflight, so everything after it is unchanged.

**What each level removes from the copy (Rule 8):**

| Document field | fabric | spaces | systems |
|---|---|---|---|
| `profiles` of kind occupancy, lighting, equipment, auxiliary | removed | kept | kept |
| `zones[].profile_refs` | emptied (they would name removed profiles) | kept | kept |
| `zones[].ventilation` (mvhr, mev) | removed | removed (Systems module) | kept |
| `zones[].ventilation` (natural) | removed | kept (Operation module) | kept |
| `zones[].emitters` | removed | removed | kept |
| `system_groups` | removed | removed | kept |
| `zones[].setpoints` | heat_c = the stated temperature, no cooling, no setback | kept | kept |
| surfaces, permanent vents, infiltration (q50 / ach), bridging, internal heat capacity | kept (the envelope) | kept | kept |

**Where the setpoint comes from.**
- The fabric level's setpoint is an input to `simulate` (`fabric_heat_c`). It is never defaulted in the seam.
- The editor shows the 21 °C in its top bar (Part 4) and passes it on.
- With none given, the run names it as missing.

**Energy.** Energy is computed only at `systems`. At the other levels `Summary.energy` is null, and the panel says energy is shown when results include systems.

**The breakdown.**
- Every level returns Brief 106's building and per-zone breakdowns, from the same engine run.
- They close against that run's demand. The engine checks this every hour (`checkClosure`); the tests sum the displayed lines.

**Fabric only and EnergyPlus (Part 2).** Brief 104's referee r2_z (`validation/energyplus/104_zones_referee.py`) is Bridgewater as five storeys with no gains and no ventilation entries, heated and cooled at the comfort band. Fabric only is that run with no cooling and the heating at the stated setpoint. The two-zone fixture is the editor's `two_zones.plan.json`, which needs a referee of its own.
