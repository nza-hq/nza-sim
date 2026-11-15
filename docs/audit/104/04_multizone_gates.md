# Brief 104 Part 4: multi-zone gates

Tests: `frontend/src/thermal/engine/__tests__/multizone.test.ts`. The EnergyPlus twin is
`validation/energyplus/104_cooled_room.py`. Both read the inputs in `validation/energyplus/104_cooled_room_spec.json`.
EnergyPlus's results are committed in `04_cooled_room_energyplus.json`, so the gate runs from a fresh checkout.

## Results

| Case | What is checked | Result |
|---|---|---|
| (a) Two zones, steady | A block partition (15 m²). One zone is held at 20 °C; the other is free, losing 10 W/K to 0 °C outside. | The free zone's temperature matches the series hand value (air → film → layers → film → air) to 1e-9 K. The heating and the interzone line also match. |
| (b) Three zones in a row | Outer zones held at 20 °C and 10 °C. The middle zone is free, with partitions of 20 m² and 10 m² and 8 W/K to outside. | The hand solution (3×3, with the middle zone's long-wave exchange from ISO 52016-1 eq. 30) matches air, mean radiant temperature, heating and cooling. The interzone lines sum to zero. |
| (c) Uncoupled zones | Three copies of a heated and cooled zone in one network. | Each copy equals runZone's one zone, hour by hour, so the total is 3×. |
| (d) Internal mass, step | A zone whose only faces are a one-segment mass, with the air held at 20 °C from 0 °C. | The faces follow C/Δt·(x − x₋₁) = h_c·A·(20 − x) every hour. Heating and storage are what the mass takes. There is no interzone line. |
| (d) Internal mass, steady | Mass added to a heated zone with walls. | At steady state the mass stores nothing. The heating rises **2.7 %**: see below. |
| (e) Cooled room | Three Denver rooms, the outer two heated at 20 °C and the middle cooled at 24 °C, joined by block partitions. Built in EnergyPlus 25.2.0 from the same spec. | All three rooms are within ±10 % of EnergyPlus with the same surface coefficients. See the table below. |

### (e) Cooled room, annual MWh

| Room | Demand | Engine 2 | EnergyPlus, ISO surface coefficients | EnergyPlus, own coefficients | Engine 2 against ISO | Engine 2 against own |
|---|---|---|---|---|---|---|
| west | heating | 1.861 | 1.933 | 1.694 | −3.7 % | +9.9 % |
| middle | cooling | 1.409 | 1.348 | 1.369 | +4.5 % | +2.9 % |
| east | heating | 1.862 | 1.930 | 1.686 | −3.5 % | +10.4 % |

- **The gate** is against the ISO-coefficient run (`iso_conv`). That run has outside convection fixed at 20 W/m²K and inside convection by tilt, which are Engine 2's coefficients. Everything else is EnergyPlus's own: 4 time steps an hour, its sky, its window model from the same U and SHGC, and its beam distribution.
- **Against EnergyPlus's own run**, the two heated rooms are +10 %. The convection forms alone move EnergyPlus's heating by 14 % (1.69 to 1.93). This is the open finding from Brief 103 (TARP and DOE-2 against ISO's fixed values). It is not a multi-zone effect.
- **Heat through the partitions into the cooled room:** Engine 2 0.385 MWh, EnergyPlus 0.365 (inside-face conduction, `iso_conv`).
- **Ideal loads:** every hour settled in one pass of the active set.

## Finding: internal mass and the steady state

The brief expected internal mass to change no steady-state result. That is true for storage: at steady state the mass
stores nothing. It is not true for the heat balance of a room. The mass faces settle between the air and the colder
walls, so they add a path from the air to the walls: convection in, long-wave out through ISO 52016-1's area-weighted
exchange. In the test case this raises the steady heating by 2.7 %. EnergyPlus's internal mass joins the radiant
exchange in the same way. The test asserts the sign and records the size. It does not assert zero. Nothing was changed
to make it zero.
