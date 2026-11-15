# Brief 111 Part 2: Fabric only against EnergyPlus

**The referee** (`validation/energyplus/111_fabric_referee.py`) is Brief 104's gate referee r2_z for Bridgewater as five storeys, as Brief 105 builds it. It has:
- the document's frame and internal capacity;
- slabs seen from both sides;
- bridging and infiltration allocated by zone, as Engine 2 allocates them;
- infiltration at standard air density (Brief 105's attributed convention);
- no internal gains, and no ventilation objects other than the permanent louvres (envelope).

The dual thermostat is **removed and replaced** by a single heating thermostat at 21 °C (Rule 8), so there is no cooling object at all.

**The engine side** (`scripts/111_fabric.mts`) is the seam's own fabric level: `simulate(doc, { level: 'fabric', fabric_heat_c: 21 })` on the anchor weather. This is the code path the editor will call.

| | Engine 2, MWh | EnergyPlus, MWh | Difference |
|---|---|---|---|
| **Building heating** | **90.61** | **88.42** | **+2.5 %** (tolerance ±10 %: pass) |
| Floor 1 (ground) | 24.74 | 23.18 | +6.7 % |
| Floor 2 | 13.47 | 13.88 | −3.0 % |
| Floor 3 | 13.15 | 13.26 | −0.8 % |
| Floor 4 | 13.75 | 14.12 | −2.6 % |
| Floor 5 (roof) | 25.51 | 23.99 | +6.4 % |
| Cooling | 0 | 0 | none at this level, as intended |

**Reading it:**
- The building is within 2.5 %. Every storey is within 7 %, the per-storey figures being stated, not gated (Briefs 104/105).
- **The pattern:** the storeys with the most outside surface (ground floor, roof) are a little high, and the middle storeys a little low. This is the same allocation pattern Brief 104 F1 attributed to how the slabs and bridging are split between storeys, not a new miss.
- **Nothing was tuned.** The fabric run uses the same engine and options as every other level.

**Not done here: the two-zone fixture.** The editor's two-zone plan has no EnergyPlus referee. Today's referees are built from `building_config` (Bridgewater) or from a hand-written spec (the cooled room), and nothing writes EnergyPlus input from a drawn model document. A document-to-EnergyPlus writer is the right tool for this. Calibrating drawn buildings later will need it too, so it is proposed as its own piece of work rather than a one-off for this check.

**Files:** `02_fabric_energyplus.json` (the referee run) and `02_fabric.json` (the comparison, with the fabric run's building breakdown).
