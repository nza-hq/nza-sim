# Brief 105 Part 6 — per-floor accuracy

- **Engine:** `scripts/105_per_floor.mts` writes `06_per_floor.json`.
- **Referee:** `validation/energyplus/105_per_floor_referee.py` writes `06_referee.json`. It uses EnergyPlus 25.2.0 and the anchor EPW.
- **Model:** Bridgewater five storeys, envelope only, on `REFEREE_OPTIONS`, as in Brief 104 Part 5. BESTEST 900 is on its gate options.

## What was added (engine options; the defaults are unchanged)

- **`time_step: { steps_per_hour, theta_e_between }`** (network.ts).
  - Each hour can be split into 1 to 60 steps.
  - Solar, gains and ventilation are held over the hour.
  - The outdoor temperature is either held at the hour's value, or moved linearly from the previous reading to this one. The linear form is EnergyPlus's convention.
  - Outputs stay hourly: the mean of the steps. Each hour's closure is the mean of the steps' own residual sizes, so steps cannot cancel (review F8).
- **`surface_physics.inside_convection: 'tarp'`** (network.ts).
  - Walton's natural-convection correlations, which EnergyPlus's TARP inside algorithm uses.
  - Each face's coefficient comes from its tilt and its temperature difference with the air at the previous step. The minimum is EnergyPlus's 0.1 W/m²K.
  - The solver's matrix is rebuilt every step.
  - Both options run on the network solver, including for a single zone. A single zone in the network equals Engine 1 (`multizone.test` (c)).
- **Tests** (`substep_tarp.test.ts`):
  - One step stated equals the option absent, value for value.
  - Halving the step halves the error (first order).
  - Every hour closes.
  - For TARP, a zone with one face, held at 20 °C, settles where its heating equals Walton's h(ΔT)·A·ΔT. This is checked for a wall, a cool ceiling, a cool floor and a warm floor.
- **`hourly.interzone_w`.** Each zone's hourly heat from the other zones is now in the results (zeros for one zone). It was added for the hour-by-hour slab comparison.
- **BESTEST helper.** The BESTEST document builder moved unchanged from `bestest.test.ts` to the shared `__tests__/denver.ts`, so the script can use it.

## 1. Sub-hourly steps: Engine 2's own step error is small

Engine 2 at each step size, against Engine 2 at 60 steps an hour:

| | Bridgewater heating | Bridgewater cooling | Worst storey | BESTEST 900 heating | BESTEST 900 cooling |
|---|---|---|---|---|---|
| 1 step an hour (today) | 0.0 % | +0.1 % | +0.1 % | +1.0 % | +1.3 % |
| 4 steps an hour | 0.0 % | 0.0 % | 0.0 % | +0.2 % | +0.3 % |

EnergyPlus's own result moves much more with its step:

