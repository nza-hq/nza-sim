# Brief 104 Part 0: reconnaissance

The referee is read as `103_referee.py` builds it (r0), using `validation/fixtures/report_baseline_v1.yaml`.
`recon` means the dictionary that `build()` returns, inspected without running EnergyPlus.

## 1. The referee's zones

Five zones, `Floor_1` to `Floor_5`. Each is 843.19 m² of floor and 3.2 m high, and all are identical except the
top and bottom boundaries.

| Zone | Ext. wall m² (net of glazing) | Glazing m² | Below | Above |
|---|---|---|---|---|
| Floor_1 | 468.10 | 127.9 | ground floor 843.19 (`bridgwater_ground_floor`) | slab 843.19 |
| Floor_2–4 | 468.10 each | 127.9 each | slab 843.19 | slab 843.19 |
| Floor_5 | 468.10 | 127.9 | slab 843.19 | roof 843.19 (`bridgwater_roof`) |

- **Totals.** These match Engine 1's one-zone document:
  - walls: 2,340.5 m²;
  - glazing: 639.5 m²;
  - roof and ground: 843.19 m² each;
  - inside face area of the four slabs: 2 × 3,372.8 = 6,745.5 m².
- **Infiltration** is the same air-change rate in every zone, so it is allocated by volume, equal per zone.
- **Vents** are equal per zone: 0.0089833 m³/s per m/s of wind, so 5 × 0.00898 is the document's total.
- **Bridging** is allocated per element (103 P5). The roof's 35.11 W/K is on Floor_5. The walls' 242.97 W/K is split
  equally across the five zones' walls, because every zone has the same wall area and construction.
- **Solar distribution is `FullExterior`, not `FullInteriorAndExterior`.**
  - `07_bestest_referee.md` and the 103 P6b reasoning said both referees use FullInteriorAndExterior. That is wrong
    for Bridgewater: only the BESTEST twin does.
  - The conclusion still holds. Under FullExterior, EnergyPlus puts all transmitted beam solar on the zone's floor
    (Engineering Reference, "Solar Distribution"), as FullInteriorAndExterior does for a box. Its share of floor area
    is lower, but the floor still receives the beam.
  - This correction is carried in Part 1's write-up.
- **Time step:** four per hour. **Convection:** EnergyPlus's defaults, TARP inside and DOE-2 outside (no
  `SurfaceConvectionAlgorithm` objects). **Sky:** from the EPW's horizontal infrared (no `WeatherProperty` object).

## 2. The interior slab (`interior_floor_ceiling`)

Layers listed from the outside face, which is the floor-side face of the upper zone. Each slab is one EnergyPlus
surface pair: `Floor` in the upper zone and `Ceiling` in the lower one.

| Layer | t m | λ W/mK | ρ kg/m³ | c J/kgK | R m²K/W | κ kJ/m²K |
|---|---|---|---|---|---|---|
| Carpet | 0.010 | 0.06 | 200 | 1300 | 0.167 | 2.6 |
| Screed | 0.065 | 0.41 | 1200 | 840 | 0.159 | 65.5 |
| Concrete | 0.200 | 1.13 | 2000 | 1000 | 0.177 | 400.0 |
| Plaster | 0.013 | 0.5 | 1300 | 1000 | 0.026 | 16.9 |
| **Total** | | | | | **0.528** | **485.0** |

- The four slabs hold **1,636 MJ/K**.
- Engine 1 instead puts today's 250 kJ/m²K × floor area on the air node: **1,054 MJ/K**. The referee has no
  air-node mass.
- The carpet sits on the floor side, so the face that takes the beam is insulated (R 0.17) from the concrete. The
  ceiling side is plaster on concrete.

## 3. Schema 2.1 against what 2.2 needs

**Already there:**

- `SurfaceKind` has `partition`, `floor` and `ceiling`.
- `zone_b` takes any zone id, and the document refinement checks that the zone exists.
- `zones[].surfaces` lists surface ids.

**Missing in 2.2:**

- an `internal_mass` kind and its `faces_up` field;
- a check that an interzone surface is listed by both of its zones, and only by them;
- a check that an interzone surface does not carry solar absorptance, emissivity or openings;
- a convention for a `floor` between zones. One surface with tilt 180 from zone_a's side, so it is zone_a's floor and
  zone_b's ceiling. Brief decision 2.

**The converter** (`fromBuildingConfig`) builds one zone: `storeys = num_floors`, area = L × W × storeys. A
`per_storey` option needs:

- per-storey walls, glazing and vents;
- the roof on the top zone and the ground on the bottom zone;
- `floor` surfaces between storeys from the library's `interior_floor_ceiling`;
- each zone's own polygon with `storeys: 1`;
- infiltration q50 split by envelope area, which Engine 1's `infiltration()` already does per zone.

## What this changes in the plan

Nothing in the Parts. Part 1 adds one run: `fullint`, the referee with FullInteriorAndExterior, to measure the
FullExterior choice itself.
