# Brief 102 · Part 0 — Reconnaissance report (read-only)

14 Nov 2026 · branch `chris/102-sim-v2-foundations` at `aae9e9e` · written by Linzie's agent thread (cloud Claude Code) · no code changed, no database written.

Read for this report: Brief 102 (Rev A); nza-sim `CLAUDE.md` (all), `STATUS.md` top, `docs/state_contracts.md` v2.5 head, `api/db/schema.sql`, `api/db/database.py`, `validation/fixtures/bridgewater_anchor_v2.yaml`, `scripts/_brief93_anchor.mjs`, `frontend/src/utils/instantCalc.js` (State 3 entry and dispatch), `frontend/src/data/systemTemplatesLibrary.js`; the Notion design note (`418d645e-05cc-811e-ad6b-fa8846f12148`, Revs A to A.4) and its child "Handover — Simulate v2 to Linzie's agent" (`418d645e-05cc-818a-bf08-e128cad8e252`); nza-decoded (`main` at `9e73a01`) `CLAUDE.md`, `supabase/README.md`, migrations `0003`, `0008`, `0021`, and the later ones that redefine what they made (`0013`, `0022`, `0024`), `docs/runbooks/supabase-auth-settings.md`, `test/db/cross-cutting.test.ts`, `src/twin/contract/schema.ts`. Both Supabase projects were queried read-only (counts and settings only, no personal data) through the Supabase connector.

---

## Headline: two things need a decision before Part 2

