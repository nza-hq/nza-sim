# Brief 112 Part 4: gates

16 Nov 2026. Script `scripts/112_gate.mts`, output [`04_gate.json`](04_gate.json). Run through the product's seam on the anchor EPW (sha `c6571102…cf2`).

## Bridgewater: lux and efficacy reproduce today's lighting exactly

Bridgewater's lighting is stated as 2 W/m² (`default_lighting`). For this gate it was restated as 100 lux on the space and 2 W/m² per 100 lux on the lighting system.

**These are not survey values.** They were picked so that lux ÷ 100 × efficacy is today's stated W/m². The gate tests the path, not a lighting design.

| | Stated W/m² | Lux and efficacy |
|---|---|---|
| Lighting, kWh | 39,014.301 | 39,014.301 |
| v2 EUI, kWh/m² | 131.886 | 131.886 |

The largest difference in any end use or the total is 0 kWh. **Pass.**

- Lighting is 39.014 MWh, the 107 gate's figure.
- The v2 EUI is 131.89, as in 107. The 133.2 anchor is today's engine, which is untouched.
- Re-running `node scripts/_brief93_anchor.mjs --fixture validation/fixtures/bridgewater_anchor_v2.yaml` still gives **133.2**.
- Hot water now sits on the occupancy profile: {"basis": "per_person", "litres_per_day": 55}.
- Re-running `scripts/107_gate.mts` on schema 2.8 rewrites `docs/audit/107/02_gate.json` byte for byte.

## The three levels

Fabric is heated to 21 °C. Closure means the building breakdown sums to zero within 1 ppm of its gross (Rule 9, integrand against display).

| Building | Level | Heating kWh | Cooling kWh | Lighting heat kWh | Closes |
|---|---|---|---|---|---|
| bridgewater | fabric | 90,614 | 0 |  | yes |
| bridgewater | spaces | 153 | 192,750 |  | yes |
| bridgewater | systems | 114,546 | 62,725 | 39,014 | yes |
| two_zones | fabric | 14,703 | 0 |  | yes |
| two_zones | spaces | 7,830 | 6 |  | yes |
| two_zones | systems | 9,340 | 11 | 747 | yes |

- **Lighting heat is absent at "+ Spaces" and arrives at "+ Systems"**, with the luminaires.
- **Bridgewater "+ Spaces" heating is small (153 kWh).** That level removes the MVHR and its ventilation loss, and keeps the hotel's people and equipment. Equipment alone is 186 MWh a year of heat. This was the case before 112 as well, and lighting's removal raises it only slightly.
- **The two-zone fixture** is `sim2/geometry/__fixtures__/two_zones.plan.json` through the editor's `buildDocument`.

## Tests

The v2 suites (`src/thermal`, `src/sim2`) pass: 396 tests with the EPW present. The build is clean.
