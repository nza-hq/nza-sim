# Brief 109 Part 3: underfloor heating in the floor

16 Nov 2026. Underfloor heating now puts its heat into the floor it sits in. The floor carries that heat up into the room and down through the insulation. This is Engine 2. The EnergyPlus check passes on every case.

## What changed

**Schema 2.5.** An `underfloor` emitter states two things:

- `source_surface_id`: the room's floor, either a ground floor or an exposed floor. An upstairs room can also name the slab below it, which that room sees as its floor.
- `source_layer_index`: the layer whose inside face the pipes run along. Layers are counted from the surface's first layer (outside, or zone_b), starting at 0. EnergyPlus's "thermal source present after layer number" is this index plus 1.

Both are required for underfloor heating and must be empty for every other kind.

- A `radiant_fraction` stated for underfloor heating is refused, because its heat leaves through the floor.
- If either field is left out, it reads as null (not stated).
- The 2.4 → 2.5 upgrade fills nothing. A 2.4 underfloor emitter is therefore refused by name until its floor and layer are stated.
- The run seam accepts 2.4 documents through the upgrade, as it does 2.3.

**Where the heat enters.** The heat goes in at the node at that layer's inside face (`layerFaceNode`, elements.ts). Some placements are refused by name:

- the last layer's inside face, because that is the room surface and not inside the floor;
- a layer that does not exist;
- on a floor between two zones, a layer in the half nearer the other zone, because each half's stored heat is counted in its own zone.

**Engine 2.**

- In `network.ts`, the floor's share of heating reaches the interface through that element's chain. The chain solves B·y = b, and a unit heat at node j adds u = B⁻¹·e_j. Faces A and B see g_A·u_last and g_B·u_0 in the zone's heating vector. After each step, the chain's nodes take φ_floor·u on top.
- The heat is in the zone's own balance, so closure holds every hour.
- The breakdown's `heating` line is the heat put into the floor. Heat that goes down shows in the floor's conduction line (Rule 9).
- A zone can mix underfloor heating with other emitters. Each takes its design output's share of the zone's heating, held for the year.

**Engine choice.** A document with underfloor heating runs on Engine 2, one zone included. This replaces the brief's "Engine 1 refuses": routing it is how sub-hourly steps and TARP already work, and the one-zone network is tested against Engine 1 (multizone.test (c)).

## Tests (`ufh.test.ts`, 9)

- **(a) Steady state by hand, to 1e-6.** A ground floor with 100 mm of insulation and 70 mm of screed, with the pipes on the insulation's inside face. The heat into the floor equals:
  - the room's loss, which crosses the floor face by convection and then the screed;
  - plus the loss down to the ground from the pipes' temperature (here over 100 W).
- **(a) Half in the floor, half to the air.** The heat comes out between all-floor and all-air.
- **(b) The cooled room with underfloor heating**, on office hours with a setback:
  - closure is 1 Wh or less every hour;
  - the heating line equals the heating;
  - the result reports the floor and layer;
  - one zone also runs on Engine 2.
- **(c) Against radiators of the same output:**
  - more than 50 more hours below in use;
  - more than 0.2 K colder at 08:00 on winter weekdays;
  - warmer at 21:00, because the floor keeps giving heat.
- **(d) Refusals**, each by its path and in words.
- **Mutation check:** without the chain update (φ·u), 4 of the 9 tests fail.

## Against EnergyPlus

Referee: `validation/energyplus/109_ufh_referee.py`. Comparison: `scripts/109_ufh.mts`. Numbers: `03_ufh.json`.

**The setup.** The cooled room on Part 2's hours, with a 15 °C setback.
- The west and east rooms are heated by `ZoneHVAC:LowTemperatureRadiant:Electric` in their floors, with the source after layer 1 (the insulation's inside face).
- Limits: tight 800 W and mild 1,100 W.
- EnergyPlus runs EulerMethod at 4 steps an hour, as in Part 2.

**The control differs, as stated in decision 5.** EnergyPlus ramps the heat over a 0.5 K throttling range centred on the setpoint (HalfFlowPower). The engine holds the setpoint while it can. Nothing was tuned.

The gate is Part 2's, and it passes on every case.

| case (west) | heating | morning peak | hours below in use | lowest in use | worst profile hour |
|---|---|---|---|---|---|
| tight, 1 step | −1.1 % | 0.0 % | 970 vs 1,014 (−44 h) | +0.31 K | 7.3 % |
| mild, 1 step | −1.1 % | +0.2 % | 802 vs 838 (−36 h) | +0.20 K | 6.3 % |
| tight, 4 steps | −0.8 % | +0.8 % | 1,013 vs 1,014 | +0.21 K | 3.2 % |
| mild, 4 steps | −0.7 % | +0.7 % | 841 vs 838 | +0.21 K | 3.2 % |

The east room is within 7 h and 0.04 K of the west.

**What underfloor heating does here.** Engine 2, mild case, 4 steps. With the same 1,100 W as all-convective radiators, the room spends 841 hours below setpoint in use, against 217. It also uses 28 % more heat (1.62 MWh against 1.26 MWh). Some of the floor's heat goes down through the insulation to the outside air below the floor, and the floor stays warm through the night setback. EnergyPlus gives 838 hours and 1.63 MWh for the underfloor case.

**The product's rating.** The product rates an emitter at the room's temperature each hour (Brief 108 F1, 'room').
- For underfloor heating this is an approximation: the water heats the screed, not the air. EnergyPlus's electric system has a fixed limit, so this can be measured but not refereed.
- On the mild case at 4 steps, room rating gives 785 hours below in use against 841 with the fixed limit, and 1.66 MWh against 1.62.
- A floor-temperature rating (water to screed) would remove the approximation. It is noted for the review, not built here.

## Known limits

- The pipes sit at a layer face, as in EnergyPlus. Pipes in the middle of a screed need the screed split into two layers in the construction.
- EnergyPlus's one-dimensional source is used. The two-dimensional fin effect between pipes is not modelled in either.
- The heat share between an underfloor emitter and other emitters in the same zone is fixed at design.
