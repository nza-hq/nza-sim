# Brief 118: Simulate v2, the left navigator, templates first, and systems that own their emitters

Written 16 Nov 2026 by the editor thread, from Linzie's message at 11:11 while using the preview. Owner: the editor
thread. Branch: `sim2/118-navigator`, from `sim2/110b-carry-over` (PR #38) until that merges.

## What Linzie asked for (11:11, in her words where it matters)

- "I think we could create the zones on the left and apply them on the right."
- "We have navigation on the left and then the passport, the detail, on the right." A zone or area selector on the left,
  and a fabric selector too: "we've got external wall type 1, 2, 3, 4, 5 on the left, and then we can select that,
  and then we see which rooms it applies to. On the right, we can see the detail."
- Navigate by anything, as IES does: "I could select all of the VRF systems and then change them to boilers."
  "Click on Room 5, and it shows Room 5." Ventilation too.
- Templates: "there should just be a dropdown: it's kind of existing building, type 1. Bang, apply it everywhere."
  A school building "would already have the school template applied to it". "I want everything pre-populated",
  including flow and return; standard units ("a 3 kW, 5 kW") to choose from.
- Emitters belong to a system: boilers connect to emitter type X; VRF heating and cooling to emitter type 2. Cooling
  has emitters too.
- Profiles get the whole middle as the profile editor, not the drawing. Spaces is where profiles are applied.
- Names of things are editable.

## Scope (CLAUDE.md process rule 10)

UI and plan, in `frontend/src/sim2/geometry`, `sim2/workspace` and `sim2/library`. It changes where the editor's
choices live and how they are made, not any calculation. Templates are library items (rule 3: the library is the
source of truth for inputs), each filled value is marked as coming from its template until changed, and nothing is
filled silently. No engine change; anchor 133.2.

The plan already holds project types (fabric, space, system, emitter). Templates are bundles of those. The document
the engine reads does not change shape, except Part 4 (systems own emitters), which needs the building thread's
agreement on the schema and lands under its rules.

## Overlaps to settle with other briefs

- Brief 112 (Spaces = demand, Systems = energy) moves fields between Spaces and Systems. The navigator lists whatever
  those steps hold, so 112's field moves are not blocked by this brief and do not block it.
- Brief 117 (design heat loss) adds a mode to the emitter panel. Part 4 here moves that panel under the system. Agree
  the order with 117's owner before Part 4.
- Brief 114 (Controls) adds a step; the navigator gets a Controls entry when it exists.

## Parts

- **P0:** a clickable mock-up of the new left and right at 1440×900 (navigator on Fabric and on Systems), shown to Linzie
  before building. Commit the brief.
- **P1, the navigator:** a "Navigate by" switch at the top of the left pane: Rooms and zones, Fabric, Profiles, Spaces,
  Systems, Ventilation. Each lists its project items with the rooms each one reaches; choosing an item selects and
  highlights those rooms on the drawing, and opens the item's passport on the right. Select-all on an item, then pick
  another item on the right and preview and Apply (the existing preview-then-apply). Clicking a room anywhere shows it.
- **P2, making things on the left, and names:** "+ Zone", "+ Wall type" (or the item for the current view) on the left;
  rename by clicking a name, in the list and in the passport. Zones stop being made from the right.
- **P3, templates first, fabric first:** a building-level template for each step (fabric: construction sets such as
  "Existing, type 1"; spaces and profiles: building use such as School). Choosing one fills every element in one go;
  a zone or room can override, and the passport shows "from template" or "changed here". The template figures go into
  the library as items Chris checks (`docs/audit/102/library_additions.json`, as before), and the UI says
  "to be checked" until he has.
- **P4, systems own their emitters:** a heating or cooling system lists its emitter types (radiator type X; VRF indoor
  units for heating and cooling) and the count per room; standard sizes (indoor units 2.2–7.1 kW, radiator sizes) come
  from library items; flow and return filled from the system template. Needs the building thread's schema agreement.
- **P5, profiles take the middle:** on the Profiles step the centre is today's profile editor (`SchedulePopout`'s
  editor, by import), not the drawing. Needs project-owned profiles in the document (building thread).
- **P6:** close: screenshots at 1440×900, Linzie walks it.

## What MUST NOT happen

- No value filled without a visible source (template name or library item). No hidden defaults.
- No copies of today's components. No engine changes.
- Template figures not shown as checked until Chris has checked them.
