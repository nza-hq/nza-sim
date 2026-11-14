# Brief 103 — Simulate v2 Engine 1: a pure single-zone hourly engine from the model document

Brief 1 of the engine sequence (design note Notion `418d645e-05cc-811e-ad6b-fa8846f12148`, Rev A.5; handover
`418d645e-05cc-818a-bf08-e128cad8e252`). Written 14 Nov 2026 by Linzie's agent thread, at Linzie Brown's request
("Do we need that other guy to write the brief… do as much as you can", 22:50), in place of Chris's architect chat.
Branch `chris/103-engine-1`, off `main` `bbc7893` (Briefs 102 and 102a merged).

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
6. Gates: analytic hand cases to rounding; a published reference case; the Bridgewater anchor's **envelope** demand
   against today's State 1 within a stated tolerance, term by term, or the difference explained and recorded.
7. The open QA items that touch the store (project matching by id, library upsert, run summary lines, AuthGate retry,
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

1. **Where the anchor gate sits.** The design note gives Engine 1 "the box reproduces the anchor". The anchor's 132.6
   is an EUI: it includes systems, DHW, fans, lighting and small power, which arrive in 105 and 106. Engine 1 therefore
   gates on the anchor's **State 1 envelope demand** (annual heating and cooling demand at the comfort band, and each
   envelope term), against today's `_calculateEnvelopeOnly` on the same fixture. The 132.6 EUI gate moves to 106.
2. **Tolerance for the anchor envelope gate:** annual heating demand and annual cooling demand within **±5 %** of
   today's State 1; each annual conduction, bridging, infiltration, vent and solar term within ±5 % or 0.5 MWh,
   whichever is larger. Beyond that is a finding: instrument, name the term and its magnitude, record it in the audit;
   never tune either engine to close it (Rule 10). The two engines are different physics on purpose (ISO 52016-1
   element nodes against a 2-node wall model), so agreement is evidence, not the definition of right; the analytic and
   reference cases are the definition of right.
3. **Engine location:** `frontend/src/thermal/engine/`, beside the schema and the store. A separate package folder or
   repo can come later; the provenance header pattern makes that reversible.
4. **Reference case:** ISO 52016-1's own validation cases are in the paid standard (and ISO/TR 52016-2). If Part 0
   finds no lawful copy in the repo or NZA's files, Engine 1 uses the analytic cases plus **ASHRAE Standard 140 /
   BESTEST Case 600 and 900** inputs as published in open literature, compared against the published range of
   programs, and says so. Buying the standard is a decision for Chris (escalation).
5. **Fixture building id:** engine fixtures use a fixed `building.id` (QA L7); the hash includes it by design.

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
- [ ] `npm test` (frontend) passes; `node scripts/_brief93_anchor.mjs --fixture` prints 132.6.
- [ ] The brief is on disk in `docs/briefs/active/` and `current.md` points at it (this commit).

## Parts

### Part 0 — Reconnaissance (read-only, no code)

File: `docs/audit/103/00_reconnaissance.md`. Commit: `103 P0: reconnaissance`.

1. **State 1 term inventory.** Read `_calculateEnvelopeOnly` (instantCalc.js ~846–2545) and list every term it
   integrates, with line numbers, units and the inputs it reads; mark which model-document path carries each input.
2. **The anchor's State 1 numbers.** Run today's engine on `validation/fixtures/bridgewater_anchor_v2.yaml` exactly
   as `_brief93_anchor.mjs --fixture` does and record the State 1 annual heating and cooling demand and each envelope
   term (MWh), so Part 5 has a fixed target. Read-only: engine files imported, never changed.
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
- **L2** only if Part 0 finds a safe form; otherwise recorded as accepted risk.

