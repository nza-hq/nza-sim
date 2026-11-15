# Brief 106 — Simulate v2: the room-by-room breakdown and pinned constructions

Written 15 Nov 2026 by Linzie's project agent (Linzie, 14 Nov 22:50: "we write the briefs now"; 15 Nov 21:15 after merging #32: carry on with the next items). Carries Brief 105's independent-review findings F3 and F6 (`docs/audit/105/07_independent_review.md`).

## Scope

Simulate v2's run seam and results panel only (`frontend/src/sim2/run/`). It reads what the engine already returns. No engine physics changes, nothing in today's tool (`instantCalc.js` and the rest of today's engine, `nza_engine/`), and nothing in the editor's files (`frontend/src/sim2/geometry/`, `frontend/src/sim2/library/`). The anchor stays 133.2.

## BEFORE DOING ANYTHING

- [ ] Read CLAUDE.md, the top of STATUS.md (Brief 105), `docs/audit/105/09_final_report.md` and the review.
- [ ] Branch `chris/106-zone-breakdown` from main after #32.
- [ ] Confirm the editor writes `library_refs` for every construction it uses (`toDocument.ts`, editor branch).

## Part 1 — Every construction a run uses is pinned (review F6)

- **Files:** `frontend/src/sim2/run/library.ts`, `__tests__/library.test.ts`, `__tests__/seam.test.ts`.
- A surface's construction with no `library_refs` entry is listed as missing, in plain words ("Choose the construction "…" again, so the version used is recorded."), not run on whatever the library holds today.
- Commit: `106 P1: every construction a run uses is pinned`.
- **Verification:** a document without a pin is refused, naming the construction. The editor fixture (which pins) still runs. All sim2 and thermal tests pass.

## Part 2 — The room-by-room breakdown (review F3)

- **Files:** `seam.ts` (Summary zones gain `breakdown`), `ResultsPanel.tsx`, `run.css`, tests.
- Each zone's row opens to its own balance: every term the engine has for that zone, including heat from neighbouring zones ("From other zones") and heat stored. This satisfies Rule 9 for a zone's displayed figure.
- **Verification:**
  - The zone's lines sum to zero within rounding (every term is shown), tested.
  - The zones' "from other zones" lines sum to zero across the building.
  - Browser check at 1440×900 on the editor's two-zone fixture.
- Commit: `106 P2: room-by-room breakdown`.

## Part 3 — Close

- STATUS.md, `current.md`, this brief to `archive/106_zone-breakdown_COMPLETED.md`, `docs/audit/106/`.
- PR into main; merge only with Linzie's approval.
- Commit: `106 P3: close`.

## Deliverables

1. Pins required (P1).
2. Per-zone breakdown in the panel (P2).
3. STATUS, current.md, archive, audit note (P3).
