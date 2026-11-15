# Brief 105 Part 0: reconnaissance (read-only)

## Method and scope

- `main` is at `9fda85d`, with Briefs 103 and 104 merged.
- The editor prototype is `sim2/geometry-prototype` at `fb64561`. It was merged with `main` in a scratch worktree only, and nothing was pushed.
- No engine or editor file was changed.

## 1. What the editor writes, and what the engine does with it

**Test building:** a 12 × 8 m one-storey box with three windows on the south wall, cut into two zones, written by `buildDocument` (`frontend/src/sim2/geometry/toDocument.ts`). The surfaces it writes:

- outside walls, one per room piece, with true azimuths;
- glazing per wall;
- one partition (24 m²) between the two zones;
- a roof and a ground floor per zone.

All construction keys are `unassigned:*`.

**Step 1: it does not validate against schema 2.2.** The writer predates Brief 104. Every surface is missing three fields:

- `inside_solar_absorptance`;
- `inside_solar_absorptance_b`, which a partition needs because it has two inside faces;
- `faces_up`.

**Step 2: inputs the editor does not collect yet.** These are written as `null`, correctly by CLAUDE.md rules 2 and 3:

| Field | Value written |
|---|---|
| `building.site.lat` / `lon` / `exposure` | null |
| `building.thermal_bridging.mode` / `multiplier` | null |
| `zones[].setpoints.heat_c` / `cool_c` / `control_strategy` | null |
| `zones[].infiltration_q50` | null |
| every `construction_ref.key` | `unassigned:*` |
| `weather` | not written |
| `profile_refs` | empty |

**Step 3: with those filled for the test only, Engine 2 runs the document unchanged.** The values used were:

- Bridgewater's library constructions, with `interior_floor_ceiling` for the partition;
- 21 / 24 °C setpoints;
- q50 of 5;
- the Bridgewater site;
- bridging multiplier 1;
- the anchor EPW.

Result: `thermal-2`, z1 3.04 MWh heating, z2 2.80 MWh heating, 0 cooling. That is about 31 kWh/m² for an unheated-gains box with U 0.14 walls, a plausible order. There are no gains, so there is no cooling.

**Conclusions:**

- **No geometry work is needed for the engine to run an editor document.** The 2.2 fields are a small change in the editor's writer, and that file is the editor thread's to change.
- **The seam must turn a schema failure into a named "missing" list.** Zod's raw issues are not something to show a person.

## 2. The library: constructions have no `layers` in the export

The library is in the Brief 102 export (`docs/audit/102/library_export.json`) and in NZA Sim (dev)'s `library_items`. Both hold:

- 15 constructions;
- 18 system templates;
- 15 profiles;
- 1 weather item.

**The construction bodies have no `layers` list.** Each carries its layers as an EnergyPlus fragment (`body.epjson`):

- `Material` and `Material:NoMass` entries;
- a `Construction` with `outside_layer`, `layer_2`, and so on;
- for glazing, `WindowMaterial:SimpleGlazingSystem`.

The engine reads `layers: [{ kind, thickness, conductivity, density, specific_heat } | { kind: 'Material:NoMass', thermal_resistance }]`. That is the shape in the Bridgewater fixture's `config_json`, which came from the sqlite database.

**So the seam needs one pure conversion,** from the epJSON fragment to `layers` and, for glazing, U and g. Part 4 checks it against the fixture's layers for the four Bridgewater constructions, value for value.

**The editor's `snapshot.json` keeps only U and g.** The seam reads the bodies, not the snapshot.

**Profiles are shapes only:** 24 hourly fractions per day type (weekday, Saturday, Sunday) plus 12 monthly multipliers. The 15 profiles are:

| Type | Count |
|---|---|
| Occupancy | 4 |
| Lighting | 3 |
| Equipment | 1 |
| Ventilation | 3 |
| Setpoint | 2 |
| DHW | 1 |

There are no densities anywhere: no people per m², no W/m². That confirms decision 1 (schema 2.3 densities on the zone).

## 3. Weather

**The only EPW in the library is the anchor file,** `GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw` (1.59 MB, sha c6571102…cf2). It comes from Climate.OneBuilding.

**Licence check of climate.onebuilding.org (15 Nov 2026):** home, about and sources pages.

- **No open licence is stated.** Each page says "Copyright © 2014-2026 Climate.OneBuilding. All Rights Reserved." Each carries a disclaimer and a citation request (Lawrie and Crawley, TMYx).
- **Redistribution is not stated to be permitted.**

**So decision 4's fallback, a committed UK EPW, is not taken.** The brief's escalation condition applies: the licence does not clearly allow the file in the repo.

Instead, weather comes only from NZA Sim's own store:

- **NZA Sim (dev) has no Storage bucket today** (`storage.buckets` is empty).
- **Part 4 adds one.** The bucket is private and readable by members of the organisation that uploaded the file. The file is uploaded by a signed-in user, as today's tool uses it locally. This is not redistribution to the public.
- **Signed out, or with no weather chosen,** the panel shows "No weather file" and no number.
- **Tests keep using the committed Denver BESTEST weather** (ASHRAE 140 inputs) and the local anchor EPW when present.

## 4. Today's gains and ventilation conventions (for schema 2.3's units)

**Schema 2.x already has ventilation entries per zone:**

- `kind`, one of `mvhr`, `mev`, `natural` or `none`;
- `flow_rate` with `flow_rate_basis`;
- `sfp_w_per_l_s`, `recovery_sensible_pct` and `control_schedule_ref`.

`fromBuildingConfig` writes Bridgewater's three entries:

| Entry | Flow | Heat recovery |
|---|---|---|
| MVHR | 1425 l/s | 80 % |
| Bedroom extract | 2208 l/s | none |
| WC extract | 210 l/s | none |

**Engine 1 and Engine 2 ignore these entries today** (envelope only: infiltration and permanent vents). Part 3 makes them count.

**Gains in today's tool live in the Operation scope.** The densities are:

- people per m² (or per room);
- W/m² for lighting and equipment.

Each density is multiplied by a profile fraction, and occupancy also by a sensible heat per person. Schema 2.3 states the same quantities in the same units, so a converted Bridgewater document and an editor document mean the same thing.

## Changes this makes to the brief

- **Decision 4.** No committed EPW (licence not stated). Weather comes from NZA Sim's own private Storage, or the panel shows "No weather file".
- **Part 4.** Adds the epJSON-to-layers conversion, checked against the fixture, and a private `weather` bucket on NZA Sim (dev) only.
- **Asks to the editor thread, sent, not made:**
  - write the schema 2.2 surface fields;
  - write the 2.3 zone gains when it exists;
  - turn site, bridging, setpoints and q50 into editor inputs, or panel prompts, in its own time.
