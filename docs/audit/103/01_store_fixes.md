# Brief 103 Part 1: store fixes from the 102 QA

Migration: `supabase/migrations/0005_store_fixes.sql`.

## Changes

| QA | Change |
|---|---|
| M4 | Projects and buildings are matched by `local_ref` (the local project's uuid), never by name, through `ensure_local_building(org, local_ref, name)`. This is one call and race-safe because of unique `(org_id, local_ref)` and `(project_id, local_ref)`. A rename keeps the building and its versions, and the names follow. A pre-0005 project with the same name and no `local_ref` is adopted once. `SaveModelVersionButton` sends `ProjectContext.currentProjectId`. The anchor script uses `fixture:bridgewater_anchor_v2`. |
| M6 | `upsert_library_item` refuses (23505) a different body for an existing version, and the message names the next version. The same body is still a no-op. |
| M7 | `instantSummary` gives auxiliary its own line from `heat_balance.annual.gains.internal.auxiliary.electricity_kwh` and counts district heat as heating. A missing or non-number figure throws and names its path. On the anchor, `not_itemised` is now 0.1 kWh (rounding), where it was 27,699 kWh. |
| L2 | `org_of_project` and `org_of_building` return null unless the caller can read the organisation. `org_of_version` goes through `org_of_building`. The RLS policies still call them, so EXECUTE stays. `admin_count` loses its `authenticated` grant, since it is only called inside definer functions. `role_in` answers only the caller's own role, so it stays. |
| L3 | The AuthGate error screen has Retry and Sign out. A failed client load has Retry. |
| L6 | `revoke_invitation(id)`: admins only, and only unused invitations. A revoked token is refused by the existing `revoked_at is null` check. |

## Evidence

- **Local Postgres 16 rig:**
  - `test_p6.mjs`: 37 passed, 0 failed (`01_p6_local_pg.txt`), covering rename, same-name projects, adoption, six concurrent first saves leaving one row, refusals, M6, L2 for outsider/member/viewer, and L6.
  - The earlier rigs `p2` (15), `p3` (8), `p4` (9) and `p5` (10) all still pass.
  - Rig fix: `pgsb.mjs`'s `rpc` returned the claims line for a null result; it now returns `null`.
- **Unit tests:** `npx vitest run` passes 25 tests, including `summary.test.ts` (8, M7). `npm run build` is clean.
- **NZA Sim (dev), `jbjxduathkklruvbmeho`:** 0005 was applied on 15 Nov at about 00:00 through the Supabase connector, using the file text verbatim. Read back:
  - `schema_migrations` lists 0001–0005.
  - Both `local_ref` columns and both indexes are present.
  - `ensure_local_building` and `revoke_invitation` are granted to `authenticated` and not to `anon`.
  - `admin_count` is not executable by `authenticated`.
  - `upsert_library_item` contains the refusal.
  - Both `org_of_*` functions are gated.
  - RLS reads as an active admin, in a transaction rolled back afterwards: 2 projects, 2 buildings, 2 versions, 2 runs, all still visible.
  - The existing rows (ZZ TEST and the anchor) have `local_ref` null. Each is adopted on its next save.
