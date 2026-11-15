# Brief 103 — Simulate v2 Engine 1: a pure single-zone hourly engine from the model document

Brief 1 of the engine sequence (design note Notion `418d645e-05cc-811e-ad6b-fa8846f12148`, Rev A.5; handover
`418d645e-05cc-818a-bf08-e128cad8e252`). Written 14 Nov 2026 by Linzie's agent thread, at Linzie Brown's request
("Do we need that other guy to write the brief… do as much as you can", 22:50), in place of Chris's architect chat.
Branch `chris/103-engine-1`, off `main` `bbc7893` (Briefs 102 and 102a merged).

**Rev B, 14 Nov 2026, 23:50, after Part 0 and the cooling-gap investigation (Linzie: "YES", 23:47).**

- **The referee changes.** EnergyPlus is now the referee for demand. Today's State 1 is a reference only for the
  per-path arithmetic (conductances and losses at setpoint); its demand is shown for information only.
- **Why.** Tonight's clean EnergyPlus run (`docs/audit/103/ep_confirm_results.md`, Run Bi) put the
  fabric-only demand at **68.7 MWh heating / 34.8 MWh cooling**, against State 1's 129.2 / 98.6. State 1's demand
  method overstates both (`cooling_gap_root_cause.md`).
- **Two additions:** a tidy-up of how the EnergyPlus reference model carries thermal bridging, and a performance
  budget.
