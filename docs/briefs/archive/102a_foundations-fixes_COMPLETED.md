# Brief 102a — Simulate v2 foundations: the QA fixes

Follow-up to Brief 102 (merged, PR #26). Fixes the four bugs the independent QA proved and closes the round-trip
gap. Source: the QA report (`docs/audit/102a/qa_report.md`, copied from the project files). Branch
`chris/102a-foundations-fixes`, off `main` `affbd7f`. Requested by Linzie Brown, 14 Nov 2026 ("lead things from
here"); routed by the project coordinator.

## Scope

Module: none of Building / Operation / Systems / Interventions. This is the Simulate v2 model store
(`frontend/src/thermal/`, `supabase/migrations/`, the Save button, the round-trip script) plus one additive field on
the weather API. **No engine file changes** (`instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`,
`solarCalc.js`, `nza_engine/`). Today's tool runs unchanged with the env unset. Never NZA Decoded or NZA Decoded
Test. New SQL goes in a new migration file (`0004_…`), tested on a local Postgres 16 with a Supabase stand-in;
Chris's agent applies it to NZA Sim (dev). No lockfile or `node_modules` commit.

Out of scope (QA M4, M6, M7, L1–L8 except where a fix below touches the same lines): noted in STATUS for a later brief.

## BEFORE DOING ANYTHING
- [ ] Read CLAUDE.md, STATUS.md, this brief and the QA report.
- [ ] Branch is off current `main`; `git log --oneline -1` shows the 102 merge.
- [ ] Local Postgres harness applies 0001–0003 cleanly.

## Parts (one commit each, pushed after each)

### Part 0 — Brief on disk
Files: this brief, `docs/briefs/current.md`, `STATUS.md` (Brief 102 is merged, not "PR open"), the QA report copy.
Commit: `102a P0: brief and QA report`.

### Part 1 — The run key names everything that makes the number (QA H1)
- `engine_version` = `instant-1+<12 hex>`: sha256 over the instant engine's source import closure (from
  `instantCalc.js`, `solarCalc.js`, `systemTemplatesLibrary.js`, `engineReads.js`), computed by a Vite plugin that
  watches those files, so an engine edit (even under HMR) changes the key. The JS system templates are in the closure,
  so they are pinned too. No fingerprint → the save is refused.
- Weather: `/api/weather/{f}/hourly` adds `file_name` and `file_sha256` of the file it parsed; the button pins
  `weather_ref {kind:'epw', file_name, file_hash}` from the weather the engine actually used (including a future-weather
  file). No hash → refused, never a legacy name.
Verify: anchor fingerprint stable across two runs, changes when an engine file changes (temp copy); tests; build;
env unset unchanged. Commit: `102a P1: run key pins the engine source, the templates and the EPW bytes`.

### Part 2 — Tiny and huge numbers no longer refused (QA M1)
- `0004`: `create_model_version` takes the client's canonical text `p_canonical`; checks `sha256(p_canonical)` against
  `p_model_hash`; stores `p_canonical::jsonb` and the text itself (`model_versions.canonical`), so the hash stays
  checkable forever. Also checks `document.building.id = p_building` and `document.schema_version = p_schema_version`
  (QA M2's two equality checks). The old jsonb signature is dropped.
Verify (local PG): `-2.7755575615628914e-17`, `5e-7`, `1e21`, astral-plane keys all save; a wrong hash, a mismatched
building or schema version are refused. Commit: `102a P2: …`.

### Part 3 — Runs belong to their version (QA M2, L1)
- `0004`: unique key `(model_version_id, engine_version, library_hash, weather_hash)`; `record_run` looks up within the
  version and inserts `on conflict do nothing` then re-selects. Never returns another organisation's run.
Verify (local PG): org B storing org A's document gets its own run; a repeat returns the same run. Commit.

### Part 4 — Accepting an invitation never demotes (QA M3)
- `0004`: `accept_invitation_token` keeps the higher of the existing and the invited role.
Verify (local PG): sole admin accepts a viewer invite to own email → still admin, admin_count 1. Commit.

### Part 5 — The round trip proves what it says (QA M5)
- `scripts/102_anchor_roundtrip.mjs`: "match" = `modelHash(stored.document)` and `sha256(stored.canonical)` equal the
  fresh fixture hash; EUI and total kWh checked against 132.6 / 558,972 with a stated tolerance; a missing comfort band
  is refused, not defaulted. New `--emit-sql`: writes a SQL file that records the fixture's version and run as a named
  user inside one transaction, for the SQL editor (no token in a terminal), plus the read-back query.
Verify: local PG run of the emitted SQL, then the read-back passes. Commit.

### Part 6 — Close
STATUS, `current.md`, `git mv` this brief to `archive/102a_foundations-fixes_COMPLETED.md`, `docs/audit/102a/`
evidence, PR `102a — Simulate v2 foundations: QA fixes`, a pasteable note for Chris's agent (apply 0004, run the
emitted SQL, read back). Commit: `102a P6: close`.
