# Brief 102 — independent QA of the Simulate v2 foundations

PR nza-hq/nza-sim#26, branch `chris/102-sim-v2-foundations` at `929291e`. 14 Nov 2026. Read-only: no code changed, nothing pushed, no PR comment, no Supabase project touched.

## In plain English

The foundations mostly hold up. The tests pass (13/13). The anchor document hashes the same in the browser code and in the database function. Row-level security blocks anonymous users and other organisations, and nothing can be written to a table directly. When I re-ran today's engine on the frozen Bridgewater fixture, with the real weather file (sha256 matches), it gave **132.6**.

Things to fix before relying on it:

1. **The "same inputs, same number" promise has gaps.** The run key says `instant-1` whatever version of the engine produced the number. The weather is pinned by file name only. The built-in system templates are not pinned at all. Once the engine changes on `main`, pressing Save can return an old number as a cache hit.
2. **The database and the browser disagree on how to write very small or very large numbers.** A model with a value like `-2.8e-17`, which is normal floating-point noise from a slider or a sum, or any value below 0.000001, gets a different hash in SQL, and the save is refused. I proved this on Postgres 16.
3. **Run results are de-duplicated across all organisations, not within one.** If two organisations store the same document, the second one gets the first one's run id, which it cannot read. Its own version is left with no run. I proved this too.
4. **An organisation can end up with no admin.** An admin who accepts an invitation sent to their own email with a lower role is demoted, and the last-admin check never runs. I proved this.
5. **The anchor round trip has still not been proven against the real database.** The real-database evidence is for the live ZZ TEST save, and its hash is not the fixture's.

The details, ranked, are below. The second section explains how the old engine reaches 132.6, and what a reimplementation has to copy or knowingly drop.

---

## Findings, by severity

### High

**H1. The run cache key does not name everything that makes the number.** Cached runs can go stale.
- `frontend/src/thermal/store/versions.ts:15`: `engine_version = 'instant-1'` is a constant. `instantCalc.js`, `systemsEngine.js` and `systemTemplatesLibrary.js` are still edited on `main`, which is Chris's P02 work. Once the PR merges, a Save after any engine change returns the old run as a hit (`supabase/migrations/0002_model_store.sql:232-237`). If no run exists yet, it stores a different number under the same `instant-1` label. Either way, the promise that every changed number has a named cause breaks.
- `frontend/src/thermal/schema/fromBuildingConfig.ts:477-481` and `SaveModelVersionButton.jsx:140-146`: the button passes no `weather`, so every stored version uses `weather_ref {kind:'legacy', id:<file name>}`. Part 0 (divergence 10) and the Part 1 tests use the EPW sha256, but production does not. A different EPW saved under the same name keeps the same hash. The fixture also hashes differently depending on whether a hash was passed, which is part of why the button's hash is not the fixture's hash.
- `hash.ts` / `fromBuildingConfig.ts:184-191`: `library_refs` pins only the four constructions. The engine also needs `SYSTEM_TEMPLATES_LIBRARY`: an unknown v25 template id throws, as shown below. Those templates are not pinned anywhere.
- Fix: make `engine_version` carry a content hash of the engine files (or `__APP_SHA__`, which `vite.config.js` already defines), for example `instant-1+<sha>`. Pass the EPW sha256 from the library's `weather` item, whose `body.file_hash` is already seeded. Fold the JS template table into `library_refs` or into the engine version.

### Medium

**M1. SQL and JavaScript canonical JSON disagree on numbers.** The save is refused for some real projects.
- `supabase/migrations/0003_canonical_collation.sql:346` against `frontend/src/thermal/schema/canonical.ts:46`. JavaScript prints numbers below 1e-6 and from 1e21 up in exponent form (`5e-7`, `-2.7755575615628914e-17`). Postgres `numeric` prints digits (`0.0000005`).
- Verified on a local Postgres 16 with the three migrations applied:

  | case | result |
  |---|---|
  | anchor document | match |
  | anchor with one lighting schedule hour = `0.3-0.1-0.2` | **differs** |
  | `infiltration_ach = 5e-7` | **differs** |
  | `1e21` | **differs** |
  | keys outside the Basic Multilingual Plane (sort order) | **differs** |
  | `0.1+0.2`, `-0`, control characters | match |

