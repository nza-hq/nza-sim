# Brief 104 final report: Simulate v2 Engine 2 (several zones solved together)

Engine 2 solves several zones at once. Heat passes between them through floors and partitions, and each zone has its own heating and cooling. Its code is in `frontend/src/thermal/engine/` (`network.ts`, `sparse.ts`).

- **When it runs.** `runModel` uses it whenever a document has more than one zone or an interzone element.
- **Engine 1 is unchanged.** One-zone documents still run on Engine 1, and its results are identical to the last digit.
- **Today's tool is untouched.** No file of today's engine changed, and the anchor is 133.2.
- **Branch:** `chris/104-engine-2`, stacked on Brief 103 (PR #30).

## Two caveats, stated plainly (independent review F1, F2)

1. **The five-zone gate passes only against an EnergyPlus model changed three times.** Engine 2 gives 91.21 MWh heating and 14.89 MWh cooling. The original five-zone referee was changed three times:
   - **The floor slabs are fixed.** Today's assembler gives both faces of each slab the same, non-reversed construction, which is a real bug.
   - **Bridging is allocated by storey,** as Engine 2 does it.
   - **Infiltration is allocated by each storey's own envelope area,** as Engine 2 does it.

   Against that changed referee (r2_z), Engine 2 is +1.1 % heating and +7.9 % cooling, a pass. Against the referee with only the slab fix (r2), cooling is **+12.3 %**. Against the referee as Part 1 built it (r1), cooling is **+15.6 %**. Both of those fail the ±10 % gate.

   The gate therefore shows that the solver is right *given* Engine 2's choices for splitting bridging and infiltration by storey. It does not show those choices are right. Equal-rate against per-envelope infiltration is a product design choice, recorded for the design note. This gate does not decide it.
2. **Per-room results are less reliable than the building total.** Against the full referee, storey cooling is off by up to about 30 % in both directions:
   - ground floor: +31 %;
   - first floor: +21 %;
   - roof storey: −21 %.

   The building total passes partly because these offset. When EnergyPlus is given Engine 2's simpler surface physics, every storey comes within 5 %. That places most of the per-room miss in the surface-physics simplifications left open by Brief 103, not in the multi-zone solver.

   Even like for like, heat into the roof storey through its floor is 0.77 against 1.28 MWh (−40 %). **Per-room demand is not validated to ±10 % and must not be presented as if it were.**

## What landed, per Part

| Part | Commit | Result |
|---|---|---|
| Brief | 62a6b3d | Brief on disk. |
| P0 | c89e33c | Reconnaissance: the referee's zones and slab construction, and how it allocates infiltration (the same rate in every zone, which corrects decision 4). |
| P1 | 457f61e | 103 cooling miss attributed with one-change EnergyPlus runs (table below). |
| P1b | a68b431 | Window solar from the window's own optics (Simple Window Model, LBNL-2804E). |
| P2 | c20d2a5 | Schema 2.2: interzone surfaces and internal mass; per-storey zoning in the converter. |
| P3 | 7e707a8 | The multi-zone solver, interzone lines in the breakdown, and exact per-zone ideal loads. |
| P4 | 126a922 | Analytic multi-zone cases to rounding; the cooled-room twin against EnergyPlus. |
| P5 | f781af1 | Bridgewater, five zones, against the five-zone referee: the gate passes against r2_z (see caveats). |
| P6 | ab1794f, ca88eed | Speed: a sparse solver with results unchanged. Every budget met on IT15. |
| P7 | this commit | Independent review (`07`), review fixes F4 and F5, close. |

## Attribution of the 103 cooling miss (Part 1)

Engine 1 had 15.32 MWh against the referee's 13.65 (+12 %). Part 1 changed the EnergyPlus model one step at a time, MWh:

| Step | Heating | Cooling | Δ cooling | What changed |
|---|---|---|---|---|
| r0, the 103 referee (five zones, four slabs) | 90.46 | 13.65 | | |
| one zone, slabs kept inside it | 90.57 | 13.39 | −0.27 | zone count |
| one zone, slabs removed | 91.02 | 12.40 | −0.99 | the slabs |
| + Engine 1's internal mass | 89.59 | 10.15 | −2.25 | an input Engine 1 had and the referee did not |
| + Engine 1's four surface simplifications | 94.71 | 9.33 | −0.81 | fixed sky, area-weighted long-wave, 1 h step, ISO convection |
| Engine 1 | 89.98 | 15.32 | +5.99 | |

- **Of the 5.99 MWh, 4.39 was window solar kept.** Engine 1 kept 134.6 MWh against EnergyPlus's roughly 122.5.
- **0.65 MWh was transmitted solar sent straight to the air node.**
- **The unattributed remainder was 0.95 MWh.**
- **Part 1b put the window's own optics into Engine 1:** the SHGC split, the angle-dependent beam, and diffuse lost back out. On `REFEREE_OPTIONS` the one-zone figures are 92.90 / 10.56 MWh against EnergyPlus-with-the-same-simplifications 93.50 / 10.34.

## The five-zone gate (Part 5), MWh

| | Heating | Cooling | Against Engine 2 |
|---|---|---|---|
| Engine 2, five storeys | 91.21 | 14.89 | |
| r1: the referee as Part 1 built it | 89.35 | 12.88 | +2.1 % / **+15.6 %**: fails |
| r2: slab fix only | 89.82 | 13.26 | +1.5 % / **+12.3 %**: fails |
| r2_z: slab fix + Engine 2's split of bridging and infiltration (the gate) | 90.18 | 13.81 | +1.1 % / +7.9 %: **passes** |
| r2_z with Engine 2's surface simplifications | 93.34 | 14.42 | −2.3 % / +3.2 %, every storey within 5 % |

The per-storey figures are in `05_anchor_zones.md`.

## Speed (Part 6, decision 6)

| Case | IT15, Edge worker, medians of three runs | Cloud container, worker | Budget |
|---|---|---|---|
| One zone | 17.8–19.9 ms | 37.6 ms | 100 ms |
| Five storeys | 81.6–98.1 ms | 219 ms (167–219 across runs) | 150 ms |
| 50 rooms | 576–608 ms | 1.32 s | 2 s |

- **Every budget is met on IT15,** the machine the tool runs on.
- **The container miss** on five storeys is the slower cloud machine, which varies by ±25 % from run to run.
- **Node and browser totals agree to the last binary digit but one** (about 2 × 10⁻¹⁶). The browser's `Math.cos` and similar functions round differently from Node's. On IT15 the 50-room totals are bit-identical.

## The independent review (`07_independent_review.md`) and what was done

| # | Finding | Action |
|---|---|---|
| F1 | The gate depends on a referee aligned to Engine 2's allocation, and cooling is +12 % against r2. The brief's decision 4 was wrong about the referee. | Stated in the caveats above. Decision 4 corrected in the archived brief. Recorded in design note Rev A.7 as a design choice. |
| F2 | Per-storey cooling is up to ±31 % against the full referee, and the roof storey's slab heat is −40 % even like for like. | Stated in the caveats above. Carried to Brief 105 as an open item with these magnitudes. |
| F3 | Engine 2's own 1-hour step error is unmeasured. EnergyPlus moves 9 % between 4 steps and 1 an hour. | Carried to Brief 105 (below). It needs a sub-hourly step in the engine, which is a new capability, not a close-out fix. |
| F4 | The per-storey Bridgewater test skipped on a fresh checkout. | **Fixed.** It now also runs on the committed Denver weather, so closure, slab cancellation and the junction sum always run. 101 tests pass, plus the anchor-EPW version where the local data exists. |
| F5 | The cooled-room test did not check the spec hash. | **Fixed.** It now compares the committed EnergyPlus results' `spec_sha256` with the spec file's hash. |
| F6 | The window model is shared with the referee, so agreement on transmitted solar holds by construction. BESTEST is the independent check: in range on 5 of 8 measures, up from 3. | Recorded in design note Rev A.7. |

The review's other verdicts:
- no tuning found;
- interzone cancellation and per-zone closure hold, with four of four mutations caught;
- the cooled-room twin is honest;
- P6 left results unchanged to at most 3 × 10⁻¹³;
- no file of today's engine was touched.

## Divergences from the brief

- **Decision 4 (infiltration "as the referee does") was wrong.** The referee gave every zone the same rate. Engine 2 allocates by each zone's own envelope area, and the gate's referee was aligned to that.
- **Decision 5's Woodbury update was not used.** The solver uses a radiant star node per zone, a sparse LU factorised once, and the zone air system by Cholesky in admittance form, with the active set warm-started from the previous hour. The results are exact, not iterative.
- **Internal mass shifts steady-state heating by 2.7 %.** The brief assumed no steady-state change. Mass faces join the long-wave exchange. This is recorded and asserted between 0 and 5 %.
- **The cooled-room twin is gated against EnergyPlus with ISO convection.** EnergyPlus's own run is reported alongside (heated rooms +9.9 % and +10.4 %).
- **The node-against-browser "identical totals" holds to the last binary digit but one,** as explained under Speed.

## Lessons proposals

1. **An aligned referee proves the solver, not the allocation.** When a referee is changed to describe the building as the engine does, report the result against the unaligned referee alongside it, in the same table.
2. **Gate per zone when per-zone results are the product.** A building total can pass while its zones are off by ±30 % in opposite directions.
3. **Time on the target machine.** The cloud container is about 2.5× slower than IT15 and varies by ±25 %. It can show a pass but cannot show a miss.

## What Brief 105 (ventilation, gains, the loft buffer) needs from this engine

- **Inputs.** `other_gains` on the network path; it is refused today. Ventilation between zones, as a flow from one zone's air to another's.
- **Surface physics.** The open surface-coefficient forms from Brief 103: inside convection by heat-flow direction (TARP), wind-driven outside convection, and sky long-wave. These are where most of the per-storey miss sits (F2).
- **Open items with their magnitudes:**
  - the roof storey's slab heat, −40 % like for like;
  - per-storey cooling, ±31 % against the full referee;
  - the 1-hour step error (F3), to be measured with an engine-only 15-minute run on interpolated weather;
  - the infiltration allocation design choice (F1);
  - today's assembler slab orientation bug (+0.47 MWh heating, +0.38 MWh cooling), for the brief that next touches `nza_engine/`.