- With Engine 2's simplifications, going from 4 steps an hour (`r2_z_e2like`, its default) to 1 step an hour (`r2_z_e2like_ts1`) changes heating by +1.5 % and cooling by −9.3 % (13.09 against 14.42 MWh).
- BESTEST 900 (Brief 104's runs) changes by −2.4 % heating and −2.1 % cooling.

Engine 2 at one step an hour therefore already gives the answer a fine step gives. The like-for-like referee is EnergyPlus at its default 4 steps. Against that:

- With the same simplifications, the building is −2.3 % heating and +3.2 % cooling.
- Every storey is within 4.3 % on both heating and cooling.
- Against EnergyPlus at one step, cooling reads +13.8 %. That difference is EnergyPlus's step, not Engine 2's.

**Decision: sub-hourly steps do not become a default, and they do not join `REFEREE_OPTIONS`.**

- They change Engine 2 by at most 0.1 % on Bridgewater and 1.3 % on BESTEST 900.
- 4 steps cost 1.5 to 2 times the run time.
- The option stays available for referee checks.

## 2. TARP inside convection: most of the per-floor difference

| Engine 2 | Building vs r2_z (full EnergyPlus) | Storeys vs r2_z, cooling | z5 heat in through its floor |
|---|---|---|---|
| ISO by tilt (today's `REFEREE_OPTIONS`) | +1.1 % / +7.9 % | z1 +31.3, z2 +21.0, z3 +12.4, z4 +3.0, z5 −21.1 % | 0.77 MWh |
| TARP | **−1.4 % / +1.6 %** | z1 −17.2, z2 +3.1, z3 +4.6, z4 +3.9, z5 +0.1 % | **2.60 MWh** |
| EnergyPlus r2_z | | | 3.44 MWh |

- **Storey heating against r2_z.** ISO by tilt gives −4.0 to +5.2 %; TARP gives −4.5 to +3.0 %.
- **TARP against EnergyPlus with the same form** (`r2_z_e2tarp`: Engine 2's simplifications except inside convection, 4 steps):
  - The building is −1.1 % heating and +3.7 % cooling.
  - The storeys are within 5.6 %, except z1 cooling at −9.5 % (0.90 against 1.00 MWh).
- **What remains against the full referee** is outside convection (DOE-2), EnergyPlus's sky, and its long-wave exchange: `r2_z_e2tarp` against `r2_z` is −0.2 % heating and −2.1 % cooling.
- **BESTEST 900 is mixed with TARP.**
  - Heating goes from 2.048 to 1.963 MWh. EnergyPlus's own TARP run gives 1.652, and the ASHRAE 140 range is 1.379–1.814.
  - Cooling goes from 2.424 to 2.352 MWh, against EnergyPlus's 2.507 and the range 2.267–2.714.

**Speed.** TARP rebuilds and refactorises the interface matrix every step:

- five storeys: 1.0–1.2 s against 0.28–0.39 s;
- Brief 104's 50-zone document: 50.1 s against 2.0 s, against a budget of 2 s.

Two cheaper forms were looked at:

- Tried: rebuilding only when some face's coefficient moved by 2–20 %. This kept results within 0.3 % but still took 31–43 s at 50 zones, because with over 200 faces one of them always moves. It was not kept.
- Not tried: a fixed-matrix correction iteration. A floor's TARP coefficient can be several times its ISO value, so convergence is not assured.

**Decision: TARP stays an option and does not join `REFEREE_OPTIONS` or the editor's run options yet.**

(Review F7: `REFEREE_OPTIONS` is spread into the editor's run options, so putting TARP there would put it in the editor.
And the speed miss is not only at 50 zones: five storeys take 1.0–1.2 s, against Brief 104's 150 ms five-zone budget.)

- It is the physics that matches the referee per storey. It brings the worst storey's cooling error from 31 % to 17 % and the building's from +7.9 % to +1.6 %.
- It fails the 50-zone speed budget by 25×.
- Making it fast is a follow-up: a factorisation that takes the convection changes as an update rather than a rebuild.
- Until then, the per-zone figures the editor shows keep the ⓘ that says they are not yet validated per storey.

## 3. The roof storey's slab gap, hour by hour

Heat into z5 through its floor, MWh a year:

| | Engine 2 | EnergyPlus | Gap |
|---|---|---|---|
| ISO by tilt, 1 step / EnergyPlus `r2_z_e2like_ts1` | 0.77 | 1.40 | 0.63 |
| ISO by tilt, 4 steps / `r2_z_e2like` | 0.77 | 1.28 | 0.51 |
| TARP, 1 step / `r2_z_e2tarp_ts1` | 2.60 | 2.97 | 0.37 |
| TARP, 4 steps / `r2_z_e2tarp` | 2.60 | 2.92 | 0.31 |
| full EnergyPlus `r2_z` | | 3.44 | |

**Attribution of Brief 104's gap** (0.77 in Engine 2 against 3.44 in r2_z, 2.67 MWh):

- **Inside convection form: 1.83 MWh** (0.77 → 2.60 in Engine 2). In EnergyPlus the same change, ISO to TARP with everything else equal, moves 1.28 → 2.92.
- **The rest of EnergyPlus's surface physics: 0.52 MWh** (`r2_z_e2tarp` 2.92 → `r2_z` 3.44).
- **Not attributed: 0.31 MWh** at equal simplifications (TARP, 4 steps). Ruled out, with measurements:
  - **Time step.** Engine 2 at 1 and 4 steps gives 0.768 and 0.768.
  - **The slab's discretisation.** Sub-layers of at most 5, 2 or 1 cm give 0.768, 0.767 and 0.766.
  - **The storeys' air temperatures.** Engine 2's z5 and z4 are within 0.02 K of EnergyPlus's on the year's mean.
  - **Where the gap sits.** Split by Engine 2's state each hour (TARP, 4 steps): heated hours 1.46 against 1.70; free-running hours 1.23 against 1.32; cooled hours −0.09 against −0.11. Most of it is in heated hours.
- **Size.** The unattributed 0.31 MWh is 1.3 % of z5's heating.

The monthly figures for each pair are in `06_per_floor.json` (`roof_slab_hourly`).

## 4. The cooled-room twin with gains (brief deliverable 5)

The setup:

- Brief 104's cooled room is unchanged: three rooms at Denver, the outer two heated to 20 °C and the middle one cooled to 24 °C.
- Each room gets one internal gain from `validation/energyplus/105_cooled_room_gains_spec.json`:
  - west: 8 W/m², evening-heavy every day, 50 % radiant;
  - middle: 25 W/m², office hours on weekdays and 10 % otherwise, 30 % radiant;
  - east: 4 W/m², always on, 70 % radiant.
- Engine 2 reads each gain through `gains.ts` as an equipment profile with its own schedule.
- EnergyPlus reads it as ElectricEquipment on a Schedule:Compact (`105_cooled_room_gains.py`). Each side expands the schedule itself.
- Test: `cooled_room_gains.test.ts`. The EnergyPlus results are committed with the sha of both spec files.

| Room | Demand | Gains, Engine 2 / EnergyPlus | Engine 2 vs EnergyPlus, same coefficients | Engine 2 vs EnergyPlus's own (TARP inside) | Engine 2 with TARP vs EnergyPlus's own |
|---|---|---|---|---|---|
| west | heating 1.350 MWh | 0.7428 / 0.7428 | **−4.3 %** | +11.9 % | +4.2 % |
| middle | cooling 2.821 MWh | 1.935 / 1.935 | **+3.3 %** | +1.6 % | −2.8 % |
| east | heating 1.326 MWh | 0.841 / 0.841 | **−4.0 %** | +12.3 % | +4.6 % |

- The gate (±10 % per room with the same surface coefficients) passes.
- The gain energy agrees to four figures.
- TARP again closes most of the difference to EnergyPlus's own convection: about 12 % falls to about 4.5 %.

## Decisions

- `REFEREE_OPTIONS` is unchanged, so Brief 104's gate numbers stand.
- The editor's run options are unchanged.
- Both options are available for referee work.
- TARP's speed is the follow-up that would let the per-storey numbers lose their "not yet validated" note.
- The anchor (today's engine, 133.2) is untouched: no file of today's engine changed.
