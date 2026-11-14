# Brief 102b: thermal bridging in the air-node balance (today's instant engine)

Linzie Brown approved this on 14 Nov 2026 at 23:53 ("Yes, do what we think is best"). It is her explicit exception to the Simulate v2 "no engine file changes" rule, for this fix only.

- **Branch:** `chris/102b-bridging-in-balance`, off `main` `bbc7893`.
- **Evidence:** the cooling-gap investigation for Brief 103, recorded on the 103 branch as `docs/audit/103/cooling_gap_root_cause.md` and `ep_confirm_results.md`.

## Scope (CLAUDE.md process rule 10)

This is a Building-module and Systems-module engine fix inside `frontend/src/utils/instantCalc.js` only.

- **The bug.** Thermal bridging (ISO 14683 H_TB, 278 W/K on Bridgewater) is reported as a 24.0 MWh loss line, but it is missing from the zone air-node balance (`C_coef` / `D_coef`).
- **Why it matters.** Since Brief 69 Part 2, State 2/3 demand comes only from `−C_coef·(T_set − T_air_free)`, so bridging never reached heating or cooling demand. That breaks Rule 9: a displayed term was not in the integrand.
- **Why it was missed.** Brief 69 fixed exactly this problem for mechanical ventilation, and bridging was not caught at the time.
- **Out of scope:** no change to inputs, the schema, the UI, `nza_engine/` or any other module.

## BEFORE DOING ANYTHING

- [x] Read CLAUDE.md (Rules 9, 10, 14), STATUS.md and the root-cause note.
- [x] Confirm the anchor before the change: `node scripts/_brief93_anchor.mjs --fixture` gives 132.6.

## Part 1: the fix, the pins and the record (one commit)

- **The fix.** In `instantCalc.js`, add `total_H_TB_W_per_K` to the State 1 air-node balance (around line 1317) and the State 2/3 balance (around line 3219): `−H_TB` in `C_coef` and `+H_TB·T_out` in `D_coef`.
  - It is driven by T_out, like the bridging loss line.
- **Pins updated:**
  - `validation/fixtures/bridgewater_anchor_v2.yaml`: `expected_eui_kwh_per_m2` set to 133.2. Inputs are untouched.
  - `scripts/102_anchor_roundtrip_lib.mjs`: `EXPECTED` set to EUI 133.2 and total 561,572 kWh.
  - `scripts/seed_test_project.py`: the description text.
- **Record:** `docs/audit/102b/` (before/after JSON and the note), STATUS.md, current.md and this brief, archived.
- **Database:** the anchor is re-recorded on NZA Sim (dev) through the Supabase connector. The engine fingerprint changes, so the new run sits beside the 132.6 run, which stays as history.

## Verification

1. `--fixture` anchor: EUI 133.2, heating 102.7 MWh, cooling 92.4 MWh. Before the fix it was 132.6 / 87.7 / 101.1.
2. State 1 (Building page) demand is unchanged at 129.2 / 98.6. That method computes demand at setpoint and already included bridging. Only its free-running comfort hours move.
3. `report_baseline_v1` moves from 126.0 to 126.6.
4. `npm test` and `npm run build` are clean.
5. The anchor run is recorded and read back on NZA Sim (dev).

## Rule 14 statement

- **State 1 and State 2/3** receive the identical change.
- **The inline-legacy `full` path** (`calculateInstant`, around line 6716) gets no change, because it has no air-node balance and no thermal-bridging term at all.
  - It is the pre-v2.5 path, used only when a caller provides neither a v2.5 config nor the system-template library.
  - Its long-standing omission of bridging is unchanged and recorded here.
  - It is not made worse.
