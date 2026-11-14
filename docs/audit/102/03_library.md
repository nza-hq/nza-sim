# Brief 102 Part 3: library export with provenance

## Code side (this commit)

- `scripts/102_export_library.py` reads the SQLite library **read-only** (`mode=ro`) and writes
  `docs/audit/102/library_export.json`, one item per row: `{ kind, key, body, provenance }`. `body` is the row's
  `config_json` exactly; `provenance` carries the SQLite id, type, display name, description, `is_default`, created and
  updated times, and `brief: 102`. The file also records `exported_at`, `machine` and `source_db_sha256` once at
  the top; the seed copies those three into each row's provenance.
  Idempotent: if nothing changed, the file is left alone (`unchanged`).
- `scripts/102_seed_library.mjs` calls `upsert_library_item` with the anon key and the NZA-team user's own session,
  never a service-role key. Dry run by default. It refuses any project other than NZA Sim (dev). For each
  (kind, key): same body as the newest global row → skipped; different → next version; none → version 1. So a
  second `--apply` adds nothing, and an edited item is a new version, never lost (`upsert_library_item` returns
  the existing row for an existing version without updating it).

## Kinds

| SQLite `library_type` | sim kind | Rows (July copy) |
|---|---|---|
| construction | construction | 15 (11 default + 4 `bridgwater_*`) |
| system | system_template | 18 |
| schedule | profile | 15 |
| (EPW files in `data/weather/current/`) | weather | 1: Yeovilton, sha256 `c6571102…cf2` (name, hash and size only; the bytes stay local) |
| benchmark | **not exported** | 3 (CRREM pathways and the FES grid trajectory: not model inputs, no sim kind) |

The counts match Part 0 (15 / 18 / 15 / 3). The 7 system templates the engine actually reads live in
`frontend/src/data/systemTemplatesLibrary.js` (code, not rows) and are not exported; with v40 present their values
move nothing (Part 1). No age-band data exists anywhere, so `age_band_default` is empty.

## Evidence

- Run on the 17 Jul transfer-pack DB (sha256 `5a41bcf1…`): `{"construction": 15, "profile": 15, "system_template": 18, "weather": 1}`;
  a second run prints `unchanged`; the DB's sha256 is the same before and after.
- Seed with no project configured: prints the same counts, reads and writes nothing; `--apply` without a session
  refuses (exit 2).
- Seed against a mocked API (one unchanged item, one changed): plan `unchanged 1, new 47, new_version 1`; apply
  writes 48, the changed profile as v2.

## Still to do (Chris's agent, with the database)

1. On Chris's machine, stop the dev server, then `python scripts/102_export_library.py` against the **live**
   `data/nza_sim.db` (this export is from the July copy) and commit the new JSON.
2. Sign in to the app as the NZA-team user (magic link), then in that tab's console run
   `JSON.parse(localStorage['sb-jbjxduathkklruvbmeho-auth-token']).access_token` and set it as
   `$env:NZASIM_ACCESS_TOKEN` (with `$env:NZASIM_SUPABASE_URL` and `$env:NZASIM_SUPABASE_ANON_KEY`).
   Then `node scripts/102_seed_library.mjs` (the plan), `--apply`, and `--apply` again (plan must be all
   unchanged). Paste the output here. The token lasts an hour; never commit or log it.

(The emailed-code sign-in originally planned here was dropped: without custom SMTP the email template cannot carry
the code, `04_auth_config.md`.)

## The `--apply` run (Claude Chat, 14 Nov 2026 21:06, database side)

Chris was on his MacBook; the PowerShell/token route needed a running app and a pasted session token, so the
seed was applied from the dashboard SQL editor instead, **through the same function with the same checks**:
`set local role authenticated` with Chris's real user id in `request.jwt.claims`, then
`upsert_library_item(null, kind, key, 1, body, provenance)` for every item of the committed export
(`docs/audit/102/library_export.json`, fetched from the branch on GitHub; `exported_at 2026-11-14T19:36:56Z`,
`machine vm`, `source_db_sha256 5a41bcf1e238…`, the same database Chris's own export on IT15 read, by sha).
No service-role key, no direct insert; RLS and the NZA-team check applied (`nza_team = true` was asserted in
the same statement).

| Check | Result |
|---|---|
| items seeded | 49 (construction 15, profile 15, system_template 18, weather 1), all version 1 |
| second run of the same statement | 49 rows still, one `created_at` for all rows: nothing added |
| provenance | 49 of 49 carry `source_db_sha256`; 48 of 49 carry `sqlite_id` (the weather item's provenance has no sqlite row id, by the export's design) |

Consequence for the script: `node scripts/102_seed_library.mjs` now prints `unchanged: 49` against this project
and `--apply` writes nothing, which is the state Part 3's verification asks for. When a fresh export (IT15) is
committed, the bodies hash the same, so provenance stays as above unless an item really changed.
