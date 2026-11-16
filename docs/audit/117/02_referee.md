# Brief 117 Part 2: the design heat loss against EnergyPlus

16 Nov 2026. EnergyPlus 25.2.0, run in the container. Engine figures come from `scripts/117_design.mts`, saved to `02_engine_design.json`. EnergyPlus figures come from `validation/energyplus/117_design_referee.py`, saved to `02_referee.json`.

## Set-up

Both buildings run in EnergyPlus on a weather file in which every hour is the design condition:
- the engine's 99.6 % design outdoor temperature: Denver −13.9 °C for the cooled room, Yeovilton −4.6 °C for Bridgewater;
- no sun;
- a sky at the air temperature;
- wind at 4 m/s, at which the design heat loss counts Bridgewater's permanent vents;
- constant pressure;
- no rain or snow.

There are no internal gains. Ideal loads hold each room at its design temperature: 20 °C for the cooled room's west and east rooms, 12 °C for its middle room (stated for the design), and 21 °C for each Bridgewater storey. Air uses EnergyPlus's standard density. The run lasts two months, and the last hour is read, once it matches the hour 24 hours earlier. The engine's figure is each room's design heat loss less its minimum-air-change top-up and warm-up. The top-up is 62 W in each outer cooled-room room and 48 W in the middle one, where infiltration is 0.414 ach; there is none at Bridgewater, which is above 1.1 ach. No warm-up was stated. Neither of those two is in EnergyPlus; both are checked by hand in the Part 1 tests.

**Gate (from the brief, stated before running):** each room within ±3 %, and the building within ±2 %.

## Result

The gated run is **combined**. It passes: every room is within −1.75 %, the cooled room's total within −0.42 %, and Bridgewater's within −1.68 %. Fabric is everything except air: conduction, bridging, ground and partitions.

| Run | Building | Room | °C | Engine W | EnergyPlus W | Total | Fabric | Air | Gate |
|---|---|---|---|---|---|---|---|---|---|
| combined | Cooled room | west | 20 | 1,588 | 1,595 | -0.42 % | -0.28 % | -0.99 % | pass |
| combined | Cooled room | middle | 12 | 509 | 517 | -1.42 % | -1.76 % | -0.99 % | pass |
| combined | Cooled room | east | 20 | 1,588 | 1,595 | -0.42 % | -0.28 % | -0.99 % | pass |
| combined | Cooled room | **heated total** | | 3,176 | 3,190 | -0.42 % | | | pass |
| combined | Bridgewater | z1 | 21 | 29,388 | 29,877 | -1.64 % | -0.92 % | -1.97 % | pass |
| combined | Bridgewater | z2 | 21 | 25,319 | 25,769 | -1.75 % | -1.15 % | -1.97 % | pass |
| combined | Bridgewater | z3 | 21 | 25,319 | 25,769 | -1.75 % | -1.15 % | -1.97 % | pass |
| combined | Bridgewater | z4 | 21 | 25,319 | 25,769 | -1.75 % | -1.15 % | -1.97 % | pass |
| combined | Bridgewater | z5 | 21 | 30,659 | 31,139 | -1.54 % | -0.72 % | -1.97 % | pass |
| combined | Bridgewater | **heated total** | | 136,003 | 138,323 | -1.68 % | | | pass |
| iso_conv | Cooled room | west | 20 | 1,588 | 1,446 | +9.86 % | +12.74 % | -0.99 % | FAIL |
| iso_conv | Cooled room | middle | 12 | 509 | 593 | -14.10 % | -22.50 % | -0.99 % | FAIL |
| iso_conv | Cooled room | east | 20 | 1,588 | 1,446 | +9.86 % | +12.74 % | -0.99 % | FAIL |
| iso_conv | Cooled room | **heated total** | | 3,176 | 2,891 | +9.86 % | | | FAIL |
| iso_conv | Bridgewater | z1 | 21 | 29,388 | 29,397 | -0.03 % | +4.43 % | -1.97 % | pass |
| iso_conv | Bridgewater | z2 | 21 | 25,319 | 25,716 | -1.54 % | -0.39 % | -1.97 % | pass |
| iso_conv | Bridgewater | z3 | 21 | 25,319 | 25,546 | -0.89 % | +2.13 % | -1.97 % | pass |
| iso_conv | Bridgewater | z4 | 21 | 25,319 | 25,813 | -1.91 % | -1.77 % | -1.97 % | pass |
| iso_conv | Bridgewater | z5 | 21 | 30,659 | 29,886 | +2.59 % | +12.54 % | -1.97 % | pass |
| iso_conv | Bridgewater | **heated total** | | 136,003 | 136,357 | -0.26 % | | | pass |

