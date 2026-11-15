# Brief 108 Part 1: schema 2.4, emitters per zone

**What changed** (`frontend/src/thermal/schema/model.ts`, `SCHEMA_VERSION = '2.4'`):

- **`zones[].emitters[]`**, one entry per kind of terminal unit in the zone:
  - `kind`: one of `radiator`, `underfloor`, `fan_coil`, `vrf_indoor`, `electric`, `other`.
  - `count` and `rated_output_w`, the output of one unit at its rating (wet kinds) or its fixed output (`vrf_indoor`, `electric`).
  - `radiant_fraction`: the share of its heat given to the room's surfaces.
  - Wet kinds also carry `system_group_id` (the heating group that feeds it) and the EN 442 rating: `rated_flow_c`, `rated_return_c`, `rated_room_c`, `exponent_n`.
  - Every field is required and nullable. Nothing is defaulted; the engine (Part 2) names a missing value.
- **`system_groups[].design_flow_c` and `design_return_c`**: optional and nullable. Part 2 requires them when the group feeds an emitter.
- **The schema refuses:**
  - an emitter id used twice;
  - a VRF indoor unit or electric heater that names a system;
  - a wet emitter whose system does not exist, is not heating, or does not serve its zone.
- **A zone with no emitters is not limited, as before.** Part 5's panel says so.

**Upgrade, converter, seam:**

- `upgradeDocument` takes 2.3 to 2.4 by adding `emitters: []` to each zone. It fills nothing else.
  - A test checks that Bridgewater upgraded from 2.3 equals the 2.4 conversion, with the same hash.
  - The 2.2 → 2.3 step still states today's gain fallbacks.
- **The converter** (`fromBuildingConfig.ts`) writes no emitters, so today's projects run as before.
- **The seam** now runs a 2.3 document through the upgrade, since that step fills nothing; a test checks the results are identical. It still refuses 2.2 and older (Brief 105 F1).

**Tests:** 177 pass, including six new emitter schema tests (`schema/__tests__/emitters.test.ts`), the 2.3 → 2.4 upgrade, and the seam running a 2.3 document. No file of today's engine is touched.
