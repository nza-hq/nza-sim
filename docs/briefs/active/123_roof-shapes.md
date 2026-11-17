# Brief 123: Simulate v2, roof shapes (flat, mono-pitch, gable and hip, then a drawn roof)

**Status:** ACTIVE, 17 Nov 2026.

**Asked for by Linzie:**
- 10:03: "I want to be able to edit the roof shape as well, though, like what type of roof it is. We built that into decoded, so we should be able to reuse our roof module."
- 10:29: "can we have a few more: gable, monopitch? … what are the most common roofs we see? I think the ability to maybe draw one would be good as well."

**Owners:**
- The editor thread writes P0, P1, P2, P3, P6 and P7: the brief, the roof recipe on the plan, the faces, the Shape screens, the drawn roof and the close.
- The building/engine thread writes P4 and P5, the unheated loft and its referee. It owns `thermal/`, `sim2/run/seam.ts` and the document schema.
- This was agreed in the thread on 17 Nov 10:20.

## BEFORE DOING ANYTHING

1. Read these in full: CLAUDE.md (Rules 7, 8, 9, 11 and 14, plus the Building module scope), STATUS.md and `docs/briefs/current.md`.
2. Read the following:
   - `sim2/geometry/plan.ts`: blocks, `storey_height_m`, and how roofs reach the document today.
   - `sim2/geometry/Plan3D.tsx`: the flat `Roof`.
   - decodED's roof recipe types, `nza-decoded/src/twin/contract/schema.ts` (the "Roof recipe" section and `ROOF_SHAPES`). Read only; decodED is not changed by this brief.
3. Do not touch today's engine or the Bridgewater anchor of 133.2. This is Simulate v2 only.
4. CGAL must never reach a browser (decodED Brief 20 D3). decodED builds a recipe's faces in a Python CGAL service (`services/roof/`, GPL-3). Nothing in this brief calls it from the browser, and NZA Sim does not ship it. See P2.

## Scope (CLAUDE.md rule 10)

This is the **Building module, State 1 envelope-only**:
- The roof's shape: its faces, tilt, facing and area.
- Where the insulation sits.
- The conduction and solar on those faces.
- Under a cold roof, an unheated loft between the ceiling and the slope.

There are no systems, no people and no controls. The loft is an unconditioned space. It has no setpoint, and nothing heats or cools it (Rule 8: it has no system objects, rather than muted ones).

## The common roofs (the answer to Linzie's question)

These are the most common roofs on UK buildings we model: schools, offices, community buildings, hotels and houses.

1. **Flat.** Most non-domestic buildings since the 1960s, and most extensions. This is today's roof.
2. **Gable** (a ridge, with two slopes and two vertical gable ends). This is the most common pitched roof, on houses, older schools and halls. A shallow gable is also the usual portal-frame shed or sports hall.
3. **Hip** (four slopes, no gable ends). This is common on houses and on 1930s–1970s schools and offices.
4. **Mono-pitch** (one slope). Used on extensions, modern schools and lean-tos.

Later, if she wants them, from decodED's list:
- **Half-hip.**
- **Mansard** (urban, a storey in the roof).
- **Sawtooth** (older factories, north-light glazing).

## Design

### The recipe
- The building carries one roof recipe, applied to each block (`Plan.roof`; absent means flat, as today). Per-block styles can follow if a building needs two. The recipe is copied from decodED's types (with a provenance header, as decodED copies from nza-twin-lab). The fields are:
  - `style`: flat, mono, gable or hip.
  - `pitch_deg`.
  - For a gable, the ridge axis (`longest` or `shortest`).
  - For a mono-pitch, `high_side`.
- Defaults keep her input minimal:
  - Gable or hip: 35°, ridge on the longest side.
  - Mono-pitch: 10°, high side north.
  - Flat stays flat.
- One choice says where the insulation is:
  - **Insulated at the ceiling (cold loft).** This is the default for gable and hip.
  - **Insulated at the slope (warm roof, room open to the roof).** This is the default for mono-pitch.
- The roof construction applies to the insulated surface. A cold loft's slope takes the library's "pitched roof, uninsulated (tiles on felt)". If the library has no such item, the screen says so, and nothing is made up.

### The faces
- Faces are worked out in the browser, in `sim2/geometry/roof.ts`. They are needed on every edit, for the instant estimate, so a server round trip is too slow.
- **Rectangular blocks** (most blocks; Shape draws rectangles) are done exactly:
  - Flat: 1 face.
  - Mono-pitch: 1 sloped face, plus 2 triangular gable walls and 1 raised wall.
  - Gable: 2 slopes, plus 2 triangular gable walls.
  - Hip: 2 trapezia and 2 triangles.
