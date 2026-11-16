# Brief 114 P3: gates

Script `scripts/114_gate.mts` (run from `frontend/`), output [`03_gate.json`](03_gate.json). Weather: the Denver TMY3 .mos the engine tests use, because the anchor EPW is not in this container (the proxy blocks it). The script uses the anchor EPW when present.

| Gate | Result |
|---|---|
| (a) Bridgewater, five storeys, "+ Systems", as converted: sha256 of every zone's results and every end use, this branch against the commit before 114 (6928471, same script) | **identical**: `2da3e6b5…e58b` both; v2 EUI 148.33 kWh/m² on Denver |
| Today's engine | untouched by this brief (no file under `frontend/src/utils/` or `nza_engine/` changed), so the anchor 133.2 holds by construction; not re-run here (no anchor EPW) |
| (b) Bridgewater with NCM default pumps on every heating and cooling system (path test: its VRF and panels have no water circuit, so "Use defaults" would fill none) | only the pumps line changes; heating and cooling unchanged to the bit. Fixed, with demand: +6.4 kWh/m²; variable: +2.3 kWh/m² |
| (c) Three levels with pumps, Bridgewater and the two-zone fixture | every level closes (Rule 9); pumps are null at "Fabric only" and "+ Spaces" and appear at "+ Systems" (Rule 8) |
| The two-zone pump fixture against EnergyPlus | 02_referee.md (fixed and variable pumps, two rooms) |
| v2 tests | 448: 446 pass, 2 skip (anchor EPW). Build clean. |