1. **decodED's "dev" project is now decodED's live production database.** The brief and the handover say "decodED's dev Supabase project". The project decodED's `CLAUDE.md` still calls dev ("NZA Decoded", `weeaadpwofvbmcilxpkt`) has been the live site's database since 5 Nov 2026 (decodED `supabase/README.md`, "What is applied where"): read today, it has 11 auth users, 35 organisations, a subscription, "Confirm email" on since 8 Nov and pg_cron jobs. decodED's rule is "Public product: never develop against live user data; keep a dev/prod split" (`CLAUDE.md` standing rules) and every migration since 0019 went "Test database first; live only on Chris's 'yes'". The real dev/staging project is **"NZA Decoded Test"** (`stxitqwhaesraisfwyes`, eu-west-2; staging's database since Brief 237; 41 rig users, every decodED migration to 0025 applied). **Recommendation:** Part 2 applies `sim_0001` to NZA Decoded Test only; live later, on Chris's word, after Engine 4's referee. The brief's wording "dev project" should be read as "NZA Decoded Test" throughout. Consequence: sign-in in Part 4 uses test-project accounts, not anyone's live decodED login.
2. **Nothing forbids a `sim` schema in decodED's project, but three decodED settings or rules have to move with it** (detail in (d) below): `sim` must be added to the project's **Exposed schemas** (decodED's runbook item 13 says `public` only); decodED's **erasure** (`forget_person`, and the CI check that guards it) only covers `public`, so `sim.*.created_by` would escape it; and decodED's auth **redirect URLs** only allow decodED's own origin. None is a blocker; each is a decodED-side change the brief places out of scope ("Anything in decodED's public schema or decodED's repo").

Everything else below confirms the brief, with smaller divergences listed at the end for Part 1 to 5.

---

## BEFORE DOING ANYTHING — results

- **Brief quoted back.** Title: *"Brief 102 — Simulate v2 Foundations: the model document, its hash, the database and one identity"*. First paragraph: *"Rev A · 14 Nov 2026 · Chris Scott (product owner) with Claude Chat · branch `chris/102-sim-v2-foundations`. Design note (canonical if this brief and it disagree): Notion "Design note — Simulate: a zoned hourly energy model from the digital twin (Rev A, 14 Nov 2026)", page `418d645e-05cc-811e-ad6b-fa8846f12148`, Revs A to A.4 (the method, standalone first, the ground-up architecture, how tools join the decodED ecosystem). This is Brief 0 of the twelve in that note. It builds no engine and no UI beyond one button. It lays the floor the next eleven stand on."*
- On disk at `docs/briefs/active/102_simulate-v2-foundations.md`; `docs/briefs/current.md` points at it (first line: "Brief 102 — Simulate v2 Foundations … ACTIVE 14 Nov 2026 on `chris/102-sim-v2-foundations`"). ✔
- Branch: already created by Chris's agent from `main` (`910fb9c`, PR #24 merge) with one landing commit `aae9e9e`; working tree clean. ✔
- Shell: Linzie's machine is Windows, PowerShell; every command for it below is PowerShell.
- decodED tenancy read: 0003, 0008, 0021 and the later redefinitions (0013, 0022, 0024) — see (c). `CLAUDE.md` "API keys" read — see (d).
- **DB snapshot task (`nza-sim-db-daily-snapshot`): not checkable from the cloud.** Needed before Part 3 only. On Chris's laptop:
  ```powershell
  Get-ScheduledTask -TaskName 'nza-sim-db-daily-snapshot' | Select-Object State
  ```
- Conflict noted, not acted on: CLAUDE.md process rule 7 says every commit closing a Part updates `STATUS.md`; this brief's Part 0 says "nothing else changed". I followed the brief for this read-only Part; `STATUS.md` gets its 102 section in the Part 1 commit.

---

## (a) The `building_config` fields the single-zone engine reads

**Method.** Not a summary from reading the code: a trace. The anchor was run exactly as `scripts/_brief93_anchor.mjs --fixture` does (same fixture, same EPW, `engine: 'v2.5'`, `_skipInterventions: true`), with `building_config`, `construction_choices` and `libraryData` wrapped in recording Proxies that log every property read (array indices folded to `[]`; reads made only by an object spread logged separately; `(in)` = an `in` presence check, i.e. the engine's "stale service-level field" guards). The traced run still gives **EUI 132.6, state 3**, so the Proxy changed nothing. The harness is in the appendix; it lives outside the repo and imports the engine read-only.

**Dispatch.** `calculateInstant` → `_calculateInstantBaseline` → `_calculateState3(withMode(building,'full'), construction_choices, libraryData, weatherData, hourlySolar, comfortBand, options)` (`instantCalc.js:6706-6715`). `withMode` returns the building unchanged in `'full'` mode. `_calculateState3` calls `_calculateState2` (and State 2 again per custom setpoint), `resolveAndValidateSystems`, the v40 systems block, and the helpers; the trace covers all of them. The `systems` argument (the `projects.systems_config` column) and `scheduleProfiles` are **not** passed to State 3: nothing in them reaches the number.

**The engine reads four inputs, not one.** The list below has 320 paths: 238 under `building_config`, 4 under `construction_choices`, 78 under `libraryData`. Plus three inputs that are not objects: `options.comfortBand` (`lower_c`, `upper_c`; from the `projects.comfort_band_*_c` columns, not from `building_config`), the EPW hourly arrays (`temperature`, `direct_normal`, `diffuse_horizontal`, `wind_speed`, `month`, `day`, `hour`) and the latitude from the EPW header line (which `computeHourlySolarByFacade` uses with `building_config.orientation`).

### The traced list (Bridgewater anchor fixture, `aae9e9e`)

**building_config** (292 paths)

```
building_config.control_strategy
building_config.fabric
building_config.fabric.air_permeability_q50
building_config.fabric.thermal_bridging_alpha_pct
building_config.floor_height
building_config.gains
building_config.gains.auxiliary
building_config.gains.auxiliary.profiles
building_config.gains.auxiliary.profiles[]
building_config.gains.auxiliary.profiles[].area_share
building_config.gains.auxiliary.profiles[].gain_fraction
building_config.gains.auxiliary.profiles[].id
building_config.gains.auxiliary.profiles[].magnitude
building_config.gains.auxiliary.profiles[].magnitude.unit
building_config.gains.auxiliary.profiles[].magnitude.value
building_config.gains.auxiliary.profiles[].relationship_to_occupancy
building_config.gains.auxiliary.profiles[].schedule
building_config.gains.auxiliary.profiles[].schedule.exceptions
building_config.gains.auxiliary.profiles[].schedule.monthly_multipliers
building_config.gains.auxiliary.profiles[].schedule.monthly_multipliers[]
building_config.gains.auxiliary.profiles[].schedule.saturday
building_config.gains.auxiliary.profiles[].schedule.saturday[]
building_config.gains.auxiliary.profiles[].schedule.sunday
building_config.gains.auxiliary.profiles[].schedule.sunday[]
building_config.gains.auxiliary.profiles[].schedule.weekday
building_config.gains.auxiliary.profiles[].schedule.weekday[]
building_config.gains.equipment
building_config.gains.equipment.profiles
building_config.gains.equipment.profiles[]
building_config.gains.equipment.profiles[] (in)
building_config.gains.equipment.profiles[].active
building_config.gains.equipment.profiles[].active.unit
building_config.gains.equipment.profiles[].active.value
building_config.gains.equipment.profiles[].area_share
building_config.gains.equipment.profiles[].baseload
building_config.gains.equipment.profiles[].baseload.unit
building_config.gains.equipment.profiles[].baseload.value
building_config.gains.equipment.profiles[].gain_fraction
building_config.gains.equipment.profiles[].id
building_config.gains.equipment.profiles[].label
building_config.gains.equipment.profiles[].relationship_to_occupancy
building_config.gains.equipment.profiles[].schedule
building_config.gains.equipment.profiles[].schedule.monthly_multipliers
building_config.gains.equipment.profiles[].schedule.monthly_multipliers[]
building_config.gains.equipment.profiles[].schedule.saturday
building_config.gains.equipment.profiles[].schedule.saturday[]
building_config.gains.equipment.profiles[].schedule.sunday
building_config.gains.equipment.profiles[].schedule.sunday[]
building_config.gains.equipment.profiles[].schedule.weekday
building_config.gains.equipment.profiles[].schedule.weekday[]
building_config.gains.equipment.profiles[].standby_factor
building_config.gains.lighting
building_config.gains.lighting.profiles
building_config.gains.lighting.profiles[]
building_config.gains.lighting.profiles[] (in)
building_config.gains.lighting.profiles[].area_share
building_config.gains.lighting.profiles[].daylight_factor
building_config.gains.lighting.profiles[].gain_fraction
building_config.gains.lighting.profiles[].id
building_config.gains.lighting.profiles[].label
building_config.gains.lighting.profiles[].magnitude
building_config.gains.lighting.profiles[].magnitude.unit
building_config.gains.lighting.profiles[].magnitude.value
building_config.gains.lighting.profiles[].relationship_to_occupancy
building_config.gains.lighting.profiles[].schedule
building_config.gains.lighting.profiles[].schedule.monthly_multipliers
building_config.gains.lighting.profiles[].schedule.monthly_multipliers[]
building_config.gains.lighting.profiles[].schedule.saturday
building_config.gains.lighting.profiles[].schedule.saturday[]
building_config.gains.lighting.profiles[].schedule.sunday
building_config.gains.lighting.profiles[].schedule.sunday[]
building_config.gains.lighting.profiles[].schedule.weekday
building_config.gains.lighting.profiles[].schedule.weekday[]
building_config.infiltration_ach
building_config.interventions
building_config.interventions[]
building_config.interventions[] (in)
building_config.interventions[].enabled
building_config.length
building_config.location
building_config.num_bedrooms
building_config.num_floors
building_config.occupancy
building_config.occupancy.density
building_config.occupancy.density.basis
building_config.occupancy.density.value
building_config.occupancy.occupancy_rate
building_config.occupancy.schedule
building_config.occupancy.schedule.exceptions
building_config.occupancy.schedule.monthly_multipliers
building_config.occupancy.schedule.monthly_multipliers[]
building_config.occupancy.schedule.saturday
building_config.occupancy.schedule.saturday[]
building_config.occupancy.schedule.sunday
building_config.occupancy.schedule.sunday[]
building_config.occupancy.schedule.weekday
building_config.occupancy.schedule.weekday[]
building_config.occupancy.sensible_w_per_person
building_config.openings
building_config.openings.cd
building_config.openings.east
building_config.openings.east.cd
building_config.openings.east.flow_mode
building_config.openings.east.louvre_area_m2
building_config.openings.east.openable_fraction
building_config.openings.flow_mode
building_config.openings.north
building_config.openings.north.cd
building_config.openings.north.flow_mode
building_config.openings.north.louvre_area_m2
building_config.openings.north.openable_fraction
building_config.openings.schedule
building_config.openings.site_exposure
building_config.openings.south
building_config.openings.south.cd
building_config.openings.south.flow_mode
building_config.openings.south.louvre_area_m2
building_config.openings.south.openable_fraction
building_config.openings.west
building_config.openings.west.cd
building_config.openings.west.flow_mode
building_config.openings.west.louvre_area_m2
building_config.openings.west.openable_fraction
building_config.operable_openings
building_config.orientation
building_config.reported_gia
building_config.shading_fin
building_config.shading_fin.east
building_config.shading_fin.east.left_depth_m
building_config.shading_fin.east.right_depth_m
building_config.shading_fin.north
building_config.shading_fin.north.left_depth_m
building_config.shading_fin.north.right_depth_m
building_config.shading_fin.south
building_config.shading_fin.south.left_depth_m
building_config.shading_fin.south.right_depth_m
building_config.shading_fin.west
building_config.shading_fin.west.left_depth_m
building_config.shading_fin.west.right_depth_m
building_config.shading_overhang
building_config.shading_overhang.east
building_config.shading_overhang.east.depth_m
building_config.shading_overhang.east.offset_m
building_config.shading_overhang.north
building_config.shading_overhang.north.depth_m
building_config.shading_overhang.north.offset_m
building_config.shading_overhang.south
building_config.shading_overhang.south.depth_m
building_config.shading_overhang.south.offset_m
building_config.shading_overhang.west
building_config.shading_overhang.west.depth_m
building_config.shading_overhang.west.offset_m
building_config.systems_config_v25
building_config.systems_config_v25.cooling
building_config.systems_config_v25.cooling.enabled
building_config.systems_config_v25.cooling.primary
building_config.systems_config_v25.cooling.primary.library_id
building_config.systems_config_v25.cooling.primary_pct
building_config.systems_config_v25.cooling.secondary
building_config.systems_config_v25.cooling.secondary.library_id
building_config.systems_config_v25.dhw
building_config.systems_config_v25.dhw.circulation_pump_w
building_config.systems_config_v25.dhw.cold_mains_temperature_c
building_config.systems_config_v25.dhw.enabled
building_config.systems_config_v25.dhw.fuel_mix
building_config.systems_config_v25.dhw.fuel_mix.electric_resistance
building_config.systems_config_v25.dhw.fuel_mix.gas
building_config.systems_config_v25.dhw.fuel_mix.heat_pump
building_config.systems_config_v25.dhw.litres_per_person_per_day
building_config.systems_config_v25.dhw.primary
building_config.systems_config_v25.dhw.primary.library_id
building_config.systems_config_v25.dhw.secondary
building_config.systems_config_v25.dhw.secondary.library_id
building_config.systems_config_v25.dhw.store_temperature_c
building_config.systems_config_v25.heating
building_config.systems_config_v25.heating.enabled
building_config.systems_config_v25.heating.primary
building_config.systems_config_v25.heating.primary.library_id
building_config.systems_config_v25.heating.primary_pct
building_config.systems_config_v25.heating.secondary
building_config.systems_config_v25.heating.secondary.library_id
building_config.systems_config_v25.heating.setpoint_c
building_config.systems_config_v25.ventilation
building_config.systems_config_v25.ventilation[]
building_config.systems_config_v25.ventilation[] (in)
building_config.systems_config_v25.ventilation[].enabled
building_config.systems_config_v25.ventilation[].flow_l_s
building_config.systems_config_v25.ventilation[].hours
building_config.systems_config_v25.ventilation[].hre
building_config.systems_config_v25.ventilation[].id
building_config.systems_config_v25.ventilation[].library_id
building_config.systems_config_v25.ventilation[].name
building_config.systems_config_v25.ventilation[].schedule_ref
building_config.systems_config_v25.ventilation[].sfp_w_per_l_s
building_config.systems_config_v25.ventilation[].summer_bypass
building_config.systems_config_v40
building_config.systems_config_v40.auxiliary
building_config.systems_config_v40.auxiliary[]
building_config.systems_config_v40.auxiliary[] (in)
building_config.systems_config_v40.auxiliary[].control_factor
building_config.systems_config_v40.auxiliary[].enabled
building_config.systems_config_v40.auxiliary[].share_pct
building_config.systems_config_v40.cooling
building_config.systems_config_v40.cooling[]
building_config.systems_config_v40.cooling[] (in)
building_config.systems_config_v40.cooling[].efficiency_metric
building_config.systems_config_v40.cooling[].enabled
building_config.systems_config_v40.cooling[].id
building_config.systems_config_v40.cooling[].label
building_config.systems_config_v40.cooling[].setpoint (in)
building_config.systems_config_v40.cooling[].share_pct
building_config.systems_config_v40.cooling[].source
building_config.systems_config_v40.cooling_setpoint_c
building_config.systems_config_v40.cooling_setpoint_mode
building_config.systems_config_v40.dhw
building_config.systems_config_v40.dhw[]
building_config.systems_config_v40.dhw[] (in)
building_config.systems_config_v40.dhw[].cold_supply_temp_c (in)
building_config.systems_config_v40.dhw[].demand_basis (in)
building_config.systems_config_v40.dhw[].demand_litres_per_m2_day (in)
building_config.systems_config_v40.dhw[].demand_litres_per_person_per_day (in)
building_config.systems_config_v40.dhw[].efficiency_metric
building_config.systems_config_v40.dhw[].enabled
building_config.systems_config_v40.dhw[].id
building_config.systems_config_v40.dhw[].label
building_config.systems_config_v40.dhw[].setpoint (in)
building_config.systems_config_v40.dhw[].share_pct
building_config.systems_config_v40.dhw[].source
building_config.systems_config_v40.dhw[].tap_outlet_temp_c (in)
building_config.systems_config_v40.dhw_cold_supply_temp_c
building_config.systems_config_v40.dhw_demand_basis
building_config.systems_config_v40.dhw_demand_litres_per_person_per_day
building_config.systems_config_v40.dhw_load_shape
building_config.systems_config_v40.dhw_storage_setpoint_c
building_config.systems_config_v40.dhw_tap_outlet_temp_c
building_config.systems_config_v40.heating
building_config.systems_config_v40.heating[]
building_config.systems_config_v40.heating[] (in)
building_config.systems_config_v40.heating[].efficiency_metric
building_config.systems_config_v40.heating[].enabled
building_config.systems_config_v40.heating[].id
building_config.systems_config_v40.heating[].label
building_config.systems_config_v40.heating[].setpoint (in)
building_config.systems_config_v40.heating[].share_pct
building_config.systems_config_v40.heating[].source
building_config.systems_config_v40.heating_setpoint_c
building_config.systems_config_v40.heating_setpoint_mode
building_config.systems_config_v40.lighting
building_config.systems_config_v40.lighting[]
building_config.systems_config_v40.lighting[] (in)
building_config.systems_config_v40.lighting[].control_factor
building_config.systems_config_v40.lighting[].control_mechanism
building_config.systems_config_v40.lighting[].enabled
building_config.systems_config_v40.lighting[].id
building_config.systems_config_v40.lighting[].label
building_config.systems_config_v40.lighting[].share_pct
building_config.systems_config_v40.small_power
building_config.systems_config_v40.small_power[]
building_config.systems_config_v40.small_power[] (in)
building_config.systems_config_v40.small_power[].control_factor
building_config.systems_config_v40.small_power[].control_mechanism
building_config.systems_config_v40.small_power[].enabled
building_config.systems_config_v40.small_power[].id
building_config.systems_config_v40.small_power[].label
building_config.systems_config_v40.small_power[].share_pct
building_config.systems_config_v40.ventilation
building_config.systems_config_v40.ventilation[]
building_config.systems_config_v40.ventilation[] (in)
building_config.systems_config_v40.ventilation[].defrost_penalty_kwh
building_config.systems_config_v40.ventilation[].efficiency_metric
building_config.systems_config_v40.ventilation[].efficiency_metric.recovery_latent_pct
building_config.systems_config_v40.ventilation[].efficiency_metric.recovery_sensible_pct
building_config.systems_config_v40.ventilation[].efficiency_metric.sfp_w_per_lps
building_config.systems_config_v40.ventilation[].enabled
building_config.systems_config_v40.ventilation[].flow_rate
building_config.systems_config_v40.ventilation[].flow_rate_basis
building_config.systems_config_v40.ventilation[].id
building_config.systems_config_v40.ventilation[].label
building_config.systems_config_v40.ventilation[].share_pct
building_config.systems_config_v40.ventilation[].summer_bypass
building_config.thermal_bridges
building_config.thermal_bridges.mode
building_config.thermal_bridges.multiplier
building_config.thermal_mass_category
building_config.thermal_mass_mode
building_config.width
building_config.window_count
building_config.wwr
building_config.wwr.east
building_config.wwr.north
building_config.wwr.south
building_config.wwr.west
```

**construction_choices** (4 paths)

```
construction_choices.external_wall
construction_choices.glazing
construction_choices.ground_floor
construction_choices.roof
```

**libraryData** (24 paths)

```
libraryData.constructions
libraryData.constructions[]
libraryData.constructions[].config_json.u_value_override
libraryData.constructions[].g_value
libraryData.constructions[].layers[]
libraryData.constructions[].layers[].conductivity
libraryData.constructions[].layers[].density
libraryData.constructions[].layers[].kind
libraryData.constructions[].layers[].specific_heat
libraryData.constructions[].layers[].thermal_resistance
libraryData.constructions[].layers[].thickness
libraryData.constructions[].name
libraryData.constructions[].u_value_W_per_m2K
libraryData.constructions[].y_factor
libraryData.system_templates
libraryData.system_templates[]
libraryData.system_templates[].cooling_seer
libraryData.system_templates[].dhw_seasonal_efficiency
libraryData.system_templates[].fuel
libraryData.system_templates[].heating_scop
libraryData.system_templates[].hre
libraryData.system_templates[].id
libraryData.system_templates[].supports_services
libraryData.system_templates[].supports_services[]
```

### Read by the engine on paths the anchor does not take

Static references to `building.<key>` in `instantCalc.js` and its helpers that the anchor run did not hit: `comfort_band` (retired by Brief 58 A2; the engine throws instead), `occupancy_rate` and `people_per_room` (top-level legacy, retired from DHW by Brief 72 P3, still in the inline-legacy path), `schedules` (the project-local schedule list, read when a `schedule_ref` / `control_schedule_id` resolves; Bridgewater's live config references `always_on` and `business_hours_09_18_weekdays`), `systems_config` (legacy fallback when `systems_config_v25` is absent). Part 1's coverage test should list these as "known, not on the anchor path" rather than leave them out.

### In the fixture but never read

`address`, `building_type`, `future_weather_file`, `library_interventions`, `library_systems`, `name`, `occupancy_rate`, `operator`, `people_per_room`, `postcode`, `roadmap`, `schedules`, `schema_version`, `strategies`, `weather_file` (read by the anchor script to find the EPW, not by the engine). `location` is read as an object but none of its children are (latitude comes from the EPW).

### What this means for Part 1

- **`systems_config_v25` is read as well as `systems_config_v40`.** The brief's converter takes "`building_config` + `systems_config_v40`". State 3 resolves heating, cooling and DHW from v25 (`primary`/`secondary.library_id`, `primary_pct`, `setpoint_c`, DHW `fuel_mix`, store and mains temperatures, litres) against `libraryData.system_templates`, and v25 ventilation supplies `hours`, `schedule_ref` and `library_id` that v40 does not carry (`instantCalc.js:2890-2925`, Brief 76 P2). All of it can be placed as system groups with a `template_ref` and a profile reference without inventing a concept, so it is not a stop under the brief's rule, but the converter must read v25 too, and the brief's wording should say so.
- **`construction_choices` comes in two shapes:** bare names in the fixture (`"bridgwater_ext_wall"`), `{ library_id, u_value_override, g_value_override }` in the live Bridgewater row (`u_value_override: 0.154` on the wall). The model document has to carry the override, not only the reference.
- **The comfort band is an engine input** and is not in `building_config`. It belongs in the model document.

---

## (b) The library: tables, columns, counts, and what configs reference

**Schema** (`api/db/schema.sql`): one table, `library_items (id, library_type, name, display_name, description, config_json, is_default, created_at, updated_at)`. `library_type` values in use: `construction`, `system`, `schedule`, `benchmark` (the schema comment also names `weather`; no code writes it). Defaults are seeded at backend start from `nza_engine/library/{constructions,systems,schedules,benchmarks}.py` (`database.py` `_seed_*`; systems are `INSERT OR REPLACE` and stale defaults deleted).

**Counts (read-only copy).** The DB read is the copy on Linzie's machine, `C:\Users\ChrisScott\Dev\nza-sim\data\nza_sim.db`: Chris's "Bridgewater Hotel transfer pack" (its `RESTORE_README.txt`), last written 17 Jul 2026, sha256 `5a41bcf1e23808ea5ccbd5fc9f9a0c276c0f4a32d257c189d776d5525b5dd51b`. It was copied into the cloud session and opened `mode=ro`; the file on the machine was not opened for writing. **It is not Chris's live DB** (`C:\Dev\nza-simulate\data\nza_sim.db` per CLAUDE.md). Part 3 must re-count on the DB it exports from.

| library_type | default | custom | total | items |
|---|---|---|---|---|
| construction | 11 | 4 | 15 | the 11 seeded + `bridgwater_ext_wall`, `bridgwater_roof`, `bridgwater_ground_floor`, `bridgwater_glazing` |
| system | 18 | 0 | 18 | `gas_boiler_heating`, `vrf_heating`, `ashp_heating`, `electric_panel_heating`, `vrf_cooling`, `split_system_cooling`, `none_cooling`, `vrf_standard`, `vrf_high_efficiency`, `ashp_space`, `gas_boiler_standard`, `gas_boiler_dhw`, `ashp_dhw`, `ashp_dhw_preheat`, `electric_immersion`, `solar_thermal_dhw`, `mev_standard`, `mvhr_standard` |
| schedule | 15 | 0 | 15 | hotel bedroom/corridor/reception occupancy, lighting, equipment, setpoints, DHW, ventilation ×3, office ×2, retail ×1 |
| benchmark | 3 | 0 | 3 | `crrem_hotel_uk_15`, `crrem_hotel_uk_2`, `uk_grid_carbon_fes_leading` |
| **all** | 47 | 4 | **51** | |

Other tables in the same copy, for scale: `projects` 4 (Bridgewater Hotel, Bridgewater — Enhanced Fabric, New Project, ZZ TEST), `scenarios` 7, `simulation_runs` 61, `consumption_data` 3, `consumption_records` 17,568.

**What configs reference by `library_id`** (all four projects scanned):

- **Constructions:** `construction_choices.{external_wall, roof, ground_floor, glazing}` name a `library_items` construction (Bridgewater: the four `bridgwater_*`; the two older projects: seeded ones). These are SQLite rows.
- **System templates: not the SQLite rows.** v25 `library_id`s (`vrf_heat_recovery_dual_function`, `dx_split_cooling`, `electric_panel_heater`, `ashp_dhw_preheat`, `gas_boiler_calorifier`, `mvhr_with_hr`, `wc_extract_no_hr`) resolve against `frontend/src/data/systemTemplatesLibrary.js` (`SYSTEM_TEMPLATES_LIBRARY`, 7 entries, in JS). Only `ashp_dhw_preheat` also exists in SQLite. The 18 SQLite `system` rows are the EnergyPlus generator's list and are referenced by no config's engine path. v40 entries carry their efficiency inline (`source`, `efficiency_metric`), no library reference.
- **Schedules:** the SQLite `schedule` rows are not referenced by the anchor path; profiles carry their schedules inline (`gains.*.profiles[].schedule`, `occupancy.schedule`), and `schedule_ref`s point at the project-local `building_config.schedules` list.
- **Interventions:** `int_*` ids are `building_config.library_interventions` (project-local), not `library_items`.
- **Weather:** not in `library_items`. EPW files on disk under `data/weather/{current,future}`; the copy has one: `GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw`, sha256 `c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2`.
- **Project-local libraries inside `building_config`:** `library_systems` (Brief 37), `library_interventions`, `cost_template_library`, `schedules`. Part 3 as written exports none of them.

**Mapping to `sim.library_items.kind` (Part 3 needs a ruling):** `construction` → `construction` (15). `schedule` → `profile` (15). `system` → `system_template`: the 18 SQLite rows, the 7 JS templates the engine actually uses, or both. `benchmark` (3) has no kind in the brief. `age_band_default`: nothing in nza-sim to export (no age-band data anywhere in the repo); it stays empty until Library 2. `weather`: no rows; the design note (Rev A.3) puts weather files in Storage. **Proposal:** export the 7 JS templates as `system_template` (the engine reads those), keep the 18 SQLite system rows and the 3 benchmarks out of 102, record the EPW's hash only. Part 3's "counts equal Part 0" then means 15 + 15 + 7 = 37.

---

## (c) decodED's tenancy functions and the shape of `my_access()`

All are `language sql|plpgsql stable security definer`, `set search_path = public, pg_temp`, executable by `authenticated` only (revoked from `public` and `anon`).

| Function | Defined | Returns | What it says |
|---|---|---|---|
| `is_anonymous_caller()` | 0003 | boolean | JWT `is_anonymous` |
| `caller_id()` | 0003 | uuid | `auth.uid()`, null for anon and anonymous users (D4). Policies call it as `(select public.caller_id())` |
| `require_caller()` | 0003 | uuid | raises `sign in first` (42501) if null; every write starts with it |
| `role_in(org uuid)` | 0003 | text | caller's strongest active role (`admin` > `editor` > `viewer`) in `org` or up to 3 parents above it (a trust's role reaches its schools); null if none |
| `can_read_org(org uuid)` | 0003 | boolean | `role_in(org) is not null` |
| `is_admin_of(org uuid)` | 0003 | boolean | `role_in(org) = 'admin'` |
| `is_nza_team()` | 0008 | boolean | caller has a row in `public.nza_team` (written only by the DB owner) |
| `org_has_pro(org uuid)` | 0008 | boolean | org or a parent is the test org, or owns a paid plan; **not granted to anyone** |
| `my_access()` | 0008 → 0021 → 0022 → **0024** | jsonb | the caller's reach, below |
| `can_read_plan` / `can_edit_plan(plan)` | 0005 → **0021** | boolean | role in the plan's owner org **or `is_nza_team()`**; edit needs admin/editor and a paid plan (or test tree), NZA always |
| `in_test_tree`, `is_above`, `held_plan`, `plan_has_pro`, `is_support`, `shares_with_nza` | 0021 | | plan/test-tree helpers |

Tables Simulate would foreign-key: `public.organisations (id uuid, name, kind in ('school','trust','la','college','university','business','department','other'), parent_org_id, urn, verified_at, personal_of, test_owner, awaiting_check_since, …)`; `public.memberships (org_id, user_id, role, status in ('active','removed'))`. `create_organisation` was withdrawn from signed-in users by 0013: a non-school organisation (a hotel client, say, `kind = 'business'`) is made by NZA in the SQL editor.

**`my_access()` today (0024):**

```
{ signed_in: bool, nza_team: bool, can_add_test_schools: bool,
  orgs:  [ { id, name, kind, urn, parent_id, role, pro, official, awaiting_check,
             plan_id, last_changed, shares_with_nza, requests_waiting } ],   -- trusts first, then by name
  holds: [ { urn, name, plan_id, site_id, org_id, org_name, org_kind, own, official,
             awaiting_check, role, pro, last_changed } ],
  saved: [ { urn, name, place, saved_at, seen_at, held } ],
  ask_to_join: [ { urn, name } ] }
```

`orgs` is every organisation the caller is an active member of plus up to three levels beneath, each with the caller's `role` there. Signed out it returns the same keys with `false` and `[]`. The Part 4 switcher reads `orgs[]` (`id`, `name`, `kind`, `role`) and ignores the rest.

**Building identity in decodED (for `decoded_building_key`).** decodED has no building table. A school is a URN; a project is `plans` (one current plan per organisation and URN, 0021); a site is `sites.id` (per plan: the same URN sits in several plans that never join); a building is an entry in the twin document kept in `saved_twins.doc` per site, with a string `id` from the producer (OSM footprints give `osm:way:<n>`; a split gives `<id>#1`, `<id>#2`). Nothing in decodED today is a stable cross-plan building key; "URN plus twin building id" is the nearest. For 102, `decoded_building_key text null` is the right shape; its format is brief 113's to fix. Non-school clients have no URN.

---

## (d) Can decodED's Supabase project host a `sim` schema under decodED's rules?

**Yes. No decodED rule and no Supabase limit forbids it**, and decodED already runs a second schema the same way (`nza_copy`, 0021 §18: own schema, RLS-style lock-down, "not one the Data API exposes"). Both projects have `pgcrypto` (in `extensions`) and Postgres 17's built-in `sha256(bytea)` (which 0003's `token_hash` already uses). The brief's default holds, with the project corrected and these conditions:

1. **Which project.** As above: **NZA Decoded Test** (`stxitqwhaesraisfwyes`), not the live "NZA Decoded". The rule quoted: *"Public product: never develop against live user data; keep a dev/prod split."* (decodED `CLAUDE.md`). decodED's own README still opens with "The current Supabase project ("NZA Decoded", eu-west-1) is the **dev** project", which is stale and is where the brief's wording came from; its "What is applied where" section is current.
2. **Exposed schemas.** supabase-js calls `sim.*` functions through PostgREST only if `sim` is in Project Settings → API → Exposed schemas. decodED's runbook (`supabase-auth-settings.md` item 13): *"Exposed schemas … `public` (and `graphql_public`); never `auth` or `extensions`."* It does not forbid another schema, but adding `sim` is a dashboard change on decodED's project and a line in decodED's runbook. With RLS on every table, writes through functions only and `anon` revoked, exposure is safe. The alternative (wrapper functions in `public`) is ruled out by the brief.
3. **Erasure (GDPR).** decodED erases a person with `forget_person(user)` as the service role; `test/db/launch-hardening.test.ts` fails CI when a foreign key to `auth.users` **in `public`** is not covered. `sim.projects.created_by` and `sim.model_versions.created_by` would name a person outside both. Proposal for Part 2: no foreign key from `sim` to `auth.users`, plus a `sim.forget_person(p_user)` that nulls `created_by` (service role only), and one line added to decodED's `docs/runbooks/erasure.md` in a decodED PR. Needs Chris's or Linzie's OK because it touches decodED's repo.
4. **"Store inputs, never results."** decodED's README: *"No table holds a computed figure; CI fails if a column named like co2, emission, score or rating appears."* The CI check is scoped to `table_schema = 'public'` (`cross-cutting.test.ts:142`), so `sim.runs` does not trip it, and the design note (Rev A.3) decides that Simulate stores runs. Recorded here so nobody is surprised: Simulate's tables keep computed results by design, in their own schema.
5. **NZA's own access.** decodED's plan functions let `nza_team` read and edit every project (`can_read_plan` / `can_edit_plan`, 0021). `can_read_org` does not. If `sim` RLS is only `can_read_org(org)`, Chris and Linzie cannot open a client's model without a membership in the client's organisation. **Proposal:** read and write in `sim` = `can_read_org(org) or is_nza_team()`, writes also needing `role_in(org) in ('admin','editor')` for non-NZA callers. Library writes as the brief says (NZA team or org admin).
6. **The migration ledger.** Every decodED migration from 0013 ends by inserting its own row into `public.schema_applied`. `sim` migrations must not write `public`, so `sim_0001` keeps its own `sim.schema_applied` with the same shape.
7. **Auth flow and redirect URLs.** decodED signs in with **email + password** (`signInWithPassword`, `public/auth.js:555`), "Confirm email" on live and off on the test project, anonymous sign-ins off, no CAPTCHA. "The same email flow decodED uses" is therefore email + password, not a magic link. Confirmation and password-reset links go to the project's Site URL / Redirect URLs, which list only decodED's origin (runbook item 3). NZA Sim's origin (`http://localhost:5176`, later its Vercel URL) must be added on the test project for reset links to land in NZA Sim; sign-in itself needs no redirect.
8. **Keys.** decodED's rule set for keys applies as the brief says: anon key public by design (served to the browser), RLS on every table, the only server secrets are `SUPABASE_CACHE_KEY` and `SUPABASE_BILLING_KEY`, never on a laptop. 102 needs no secret: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (test project) in `frontend/.env.local`, values from Bitwarden "NZA".

**Part 2's server-side hash check, a design note to carry forward.** The brief has `sim.create_model_version` reject a row whose `model_hash` is not the sha256 of the canonical document, computed in SQL. Postgres cannot reproduce JavaScript's canonical JSON from a `jsonb`: `jsonb` re-orders keys by length then bytes, and prints numbers in `numeric` form (`1e-7` comes back as `0.0000001`, `1e21` as `1000000000000000000000`, `-0` as `0`), so a SQL re-serialisation would disagree with `canonicalJSON` on legitimate documents. **Proposal:** the function takes `p_canonical text` (the exact bytes the client hashed), checks `encode(sha256(convert_to(p_canonical,'UTF8')),'hex') = p_model_hash`, and stores `p_canonical::jsonb` as `document` (so the stored document is provably the hashed one). The same server check, no second serialiser.

---

## (e) The anchor path today

`node scripts/_brief93_anchor.mjs --fixture` at **`aae9e9e7e24e53678bdc208dd4629e7d9662d6e6`** prints **`eui_kwh_per_m2: 132.6`** (state 3, mode `full`, GIA 4,216 m², electricity 401.544 MWh, gas 157.428 MWh, heating demand 87.7 MWh, cooling 101.1 MWh, DHW demand 257.335 MWh, fan 40.613 MWh).

Run in the cloud session (Node v22.23.4, Linux), with the fixture from the repo and the EPW copied from Linzie's machine (sha256 above). The script's `--fixture` mode needs `validation/.venv/bin/python` (for pyyaml) and `data/weather/current/<epw>`; both are gitignored and were provided locally for the run, nothing committed. No `npm install` was needed: the engine imports nothing from `node_modules`.

Note for Part 5: **the anchor depends on an untracked file.** The EPW is not in git and nothing records its hash today. `weather_hash` for the anchor should be the EPW's sha256 (`c6571102…cf2`), not the file name, or "same inputs, same number" has a hole in it.

On Linzie's machine (Windows has no `validation/.venv/bin/python`; the script's venv path is POSIX-only, so `--fixture` fails there as written):