Done when: the local-Postgres rig passes the new cases and all earlier ones; 0005 is applied to NZA Sim (dev) by the
route Part 0 agreed and read back; `npm test` and the build pass; env unset unchanged (ZZ TEST Systems 132.6, no
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
- Gates: the reference case (decision 4) within its published range for annual heating and cooling; closure ≤ 1 Wh per
  hour on the reference case.

### Part 5 — The anchor's envelope, term by term

Files: `scripts/103_anchor_envelope.mjs`, `docs/audit/103/05_anchor_envelope.md`.
Commit: `103 P5: the Bridgewater anchor's envelope demand against today's State 1, term by term`.

- Convert the anchor fixture with `fromBuildingConfig` (fixed building id), run `runZoneModel` on the anchor EPW, and
  print a table: term · today's State 1 (Part 0) · Engine 1 · Δ · Δ% · within tolerance (decision 2).
- Every term outside tolerance gets a diagnosis by instrumentation (hourly traces, a perturbation that isolates it)
  with its magnitude, recorded in the audit. Not tuned away.

### Part 6 — Close

Files: STATUS.md, `docs/briefs/current.md`, `git mv` this brief to
`docs/briefs/archive/103_engine-1_COMPLETED.md`, `docs/audit/103/`, the design note (Notion) updated for decisions 1–5.
PR `103 — Simulate v2 Engine 1` into `main`. Commit: `103 P6: close`.

## Verification (falsifiable)

1. `npm test` in `frontend/`: every engine test passes; the analytic cases to rounding; closure ≤ 1 Wh/h.
2. `parseEpw` equals the backend parser on the anchor EPW, value for value; sha256 `c6571102…cf2`.
3. `solarOnSurface` equals `computeHourlySolarByFacade` on the anchor's four facades within 1e-6 W/m².
4. The reference case's annual heating and cooling within its published range, or the gap reported with magnitude.
5. The anchor envelope table: heating and cooling demand within ±5 % of today's State 1, or each excess diagnosed and
   recorded.
6. The engine runs the anchor year in Node in under 1 s (printed), and the same numbers in a browser (a Playwright
   check that imports the package in a page and compares totals to the Node run to the last digit).
7. `git diff main...HEAD --stat` touches no engine file (`instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`,
   `solarCalc.js`, `wallModel.js`, `nza_engine/`); ported code is copied with a provenance header.
8. Env unset: ZZ TEST Systems shows 132.6 and no Save button; `_brief93_anchor.mjs --fixture` 132.6.
9. Part 1: the local-Postgres rig passes old and new cases; 0005 applied to NZA Sim (dev) and read back.

## What MUST NOT happen

- No edit to `instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `solarCalc.js`, `wallModel.js`,
  `thermalBridges.js`, `thermalMass.js`, `openingCoefficients.js`, `nza_engine/` or any UI module. Ports are copies.
- No number tuned to match another engine. No default hidden inside the engine.
- No engine import of `frontend/src/utils/` at run time; no DOM, `window`, `fetch` or file access in the engine.
- No UI change beyond Part 1's AuthGate buttons. No cut-over.
- Nothing touches NZA Decoded or NZA Decoded Test. No service-role key anywhere. No lockfile or `node_modules` commit.
- No `git rebase`, `reset --hard`, `clean` or force push.

## When to escalate (stop and report)

- Part 0 shows the model document cannot express an input State 1 reads, and the fix is more than a field.
- No lawful reference case exists (decision 4) and BESTEST inputs cannot be sourced openly.
- The anchor envelope gap exceeds the tolerance on heating or cooling and instrumentation does not explain it after
  three approaches (process rule 4).
- Anything that would widen the scope fence, or any number a client could see changing.
- A migration step that would need anything other than the agreed route.

## Independent review

Mandatory (engine, physics, hashes). Before close, a fresh reviewer (Claude Chat or a separate thread) reads
`frontend/src/thermal/engine/` against this brief's intent and ISO 52016-1's structure, and the Part 5 table. The
thread that built it does not grade it.

## Final report

What landed per Part with commits; the anchor envelope table; the reference-case result; divergences from this brief
and the design note; Lessons proposals; what 104 needs from this engine.
