# Brief 102 Part 2 — NZA Sim's own tenancy and model store: what was applied, what was checked

Applied 14 Nov 2026 to **NZA Sim (dev)** `jbjxduathkklruvbmeho` through the dashboard SQL editor by Claude Chat
(Chris's browser; the Supabase connector in the chat is authorised for the NZA organisation only). Nothing was
applied to any decodED project. Files: `supabase/migrations/0001_tenancy.sql`, `0002_model_store.sql`, `0003_canonical_collation.sql`.

## Shape

```
auth.users ─┬─ profiles (1:1)
            ├─ memberships (org_id, user_id, role, status) ── organisations
            ├─ nza_team
            └─ invitations.used_by / created_by

organisations ─┬─ memberships
               ├─ invitations
               ├─ org_links (decoded_org_id, token_hash)   ← empty until Brief 113
               ├─ library_items (org_id null = NZA global)
               └─ projects ── buildings (decoded_building_key null) ── model_versions ── runs
                                                                          └─ parent_id (self)
```

Keys: `runs (model_hash, engine_version, library_hash, weather_hash)` unique; `library_items (org|global, kind, key,
version)` unique; `buildings (project_id, decoded_building_key)` unique where not null.

## RLS and grants (as read back from the database)

| Table | RLS | anon | authenticated | Policy |
|---|---|---|---|---|
| profiles | on | none | select | own row, or a colleague in a shared active organisation |
| organisations | on | none | select | `can_read_org(id)` |
| memberships | on | none | select | `can_read_org(org_id)` |
| invitations | on | none | select | `is_admin_of(org_id)` |
| nza_team | on | none | select | own row |
| org_links | on | none | select | `is_admin_of(org_id)` |
| projects | on | none | select | `can_read_org(org_id)` |
| buildings | on | none | select | via project |
| model_versions | on | none | select | via building |
| library_items | on | none | select | global, or `can_read_org(org_id)` |
| runs | on | none | select | via version |

No `insert`, `update` or `delete` is granted on any table to any API role. Writes go through security-definer
functions that start with `require_caller()` and check the role. Functions executable by `anon`: only
`accept_invitation_token` (validate-only when not signed in), `token_hash`, `caller_id`, `is_anonymous_caller`.

## Checks run (all in one transaction, rolled back)

| # | Check | Result |
|---|---|---|
| 1 | RLS on every public table | 11 of 11 `true` |
| 2 | `canonical_json('{"b":1.50,"a":[{"z":-0,"y":"s"}],"c":null}')` | `{"a":[{"y":"s","z":0}],"b":1.5,"c":null}` |
| 3 | Key order does not change the hash | true |
| 4 | One value change changes the hash | true |
| 5 | `model_hash('{"a":1,"b":[1,2]}')` equals Node's sha256 of the same canonical string | `8baa7319…fb4874`, both |
| 6 | anon table grants | none |
| 7 | authenticated table grants | select only, 11 tables |
| 8 | User A `create_organisation('Alpha Ltd')` → admin; `my_access()` lists it with role admin | pass |
| 9 | User A `create_model_version` with a wrong hash | rejected: "model_hash 000… does not match the document (canonical sha256 6c67…)" |
| 10 | User A `create_model_version` with the right hash | stored |
| 11 | User A `record_run` twice with the same key | same id both times; one row in `runs` |
| 12 | User A (not NZA team) `upsert_library_item(null, …)` | rejected: "only the NZA team can write global library items" |
| 13 | User B (no membership) selects organisations, model_versions, runs | 0, 0, 0; `my_access()` → `orgs: []` |
| 14 | anon `create_organisation` | "permission denied for function create_organisation" |
| 15 | anon `select … organisations` | "permission denied for table organisations" |
| 16 | `supabase_migrations.schema_migrations` | `20261114190001 0001_tenancy`, `20261114190002 0002_model_store`, `20261114190003 0003_canonical_collation` |
| 17 | After 0003: `canonical_json('{"b":1,"B":2,"a":3,"é":4,"Z":5}')` equals Node's `{"B":2,"Z":5,"a":3,"b":1,"é":4}` | pass |

Two things learned on the way, both in the files now: pgcrypto's `digest()` lives in the `extensions` schema and is
out of reach under `search_path = public, pg_temp`, so `model_hash` uses the built-in `sha256(bytea)`; jsonb keeps a
number's scale (`1.50` stays `1.50`), so `canonical_json` trims it with `trim_scale` to match JavaScript; and `order by k` under the database's en_US collation would have put `a` before `B`, so 0003 sorts keys `collate "C"` to match JavaScript's code-unit sort (caught by reading Part 1's `canonical.ts`; applied before any row existed).

## What Part 4's frontend (Linzie's agent) can rely on

- `my_access()` → `{ signed_in, nza_team, orgs: [{ id, name, role }] }`, sorted by name.
- First sign-in with `orgs: []`: call `create_organisation(name)` or `accept_invitation_token(token)`.
- Errors come back with Postgres codes: `42501` not allowed, `23514` hash mismatch or last-admin rule, `P0002` not found.
- The env names: `VITE_NZASIM_SUPABASE_URL`, `VITE_NZASIM_SUPABASE_ANON_KEY` (Brief 102 Rev B Part 4).
