# Brief 104 Part 6: performance

- **Script:** `scripts/104_perf.mts` (run from `frontend/`), with its browser half `scripts/104_perf_worker.mts` and the 50-room document `scripts/104_grid50.mts`. It writes `06_performance.json`.
- **Method:** each case runs once untimed, then five times timed. The median is reported, in Node and in a Chromium module worker (Playwright; `PW_EXECUTABLE` picks the browser, e.g. Edge on Windows).
- **Inputs:** `REFEREE_OPTIONS` and the anchor EPW (sha c6571102…cf2) for every case.
- **Machine for these numbers:** the cloud container, a 4-core Intel Xeon at 2.1 GHz, Node 22.23, Chromium 153. Repeat runs of the same build on it vary by ±25 %.

## Result (decision 6)

| Case | Zones | Surfaces | Nodes | Node median | Worker median | Budget | Verdict here |
|---|---|---|---|---|---|---|---|
| Bridgewater, one zone (Engine 1) | 1 | 10 | 49 | 53.5 ms | 37.6 ms | 100 ms | **pass** |
| Bridgewater, five storeys (Engine 2) | 5 | 46 | 233 | 254.6 ms | 219.1 ms | 150 ms in a worker | **miss** |
| 50 rooms, ten per floor over five floors (Engine 2) | 50 | 265 | 1485 | 1859.8 ms | 1318.0 ms | 2 s in a worker | **pass** |

- **The five-storey case misses on this machine.** Across the session's repeated worker runs its median ranged from 167 to 219 ms (the fastest single run was 141 ms).
- **Escalation, per decision 6.** A miss is an escalation. To resolve it, the same script was run on IT15 in Edge, the machine the tool is used on (below).

## On IT15 (15 Nov 2026, 19:35)

- **Machine:** Intel Core Ultra 9 285H, 16 CPUs, mains power, Windows Balanced plan, Node 24.18, Edge 157.
- **Code:** a separate worktree at ab1794f, with the anchor EPW copied in and no database.
- **Runs:** three consecutive runs of `scripts/104_perf.mts` with `PW_EXECUTABLE` set to Edge. Each exited cleanly with no errors.

| Case | Worker median, runs 1 / 2 / 3 | Node median, runs 1 / 2 / 3 | Budget | Verdict |
|---|---|---|---|---|
| One zone | 17.9 / 17.8 / 19.9 ms | 17.9 / 17.5 / 16.3 ms | 100 ms | **pass** |
| Five storeys | 85.2 / 81.6 / 98.1 ms | 73.2 / 75.0 / 77.6 ms | 150 ms | **pass** |
| 50 rooms | 581 / 576 / 608 ms | 607 / 606 / 608 ms | 2 s | **pass** |

- **Every budget is met on IT15, with room to spare:** the five-storey case at under two-thirds of its budget, and the 50-room case at under a third.
- **The totals are the same as the container's.** The one-zone and five-storey cooling totals differ between Node and Edge in the last binary digit, as noted above. The 50-room totals are bit-identical there.
- **Decision 6 is met on the target machine.** The container miss is the slower cloud machine.

## Totals, Node against the browser

The building totals agree to the last digit but one:

| Case | Heating, Node / worker (kWh) | Cooling, Node / worker (kWh) |
|---|---|---|
| One zone | 92899.56642695963 / same | 10564.031454314447 / 10564.031454314445 |
| Five storeys | 91206.72249659651 / same | 14891.66454614798 / 14891.664546147978 |
| 50 rooms | 124714.15010079941 / same | 9391.739123454146 / 9391.739123454145 |

- **The difference is about 2 × 10⁻¹⁶ of the value, the last binary digit.** It comes from the JavaScript maths library. Chromium 153's `Math.cos` and other functions round some inputs differently from Node 22's: for example, `Math.cos(1000)` is 0.56237907629070294 in the browser and 0.56237907629070305 in Node. Solar geometry uses these functions.
- **Bit-identical totals across engines would need the engine to carry its own maths functions.** That is not proposed. Within one browser the result is repeatable.
- **Recorded as a qualification of decision 6's "totals identical".** At any reported precision the totals are identical.

## What changed in the engine (no change to any result)

Each change was checked against the full thermal test suite (100 tests) and the anchors:

- **Engine 1 is unchanged to the last digit.** `103_anchor_envelope` gives the same output before and after this part.
- **Engine 2 on Bridgewater is unchanged at the recorded precision.** `05_anchor_zones.json` is regenerated, and only its active-set counts differ (now 725 hours needing a second pass, 2 passes at most). Those counts describe the new warm-started solver.

The changes, in `frontend/src/thermal/engine/`:

1. **Radiant star node per zone** (`network.ts`). Each face links to it by h_ri·A_f, an exact equivalent of ISO 52016-1 eq. 30. This removes the dense face-to-face long-wave matrix.
2. **Sparse LU without pivoting** (`sparse.ts`), factorised once per run. The elimination order is the faces first, then each zone's radiant and air nodes. The matrix is symmetric and diagonally dominant, so this order keeps fill to the coupling between zones.
3. **Zone air system in admittance form** (air control with all heating at the air node, which is the referee's case). With Y = G⁻¹, the free zones solve (Y + H_v)·x = Y·z0 − Y·x_held by Cholesky each hour. This replaces a dense LU of every zone each hour. Other control forms keep the dense LU.
4. **Active set warm-started from the previous hour.**
5. **Flat arrays for the element chains, and hour-major packing of the hourly inputs and outputs.** The per-element hourly terms became annual sums: `NetworkRun.element_terms` now holds `boundary_wh`, `solar_absorbed_wh` and `sky_wh`, and `element_interzone_wh` replaces the hourly arrays. Each hour's closure is still checked inside the run.
6. **Build caches** (`model.ts`): the sun on each orientation and the window optics per orientation and glazing are computed once. In `glazing.ts`, the angular curves are evaluated lazily, with the same expressions.
7. **`luFactorInto`** (`linalg.ts`): a non-allocating dense LU.

## The 50-room document

- **What it is.** Bridgewater's per-storey document with each storey cut into a 5 × 2 grid of rooms. Each room keeps its share of the walls and glazing on the facades it touches.
- **Partitions.** Neighbouring rooms share a block partition (`perf_partition`: plasterboard, 100 mm dense block, plasterboard). This construction is defined in the script, not in the library.
- **Floors.** Rooms above one another share the storey slab.
- **Purpose.** It exists to time 50 coupled zones. It is not a model of the hotel.
