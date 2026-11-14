# Brief 102 — Simulate v2 Foundations: the model document, its hash, NZA Sim's own database and identity

Rev B · 14 Nov 2026 (Rev A withdrawn the same day: it put Simulate's tables inside decodED's Supabase project; that over-read "stay in the decodED ecosystem" into "live in decodED's database", and Part 0 found decodED's dev project live with real users since 5 Nov. Rev B: NZA Sim has its own Supabase project and its own identity; decodED linking is an explicit, optional integration.) · Chris Scott (product owner) with Claude Chat · branch `chris/102-sim-v2-foundations`
Design note (canonical if this brief and it disagree): Notion "Design note — Simulate: a zoned hourly energy model from the digital twin (Rev A, 14 Nov 2026)", page `418d645e-05cc-811e-ad6b-fa8846f12148`, Revs A to A.5 (the method, standalone first, the ground-up architecture, how tools join the decodED ecosystem, and Rev A.5: own database, own identity, linking as an integration).
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
Simulate v2 is a multi-zone hourly model built standalone in nza-sim, consumed later by decodED through a shared identity, a shared building key and a small results contract. Before any engine or zone UI exists, the shape everything else plugs into has to exist and be verified end to end with today's engine: one schema for the model document, a content hash that makes every result reproducible, Postgres tables for organisations, projects, buildings, model versions, library items and runs in NZA Sim's own Supabase project, and NZA Sim's own sign-in. When this brief closes, pressing one button in today's NZA Sim saves the current building as a model version, records today's instant-engine result against it, and the Bridgewater anchor (EUI 132.6) is readable back from the `runs` table with the hashes that produced it. A client who has never heard of decodED can use every part of this.

## Why this, decisions already agreed (Chris, 13 to 14 Nov 2026)
- **Standalone first** (14 Nov 15:10): the from-scratch tool matters in its own right; decodED is an adapter later. The engine and the tool live in nza-sim.
- **Ground-up architecture, accepted in full** (15:34): one TypeScript engine package, pure, browser worker and Node; one zod schema for the model document and one for results; Postgres on Supabase instead of SQLite plus JSON files; `model_versions` immutable; `runs` keyed `(model_hash, engine_version, library_hash, weather_hash)`; organisations, users and RLS on decodED's model; Node runner and EnergyPlus container later; Vercel + Supabase + Render; no microservices, no second engine language, no design-system rewrite.
- **NZA Sim is its own product with its own database and identity** (Chris, 14 Nov 14:38 "an external tool", 15:10 "standalone", and the 17:30 correction after Part 0). It must work for clients who never use decodED. **Linking to decodED is an explicit, optional integration**: a decodED organisation connects to an NZA Sim organisation; the building key is carried on NZA Sim's side; decodED reads a small results contract through the link (brief 113). Only linking data lives on the decodED side. Rev A's "one Supabase project for every NZA tool" is withdrawn.
- **Same inputs, same number, forever.** A changed number must always have a named cause: a new model hash, a new engine version, a new library version or a new weather file. This is the trust feature the whole tool is sold on.
- **Today's tool keeps working untouched** until Engine 4's referee run passes. Nothing in this brief changes a number the current UI shows; the 505 and Bridgewater work must open and match before and after.
- **Database: a new Supabase project "NZA Sim" (dev now; a prod project before the first client is onboarded), never NZA Decoded.** Part 0 found NZA Decoded live with real users since 5 Nov 2026; nothing in this brief touches it or NZA Decoded Test. NZA Sim's migrations live in this repo (`supabase/migrations/0001_*.sql`), own `public` schema, own auth. The tenancy pattern is copied from decodED's `0003_tenancy.sql` and `0008_access.sql` as a pattern (organisations, memberships with roles, `caller_id`, `role_in`, `can_read_org`, `is_admin_of`, security-definer writes, RLS everywhere), not shared as a database.
- **How a decodED user connects (sketch, built in brief 113, designed now so the tables allow it):** a decodED organisation admin opens "Connect NZA Sim" in decodED, which shows a one-time link code; an NZA Sim organisation admin pastes it in NZA Sim (or the NZA team does it for them); NZA Sim stores `org_links (org_id, decoded_org_id, token_hash, created_by, created_at)` and issues a scoped read token; decodED stores only `(decoded_org_id, sim_org_id, token)` on its side; decodED's card calls NZA Sim's results endpoint with that token for a building whose `decoded_building_key` matches; "Open in NZA Sim" deep-links to the building and the user signs in to NZA Sim with their own account (same email is convenient, not required). No decodED table, function or key is read by NZA Sim at any point.

## Scope
IN
- `frontend/src/thermal/schema/`: the model document schema (zod) and the results schema, versioned; a canonical serialiser and `modelHash`; a converter from today's `building_config` to a single-zone model document; tests.
- `supabase/migrations/0001_tenancy.sql` and `0002_model_store.sql` in NZA Sim's own project: `profiles`, `organisations`, `memberships`, `invitations`, `org_links` (the optional decodED link, empty until brief 113), then `projects`, `buildings`, `model_versions`, `library_items`, `runs`; RLS; one security-definer function per write; grants to `authenticated` only.
- Sign-in in the frontend with NZA Sim's own Supabase project (anon key via env, public by design because RLS is on every table); NZA Sim's own organisations and memberships; an organisation switcher; the current local-SQLite flow stays the default when the env is unset.
- Library export: a one-shot, idempotent script that reads the local SQLite library and writes `sim.library_items` rows with provenance; the local library stays the source for today's UI.
- One button in today's UI, "Save as model version", and the recording of the current instant-engine result into `sim.runs` with `engine_version = 'instant-1'`.
- A read script that proves the anchor round-trips: fixture → model document → hash → stored version → stored run → EUI 132.6.
- `CLAUDE.md` section "Simulate v2 (Brief 102 onward)" and `.env.example` names; `STATUS.md`; audit doc `docs/audit/102/`.

OUT
- The engine (Engine 1 to 4), zones, surfaces UI, the plan drawer, groups, roofs, EPW chooser, the Node runner, the EnergyPlus container, the results endpoint for decodED, Pablo. Each is its own brief in the design note's sequence.
- Any change to `instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `nza_engine/`, the geometry generators, the design system, the sidebar or routing.
- Migrating projects or scenarios off SQLite. Only the library is exported, and only as a copy.
- Anything in any decodED Supabase project (NZA Decoded, NZA Decoded Test) or decodED's repo. The decodED side of the link (its card, its stored token) is brief 113, in nza-decoded.

## Principles and constraints
- **Schema is the contract** (CLAUDE.md rule 4, restated for v2): the model document is the only thing that crosses between any UI, the engine and storage. The converter from `building_config` is one-way and lossless for the fields the single-zone engine reads; it is also the first fixture for Engine 1.
- **Canonical serialisation.** `modelHash = sha256(canonicalJSON(document))` where canonical JSON sorts keys, drops `undefined`, normalises numbers (no `-0`, no trailing zeros beyond the stored precision), and excludes nothing else. Two documents that differ in key order hash the same; two that differ in one U-value do not. Test both.
- **Immutable versions.** `model_versions` rows are never updated; a change is a new row with `parent_id`. `runs` rows are never updated; a re-run with the same four hashes is a cache hit, not a new row.
- **RLS on every table; writes through security-definer functions only; anon key public by design** (the same rules decodED runs by, adopted as NZA Sim's own). No service-role key anywhere in this repo. No key in code, Notion or a log; names in `.env.example`, values in Bitwarden org "NZA".
- **Never develop against live user data.** NZA Sim's own dev project only; NZA Decoded is live and is never touched. The migration is applied by Chris (or by an agent with the Supabase MCP against the NZA Sim dev project, read back to confirm), never by a script in CI. A prod project is created, with the same migrations, before the first client is onboarded; dev and prod never share a key.
- **No synthetic data** (rule 2): the only run recorded is a real instant-engine result for a real stored version.
- **One canonical read path** (rule 11): `readModelledEui` stays the one EUI read; the stored run copies its value from that read, with the read path named in the row's `source` field.
- **Rebuild, not refactor** (rule 12): the schema package is new code with no imports from `instantCalc.js` except the one engine call in Part 5.

## Parts (one commit each; push after every Part)

### Part 0 — Reconnaissance report (no code)
Write `docs/audit/102/00_reconnaissance.md` (Rev A's Part 0 is done and stands; add to it): (a) the exact set of `building_config` fields the single-zone engine reads (from `_calculateState3` and its helpers; list, do not summarise); (b) the library tables and columns in `api/db/schema.sql`, with row counts from the live DB (read-only) and which are referenced by `library_id` from configs; (c) decodED's tenancy pattern as a pattern to copy (functions, roles, security-definer writes); (d) the Supabase organisation's project list and whether an "NZA Sim" dev project exists (create it if Chris says so; name it "NZA Sim (dev)"; region same as NZA Decoded); (e) confirm the anchor path: `scripts/_brief93_anchor.mjs --fixture` prints 132.6 today, with the SHA; (f) the frontend's current auth, if any, and the env plumbing (`import.meta.env`).
Commit: `102 P0: reconnaissance report`. Done when: the report is on the branch and nothing else changed.

### Part 1 — The model document, the results shape and the hash
Files (new): `frontend/src/thermal/schema/model.ts` (zod: `ModelDocument { schema_version: '2.0', building { id, name, decoded_building_key: string | null, site { lat, lon, exposure } }, zones[], surfaces[], system_groups[], profiles[], weather_ref { kind: 'epw', station_id, file_hash } | { kind: 'legacy', id }, library_refs { item_id: version }[] }` with the zone, surface, system-group and profile shapes from the design note's "Engine data contract"), `results.ts` (per hour per zone temperatures and demands; per hour per system group delivered and fuel; annual by end use × fuel; per zone; per system; building total; `breakdown[]` lines; `meta { model_hash, engine_version, library_hash, weather_hash, engine_ms }`), `canonical.ts` (`canonicalJSON`, `sha256` via Web Crypto in the browser and `node:crypto` in Node, one implementation each, same output), `hash.ts` (`modelHash`, `libraryHash(refs)`, `weatherHash(ref)`), `fromBuildingConfig.ts` (today's `building_config` + `systems_config_v40` → a one-zone `ModelDocument`: the box becomes one zone with four wall surfaces (azimuths from `orientation`), four glazing surfaces (WWR), a roof, a ground floor; openings and vents carried per surface; profiles carried by reference; systems become system groups over the one zone), `index.ts`; tests in `frontend/src/thermal/schema/__tests__/` with vitest added to `frontend/package.json` devDependencies and a `"test": "vitest run"` script.
Tests that must pass: key order does not change the hash; one U-value does; the Bridgewater anchor fixture converts without loss (every field the engine reads is present in the document, by the Part 0 list, asserted field by field); converting twice gives the same hash; the schema rejects a zone with no surfaces and a surface naming a zone that does not exist.
Commit: `102 P1: the model document schema, results shape, canonical hash and the building_config converter`.

### Part 2 — NZA Sim's own tenancy and model store
Files (new): `supabase/migrations/0001_tenancy.sql`, `supabase/migrations/0002_model_store.sql`; `supabase/README.md` (which project, how to apply against NZA Sim (dev), how to read back, never NZA Decoded, never prod by hand); `docs/audit/102/02_schema.md` (the ER sketch and the RLS table).
`0001_tenancy.sql`, copied as a pattern from decodED's `0003_tenancy.sql` and trimmed (no schools, no claim rules, no consents):
- `profiles (id uuid pk references auth.users, display_name, created_at)`
- `organisations (id uuid pk, name text, created_by, created_at)`
- `memberships (org_id, user_id, role text check (role in ('admin','editor','viewer')), pk (org_id, user_id))`
- `invitations (id, org_id, email, role, token_hash, expires_at, accepted_at)`
- `org_links (id, org_id → organisations, decoded_org_id uuid, token_hash text, created_by, created_at, revoked_at)` for the optional decodED link; no rows written by this brief
- functions `caller_id()`, `role_in(org)`, `can_read_org(org)`, `is_admin_of(org)`, `is_nza_team()` (an allow-list table `nza_team (user_id)`), `create_organisation(p_name)`, `invite_member`, `accept_invitation_token`, `set_member_role`, `remove_member`, `my_access()` returning the caller's organisations and roles; all security definer; `revoke all from anon`; execute to `authenticated`.
`0002_model_store.sql`:
- `projects (id uuid pk, org_id → organisations, name, created_by, created_at)`
- `buildings (id uuid pk, project_id → projects, name, decoded_building_key text null, created_at)`; unique `(project_id, decoded_building_key)` where not null
- `model_versions (id uuid pk, building_id → buildings, parent_id null → model_versions, schema_version text, document jsonb not null, model_hash text not null, library_hash text not null, weather_hash text not null, note text, created_by, created_at)`; index on `model_hash`
- `library_items (id uuid pk, org_id uuid null (null = NZA global), kind text check (kind in ('construction','profile','system_template','age_band_default','weather')), key text, version int, body jsonb, provenance jsonb (source, date, who), created_at)`; unique `(coalesce(org_id, '00000000-0000-0000-0000-000000000000'), kind, key, version)`
- `runs (id uuid pk, model_version_id → model_versions, model_hash, engine_version, library_hash, weather_hash, results jsonb, summary jsonb (eui_kwh_m2, annual_by_end_use, annual_by_fuel), source text, created_at)`; unique `(model_hash, engine_version, library_hash, weather_hash)`
RLS: enable on every table; select where `can_read_org(org)` through the project (global library items readable by any authenticated user); writes only through `create_project(p_org, p_name)`, `create_building(...)`, `create_model_version(...)` (computes nothing; stores what the client sends and rejects a row whose `model_hash` is not the sha256 of the canonical document, computed in SQL with `digest(...)`), `record_run(...)` (upsert on the four-hash key, returns the existing row on a hit), `upsert_library_item(...)` (NZA team for global, org admin for org-scoped); all security definer, `revoke all ... from anon`, grant execute to `authenticated`. No table is writable directly.
Verification: apply to NZA Sim (dev) (Chris, or the Supabase MCP), then as an authenticated member of a test organisation: create a project, a building, a version with a correct hash (accepted) and one with a wrong hash (rejected), a run twice (second returns the first's id); as a member of another organisation: select returns nothing; as anon: every call fails. Print the results into the audit doc.
Commit: `102 P2: the sim schema, RLS and write functions`.

### Part 3 — Library export with provenance
Files (new): `scripts/102_export_library.py` (reads the local SQLite library read-only: constructions, system templates, profiles, schedules, weather file records; writes `docs/audit/102/library_export.json` with a provenance block per item: `source: 'nza-sim sqlite', exported_at, machine, brief: 102`; idempotent; never writes to SQLite); `scripts/102_seed_library.mjs` (reads that JSON and calls `sim.upsert_library_item` as the NZA team user; dry-run by default, `--apply` to write; prints counts per kind).
Verification: stop the dev server first (CLAUDE.md process rule 11); row counts per kind in the JSON equal the Part 0 counts; the seed's dry run prints the same counts; after `--apply`, a select by kind returns them; running `--apply` twice adds no rows.
Commit: `102 P3: library exported to sim.library_items with provenance`.

### Part 4 — NZA Sim's own sign-in
Files: `frontend/package.json` (+ `@supabase/supabase-js`), `frontend/src/auth/supabase.ts` (new: client from `VITE_NZASIM_SUPABASE_URL` and `VITE_NZASIM_SUPABASE_ANON_KEY`; null when unset), `frontend/src/auth/AuthGate.tsx` (new: email magic-link sign-in; first sign-in with no organisation offers "Create your organisation" (calls `create_organisation`) or "I have an invitation"; organisation switcher from `my_access()`; the organisation's name in the top bar; when the env is unset, renders children unchanged so today's tool runs exactly as before), `frontend/src/main.jsx` (wrap in `AuthGate` only), `frontend/.env.example` (the two names), `CLAUDE.md` (the new section: NZA Sim's own project, env names, dev only until a prod project exists, anon key public by design, no service role, Bitwarden; the decodED link is brief 113 and reads nothing from decodED's database).
Verification: with env unset, the app is byte-for-byte today's behaviour (build, open ZZ TEST, EUI unchanged); with env set, a brand-new email signs in, creates an organisation, sees it in the top bar, invites a second email as viewer, signs out; the viewer sees the organisation and cannot create a project; a user with no membership sees the create-or-invitation screen, not an error. Nothing decodED appears anywhere.
Commit: `102 P4: NZA Sim's own sign-in and organisations`.

### Part 5 — Save as model version, record today's result
Files: `frontend/src/thermal/store/versions.ts` (new: `ensureProject(orgId)`, `ensureBuilding(projectId, name)`, `saveModelVersion(doc, note)`, `recordRun(versionId, results, summary, engineVersion, source)`), `frontend/src/components/.../SaveModelVersionButton.jsx` (new, one button on the Systems page, visible only when signed in with an organisation: converts the live `building_config` + `systems_config_v40` with `fromBuildingConfig`, stores the version, then calls the existing `calculateInstant` through its existing entry point with the existing options, reads EUI through `readModelledEui`, stores the run with `engine_version: 'instant-1'`, `library_hash` from the library refs, `weather_hash` of the legacy weather id, `source: 'engineReads.readModelledEui'`; shows the version id and the hash), `scripts/102_anchor_roundtrip.mjs` (new: loads `bridgewater_anchor_v2.yaml`, converts, hashes, reads the matching `sim.runs` row for `instant-1`, prints the stored EUI and the hash; exits non-zero unless the EUI is 132.6 and the hash matches a fresh conversion).
Verification: on ZZ TEST, press the button twice: two versions if the config changed, one if not; the second run on an unchanged config returns the first run's id; `node scripts/102_anchor_roundtrip.mjs` prints `132.6` and `match`; `scripts/_brief93_anchor.mjs --fixture` still prints 132.6 (engine untouched).
Commit: `102 P5: save as model version and record the instant-engine run`.

### Part 6 — Close
Files: `STATUS.md` (close-out with the numbers above and the Part 0 decision as taken), `docs/briefs/current.md` (repointed), `git mv docs/briefs/active/102_simulate-v2-foundations.md docs/briefs/archive/102_simulate-v2-foundations_COMPLETED.md`, `docs/audit/102/` complete; PR titled `102 — Simulate v2 Foundations` into `main`; final report with divergences and Lessons proposals.
Commit: `102 P6: close`.

## Verification (the walkthrough Chris does)
1. Today's tool, env unset: ZZ TEST opens, Systems EUI unchanged from `main`; `_brief93_anchor.mjs --fixture` prints 132.6.
2. `npm test` in `frontend/`: the hash tests and converter tests pass; the field-by-field anchor coverage test lists every engine-read field.
3. NZA Sim (dev): the tenancy and model-store tables exist with RLS on; anon calls fail; a member of another organisation reads nothing; a wrong-hash version is rejected with a message that names the hash. NZA Decoded and NZA Decoded Test show no change (confirm by listing their schemas before and after).
4. Library: counts per kind in Supabase equal the local SQLite counts from Part 0; every row has provenance.
5. Signed in with an NZA Sim account and organisation (no decodED account involved): the organisation shows in the top bar; "Save as model version" stores a version; pressing again on an unchanged config stores nothing new; the run row carries `engine_version instant-1` and the four hashes.
6. `scripts/102_anchor_roundtrip.mjs` prints `132.6 match`.
7. `git diff main...HEAD --stat` touches no engine file (`instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `nza_engine/`).
8. No key in the diff; `.env.example` has the two names only.

## What MUST NOT happen
- No edit to any engine file or generator; no change to a number today's UI shows.
- No service-role key in this repo, a laptop `.env`, a log or Notion. No read or write to any decodED Supabase project (NZA Decoded is live). No migration applied to a prod project.
- No `npm install` pushed; `package.json` only. No `git rebase`, `reset --hard`, `clean` or force push (CLAUDE.md git rules).
- No synthetic run, no placeholder library item, no default written where a field is missing: a missing field fails loudly with its path.
- No second exposure of EUI; the stored summary copies the canonical read.
- No work on zones, surfaces, UI beyond the one button, or the engine. Those are the next briefs.

## When to escalate / stop
- No "NZA Sim (dev)" project exists and Chris has not said to create one: stop before Part 2.
- Any step would need a decodED table, function, key or project: stop; that is brief 113's territory and it is designed as an integration, not a dependency.
- The Part 0 field list has a field the converter cannot place in the model document without inventing a concept: stop and show the field.
- The anchor does not round-trip at 132.6: stop; do not adjust the converter or the engine to make it match; report which field differed.
- Three approaches to any step have failed (CLAUDE.md process rule 4).

## Independent review
Mandatory before close: schema, hash and RLS are data-flow and security. Claude Chat reads `canonical.ts`, `hash.ts`, `fromBuildingConfig.ts`, `sim_0001_foundations.sql` and `SaveModelVersionButton.jsx` against this brief's intent and the design note, and signs the PR.

## Close
Archive this brief, `STATUS.md` close-out, `current.md` repointed, one push; final report: what diverged, what was better than the brief, what to codify (Lessons database, Proposed). The next brief is Engine 1: the pure engine package, a single zone from the model document, EPW parser, analytic fixtures, the box reproducing the anchor.
