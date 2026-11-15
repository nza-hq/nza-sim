# Brief 110: Simulate v2, the Model workspace inside NZA Sim

Written 15 Nov 2026 by the journey-planning thread. Plan: https://claude.ai/artifact/65tbUSdtuUnMaSigTUS5UK
(source `/mnt/project-files/nza-sim/journey/workspace_journey.html`).

Linzie, 15 Nov 21:53: "this looks good, and the seven steps work. The visual in the middle is right … this is
more of an analytics tool, so the main window is the key thing here … follow how we've built NZA Sim here,
please. I'll take your view on how we build it. Just crack on."

**Owner:** the editor thread (it owns `frontend/src/sim2/geometry` and `sim2/library`). The building thread owns
`frontend/src/thermal/` and `sim2/run/`, and its one mount line, as in Brief 105.
**Branch:** `sim2/110-model-workspace`, cut from `main` after `sim2/geometry-prototype` is merged, or stacked on it
if that branch is not yet merged (say which in P0).
**Next brief:** 111, the "Results include" switch and the heat flow view (`/mnt/project-files/nza-sim/111/`).
The meter check moves to 112 or later, with the building thread's agreement (15 Nov 21:51).

## BEFORE DOING ANYTHING

1. Read CLAUDE.md, STATUS.md (top three briefs), this brief, and the plan page above.
2. Read `frontend/src/components/modules/building/BuildingDefinition.jsx`, which is today's three-column workspace:
   `ResizeHandle`, `CENTRE_TABS`, and layout persisted to localStorage. "Follow how we've built NZA Sim" means
   reusing these patterns, not inventing new chrome.
3. Read `frontend/src/sim2/geometry/GeometryLab.tsx`, `ApplyPanels.tsx` and `sim2/run/ResultsPanel.tsx` on the
   editor branch.
4. Read `supabase/migrations/0002_model_store.sql` and `0005_store_fixes.sql`, which hold model versions,
   `create_model_version` and the hashes.
5. Confirm that today's tool runs unchanged: `_brief93_anchor.mjs --fixture` gives 133.2.

## Scope statement (CLAUDE.md process rule 10)

- **Touches:** `frontend/src/sim2/`; `frontend/src/App.jsx` (one route); `frontend/src/components/layout/Sidebar.jsx`
  (one entry). CLAUDE.md lists the sidebar and routing under "What not to touch unless the brief explicitly says
  to", and this brief explicitly says to add one route and one entry, nothing else.
