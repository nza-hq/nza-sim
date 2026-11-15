# Brief 106 Part 2 — the room-by-room breakdown (review F3)

- **Seam.** `Summary.zones[].breakdown` (`seam.ts`) is the zone's own balance by term, read from the engine's zone lines with nothing recomputed. It keeps heat from the other zones (`interzone`), which the building's breakdown leaves out because it cancels there.
- **Panel.** Each zone's name in "By zone" opens its balance under its row:
  - every term, including "From other zones" and "Heat stored in the building";
  - the outside faces' three terms as one net line that opens, as in the building's breakdown;
  - one shared component (`BalanceRows`) draws both the building's and the zones' balances.
- **Tests** (`seam.test.ts`, Bridgewater five storeys):
  - Each zone's lines sum to zero within 1e-6 of their gross.
  - Each zone's heating line equals its heating figure.
  - The zones' "from other zones" lines cancel across the building.
  - The building's breakdown has no interzone line.
- **Browser check** at 1440×900, editor two-zone fixture, Yeovilton weather (`02_zone1.png`):
  - Zone 1 opens to 15 lines, 18 with "Walls, roof and floor" opened, with no page errors.
  - Its heating line (+7.9 MWh) matches its row.
  - It loses 1.9 MWh to the other zone.
