# Brief 122 — Simulate v2: the instant estimate (a spreadsheet-fast tier on Site, Shape and Fabric)

**Status:** ACTIVE, 17 Nov 2026. Asked for by Linzie (17 Nov 08:20, via the coordinator): "I want an instant calculation, almost like an Excel spreadsheet to start with… I don't mind a 15-second, and then I don't mind Energy Plus." Three tiers: **instant** (milliseconds, as she edits), **the hourly run** (a few seconds, natural ventilation and stack when switched on), **EnergyPlus** (later).
**Owner:** the building/engine thread writes P1–P3 (the engine, its referee, the seam entry and speed; it owns `thermal/` and the seam). The editor thread writes P0, P4 and P5 (the brief, the workspace, the close). Agreed 17 Nov 08:24.

## BEFORE DOING ANYTHING

1. Read CLAUDE.md in full (Rules 7, 9, 11), STATUS.md and `docs/briefs/current.md`.
2. Read `sim2/run/seam.ts` (`simulate`, `levelDocument`) and the Results panel (`sim2/run/ResultsPanel.tsx`): the instant estimate sits beside these and changes neither.
3. Today's engine and the Bridgewater 133.2 anchor are not touched. Simulate v2 only.

## Scope (CLAUDE.md rule 10)

**Building module, State 1 envelope-only**, as the workspace uses it: conduction (opaque and glazing), thermal bridging, solar through glazing, air leakage at today's q50 ÷ 20, permanent vents at today's fixed method, and heating and cooling demand to hold the Fabric-only temperature. The engine also takes internal gains when a document has them (so it can be used later at + Spaces), but no systems of any kind. Under weather-driven air it still uses q50 ÷ 20 plus vents, as today's method does, and says so. It is a **Static engine, labelled as such** (Rule 7): it never claims to be the hourly run's output, and the two are never merged into one number (Rule 11: separate boundaries, separate fields).

## Measured before the brief (17 Nov 08:25, container, Denver weather)

The workspace today re-runs the full hourly year about 250 ms after each edit, on every step:

| Model | Fabric only | + Spaces | + Systems |
|---|---|---|---|
| Bridgewater, one zone | 58–130 ms | 44–117 ms | 77–108 ms |
| Bridgewater, five storeys | 249–352 ms | 244–491 ms | 342–487 ms |
| Fifty rooms (Brief 115 perf) | about 2 s; about 3.5 s with opening windows hourly | | |

## Design

- **Method:** ISO 52016-1 monthly quasi-steady calculation (the ISO 13790 monthly method's successor), per zone, per month: H_tr by element (U × A, plus ψ × L and the thermal bridging multiplier as the hourly run takes it), H_ve from q50 ÷ 20 and the vents' fixed flow, solar through each window by facing from the weather file's monthly irradiance (g, frame and shading as the hourly run reads them), gain utilisation η from the zone's time constant. Constants named with their clause; nothing tuned.
- **Input:** the same `ModelDocument` and library as `runModel`, no second set of inputs; through `levelDocument(doc, 'fabric', heat_c)`, so the instant estimate sees exactly what Fabric only sees (Rule 8: removed, not muted).
- **Output:** heating and cooling kWh by month and year, and a breakdown with one line per term (Rule 9: the lines sum to the demand, integrand against display, tested).
- **Label:** "Monthly estimate (static)" everywhere it shows (Rule 7). It has its own field path and is never shown beside the hourly result as the same number (Rule 11).
- **Speed:** under 10 ms for fifty rooms in the container, measured and recorded.
- **When it runs:** on every edit, at once, on Site, Shape and Fabric. The hourly run there waits for **Run** (one press; results then stay until the next edit marks them out of date). On Spaces, Systems, Controls and Check, the hourly run runs as today.
- **What she sees:** in the results strip, "Monthly estimate (static)" with heating and cooling MWh and kWh/m², and the heat balance's lines; a Run button for the hourly year; the two never shown as one figure.

## Parts

### P0 — Brief on disk (this commit)

### P1 — The monthly engine (`thermal/engine/monthly.ts`), with unit tests: a box against a hand calculation to the kWh; the breakdown closes; zero glazing gives no solar line; a 0 W/K bridge gives no bridging line.

### P2 — Referee: against the hourly run's Fabric only on Bridgewater (one zone and five storeys) and the community centre. Gates stated before the first run: annual heating within ±10 %; cooling reported, not gated (monthly methods are known to be weak on cooling); each line's own effect reported. Bridgewater five storeys and the community centre. Never tuned. `docs/audit/122/01_referee.md`.

### P3 — Seam entry `instantEstimate(doc, weather)` and a speed script (`scripts/122_perf.mts`), results in `docs/audit/122/02_speed.json`.

### P4 — The workspace: instant on Site, Shape and Fabric; Run for the hourly year there; strip and heat balance labelled. Browser check at 1440×900 on the community centre and Bridgewater: drag a window, the figure moves at once.

### P5 — Close: STATUS, CLAUDE.md Building scope line, current.md, archive.