- **Does not touch:** today's Building, Internal Gains, Operation, Systems, Interventions or Results modules, or
  any of their engines (`instantCalc.js`, `systemsEngine.js`, `interventionsEngine.js`, `nza_engine/` and the rest).
  It does not touch `frontend/src/thermal/` (the building thread's).
- **Module scopes:** this brief adds no physics. The steps write the model document only. Fabric stays within
  Building's envelope scope, Spaces within Operation and Internal Gains, and Systems within Systems.
- No engine change, and the anchor stays at 133.2.

## The design (agreed with Linzie)

- **Seven steps on a rail:** 1 Site, 2 Shape, 3 Fabric, 4 Spaces, 5 Systems, 6 Check, 7 Interventions.
  The shelf sits below the steps: Profiles, Library, Reports. In this brief, steps 6 and 7 show an empty state
  that names what will come and links to today's Consumption and Interventions pages. They show no numbers
  (CLAUDE.md rule 2).
- **Left is choose:** the rail, then the whole building, zones and rooms. Ctrl or Shift adds to the choice, and Esc
  lets go. You can also choose on the drawing, as the editor does now.
- **Middle is see.** This is the main window. A results strip sits at the top. Below it is a centre tab switcher
  that follows Building's `CENTRE_TABS` pattern: **Drawing** and **Heat flow** in this brief. Brief 111 adds the
  levels and the fuller views.
- **Right is give:** the kind icons, the project's types (new, copy, change), the detail, and **Apply to chosen**
  and **Apply to whole building**.
- Columns resize with today's `ResizeHandle` and are remembered the way Building remembers them.

## Parts

### Part 0: Reconnaissance (read-only). `docs/audit/110/00_reconnaissance.md`
- Map what moves from `GeometryLab` into the shell and what stays shared.
- Map today's patterns being reused: ResizeHandle, centre tabs, layout persistence, and how AppShell and the TopBar
  sit around a module.
- **Decision to flag:** where the editor's Plan (the drawing, types and choices) lives when saved. The options are
  (a) beside the model document in the same `model_versions` row (a new column, so a migration), or (b) inside the
  document under an extension key the engine ignores. Hashing must stay honest: the model hash covers what the
  engine reads. Recommend one option, and say whether a migration is needed.

### Part 1: The shell. Commit: "110 P1: Model workspace shell, step rail and three panes"
- Add route `/model` inside AppShell and the sidebar entry "Model (new)" in the inputs group. Today's entries are
  unchanged.
- Add the step rail, the three resizable panes, and the centre tab switcher. Add the empty states for steps 6 and 7.
- Verify: build clean; at 1440×900 the rail, panes and resizing work; every other page is unchanged.

### Part 2: The steps move in. Commit: "110 P2: Site, Shape, Fabric, Spaces, Systems in the workspace"
- Shape, Fabric, Spaces and Systems mount from the editor's components, with the same select-then-apply behaviour,
  presets and borrowing as on the prototype branch.
- **Site** reuses `sim2/run/weather.ts` (local EPW or the organisation's bucket), plus site exposure.
- `/sim2/geometry` keeps working until close, then redirects to `/model`.
- Verify: draw the two-zone fixture end to end in the workspace, and confirm the document matches
  `__fixtures__/two_zones.plan.json`'s output byte for byte.

### Part 3: Results in the middle. Commit: "110 P3: results strip and Heat flow tab in the centre"
- Mount the building thread's results (today's `ResultsPanel` content) as the centre **Heat flow** tab, with the
  strip above it. The heat flow follows the left-hand choice: the whole building, a zone, or a room
  (Brief 106 breakdown).
- The strip is no longer a closed side tab. It is always visible and updates after each Apply.
- Verify: change a wall type and see heating change within about 0.5 s. Every line of the breakdown sums to the
  total (Rule 9: integrand against display, as the building thread's tests already check).

### Part 4: Save and reload. Commit: "110 P4: plans save as model versions and reload"
- Save writes a model version for a building in a project (`create_model_version`, `parent_id` chain), using the
  P0 decision. Reload opens the latest version, and the TopBar shows saved or changed.
- If a migration is needed: apply it on NZA Sim (dev) only, through the Supabase connector, with a read-back.
  Never touch decodED's databases.
- Verify: save, reload in a fresh tab, and get the same drawing, document hash and results. A second save makes a
  child version.

### Part 5: Close. Commit: "110 P5: close"
- Do a browser walkthrough at 1440×900 with screenshots in `docs/audit/110/`, and update STATUS.md.
- Move the brief to `archive/110_model-workspace_COMPLETED.md` and open a PR. Merging it needs Linzie's word.
- Update the editor preview so Linzie can click through it.

## Verification (falsifiable)
- Today's pages render as before. The anchor gives 133.2.
- A plan drawn in `/model` saves, reloads and reruns to identical results.
- No number appears anywhere unless a run produced it.

## What MUST NOT happen
- No change to today's modules or engines, no new physics, and no fake or placeholder results.
- No writes to NZA Decoded or NZA Decoded Test.
- No terminal or token steps for Linzie.

## When to escalate
- If P0's storage decision needs a schema change that alters the model hash, stop and report before P4.
- If moving the editor needs a change in `thermal/` or `sim2/run/`, ask the building thread. Do not edit its files.