- **Other outlines** (an L drawn as one shape, a triangle) need a straight skeleton for hip and gable, which is what decodED's CGAL service does. Blocks that touch are joined, so an L cannot be split into two rectangles on the plan. In this brief such a block stays flat, labelled "this roof shape needs a rectangular block for now". Nothing guesses at a skeleton.
- **Open, for Linzie (an L is common, and the community centre is one):**
  - (a) Run decodED's roof service (CGAL, server side, never in the browser) behind NZA Sim's backend. This is exact and reuses our module, but needs the service running beside NZA Sim.
  - (b) Write a straight skeleton in TypeScript for right-angled outlines (L, T, U). This is instant, but it is our own code to referee.
  - Asked when P3 is in front of her.
- Gable and raised walls are external walls of the top storey (cold roof: of the loft). They carry the wall type and can take windows like any wall.
- The tests:
  - The faces' plan areas sum to the footprint.
  - The sloped area equals the footprint ÷ cos(pitch).
  - The volumes are checked against hand sums for each style.

### On screen (Shape, roof tab)
- The left panel lists the blocks, each with its roof style.
- The right panel (the passport) shows:
  - The style as four picture buttons (flat, mono-pitch, gable, hip).
  - Pitch.
  - Ridge direction, or the high side.
  - Insulated at the ceiling or the slope.
  - The resulting areas: slope m², ceiling m², gable wall m², loft volume m³.
- 3D draws the faces:
  - Translucent normally.
  - Orange when the roof is chosen (as built on 17 Nov).
  - The loft is drawn as a space, with no room colour.
- Plan shows the ridge and hip lines over the outline.
- Elevation shows a gable wall's triangle, with its windows.

### The document (the engine thread's schema)
- Each sloped face is a roof surface with its own tilt and azimuth. The engine already takes these (confirmed by the engine thread, 17 Nov 10:20).
- A cold roof adds an unheated loft zone, holding:
  - Its volume.
  - The ceiling between it and the rooms below. This is an internal surface, with the ceiling's construction and its insulation.
  - The slopes and gable walls to outside.
  - Its own air leakage. The default is "ventilated loft" per BS 5250, with its rate named and cited by the engine thread.
- A warm roof puts the slopes straight on the top-floor rooms, and the room volume grows by the roof void.

## Parts

### P0: Brief on disk (this commit)

