# Brief 119 Part 3 — standard sizes from a published catalogue

16 Nov 2026. Linzie, 14:49: Stelrad Vita Compact first (the recommended option on the card).

## Source

- **Stelrad Vita Compact**, https://www.stelrad.com/wp-content/uploads/2021/11/26979_Vita-Compact_Web.pdf. No edition or date is printed in the text.
- Read 16 Nov 2026 as text extracted from the PDF. This container's proxy refuses the download (`CONNECT tunnel failed, response 403`), so there is no file hash (`source_sha256: null`, said in the data). **To do on IT15:** download the PDF, record its sha256 and check the 26 rows against the page by eye.
- The basis is printed as: "50 t (75/65/20ºC)", "EN 442 certification data — CETIAT tested in accordance with BS EN 442".
- Which column is which type: the output table's three column groups carry no type label. The third is K2 (Type 22, double panel double convector), for two reasons:
  - its product codes are 76·45·22·xx and 76·60·22·xx: height in cm, type, length in dm;
  - its 1,000 mm rows (1,371 W at 450 mm, 1,732 W at 600 mm) equal the K2 per-metre outputs printed in the piping table.
- The exponent n is the piping table's "n-coefficients" row: K2 is 1.33 at 450 and 600 mm.

## What is in it

`frontend/src/thermal/catalogue/index.ts` holds 26 items: K2 at 450 and 600 mm, 400 to 2,000 mm long, each with its product code, its output in W at ΔT 50 as printed, and n = 1.33. Other types and heights (K1, P+, 300 and 700 mm) are not entered yet; they are added when they are needed, from the same page. Nothing is computed or interpolated.

## How the run uses it

- **Check, never fill.** An emitter with `catalogue_ref: {catalogue, item}` must state the item's own output, rating (75/65/20) and n. Any difference is refused before the run, by path, in words. For example: "An emitter in "Storey 1" states 3500, but the output of Stelrad Vita Compact 76602220 is 3465." The document states its figures; the reference only says where they came from (Rule 3).
- **Suggest when short.** A zone qualifies when its wet emitters all name items of one catalogue at one height and the zone is short. The extra rating needed at ΔT 50 is the engine's `needed_rated_w − rated_now_w` (Brief 108's sizing, and Brief 117's in the design view). The suggestion is the smallest item at that height that covers it; if no single item does, it is the fewest of the largest.

## Checks

- `catalogue.test.ts` (5 tests):
  - 26 items, with unique codes that encode height, type and length;
  - the 1,000 mm rows equal the printed per-metre outputs;
  - longer radiators give more;
  - every mismatch is named;
  - suggestions behave at the edges.
- `seam.test.ts` Brief 119 (3 tests):
  - a short room's suggestion comes from the engine's own sizing;
  - none when the room has enough, or when its radiators were typed in;
  - a mismatch is refused by name.
- `emitterSizing.test.tsx`: the suggestion's wording.
- Browser check (`04_panel.png`, `scripts/119_panel.mts`): Bridgewater's storeys with nine K2 600 × 2,000 mm radiators each (31.2 kW at ΔT 50) on the heat pump at 50/40 °C.
  - Storey 1 needs 62.4 kW rated and gets "add 10 × 600 × 2000 mm K2 (3,465 W each at ΔT 50) for the 31,221 W still needed".
  - Storeys 2 to 4 get 6 more; storey 5 gets 11.
  - These are many radiators: at 50/40 °C a K2 gives about 37 % of its ΔT 50 rating. That is the point of the check.
