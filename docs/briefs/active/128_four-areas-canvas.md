# Brief 128 — Four areas and the building canvas

**Requested:** Linzie, 25 Nov 2026 10:11 ("four areas is right … don't take the prototype's full look … NZA Sim"), from the
ChatGPT/Codex design review (comparison page https://claude.ai/artifact/6qe5NP5izezEzXaLLa8K17, handoff
`/mnt/project-files/nza-sim/next/chatgpt_handoff.txt`). Builds on Brief/PR #79 (phase 1 clean-up).

**Scope (CLAUDE.md process rule 10):** UI only, Simulate v2 workspace (`frontend/src/sim2/workspace`, `sim2/geometry`
panels, `sim2/run` result views) and the sidebar. No engine, schema, library or result-reader change; the Plan format is
unchanged, so saved models open as before. Today's look (tokens) is kept; the prototype is a design reference only.

## BEFORE DOING ANYTHING
- Read CLAUDE.md, STATUS.md, this brief. Branch `sim2/four-areas` off `sim2/phase1-cleanup`.

## Parts
1. **Four areas.** Sidebar: Projects · Site · Building · Library · Results · (NZA library link). Building is one entry; its
   five views (Shape, Fabric, Spaces, Systems, Controls) are a view switch at the top of the canvas. Library opens the
   project's profiles (today's Profiles step) and links to the NZA library. Results is a new step `results`.
   Addresses `?step=` keep working. Files: `workspace/steps.ts`, `components/layout/Sidebar.jsx`, `workspace/ModelWorkspace.tsx`.
2. **Results area.** Whole model (systems level): Heat flow, Monthly, Load profiles, Explore, from the same run
   (`run/EmbeddedResults.tsx`, `workspace/layout.ts STEP_TABS`). Building views keep Drawing, Heat flow, Monthly at their
   own level; Load profiles and Explore live in Results.
3. **Group by.** The left list's icon tabs become one "Group by" list (`geometry/ApplyPanels.tsx ChooseList`).
4. **Selection bar.** "N rooms chosen · Apply … · Edit · Clear" (Apply kept: Linzie's own word, 17 Nov "just Apply") (`ApplyPanels.tsx GivePanel` bar); Edit opens the details.
5. **Details over the drawing.** The details panel overlays the canvas edge instead of narrowing it (`ModelWorkspace.tsx`).
6. **Floors apart in 3D.** A "Floors apart" view lifts each floor so every floor's rooms show (`geometry/Plan3D.tsx`).

## Verification
`vitest run` (all), `npm run build`, browser on the clubhouse at 1280×800 and 1440×900: each area, each Building view,
Group by, Assign/Edit/Clear, details overlay, floors apart. STATUS.md updated in the same commit.

## Deliverables
PR on `sim2/phase1-cleanup`; preview page for Linzie; STATUS.md entry.
