# NZA SIMULATE — Project Rules

**Read this entire file before doing anything. These rules apply to every session, every task, every line of code.**

---

## What is NZA Simulate?

NZA Simulate is a web-based building energy simulation and analytics platform, powered by EnergyPlus. React frontend, FastAPI backend, SQLite database. It helps energy consultants define buildings parametrically, run EnergyPlus simulations, and present results through clear, stunning visualisations — load profiles, energy flow Sankey diagrams, fabric analysis, and scenario comparisons.

This tool is a sibling to Pablo (NZA's electricity cost analytics platform). It shares Pablo's design system, architectural patterns, and development philosophy.

---

## Environment

1. **Working directory:** a local folder — NOT on OneDrive. The OneDrive copy rule is inherited from Pablo and is non-negotiable. Known checkouts:
   - Chris's machine: `C:\Dev\nza-simulate`, with Chris's live DB in `data\`.
   - IT15 (Linzie's sessions): `C:\Users\ChrisScott\Dev\nza-sim`. Its `data\nza_sim.db` is the 17 Jul 2026 transfer-pack copy, not Chris's live DB. Simulate v2 (Brief 102 onward) is worked in the git worktree `C:\Users\ChrisScott\Dev\nza-sim-102`, which has its own `data\` (never a junction to the main one, Backup discipline Rule 1).
2. **Why not OneDrive:** OneDrive syncs `.git` internals and `node_modules` in the background, causing corrupted git objects, SQLite WAL desync, npm install failures, and ghost files. This is unfixable — these tools are fundamentally incompatible with OneDrive's sync. Do not suggest moving to OneDrive. Ever.
3. **Servers:** Backend runs on port 8002 (`python -m uvicorn api.main:app --host 127.0.0.1 --port 8002` from project root). Frontend runs on port 5176 (`npm run dev` from `frontend/`). Two terminal windows required. Ports are deliberately different from Pablo (8001/5175) so both tools can run simultaneously.
4. **Data files are local-only.** The `data/` folder (containing weather files, simulation outputs, and any SQLite databases) is in `.gitignore`. It does not exist on GitHub. If you clone the repo fresh, the backend creates an empty database on startup — but library items (constructions, system templates, profiles, weather files) will need to be re-ingested or copied from a working installation.
5. **npm install on Windows:** Use `npm install --force` if you get EBADPLATFORM errors on Windows.
6. **Launcher:** `C:\Dev\nza-simulate\go.bat` starts both servers and opens the browser. Double-click to run. This file is gitignored — it lives only on Chris's machine. Do not delete it. Do not modify it without asking Chris.
7. **EnergyPlus installation:** EnergyPlus must be installed locally. Default path: `C:\EnergyPlusV26-1-0\` (updated to V26.1.0 per Brief 30 Phase 0.3 schema lock 2026-05-18; previously V25-2-0). The backend reads the `ENERGYPLUS_DIR` environment variable, falling back to this default. Output:Variable names in the assembler + parser are confirmed valid for V26.1.0 — see `docs/audit/30_phase0_schema_lock.md` for the verified list.

---

## Non-negotiable technical rules

1. **EnergyPlus is the single source of truth for simulation results.** The backend generates epJSON, runs EnergyPlus, and parses the SQLite output. The frontend displays what the backend returns. No inline physics calculations in JSX files. No approximations that bypass the engine.
2. **Never generate synthetic data.** If a simulation hasn't been run, show an empty state. Do not create fake profiles, placeholder curves, or demo results. Do not use Math.random(). Empty is always better than fake.
3. **Library is the single source of truth for inputs.** Every construction, system template, occupancy profile, weather file, and schedule is a library item loaded via ProjectContext. No hardcoded U-values, no embedded schedules, no magic numbers. If a required library item is not assigned, the module shows an empty state — not defaults.
4. **Geometry schema is the contract.** The JSON geometry schema (documented in the project brief) is the boundary between any geometry input method and the epJSON generator. The generator consumes the schema without caring how it was produced. Do not bypass the schema by writing epJSON directly from UI state.
5. **Calculation engines live in `nza_engine/`.** All EnergyPlus input generation, simulation orchestration, and results parsing happens in Python in the `nza_engine/` directory. The API layer (`api/`) is a thin REST wrapper. The frontend calls API endpoints and renders results.
6. **Do not modify files outside your current task scope.** If the brief says "build the Sankey diagram," do not touch the 3D viewer, do not refactor the geometry generator, do not add components that weren't asked for. Stay in scope.

---

## Lessons from Brief 29 / Brief 30 (2026-05 audit)

These rules were learned the hard way during the May 2026 audit and dynamic-engine rebuild work. They supersede the earlier rules where they conflict — specifically Rule 1's "no inline physics in JSX" framing is refined by Rule 8 below (Static engines that are explicitly labelled as such may compute physics inline; code paths that claim to be the simulator's output may not).

7. **The Dynamic engine in any tool that wraps a slow authoritative simulator (EnergyPlus, IES, TAS, etc.) must consume that simulator's own outputs as the source of truth for displayed quantities.** If a layer between the simulator and the UI re-implements the calculation, that layer IS the engine, regardless of what the UI calls it. The wrapper's job is to request, read, aggregate, and display — never to compute physical quantities the simulator can produce. (Brief 29 Issue #8 / Bible lesson 1. **This refines Rule 1's intent:** inline physics is permitted in Static engines that are explicitly labelled as such; it is forbidden in code paths that claim to be the simulator's output.)

8. **State suppression in a multi-state model must remove the relevant objects from the simulation, not mute them via parameter widening.** "No systems" means no system objects in the model file. Muted setpoints, zero schedules, and disabled availabilities do not constitute suppression — the simulator's default behaviours in the muted state will contaminate the supposedly-suppressed result. (Brief 30 Principle 4.)

9. **Every term entering a demand integral, energy balance, or aggregate must appear as a line in the displayed breakdown.** Internal display consistency tests (display A = display B) are insufficient; the reconciliation must verify integrand-vs-display, not display-vs-display. Failing this invariant at any save/run point is a blocker bug. (Brief 29 Issue #6, raised to S3 in sign-off review. The Brief 28-IM-Polish POL-M3 `ReconciliationRow` shipped a display-to-display check that did NOT catch the door bug — both displays were missing the term in the same way. The replacement integrand-vs-display invariant is a Brief 30 Phase 1.4 deliverable.)

10. **Do not invoke exotic physical mechanisms (sky radiation, lumped-mass artefacts, CTF differences, "engine accuracy") to explain a number that violates basic building physics.** The gap is almost always a hidden integrand term, a display omission, or a wrong-topology assumption. Diagnose with instrumentation; do not defend with mechanism. Specifics with citation and magnitude, or silence. Banned phrases (extending the Brief 29 list): "radiative loss to sky lowering zone air temperature", "lumped 2-node mass artefact inflating demand by 30–60%", "T_zone swings below T_out on cold nights", "Dynamic uses CTF and Static uses 2-node so they're just different", "Dynamic is more accurate", "Static is more accurate", any unquantified appeal to "engine differences".

11. **One canonical quantity, one canonical exposure point in the engine output, one canonical read path everywhere.** A computed quantity (EUI, demand, carbon, …) must be exposed ONCE in the engine result, under one field path, and read everywhere through one helper. Adding a second exposure of a quantity that already has one — even an "alias" or "convenience" field — is a *boundary-mismatch in waiting*: the two are computed independently and will silently diverge under some state. (Brief 88 root cause: the instant engine exposed EUI as both `consumption.total.kwh_per_m2_yr` AND a top-level `eui_kWh_m2`; the Systems page read the alias, the Strategy page read the canonical, and they diverged ~100 kWh/m² on Bridgewater in one walkthrough state. Fix: canonical = `consumption.total.kwh_per_m2_yr`, read only via `frontend/src/utils/engineReads.readModelledEui`; the alias is deprecated. NB: the instant-engine EUI and the EnergyPlus *simulation* EUI (`results.summary.eui_kWh_per_m2`) are **different boundaries** — keep them distinct, never merge.)

    Brief 89 (Brief C, June 2026) extended Rule 11 to carbon factors and CRREM targets: `frontend/src/utils/carbonReads.js` (`readElectricityFactor` / `readGasFactor` / `readFuelFactor` / `readCrremTarget` / `hasCrremPathway`) is the one canonical read path for the **interventions / CRREM boundary**, over `data/ukGridCarbonTrajectory.js` (grid factors) + `data/crremPathwayUkHotel.js` (CRREM v2.07 UK Hotel curve, mirrors the backend `crrem_hotel_uk_15` benchmark). The engine's own carbon path (`data/carbonFactors.js` single-point factors, `data/crremTargets.js` v2.04) and the Results CRREMTab's benchmark fetch are **separate pre-existing boundaries** — left untouched; the multi-curve harmonisation flagged in `carbonFactors.js` remains queued debt, not Brief 89's to fix.

11. **Parameter binding at an API boundary can silently disable a feature without raising any error.** Every mode-like parameter in a request handler needs an integration test that verifies the parameter is honoured end-to-end, not just bound. (Brief 29 Issue #13 re-diagnosis / Bible lesson 2. FastAPI POST endpoints with `param: str = "default"` treat the parameter as query-string-only by default; JSON-body callers get the default silently. Mitigation pattern: use a Pydantic body model with `Body(default_factory=...)` plus query-param fallback, or be explicit with `Query(...)` annotation.)

12. **Default to rebuild, not refactor, when foundational assumptions have changed.** AI-built code is amenable to rebuild because the institutional knowledge lives in the briefs and the bible, not the code itself. Refactoring preserves the shape of the original (wrong) assumptions as interface constraints. Decline rebuild only when active dependencies would be broken in flight or when documentation cannot reconstruct what would be deleted.

13. **When a problem keeps having "the real root cause" turn out to be one level deeper than the previous diagnosis, the working assumption should be that more layers remain.** Continue diagnostic discipline; do not accept the latest plausible cause as final until the symptom is fully explained and verifiable from end to end. (Brief 29/30 multi-layer diagnostics / Bible lesson 3. The Issue #13 cascade: "lumped 2-node artefact" → "VRF + DSOA not muted by setpoints" → "API silently drops mode from JSON body" — three diagnoses, each more shallow than the next.)

14. **Envelope-physics changes to State 1 must be ported to State 2 and to the inline-legacy 'full' code path in `calculateInstant` in the same commit.** The Static engine intentionally maintains parallel envelope-physics implementations in State 1 and State 2 (Brief 28c — gains-warmed T_air trace makes the two states physically different, and combining them would re-introduce the bug class Brief 28c was designed to prevent). The inline-legacy 'full' code path in `calculateInstant` (`frontend/src/utils/instantCalc.js` line ~5087+) is a third parallel envelope implementation — known architectural debt; a follow-up brief will rationalise it via systems-block extraction (Option (a) in `docs/audit/39_calculation_flow_map.md`); until then, it must be kept in sync.

    This is Pattern C per `docs/audit/39_calculation_flow_map.md`.

    The risk of Pattern C is silent drift: a refinement lands in one state and the follow-up in the others never happens (e.g. Brief 33/34 added flow_mode dispatch to State 1; State 2 and inline-legacy received it eight briefs later via Brief 39).

    To prevent recurrence: any commit that changes the physics of an envelope-only term (conduction, thermal bridging, infiltration, **permanent vents, operable openings — per-opening cd + flow_mode dispatch (each facade and each operable opening declares its own physics), including stack contribution for temperature-mode**, solar transmission, glazing transmission) in State 1 MUST land the equivalent change in State 2 AND inline-legacy in the same commit. Not in follow-ups. Not as TODOs. The commit is incomplete until all three locations reflect the new physics.

    If a state genuinely requires different physics (e.g. the gains-warmed T_air trace produces a different integrand shape, or inline-legacy uses a simplified `sysDefaults` model), the commit message must explicitly state why the locations diverge and what the divergence means. Silent divergence is the failure mode.

    Helpers that are pure functions (validators like `resolveFlowMode`, lookups like `computeCd`) are module-scoped and shared across locations — those don't fall under this rule because they don't contain integration logic. The rule applies to integration-bearing code: the loops that walk hours/days/months and sum into demand integrals.

    **Structural mirror-checks (do State 1 and State 2 agree with each other) are necessary but not sufficient.** A periodic *correlation-correctness* check — does the shared correlation match current best-practice physics — is also required. The Brief 41 case: State 1 and State 2 were faithfully mirroring each other (Brief 39 Part 3 verified this), but both were running cross-flow-only physics that Brief 33/34 had already replaced for permanent vents. Mirror-correctness ≠ physics-correctness. The structural mirror check passed; the correlation hadn't been swept into the new dispatch. A correlation-correctness audit pass should accompany every Brief 14-class change so the parity rule is reinforced by an independent check on the *physics*, not just the *structure*.

    The rule's spirit applies to UI surfaces too: two implementations of the same control across modules create the same drift risk as two implementations of the same engine path. Brief 41 Part 7's shared `BuildingWideOpeningsControls` component (and its successor patterns) is the right shape — single source of truth, both modules wire to the same data, reactivity guaranteed.

    (Brief 39, May 2026. Audit chain: `docs/audit/39_state2_permanent_vent_diagnosis.md` → `docs/audit/39_calculation_flow_map.md` → Brief 39 Parts 1–6. Extended by Brief 41 Parts 0–7 + Part 6 close: operable openings, mirror-vs-physics-correctness, UI parity. Extended by Brief 42 Parts 1–6: per-opening cd + flow_mode — each facade and each operable opening declares its own physics; building-wide `openings.cd` and `openings.flow_mode` removed; site exposure stays building-wide. Engine reads switch under Rule 14 three-location parity in a single commit, `docs/audit/42_per_opening_migration.md`.)

---

## NZA Sim's own Supabase project (Brief 102, Nov 2026)

1. **NZA Sim has its own Supabase project and its own identity.** Dev: "NZA Sim (dev)", ref `jbjxduathkklruvbmeho`. A prod project is created, with the same migrations in order, before the first client; until then everything is dev only. Migrations live in `supabase/migrations/`; how to apply them is in `supabase/README.md`.
2. **Never decodED's database.** Nothing here reads from or writes to `NZA Decoded` (`weeaadpwofvbmcilxpkt`, live) or `NZA Decoded Test` (`stxitqwhaesraisfwyes`). The decodED link is Brief 113: an optional integration through `org_links` and a scoped token. NZA Sim reads nothing from decodED's database.
3. **Env names:** `VITE_NZASIM_SUPABASE_URL` and `VITE_NZASIM_SUPABASE_ANON_KEY` in `frontend/.env` (gitignored; names in `frontend/.env.example`; values in Bitwarden org "NZA"). With either unset, `AuthGate` renders the app unchanged and nothing calls Supabase, so today's tool runs exactly as before.
4. **The anon key is public by design**, safe only because every table has RLS and every write goes through a security-definer function. **No service-role key** in the repo, a laptop `.env`, a log or Notion. Scripts (e.g. `scripts/102_seed_library.mjs`) use the anon key plus a signed-in user's own session.
5. **Sign-in** is an email magic link. Organisations, roles (admin / editor / viewer) and invitations come from `my_access()` and the tenancy functions in `0001_tenancy.sql`; the current organisation is `useAuth().org` (`frontend/src/auth/AuthGate.tsx`).

## EnergyPlus runs in Simulate v2 (Brief 123, Nov 2026)

"Run in EnergyPlus" is the third tier (instant monthly estimate, NZA Sim hourly run, EnergyPlus). The translator is TypeScript (`frontend/src/thermal/energyplus/toEnergyPlus.ts`) and the runner is Node (`frontend/plugins/energyplusRunner.js`, mounted by the Vite dev server), a stated exception to Rule 5 because v2's model and engine are TypeScript; today's Python `nza_engine/` path is unchanged. EnergyPlus's result is its own (Rule 11): room loads and temperatures read from EnergyPlus (Rule 7), energy through the same system conversion as the hourly run, labelled. Never commit EPW files. Brief 125 (Linzie 17 Nov 23:50, "Follow EnergyPlus's method"): the 15-minute run's outside surface film is EnergyPlus's own DOE-2 (wind at each face's height and the site's terrain, wet faces in rain; `thermal/engine/outsideConvection.ts`), with one read of terrain (`airflow.ts siteTerrain`) and face height (`outsideFaceZ`) shared with the translator; the instant estimate and the referee options keep ISO 52016-1's fixed film, labelled. Brief 126 (Linzie 18 Nov 10:57, "Please fix"): the run's inside film (TARP; ISO 15099 on windows), outside long-wave and sky (from the weather file's infrared), window glass (EnergyPlus's simple glazing) and outdoor air's heat capacity are EnergyPlus's too, each checked against its own outputs; the translator carries thermal bridging as its own conductance, H·(θ_e − θ_air), not folded into the walls.

## Module scopes

These statements define what each module computes and what it does not.
They are the canonical scope contract for the module. A brief or feature
that asks for behaviour outside the stated scope is asking for the wrong
module and must be flagged before work begins.

### Building module — State 1 envelope-only

**Computes:**
- Conduction losses through opaque envelope (walls, roof, ground floor)
- Conduction losses through glazing
- Thermal bridging losses (linear and point)
- Solar gains through glazing
- Infiltration heat loss through the q50-rated envelope leakage area
- Permanent vent heat loss through always-open passive openings
  (trickle vents, louvres, fixed grilles, holes in the envelope)
- Heating and cooling demand to maintain a user-defined comfort band

**Does not compute and does not contain:**
- Occupancy, people, occupancy schedules
- Lighting, equipment, plug loads
- HVAC of any kind (no IdealLoads, no VRF, no heat pumps, no boilers,
  no chillers, no fan coils, no terminal units)
- Mechanical ventilation of any kind (no MVHR, no MEV, no extract fans,
  no supply fans, no extract rates, no heat recovery)
- Operable windows or doors (anything with a control schedule or
  temperature-responsive operation)
- DHW
- Controls, thermostats, deadbands, setbacks
- System efficiencies, COPs, SCOPs, MVHR effectiveness, distribution losses
- Delivered energy, primary energy, or carbon

**Notes on permanent vents specifically:**
Permanent vents are passive openings in the envelope. They are always
open. They are driven by wind (and stack where vertical separation
exists). They have no schedule. They have no control. They have no
relationship to any mechanical system in the building. If a building
has a bathroom extract fan, that fan is modelled in the Systems module
— not by changing how the trickle vent calculates flow.

Each permanent vent — and each operable opening in the Operation
module — declares its own discharge coefficient and flow mode
(single-sided / cross). Building-wide `openings.cd` and
`openings.flow_mode` were retired in Brief 42; a windward sharp-edged
louvre and a sheltered trickle vent on the same building no longer
share one slider. Site exposure (C_w) stays building-wide because
it's a property of where the building sits, not of any individual
opening.

**Notes on the comfort band:**
The setpoint used in heating/cooling demand calculation is a
user-defined comfort band, not a system setpoint. It is a constraint
on what the building needs from a hypothetical system, not a property
of an actual system. The Building module asks: "given this envelope,
what demand would a system need to satisfy to hold this comfort band?"
The system itself does not exist in this module.

If a calculation requires any input from the "does not compute and does
not contain" list, that calculation is in the wrong module. Move it or
remove it. Do not import non-envelope concepts into the Building
module's data model, calculations, or UI.

### Operation module — scope (stub, to be expanded when Operation is reworked)

**Computes:**
- Occupancy schedules (people, sensible/latent gains)
- Lighting use (gains; electrical end-use accounting is Systems)
- Equipment use (gains; electrical end-use accounting is Systems)
- Operable windows and doors (control logic, manual schedules,
  temperature-responsive operation)
- Manually operated blinds and shading devices

**Does not contain:**
- HVAC of any kind
- Mechanical ventilation, heat recovery
- Controls that depend on installed equipment (e.g. daylight dimming
  is Systems because it requires a control system; manual switch use
  is Operation because it is occupant behaviour)
- Electrical end-use energy (the kWh delivered; only the heat gains
  to the zone live here)
- Envelope physics (conduction, infiltration, permanent vents — all
  Building)

This stub will be expanded into a full scope statement when the
Operation module is reworked. Briefs touching Operation must declare
which of these scope items they affect.

### Systems module — scope

**Computes:**
- Energy delivered by installed equipment to serve heating, cooling,
  DHW, ventilation, lighting, and small-power demands
- Per-system: efficiency (SCOP / SEER / combustion η / SFP / recovery
  effectiveness / DHW point-of-use η), control mechanism, share of
  demand served
- Proportional split across multiple systems serving the same demand
  (no lead/lag, no schedule-based handoff; capacity and top-up per
  Brief 120 below)
- Emitter capacity per zone (Brief 108, Linzie 15 Nov 2026): a zone's
  heating is limited to its emitters' output at the system's flow and
  return temperatures (EN 442), re-rated each hour at the room's
  temperature at the design water flow; the zone then runs below its
  setpoint, and the unmet hours are reported. Simulate v2 only.
- Heating hours and setbacks per zone (Brief 109): a zone's heating
  setpoint follows its schedule between heat_c and setback_c, and
  cooling runs only in its hours; underfloor heating can put its heat
  into a floor layer. Brief 121 (Linzie 17 Nov 00:31): a zone's heating
  and cooling setpoints may instead follow temperature profiles, with
  heat_c / cool_c the profile's highest / lowest value. Simulate v2 only.
- Design heat loss per room (Brief 117): steady transmission and air
  heat loss at a stated design outdoor temperature, after MCS MIS 3005-D
  Issue 3.0 and the MCS calculator's public method (not the text of
  BS EN 12831-1), with an optional stated warm-up W/m², against the
  emitters' EN 442 output. Simulate v2 only.
- Cooling limited by room units (Brief 119): fan coils, VRF indoor
  units and other units state a fixed sensible cooling per unit; a
  zone's cooling is capped at the sum and the hours above setpoint are
  reported. Emitters may name a manufacturer catalogue item (Stelrad
  Vita Compact K2); the run checks the stated figures against it and
  never fills them. Simulate v2 only.
- System capacity (Brief 120, Linzie 16 Nov 18:42 "We need the
  capacity, not just of the heat emitters, but also of the system as
  well"): a heating or cooling system's stated `capacity_kw` limits
  what it gives its rooms each step. A short boiler feeding radiators
  shares through one lowered flow temperature (refereed against
  EnergyPlus); other plants in proportion to ask. What a short system
  cannot give in a room is topped up by the room's other systems
  (Linzie 19:48, "the boiler tops up"), with no order between them.
  Hot water heated first takes the boiler's capacity before the rooms.
  A dedicated water heater states its kW and store litres (Linzie
  19:19). Simulate v2 only.
- Back-of-house energy and the control map (Brief 114, Linzie 16 Nov
  00:57): pumps per heating / cooling / hot water system (W, W per kW
  or W per m²; fixed or inverter on EnergyPlus's ideal curve, labelled
  as such; continuous in the system's season (Linzie 23:11), with
  demand, or scheduled), fans continuous / scheduled / on demand
  inside their hours, lifts and external lighting as other loads, and
  `controls[]` recording who controls each thing (recorded, changes no
  number). Defaults from NCM Modelling Guide 2021 Table 14, labelled.
  Simulate v2 only.
- Comfort-vs-setpoint diagnostic: demand at envelope comfort vs
  delivered at service setpoint, per service, with the delta exposed
- DHW tap-mix model: the boiler heats only the hot fraction of tap
  consumption, not the total tap litres. `hot_fraction =
  (dhw_tap_outlet_temp_c − dhw_cold_supply_temp_c) /
  (dhw_storage_setpoint_c − dhw_cold_supply_temp_c)`
- Electrical end-use accounting for lighting and small power (thin
  entries that read the heat gain from Internal Gains and apply any
  controls; no double-counting in the heat balance)
- Lighting energy from the space's lux and the lighting system's
  luminaire efficacy (Brief 112): W/m² = lux ÷ 100 × efficacy
  (W/m² per 100 lux), worked out only in
  `thermal/engine/lighting.ts` (`lightingWm2`). The space states the
  lux (demand); the system states the efficacy (energy). A W/m²
  stated directly stays as "stated, not from lux". Hot water use
  (litres a day) is stated on the space; the heater stays on
  Systems. Simulate v2 only.
- Fuel split, carbon, total EUI roll-ups across all systems
- Conversion from envelope/internal-gains demand → delivered energy
  → source energy → carbon

**Does not contain:**
- Envelope physics (Building)
- Occupancy schedules (Internal Gains)
- Operable envelope operation (Operation)
- Permanent vents — passive envelope features in Building, not
  mechanical ventilation
- Renewables (PV, solar thermal) — queued for a follow-up brief
- Heat networks at the network level (district heat / district cooling
  are modelled as sources with an efficiency + loss factor; network-
  side modelling is out of scope)
- Lead/lag, sequencing or schedule-based system stacking. Systems
  in one room keep their shares; a system's capacity only limits it,
  and the others top up what it cannot give (Brief 120), in no order

**Service-level vs system-level fields (Brief 42, 2026-05-20):**

Fields on `systems_config_v40` split into two classes:

- **Service-level (building-level)** fields live directly on
  `systems_config_v40`, NOT on per-system entries. They describe
  the project's needs / zone targets. Multiple systems serving the
  same service share these via their `share_pct`. They are:
  - `heating_setpoint_mode` (`'follow_comfort'` | `'custom'`) +
    `heating_setpoint_c` (number | null)
  - `cooling_setpoint_mode` + `cooling_setpoint_c`
  - `dhw_storage_setpoint_c`, `dhw_tap_outlet_temp_c`,
    `dhw_cold_supply_temp_c`
  - `dhw_demand_basis` (`'per_person'` | `'per_m2'`) +
    `dhw_demand_litres_per_person_per_day` +
    `dhw_demand_litres_per_m2_per_day`

- **System-level (per-system)** fields stay on per-system entries
  in the heating / cooling / dhw / ventilation / lighting /
  small_power arrays. They describe the specific kit installed:
  `id`, `label`, `source`, `efficiency_metric`, `share_pct`,
  `control_mechanism`, `control_schedule_id`, `capacity_kw`,
  `notes`, `enabled`.

If the engine encounters a per-system instance of a service-level
field (stale data, hand-edited config), it errors loudly. No silent
fallbacks. Setpoint resolution:

- `*_setpoint_mode === 'follow_comfort'` → engine uses the comfort
  band's corresponding setpoint at compute time (lower_c for heating,
  upper_c for cooling).
- `*_setpoint_mode === 'custom'` → engine uses `*_setpoint_c`
  verbatim and recomputes State 2 demand at the custom setpoint so
  the comfort-vs-setpoint diagnostic can surface the delta.

This mirrors Brief 42's per-opening cd / flow_mode pattern: the
mode field is a flag, not an inheritance link — editing the
service to a custom setpoint severs the relationship to the
comfort band.

The activation-threshold case (UFH primary at 19°C + radiator
backup below 17°C) is a control-logic difference, not a setpoint
disagreement. Deferred to a future brief if real client need
surfaces — would land as an optional per-system
`activate_below_zone_temp` field, distinct from the service-level
setpoint.

(Brief 40, May 2026 — original schema in
`docs/audit/40_systems_library_schema.md`. Brief 42, May 2026 —
service-level reorganisation in
`docs/audit/42_systems_ux_schema.md`. Read together.)

### Interventions module — scope

**Computes:**
- Cumulative engine state for each enabled intervention in the user's
  stack, in order
- Marginal delta per intervention (this intervention's contribution
  on top of everything above it)
- Cumulative delta from baseline (sum of all enabled interventions'
  marginals)
- Patches composing each intervention — Type 1 field changes, Type 2
  array add/remove, Type 3 array replace, per the Notion design note
  §4

**Does not contain:**
- Envelope physics (Building)
- Internal gain definitions (Internal Gains)
- System definitions (Systems — interventions patch these, but the
  canonical shape lives in Systems)
- Operable envelope operation (Operation)
- Cost / payback / ROI (Roadmap module; interventions carry an
  optional `capex_gbp` field that Roadmap will read in a follow-up)
- Library items (existing library patterns from Brief 37 and Brief 40
  own these; interventions reference library items by ID through
  patches with `source: 'library'`)
- Calibration (calibration is just baseline editing per Notion §16 —
  no separate engine, no Interventions involvement)

The Interventions module touches `ProjectContext` only to add
`interventions: []` and `schema_version: <int>` to `DEFAULT_PARAMS`
as siblings of the existing building_config fields. It does not
modify any existing building_config field — interventions are
non-destructive declarative patches against the baseline.

**Pattern Y discipline (Notion §1–2):** patches are declarative, not
branched states. The engine runs the same baseline + computed
cumulative configs through unchanged engine entry points; no new
physics. Reordering reruns the chain; toggling an intervention skips
its patches; last-write-wins when two interventions patch the same
path.

**Schema-flexibility discipline (Notion §7, audit doc §7):** every
patch records the `schema_version` it was authored against; every
brief that changes building_config schema in a way that touches
existing patch paths must land a patch-migration function in the
same commit. No silent breakage of stored interventions when the
baseline schema evolves.

(Brief 41, May 2026. Full schema, patch shape, path conventions,
patch-application algorithm, and schema-flexibility discipline in
`docs/audit/41_interventions_schema.md`. Notion design note:
https://www.notion.so/365d645e05cc81b79160e49029d2158c.)

---

## Process rules

1. **Read before you code.** At the start of every session, read this file, then STATUS.md, then the current task brief (`docs/briefs/current.md`). Confirm what you understand before touching any code.
2. **One part at a time.** Complete one part of the brief. Verify it in the browser. Commit it. Then move to the next part. Do not start Part 2 until Part 1 is verified and committed.
3. **Verification means evidence.** Every completed part must have:
   * A clean build (`npm run build` with zero errors)
   * Browser verification at 1440×900 of every affected page/tab
   * Number checks against expected values (if specified in the brief)
   * Sanity checks: Does the EUI fall within CIBSE TM54 benchmarks? Do surface areas in the 3D viewer match manual calculations? Do running hours make physical sense?
   * If you see smooth curves, perfectly round numbers, or physically impossible values (COP > 10, negative heating demand, pump running > 8760 hours) — something is wrong. Stop and investigate.
4. **Three strikes then escalate.** If a fix doesn't work, try up to 3 different approaches. If none work, stop. Describe the problem clearly: what you tried, what happened, what you think the options are. Do not keep guessing. The human will decide what to do next.
5. **No scope creep.** Do not add features, components, or "improvements" that weren't asked for in the brief. If you think something should be added, note it in STATUS.md under "Suggestions" — do not implement it.
6. **Sanity check your work.** After making changes, open the tool in the browser and interact with it. Do the numbers make sense? Does the 3D viewer match the inputs? Does changing a U-value change the heating demand? This basic check catches most problems.

7. **Documentation hygiene is part of the commit, not after it.** Every commit that closes a brief part, lands a fix, or changes architecture must update STATUS.md as part of the same commit, not as a queued follow-up. If "cleanup + STATUS.md" is in the todo list at the end of a commit, the commit is incomplete. Brief management (rename closed briefs to `*_COMPLETED.md`, move to `archive/`, update `current.md`) is part of the same discipline. (Brief 31 documentation reconciliation, May 2026 — documentation drift across Briefs 26–30 was caught only by post-hoc human verification; this rule exists to prevent recurrence.)

8. **Verify documentation alignment at the start of every session.** Read STATUS.md and CLAUDE.md against the actual state of `docs/briefs/active/` and recent commits. If they diverge, the first commit of the session is the reconciliation. Do not begin new work against an inaccurate self-description of the project. (Brief 31, May 2026.)

9. **Multi-step work is briefed, not commanded.** Any task that touches more than one file or takes more than one commit is written as a numbered brief in `docs/briefs/active/` before work begins. The brief contains a BEFORE-DOING-ANYTHING checklist, numbered Parts with file paths and verification steps, and a "deliverables" section that includes documentation updates as numbered Parts (not as advisory text). Mid-chat instructions that span multiple files/commits without a brief are incomplete and should be returned to the architect for proper briefing. (Brief 30 / Brief 31, May 2026.)

10. **Briefs touching a module must state the module's scope at the top.**
    Any brief that modifies a module's data model, engine, or UI must
    include a scope statement (one paragraph or short list) confirming
    the brief's work fits within that module's declared scope per the
    "Module scopes" section. If a brief asks for work outside the stated
    scope, stop and flag — the brief belongs to a different module or
    needs to be rescoped.

11. **Stop the dev server before running migration scripts.** Autosave
    in the running app can produce partially-stripped intermediate
    states that race against a manual migration, leaving the persisted
    config in a half-migrated state that the next migration run
    misreads. The pattern caught in Brief 34: a one-shot migration that
    stripped the geometry fields ran while the dev server's autosave
    persisted a config with some fields already gone, causing the
    migration to read defaults instead of the source values. Standard
    practice for any migration script: (a) stop the dev server, (b) run
    the script, (c) verify the result by re-running the script (it
    should be a no-op on a clean migration), (d) restart the dev
    server.

---

## Git and backup rules

1. **Commit after every completed part.** Each commit should have a descriptive message: "Part 1: Geometry generator produces valid epJSON for rectangular buildings" not "updates" or "fixes."
2. **Push to GitHub after every merge to main.** Not at the end of the session — after every merge. If the session crashes, the work is safe on GitHub.
3. **If a merge conflict occurs, stop.** Describe the conflict clearly. Do not force-resolve, do not force-push, do not rebase without asking the human first.
4. **Banned git commands.** Never run these without explicit permission from Chris:
   * `git clean` (deletes untracked files — this WILL destroy the data folder)
   * `git reset --hard` (discards all uncommitted changes)
   * `git push --force` or `git push -f` (rewrites remote history)
   * `git rebase` (rewrites history — merge instead)
   * Any command that deletes or moves files in `data/` or `projects/`

---

## Data safety rules

1. **The `data/` directory contains weather files, simulation outputs, and the database.** It is NOT in git. If it is deleted, the data is gone.
2. **Before any risky operation, back up the database.** Copy the database file to a timestamped backup. Risky operations include: npm install, package upgrades, any script that writes to the database, any migration or schema change.
3. **Never run `rm -rf`, `del /s`, or recursive delete commands** anywhere near the project root or data directory.
4. **EnergyPlus simulation outputs are ephemeral.** They live in `data/simulations/{run_id}/` and can be regenerated by re-running the simulation. The library items and project configuration are what matter.

---

## Backup discipline (Brief 72 PA, 2026-05-28 — Bible addendum)

The 2026-05-28 22:34 DB-loss incident (worktree backend sharing the data directory via junction with the main backend, causing a clean WAL checkpoint of an empty schema into the live `nza_sim.db`) is the reason this section exists. Two rules apply.

### Rule 1 — Worktree diagnostics never share a data directory with main backend.

If a worktree needs to run the backend for any reason (browser-side discriminator, regression run, sidecar verification, etc.), it MUST have its own `data/` directory — not a junction or symlink back to the main repo's `data/`. Two safer alternatives:

- **Pure-Node fixture path (preferred for read-only diagnostics):** use a JSON fixture saved into `docs/audit/fixtures/`, run the engine code directly with `node scripts/...`, no backend, no SQLite contention.
- **Scratch DB path (for diagnostics that need the backend):** copy the live DB to `data-scratch/` inside the worktree, point the worktree backend at it via `NZA_DB_FILE=data-scratch/nza_sim.db`, run isolated. Even if it gets wiped, the live one is untouched.

NEVER `mklink /J` a worktree's `data/` to the main repo's `data/`. NEVER copy a worktree's empty DB back over the main one. Treat the live `data/nza_sim.db` as production state.

### Rule 2 — Local DB snapshot is mandatory and scheduled.

A daily snapshot of `data/nza_sim.db` (and `.db-wal`, `.db-shm` if present) is captured automatically by the Windows Scheduled Task **`nza-sim-db-daily-snapshot`** (daily at 02:00 local). Implementation lives at `scripts/snapshot-db.ps1`. Snapshots land in `C:\Users\ChrisScott\Backups\nza-sim-db\nza_sim_YYYY-MM-DD_HHMM.db` with 14-day rolling retention.

**You may not disable, skip, or delete this scheduled task.** If the brief you are working on touches the DB schema, the snapshot is your safety net — confirm the task is `State: Ready` before starting any DB migration:

```powershell
Get-ScheduledTask -TaskName 'nza-sim-db-daily-snapshot' | Select-Object State
```

If the task is missing or disabled, re-register it before proceeding by re-running the `Register-ScheduledTask` block in `scripts/snapshot-db.ps1`'s register comment (or by following the original Brief 72 PA registration steps).

**Autonomous-mode note from Brief 72 PA registration (2026-05-28):** the scheduled task was registered with the default principal (current logged-on user). The brief's instruction "Run whether user logged on or not" requires the `S4U` LogonType which needs an admin/elevated PowerShell session — not available from the autonomous shell. The fallback (current-user, logged-on-only) still fires reliably because Chris's laptop is awake by 02:00 most nights; if it isn't, the task fires on next wake. If Chris wants the elevated form, he can re-register from an admin PowerShell with `-Principal (New-ScheduledTaskPrincipal -UserId <user> -LogonType S4U)`.

---

## Testing reference discipline — fixtures vs playground (Brief 95 P1, 2026-07-07)

1. **Committed fixtures are the only regression references.** Every baseline/regression check cites a fixture at a commit (e.g. `validation/fixtures/bridgewater_anchor_v2.yaml` via `scripts/_brief93_anchor.mjs --fixture`) — never the live DB, which Chris edits freely (his playground). A number that moved because the live DB changed is not a regression.
2. **UI verification uses the ZZ TEST project, never Chris's real projects.** Seed it with `scripts/seed_test_project.py` (idempotent, from the frozen fixture); it is named "ZZ TEST — do not use". Drive browser checks against ZZ TEST — or an isolated scratch instance (own port + a scratch DB copy) — so a live session is never disturbed.

---

## Brief management

1. **Active brief:** `docs/briefs/current.md` — this is always the brief being worked on right now.
2. **Brief archive:** When a brief is completed, rename it to `docs/briefs/archive/NN_Title_COMPLETED.md` and copy the next brief to `current.md`.
3. **Brief numbering:** `00_project_brief.md` is the master project brief (permanent reference). Task briefs start at `01`.
4. **Brief format:** Every brief follows the standard structure — BEFORE DOING ANYTHING checklist, context paragraph, numbered parts, each part with file paths, commit message, and verification steps.

---

## Status tracking

After completing each part, update STATUS.md with:

* **Last completed:** What was just finished
* **Current state:** What's working, what's not
* **Next task:** What the brief says to do next
* **Known issues:** Anything broken or suspicious
* **Suggestions:** Ideas for improvements (do not implement — just note them)
* **Safety checks:** Worktree list, main branch status, push confirmed

---

## What not to touch (unless the brief explicitly says to)

This list will be updated as we confirm which parts of the codebase are stable:

* The geometry JSON schema (once established)
* The epJSON generator core logic (once verified against EnergyPlus)
* ProjectContext and library data flow infrastructure
* The design system (colours, typography, component styles)
* The sidebar, routing, and navigation shell

---

## Reference documents

* **Project brief:** `docs/briefs/00_project_brief.md` — full scope, architecture, and design decisions
* **Pablo design system:** `docs/pablo_design_system_reference.md` — colour palette, typography, component patterns to inherit
* **EnergyPlus documentation:** https://energyplus.readthedocs.io/en/latest/

---

## When something contradicts these rules

If a task brief asks you to do something that conflicts with this file, **this file wins.** Flag the contradiction to Chris and wait for a decision. These rules exist because we learned the hard way what happens without them.
