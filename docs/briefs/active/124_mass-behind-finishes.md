# Brief 124: Simulate v2, thermal mass behind finishes

**Status:** ACTIVE, 17 Nov 2026.

**Asked for by Linzie:**
- 15:16: "if we've got a concrete frame building … but we're covering it with carpet and plasterboard ceilings, does the model still account for thermal mass or not? … I've been told before that if you put a ceiling or a void between the concrete slab and the ceiling, then that means you can't get the benefit of that thermal mass. I don't think that is necessarily true."
- 16:34: chose "Fix engines and workspace" on the decision card.
- 16:35: "make sure that anything like that is always defaulted … from templates … either a hard floor or a carpet … A tick box: does it have a ceiling board or … exposed … assume some basics and then let the user edit the basics."

**Owners:**
- The building/engine thread writes P0–P3 and P5. It owns `thermal/`, `sim2/run/seam.ts` and the document schema.
- The editor thread writes P4, the finishes on the space templates and on the Fabric screens.

## BEFORE DOING ANYTHING

1. Read these in full: CLAUDE.md (Rules 7, 8, 9 and 11, plus the Building module scope), STATUS.md and this brief.
2. Read the investigation and its numbers:
   - `/mnt/project-files/nza-sim/mass/thermal_mass_behind_finishes.md`.
   - `docs/audit/mass_finishes/`, holding the EnergyPlus and engine results for the concrete-frame room.
3. Do not touch today's engine (`instantCalc.js`). This is Simulate v2 only. The Bridgewater v2 anchor moves (P3): measure it, report it, and get Chris's check before merging to main.

## Scope (CLAUDE.md rule 10)

This is the **Building module, State 1 envelope-only**:
- The heat capacity of the fabric, layer by layer.
- The finish layers on a room's inside faces.
- The contents' heat capacity on the air node.

There are no systems and no controls.

## What the investigation found (17 Nov)

1. **EnergyPlus.** A sealed suspended ceiling keeps 70–78 % of an exposed slab's benefit. Carpet keeps 85–95 %. Both together keep about 50 %. Linzie's view is right.
2. **The hourly engine** builds the layers in order and agrees with EnergyPlus (matched coefficients) within about 1 % on cooling and 0.1–0.4 K on the hottest hour.
3. **The air node.** Every document puts 250 kJ/K per m² of floor on the air node: today's tool's `TUNE_INTERNAL_MASS`, carried as `TODAY.internal_heat_capacity_j_per_k_m2`. The EnergyPlus referees 104–120 were given the same figure, so they could not catch it. It hides the finishes. In San Francisco weather it gives 0 h over 28 °C, against EnergyPlus's 40–446 h, and in Chicago weather it puts heating 40–50 % low.
4. **The monthly estimate** counts each face's mass only up to the first insulating layer. That makes carpet plus a ceiling void "no mass".
5. **The workspace** draws one storey (roof and ground floor). There are no finishes and no suspended-ceiling construction.

## Decisions

- **D1. Contents.** 10,000 J/K per m² of floor for the air and furniture: BS EN ISO 52016-1:2017 Table B.17's suggested default. UK HEM-TP-07 §2 (v2.0, Oct 2025) uses the same value and cites the same table. The source is printed where the figure is shown. The drawn fabric carries everything else.
- **D2. Old documents.** A zone holding exactly 250,000 (today's constant, never a user's figure) is upgraded to 10,000, and the upgrade says so in a note. Any other value stays as stated.
- **D3. Finishes** are separate from the structure. A surface may name an inside finish, and its layers are added on the room's face:
  - Floors: `carpet` (carpet and underlay, R ≈ 0.17) or `hard` (no extra layer).
  - Ceilings: `suspended` (sealed void R 0.18, ISO 6946 unventilated air space, plus a 15 mm mineral-fibre tile) or `exposed`.

  A stated U stays the structure's U. The finish adds its resistance on top.
- **D4. Defaults** come from the space templates (Linzie 16:35):
  - Offices, meeting rooms, classrooms and hotel bedrooms: carpet, suspended ceiling.
  - Halls, kitchens, WCs, plant and stores: hard floor, exposed ceiling.

  The user changes either on Fabric (P4).
- **D5. Monthly estimate.** The effective capacity follows ISO 13786:2017's periodic (24 h) method: each face's areal heat capacity κ comes from the whole layer stack, so a finish reduces it partly, not to zero. Gate (fixed before any run):
  - Heating within ±10 % of the hourly engine on the Brief 122 referee buildings.
  - The finish cases in the same order as EnergyPlus for cooling.

  If the periodic method fails the first gate, the simplified (10 cm) method is kept, with the finish's resistance applied as a partial cut-off, and the result is recorded. No constant is tuned.

## Parts

- **P1 (engine).** Contents at 10,000 J/K·m² (D1, D2): `TODAY` is split into `LEGACY_CONTENTS` and `CONTENTS_ISO52016`, the converter and `toDocument` write the new value, and the upgrade applies D2.
  - Tests: the mass test room with the app's own contents now matches EnergyPlus given the same contents.
  - Commit: "Brief 124 P1: contents 10 kJ/K·m² (ISO 52016-1 Table B.17), the fabric carries the mass".
- **P2 (engine).** Finish layers (D3): `surfaces[].inside_finish` (schema 2.12), with the layers added in `model.ts` on the zone_a face (and on the zone_b face for `inside_finish_b`) before the elements are built.
  - Referee: the four finish cases built with finishes give the same results as the hand-layered constructions.
- **P3 (referee and anchor).**
  - Rerun `validation/energyplus/mass_finishes.py` with the contents included on both sides.
  - Rerun the 104/105/109 referees whose documents carried 250 kJ/K·m², with 10 kJ/K·m² on both sides.
  - Report Bridgewater v2 before and after.
  - Write it all up in `docs/audit/124/`.
- **P4 (editor).**
  - Floor finish and ceiling choice on the space templates (D4), pre-filled and editable on Fabric.
  - Written to `inside_finish` in `toDocument`.
  - The words "Carpet / Hard floor" and "Suspended ceiling / Exposed soffit", with an ⓘ citing the numbers from the investigation.
- **P5 (engine).** Monthly κ after ISO 13786 (D5), the referee and the close.

## Later (not this brief)

- Several storeys in the workspace, with slabs between them. This is needed before a concrete frame's middle floors can be drawn. It is an editor brief of its own.
- Raised floors, open-cell ceilings and a void used as a return-air plenum (these couple the slab more than a sealed void).
