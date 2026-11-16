# Brief 117 Part 3: the design heat loss in the results

16 Nov 2026.

## What changed

- **Seam (`sim2/run/seam.ts`).** `summary.design_heat_loss` is null when the building states no design conditions. Otherwise it is either:
  - the design heat loss, which gives the outdoor temperature and where it came from, the ground temperature, the heated rooms' total, and for each room its total, W/m², design temperature, terms (summing to the total, Rule 9), and its emitters checked against it at the systems' flow and return and at the what-if pair; or
  - what is still needed, in words.
  
  The figures are `designHeatLoss`'s own, read from this run's conductances (Rule 11). The emitters are rated with the room at its design temperature: a copy of the document, read only by `zoneEmitters` and `zoneSizing`. A gap in the design inputs never hides the year's results.
- **`sim2/run/DesignHeatLoss.tsx` (new), `<DesignHeatLoss summary={summary} />`.** For each room it shows the design heat loss, W/m² at the design temperature, and its terms one tap away. The building total comes with the outdoor temperature and its source. The basis is behind ⓘ, including the standard method's surface assumption and the "safe side by up to about a tenth" finding from Part 2.
- **`sim2/run/EmitterSizing.tsx`.** When the design heat loss is worked out, a "Design heat loss | Year-round check" switch appears, opening on the design. In the design view each zone reads, for example, "Emitters give 11.4 kW at 50/40 °C with the room at 21.0 °C; the design heat loss is 29.4 kW". It also gives the rating needed at ΔT 50, with the what-if pair beside it, and shows no hours rows, because this is a steady figure. Without design conditions the panel shows the year-round check alone, with one line: "To size against a design heat loss, state the design outdoor temperature." Props are unchanged.

## Browser check (03_panel.png, 1440×900, static render of the two panels)

Bridgewater, five storeys (`scripts/117_panel.mts`, anchor EPW). Radiators of 30 kW at 75/65/20 °C on the heat pump at 50/40 °C, compared at 70/60 °C. The design condition is the weather file's 99.6 %, −4.6 °C, with vents at 4 m/s and no warm-up. Numbers are in `03_panel_summary.json`:

| Storey | Design heat loss | 50/40 gives | Rating needed at 50/40 | 70/60 gives | Short at 70/60 |
|---|---|---|---|---|---|
| 1 | 29.4 kW (35 W/m²) | 11.4 kW | 77.4 kW | 25.4 kW | 4.0 kW |
| 2–4 | 25.3 kW (30 W/m²) | 11.4 kW | 66.7 kW | 25.4 kW | 0.0 kW |
| 5 | 30.7 kW (36 W/m²) | 11.4 kW | 80.8 kW | 25.4 kW | 5.3 kW |

The building total is 136.0 kW. For comparison, the year-round check's peaks (the coldest hour, unlimited) are in the same JSON.

**Sense check:** 30 kW rated at ΔT 50 gives 25.4 kW at 70/60 with the room at 21 °C, because (43.8/49.83)^1.3 = 0.846. At 50/40 it gives 11.4 kW, because (23.65/49.83)^1.3 = 0.379 (log-mean ΔT as `emitters.ts` takes it; corrected after review, which found the printed ΔTs slightly off). Both match the panel.

The terms list opens on a tap, so it does not show in a static render. Its numbers are covered by the seam test (the terms sum to each room's total).
