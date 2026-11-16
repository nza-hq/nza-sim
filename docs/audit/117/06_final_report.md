# Brief 117 — final report: design heat loss per room for sizing

Closed 16 Nov 2026 on `chris/117-static-heat-loss` (stacked on 109).

## What Linzie asked for

On 16 Nov at 10:57, Linzie asked for "a static heat loss calculation that oversizes the radiators", to sit beside the check of whether existing radiators are enough at a lower flow temperature. She chose to build it before Brief 112. At 11:38 she chose published UK sources over the text of BS EN 12831-1.

## What was built

- **Schema 2.6.**
  - `building.design` holds the design outdoor temperature (stated, or the weather file's 99.6 % / 99 %), an optional warm-up W/m², and the wind speed for permanent vents.
  - `zones[].design_internal_c` holds the design temperature (stated, or `follow_heat_c`).
  - All are null by default, and the 2.5 → 2.6 upgrade fills nothing.
- **`thermal/engine/designHeatLoss.ts`.** Each room's design heat loss as lines: fabric, bridging, ground, to other rooms, air leakage, vents, ventilation at full flow, the MCS calculator's 0.5 ach top-up, and warm-up. The lines sum to the room total (Rule 9). The building total is the heated rooms'. It reads the run's own conductances (Rule 11).
- **The run seam's `summary.design_heat_loss`.** It includes each zone's emitters rated with the room at its design temperature, at the base flow and return and at the what-if pair.
- **Panels.**
  - `DesignHeatLoss.tsx`, per room: kW, W/m², the design temperature, and the terms on tap.
  - The emitter panel's "Design heat loss | Year-round check" switch.

## Evidence

| Check | Result |
|---|---|
| Hand calculations | 16 tests (`designHeatLoss.test.ts`), plus the seam and panel tests. The v2 suite passes (281). |
| EnergyPlus, arithmetic (`combined`: the method's own films) | Passes. Rooms within −1.75 %; cooled room −0.42 %, Bridgewater −1.68 %. |
| EnergyPlus, physical (`iso_conv_operative`: warm-air heating holding the design temperature as felt) | Cooled room passes (+0.89 %). **Bridgewater fails: −3.08 %, storeys −3.0 % to −4.3 %.** Almost all of it is air: EnergyPlus keeps the air 0.6 to 0.9 K warmer to hold 21 °C felt, and loses its air heat at that temperature. About 2 % is the engine's air constant. Reported, not tuned. |
| Today's engine | Untouched; anchor 133.2 on this branch. |
| Browser | Bridgewater at 50/40 against 70/60 °C (`03_panel.png`). |
| Independent review | F1–F10, all accepted and answered (`05_review_response.md`). |

## For Linzie, in plain words

- **What it shows.** The tool now works out each room's heat loss at the design cold day, the standard way a heat pump is sized. It then shows whether the radiators that are there give enough at the system's flow temperature, and what rating would.
- **How close it is.** A room heated by warm air alone can need a few per cent more than this figure, up to 4 % at Bridgewater.
- **For an MCS design.** State the CIBSE outdoor temperature for the site, rather than taking the weather file's.

## Open

- **Floor type.** A suspended floor is counted as solid, so its loss is understated (review F2). A floor-type field is in STATUS under Suggestions.
- **The air constant.** The engine's air constant of 0.33 Wh/m³K against EnergyPlus's standard density (about 2 %) is the same as since Brief 105.
- **Next.** Brief 119: cooling emitters and standard emitter sizes, agreed with the editor thread. Brief 118 P4 places these panels under each system once 117 is in main.
