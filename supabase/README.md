# NZA Sim — Supabase

NZA Sim has **its own** Supabase project. It never shares a database, an auth, or a key with decodED
(design note 418d645e-05cc-811e-ad6b-fa8846f12148, Rev A.5). The decodED link, when it comes (Brief 113),
is an optional integration through `org_links` and a scoped token; NZA Sim reads nothing from decodED.

## Projects

| Name | Ref | Organisation | Use |
|---|---|---|---|
| NZA Sim (dev) | `jbjxduathkklruvbmeho` | Inteli Development Projects (Chris's personal account) | Development. Free plan. Every migration lands here first. |
| NZA Sim (prod) | not yet created | | Created, with the same migrations in order, before the first client is onboarded. Never shares a key with dev. |

**Never** apply anything in this folder to `NZA Decoded` (`weeaadpwofvbmcilxpkt`, decodED's live site since 5 Nov 2026)
or `NZA Decoded Test` (`stxitqwhaesraisfwyes`).

## Project settings that the migrations assume

- Data API on; **automatic table exposure off**; **automatic RLS on** (project defaults when it was created). So a table
  is reachable only by the grants in the migration, and every table starts locked. The migrations grant `select` to
  `authenticated` behind RLS policies and nothing to `anon`; writes go through security-definer functions only.
- The anon (publishable) key is public by design because of the above. There is no service-role key in this repo,
  in a laptop `.env`, in a log or in Notion. Names in `frontend/.env.example`; values in Bitwarden org "NZA".

## Applying a migration

1. `supabase/migrations/NNNN_name.sql`, numbered in order, each ending with its own
   `insert into supabase_migrations.schema_migrations (version, name)`, so the CLI and the MCP see what is live.
2. Apply to **NZA Sim (dev)** by pasting the whole file into the dashboard SQL editor and running it once
   (the Claude Supabase connector is authorised for the NZA organisation only, so it cannot reach this project;
   if that changes, `apply_migration` through the connector is the better route because it records the migration
   itself, and the trailing insert becomes a no-op `on conflict`).
3. Read back: `select version, name from supabase_migrations.schema_migrations order by 1;` and the checks in
   `docs/audit/102/02_schema.md`.
4. Prod, later: the same files in the same order, on Chris's word, after the dev project has run them for at least a
   brief's worth of use.

## What is here

- `0001_tenancy.sql` — profiles, organisations (flat), memberships (admin / editor / viewer), invitations,
  `nza_team`, `org_links` (empty until Brief 113); `caller_id`, `role_in`, `can_read_org`, `can_edit_org`,
  `is_admin_of`, `is_nza_team`, `my_access`; `create_organisation`, `invite_member`, `accept_invitation_token`,
  `set_member_role`, `remove_member`, `set_display_name`.
- `0002_model_store.sql` — projects, buildings (`decoded_building_key` nullable), model_versions (immutable;
  `model_hash` checked in SQL against the canonical document), library_items (versioned, provenance, global or
  per organisation), runs (one row per `(model_hash, engine_version, library_hash, weather_hash)`);
  `canonical_json`, `model_hash`; `create_project`, `create_building`, `create_model_version`, `record_run`,
  `upsert_library_item`.
- `0003_canonical_collation.sql` — `canonical_json` sorts keys `collate "C"` (byte order, as JavaScript sorts), not en_US.

## Canonical JSON, the one rule two codebases share

`public.canonical_json(jsonb)` and `frontend/src/thermal/schema/canonical.ts` must produce the same bytes:
object keys sorted in byte order (`collate "C"` in SQL, the default sort in JavaScript), arrays in order, no whitespace, numbers with trailing zeros trimmed and `-0` as `0`, strings
and the rest as JSON. `model_hash` is the hex SHA-256 of those bytes. Verified on 14 Nov 2026:
`{"a":1,"b":[1,2]}` → `8baa73198470c7bb4c3ce142a8fd651affc0310d878bb9bd159e37a573fb4874` in both SQL and Node.
Part 1's tests must keep asserting the agreement on the anchor fixture.