```powershell
cd C:\Users\ChrisScott\Dev\nza-sim
git fetch origin; git checkout chris/102-sim-v2-foundations
python -m venv validation\.venv; validation\.venv\Scripts\pip install pyyaml
node scripts\_brief93_anchor.mjs --fixture | Select-String eui_kwh_per_m2
```

The last line will throw on Windows until the script also looks for `validation\.venv\Scripts\python.exe`. That is a one-line fix in a script, not in the engine; proposed for Part 5 (where the round-trip script is written anyway), not done here.

---

## (f) The frontend's auth and env plumbing today

- **Auth: none.** No sign-in, no session, no user; no `supabase` string anywhere in `frontend/src`. The backend (FastAPI on :8002) has no auth either.
- **`import.meta.env`: not used anywhere** in `frontend/src`. No `VITE_*` variable, no `.env`, `.env.example` or `.env.local` in `frontend/` or tracked in git.
- `frontend/vite.config.js` reads `process.env` at dev-server start only: `PORT` (default 5176), `STRICT_PORT`, `API_TARGET` (default `http://127.0.0.1:8002`), and defines `__APP_SHA__` from `git rev-parse`. `/api` is proxied to the backend.
- Entry: `frontend/src/main.jsx` renders `<App />` with `createRoot`; routing in `App.jsx` (`/systems` → `SystemsModule`). Wrapping `<App />` in an `AuthGate` that renders children unchanged when the env is unset touches one file, as the brief says.
- **Toolchain gaps the later Parts will meet:** the frontend is JavaScript only (no TypeScript files, no `tsconfig`, no typecheck); Vite transpiles `.ts`/`.tsx` without config, so the brief's `.ts` files will build. There is no test runner and **no `zod`**: Part 1 needs both `vitest` and `zod` in `devDependencies`/`dependencies` (the brief lists only vitest). Node scripts that import `.ts` (Part 5's round-trip) need Node ≥ 22.18 (type stripping on by default) or a `.mjs` build; check on the laptop with `node --version`. Web Crypto (`globalThis.crypto.subtle`) exists in Node 22 as well as the browser, so `canonical.ts` can use one sha256 implementation for both, rather than the two the brief describes.
- UI callers pass `libraryData` built in `ProjectContext` from the API and `systems` from the project row; the Systems page entry is `SystemsLiveResults.jsx:295` (`calculateInstant(params, constructions, systems, libraryData, weatherData, hourlySolar, scheduleProfiles, { comfortBand, _skipInterventions: true })`). Part 5's button should call through the same inputs the page already has.

