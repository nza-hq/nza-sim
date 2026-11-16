# Brief 119 — final report

16 Nov 2026, branch `chris/119-cooling-emitters`. Simulate v2 only. Today's engine untouched (anchor 133.2).

## What a person gets

- **Cooling limited by the room's units.** A fan coil, VRF indoor unit or "other" unit can state its sensible cooling per unit (W, held fixed). Each zone's cooling is capped at the sum. The run reports, per room, the cap, the peak need, the shortfall, hours above the cooling setpoint (in use), the highest temperature in use, and hours at the limit. Units that only cool (`heats: false`) are allowed. A zone whose units state no cooling is named on the panel, not left silently unlimited.
- **Emitters from standard sizes.** Stelrad Vita Compact K2 (Type 22), 450 and 600 mm, 400–2000 mm long, 26 items, ΔT 50 outputs, n = 1.33 (Linzie's choice, 14:49). An emitter can name its catalogue item; the run checks its stated figures against the item and refuses a mismatch, never fills them. When a room is short, the panel suggests the smallest item at the same height that covers what is still needed.

## Parts

| Part | Commit | Result |
|---|---|---|
| P1 schema 2.7 + engines | 2bcddf3 | `heats`, `cooling_output_w`, `catalogue_ref`; Engine 1 cap; Engine 2 mode −2; 2.6 upgrades with the old meaning |
| P2 EnergyPlus referee | 8e68b87 | Ideal-loads limit (`maximum_total_cooling_capacity`; the sensible field does not exist and was silently ignored). Mild and Bridgewater storey 3 pass 108's gate; tight fails its hours (+80 of 299). Under the brief's own ±5 % gate, Bridgewater storey 3 also fails. The limit's own effect agrees within 0.03 MWh |
| P3 catalogue | 59b3125 | 26 items, check and suggestion |
| P4 panel | 122a530 | Cooling block; browser check at Bridgewater, five storeys |
| P5 review | 66a757f | F1–F10 answered ([`05_review_response.md`](05_review_response.md)) |

## Tested against a real project

Bridgewater (the anchor fixture and its EPW), five storeys through the product's own run:
- the EnergyPlus referee, on storey 3 at 12 kW;
- the panel check;
- the neighbour check (F7).

Anchor 133.2 unchanged. 378 v2 tests pass with the EPW present, none skipped. The build is clean.

## Open, recorded

- The cooled-room tight limit misses EnergyPlus by +80 h. This is Brief 104's cooled-room cooling gap (+4.5 %, unattributed), not the limit.
- The highest temperature reads 0.3–0.9 K above EnergyPlus's.
- Catalogue PDF: the sha256 and an eye check of the columns are owed on IT15. Two independent reads agree on all 26 rows.
