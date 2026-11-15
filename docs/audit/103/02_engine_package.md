# Brief 103 Part 2 — engine package, EPW parser, solar on any surface, schema 2.1

15 Nov 2026, branch `chris/103-engine-1`. No engine file of today's tool is touched; `instantCalc.js` and
`solarCalc.js` are read only by tests.

## What landed

- `frontend/src/thermal/engine/`: `types.ts`, `epw.ts` (`parseEpw`), `solar.ts` (`sunPosition`, `solarOnSurface`),
  `index.ts`, and `__tests__/epwSolar.test.ts` (10 tests).
- `frontend/src/thermal/schema/`: schema **2.1** (`model.ts`), the converter writes the new fields
  (`fromBuildingConfig.ts`), `upgrade.ts` (`upgradeDocument`, `TODAY`), `results.ts` follows `SCHEMA_VERSION`,
  `__tests__/upgrade.test.ts` (3 tests).
- `scripts/103_epw_parity.mjs` and its output `02_epw_parity.txt`.

## Gates

| Gate | Result |
|---|---|
| `parseEpw` equals the backend parser on the anchor EPW, value for value | PASS: dry bulb, DNI, DHI, wind, month, day, hour, lat/long identical (`02_epw_parity.txt`). The backend's own `parse_epw` was run directly (lifted out with Python's `ast`), not through `/api/weather`, so no backend server was needed. |
| sha256 = `c6571102…cf2` | PASS |
| `solarOnSurface` on the four anchor facades (orientation 42°) and the roof equals `computeHourlySolarByFacade` within 1e-6 W/m² | PASS in a stricter form. Today's arrays are Float32, so a 1e-6 W/m² absolute match is impossible at ~500 W/m² (one Float32 step is ~3e-5). The test instead requires `Math.fround(ours) === today's` for every one of 5 × 8,760 values: 0 mismatches. Largest raw difference 3.05e-5 W/m², which is that rounding. |
| a horizontal surface returns global horizontal | PASS as the brief means it: a horizontal surface returns DNI·sin(altitude) + DHI, today's roof formula (test checks it to 1e-9). That computed figure is **not** the EPW's own global-horizontal column: on the anchor it is 1,074.9 kWh/m²·yr (1,073.8 with the actual day of the year) against the EPW's 1,094.5, 1.8% lower. Engine 1 keeps today's formula so the parity gates hold; the EPW column is parsed and available. |

`solarOnSurface` takes `albedo` and `sun_day` (`'mid_month'`, today's, or `'actual'`) and refuses either missing
rather than assuming one.

## Schema 2.1

Part 0 §5 listed constants today's engine hard-codes that Engine 1 needs as inputs. 2.1 states them in the document:

| Field | Where | Today's value (instantCalc.js) |
|---|---|---|
| `solar_absorptance` | outside walls / roofs; null otherwise | 0.6 walls, 0.7 roofs |
| `thermal_emissivity` | outside walls, roofs and (from Part 3) glazing; null otherwise | 0.9 (not in today's engine; its h_out = 25 lumps radiation) |
| `frame_fraction` | glazing; null otherwise | 0.20 |
| `zones[].internal_heat_capacity_j_per_k_m2` | every zone | 250,000 |
| `building.site.ground.method` | building | `'annual_mean_outdoor'` |

The schema refuses an outside wall or roof without absorptance and emissivity, and glazing without a frame fraction.
`upgradeDocument` turns a stored 2.0 document into the 2.1 one the converter writes today (test: equal document,
equal hash). The model hash of every building changes with the version, as it should; the dated 102a/102b anchor
records keep their 2.0 hash as a record. Local Postgres store tests after the change: P2 15/15, P3 8/8, P6 37/37.
