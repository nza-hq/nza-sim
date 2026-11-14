# Brief 102a: the migrations on a local Postgres

Tests `supabase/migrations/` (0001–0004) against a local Postgres 16 with a small Supabase stand-in (`standin.sql`:
the `anon` / `authenticated` roles, `auth.users`, `auth.uid()` / `auth.jwt()` read from `request.jwt.claims`,
Supabase's default privileges). `pgsb.mjs` is a tiny supabase-js stand-in over `psql`, so the tests drive the app's
own `frontend/src/thermal/store/versions.ts` and the round-trip library. Close to Supabase, not Supabase: the real
check is Chris's agent applying 0004 to NZA Sim (dev) and running `docs/audit/102a/anchor_*.sql`.

Needs `psql` and a server on `PGHOST`/`PGPORT` (default `/tmp`, `54329`) that trusts user `postgres`. Each test
drops and recreates database `t`. Never point it at a Supabase project.

    cd frontend
    npx vite-node ../scripts/102a_pgtest/test_p2.mjs   # canonical text: tiny/huge numbers, refusals (15)
    npx vite-node ../scripts/102a_pgtest/test_p3.mjs   # runs per version (8)
    npx vite-node ../scripts/102a_pgtest/test_p4.mjs   # invitations never demote (9)
    npx vite-node ../scripts/102a_pgtest/test_p5.mjs   # the emitted anchor SQL and the read-back (10)

Outputs from the brief's run are in `docs/audit/102a/p*_local_pg.txt`.
