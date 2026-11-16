# Brief 110b P0 — what Brief 110 already carries over from today's NZA Sim

16 Nov 2026, editor thread, on `sim2/110-model-workspace` at 756d7c2. Each row of the brief's table is marked
**done**, **partial** or **to do**. This part changed no code. Every component named below was found in the tree
(paths as found, some differ from the brief's shorthand).

| # | Today | /model now | Mark | Part |
|---|---|---|---|---|
| 1 | Sidebar order, accent per module (`data/moduleThemes.js`) | The rail follows the build order (Site to Interventions). The accent colours are not used. | partial | P3 |
| 2 | TopBar: project, save status, scenarios, Per m² / Total, Pop Out, org | `/model` is inside AppShell, so the bar is there. The strip and the Heat flow tab ignore the Per m² / Total switch, and Pop Out does not show Model results. The plan's save status sits at the top of the left pane. | partial | P3 |
| 3 | Centre tabs: Heat Balance, Sankey, Profiles, Schedule, Monthly, Summary; Monthly on every step | The tabs are Drawing and Heat flow only. | partial | P1 (with 111 P3–P4) |
| 4 | One `HeatBalance` (`components/modules/balance/HeatBalance.jsx`) with a `modules` filter | Heat flow draws its own balance table (`sim2/run/ResultsPanel.tsx`) and does not feed `HeatBalance`. | to do | P1 |
| 5 | `shared/LiveResultsStrip.jsx` | `/model` has its own strip (`ResultsStrip`) showing heating, cooling and energy used. | partial (own component, to be replaced) | P1 |
| 6 | Pablo chart pattern: `chart/ChartContainer`, `ZoomNav`, `MonthJumpButtons`, `DataCard` | There are no charts in the centre yet. | to do | P1 |
| 7 | `shared/SchedulePopout`, `modules/gains/MiniProfile.jsx` | The Spaces card shows borrowed profiles with its own small day charts (`sim2/geometry/Spark.tsx`), which is a second drawing of what `MiniProfile` does. There is no schedule pop-out. | partial (Spark to be replaced by `MiniProfile`) | P2 |
| 8 | `shared/ComfortDemandCard.jsx`: comfort band inline with the demand | Setpoints are on the space type card. There is no inline comfort next to the demand; the Fabric only temperature comes with 111. | to do | P2 (with 111) |
| 9 | `library/ConstructionInspector.jsx`, `GlazingInspector.jsx` | The give panel names the construction and its U-value, but there is no inspector. | to do | P2 |
| 10 | 3D viewer | Plan, 3D and Elevation are in the Drawing tab, and the right column holds the settings. | done | — |
| 11 | Interventions views | Step 7 is an empty state linking to today's Interventions page. | to do (separate brief) | — |
| 12 | Reports, Consumption, Weather, Overview | The shelf links to Profiles, Library and Reports, and step 6 links to Consumption. Site has the weather file, but no weather charts. | partial | P3 |
| 13 | Density and layout rules | Columns are resizable and remembered, empty states replace defaults, and diagnostics are behind ⓘ. The Heat flow tab is full width (not about 900–1000 px), and chart titles do not apply yet. | partial | P3 |
| 14 | Fast engine or EnergyPlus switch in each view header | No switch. It stays hidden until the document-to-EnergyPlus writer exists. | to do (hidden, not faked) | later |

**Deviation, recorded as `ui_principles.md` asks:** left is choose, right is give with Apply (Linzie, 15 Nov 21:02).
3D sits in Drawing; the live strip sits at the top of the centre.

**One fix since the 110 close (756d7c2):** with an empty project, Fabric, Spaces and Systems used to bounce back to Shape.
Linzie found the preview "not clickable". Each of those steps now opens, says what it needs, and offers "Start from an
example".

**Order of work:**
- P1, with 111 P3–P4: centre tabs, `HeatBalance` fed by the level runs, `LiveResultsStrip`, and Monthly.
- P2: `MiniProfile` instead of Spark, `SchedulePopout`, the inspectors, and inline comfort.
- P3: Per m² / Total, Pop Out, accents, density, and the close screenshots beside today's pages.

**What P1 needs to check:** whether `HeatBalance` and `LiveResultsStrip` can take v2 results through a new prop without
changing today's behaviour. If either needs more than an added prop, stop and say so.
