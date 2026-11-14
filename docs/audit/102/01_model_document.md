# Brief 102 Part 1 — the model document, results shape, canonical hash and converter

Branch `chris/102-sim-v2-foundations`, Rev B. No database, no engine file touched, nothing imported from the
engine. Code in `frontend/src/thermal/schema/`.

## What landed

| File | What it is |
|---|---|
| `model.ts` | zod schema of the model document: building, zones, surfaces (with openings and shading), system groups, service-level fields, profiles, weather ref, library refs. Every object `.strict()`; referential checks (duplicate ids, a surface naming a missing zone, a zone listing a missing surface, a system group serving a missing zone, a missing profile ref). |
| `results.ts` | zod schema of a run's results: hourly per zone and per system group (8,760 or 8,784), annual by end use × fuel per zone / per system group / building, EUI, and the breakdown lines (rule 9). Plus `RunSummary`, all an `instant-1` run will store. |
| `canonical.ts` | Canonical JSON (sorted keys, `-0`→`0`, refuses NaN/Infinity, `undefined` in arrays, Dates, Maps, class instances) and SHA-256 via Web Crypto: one implementation for browser and Node. |
| `hash.ts` | `modelHash`, `libraryHash` (refs sorted by kind+key; duplicates refused; each ref carries the item's `body_hash`), `weatherHash` (an EPW's own file sha256, never its name). |
| `fromBuildingConfig.ts` | Today's inputs → a one-zone document, plus a trace of every input path it copied and where it went. |
| `__tests__/schema.test.ts` | 13 tests, all passing (`npm test` in `frontend/`). |
| `__tests__/fixtures/engine_reads_part0.json` | The Part 0 Proxy trace (320 engine-read paths) the coverage test checks against. |

`frontend/package.json`: `zod` (dependency), `vitest` and `yaml` (dev, `yaml` only to read the anchor fixture in
tests), `"test": "vitest run"`. **Lockfile not changed; run `npm install` locally.**

## Evidence

- `npm test`: 13/13 pass. `npm run build`: clean.
- `node scripts/_brief93_anchor.mjs --fixture`: **132.6** EUI, 401.544 MWh elec, 157.428 MWh gas, unchanged.
- Anchor document: `model_hash ae86b9bd…c90ff`, `library_hash dada68b7…1ba4`, weather hash = the EPW's
  sha256 `c6571102…cf2`. 12,218 bytes canonical. 1 zone, 10 surfaces, 9 system groups, 3 ventilation entries,
  6 profiles, 4 construction refs.

## The tests the brief asked for

1. **Key order does not change the hash** — the document with every object's keys reversed hashes the same.
2. **One U-value does** — a `u_value_override` on the wall changes the model hash; so does editing the library
   wall's U-value in place (through `body_hash`, which also changes the library hash).
3. **The anchor fixture converts without loss, field by field**, two ways:
   - *Verbatim*: every one of the 733 values the converter copies is identical at its document path.
   - *Coverage* against the Part 0 list of 320 engine reads: 240 are carried (directly, or a parent of a carried
     path); 16 are reads of fields this fixture does not have (`x ?? default`), and for each the test sets the
     field and shows it then arrives verbatim in the document; the other 64 fall under the six stated exclusions
     below. A mutation check (drop `window_count`) fails the test as it should.
4. **Converting twice gives the same hash** (and byte-identical canonical JSON).
5. **The schema rejects** a zone with no surfaces ("a zone must have at least one surface") and a surface naming a
   missing zone (`surface "wall_north" names zone "z_missing", which does not exist`). Also: an unknown key.

Also tested: a stale service-level field on a system entry is refused; a v25-only project and a missing library
construction are refused.

## Excluded inputs (read by today's engine, not carried), with evidence

Each was perturbed on the anchor (engine run on the fixture, base 132.6 / 401.544 MWh elec / 157.428 MWh gas); none moved any of the three.

| Inputs | Why excluded | Perturbation |
|---|---|---|
| `interventions[]` | Patches over a model version, not part of one; the anchor runs with `_skipInterventions`. | Toggling `enabled`: no change |
| `systems_config_v25.heating.*`, `.cooling.*` | Shadowed by v40 heating/cooling. | `primary_pct`, `setpoint_c`, `library_id`: no change |
| `systems_config_v25.dhw.*` except `circulation_pump_w` | Shadowed by v40 dhw. | `fuel_mix`, litres, store temperature: no change; replacing the v25 dhw block with only `{ circulation_pump_w: 120 }`: no change |
| `systems_config_v40.<service>[].<service-level field> (in)` | The engine's own guard for stale data. The converter refuses such a config, as the engine does. | n/a (a refusal, not a value) |
| `libraryData.system_templates[]` | The built-in template table. | SCOP/SEER/η values: no change with v40 present |
| `libraryData.constructions[]` | Not dropped: carried **by reference**. `library_refs[].body_hash` is the sha256 of the whole stored item, so any change to it changes both hashes. | n/a |

