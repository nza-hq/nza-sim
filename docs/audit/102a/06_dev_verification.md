# Brief 102a — verification on NZA Sim (dev)

14 Nov 2026, ~22:48 UTC. Done by Chris's agent (Claude Chat) in the Supabase dashboard SQL editor, on NZA Sim (dev)
`jbjxduathkklruvbmeho` only. Relayed by Linzie Brown.

1. **`0004_qa_fixes.sql` applied once** (the dashboard's destructive-operation prompt confirmed, for the intended
   `drop function` / `drop constraint`).
   - `supabase_migrations.schema_migrations`: 0001_tenancy, 0002_model_store, 0003_canonical_collation,
     `20261114230004 / 0004_qa_fixes`.
   - `create_model_version` has one signature, `(p_building uuid, p_schema_version text, p_canonical text,
     p_model_hash text, p_library_hash text, p_weather_hash text, p_parent uuid, p_note text)`; the jsonb one is gone.
   - `runs` unique constraints: only `runs_one_per_version_key (model_version_id, engine_version, library_hash,
     weather_hash)`.
   - `model_versions.canonical` exists, `text`.
2. **`anchor_record.sql`** (15,404 bytes, as at `7f3d8d4`): first run added one project, building, version and run
   (2/2/2/2 with the 102 ZZ TEST rows untouched): building `7f1d7b3f-9984-4481-81ff-19f4a1c0ea2e`, version
   `614d3633-352c-49ae-936b-d699cdff2ced`, run `30ff6317-958d-412e-be19-971205d557b8`. Second run: counts unchanged,
   same ids. (The dashboard does not show `RAISE NOTICE`, so counts were the proof.)
3. **`anchor_readback.sql`** (1,593 bytes): one row, every `*_ok` true (stored text hash, same document as
   JavaScript, weather = the EPW bytes, engine version, EUI, total kWh); EUI **132.6**, total **558,972 kWh**, one run on
   the version.

This closes Brief 102's open verification step 6 (the anchor round trip on the real database) and QA M5.
