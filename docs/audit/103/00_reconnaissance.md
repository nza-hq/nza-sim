# Brief 103 Part 0: reconnaissance

Branch `chris/103-engine-1`, written 14 Nov 2026. Read-only: I changed no engine file and touched no database.

## 1. State 1 term inventory (`frontend/src/utils/instantCalc.js`)

`_calculateEnvelopeOnly` runs from line 846 to line 2057. `_calculateState2` starts at line 2545.

| Term | Where | Formula and inputs | Model-document path |
|---|---|---|---|
| Opaque conduction: wall and roof | 1219–1220, the 2-node `stepWallLinearized` | `wholeWallU·A·max(0, T_set − T_sa)`. Sol-air uses α 0.6 for walls and 0.7 for roofs, and h_out 25 (941–947). | `surfaces[].construction_ref`, `area`. α and h_out are hard-coded. |
| Ground conduction | 979, 994–995, 1297 | `U_floor·A·max(0, T_set − T_ground)`. T_ground is the annual mean of T_out, a constant. | `surfaces[kind=ground]`. No ground-model inputs. |
| Glazing conduction | 1321–1327 | `UA_glaz·ΔT`. The frame fraction is 0.20 (927). | `surfaces[].wwr`, `construction_ref` of the window. Frame fraction is hard-coded. |
| Fabric leakage | 1002 | `UA = ρc·ach·V`, from q50 | `zones[].infiltration_q50` / `infiltration_ach` |
| Permanent vents | 1013–1026, 1228–1252 | Cross flow: `cd·A·√Cw·v`. Single-sided: `0.025·min(1, cd/0.6)·A·v`. Cw is 0.05, 0.10 or 0.20 by exposure. | `surfaces[].openings` (each opening's cd and flow_mode); site exposure is building-wide |
| Thermal bridging | 1137–1159 (`computeThermalBridges`) | ψ·L plus χ, driven by T_out with no sol-air | building `thermal_bridging` |
| Solar through glazing | 1163–1167, 1275 | Isotropic sky (`solarCalc.js`), split into beneficial, cooling and shoulder parts per hour | `g_value`, `shading`, azimuth |
| Glazing inside absorption | 904 | 0.07 of transmitted solar (a tuning knob) | none (hidden) |
| Internal mass | 887 | 250 kJ/K·m² (a tuning knob) | none (hidden) |
| **Demand** | 1573–1667 | **Quasi-steady setpoint convention.** Each hour, heat loss at setpoint minus beneficial solar, gated by regime on the weather-driven H/C (1629). The RC air-temperature trace runs free and only reports temperatures and comfort hours. It does not drive demand. | comfort band |

## 2. The anchor's State 1 numbers (fixed target, `bridgewater_anchor_v2.yaml`, comfort band 21/24 °C)

- **Heating demand:** 129.2 MWh. **Cooling demand:** 98.6 MWh.
- **Free-running temperature:** mean 21.9 °C, minimum 8.6 °C, maximum 38.4 °C.
- **Hours:** underheating 4,205, overheating 3,837, comfort 718.

| Loss at setpoint (kWh) | Heating | Cooling |
|---|---|---|
| External wall (1,701 m²) | 17,855.4 | 836.5 |
| Roof (843 m²) | 8,949.9 | 1,340.8 |
| Ground | 9,354.3 | 0 |
| Glazing (640 m²) | 77,291.4 | 307.4 |
| Fabric leakage | 26,614.7 | 105.8 |
| Permanent vents | 16,246.0 | 65.1 |
| Thermal bridging | 24,006.2 | 95.5 |

- **Solar transmitted:** 147,785.4 kWh in total. 50,774.0 kWh is beneficial and 97,011.4 kWh goes to cooling.
- **Run time:** 75 ms in Node.

## 3. Ports

| File | What it does | Portable as-is? | What ISO 52016-1 replaces |
|---|---|---|---|
| `solarCalc.js` (199 lines) | Isotropic-sky solar on four facades plus the roof, at a fixed orientation | It is pure, so the geometry is portable. Generalise it to any azimuth and tilt (P2). | Keep isotropic sky as the P2 equality check. Perez is a later option. |
| `wallModel.js` (338 lines) | Layer extraction, a 2-node linearised wall step, sol-air | `extractLayers` ports. The 2-node step does not. | Element nodes (ISO 52016-1 §6.5.7): five nodes per opaque element, from the layers |
| `thermalBridges.js` (247 lines) | ψ·L plus χ from the building | Pure, so it ports with a provenance header | Unchanged. ISO adds it to H_tr. |
| `thermalMass.js` (317 lines) | κ by construction, building C_m | `deriveConstructionMass` ports. The building C_m becomes redundant. | Node capacities come from the layers |
| `openingCoefficients.js` (176 lines) | `computeCd` and provenance | Pure, so it ports | Unchanged (Rule 14 physics) |
| Vent flow (inside 1228–1252) | Cross-flow and single-sided airflow | Copy it into `engine/airflow.ts` | Unchanged for 103 |

## 4. Reference cases

- **ISO 52016-1 and ISO/TR 52016-2:** not in the repo. I found no lawful copy, and it is a paid standard.
- **ASHRAE 140 / BESTEST 600 and 900:** not in the repo.
  - Inputs and results are published in NREL's free BESTEST report (Judkoff and Neymark, 1995) and in open literature.
  - The current acceptance ranges are in Standard 140 itself, which is paid.
- **Already committed:**
  - `validation/energyplus/` is a working harness: `generate_idf.py`, `ep_batch_runner.py`, `bridgewater_box_v1.idf`.
  - `validation/energyplus/results/bridgewater_box_v1.json` is a committed EnergyPlus reference for a 100 m² box: heating 25.2 and cooling 26.1, envelope only.
  - This is a lawful referee available today, with no EnergyPlus run needed.
- **EnergyPlus availability:**
  - Not installed on IT15: no `C:\EnergyPlus*` folders and no `ENERGYPLUS_DIR`.
  - Not in this container, and I could not fetch the release from here.
  - CLAUDE.md says Chris's machine has V26.1.0.

## 5. Model-document gaps (`frontend/src/thermal/schema/model.ts`)

| Gap | Today | Proposed path |
|---|---|---|
| Outside solar absorptance | 0.6 for walls and 0.7 for roofs, hard-coded | In the library construction body, `outside.solar_absorptance`, with the converter writing today's values explicitly |
| Thermal emissivity, inside and outside | none | `outside.thermal_emissivity` / `inside.thermal_emissivity` in the construction body (ISO uses 0.9 by default) |
| Surface heat-transfer coefficients | h_out 25, plus R_si values | None in the document. ISO 52016-1 Table 25 values are constants in the engine, named in the results. |
| Window frame fraction | 0.20, hard-coded | `surfaces[].frame_fraction`, with the converter writing 0.20 |
| Internal mass | 250 kJ/K·m² (tuning knob) | `zones[].internal_heat_capacity_J_per_K_m2`, with the converter writing 250,000 |
| Glazing inside absorption | 0.07 (tuning knob) | Drop it. ISO 52016-1 handles absorbed solar in the glazing node. Record it as a known difference. |
| Ground | Annual-mean T_out | `site.ground = { method: 'iso13370_virtual_layer', perimeter, ... }`. Engine 1 can start with the same annual-mean boundary and state that. |

**Schema impact:** every field above is a `schema_version` 2 bump.

- `fromBuildingConfig` writes today's constants explicitly, so the anchor document states what today's engine assumes.
- Old v1 documents migrate by filling the same constants.
- The model hash of the anchor changes, which is correct: it is a new schema version.

## 6. QA leftovers for Part 1

| Item | Change | Files | Trap |
|---|---|---|---|
| M4 | Add `buildings.local_ref text` with a unique `(project_id, local_ref)` constraint. `save` keys on the local project id, not the name. | 0005, `versions.ts:23-40`, `SaveModelVersionButton.jsx:137-139` | Existing rows have no local_ref: backfill the ZZ TEST row by its id, and leave the sentinel fixture row alone. |
| M6 | `upsert_library_item` raises an error when `(item, version)` exists with a different body hash | 0005 | The seed script already bumps versions, so re-running it stays a no-op |
| M7 | Add a named `auxiliary` line from `heat_balance.annual.gains.internal.auxiliary.electricity_kwh`. `kwh()` throws when a value is missing. District heat goes into the heating end use. | `versions.ts:81-106`, `runKey.test.ts` | Engine output for a project with no auxiliary must be an explicit 0, not missing. Check first, or throw only on non-finite values. |
| L2 | **You cannot simply revoke EXECUTE.** The RLS policies in `0002:295-301` call `org_of_project`, `org_of_building` and `org_of_version` as the querying role. | 0005 | Move the helpers to a `private` schema that PostgREST does not expose, keep EXECUTE for `authenticated`, and recreate the three policies. Do this only if the local-Postgres rig proves reads still work. Otherwise leave it, since the uuids are unguessable. |
| L3 | Add **Retry** and **Sign out** to the AuthGate error screen | `AuthGate.tsx:104` | none |
| L6 | Add a `revoke_invitation(p_invitation uuid)` security definer function, for admins only | 0005 | Closing dev sign-up is a dashboard setting, not code (see the database route below) |

## 7. Database route

IT15 has no Supabase CLI, no saved Supabase sign-in and no EnergyPlus. Node is 24.18 and Python is 3.14.6. NZA Sim (dev) lives in Chris's personal Supabase account, which this project's Supabase connector cannot see.

- **A (recommended, no change):** keep the pasteable note. For each migration, Chris's agent pastes one SQL file into the SQL editor, then runs one read-back file that I write. This worked for 0003 and 0004.
- **B (fewest hand-offs, Chris's call):** move NZA Sim (dev) into the Net Zero Advisory Supabase organisation. The connector reaches that organisation, so I could apply 0005 and later migrations and read them back myself, with no relays and no keys.
  - The cost is that organisation's per-project charge, about $10 a month.
  - Project ownership moves away from Chris's personal account.
- **C:** install the Supabase CLI and sign in to Chris's account on IT15.
  - Not recommended: it puts Chris's account session on Linzie's machine.
  - It also still needs the database password from Bitwarden.

No route needs a service-role key.

## 8. What Part 0 shows is wrong in the brief

1. **Decisions 1 and 2 (anchor gate at ±5 % of today's State 1 demand) would gate on a number that is not dynamic physics.**
   - State 1 demand is a quasi-steady setpoint convention, and it is known to disagree with EnergyPlus:
     - Bridgewater (`docs/validation/state1_static_vs_dynamic_post_part3_v1.md`): heating −10.8 %, cooling +56 %.
     - `bridgewater_box_v1`: heating −24 %, cooling +108 %.
   - An ISO 52016-1 hourly RC engine will land elsewhere by design. A ±5 % gate either fails honestly every time or invites tuning toward State 1, which breaks Rule 10.
   - **Proposed replacement:**
     - (a) **Conductances and setpoint-convention losses**, term by term against State 1, within ±1 %. Each H value (W/K by element, leakage, vents, bridging) and its annual loss at setpoint is algebra that both engines should agree on, so a gap is a bug.
     - (b) **Demand against an EnergyPlus envelope-only referee:** `bridgewater_box_v1` from the committed results now, and the anchor once EnergyPlus can run, within ±15 % for heating and ±20 % for cooling (ASHRAE 140 range widths are about this size). Report every gap with its magnitude.
     - (c) Today's State 1 demand shown alongside **for information only**, with no gate.
2. **Verification 3** (`solarOnSurface` equals `computeHourlySolarByFacade` to 1e-6) is right only while P2 keeps the isotropic sky. It stays as stated, and the brief should say so explicitly.
3. **Part 1's 0005 needs a database route,** decided above. The brief assumed Chris's agent; route B would remove the relay.
4. **The schema bump (§5)** is not in the brief's Parts. It belongs in Part 2, with a converter update and a v1→v2 migration test.
