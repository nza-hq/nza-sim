# Brief 111: Simulate v2, "Results include" levels and the heat flow view

Written 15 Nov 2026 by the journey-planning thread, approved in principle by Linzie on 15 Nov 21:53 ("Just crack
on"). The plan is at https://claude.ai/artifact/65tbUSdtuUnMaSigTUS5UK. It follows Brief 110, the Model workspace.

**Owners:** Parts 1 and 2 belong to the building thread (`thermal/` and `sim2/run/`). Parts 3 and 4 belong to the
editor thread (the workspace's centre and top bar).
**Order:** the building thread suggested (15 Nov 21:51) that Part 1 is a seam change only. I recommend doing
Parts 1 and 2 straight after Brief 107 closes, because together with 110 they give Linzie her first playable
version. The building thread decides where it falls against 108.

## Why

Linzie learns a building in layers. First she looks at fabric and geometry alone, heated to 21 °C, and asks where
the heat goes, how much solar comes in, and what moving a window does. Then she adds people and gains. Then she
adds systems through to energy. A switch called "Results include" lets her see any layer on its own at any step:
**Fabric only / + Spaces / + Systems**.

## Scope statement (CLAUDE.md process rule 10)

- **Fabric only** is exactly the Building module's State 1 envelope scope: conduction, glazing, bridging, solar,
  q50 infiltration and permanent vents, against a stated comfort setpoint. It has no occupancy, lighting,
  equipment, mechanical ventilation, emitters or systems.
- **+ Spaces** adds the Operation and Internal Gains scope: gains and each space type's own setpoints. It has no
  systems.
- **+ Systems** is today's full v2 run (Briefs 107 and 108).
- Touches: `sim2/run/` (the seam) and the workspace's centre views. No engine physics change. The anchor stays
  at 133.2.

## Rule 8 (suppression removes, it does not mute)

Each level builds a **run copy** of the document with the objects removed. It never zeroes schedules, widens
setpoints or disables availabilities:
- **Fabric only:** gain profiles are removed; mechanical ventilation entries are removed (q50 infiltration and
  permanent vents stay, because they are envelope); emitters and systems are removed; cooling is absent. Every zone
  is heated to a stated setpoint, 21 °C by default, and the setpoint is shown and editable in the top bar.
- **+ Spaces:** systems and emitters are removed, and space types' setpoints and gains apply.
- **+ Systems:** the document as it is.

## Parts

### Part 0: Reconnaissance. `docs/audit/111/00_reconnaissance.md`
Find which document fields each level removes, where the seam builds its run, and how Brief 106's per-zone
breakdown carries through each level.

### Part 1: Levels in the seam. Commit: "111 P1: simulate(doc, { level }) with run copies"
- `simulate(doc, { weather, level: 'fabric' | 'spaces' | 'systems' })`. Each level returns the same result shape,
  with a per-zone breakdown.
- Tests: the run copy for `fabric` contains no gain, ventilation, emitter or system objects. Breakdown lines sum
  to demand, integrand against display (Rule 9). `systems` is identical to today's run.

### Part 2: EnergyPlus check of Fabric only. Commit: "111 P2: Fabric only against EnergyPlus"
- Run Fabric only on the two-zone fixture and on Bridgewater (five storeys), against EnergyPlus set up the same
  way: ideal loads heating only at 21 °C, no gains and no mechanical ventilation. Use the existing tolerance table
  (±10 % building, per-zone stated).
- Attribute any miss with instrumentation (CLAUDE.md rules 10 and 13). Do not tune.

### Part 3: The heat flow view. Commit: "111 P3: heat flow in the centre, by building, zone or room"
- The centre **Heat flow** tab: where heat goes (walls, windows, roof, floor, air leakage, bridges, to and from
  other rooms) and where it comes from (solar, gains, heating), then energy used at + Systems.
- Reuse today's `balance/HeatBalance.jsx` and `BalanceSankey.jsx` where they fit. The view follows the left-hand
  choice.
- Show solar by window orientation, so moving a window shows its effect.

### Part 4: The switch. Commit: "111 P4: Results include switch and step defaults"
- The switch sits in the workspace top bar. Each step opens at its natural level (Fabric opens at Fabric only,
  Spaces at + Spaces, Systems onward at + Systems), and Linzie can change it at any time.
- The strip states the level in words, for example "Fabric only: every room heated to 21 °C, no people, no
  cooling".

### Part 5: Independent review and close
Review for tuning and Rule 8 and Rule 9 compliance. Then update STATUS.md, archive the brief, and open a PR.
Merging needs Linzie's word.

## What MUST NOT happen
- No level made by muting. No hidden default setpoint (21 °C is shown). No number without a run.
- No change to today's modules or engines.
