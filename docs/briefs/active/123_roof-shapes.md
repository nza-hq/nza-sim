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
- Each block on the plan carries a roof recipe, copied from decodED's types (with a provenance header, as decodED copies from nza-twin-lab). The fields are:
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
- **Other outlines** (an L drawn as one shape, a triangle) need a straight skeleton for hip and gable, which is what decodED's CGAL service does. In this brief such a block gets one of two treatments:
  - (a) split into rectangles where it splits cleanly, each with its own roof meeting at a valley; or
  - (b) left flat and labelled "roof shape needs a rectangle: split the block".
- Nothing guesses at a skeleton. A server-side skeleton (decodED's service behind NZA Sim's backend) is a follow-up only if she wants complex outlines.
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
- Covers: `Plan` blocks' roof recipe, defaults, the copy of decodED's types with provenance, plan save and load, and the plan version bump.
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
- Covers:
  - The unheated loft zone (no setpoint, no system objects; Rule 8).
  - Its ventilation, with the rate cited.
  - The ceiling as an internal surface.
  - The slopes and gable walls.
  - The same in the monthly estimate (Brief 122), and in Rule 14's sense for every path that walks the envelope.
- Every term is a line in the breakdown (Rule 9), including:
  - Loss through the ceiling to the loft.
  - Loss from the loft to outside.
  - Solar on the slopes.
- The engine thread writes this section in full.

### P5: Referee (engine thread)
- Against EnergyPlus: a box with a gable cold loft (the attic as an unconditioned zone) and a warm mono-pitch.
- The gates are the engine thread's, stated before the run.

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