### P1: The recipe on the plan (editor)
- Covers: `Plan.roof` (the building's recipe), defaults, the copy of decodED's types with provenance, and plan save and load.
- Older plans load as flat, unchanged.
- Verify:
  - Vitest: round trip, and old plans load flat.

### P2: Faces in the browser (editor)
- Covers: `sim2/geometry/roof.ts` for rectangular blocks (flat, mono-pitch, gable, hip), with the area and volume tests above.
- Non-rectangular blocks are refused with a reason, never guessed.
- Verify:
  - Vitest against hand sums.
  - A 10 × 20 m gable at 35°: slope 244.1 m², gable walls 2 × 17.5 m².

### P3: Shape screens (editor)
- Covers: the roof tab's passport, the 3D faces, the plan ridge lines and the gable walls in elevation.
- Verify:
  - Browser at 1440 × 900 on the community centre and Bridgewater.
  - Screenshots of each style.
  - Changing the pitch changes the slope area shown.

### P4: The loft and sloped roofs in the engine (engine thread)

Sloped roofs need nothing new: a roof surface already takes any tilt and azimuth, and sun, sky, films and convection follow the tilt (`model.ts` `buildElements`, `elements.ts`). P4 is the unheated loft, and every path that walks the envelope taking it the same way.

**P4.1 Schema 2.12 (`thermal/schema/model.ts`, upgrade 2.11 → 2.12 fills nothing).**
- `zones[].conditioning`: `'conditioned'` (default, every zone today) or `'unconditioned'`.
- An unconditioned zone has no setpoints (`heat_c`, `cool_c`, `setback_c`, `hours_ref`, `heat_ref`, `cool_ref` all null), no emitters, no ventilation entries, no profile references, and is in no system group or control. Each of these is refused by name if present (Rule 8: removed, not muted).
- `zones[].unconditioned_kind`: `'ventilated_loft'` (the only kind this brief; an unheated stairwell or store can follow), recorded for the screens and the defaults.
- The loft's air is its own `infiltration_ach`, stated on the zone (P4.2). Its `infiltration_q50` is null.
- The ceiling between a room and the loft is an interzone `ceiling` surface (`zone_a` the room, `zone_b` the loft), with the ceiling's construction (joists and quilt) and both inside faces, as Brief 104's interzone floors.

**P4.2 The loft's air, cited.**
- Default 'ventilated loft': **3 air changes an hour**, ISO 13789:2017 clause 9.4 (air change rates of unconditioned spaces), the row we recall as "not airtight due to some localised open joints or permanent ventilation openings" (NOT yet verified by us: the public previews stop before clause 9.4. A 2022 paper (Buildings 12(2) 146) reproduces the EN ISO 13789 table and reports BR 443 taking 3 h⁻¹ when conditions are unknown; we could not read its table image. The figure is shown on screen as a stated, editable value with this citation). BS 5250 sets the vent openings (for example a 10 mm continuous gap at each eave, 5 mm at the ridge) but gives no air change rate, so the rate comes from ISO 13789's conventional values. Before P4 builds, the table's wording and values are checked against a published copy or a secondary source that quotes it. If they differ, the published values are used and the change is stated.
- The editor shows it as "Loft ventilation 3 air changes an hour (ISO 13789, ventilated loft)", editable, never hidden.
- The rooms' own leakage: under a cold roof, q50 × the rooms' envelope area counts the ceiling to the loft (the air barrier is at the ceiling), so taking the roof off the rooms does not cut their leakage. Under today's method and under weather-driven air both. Stated in the schema note and tested: a gable cold-loft box and the same box flat have the same room leakage.

**P4.3 The hourly run (`model.ts`, `network.ts`).**
- A document with a loft runs on the network solver (it has an interzone element). The loft floats: no heating or cooling term, its temperature solved each step from the ceiling, slopes, gable walls, solar, sky and its air.
- Lines (Rule 9), all already terms of the solver:
  - the room: `interzone` on the ceiling surface ("heat to the loft");
  - the loft: `interzone` on the ceiling (the same heat, arriving), `conduction`, `opaque_solar_absorbed` and `sky_longwave` per slope and gable wall, `infiltration` (its 3 air changes), `storage`.
  - The building breakdown leaves interzone out (it cancels), so it shows the loft's losses to outside and the solar on the slopes. Closure is checked per zone, loft included.
- Results: the loft is a zone in `ZoneResults` with its hourly temperature; `heating_kwh` and `cooling_kwh` 0. It is marked unconditioned in `Summary.zones[]`.
- Bridging: the roof junctions (eaves, verge, ridge) go to the loft zone, which has the roof; the top rooms keep the wall and window junctions and get no roof junction. Stated; the ceiling-to-wall junction at a cold roof is the ISO 14683 "roof" ψ applied at the eaves, as today (no new ψ values).

**P4.4 Everything that walks the envelope (Rule 14's sense in v2).**
- `levelDocument`: Fabric only heats every conditioned zone to the temperature and leaves the loft unconditioned (today it sets every zone's `heat_c`). + Spaces and + Systems keep it unconditioned.
- `preflight`: does not ask the loft for setpoints.
- Floor area (`readDocFloorM2`, EUI, kWh/m²): conditioned zones only. Tested: adding a loft does not change the floor area or the EUI denominator.
- Systems, emitters, plant capacity, pumps, heating hours, window rules and hot water skip unconditioned zones, and refuse one named in a system group or control.
- Design heat loss (Brief 117): a room's ceiling to the loft is a loss to an unheated space at the loft's design temperature. Following the MCS calculator's public method, the loft's design temperature is the outdoor design temperature for a ventilated loft. This is checked against the published method in P4; if it differs, its method is used and stated. The term is its own line ("ceiling to loft").
- **The monthly estimate (Brief 122)** treats the loft as an adjacent unconditioned space, ISO 13789:2017 clause 6.4: each room's ceiling loss is H_iu·b·(θ_i − θ_e,m) with b = H_ue / (H_iu + H_ue). H_iu is the ceilings' U·A under that loft. H_ue is the loft's slopes and gable walls U·A plus ρc·n·V. Lines:
  - the room: `interzone` on the ceiling;
  - the loft, as a zone with no heating: `conduction` per slope and gable wall, `infiltration`, and `interzone` arriving, split in proportion to H_ue's parts so they close.
  - Solar on the slopes and sky on them are left out of the monthly loft (ISO 13789's b without solar), and the notes say "solar on a cold roof's slopes is not counted in the estimate". The referee reports how much that is.
- Today's engine (`instantCalc.js`) and the Bridgewater 133.2 anchor are not touched.

**P4.5 Tests.**
- Schema: an unconditioned zone with any setpoint, emitter, ventilation entry, profile reference, group or control is refused by name; 2.11 documents upgrade with every zone conditioned.
- A gable cold-loft box: the loft's lines close every hour; the room's ceiling `interzone` equals minus the loft's; the building breakdown has no heating line on the loft; floor area unchanged by the loft.
- The loft's temperature lies between outside and the room on a winter night, and above outside on a sunny day.
- The monthly estimate closes per zone, loft included; b is between 0 and 1.
- Fabric only leaves the loft unconditioned.
- Bridgewater digest unchanged (no loft in it).

### P5: Referee (engine thread)

Against EnergyPlus 25.2, on Chicago O'Hare TMY3 (committed, as the Brief 115 referees). The spec is committed before the first run as `validation/energyplus/123_roof_spec.json`; the script is `validation/energyplus/123_roof_referee.py`. Convection is iso_conv, on 4 steps an hour, with the EulerMethod zone air algorithm, as Briefs 115 and 120.

**Cases.** All are a 10 × 20 m single-storey box, 3 m to the ceiling, the Brief 104 cooled room's wall, floor and window constructions, and windows on the long sides. No gains in Fabric-like cases.

- **L1 gable cold loft.**
  - Gable at 35°, ridge on the long axis.
  - Slopes: tiles on felt, uninsulated. Gable walls: the wall type.
  - Ceiling: plasterboard with 270 mm mineral wool.
  - Loft: 3 air changes an hour (EnergyPlus `ZoneInfiltration:DesignFlowRate`, AirChanges/Hour, constant).
  - Room heated to 21 °C, no cooling.
- **L2: L1 in summer, cooled.** The same, with the room cooled at 24 °C, to test the solar on the slopes reaching the room through a hot loft.
- **M1 warm mono-pitch.**
  - Mono-pitch at 10°, high side north.
  - Slope insulated: the library's pitched-roof-insulated item, U as stated. Room open to the roof, so its volume includes the void.
  - Room heated to 21 °C, and cooled at 24 °C as M2.
- **F0 flat.** The same box with today's flat roof, as the base for each case's own effect.

**Gates (stated here, before any run).**

| Case | Quantity | Gate |
|---|---|---|
| L1 | Room's annual heating | ±5 % |
| L1 | Heat through the ceiling to the loft, year | ±10 % |
| L1 | Loft's air temperature: annual mean | within 0.5 K |
| L1 | Loft's air temperature: hourly RMSE | ≤ 1.0 K |
| L1 | Loft's air temperature: hottest hour | within 1.5 K |
| L1 | Own effect against F0 (heating) | ±10 % |
| L2 | Room's annual cooling | ±10 % |
| L2 | Own effect against F0 (cooling) | ±15 % |
| M1 | Room's annual heating | ±5 % |
| M2 | Room's annual cooling | ±10 % |
| L1, M1 | Monthly estimate's heating against the 15-minute run | ±10 % (Brief 122's gate) |
| L2 | Slope solar the monthly estimate leaves out | reported, not gated |

- The open room-level gaps of Briefs 103–108 (cooling especially) are reported beside each case's own effect, as Briefs 115 and 119 do. A miss is reported as a miss and never tuned.
- The report is `docs/audit/123/02_referee.md`, with the engine and EnergyPlus JSON beside it.
- The EnergyPlus attic is the reference: an unconditioned `Zone` with the slopes and gables as its surfaces and the ceiling as an interzone `Surface` pair. The roof's outside convection is the same fixed coefficient as the walls (iso_conv).

### P6: Drawing a roof (editor; after P3, and only if Linzie still wants it after using P3)
- She marks the ridge and hip lines on the plan.
- The faces follow, each face's pitch set or worked out from a ridge height.
- Scope it when she has used P3.

### P7: Close (editor)
- Covers: STATUS, CLAUDE.md's Building scope line (roof shapes and the loft), and archiving the brief.

## Deliverables

1. This brief on disk, and `current.md` updated (P0).
2. P1–P3 on `sim2/123-roof-shapes`, with one commit per part and STATUS updated in each.
3. P4–P5 on the engine thread's branch, with its referee report in `docs/audit/123/`.
4. The close (P7), with CLAUDE.md's Building module scope updated to name roof shapes and the unheated loft.