- 0003 says "Model documents hold ordinary magnitudes". Float noise near zero is ordinary in UI-edited schedules. The failure is loud, not silent, so no wrong data gets in, but the user is blocked.
- Fix: the approach Part 0 proposed (divergence 3) and this thread's notes recorded. `create_model_version` takes the client's canonical text (`p_canonical`), checks `sha256(p_canonical)`, and stores `p_canonical::jsonb`. Alternatively, `canonicalJSON` can refuse or normalise exponent forms.

**M2. Runs are unique across organisations, and the document is not tied to its building.**
- `0002_model_store.sql:114`: `unique (model_hash, engine_version, library_hash, weather_hash)` is global. `record_run` (lines 232-237) runs as security definer, finds another organisation's row and returns its id.
- Verified: org B stored org A's document and called `record_run` with EUI 999. It got back A's run id. B can read 0 rows for that id, and B's own version has 0 runs.
- `create_model_version` (lines 180-210) does not check that `document->'building'->>'id'` equals `p_building`, or that `p_schema_version` equals `document->>'schema_version'` (verified: `'9.9'` accepted). Today the button sets `building.id` to the database id, so app users do not collide. Fixture-based callers do: the tests use `'bridgewater-anchor'`, and future Engine 1 runners may too.
- Fix: key runs per version or per organisation, or at least scope the hit lookup to the caller's organisation. Add the two equality checks.

**M3. An organisation can be left without an admin.**
- `0001_tenancy.sql:240-241`: `accept_invitation_token` upserts with `do update set role = excluded.role`.
- Verified: the only admin of Org A invited their own email as viewer and accepted. `admin_count` was then 0, and `set_member_role` and `remove_member` guard against exactly this.
- Fix: never downgrade on accept, or apply the `admin_count` guard there too.

**M4. NZA Sim projects and buildings are matched by name.**
- `versions.ts:23-40` and `SaveModelVersionButton.jsx:137-139`. Two local projects with the same name share one building and one version chain. Every unnamed project lands in "Untitled building". Renaming a project forks its history. Two concurrent first saves create duplicates, because there is no unique constraint.
- Fix: store the local project id on `buildings`, or key by it.

**M5. The anchor round trip is still unproven on the real database, and the script's "match" proves less than it says.**
- `docs/audit/102/05_save_version.md`: the real-database evidence is the live ZZ TEST save (`d8bb5408876e…`). By the doc's own account, that hash is not the fixture's hash. Brief verification step 6 (`132.6 match`) is open.
- `scripts/102_anchor_roundtrip.mjs:114-116`: `again === hash` compares two fresh conversions of the same fixture, which always match. It never re-hashes the stored `document`.
- Line 118: `eui === 132.6` is an exact float comparison. It works only because the engine rounds to one decimal place.
- Line 152: when the comfort band is missing, the script falls back to 20/26 °C, which Brief 58 A2 retired.
- Fix: have Chris's agent run `--record` and then a plain read once. Make "match" mean `modelHash(stored.document) === hash`.

**M6. `upsert_library_item` silently keeps the old body.**
- `0002_model_store.sql:267-273`. Verified: version 1 written with `{"u":1}`, then again with `{"u":999}`. Both calls returned the same id and the body stayed `{"u":1}`.
- The seed script guards against this by computing the next version. Any other caller loses its edit with no error.
- Fix: raise an error when the body differs.

**M7. The run summary's `not_itemised` line is really auxiliary, and missing values become 0.**
- `versions.ts:96-106`: `not_itemised` = 27,699 kWh, which is exactly the auxiliary external lighting: 1.5 W/m² × 4,216 m² × 8,760 h × 0.5. The engine exposes it at `heat_balance.annual.gains.internal.auxiliary.electricity_kwh`, so it can be a named `auxiliary` line (rule 9).
- `versions.ts:81`: `kwh()` turns a missing or non-finite value into 0, against the brief's rule that a missing field fails loudly.
- District heat is added to `by_fuel` (line 94) but not to the heating end use. It would fall into the remainder.

### Low