- **Not in this brief:** the thermal-bridging bug in today's dynamic engine was fixed separately by **Brief 102b**
  (PR #28, merged 15 Nov). The anchor is now **133.2** (heating 102.7, cooling 92.4), and 103 changes no engine file.
- **Database route:** NZA Sim (dev) moved into the Net Zero Advisory org on 14 Nov, so migrations are applied and
  read back through the Supabase connector, dev only.

## Brief-writing checklist (NZA Development Bible, rendered)

- [x] Read the checklist, CLAUDE.md and STATUS.md.
- [x] The design note exists first (Rev A.5; this brief decides nothing the note does not, except where "Decisions
      this brief takes" says so, each flagged for review).
- [x] Intent captured ("Why this brief", "Design decisions already agreed").
- [x] BEFORE DOING ANYTHING · Goal · Scope (in and out) · Design decisions · Principles · Parts (one commit each, files,
      commit message, done) · Verification · What MUST NOT happen · When to escalate · Independent review · Close.
- [x] The "spec is the prompt" test: someone with only this brief, the design note and the repo can build it.

## Why this brief

Simulate v2 replaces today's single-zone engine (`frontend/src/utils/instantCalc.js`, 7,400 lines, three parallel
envelope implementations under CLAUDE.md Rule 14) with an hourly multi-zone resistance-capacitance model implemented
from ISO 52016-1 (design note, "The decision"). Rule 12 says rebuild, not refactor, when a foundational assumption
changes; single-zone was that assumption. Brief 102 built the floor: the model document (zod), its canonical hash, the
store and the run key. Engine 1 is the first engine: **a pure TypeScript package that takes a model document and an
EPW and returns hourly zone temperatures and heating and cooling demand for one zone, with every term of the balance
as a breakdown line**, proved against hand calculations and against today's engine on the frozen Bridgewater anchor.

Nothing a user sees changes. The engine is a library with tests; the UI and `instantCalc.js` stay untouched until
Engine 4's EnergyPlus referee run passes (design note Rev A.2, "No cut-over before the referee passes").

The brief also carries the smaller QA findings left open by Brief 102a (STATUS.md, "Still open from the QA"), the
most useful being that NZA Sim projects are matched by name.

## Goal

1. `frontend/src/thermal/engine/`: a pure package (no DOM, no I/O, no React, no imports from `frontend/src/utils/`
   except files ported into it with a provenance header). Entry point `runZoneModel(document, weather, library,
   options) → ZoneResults`, the same numbers in Node and in a browser.
2. A TypeScript EPW parser that returns the hourly arrays the engine needs and the file's sha256.
3. Solar on any azimuth and tilt (not four compass labels), from one ported solar module.
4. One zone, ISO 52016-1 hourly: an air node plus a node set per element, envelope only (Building-module scope):
   opaque conduction, glazing conduction, thermal bridging, solar through glazing and on opaque surfaces,
   infiltration from q50, permanent vents, a comfort band, the resulting heating and cooling demand.
5. Every term as a breakdown line (Rule 9), and an energy-balance closure check every hour.
6. Gates:
   - analytic hand cases to rounding;
   - a published reference case;
   - the Bridgewater building's per-path conductances and losses at setpoint against today's State 1, within 1 %;
   - its fabric-only heating and cooling demand against the **EnergyPlus referee**, within the decision 2
     tolerance, or the difference explained and recorded.
7. **Instant:** a full year for one zone in well under 100 ms in a browser worker, with a measured scaling estimate
   to about 50 zones (decision 7).
8. The open QA items that touch the store (project matching by id, library upsert, run summary lines, AuthGate retry,
   invitation revoke), each with a test.

## Scope

**In:** the engine package (single zone); EPW parser; solar on any surface; the envelope physics above; outputs
per hour and annual for the one zone; the breakdown and closure; the analytic, reference and anchor fixtures; the
QA store fixes listed in Part 1; a migration `0005` if Part 1 needs SQL.

**Out** (later briefs; do not start them): multi-zone, partitions, floors, the loft buffer and roof cases (104);
ventilation systems, MVHR/MEV, natural ventilation with control, internal gains from profiles (105); systems, DHW,
delivered energy, fuel, EUI, the EnergyPlus referee (106); any UI (107+); the library moving into Postgres (110);
age-band defaults (111); anything in decodED (113). Also out, by the scope fence (contract bump to change): airflow
networks, plant curves, distribution losses, per-room comfort reporting, automatic calibration.

**Module scope (CLAUDE.md process rule 10).** The engine physics in this brief is the **Building module, State 1
envelope-only** scope exactly: conduction (opaque and glazing), thermal bridging, solar gains, infiltration through
q50, permanent vents, and the demand to hold a user-defined comfort band. No occupancy, lighting, equipment, HVAC,
mechanical ventilation, operable openings, DHW, controls, efficiencies, delivered energy or carbon. Part 1 touches the
Simulate v2 store only (`frontend/src/thermal/store/`, `supabase/migrations/`, `frontend/src/auth/`), no module.

## Design decisions already agreed (design note; do not reopen)

- ISO 52016-1 hourly method; one node set per zone (air plus mass), each element with its own nodes; each term cites
  its clause. EnergyPlus is the referee, never the product engine.
- One TypeScript engine, pure functions, browser worker and Node, identical numbers. No Python engine.
- The engine is geometry-agnostic: it reads the model document (`frontend/src/thermal/schema/model.ts`) and nothing
  else. That contract is the seam (Rule 4 restated).
- Good parts of today's engine are **ported** with a provenance header, not imported: the wall model, opening and
  vent physics, the schedule library, the systems engine's State 3 contract (later briefs).
- Weather is EPW. Solar from the existing solar calc, generalised to any azimuth and tilt.
- Trust gates: analytic cases, published reference cases as fixtures, the EnergyPlus referee (106), the anchor box
  within a stated tolerance or the difference explained term by term (Rule 10: no appeal to "engine differences").
- Run key `(model_hash, engine_version, library_hash, weather_hash)`; the new engine records runs under its own
  engine version (`thermal-1+<sha>`), never `instant-1`.

## Decisions this brief takes (flagged for Chris's review; the design note is updated to match at close)

1. **Where the gates sit (Rev B).** The anchor's EUI (133.2 since 102b), so its gate moves to 106. Engine 1 is gated on the
   Bridgewater envelope in two ways.
   - **(a) Per-path arithmetic against today's State 1.** Each conductance, in W/K, must agree within **1 %**:
     each opaque element, glazing, leakage, permanent vents and bridging. So must each annual loss at the setpoint
     convention, in kWh, and the annual transmitted solar.
     - This is algebra on the same inputs, so a gap is a bug in one of them.
     - Part 0 §2 holds the State 1 figures.
   - **(b) Demand against the EnergyPlus referee:** fabric-only heating and cooling at the flat 21/24 °C band.
     - Model: EnergyPlus 25.2.0 with IdealLoads, Run Bi's set-up, on `validation/fixtures/report_baseline_v1.yaml`.
       Its envelope is the anchor's, byte for byte.
     - Settings: no people, lights or equipment; no mechanical ventilation; infiltration, permanent vents and
       bridging kept.
     - Weather: the anchor EPW (sha256 `c6571102…cf2`).
     - The bridging is re-allocated per decision 6 (Part 5). Until Part 5 re-runs it, the reference is Run Bi:
       **68.7 MWh heating / 34.8 MWh cooling**.
     - **Part 5 result (15 Nov):** **90.46 MWh heating / 13.65 MWh cooling**, zone sensible, with the document's
       frame, ground, absorptance and EPW wind as well as per-element bridging (`docs/audit/103/05_referee.md`).
       This is the gate (b) reference.
   - Today's State 1 demand (129.2 / 98.6) is printed alongside **for information only**. It is not a gate, and
     nothing is tuned toward it.
2. **Tolerance for gate (b):** annual heating and cooling within **±10 %** of the EnergyPlus referee.
   - Beyond that is a finding: instrument it, name the term and its magnitude, and record it in the audit.
   - Never tune either engine to close it (Rule 10).
   - **Known structural difference, reported and not tuned:** the referee has five stacked floor zones and Engine 1
     one zone.
   - For context, ASHRAE 140's spread between programs on its own cases is of this order. Hourly differences against
     EnergyPlus are reported, not gated.
3. **Engine location:** `frontend/src/thermal/engine/`, beside the schema and the store. A separate package folder or
   repo can come later; the provenance header pattern makes that reversible.
4. **Reference case:** ISO 52016-1's own validation cases are in the paid standard (and ISO/TR 52016-2). If Part 0
   finds no lawful copy in the repo or NZA's files, Engine 1 uses the analytic cases plus **ASHRAE Standard 140 /
   BESTEST Case 600 and 900** inputs as published in open literature, compared against the published range of
   programs, and says so. Buying the standard is a decision for Chris (escalation).
5. **Fixture building id:** engine fixtures use a fixed `building.id` (QA L7); the hash includes it by design.
6. **EnergyPlus reference model: bridging on its own element (Rev B).**
   - **Today.** The assembler (`_apply_thermal_bridging`, `epjson_assembler.py` ~L854) spreads the whole H_TB as one
     uniform ΔU over walls, roof *and ground floor*. Ground-floor bridging is then driven by the ground temperature,
     not the outdoor temperature, and the junction losses sit on the wrong elements.
   - **The referee instead allocates each ISO 14683 junction to its own element:**
     - wall-to-roof goes on the roof;
     - wall-to-ground-floor (the floor edge), wall-to-intermediate-floor, external corners and window perimeters go
       on the external walls;
     - nothing goes on the ground floor.
   - **This is a referee-only script under `validation/energyplus/`.** It builds with bridging off, then degrades
     each element's NoMass layer by its own ΔU. `nza_engine/` is untouched, so the product's EnergyPlus path does
     not change.
7. **Performance budget (Rev B, Linzie: instant results now and multi-zone later).**
   - **Budget:** `runZoneModel` on the Bridgewater zone for a full year in **under 100 ms** in a browser Web Worker
     (median of 5 after one warm-up) and in Node.
   - **Design rule:** coefficient matrices are assembled and factorised **once per run** wherever they do not change
     hour to hour; only the right-hand side is rebuilt each hour.
   - **Scaling:** Part 4 measures 1, 10 and 50 copies of the zone and records the time and how it grows, so 104 has
     a budget for about 50 zones. Target: 50 zones in under 2 s in a worker.
   - Missing the 100 ms budget is an escalation, not a waiver.

## Principles

- Rule 1 / 7: the engine computes; nothing in JSX computes physics. Rule 2: no synthetic data, no `Math.random`.
- Rule 9: every term in the balance is a breakdown line; an hourly closure check (gains − losses − demand − storage
  change ≈ 0) fails loudly beyond a stated residual.
- Rule 11: one canonical exposure per quantity in `ZoneResults`; one read helper.
- Rule 10: specifics with citation and magnitude, or silence.
- Inputs fail loudly: a field the engine needs and the document lacks is an error naming the path, never a default
  inside the engine. Defaults live in the document (QA trap 4 from the 102 QA).
- Clause citations: every function that implements a term names its ISO 52016-1 clause (or the open source used).
- One Part = one commit, pushed after each; stop for Linzie's word between Parts unless she says plough through.

## BEFORE DOING ANYTHING

- [ ] Read this brief, CLAUDE.md, STATUS.md (top: 102 and 102a), the design note (all revs) and the handover page.
- [ ] Read `frontend/src/thermal/schema/` (model, results, hash, fromBuildingConfig) and `docs/audit/102a/qa_report.md`
      ("How the old engine makes 132.6").
- [ ] `git status` clean; `git fetch`; the branch is current with `main`.
- [ ] `npm test` (frontend) passes; `node scripts/_brief93_anchor.mjs --fixture` prints 133.2 (since 102b).
- [ ] Read `docs/audit/103/00_reconnaissance.md` and `docs/audit/103/{cooling_gap_root_cause.md,
      ep_confirm_results.md}`.
- [ ] The brief is on disk in `docs/briefs/active/` and `current.md` points at it (this commit).

## Parts

### Part 0 — Reconnaissance (read-only, no code) — DONE `3b84614`

File: `docs/audit/103/00_reconnaissance.md`. Commit: `103 P0: reconnaissance`.

1. **State 1 term inventory.** Read `_calculateEnvelopeOnly` (instantCalc.js ~846–2545) and list every term it
   integrates, with line numbers, units and the inputs it reads; mark which model-document path carries each input.
2. **The anchor's State 1 numbers.** Run today's engine on `validation/fixtures/bridgewater_anchor_v2.yaml` exactly
   as `_brief93_anchor.mjs --fixture` does and record the State 1 annual heating and cooling demand and each envelope
   term (MWh), so Part 6 has a fixed target. Read-only: engine files imported, never changed.
3. **Ports.** For `solarCalc.js`, `wallModel.js`, `thermalBridges.js`, `thermalMass.js`, `openingCoefficients.js` and
   the permanent-vent flow code: what each does, what it depends on, whether it is portable as-is into a pure package,
   and what ISO 52016-1 replaces (e.g. the 2-node wall model by element nodes).
4. **Reference cases.** What is available lawfully (repo, NZA files, open literature) for ISO 52016-1 and for BESTEST
   600/900; which inputs the model document can already express and which it cannot.
5. **Model document gaps.** Fields Engine 1 needs that `model.ts` lacks (e.g. layer-level construction data for
   element nodes, surface solar absorptance, emissivity, ground model inputs), each with a proposed path; a schema
   change needs a `schema_version` bump and a converter update (Part 2).
6. **QA leftovers.** For M4, M6, M7, L2, L3, L6: the exact change, its files, and any trap (e.g. L2: the RLS policies
   call `org_of_*` as the querying role, so revoking EXECUTE breaks reads; the fix must keep them callable).
7. **Database route.** Whether this machine can apply a migration itself (Supabase CLI installed and signed in to
   Chris's account, `supabase link` to `jbjxduathkklruvbmeho`), or whether a pasteable note for Chris's agent stays
   the route. Never a service-role key. Propose; do not act.
8. A short list of anything in this brief that Part 0 shows is wrong.

**Stop after Part 0.** Report the findings and wait for the word.

### Part 1 — Store fixes from the QA (no engine)

Files: `frontend/src/thermal/store/versions.ts`, `SaveModelVersionButton.jsx`, `frontend/src/auth/AuthGate.tsx`,
`supabase/migrations/0005_store_fixes.sql` (if SQL is needed), tests, `scripts/102a_pgtest/test_p6.mjs`.
Commit: `103 P1: store fixes from the 102 QA (projects by id, library upsert, run summary lines, sign-in retry)`.

- **M4:** a model's building is found by the local project's id, not its name: `buildings.local_ref` (text, nullable,
  unique per project) set from the local project id; `ensureBuilding` matches on it; renaming a project keeps its
  history; two projects with the same name stay apart; the unique index stops a duplicate on concurrent first saves.
- **M6:** `upsert_library_item` refuses (23505, a message naming kind, key and version) when the version exists with a
  different body; the same body stays a no-op.
- **M7:** the run summary names auxiliary as its own end-use line from the engine's own figure
  (`heat_balance.annual.gains.internal.auxiliary.electricity_kwh`), keeps a residual line only for what is still
  unlisted, and fails loudly on a missing or non-finite figure instead of writing 0; district heat lands in heating.
- **L3:** AuthGate's error screen offers Retry and Sign out.
- **L6:** `revoke_invitation(p_invitation)` for admins.
- **L2:** move `org_of_*`, `admin_count` and `role_in` to a `private` schema that PostgREST does not expose.
  - Keep EXECUTE for `authenticated`.
  - Recreate the three RLS policies that call them (`0002:295-301`).
  - Do this only if the local rig proves that reads still work; otherwise record it as an accepted risk.

Done when: the local-Postgres rig passes the new cases and all earlier ones; 0005 is applied to NZA Sim (dev) by the
Supabase connector (`apply_migration` on `jbjxduathkklruvbmeho` only) and read back; `npm test` and the build pass; env unset unchanged (ZZ TEST Systems 133.2, no
button). The ZZ TEST and anchor rows already stored keep working (their `local_ref` is null; first save after 0005 sets it).

### Part 2 — Package skeleton, EPW parser, solar on any surface

Files: `frontend/src/thermal/engine/{index.ts,epw.ts,solar.ts,types.ts}`, `__tests__/`, schema bump if Part 0 needs it.
Commit: `103 P2: engine package, EPW parser and solar on any azimuth and tilt`.

- `parseEpw(bytes) → { header, hours: {…8,760 or 8,784…}, sha256 }`: dry bulb, dew point, RH, pressure, direct
  normal, diffuse horizontal, global horizontal, wind speed and direction, sky cover; latitude, longitude, time zone,
  elevation from the header. Refuses a short or malformed file with the line number.
- `solarOnSurface(weather, azimuth_deg, tilt_deg, albedo)`: hourly incident direct, diffuse and reflected W/m², ported
  from `solarCalc.js` with a provenance header and generalised.
- Gate: on the anchor EPW, `parseEpw` equals the backend parser's arrays (`/api/weather/…/hourly`) value for value and
  its sha256 equals `c6571102…cf2`; `solarOnSurface` on the four anchor facade azimuths (orientation 42°) equals
  `computeHourlySolarByFacade` hour by hour within 1e-6 W/m²; a horizontal surface returns global horizontal.

### Part 3 — One zone, steady state and analytic cases

Files: `frontend/src/thermal/engine/{zone.ts,elements.ts,balance.ts}`, tests.
Commit: `103 P3: single-zone ISO 52016-1 balance, analytic cases to rounding`.

- The ISO 52016-1 hourly zone balance for one zone: air node, element nodes per opaque element and glazing,
  convective and radiative splits, the hourly solve (cite clauses). Envelope inputs only.
- Analytic cases, each a fixture with its hand calculation in the test: (a) steady state, constant outdoor and indoor
  temperature, no sun: heat flow = Σ U·A·ΔT + Σ ψ·L·ΔT + ρ·c·V̇·ΔT to rounding; (b) a single wall's U-value from its
  layers equals the ISO 6946 hand value; (c) a step change: the air node's free-floating response tends to the
  analytic steady state; (d) zero envelope (adiabatic, no sun): demand 0 and temperature constant.
- Hourly closure: `|Σ terms − demand − Δstorage|` ≤ 1 Wh per hour on every analytic case.

### Part 4 — Infiltration, permanent vents, solar gains, comfort band, results shape

Files: `frontend/src/thermal/engine/{air.ts,solarGains.ts,control.ts,results.ts}`, ported vent physics with
provenance, tests. Commit: `103 P4: infiltration, permanent vents, solar gains, comfort-band demand; results and breakdown`.

- Infiltration from q50 and exposure; permanent vents per opening with its own cd and flow mode (Brief 42), wind and,
  where vertical separation exists, stack (port, do not re-derive); solar through glazing (g, frame, shading) and on
  opaque surfaces (absorptance); demand to hold the comfort band (lower and upper), ideal and unlimited, as State 1.
- `ZoneResults`: hourly air temperature, operative temperature, heating and cooling demand; annual totals; the
  breakdown lines (one per term, per element where useful); the closure residual. Shapes in `results.ts` (102), one
  canonical exposure per quantity and a `readZone*` helper per quantity (Rule 11).
- Gates:
  - the reference case (decision 4) within its published range for annual heating and cooling;
  - closure ≤ 1 Wh per hour on the reference case;
  - the performance budget (decision 7): the one-zone year printed in Node; 1, 10 and 50 zone copies timed and
    recorded in `docs/audit/103/04_performance.md`.

### Part 5 — The EnergyPlus referee, with bridging on its own element

Files:
- `validation/energyplus/103_referee.py`, a referee-only driver based on tonight's scratch driver
  (`C:\Users\ChrisScott\Dev\_epcheck_scratch\epcheck_driver.py`, Run Bi);
- `validation/energyplus/results/103_referee_fabric_only.json`;
- `docs/audit/103/05_referee.md`.

Commit: `103 P5: EnergyPlus fabric-only referee for Bridgewater, bridging allocated per element`.

- **Build.** Use `report_baseline_v1` and `mode="full"`, with the systems config's mode set to `ideal_loads`.
  - Gains, occupancy and mechanical ventilation off, as Run Bi.
  - Lights and ElectricEquipment objects deleted from the generated epJSON.
  - Bridging set to absent in the copy passed to the assembler, then re-applied per element (decision 6).
- **Checks, printed:** IdealLoads present and no VRF; setpoints a flat 21/24; people, lights and equipment 0; only
  the permanent-vent louvres in ZoneVentilation; H_TB applied equal to `_nza_thermal_bridging_H_TB` within 0.1 W/K;
  0 severe and 0 fatal errors.
- **Runs** on IT15, EnergyPlus 25.2.0 (`C:\EnergyPlusV25-2-0`), in the `nza-sim-epcheck` worktree's own `data\`.
  The committed JSON records:
  - the EnergyPlus version, the EPW sha and the fixture sha;
  - annual heating and cooling;
  - monthly heating and cooling;
  - the per-element H used.
- **Report Run Bi (uniform) against Part 5 (per element) side by side.** The difference is the allocation's effect;
  explain it by element.

### Part 6 — The Bridgewater envelope: arithmetic against State 1, demand against EnergyPlus

Files: `scripts/103_anchor_envelope.mjs`, `docs/audit/103/06_anchor_envelope.md`.
Commit: `103 P6: Bridgewater envelope, per-path arithmetic against State 1 and demand against the EnergyPlus referee`.

- Convert the fixture with `fromBuildingConfig` (fixed building id) and run `runZoneModel` on the anchor EPW.
- **Table 1, gate (a):** path · conductance (W/K) and annual loss at setpoint, State 1 against Engine 1 · Δ% · within
  1 %.
- **Table 2, gate (b):** annual and monthly heating and cooling, EnergyPlus referee (Part 5) against Engine 1 · Δ% ·
  within ±10 %. State 1 demand and today's dynamic engine are shown in information columns.
- **Every miss gets a diagnosis by instrumentation,** recorded in the audit with its magnitude: hourly traces, or a
  perturbation that isolates the term. Not tuned away.

### Part 7 — Close

Files: STATUS.md, `docs/briefs/current.md`, `git mv` this brief to
`docs/briefs/archive/103_engine-1_COMPLETED.md`, `docs/audit/103/`, the design note (Notion) updated for decisions 1–7.
PR `103 — Simulate v2 Engine 1` into `main`. Commit: `103 P7: close`.

## Verification (falsifiable)

1. `npm test` in `frontend/`: every engine test passes; the analytic cases to rounding; closure ≤ 1 Wh/h.
2. `parseEpw` equals the backend parser on the anchor EPW, value for value; sha256 `c6571102…cf2`.
3. `solarOnSurface` equals `computeHourlySolarByFacade` on the anchor's four facades within 1e-6 W/m².
4. The reference case's annual heating and cooling within its published range, or the gap reported with magnitude.
5. Per-path conductances and losses at setpoint within 1 % of State 1 (Part 6, table 1).
6. Fabric-only heating and cooling within ±10 % of the EnergyPlus referee (Part 6, table 2), or each miss diagnosed
   and recorded. The referee JSON is committed with the EnergyPlus version, EPW sha and fixture sha.
7. Performance: the one-zone year in under 100 ms in a browser Web Worker and in Node (median of 5, printed). The
   browser totals equal the Node totals to the last digit (Playwright). The 1, 10 and 50 zone timings are recorded.
8. `git diff main...HEAD --stat` touches no engine file (`instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`,
   `solarCalc.js`, `wallModel.js`, `nza_engine/`); ported code is copied with a provenance header.
9. Env unset: ZZ TEST Systems shows 133.2 and no Save button; `_brief93_anchor.mjs --fixture` 133.2.
10. Part 1: the local-Postgres rig passes old and new cases; 0005 applied to NZA Sim (dev) and read back.

## What MUST NOT happen

- No edit to `instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `solarCalc.js`, `wallModel.js`,
  `thermalBridges.js`, `thermalMass.js`, `openingCoefficients.js`, `nza_engine/` or any UI module. Ports are copies.
- No number tuned to match another engine. No default hidden inside the engine.
- No engine change to `instantCalc.js` here: the bridging fix was 102b; 133.2 stays 133.2.
- No change to `nza_engine/` for the referee. The per-element bridging lives in `validation/energyplus/` only.
- No migration applied to anything other than NZA Sim (dev) `jbjxduathkklruvbmeho`.
- No engine import of `frontend/src/utils/` at run time; no DOM, `window`, `fetch` or file access in the engine.
- No UI change beyond Part 1's AuthGate buttons. No cut-over.
- Nothing touches NZA Decoded or NZA Decoded Test. No service-role key anywhere. No lockfile or `node_modules` commit.
- No `git rebase`, `reset --hard`, `clean` or force push.

## When to escalate (stop and report)

- Part 0 shows the model document cannot express an input State 1 reads, and the fix is more than a field.
- No lawful reference case exists (decision 4) and BESTEST inputs cannot be sourced openly.
- The fabric-only gap against the EnergyPlus referee exceeds ±10 % on heating or cooling, and instrumentation does
  not explain it after three approaches (process rule 4).
- A per-path conductance misses 1 % and the cause is in State 1, not Engine 1. Report it; do not fix State 1.
- The one-zone year exceeds 100 ms in a worker after the factorise-once design.
- Anything that would widen the scope fence, or any number a client could see changing.
- A migration step that would need anything other than the agreed route.

## Independent review

Mandatory (engine, physics, hashes). Before close, a fresh reviewer (Claude Chat or a separate thread) reads
`frontend/src/thermal/engine/` against this brief's intent and ISO 52016-1's structure, and the Part 5 referee and Part 6 tables. The
thread that built it does not grade it.

## Final report

What landed per Part with commits; the anchor envelope table; the reference-case result; divergences from this brief
and the design note; Lessons proposals; what 104 needs from this engine.
