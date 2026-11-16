# Brief 112: Simulate v2, the demand/energy split (Spaces = demand, Systems = energy)

Written 16 Nov 2026 by the journey-planning thread. It records Linzie's ruling of 16 Nov 00:22 and 00:41 ("space
is demand, systems is energy"), confirmed at 00:50 ("Okay, cool"). The table it comes from is "Where one step
stops and the next starts" (v3) on https://claude.ai/artifact/HkeZfzSEfSZVSUqWAqJuyF.

**Numbering:** this takes 112. The meter check moves to 114 or later. The document-to-EnergyPlus writer comes
before the meter check, and the design note's 113 stays the decodED link.
**Owners:** Parts 1 to 4 belong to the building thread (schema, `thermal/`, `sim2/run/`). Parts 5 and 6 belong
to the editor thread (the workspace's Spaces and Systems steps).
**Order:** after 109 closes and after #33, #34, #36 and #35 have merged (Linzie's merge OK came 16 Nov 00:51).
It goes before the "proper software" pieces, because inheritance and the inspector need to know which field lives
on which step.

## Why

Linzie's rule is that **Profiles say when, Spaces say what's in the room and what it needs (demand), and Systems
say how the kit meets that need and what it costs (energy).** Today, lighting is a W/m² on the space and hot water
is a building-level litres figure. Neither matches how she thinks about a building: a classroom needs 300 lux when
it is occupied, and the luminaires deliver that at some W/m² per 100 lux. Hot water follows the people in the
room, and the heater decides the energy.

## The table (as confirmed)

| Thing | Spaces (demand) | Systems (energy) | Profiles (when) |
|---|---|---|---|
| People | people/m², heat per person | | occupancy |
| Equipment | W/m² (plug loads are demand) | | equipment profile |
| Lighting | lux needed | W/m² per 100 lux, controls (daylight, presence) | lighting profile |
| Comfort | temperature needed (heating, cooling) | actual setpoints and setbacks | heating and cooling hours |
| Fresh air | l/s per person | ventilation kit, heat recovery, SFP | ventilation hours |
| Hot water | litres per person per day | water heater, efficiency, losses | (follows occupancy) |
| Emitters | | type, rating, flow temperature; **set per room, shown on the room** | |
| Plant | | boiler, heat pump, chiller, efficiencies | |

- Air leakage and thermal bridging stay in Fabric.
- Room use is tagged in Shape, and the tags make the zones.
- Emitters: Linzie first suggested Spaces. The recommendation was Systems, set per room and shown on the room;
  she accepted it at 00:50. If she reverses this, only Part 5 changes.

## Rules this must keep

- **Rule 11 (one derivation).** Lighting W/m² = lux ÷ 100 × efficacy (W/m² per 100 lux), derived in **one** place
  and never stored on the document. The display, the engine and the energy split all read that one function.
- **Rule 8 (levels remove, they don't mute).** Lighting heat now needs efficacy, which is a Systems object, so it
  **arrives at "+ Systems"**. "+ Spaces" carries people and equipment only. The 111 refusal that guarded lighting
  moves to efficacy. The heat flow view says this in words at "+ Spaces": "Lighting heat appears at + Systems,
  because it depends on the luminaires."
- **No invention.** An older document has a lighting W/m² but no lux. The upgrade must not guess a lux. Either it
  refuses by name ("Lighting in Classroom: state the lux needed and the luminaire efficacy"), or it keeps an
  explicit **stated W/m²** form, shown as "stated, not from lux". Part 1 picks one and says why. The recommendation
  is to keep the stated form, so that today's models still open and run.
- **The anchor holds.** Bridgewater must still give **EUI 133.2** and lighting **39.014 MWh** (the 107 gate),
  with lux × efficacy stated so that they reproduce today's W/m² exactly. No tuning: write down the lux and
  efficacy and where they came from.

## Parts

**P1 Schema (building thread).** Version bump to the next 2.x.
- Space types gain `lighting.lux` and `dhw.litres_per_person_day`.
- Systems gain `lighting.efficacy_w_m2_per_100lux` plus controls.
- The emitter stays per room under Systems (2.4 shape), with no move.
- `services.dhw` keeps the heater only; its building-level litres go.
- The upgrade from the earlier version either refuses by name or uses the stated-W/m² form (see above).
- Tests: the round trip, the upgrade, and a refusal naming the space.

**P2 One derivation (building thread).** Add `lightingWm2(space, system)` in `thermal/`, and route every reader
through it. Add a test that fails if any other file multiplies lux by efficacy.

**P3 Levels (building thread).** Move lighting heat from "+ Spaces" to "+ Systems" in the 111 run copies. Check
that closure and Rule 9 still hold at all three levels. Hot water demand per space is the design occupants × litres
× 365, summed. Its energy is that demand through the heater.

**P4 Gates (building thread).** Bridgewater 133.2 / 39.014 MWh with stated lux and efficacy. Run the two-zone
fixture at all three levels. Re-run the 133.2 anchor on IT15.

**P5 Workspace (editor thread).**
- Spaces step: lux, people, equipment, fresh air, hot water per person, comfort needed. Use Linzie's Hartpury
  lighting and plug icons.
- Systems step: luminaire efficacy, emitters (the per-room list, also shown on the room in the drawing), plant,
  water heater, ventilation kit. (Amended 16 Nov by Brief 114: lighting controls and actual setpoints move to the
  new Controls step; until 114 lands they sit on Systems with a note.)
- Each field appears on exactly one step.
- The inspector shows the derived lighting W/m² as a read-only line ("12.0 W/m², from 400 lux × 3.0").

**P6 Close.** STATUS, archive, and reword the Systems scope line in CLAUDE.md (lighting energy comes from lux ×
efficacy). Then an independent review, and a PR that merges only with Linzie's approval.

## Not in scope

Daylight modelling (lux from windows) is not in scope; controls are a stated factor for now. Profiles are also
out, because Brief 110 owns them. So is calibration.
