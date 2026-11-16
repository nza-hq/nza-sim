# Brief 110 P0 — Reconnaissance

15 Nov 2026, editor thread. This part changed no code.

**Branch.** `sim2/110-model-workspace` is stacked on `sim2/geometry-prototype` at `ba7b58a`, because that branch is not
merged yet. It carries `chris/108-emitters` (which includes 106 and 107) through the merge at `a3a4dbf`.

## 1. What moves, and what stays shared

The editor today is one component, `sim2/geometry/GeometryLab.tsx` (1,908 lines). It is laid out as a full-screen
`position: fixed` canvas (`.gl-root`), with two floating panels over it:
- `.gl-left` holds the step tabs, the Choose list and the model document.
- `.gl-right` holds `ApplyPanels.GivePanel` (the give side).

The drawing centres itself between fixed offsets: `LEFT = 328`, and `RIGHT = 374` while giving.

| Piece | Where it goes in `/model` | Change |
|---|---|---|
| Step tabs (Outline, Rooms, Fabric, Spaces, Systems) | The step rail at the top of the left pane: Site, Shape (Outline and Rooms), Fabric, Spaces, Systems, Check, Interventions. Below it, the shelf: Profiles, Library, Reports. | The rail is a new component; the steps keep their modes. |
| `ChooseList` (whole building, zones, rooms) | The left pane, under the rail. | None. It is already a component. |
| Canvas: plan, 3D and elevation, plus the tool bar, tip and key | The centre pane, under the **Drawing** tab. | The fixed offsets become the pane's own measured box, so the drawing centres in the centre pane. |
| `GivePanel` (kinds, types, detail, Apply) | The right pane. | It is no longer floating. |
| Model document `<details>` | The left pane, at the bottom. | None. |
| `ResultsPanel` (building thread's, floating, starts closed) | The centre **Heat flow** tab, plus the strip above the tabs (P3). | The building thread is asked to add an embedded mode. We do not edit `sim2/run/`. |

The way to keep this small is one change in `GeometryLab`. Take its state and logic as they are, and render its three
parts into three slots the shell supplies (`left`, `centre`, `right`), instead of into fixed positions. Every behaviour
already built stays exactly as it is. That covers select then apply, Ctrl or Shift, Esc, the presets, borrowing and
emitters.

`/sim2/geometry` keeps rendering the floating layout until P5 closes, by passing no slots. It then redirects to
`/model`.

## 2. Today's patterns being reused

- **`ResizeHandle`** (`components/modules/building/BuildingDefinition.jsx` lines 101–131) is a 4 px drag handle that
  calls `onResize(dx)`. It is not exported, and this brief does not touch Building. It is therefore copied, with a
  provenance header, to `sim2/workspace/ResizeHandle.tsx`, behaviour unchanged.
- **Layout persistence** (BuildingDefinition lines 72–93 and 738–747): `{ left, right, centre }` widths are clamped to
  minimums and maximums and saved to `localStorage` under one key. `/model` uses its own key, `nza-model-layout`, with
  the same clamp rule. Defaults: left 300 (220–440), right 380 (320–520).
- **Centre tabs** (BuildingDefinition `CENTRE_TABS`, lines 218–276) are a tab bar with a navy underline and the
  `text-caption` buttons, with the content below. `/model` uses `MODEL_CENTRE_TABS = [Drawing, Heat flow]`, and Brief
  111 adds more.
- **AppShell** (`components/layout/AppShell.jsx`) is Sidebar, then TopBar, then `<main className="flex-1
  overflow-hidden"><Outlet/></main>`. Building fills it with `h-[calc(100vh-3rem)]` (the TopBar is 3rem). `/model`
  does the same.
- **Sidebar** (`components/layout/Sidebar.jsx` line 35 onward): one entry, "Model (new)", is added after Systems in the
  inputs group. The other entries are not changed.
- **Routing** (`App.jsx` line 62 onward): one `<Route path="/model">` is added inside `<AppShell/>`. It is lazy-loaded
  like `/sim2/geometry`, so today's pages do not load the editor's code.

The editor's own styling (`lab.css`, scoped to `.gl-root`) stays scoped to the workspace. Today's Tailwind classes are
used only for the shell chrome (tab bar and handles), so that chrome matches the other pages.

## 3. Decision to flag: where a saved Plan lives

The Plan is the editor's source: blocks, rooms, zones, windows, types, the choices and their names. The model document
is what the engine reads, and it is derived from the Plan by `buildDocument`. A saved version needs both: the document
to run, and the Plan to reopen in the editor.

**(a) Beside the document in the same `model_versions` row.** A new nullable `plan jsonb` column and a `plan_hash`. This
**needs a migration** (`0008_editor_plan.sql`): the column, plus a `create_model_version` that also takes the Plan.
- The model hash still covers exactly the document. The Plan is hashed separately.
- Dedupe moves from "same model hash" to "same model hash and same plan hash". Renaming a fabric type changes the Plan
  but not the document, and should still be a new version, not lost.
- Rows saved before this have a null Plan, and today's tool never reads it.

**(b) Inside the document, under a key the engine ignores.** No migration. But:
- The document schema is `.strict()` (`thermal/schema/model.ts`), so the building thread would have to add the key.
- Every cosmetic edit (a type's name, a choice) would change the model hash, so the run cache would miss on edits the
  engine never sees. That breaks "the model hash covers what the engine reads".

**Recommendation: (a).** It needs one additive migration, applied to NZA Sim (dev) only through the Supabase
connector, with a read-back. It leaves the model hash meaning exactly what it means today, so it does not hit the
brief's stop condition ("a schema change that alters the model hash").

The save client stays the building thread's `thermal/store/versions.ts`. We ask them for a `plan` argument on
`saveModelVersion`, or we add a thin `sim2/workspace/savePlan.ts` that calls the new function itself. The first is
cleaner, so we will ask before P4.

## 4. Where it needs the building thread

1. **P3:** an embedded mode for `ResultsPanel`, laid out in place rather than floating and always open, plus a slim
   strip (heating, cooling, EUI and their state) that it renders above the centre tabs. We do not edit `sim2/run/`.
2. **P4:** a `plan` argument on `saveModelVersion` and a `loadLatestVersion(buildingId)` that returns the document and
   the Plan, or their agreement that we add those in `sim2/`.

Both are asked when P0 lands. P1 and P2 do not wait on them.

## 5. Anchor

Today's tool is untouched by this brief, but P0 cannot run `_brief93_anchor.mjs` against Chris's EnergyPlus here. The
building thread's seam tests, which run in every `vitest` here, include "Bridgewater five storeys: results equal
runModel's", and pass (92 of 92 in `src/sim2`). The 133.2 anchor is re-run at P5 with the fixture, and its output is
quoted.

## 6. Risks

- **The preview.** The standalone preview Linzie clicks through is the editor alone. `/model` sits inside AppShell,
  which needs a project loaded from the local backend. P5's preview will render the workspace with an empty-project
  stub, and will say so on the page.
- **Size.** `GeometryLab` is large. The slot change is mechanical and keeps one component, as briefed: rebuild only if
  the slots fight the fixed-offset maths. The drawing size already comes from a measured box (`size`), so feeding it
  the centre pane's box is the whole change.
