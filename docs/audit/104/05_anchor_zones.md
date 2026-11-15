# Brief 104 Part 5: Bridgewater as five zones against the five-zone EnergyPlus referee

- **Engine 2:** `scripts/104_anchor_zones.mts` produces `05_anchor_zones.json`.
- **Referee:** `validation/energyplus/104_zones_referee.py` produces `05_referee_zones.json`, with EnergyPlus 25.2.0 and the anchor EPW (sha c6571102…cf2).
- **Engine 2 inputs:** the per-storey document (`fromBuildingConfig(…, { zoning: 'per_storey' })`) on `REFEREE_OPTIONS`.
- **Nothing in the engine was changed for this part.**

## Result

**The gate passes.** Against the referee r2_z, Engine 2's building totals are **+1.1 % heating and +7.9 % cooling** (limit ±10 %).

| MWh | Heating | Cooling |
|---|---|---|
| Engine 2, five zones | 91.21 | 14.89 |
| Referee r2_z | 90.18 | 13.81 |
| Referee r2_z with Engine 2's surface simplifications | 93.34 | 14.42 |

### Per zone (Engine 2 / r2_z / r2_z with Engine 2's simplifications)

| Zone | Heating | Cooling | Heat in through slabs |
|---|---|---|---|
| z1 (ground) | 24.94 / 23.71 / 25.01 | 1.43 / 1.09 / 1.48 | 4.60 / 4.78 / 4.65 |
| z2 | 13.55 / 14.12 / 14.10 | 3.69 / 3.05 / 3.56 | −2.09 / −3.41 / −2.36 |
| z3 | 13.22 / 13.50 / 13.59 | 4.24 / 3.77 / 4.07 | −1.02 / −1.78 / −1.12 |
| z4 | 13.83 / 14.36 / 14.26 | 3.76 / 3.65 / 3.62 | −2.25 / −2.93 / −2.39 |
| z5 (roof) | 25.67 / 24.49 / 26.37 | 1.77 / 2.25 / 1.70 | 0.77 / 3.44 / 1.28 |

Monthly figures for every zone are in the JSON.

**The solver against EnergyPlus with the same simplifications.** The simplifications are ISO fixed convection, sky at dry bulb − 11 K, and area-weighted long-wave. With them in EnergyPlus, the building is −2.3 % heating and +3.2 % cooling, and every zone is within 5 % on both heating and cooling. What is left against the full referee is the surface-coefficient forms that Brief 103 left open (TARP and DOE-2 convection, EnergyPlus's sky). These also change how much heat crosses the slabs: z5 receives 3.44 MWh through its floor in r2_z, against 1.28 with the simplifications and 0.77 in Engine 2.

**One zone with the slabs as internal mass** (the four slabs lying flat in one zone, against `r2_one_zone`): +1.1 % / +8.2%. With Engine 2's simplifications it is −2.4 % / +3.0 %.

## What the referee needed: three findings, each measured

The first five-zone comparison, against r1, was +2.1 % heating and +15.6 % cooling. In that run the ends were heated
too much and the middle storeys too little. Each of the three changes below makes the referee build the same building
that Engine 2's document states. None of them is a tuning knob.

| Step | Referee | Engine 2 heating | Engine 2 cooling | What moved |
|---|---|---|---|---|
| — | r1 | +2.1 % | +15.6 % | |
| 1 | r1_tbz: bridging by zone | +2.1 % | +14.4 % | Wall junctions move from equal shares to the zone they belong to: the ground-floor edge to z1, and half of each slab edge to each zone it joins. |
| 2 | r1_z: infiltration by zone | +1.6 % | +10.9 % | Per-zone heating now lines up. |
| 3 | r2_z: slab reversed | +1.1 % | +7.9 % | |

**1. Bridging by zone.** r0 spreads every wall junction over all the walls, so each storey gets an equal share.
Engine 2 allocates each junction to the zone it belongs to. The building total is the same. Engine 2's window
junction is now 4√A per facade, shared by glazing area, so it does not grow when a facade is cut into storeys. This
matches r0's one-square-per-facade rule.

**2. Infiltration by zone.** r0 gives every zone the building's rate, 0.0692 ach. Engine 2 gives each zone
q50 × its own envelope area ÷ its own volume ÷ 20. That is 0.113 ach for the ground and roof storeys, which carry the
ground floor and roof, and 0.040 ach for the middle storeys. The building total is the same. Engine 2's allocation
follows from what q50 is: leakage per m² of envelope. The equal rate in r0 puts roof and ground-floor leakage into the
middle storeys. This was the cause of the end-heavy, middle-light heating pattern. With infiltration allocated by
zone, the per-zone heating lines up.

**3. Each slab is one construction seen from both sides.** In r0 both surfaces of every slab pair use the same
carpet-first construction. Each storey's floor therefore has plaster as its inside face, and EnergyPlus warns:
"Construction INTERIOR_FLOOR_CEILING of interzone surface FLOOR_1_CEILING does not have the same materials in the
reverse order as the construction INTERIOR_FLOOR_CEILING of adjacent surface FLOOR_2_SLAB … simulation proceeds". r2
gives the upper face the reversed construction, and the warning goes. **This comes from today's EnergyPlus assembler**
(`nza_engine/`, which r0 is built from). Today's EnergyPlus path has the same inconsistency. It is recorded for the
brief that next touches the assembler and is not changed here (`nza_engine/` is out of scope).

**The time step.** The `_e2like` runs keep EnergyPlus's 4 time steps an hour. This is the same choice as Part 1b's
e1_like_r1_ts4. A one-step EnergyPlus run moves the five-zone cooling from 14.42 to 13.09 MWh, in EnergyPlus alone.
This sensitivity is EnergyPlus's own and is recorded, not used.

## Open, carried to Part 7

- **Surface-coefficient forms.** These are TARP and DOE-2 convection, EnergyPlus's sky, and its long-wave exchange. They account for the rest of the cooling gap, which is +7.9 % against r2_z but +3.2 % with Engine 2's simplifications. They also change the heat crossing the slabs. This is the same finding as Brief 103's, now measured in five zones.
- **Today's assembler and the slab construction.** See finding 3.
