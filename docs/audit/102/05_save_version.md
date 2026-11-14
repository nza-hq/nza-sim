# Brief 102 Part 5: save as model version, record today's result (code side)

## What landed

- `frontend/src/thermal/store/versions.ts`:
  - `ensureProject(sb, orgId, name)` and `ensureBuilding(sb, projectId, name)` find by name or create, through
    `create_project` / `create_building`.
  - `saveModelVersion(sb, buildingId, doc, note)` hashes the document. If a version of that building already has the
    same model hash, it returns that version (`created: false`) and nothing is written. Otherwise it calls
    `create_model_version`, with the newest version as parent.
  - `recordRun(...)` calls `record_run`; the same four hashes give the same run.
  - `instantSummary(result)` builds the `RunSummary`. The EUI comes only from `readModelledEui`. The rest is copied
    from `consumption` (MWh → kWh). `not_itemised` = total − the listed end uses, so the lines always sum to the
    total (rule 9); on the anchor it is 27,699 kWh (the auxiliary external lighting the engine counts in its total
    but does not list at the top level).
- `frontend/src/components/modules/systems/SaveModelVersionButton.jsx` and two lines in `SystemsModule.jsx` (the
  import and the button under the page description). The button renders nothing unless signed in with an
  organisation. It reuses the result the Systems page already computed (same `calculateInstant` call and options)
  and the page's own construction list, stores `results: {}` (instant-1 has no hourly results) and the summary, with
  `engine_version 'instant-1'` and `source 'engineReads.readModelledEui'`. The weather is the legacy file name,
  as the brief says. The project and the building are named after the open project. The document's building id is
  the database building's id.
- `scripts/102_anchor_roundtrip.mjs` (run with `cd frontend; npx vite-node ../scripts/102_anchor_roundtrip.mjs`).
  Read-only by default; `--record` stores the fixture's own version and its run first, under a separate
  "Bridgewater anchor fixture" project.
- `fromBuildingConfig.ts`: `body_hash` now hashes the item's `config_json` (see "Divergences").

## Evidence (container; mocked Supabase, since the real project is not reachable from here)

- Env unset: ZZ TEST's Systems page shows 132.6 before and after, and the 1440×900 screenshots are pixel-identical.
  No external requests. `npm run build` clean; 13/13 tests.
- Env set, admin: first press → "Saved", one project, building, version and run; the run has `instant-1`, source
  `engineReads.readModelledEui`, EUI 132.6, electricity 401,544 kWh and gas 157,428 kWh. Second press, nothing
  changed → "Unchanged, already saved", still one version and one run.
- Env set, viewer: "only an editor or admin can create a project" (the database's refusal), nothing written.
- Round trip on a mocked database: before `--record` → "run once with --record", exit 1; `--record` → new version
  and run, then `stored EUI 132.6 … match`, exit 0; `--record` again → the same version and run; plain read →
  `match`, exit 0.
- `scripts/_brief93_anchor.mjs --fixture` → 132.6.

## Divergences from the brief

1. **The round-trip script can record, not only read.** The button saves the live inputs. Their library items
   need not equal the frozen fixture's (in this container the July library has no `layers`), so the button's model
   hash is not the fixture's, although the EUI is the same 132.6. So the script stores the fixture's own version
   (with `--record`) and then checks it. Both paths go through the same `versions.ts` functions.
2. **`body_hash` is over `config_json`.** The fixture and the UI wrap the same item differently, so Part 1's choice
   to hash the whole wrapper gave different hashes for identical items. The anchor's hashes in `01_model_document.md`
   are updated.
3. **`not_itemised` line in the summary** (above). Whether Engine 1's results name auxiliary loads is for its brief.

## Still to do (with the real project)

- Chris (or whoever is signed in as an editor or admin), on ZZ TEST: press the button twice → one version and one
  run, the second press says "Unchanged".
- `cd frontend; npx vite-node ../scripts/102_anchor_roundtrip.mjs --record`, then without `--record`. Both must
  print `132.6` and `match`. It uses the same browser-session token as the seed script.
