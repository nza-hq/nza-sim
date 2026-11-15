# Brief 105 Part 3: ventilation per zone

## What was built

**`frontend/src/thermal/engine/ventilation.ts` gives each zone's ventilation entries as an hourly conductance to
outdoor air.** It is a port of today's engine's per-system ventilation loss (`instantCalc.js`, State 2: `ventSystems`,
`ventUA` and the per-hour loop):

H = ρc · q · (1 − η), while the system runs.

- ρc is today's 0.33 Wh/m³K (`ENGINE_CONSTANTS.rho_c_air`).
- η is the sensible heat recovery.

**Flow bases.** These are today's bases (`projectV40FlowToLps`), plus `ach` for natural ventilation:

| Basis | Meaning |
|---|---|
| `constant` | l/s for the zone |
| `per_m2` | l/s per m² of floor |
| `per_person` | l/s per person at design occupancy |
| `ach` | air changes per hour |

**Stated differences from today's engine:**
- **Schedule.** Today scales each system by `hours / 8760` and ignores its schedule. Here a system runs at its
  `control_schedule_ref` schedule's hourly fraction, or all the time for today's built-in `always_on`. For Bridgewater
  (`always_on`, 8,760 hours) the two are the same.
- **No fallbacks.**
  - MVHR needs its recovery stated.
  - Extract and natural ventilation may state none, or 0. Any other value is refused, because they have no heat
    exchanger.
  - Flow, basis and schedule are required.
- **Summer bypass is refused, not ignored.** Today's lagged free-cooling gate needs the previous hour's result inside
  the solver, so it is left for later. Bridgewater does not use it.

**How the engine uses it.**
- `RunOptions.ventilation: 'document'` turns it on, on both solvers.
- Absent, or `'none'`, is the envelope-only run, unchanged.
- **Breakdown:** one `mechanical_ventilation` line per entry, with its `ventilation_id`. It is split from the zone's
  ventilation term by conductance, as infiltration and vents already are (Rule 9).

**Per-storey converter.** Every storey now gets each ventilation entry. A building flow (`constant`) is divided
evenly; the other bases are kept as they are. The storeys therefore add up to the building.

**Not here:**
- fan energy and fan heat (Systems);
- latent recovery;
- `share_pct` (a Systems split, which today's loss does not read either).

## Checks (`engine/__tests__/ventilation.test.ts`, 7 tests)

| Check | Result |
|---|---|
| Bridgewater's three entries against today's `ventUA` (0.33 × l/s × 3.6 × (1 − η)) | To 9 decimals |
| Five storeys against one zone | Sum equal |
| Each basis (per m², per person, ach) | As stated |
| A weekday / Saturday / Sunday schedule | Runs, stops and runs at half as scheduled (1 January a Monday) |
| `none` and disabled entries | Skipped |
| Missing or wrong inputs: flow, basis, unknown basis, MVHR recovery, recovery on extract, schedule, unknown schedule, summer bypass, per-person flow without occupancy | Each named by its path |
| **Analytic MVHR:** constant 0 °C weather, heating held at setpoint | Extra heating is ρc·q·(1 − η)·ΔT to 3 decimals |
| `runModel` with gains and ventilation, one zone and five | Closes per zone, with three lines per zone. `'none'` is identical to absent |

The thermal suite is 121 tests, all passing.

## The gate: Bridgewater five storeys with gains and ventilation

**Referee.** `validation/energyplus/105_gains_referee.py` runs Brief 104's r2_z with:
- Part 2's gains;
- one `ZoneVentilation:DesignFlowRate` per zone and entry, at q·(1 − η), all year, type Natural, with no wind or
  temperature terms.

Heat recovery at a constant effectiveness brings ρc·q·(1 − η)·(θ_e − θ_a) into the zone, which is the same heat as
q·(1 − η) of outdoor air. EnergyPlus 25.2.0, anchor EPW. The comparison script is `scripts/105_gains.mts -- compare`
(`02_gains.json`).

**Results, MWh a year:**

| Run | Engine 2 heating | EnergyPlus heating | Engine 2 cooling | EnergyPlus cooling |
|---|---|---|---|---|
| Envelope only (Brief 104 gate) | 91.21 | 90.18 (+1.1 %) | 14.89 | 13.81 (+7.9 %) |
| Gains | 0.00 | 0.00 | 228.65 | 223.68 (+2.2 %) |
| Ventilation, EnergyPlus default density | 342.54 | 360.18 (−4.9 %) | 1.77 | 1.75 |
| Ventilation, standard density | 342.54 | 348.45 (−1.7 %) | 1.77 | 1.79 |
| **Gains and ventilation, default density** | 114.55 | 129.28 (**−11.4 %**) | 62.73 | 56.91 (**+10.2 %**) |
| **Gains and ventilation, standard density (gate)** | 114.55 | 119.16 (**−3.9 %**) | 62.73 | 57.38 (**+9.3 %**) |

**With EnergyPlus's default settings the gate misses (−11.4 % / +10.2 %). It passes like for like
(−3.9 % / +9.3 %).**

### Attribution, three steps

**1. Air density.**
- EnergyPlus turns a volume flow into a mass flow at the outdoor air's density by default (`Density Basis = Outdoor`).
- The document, like today's engine, states a volume flow at one heat capacity, 0.33 Wh/m³K (1,188 J/m³K).
- UK winter air is about 7 % denser than that. With 3.8 m³/s of mechanical ventilation, that alone is the −4.9 %.
- Set to `Standard` density in the referee: ventilation-only heating moves from 360.18 to 348.45 MWh.

**2. The remaining heat capacity.**
- EnergyPlus's standard density gives 1.2041 kg/m³ × 1,004.84 J/kgK = 1,210 J/m³K, which is 1.8 % above 1,188.
- With that value put into the engine in a diagnostic process only (`scripts/105_air_heat_capacity.mts`, no engine
  file changed), ventilation-only heating is 348.30 against 348.45 (**−0.04 %**). The gate's heating is 118.54
  against 119.16 (**−0.5 %**).
- So the heating gap is the air heat capacity convention, and nothing else.

**3. Cooling.**
- With matched heat capacity, cooling is 61.14 against 57.38 (+6.5 %).
- That is the same envelope-only cooling bias Brief 104 measured (+7.9 %, finding F2, per storey up to ±31 %), now on
  a larger base. Part 6 works on it.

**Per storey, gate, standard density, MWh (heating / cooling):**

| Storey | Engine 2 | EnergyPlus |
|---|---|---|
| z1 | 27.76 / 10.14 | 28.38 / 7.88 |
| z2 | 18.79 / 14.28 | 20.64 / 12.58 |
| z3 | 18.57 / 14.57 | 20.03 / 13.36 |
| z4 | 19.20 / 14.06 | 20.82 / 13.13 |
| z5 | 30.23 / 9.67 | 29.30 / 10.43 |

### Nothing tuned

- The engine keeps today's 0.33 Wh/m³K. The standard-density referee is a referee setting, recorded with its reason.
- **Decision flagged for review:** whether Engine 3 should take a ventilation flow's mass at the outdoor air's density,
  as EnergyPlus does by default. That would add about 4 % to this building's heating against today's convention, and
  would also change what today's tool computes. It is not taken here.
