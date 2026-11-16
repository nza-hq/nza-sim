# Brief 120 — Simulate v2: system (plant) capacity limits

**Status:** DRAFT, 16 Nov 2026. Asked for by Linzie (16 Nov 18:42): "We need the capacity, not just of the heat emitters, but also of the system as well." Her message is the go-ahead for the scope change below. Queue: **right after 112, before 114 and 115** (Linzie's choice, 16 Nov 18:43).
**Owner:** the building/engine thread (P0–P5, P7); the editor thread (P6).

## BEFORE DOING ANYTHING

1. Read CLAUDE.md in full, STATUS.md and `docs/briefs/current.md`.
2. Read Briefs 107 (systems), 108 (emitters, the zone cap and its EnergyPlus referee), 109 (hours, quarter-hour steps when a capped zone is heated to hours) and 119 (cooling caps). This brief extends them.
3. Check whether 112 (demand/energy split) has landed. If it has, build on its system shape. If it hasn't, stop and ask, unless Linzie chose "Before 112".
4. Today's engine and the Bridgewater 133.2 anchor are not touched. Simulate v2 only.

## Why

The engine already caps each room at its emitters (Brief 108) and its cooling units (Brief 119). It does not cap the system. `system_groups[].capacity_kw` is stored, and `runSystems` lists it under "not modelled". So the rooms on one boiler can together draw more than the boiler can give, and a year's energy can exceed kW × hours.

The worked example made this plain (`/mnt/project-files/nza-sim/` → the report at https://claude.ai/artifact/8XAsLuLUfAYZTHWMT8vfsv):
- With windows open all winter, the office needed 193 times its normal heating when the heater was unlimited.
- Capped at its radiators' 7.2 kW, the same office needed only about 38 times.

Linzie wants the second kind of answer at every level: room, emitter and plant.

## Scope (CLAUDE.md rule 10)

**Systems module.** This changes the stated scope. Today the Systems scope says "proportional split only (no priority+capacity, no lead/lag)" and lists "Capacity-based … system stacking" as out of scope.

This brief adds one thing: a **capacity limit per system**. A heating or cooling system delivers at most its stated kW in any hour, summed over the rooms it serves. The rooms then float below (or above) their setpoint, and the shortfall is reported.

Still out of scope, until a later brief:
- Lead/lag and sequencing between two systems serving the same room. When two systems share a room, each keeps its share, and each share is capped by its own system's capacity. **Amended by review F1 (Linzie, 16 Nov 19:48, "Yes, the boiler tops up"):** what a short system cannot give in a room is covered by the room's other systems, those with no capacity first and in full, then those with spare capacity in proportion to their shares, up to their spare. Nothing comes first, so this is still not lead/lag; each system has only its capacity.
- Priority or hand-off between systems.
- Part-load efficiency curves.

The P7 close updates the CLAUDE.md Systems scope text, with Linzie's 18:42 message cited.

## Decisions to confirm with Linzie (P0)

1. **How a short system shares out its heat.** Recommended: in proportion to what each room asks for that hour, after its emitter cap. This is a common assumption for a shared flow temperature with balanced valves. The alternative is first come, first served by room order, which nobody can see or reason about. EnergyPlus's plant loop does something close to proportional for a loop with balanced branches. P2 measures how close.
2. **Hot water on the same boiler.** Gas boiler 1 also makes hot water in the example. Options:
   - (a) hot water takes priority, and space heating gets what is left (typical for a system boiler with a diverter or priority valve);
   - (b) hot water has its own stated capacity.
   Recommended: (a), as a stated `dhw_priority` on the system, with "none" allowed.
3. **Documents converted from today's tool already carry `capacity_kw`** (Bridgewater does). Recommended: capacity applies only when it is stated, so Bridgewater's v2 runs change only if its stated kW binds. P3 reports by how much, and the 133.2 anchor (today's engine) is untouched either way.
4. **Cooling.** Same rule for cooling systems, such as a VRF outdoor unit's kW. Recommended: yes, in the same brief, because 119's caps are the room half of it.

**Answers (recorded at review, F2).** Linzie's P0 card was closed as "Yes, all four" on her 19:19 reply, which also added a dedicated water heater with its own kW and storage volume (built: `storage_litres`, `waterHeater`).
- **Decision 1 is overtaken.** The P2 EnergyPlus referee showed that sharing in proportion to ask is wrong for unequal radiators: when a boiler is short the water runs cooler everywhere, and bigger radiators keep more. P2b shares a wet plant that way, through one lowered flow temperature (02_referee.md). Proportional sharing stays only for a plant without wet emitters in every room it serves (and for cooling plants, not refereed: F11). Linzie was told in plain words on 16 Nov. The spec's `about` still describes the old rule; it is left as fixed before the run (its sha is checked by the referee), and this note supersedes it.
- **Decision 2 (a), hot water first:** built; since review F6 the hot water itself is limited to the boiler's capacity, and its shortfall shown.
- **Decision 3, only where stated:** built; Bridgewater states none.
- **Decision 4, cooling too:** built; cooling referee owed (F11).
- **Two systems in one room:** Linzie, 16 Nov 19:48, "Yes, the boiler tops up" (review F1).

## Parts

**P1 — Schema 2.8 and the engine (Engines 1 and 2).**
- `capacity_kw` on heating and cooling system groups moves from "not modelled" to used. Add an optional `dhw_priority` (decision 2).
- Each hour, the zones a system serves solve as now, each capped by its emitters. If their total heat (or cooling) is more than the system's capacity, each zone's limit for that hour becomes its share (decision 1), and the hour is solved again with those limits. Engine 2 solves zones together, so this is one extra solve in the hours where the system is short, not a per-zone patch.
- A system short in an hour where its zones are heated to hours steps in quarter hours, as 109 does for capped zones.
- Nothing is defaulted: a stated `capacity_kw` of 0 or less is refused, with its name.
- Tests:
  - a two-room box on one 2 kW boiler: the year's heating is never more than 2 kW × hours, and unmet hours appear;
  - capacity well above need gives results identical to today;
  - Rule 9: what the system serves equals the zones' demand.

**P2 — EnergyPlus referee.**
- A hot-water plant loop with `Boiler:HotWater` at a stated nominal capacity.
- The rooms on `ZoneHVAC:Baseboard:RadiantConvective:Water` sized as in 108's referee.
- A cooled case with a chiller (or `ZoneHVAC:IdealLoadsAirSystem` per zone, with a shared limit if the plant route is too slow).
- Gate:
  - annual heating within ±3 %;
  - unmet room-hours within ±10 % on a case where the boiler binds, and on one where it doesn't;
  - the sharing in short hours compared room by room against EnergyPlus.
- Report, don't tune.

**P3 — Results.**
- For each system:
  - its capacity;
  - its peak ask (before the cap);
  - hours at full output;
  - the energy it could not deliver, and when.
- For each room: unmet hours, split into "emitters short" and "system short", so the person can see which one to fix.
- The design heat loss panel (117) adds the system line: the sum of its rooms' design losses (plus hot water if it has priority) against `capacity_kw`.
- Run the community centre example and Bridgewater; record what moves.

**P4 — The window test, now in our engine as far as it can go.** Re-run the example office with its plant capped, so the "windows open" answer is bounded by plant as well as radiators once 115 lands. Until then, this is a check against P2's EnergyPlus case.

**P5 — Independent review** (coordinator starts a review thread), answered in `05_review_response.md`.

**P6 — Editor (editor thread).** A capacity field (kW) on each heating and cooling system in the Systems step, shown with its rooms' design heat loss total beside it. A "system short" mark on rooms in the drawing.

**P7 — Close.**
- Archive the brief and write the final report.
- Update the CLAUDE.md Systems scope (capacity per system; still no lead/lag).
- STATUS.md.
- PR to main (Linzie merges).

## Deliverables

Schema 2.8 with upgrade (fills nothing); engine caps in Engines 1 and 2; referee results in `docs/audit/120/`; the results lines in P3; editor fields; docs per CLAUDE.md process rule 7.