- **L1.** `record_run` selects, then inserts, with no `on conflict` (`0002:232-243`). Two runs racing on the same key raise 23505 instead of returning the existing row. Use `insert … on conflict do nothing returning`, then re-select.
- **L2.** `org_of_project`, `org_of_building`, `org_of_version`, `admin_count` and `role_in` can be executed by any signed-in user against any uuid (`0001:375-381`, `0002:313-319`). Verified: org B mapped A's building to A's organisation and read A's admin count. The uuids are unguessable, so this is minor, but these are internal helpers and do not need grants.
- **L3.** `AuthGate.tsx:104`: if `my_access` fails once, the user sees an error screen with no retry and no sign-out. With the env set, the local tool cannot be used when Supabase is unreachable, because the gate wraps the whole app.
- **L4.** `frontend/package-lock.json` does not contain `zod`, `@supabase/supabase-js` or `vitest`. That follows the "package.json only" rule, but `npm ci` on a fresh clone or a Vercel build will fail until the lock is regenerated. Plan for this at merge.
- **L5.** The seeded global library comes from the 17 Jul transfer-pack copy (`library_export.json`: machine `vm`, db `5a41bcf1…`), not from Chris's live library (`03_library.md` step 1). This is fine for dev. Re-export before prod.
- **L6.** Dev sign-up is open, so anyone with the URL can create organisations. There is no `revoke_invitation`. RLS has no `is_nza_team()` read path, which Part 0 proposed as divergence 4, so NZA staff see a client's models only as members. It is worth confirming that is the intended Rev B decision.
- **L7.** The model hash includes the database building id, the building name and the labels. The same physics in another building, or after a rename, is a cache miss. This is not a bug, but Engine 1 fixtures need a fixed `building_id`, and the design note should state it.
- **L8.** `library_refs` uses `version: null` plus `body_hash`, and `library_items` has no body-hash column, so a pinned reference cannot be resolved back to a stored row. The brief describes `{ item_id: version }`. This needs settling before Engine 1 reads the library from Postgres.

### Checked and fine

- RLS is enabled on all 11 tables. Anonymous callers are denied on tables and on `my_access`. Direct `insert` and `update` as `authenticated` are denied. Security-definer functions all set `search_path = public, pg_temp`. A wrong hash is rejected with both hashes in the message. A viewer is refused writes. Global library writes are refused for non-NZA-team users.
- Collation: 0003's `collate "C"` fixes the en_US ordering. Strings, control characters, `-0` and float noise of normal size all agree between SQL and JS.
- Invitation tokens are about 244 bits, only their hash is stored, the email must match the JWT, and "Confirm email" is on.
- The Save button's `result` comes from a synchronous `useMemo` over the same `params`, so the recorded run cannot be a stale value from before an edit.
- The converter refuses unknown keys, stale service-level fields, v25-only projects and missing constructions. Its field-by-field coverage test is real.

---

## How the old engine makes 132.6, as the reference the new engine must match

Re-run in this session: Node 22, engine at `929291e`. The EPW was copied read-only from the IT15 worktree and its sha256 `c6571102…cf2` matches. The call is exactly the call in `_brief93_anchor.mjs --fixture`. The Systems page's call (`mode:'full'`, no `library_systems`, `systems` argument passed) gives the same result.

**Path.** `calculateInstant` → `_calculateInstantBaseline` → `_calculateState3`. State 3 is used only when `mode === 'full'` and either `engine: 'v2.5'` is passed or `systems_config_v25` is non-empty and templates are loaded (`instantCalc.js:6706-6715`). Callers without the templates fall to the inline-legacy path, which hard-codes 21/24 °C, defaults to 138 bedrooms and gives a different number. **The reference is State 3 only.** The `systems` argument (the `projects.systems_config` column) and `scheduleProfiles` never reach it.

**Inputs.** `building_config` (v40 plus two live v25 fields), `construction_choices`, the comfort band (21/24 °C, from the project columns, not `building_config`), the library constructions, the JS system templates (they must resolve even though their values move nothing), and the EPW: 7 columns plus the latitude from its header, together with `orientation` (42°).

**The breakdown** (MWh/yr; GIA 4,216 m², which is 58.8 × 14.34 × 5 = 4,215.96 rounded):