## Fields added to the design note's shapes (for review)

Each is a field today's engine reads (or the UI writes) that the note's shape does not name. Each sits on the
nearest concept the note already has.

| Where | Field | Why |
|---|---|---|
| `zone.ventilation[].legacy_v25` | The matched v25 ventilation entry (`hours`, `schedule_ref`, `summer_bypass`, `flow_l_s`, `sfp`, `hre`, …) | Still live: v25 `hours` 8760→1000 on every entry gives 138.0; v25 `summer_bypass` true gives 131.2 (the v40 field wins when non-null). v25 `schedule_ref` moved nothing, but is carried with its entry. |
| `services.dhw.circulation_pump_w` | v25 DHW circulation pump, W | Still live: 120→1,200 W moves the anchor to 134.8. **Flag:** it is a distribution loss, which the design note's scope fence says v2 does not model. Carried so the conversion is lossless; whether Engine 1 honours or retires it is the review's call. |
| `zone.setpoints.control_strategy` | `active_setpoint` / free running | `free_running` gives 117.0. |
| `zone.infiltration_ach` | The legacy direct air-change rate | Read when q50 is absent. |
| `zone.rooms` | `num_bedrooms` | Per-room occupancy: 138→100 gives 119.4. |
| `building.reported_floor_area_m2` | `reported_gia` | Replaces the geometric EUI denominator: 5,000 m² gives 111.8. |
| `building.thermal_bridging`, `building.thermal_mass` | mode / multiplier / alpha; mode / category | Envelope inputs the note does not list. |
| `building.opening_defaults` | Building-wide `openings.cd` / `flow_mode` / `schedule` | Retired by Brief 42 but still read as fallbacks. Absent on the anchor. |
| `building.site.exposure` | `openings.site_exposure` | Building-wide by design (CLAUDE.md, Brief 42). |
| `surface.wwr`, `window_count`, `shading` | Per facade | The note's "WWR per edge"; shading overhang/fins (south overhang depth 1 m gives 132.4). |
| `surface.openings[]` | Permanent vents and legacy operable fractions, each with its own cd / flow mode | Per-opening physics (Brief 42). North louvre cd 0.49→0.25 gives 132.5. |
| `construction_ref.u_value_override` / `g_value_override` | Per-project overrides from `construction_choices` | The Part 0 catch. |
| `system_group.control_factor`, `control_mechanism`, `control_schedule_ref`, `template_ref`, `capacity_kw` | Per-system v40 fields | `control_factor` is read for lighting / small power / auxiliary. |
| Gains profile `spill_minutes` | Lighting spill after occupants leave | Written by the UI; **not read by today's engine.** Carried so nothing the user set is lost. |
| `profiles[kind=schedule]` | `building_config.schedules` | Not in the engine-read list, but system `control_schedule_id`s point at them. |

## Judgement calls to confirm

1. **`ventilation.kind` is derived**: `mvhr` if `recovery_sensible_pct` > 0, else `mev`. Today's config has no such
   field. The engine does not read it.
2. **`_`-prefixed keys are dropped** (`_provenance` notes on profiles). They are not engine inputs and would make
   the hash move on a provenance edit.
3. **Dropped per-system keys**: `notes` (free text) and `service` (implied by the array). Anything else unknown
   is refused, not dropped.
4. **`use_type`** is `building_type` when set, else `unassigned` (the anchor's is empty). A label; the engine does
   not read it.
5. **`body_hash`** hashes the library item as stored (the fixture's `library_constructions` entry), not the
   engine's reshaped copy. Same information, and it does not depend on engine code.
6. **Glazing `g_value` is null** on the surface: g comes from the construction (or `g_value_override`).
7. **Refusals**: no `systems_config_v40`; a v25-only enabled service; first-class `operable_openings` (non-empty);
   a stale service-level field; an unknown key on a system, vent, opening, schedule or construction choice;
   a construction not in the library. The message names the input path.
