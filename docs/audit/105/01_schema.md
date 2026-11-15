# Brief 105 Part 1: schema 2.3

## The finding

**The brief planned a new `zones[].gains` field. Schema 2.x already holds the same quantities,** on the document's
profiles, which each zone refers to through `profile_refs`:

| Profile | Fields that carry the gain |
|---|---|
| Occupancy | `density {value, basis}` (`per_room`, `per_m2`, `total`), `occupancy_rate`, `sensible_w_per_person`, schedule |
| Lighting, auxiliary | `magnitude {value, unit}`, `gain_fraction`, `area_share`, `relationship_to_occupancy`, `daylight_factor`, schedule |
| Equipment | `active`, `baseload`, `standby_factor`, plus the lighting fields |

Each zone also carries `area_m2` and `rooms`, which scale the densities.

**A second field for the same quantities would break CLAUDE.md Rule 11** (one quantity, one exposure). So 2.3 keeps the
gains where they are, and decision 1 of the brief is amended to say so.

## What 2.3 changes

**1. A radiant fraction on every gain profile.**
- `radiant_fraction` is added to occupancy, lighting, equipment and auxiliary profiles.
- It runs 0 to 1, and is null until stated.
- The engine needs it because Engine 2 has a radiant node per zone.

**2. Today's fallbacks are written into the document.** Today's engine applies these when a profile leaves a field out
(`frontend/src/utils/instantCalc.js`, `computeHourlyGains` and its helpers). The upgrade from 2.2, and the converter,
now write them in:

| Field | Value | Where today's engine holds it |
|---|---|---|
| `occupancy_rate` | 0.75 | `occ.occupancy_rate ?? 0.75` |
| `sensible_w_per_person` | 75 | `occ.sensible_w_per_person ?? 75` |
| `area_share` | 1 | `profile.area_share ?? 1.0` |
| `gain_fraction` | 1 | `profile.gain_fraction ?? 1.0` |
| `relationship_to_occupancy` | lighting and auxiliary `proportional_with_spill`, equipment `proportional` | `lightingFractionForHour`, `equipmentFractionForHour` |
| `daylight_factor` | 0.6, only for `proportional_with_spill` | `lightingFractionForHour` |
| `standby_factor` | 0.1, only for equipment that is not `independent` | `equipmentFractionForHour` |
| `radiant_fraction` | 0.3 | `TUNE_SOLAR_RAD_FRAC` (~2606): "Internal gains use the same radiative/convective split as solar (30/70)" |

A field the profile already states is kept. A converted document therefore says exactly what today's engine assumed,
and the Brief 103 pattern holds.

**3. No ventilation change.** The 2.x ventilation entries already carry kind, flow, basis, heat recovery and schedule.

**4. Not stated in 2.3:**
- **Latent gains.** The engine reports sensible demand only, as today's engine does.
- **The Systems lighting and small-power scalar** (`systems_config_v40`, `share_pct` × `control_factor`). That is the
  Systems scope, so it stays with Engine 4. Bridgewater's is 1 (100 %, factor 1).

## Bridgewater after conversion

- Bridgewater states every gain input itself, so only `radiant_fraction` (0.3) is filled.
- Occupancy: 2.5 people per room, rate 1, 75 W sensible.
- Lighting: 2 W/m², `proportional_with_spill`, daylight factor 0.7.
- Equipment: 5.04 W/m² baseload, 0 active, standby 0.04.
- External lighting: gain fraction 0.

## The editor

- The editor's space type should write document profiles with their densities and set the zone's `profile_refs`.
- The editor writes 2.2 today. After this change it should write 2.3, with `radiant_fraction` stated or null.
- This has been asked of the editor thread, not made.

## Verification

- `npx vitest run src/thermal`: 104 tests pass. That is the 101 before, unchanged, plus 3 new ones:
  - 2.2 upgrades to 2.3 with the same hash as the converter's output;
  - only today's fallbacks are filled, and only where today's engine reads them;
  - a missing or out-of-range radiant fraction is refused.
- 2.0 and 2.1 documents still upgrade to the converter's output.
- `npm run build` is clean.
- No engine number moves, because no engine reads gains yet.
