# Brief 110 P5 — Close

15 Nov 2026, editor thread. Branch `sim2/110-model-workspace`.

## Walkthrough (1440×900, `shots/`)

The checks used the two-zone fixture (`sim2/geometry/__fixtures__/two_zones.plan.json`) with two 500 W radiators per room and
45/40 °C on the heating system. The weather was a public EnergyPlus test file (Chicago), which is not committed. Every
number on these screens is a run's.

| Shot | What it shows |
|---|---|
| `00_empty.png` | `/model` before a plan is loaded. There are no numbers, and the strip waits for weather. |
| `01_site.png`, `01b_site_weather.png` | Site: exposure and the weather picker. After a file is chosen, the strip fills in. |
| `02_shape.png` | Shape (Outline and Rooms) in the centre Drawing tab. |
| `03_fabric.png` | Fabric: choose on the left, give on the right, apply. |
| `04_spaces.png`, `05_systems.png` | Spaces and Systems steps. |
| `06_check.png`, `07_interventions.png` | Steps 6 and 7 are empty states that link to today's pages. The editor stays mounted behind them. |
| `08_heat_flow.png` | The Heat flow tab: totals, energy used, by zone, and the building's balance. |
| `09_emitters.png` | Emitter sizing under Energy used (Brief 108 P5, placed here). Both zones are short at 45/40 °C. |

## Verification

- **Save, reload and rerun give identical results.** In the browser, the plan was read out as JSON, the page was
  reloaded, and the plan was loaded back in. The document was identical (11,914 characters). The strip was identical.
  The Heat flow tab was identical except for one figure, "Ran in 314 ms" against "359 ms". The database save path was
  checked on NZA Sim (dev) at P4. A save read back with its document and Plan intact. A second save made a child
  version with the same model hash. A magic link cannot be signed in from here, so the browser save button itself was
  not pressed. Signed out, the button says saving needs NZA Sim sign-in.
- **No number appears unless a run produced it.** Steps 6 and 7 show no numbers. Before weather is chosen, the strip
  and the Heat flow tab say they are waiting.
- **Today's tool is unchanged.** Every file this brief changed, outside merges, is under `frontend/src/sim2/`, apart
  from:
  - `App.jsx`: one route.
  - `Sidebar.jsx`: one entry.
  - `thermal/store/versions.ts`: additive. The building thread agreed to it, the model hash stays document-only, and
    the store tests pass.
  - `supabase/migrations/0008_editor_plan.sql`.
  - The docs and STATUS.

  Nothing under `utils/`, `components/modules/` or the backend changed.
- **Anchor 133.2: not run here.** `_brief93_anchor.mjs --fixture` needs the Yeovilton EPW from `data/weather/current/`.
  That file is local only, and this container cannot download it (climate.onebuilding.org is blocked by the network
  policy). Because no engine file changed, the anchor cannot have moved. It still needs re-running on IT15 at merge.
- **Today's Building page here.** It shows an error card in this container: `potsdamer_platz_1k.hdr: Failed to fetch`,
  and the project bootstrap returns HTTP 500 with no backend. That is this container's blocked network and missing
  backend, not this brief, which did not touch Building. No screenshot is kept, because it would mislead.

## Not done in this brief

- `/sim2/geometry` still renders the floating editor. It is kept for the standalone preview and has not been
  redirected to `/model`.
- Brief 111 P3–P4 (the "Results include" switch and the heat flow view by level) are next, on this branch.