## Why two runs, and why the gate is on "combined"

This is said plainly because the review should weigh it. The first run was **iso_conv**: the engine's year-run surface physics, with fixed inside convection by tilt and long-wave exchange between faces. It was the only run planned. Bridgewater passed it. The cooled room failed: +9.9 % in the heated rooms, −14.1 % in the middle room.

The split by fabric and air shows that the whole gap is fabric. In the cooled room, fabric is +12.7 % and −22.5 %, while air is −1 %. Bridgewater's top storey, with the roof, is +12.5 % on fabric.

The design method (MCS MIS 3005-D on BS EN 12831-1, with U-values from ISO 6946) takes each inside face's film as convection and radiation together, to surroundings at the room's temperature (R_si 0.13 for walls, 0.10 for ceilings, 0.17 for floors). In **iso_conv**, EnergyPlus heats the air only, and the faces reach that air only by convection (2.5 W/m²K on a wall). Long-wave exchange moves heat between faces but adds none. So the faces sit colder than the method assumes, and less heat crosses the fabric. On the west room's walls, EnergyPlus's inside-face conduction is 8.5 % below U·A·ΔT. This is the difference between the standard convention and a room heated by warm air alone. It is not an error in the arithmetic.

The **combined** run tests the arithmetic. It puts the method's own assumption into EnergyPlus: each face's film entirely as convection at the ISO 6946 combined value (7.69, 10, 5.88 W/m²K; 25 outside) and long-wave radiation off (thermal absorptance 0.001). Glazing keeps its fixed emissivity, because the simple glazing model has no input for it. Fabric then agrees within 1.8 % in every room. So the gate is on combined. Switching the gated run after the first result is a judgement made after seeing it, and is recorded as one.

**What this means for sizing.** The design heat loss is the industry convention, and it is on the safe side for a room heated by warm air. Where large cold surfaces dominate the fabric, it can be about 10 % more than a convective system needs (the cooled room: +9.9 %). Where air dominates, as at Bridgewater, the two are close (−0.3 %). The panel says the method is the standard one (Part 3).

## Other differences, with magnitudes

- **Air: −1.0 % (cooled room) and −2.0 % (Bridgewater).** The engine's air heat is 0.33 Wh/m³K, today's constant. EnergyPlus's standard density is 20 °C at the site's pressure. At Bridgewater this is the −1.97 % seen since Brief 105 (std_density).
  - **First cooled-room run:** with EnergyPlus's default outdoor-air density at −13.9 °C, the air term was 15 % larger in EnergyPlus.
  - **Second cooled-room run:** standard density at the spec's sea-level rate came out 19.6 % smaller, because standard density is taken at Denver's pressure.
  - **Gated run:** standard density at the spec's at-site rate of 0.5 ach, the pair 104's spec was made for, leaves −1.0 %.
  - All three runs were made on 16 Nov, before the combined result.
- **Storey to storey in iso_conv:** Bridgewater's middle storeys differ from each other in EnergyPlus (z3 fabric +2.1 %, z4 −1.8 %). The slabs between them carry heat by long-wave exchange from faces at different temperatures. In combined, the three are identical, as in the engine.
- **Ground:** the model's ground temperature (Yeovilton annual mean, 11.26 °C) on both sides. Bridgewater's ground floor is in z1's fabric line, within −0.92 % in combined.
- **Warnings:** 2 (cooled room) and 6 (Bridgewater) in combined. None is severe.