| Line | MWh | How it is made |
|---|---|---|
| Heating | 32.157 | demand 87.7 (already reduced by the MVHR recovery of 54.057) ÷ effective SCOP 2.73 (95% at 3.0 and 5% at 1.0, mixed harmonically) |
| Cooling | 33.700 | demand 101.1 ÷ SEER 3 (the second system has a 0% share) |
| DHW gas | 157.428 | demand 257.335 × 52% ÷ 0.85 |
| DHW electricity | 42.225 | 257.335 × 48% ÷ COP 3 = 41.174, plus the circulation pump 1.051 |
| Fans | 40.613 | three v40 vents: 22.469 + 17.408 + 0.736 |
| Lighting | 39.014 | 2 W/m², daylight factor 0.7, follows occupancy with spill |
| Small power | 186.136 | 5.04 W/m² baseload, 24/7 (one third of the total) |
| Auxiliary | 27.699 | external lighting, 1.5 W/m² at 50% all year, gain fraction 0 |
| **Total** | **558.972** | ÷ 4,216 = 132.58 → **132.6** |

DHW demand is 138 rooms × 2.5 people per room × 55 L/day × (42 − 10) K × 365. The "tap 40 °C" in the v40 DHW entries' `notes` is stale; the engine uses 42.

**Sensitivity**, perturbed here (EUI after the change):

| Change | EUI |
|---|---|
| v25 heating setpoint 21 → 16 or 26; v25 heating or cooling `enabled: false` | 132.6 |
| v25 DHW litres 80 → 160; store temperature 60 → 45 | 132.6 |
| every template's SCOP or SEER ×2; every HRE set to 0; MVHR template fuel set to gas | 132.6 |
| v25 vent `flow_l_s` changed; `schedule_ref` changed | 132.6 |
| **v25 `dhw.circulation_pump_w`** 120 → 0 / → 1,200 | **132.3 / 134.8** |
| **v25 `ventilation[0].hours`** 8,760 → 2,000 | **132.1** |
| v25 removed entirely | 132.3 (the pump only) |
| comfort lower 21 → 20 | 131.0 |
| an unknown v25 template id | **throws** `MissingLibraryField` |

**Traps for a reimplementation:**

1. **Rounding inside the pipeline.** State 2 rounds heating and cooling demand to 0.1 MWh *before* State 3 divides them by efficiencies (`instantCalc.js:4322`). Auxiliary electricity is rounded to 0.1 kWh. The EUI denominator is `Math.round(GIA)`. The EUI is rounded to one decimal place (`:5621`). So the true figure is 132.58, and a rewrite that is right to 0.03 still shows 132.6. Gate Engine 1 on total kWh (558,972 ± a stated tolerance), not on the rounded EUI.
2. **Two v25 fields are still live alongside v40.** `dhw.circulation_pump_w` runs for a hard-coded 8,760 h and sits inside DHW electricity. `ventilation[].hours` is matched to the v40 vent by `id`. v40 has nowhere to put either. The converter rightly carries both (`services.dhw.circulation_pump_w`, `ventilation[].legacy_v25`). Engine 1's brief should give them proper homes. On the open question: carrying the pump is correct, because it moves the EUI by 0.25 kWh/m² at 120 W.
3. **Auxiliary is not a consumption block.** It reaches `consumption.total.electricity_mwh` only through the heat balance. That is the whole of M7's "not itemised" line.
4. **Defaults hidden in the engine** that the anchor never exercises because every field is set: `infiltration_ach ?? 0.5`, occupancy density `?? 1.5` per room, magnitude unit defaulting to W/m², `T_heating_setpoint = v25.heating.setpoint_c ?? comfort.lower`, and others. The converter carries an absent field as absent, so for each such field Engine 1 must either name a default or refuse. Otherwise it will match the anchor and still differ on other projects.
5. **Ventilation runs twice.** v40 entries are converted back into a v25-shaped list for `computeVentilationEnergy`, and `computeSystemsDelivered` is called twice (`instantCalc.js:5094-5115`). It is deterministic, but the reference number comes from the v25-shaped fan model with the per-hour recovery cap from Brief 28j and the bypass from Brief 53.
6. **The comfort band and `reported_gia` sit outside `building_config`.** `reported_gia` changes the denominator only, while physics uses the geometric GIA.

## Method and limits

The migrations were applied to a local Postgres 16 with a small Supabase stand-in (`auth.uid()` and `auth.jwt()` read from `request.jwt.claims`, `anon` and `authenticated` roles, Supabase's default privileges). This is close to Supabase, but it is not the NZA Sim (dev) project. Hashes were computed with the repo's own `canonical.ts` and compared against the migrations' `model_hash()`. The engine re-runs import the engine files read-only. All the scripts I used are in my scratch area; none of them is committed.
