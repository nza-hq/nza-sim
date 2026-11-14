# Brief 102 — Simulate v2 Foundations: the model document, its hash, the database and one identity

Rev A · 14 Nov 2026 · Chris Scott (product owner) with Claude Chat · branch `chris/102-sim-v2-foundations`
Design note (canonical if this brief and it disagree): Notion "Design note — Simulate: a zoned hourly energy model from the digital twin (Rev A, 14 Nov 2026)", page `418d645e-05cc-811e-ad6b-fa8846f12148`, Revs A to A.4 (the method, standalone first, the ground-up architecture, how tools join the decodED ecosystem).
This is Brief 0 of the twelve in that note. It builds no engine and no UI beyond one button. It lays the floor the next eleven stand on.

## Module scope statement (CLAUDE.md process rule 10)
This brief adds a new module, **Model** (the model document, its versions, its hashes, its storage) and touches no physics. Building, Operation, Systems and Interventions keep their declared scopes; `instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js` and the epJSON generators are read, never edited. The one engine call this brief makes is the existing `calculateInstant` through its existing entry point, to record today's result against a stored model version.

## BEFORE DOING ANYTHING
- [ ] Quote this brief's title and first paragraph back. Confirm the brief is on disk at `docs/briefs/active/102_simulate-v2-foundations.md` and that `docs/briefs/current.md` points at it.
- [ ] Read `CLAUDE.md` (all of it; the data-safety and backup rules apply because Part 3 reads the live library), `STATUS.md` top, `docs/state_contracts.md` (v2.5), `api/db/schema.sql`, `validation/fixtures/bridgewater_anchor_v2.yaml`, `scripts/_brief93_anchor.mjs`, the design note.
- [ ] Read decodED's tenancy, because Simulate joins its identity: in `nza-hq/nza-decoded`, `supabase/migrations/0003_tenancy.sql` (profiles, organisations, memberships with roles admin/editor/viewer, `caller_id()`, `role_in(org)`, `can_read_org(org)`, `is_admin_of(org)`), `0008_access.sql` (`is_nza_team()`, `org_has_pro(org)`, `my_access()`), `0021_project_per_org.sql`, and `CLAUDE.md` "API keys" (the anon key is public by design; RLS on every table; dev/prod split; no secret in a laptop `.env` other than the documented exceptions).
- [ ] `git status` clean on `main`; create `chris/102-sim-v2-foundations`. Detect the shell (PowerShell on Windows). Never `npm install` and push the result; `package.json` only.
- [ ] Confirm the DB snapshot task is `State: Ready` (CLAUDE.md backup rule 2) before Part 3.
- [ ] Part 0 is a read-only report. No code before it is on the branch.

## Goal
Simulate v2 is a multi-zone hourly model built standalone in nza-sim, consumed later by decodED through a shared identity, a shared building key and a small results contract. Before any engine or zone UI exists, the shape everything else plugs into has to exist and be verified end to end with today's engine: one schema for the model document, a content hash that makes every result reproducible, Postgres tables for projects, buildings, model versions, library items and runs, and sign-in through decodED's organisations. When this brief closes, pressing one button in today's NZA Sim saves the current building as a model version in Supabase, records today's instant-engine result against it, and the Bridgewater anchor (EUI 132.6) is readable back from the `runs` table with the hashes that produced it.

