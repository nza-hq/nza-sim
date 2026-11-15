# Brief 103 Part 4 — performance (decision 7)

Measured 15 Nov 2026 in this cloud container (4 cores, Node v22.23.4, the pre-installed Chromium), by
`scripts/103_perf.mts` (run from `frontend/`: `PW_EXECUTABLE=/opt/pw-browsers/chromium npx vite-node ../scripts/103_perf.mts`). Raw output:
`04_performance.json`. The anchor zone: 10 elements, 44 nodes, a full year plus 25 warm-up days.

| Measure | Node | Chromium Web Worker | Budget |
|---|---|---|---|
| One zone, one year (median of 5 after a warm-up) | 19 ms | **22 ms** | < 100 ms: **met** |
| 10 zones (each its own zone, in series) | 152 ms | 248 ms | |
| 50 zones (each its own zone, in series) | 875 ms | **849 ms** | < 2 s: **met** |

Scaling is linear in zones: about 17–22 ms per zone, in one worker.

**What made it fast.**
1. Each element's layer chain is condensed onto its inside surface once (static condensation), leaving an 11 × 11
   system per zone, factorised once.
2. Hourly ventilation is applied with Sherman–Morrison.
3. The sun's track is computed once per weather file.

Before these, the same run took 49 ms per zone and 2.5 s for 50 zones.

**For Brief 104 (coupled zones).** If 50 coupled zones were one dense matrix (2,200 nodes), the per-hour substitution
alone would take about 117 s a year (10 zones: 2.4 s; measured per-hour cost × 8,760). The zones must keep the
block structure: each zone condensed onto its interface (air and inside surfaces), with only partition and
inter-zone air terms coupling the condensed systems.

**Same numbers in Node and the browser.** Heating and cooling agree to 15 significant figures (Node
89914.779953 / 15448.092271 kWh, worker 89914.779953 / 15448.092271), with a difference in the last
binary digit. They are not bit-identical, most likely because the two V8 builds' Math functions differ. Nothing a
user sees or the store hashes depends on the 16th digit.