---

## Divergences from the brief, for the next Parts

| # | Brief says | Found | Proposal |
|---|---|---|---|
| 1 | decodED's **dev** project | it is decodED's **live** DB since 5 Nov | apply to **NZA Decoded Test** (`stxitqwhaesraisfwyes`) |
| 2 | converter takes `building_config` + `systems_config_v40` | State 3 also reads `systems_config_v25`, `construction_choices` (with overrides), the comfort band columns, library constructions and the JS system templates | converter takes all of them; brief wording updated in Part 1's commit |
| 3 | SQL recomputes the canonical hash with `digest(...)` | `jsonb` cannot reproduce JS canonical JSON | function takes `p_canonical text`; built-in `sha256()` |
| 4 | RLS select via `can_read_org` | NZA consultants would be locked out of client models | `can_read_org(org) or is_nza_team()` |
| 5 | `created_by uuid` | outside decodED's erasure and its CI guard | no FK to `auth.users`; `sim.forget_person`; one line in decodED's erasure runbook (decodED PR) |
| 6 | (silent) | `sim` must be an exposed schema | dashboard change on the test project + decodED runbook line |
| 7 | Part 3 kinds and counts | `system` rows are not what the engine reads; `benchmark` has no kind; no age-band or weather rows | 15 constructions + 15 profiles + 7 JS system templates = 37; EPW by hash |
| 8 | Part 1 adds vitest | zod is not a dependency either | add `zod` and `vitest` to `frontend/package.json` (no install pushed) |
| 9 | `canonical.ts` with two sha256 implementations | Web Crypto exists in Node 22 | one implementation |
| 10 | `weather_hash` of "the legacy weather id" | the anchor EPW is untracked; a name is not a hash | `weather_hash` = sha256 of the EPW bytes |
| 11 | `_brief93_anchor.mjs --fixture` on the laptop | venv path is POSIX-only | Windows path fallback in Part 5 |
| 12 | Part 0 "nothing else changed" vs CLAUDE.md rule 7 (STATUS.md every Part) | conflict | STATUS.md updated from Part 1 |