## Why this, decisions already agreed (Chris, 13 to 14 Nov 2026)
- **Standalone first** (14 Nov 15:10): the from-scratch tool matters in its own right; decodED is an adapter later. The engine and the tool live in nza-sim.
- **Ground-up architecture, accepted in full** (15:34): one TypeScript engine package, pure, browser worker and Node; one zod schema for the model document and one for results; Postgres on Supabase instead of SQLite plus JSON files; `model_versions` immutable; `runs` keyed `(model_hash, engine_version, library_hash, weather_hash)`; organisations, users and RLS on decodED's model; Node runner and EnergyPlus container later; Vercel + Supabase + Render; no microservices, no second engine language, no design-system rewrite.
- **One identity, one building key, one results contract per tool** (15:50): every NZA tool uses decodED's auth and organisations; decodED's building identity is the foreign key; each tool exposes a read-only summary per building. This brief lays identity and the building key; the results contract lands with Results 1.
- **Same inputs, same number, forever.** A changed number must always have a named cause: a new model hash, a new engine version, a new library version or a new weather file. This is the trust feature the whole tool is sold on.
- **Today's tool keeps working untouched** until Engine 4's referee run passes. Nothing in this brief changes a number the current UI shows; the 505 and Bridgewater work must open and match before and after.
- **Default decided here, confirm in Part 0:** Simulate's tables live in decodED's Supabase project (the dev project now, the prod project when decodED's hardening milestone creates it) in their own schema `sim`, with RLS written on decodED's `memberships` and helper functions. Migrations for the `sim` schema live in this repo (`supabase/migrations/sim_NNNN_*.sql`) and touch nothing in `public`. Rationale: Supabase auth is per project, so one identity means one project; schemas keep the tools' tables apart; migration histories stay separate by prefix and by schema. The alternative (own project, federated auth) was rejected as a second identity in disguise. If Part 0 finds a reason this cannot hold (a decodED rule, a project limit), stop and report before Part 2.

## Scope
IN
- `frontend/src/thermal/schema/`: the model document schema (zod) and the results schema, versioned; a canonical serialiser and `modelHash`; a converter from today's `building_config` to a single-zone model document; tests.
- `supabase/migrations/sim_0001_foundations.sql`: schema `sim`; tables `projects`, `buildings`, `model_versions`, `library_items`, `runs`; RLS; one security-definer function per write; grants to `authenticated` only.
- Sign-in in the frontend with decodED's Supabase project (anon key via env, public by design); an organisation switcher reading `my_access()`; the current local-SQLite flow stays the default when the env is unset.
- Library export: a one-shot, idempotent script that reads the local SQLite library and writes `sim.library_items` rows with provenance; the local library stays the source for today's UI.
- One button in today's UI, "Save as model version", and the recording of the current instant-engine result into `sim.runs` with `engine_version = 'instant-1'`.
- A read script that proves the anchor round-trips: fixture → model document → hash → stored version → stored run → EUI 132.6.
- `CLAUDE.md` section "Simulate v2 (Brief 102 onward)" and `.env.example` names; `STATUS.md`; audit doc `docs/audit/102/`.

OUT
- The engine (Engine 1 to 4), zones, surfaces UI, the plan drawer, groups, roofs, EPW chooser, the Node runner, the EnergyPlus container, the results endpoint for decodED, Pablo. Each is its own brief in the design note's sequence.
- Any change to `instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `nza_engine/`, the geometry generators, the design system, the sidebar or routing.
- Migrating projects or scenarios off SQLite. Only the library is exported, and only as a copy.
- Anything in decodED's `public` schema or decodED's repo.

## Principles and constraints
- **Schema is the contract** (CLAUDE.md rule 4, restated for v2): the model document is the only thing that crosses between any UI, the engine and storage. The converter from `building_config` is one-way and lossless for the fields the single-zone engine reads; it is also the first fixture for Engine 1.
- **Canonical serialisation.** `modelHash = sha256(canonicalJSON(document))` where canonical JSON sorts keys, drops `undefined`, normalises numbers (no `-0`, no trailing zeros beyond the stored precision), and excludes nothing else. Two documents that differ in key order hash the same; two that differ in one U-value do not. Test both.
- **Immutable versions.** `model_versions` rows are never updated; a change is a new row with `parent_id`. `runs` rows are never updated; a re-run with the same four hashes is a cache hit, not a new row.
- **RLS on every table; writes through security-definer functions only; anon key public by design** (decodED's rules, inherited the day we join its identity). No service-role key anywhere in this repo. No key in code, Notion or a log; names in `.env.example`, values in Bitwarden org "NZA".
- **Never develop against live user data.** decodED's dev Supabase project only. The migration is applied by Chris (or by an agent with the Supabase MCP against the dev project, read back to confirm), never by a script in CI.
- **No synthetic data** (rule 2): the only run recorded is a real instant-engine result for a real stored version.
- **One canonical read path** (rule 11): `readModelledEui` stays the one EUI read; the stored run copies its value from that read, with the read path named in the row's `source` field.
- **Rebuild, not refactor** (rule 12): the schema package is new code with no imports from `instantCalc.js` except the one engine call in Part 5.

## Parts (one commit each; push after every Part)

### Part 0 — Reconnaissance report (no code)
Write `docs/audit/102/00_reconnaissance.md`: (a) the exact set of `building_config` fields the single-zone engine reads (from `_calculateState3` and its helpers; list, do not summarise); (b) the library tables and columns in `api/db/schema.sql`, with row counts from the live DB (read-only) and which are referenced by `library_id` from configs; (c) decodED's tenancy functions and the shape of `my_access()`; (d) whether decodED's dev Supabase project can host a `sim` schema under decodED's rules (quote the rule if not); (e) confirm the anchor path: `scripts/_brief93_anchor.mjs --fixture` prints 132.6 today, with the SHA; (f) the frontend's current auth, if any, and the env plumbing (`import.meta.env`).
Commit: `102 P0: reconnaissance report`. Done when: the report is on the branch and nothing else changed.

### Part 1 — The model document, the results shape and the hash
Files (new): `frontend/src/thermal/schema/model.ts` (zod: `ModelDocument { schema_version: '2.0', building { id, name, decoded_building_key: string | null, site { lat, lon, exposure } }, zones[], surfaces[], system_groups[], profiles[], weather_ref { kind: 'epw', station_id, file_hash } | { kind: 'legacy', id }, library_refs { item_id: version }[] }` with the zone, surface, system-group and profile shapes from the design note's "Engine data contract"), `results.ts` (per hour per zone temperatures and demands; per hour per system group delivered and fuel; annual by end use × fuel; per zone; per system; building total; `breakdown[]` lines; `meta { model_hash, engine_version, library_hash, weather_hash, engine_ms }`), `canonical.ts` (`canonicalJSON`, `sha256` via Web Crypto in the browser and `node:crypto` in Node, one implementation each, same output), `hash.ts` (`modelHash`, `libraryHash(refs)`, `weatherHash(ref)`), `fromBuildingConfig.ts` (today's `building_config` + `systems_config_v40` → a one-zone `ModelDocument`: the box becomes one zone with four wall surfaces (azimuths from `orientation`), four glazing surfaces (WWR), a roof, a ground floor; openings and vents carried per surface; profiles carried by reference; systems become system groups over the one zone), `index.ts`; tests in `frontend/src/thermal/schema/__tests__/` with vitest added to `frontend/package.json` devDependencies and a `"test": "vitest run"` script.
Tests that must pass: key order does not change the hash; one U-value does; the Bridgewater anchor fixture converts without loss (every field the engine reads is present in the document, by the Part 0 list, asserted field by field); converting twice gives the same hash; the schema rejects a zone with no surfaces and a surface naming a zone that does not exist.
Commit: `102 P1: the model document schema, results shape, canonical hash and the building_config converter`.

### Part 2 — The `sim` schema in Supabase
Files (new): `supabase/migrations/sim_0001_foundations.sql`; `supabase/README.md` (how to apply against the dev project, how to read back, never prod by hand); `docs/audit/102/02_schema.md` (the ER sketch and the RLS table).
Schema: `create schema sim;` tables
- `sim.projects (id uuid pk, org_id uuid not null references public.organisations, name text, created_by uuid, created_at)`
- `sim.buildings (id uuid pk, project_id → sim.projects, name text, decoded_building_key text null, created_at)`; unique `(project_id, decoded_building_key)` where not null
- `sim.model_versions (id uuid pk, building_id → sim.buildings, parent_id uuid null → sim.model_versions, schema_version text, document jsonb not null, model_hash text not null, library_hash text not null, weather_hash text not null, note text, created_by uuid, created_at)`; index on `model_hash`
- `sim.library_items (id uuid pk, org_id uuid null (null = NZA global), kind text check (kind in ('construction','profile','system_template','age_band_default','weather')), key text, version int, body jsonb, provenance jsonb (source, date, who), created_at)`; unique `(coalesce(org_id, '00000000-...'), kind, key, version)`
- `sim.runs (id uuid pk, model_version_id → sim.model_versions, model_hash, engine_version, library_hash, weather_hash, results jsonb, summary jsonb (eui_kwh_m2, annual_by_end_use, annual_by_fuel), source text, created_at)`; unique `(model_hash, engine_version, library_hash, weather_hash)`
RLS: enable on all five; select where `public.can_read_org(org)` through the project; writes only through `sim.create_project(p_org, p_name)`, `sim.create_building(...)`, `sim.create_model_version(...)` (computes nothing; stores what the client sends and rejects a row whose `model_hash` is not the sha256 of the canonical document, computed in SQL with `digest(...)`), `sim.record_run(...)` (upsert on the four-hash key, returns the existing row on a hit), `sim.upsert_library_item(...)` (NZA team or org admin); all security definer, `revoke all ... from anon`, grant execute to `authenticated`. No table is writable directly.
Verification: apply to the dev project (Chris, or the Supabase MCP), then as an authenticated member of a test organisation: create a project, a building, a version with a correct hash (accepted) and one with a wrong hash (rejected), a run twice (second returns the first's id); as a member of another organisation: select returns nothing; as anon: every call fails. Print the results into the audit doc.
Commit: `102 P2: the sim schema, RLS and write functions`.

### Part 3 — Library export with provenance
Files (new): `scripts/102_export_library.py` (reads the local SQLite library read-only: constructions, system templates, profiles, schedules, weather file records; writes `docs/audit/102/library_export.json` with a provenance block per item: `source: 'nza-sim sqlite', exported_at, machine, brief: 102`; idempotent; never writes to SQLite); `scripts/102_seed_library.mjs` (reads that JSON and calls `sim.upsert_library_item` as the NZA team user; dry-run by default, `--apply` to write; prints counts per kind).
Verification: stop the dev server first (CLAUDE.md process rule 11); row counts per kind in the JSON equal the Part 0 counts; the seed's dry run prints the same counts; after `--apply`, a select by kind returns them; running `--apply` twice adds no rows.
Commit: `102 P3: library exported to sim.library_items with provenance`.

### Part 4 — Sign-in with decodED's identity
Files: `frontend/package.json` (+ `@supabase/supabase-js`), `frontend/src/auth/supabase.ts` (new: client from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; null when unset), `frontend/src/auth/AuthGate.tsx` (new: sign-in with the same email flow decodED uses; organisation switcher from `my_access()`; shows the organisation's name in the top bar; when the env is unset, renders children unchanged so today's tool runs exactly as before), `frontend/src/main.jsx` (wrap in `AuthGate` only), `frontend/.env.example` (the two names), `CLAUDE.md` (the new section: env names, dev project only, anon key public by design, no service role, Bitwarden).
Verification: with env unset, the app is byte-for-byte today's behaviour (build, open ZZ TEST, EUI unchanged); with env set, sign in as a dev-project user, see the organisation, sign out; a user with no membership sees "no organisation" and the local tool, not an error.
Commit: `102 P4: sign-in and organisation through decodED's Supabase`.

### Part 5 — Save as model version, record today's result
Files: `frontend/src/thermal/store/versions.ts` (new: `saveModelVersion(doc, note)`, `recordRun(versionId, results, summary, engineVersion, source)`), `frontend/src/components/.../SaveModelVersionButton.jsx` (new, one button on the Systems page, visible only when signed in: converts the live `building_config` + `systems_config_v40` with `fromBuildingConfig`, stores the version, then calls the existing `calculateInstant` through its existing entry point with the existing options, reads EUI through `readModelledEui`, stores the run with `engine_version: 'instant-1'`, `library_hash` from the library refs, `weather_hash` of the legacy weather id, `source: 'engineReads.readModelledEui'`; shows the version id and the hash), `scripts/102_anchor_roundtrip.mjs` (new: loads `bridgewater_anchor_v2.yaml`, converts, hashes, reads the matching `sim.runs` row for `instant-1`, prints the stored EUI and the hash; exits non-zero unless the EUI is 132.6 and the hash matches a fresh conversion).
Verification: on ZZ TEST, press the button twice: two versions if the config changed, one if not; the second run on an unchanged config returns the first run's id; `node scripts/102_anchor_roundtrip.mjs` prints `132.6` and `match`; `scripts/_brief93_anchor.mjs --fixture` still prints 132.6 (engine untouched).
Commit: `102 P5: save as model version and record the instant-engine run`.

### Part 6 — Close
Files: `STATUS.md` (close-out with the numbers above and the Part 0 decision as taken), `docs/briefs/current.md` (repointed), `git mv docs/briefs/active/102_simulate-v2-foundations.md docs/briefs/archive/102_simulate-v2-foundations_COMPLETED.md`, `docs/audit/102/` complete; PR titled `102 — Simulate v2 Foundations` into `main`; final report with divergences and Lessons proposals.
Commit: `102 P6: close`.

## Verification (the walkthrough Chris does)
1. Today's tool, env unset: ZZ TEST opens, Systems EUI unchanged from `main`; `_brief93_anchor.mjs --fixture` prints 132.6.
2. `npm test` in `frontend/`: the hash tests and converter tests pass; the field-by-field anchor coverage test lists every engine-read field.
3. Supabase dev project: the five `sim` tables exist with RLS on; anon calls fail; a wrong-hash version is rejected with a message that names the hash.
4. Library: counts per kind in Supabase equal the local SQLite counts from Part 0; every row has provenance.
5. Signed in: the organisation shows in the top bar; "Save as model version" stores a version; pressing again on an unchanged config stores nothing new; the run row carries `engine_version instant-1` and the four hashes.
6. `scripts/102_anchor_roundtrip.mjs` prints `132.6 match`.
7. `git diff main...HEAD --stat` touches no engine file (`instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `nza_engine/`).
8. No key in the diff; `.env.example` has the two names only.

## What MUST NOT happen
- No edit to any engine file or generator; no change to a number today's UI shows.
- No service-role key in this repo, a laptop `.env`, a log or Notion. No write to decodED's `public` schema. No migration applied to a prod project.
- No `npm install` pushed; `package.json` only. No `git rebase`, `reset --hard`, `clean` or force push (CLAUDE.md git rules).
- No synthetic run, no placeholder library item, no default written where a field is missing: a missing field fails loudly with its path.
- No second exposure of EUI; the stored summary copies the canonical read.
- No work on zones, surfaces, UI beyond the one button, or the engine. Those are the next briefs.

## When to escalate / stop
- Part 0 (d) finds a decodED rule or a Supabase limit that forbids a `sim` schema in decodED's project: stop before Part 2 with the quote and the options.
- The Part 0 field list has a field the converter cannot place in the model document without inventing a concept: stop and show the field.
- The anchor does not round-trip at 132.6: stop; do not adjust the converter or the engine to make it match; report which field differed.
- Three approaches to any step have failed (CLAUDE.md process rule 4).

## Independent review
Mandatory before close: schema, hash and RLS are data-flow and security. Claude Chat reads `canonical.ts`, `hash.ts`, `fromBuildingConfig.ts`, `sim_0001_foundations.sql` and `SaveModelVersionButton.jsx` against this brief's intent and the design note, and signs the PR.

## Close
Archive this brief, `STATUS.md` close-out, `current.md` repointed, one push; final report: what diverged, what was better than the brief, what to codify (Lessons database, Proposed). The next brief is Engine 1: the pure engine package, a single zone from the model document, EPW parser, analytic fixtures, the box reproducing the anchor.
