# Brief 119 Part 4 (cooling) — the emitter panel's cooling units

16 Nov 2026. The catalogue's part of the panel lands with Part 3, once Linzie has picked the catalogue.

- **Seam:** `summary.emitters.cooling`, one `CoolingZone` per zone whose units cool: the units' cap (the engine's `cooling_units.cap_w`), the cooling peak from the run with the units unlimited (the same `emitter_limit: 'none'` run 108 sizes heating on), the shortfall, the hours more than 0.5 K above the cooling setpoint (in use, for a zone with hours), the highest temperature and the hours at the cap, each read from the engine's results (Rule 11; `seam.test.ts` Brief 119).
- **Panel:** a "Cooling" block below the heating zones, with today's cooling colour for the bar; the flow-temperature what-if is hidden when no zone has heating emitters (it moves heating water only). The ⓘ says: stated sensible cooling held fixed, moisture not counted, and the EnergyPlus result (up to about a quarter more hours above at about 55 % of the need, within 20 h nearer it).
- **Browser check** ([`04_panel.png`](04_panel.png), 1440×900, `scripts/119_panel.mts`): Bridgewater five storeys on the anchor EPW, radiators as Brief 117's check, cooling-only VRF units of 12 kW on storeys 1–4 and 24 kW on storey 5. Storeys 1–4: units 12.0 kW against peaks of 20.3–20.4 kW, 41–69 hours above, highest 24.8–24.9 °C; storey 5: enough (24.0 kW against 20.4 kW), no hours above. Figures in [`04_panel_summary.json`](04_panel_summary.json).

Sanity: the hours above are few for a peak 40 % above the units because Bridgewater's cooling peaks are short (a gains-driven afternoon); the highest temperature stays within 1 K of the 24 °C setpoint. A cooling-only unit adds no heating emitter (the heating list is unchanged).

**Review F7, measured.** Storey 3 shows 54 h above and a highest of 24.84 °C in the referee, but 69 h and 24.90 °C here, at the same 12 kW. The difference is the neighbours, not the radiators or the step length. Runs of the engine (`runOptionsFor`, one step an hour in every case; no hours_ref):

| run | storey 3 h above | highest | cooling MWh |
|---|---|---|---|
| storey 3's unit only (the referee) | 54 | 24.84 | 14.392 |
| storey 3's unit only, plus radiators at 50/40 | 54 | 24.84 | 14.394 |
| units on every storey (storeys 2 and 4 also limited) | 69 | 24.90 | 14.471 |
| units on every storey, plus radiators (this panel) | 69 | 24.90 | 14.473 |

When storeys 2 and 4 are limited they run warmer, and storey 3 gains their heat through its floor and ceiling.