---

## Appendix — the trace harness (not committed; run from outside the repo)

```js
// node trace.mjs <repo>   — runs the anchor as _brief93_anchor.mjs --fixture with recording Proxies.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'
const REPO = process.argv[2]
const { calculateInstant } = await import(path.join(REPO, 'frontend/src/utils/instantCalc.js'))
const { computeHourlySolarByFacade } = await import(path.join(REPO, 'frontend/src/utils/solarCalc.js'))
const { SYSTEM_TEMPLATES_LIBRARY } = await import(path.join(REPO, 'frontend/src/data/systemTemplatesLibrary.js'))
const fx = JSON.parse(execFileSync('python3', ['-I', '-c', 'import yaml,json,sys; json.dump(yaml.safe_load(open(sys.argv[1])), sys.stdout)', path.join(REPO, 'validation/fixtures/bridgewater_anchor_v2.yaml')], { encoding: 'utf-8', maxBuffer: 1 << 27 }))
const reads = new Map(), copied = new Set(), enumerated = new Set(); const norm = p => p.replace(/\.\d+(?=\.|$)/g, '[]'); let pend = null
function wrap(obj, p) {
  if (obj === null || typeof obj !== 'object' || ArrayBuffer.isView(obj)) return obj
  return new Proxy(obj, {
    ownKeys(t) { const k = Reflect.ownKeys(t); enumerated.add(norm(p)); pend = { t, k: k.filter(x => typeof x === 'string') }; return k },
    get(t, k, r) { const v = Reflect.get(t, k, r); if (typeof k !== 'string') return v
      if (Array.isArray(t) && (k === 'length' || typeof Array.prototype[k] === 'function')) return v
      const cp = norm(`${p}.${k}`); if (pend && pend.t === t && pend.k[0] === k) { pend.k.shift(); copied.add(cp) } else reads.set(cp, (reads.get(cp) || 0) + 1)
      return typeof v === 'object' ? wrap(v, `${p}.${k}`) : v },
    has(t, k) { if (typeof k === 'string') reads.set(norm(`${p}.${k}`) + ' (in)', 1); return Reflect.has(t, k) },
  })
}
// …weather, hourlySolar and libraryData built exactly as scripts/_brief93_anchor.mjs builds them…
const res = calculateInstant(wrap(building, 'building_config'), wrap(constructions, 'construction_choices'), {}, wrap(libraryData, 'libraryData'), W, hourlySolar, null,
  { comfortBand: fx.comfort_band, _skipInterventions: true, engine: 'v2.5' })
// → eui 132.6, state 3, 320 read paths; spread-only copies: libraryData.constructions[].config_json, .layers
```
