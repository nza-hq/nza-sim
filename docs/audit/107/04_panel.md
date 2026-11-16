# Brief 107 Part 4 — energy used in the results panel

- **Seam.** `simulate` now runs `runSystems` after the demand run. `Summary.energy` holds either the EUI, the total, the split by fuel, the end-use lines and each system's heat served and energy used, or the systems' missing inputs in plain words.
  - Demand shows either way, so a building with no systems yet still shows its heating and cooling.
  - Missing inputs are worded the way the panel's other missing inputs are worded: they name the system or zone, e.g. "No heating system serves Zone 2", or "The system "VRF heating" needs its efficiency or SCOP".
- **Panel.** A new "Energy used · estimate" section sits under the demand totals:
  - the EUI (kWh/m² a year) and the total MWh;
  - the split by fuel;
  - end use by fuel;
  - each system with its efficiency, heat served and energy used.
  The ⓘ basis now says how energy used is formed, that it matches today's tool given the same demand, and that carbon is not included yet.
- **Rule 11.** The panel reads the EUI from `readSystemsEui` only, via the seam. It is v2's own boundary, kept apart from the instant engine's and from EnergyPlus's.
- **Tests** (`seam.test.ts`):
  - Bridgewater's energy is split into electricity and gas.
  - The by-fuel lines and the end-use lines each sum to the total.
  - EUI = total ÷ floor area.
  - With the heating systems removed, demand still shows and energy says "No heating system serves …".
  - 32 sim2 tests pass.
- **Browser check** at 1440×900, on the editor's two-zone plan with its systems (a23418d), Yeovilton weather ([`04_energy.png`](04_energy.png)). No page errors. The figures:

  | | Result |
  |---|---|
  | EUI | 46 kWh/m² |
  | Total | 9.3 MWh, all electricity |
  | VRF heating, Zone 1 | serves 7.9 MWh at SCOP 3.5, uses 2.2 |
  | Panel heaters, Zone 2 | serve 1.5 MWh at 1, use 1.5 |
  | Fans | 1.9 MWh |
  | Lighting | 0.7 MWh |
  | Small power | 2.9 MWh |

  Each system's figure is its served heat ÷ efficiency. The fixture has no hot water system, so there is no hot water line.
- **Also.** `weather.ts` gets a one-word type fix (`bytes as BlobPart`) that a strict type check flagged. There is no change in behaviour.
