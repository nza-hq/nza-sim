# Brief 115 P1 — schema 2.11

16 Nov 2026. `frontend/src/thermal/schema/model.ts`, upgrade in `schema/upgrade.ts` (`to211`).

| Field | Where | Meaning |
|---|---|---|
| `building.air.method` | building | `'today'` (n50/20 leakage, wind-only vents, today's engine exactly) or `'weather_driven'` (Brief 115) |
| `building.air.exponent` | building | cracks' flow exponent n, 0 < n ≤ 1; required under weather_driven, null under today |
| `building.air.single_sided_turbulence` | building | switch for EN 16798-7's single-sided wind term; required under weather_driven, null under today |
| `building.site.terrain` | site | `'open' \| 'suburban' \| 'urban' \| 'city'`; required under weather_driven |
| permanent vent `height_m` | opening | height above the room's floor, m (weather_driven) |
| operable `style` | opening | side_hung, top_hung, bottom_hung, centre_pivot, sliding, louvre |
| operable `opening_angle_deg` | opening | widest opening angle, 0..180 (hung and pivot) |
| operable `sill_m`, `head_m` | opening | above the room's floor, head above sill |
| control `open_above_c` | controls[] (window entries only) | a temperature rule opens when the room is above this and warmer than outside |

The window entry's other fields (rule, open_fraction, hours_ref, modulation, min_open_h, min_closed_h, open_above_ref, adaptive_category) are Brief 114's shape; their meanings are 115's (see `00_reconnaissance.md`).

**Upgrade 2.10 → 2.11** writes `air: { method: 'today', exponent: null, single_sided_turbulence: null }`, `site.terrain: null` and each control's `open_above_c: null`. Nothing is guessed: an upgraded document runs today's method exactly. The seam accepts 2.10 for upgrade. Today's converters (`fromBuildingConfig`, the editor's `toDocument`) write `'today'` explicitly.

The brief's P1 list named further fields (`q50_m3_h_m2` / `n50_ach` on `building.air`, `test_area_basis`, `split`, window construction types, `shielding`, `control_ref`). Decided here, to keep each figure in one place (Rule 11): q50 stays on each zone (`infiltration_q50`, as today); the opening's own fields carry cd, style and angle (no second window type to keep in step); shielding and a split by element kind are not in this method (leakage goes on the walls, stated); `control_ref` is not needed because a room has one window entry, found by its zone. Any of these can be added in 115b without moving a figure.
