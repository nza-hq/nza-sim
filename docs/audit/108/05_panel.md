# Brief 108 Part 5: emitters in the panel

**Commit:** `108 P5: emitters in the panel`.

## What was built

- **`frontend/src/sim2/run/EmitterSizing.tsx`** with **`emitters.css`**. It is a separate component, because the
  results panel (`ResultsPanel.tsx`, `run.css`) now belongs to the editor thread. The editor places it with one line:
  `<EmitterSizing summary={summary} whatIf={whatIf} onWhatIf={setWhatIf} />`. It renders nothing when no zone states
  emitters.
- **`client.run(doc, delay, whatIf)`** and the worker pass the second flow and return pair to `simulate`. It is null
  by default, so today's calls are unchanged.

## What it shows

- **Building:** how many zones with emitters are short of output.
  - A "Compare at another flow / return" form, which defaults to 70/60. Compare reruns and Clear drops the what-if.
  - With a what-if, a building table at each pair: zones short, heating delivered, and energy used (when systems
    allow).
- **Per zone:** the zone's name and how far short it is, plus a bar of output against peak.
- **With one pair:**
  - "Emitters give X kW at 50/40 °C; the peak need is Y kW."
  - "N hours a year more than 0.5 °C below the setpoint; lowest T °C."
  - "Needs X kW more at 50/40 °C: R kW rated at ΔT 50 (75/65/20 °C), against S kW there now."
- **With two pairs:** the "needs" line, then a side-by-side table of peak need, emitters give, short, hours below,
  lowest temperature and rating needed. The sentences are not repeated.
- **Notes:** a fixed-output-only zone, mixed systems or mixed exponents show the engine's note in place of a rating.
  A what-if that cannot run lists why, in words.
- **The ⓘ** gives the basis: EN 442 at the design temperatures in the room at its setpoint, the peak from a run with
  the emitters unlimited, the 0.5 °C unmet threshold, and the catalogue rating. It also says that a heat pump's
  efficiency does not yet change with flow temperature.

## Browser check (1440×900)

The check rendered Bridgewater's summary from `scripts/108_sizing.mts`: radiators sized for 70/60, heat pump at 50/40.
It used a scratch page that is not committed, with the component inside the panel's frame and no console errors.

- `05_panel.png`: one pair. All five storeys are short. Storey 1 gives 10.4 kW against 23.2 kW, with 634 h below and
  a lowest of 18.0 °C, and needs 61.0 kW rated against 27.4 kW there now. These match `04_sizing.json`.
- `05_panel_whatif.png`: 70/60 beside 50/40. Zones short go from 5 to 0. Heating delivered is 111.8 against 116.7 MWh,
  and energy used 555.0 against 556.8 MWh.
- `05_panel_cannot.png`: 30/20 cannot be compared. The return (20 °C) must be above Storey 1's setpoint (21 °C).

The check on the editor's own fixture waits for the editor to place the component and add emitters to its forms. The
editor has been told.

## Tests

`sim2/run/__tests__/emitterSizing.test.tsx` has 5 tests, rendered to static markup:

- nothing without emitters;
- the one-pair sentences, including the rating;
- the fixed-output note with no rating;
- the two-pair tables;
- the what-if refusal.

The full suite has 212 tests and they pass. `npm run build` is clean.

## Browser check on the editor's fixture (15 Nov, after the editor placed the component)

Branch `sim2/110-model-workspace` at 8a837c2, run in a scratch worktree at 1440×900 and never pushed. The steps:

1. `/model`, then the two-zone fixture through `window.sim2.loadPlan`.
2. Yeovilton TMYx through the file input.
3. Systems, then Heating: the VRF heating system set to "Air Source Heat Pump — Space Heating" at 45/40 °C and applied to
   the whole building.
4. Emitters: one radiator per room, rated 2 kW at 75/65/20 °C, n 1.3, 30 % radiant, applied to the whole building.

There were no page errors.

| | Zone 1 (21 °C) | Zone 2 (16 °C) |
|---|---|---|
| Output at 45/40 | 0.7 kW | 0.9 kW |
| Peak need | 3.6 kW | 1.2 kW |
| Hours below / lowest | 5,280 h / 12.0 °C | 472 h / 13.3 °C |
| Rating needed | 10.7 kW | 2.8 kW |
| Output at 55/45 | 1.0 kW | 1.2 kW |
| Hours below at 55/45 | 4,102 h | 0 h |

**Checks:**
- **By hand.** 2,000 × (LMTD(45,40,21) / 49.83)^1.3 = 2,000 × 0.334 = 667 W. With the room at 16 °C it is 877 W.
- **Against the document.** The same document (`window.sim2.getDocument()`) run through `simulate` in Node gives
  667 / 877 W, 5,280 / 472 h and 10,665 / 2,772 W. This matches the page to the figure.
- **Building.** 6.7 MWh heating at 45/40 against 7.9 MWh at 55/45.

**One fault found and fixed.** At 55/45, Zone 2 was 9.6 W short with 0 hours below, and showed "0.0 kW short". A
shortfall under 50 W now reads "under 0.1 kW". There is a test for it. Screenshots: `05_editor_45_40.png` and
`05_editor_compare.png`, taken before the review wording below.
