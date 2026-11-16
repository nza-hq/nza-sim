# Brief 110b: Simulate v2, carry today's NZA Sim navigation and detail into the Model workspace

Written 16 Nov 2026 00:0x by the journey-planning thread. Linzie asked on 15 Nov at 23:57: "Have you looked at how
NZA Sim currently works in terms of navigation, detail, and everything else? I want to not just forget all the good
work we've done there."

**Owner:** the editor thread, on the Brief 110 branch. Work it in alongside Brief 111 Parts 3 and 4, which cover the
same centre views.

**Sources read:**
- `docs/ui_principles.md` (v1.0, Chris)
- `docs/briefs/archive/28im_intervention_model_COMPLETED.md` §2 (three-column rule, view switcher, module
  ownership, Monthly everywhere)
- `docs/ux_audit_2026_05.md`
- `docs/audit/87_interventions_ux_rework.md`
- `BuildingDefinition.jsx`, `InternalGainsModule.jsx`, `SystemsModule.jsx`, `IMResultsModule.jsx`, `TopBar.jsx`,
  `Sidebar.jsx` and `LiveResultsStrip.jsx`

## Scope statement

UI only, in `frontend/src/sim2/` and the `/model` route. It reuses today's shared components by import and does not
fork or change them. It makes no engine change and does not touch today's modules. The anchor stays at 133.2.

## What today's NZA Sim does well, and where each piece lands in /model

| # | Today | Where it lives today | In /model |
|---|---|---|---|
| 1 | Sidebar order that builds the model in layers, with an accent colour per module | `Sidebar.jsx`, `data/moduleThemes.js` | The step rail uses the same order idea and the same accents: Fabric uses Building's #A1887F, Spaces uses Internal Gains' #EA580C, and Systems uses #00AEEF. |
| 2 | Top bar with project picker, save status, Scenarios (Model 1, Model 2), Baseline, the Per m² / Total switch, the Pop Out results window for a second screen, and the org badge | `TopBar.jsx` | Unchanged: `/model` sits inside AppShell, so it gets the same bar. Every figure in `/model` must honour the Per m² / Total switch, and Pop Out must show the Model results. |
| 3 | Centre view switcher with the standard tabs: Heat Balance, Sankey, Profiles, Schedule, Monthly, Summary (only those that apply) | 28-IM §2.2; Building `CENTRE_TABS` | The centre tabs become Drawing (plan and 3D) plus the standard set. **Monthly appears on every step** (28-IM §2.7). |
| 4 | One `HeatBalance` component with Sankey, Rows and Stacked layouts and a `modules` filter that shows only what a module owns | `balance/HeatBalance.jsx`, 28-IM §2.5 | The "Results include" levels are this same idea: Fabric only is Building's modules list, + Spaces adds internal gains, and + Systems adds mechanical ventilation. Feed the v2 results into `HeatBalance` and do not draw a new chart. |
| 5 | An always-visible strip of four live figures | `shared/LiveResultsStrip.jsx` | The results strip at the top of the centre is this component, with four items per step as in each module today. |
| 6 | The chart-and-stats pattern from Pablo: chart left, stats right, zoom above, month buttons below, bounded chart heights | `chart/ChartContainer`, `ZoomNav`, `MonthJumpButtons`, `DataCard`; `ui_principles.md` | Profiles and Monthly use these components as they are. |
| 7 | Schedule editor pop-out (drag-paint, annual heatmap, exceptions) and mini profiles shown inline | `shared/SchedulePopout`, `scheduleEditor/`, `gains/MiniProfile.jsx` | The Profiles shelf and the space type card open the same pop-out, and the space type card shows `MiniProfile` beside each borrowed profile. |
| 8 | Comfort band edited inline next to the demand it drives | `ComfortDemandCard.jsx`, ui_principles | The Fabric only "heated to 21 °C" setpoint is edited the same way, inline with the demand figures, never hidden. |
| 9 | Library inspectors that show a construction's layers and glazing optics | `library/ConstructionInspector.jsx`, `GlazingInspector.jsx` | An (i) next to each type in the right-hand give panel opens the same inspector. |
| 10 | Building 3D viewer | `building/BuildingViewer3D.jsx` | Today it sits in the right column. In /model it is part of the Drawing tab (the editor's `Plan3D`), so the right column can hold the settings. |
| 11 | Interventions: Library and Strategy split, stack with enable and reorder, editor pop-out, Waterfall, Isolated, Calc trail, Sankey, Heat balance compare, then Roadmap and CRREM | `interventions/`, audit 87 | Step 7 keeps all of these views. Only the target changes: patches apply to the model document instead of the old building config (separate brief). |
| 12 | Results reports: Energy, Carbon, Monthly, Summary at full width; Consumption manager; Weather charts; Overview checklist | `IMResultsModule.jsx`, `consumption/`, `WeatherModule.jsx`, `InformationModule.jsx` | These stay on the shelf as Reports, Check (Consumption) and Site (Weather charts), and are reused as they are. |
| 13 | Density and layout rules: compact text, related figures in one card, centre content about 900–1000 px wide (charts full width), resizable and remembered columns, chart titles with units and GIA, empty states instead of defaults, diagnostics behind an (i), plain words instead of "State 1" or "free-running" | `ui_principles.md`, 28-IM §2.3, UX audit D4 | They apply to every pane in /model. Check them in the close screenshots. |
| 14 | The "see the workings" principle: each view can switch between the fast engine and EnergyPlus | 28-IM §2.4 | Keep the switch's place in each view header. It goes live once the document-to-EnergyPlus writer exists, which the building thread proposed and the plan now places before the meter check. Until then it is hidden, not faked. |

## The one deliberate difference

Today's rule (28-IM §2.1) is: left for inputs, centre for the main view, right for the 3D and the live results.
In /model the left is what you choose (whole building, zones, rooms) and the right is what you give it, with Apply.
Linzie asked for that on 15 Nov at 21:02, because multi-room work needs a choice list and multi-select. The centre is
unchanged as the main window. The 3D moves into the Drawing tab and the live strip moves to the top of the centre.
Record this as a deviation in the close report, as `ui_principles.md` asks.

## Parts

- **P0:** check what Brief 110 already does against the table, and mark each row done, partial or to do in
  `docs/audit/110b/00_check.md`.
- **P1:** rows 3–6 (centre tabs, HeatBalance with levels, live strip, Pablo chart pattern). Do this together with
  Brief 111 Parts 3 and 4.
- **P2:** rows 7–9 (schedule pop-out and mini profiles, inline comfort setpoint, inspectors).
- **P3:** rows 2 and 13 (top bar switches honoured, Pop Out, density check). Then close with screenshots at
  1440×900 next to today's Building and Internal Gains pages.

## What MUST NOT happen

- No copies of today's components. Import them, and if one needs a prop to take v2 results, add it without
  changing today's behaviour.
- No number without a run. No hidden defaults.
