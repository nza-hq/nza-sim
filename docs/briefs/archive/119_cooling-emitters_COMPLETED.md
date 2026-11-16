# Brief 119 — Simulate v2: cooling limited by the room's units, and emitters picked from standard sizes

Written 16 Nov 2026 by Linzie's project agent. Linzie, 11:11 (editor thread, agreed as ours at 11:16): emitters fed by cooling systems (a VRF indoor unit heats and cools, so its cooling should be limited too), and emitters picked from a library of standard sizes rather than typed in. After Briefs 108 (heating limited by emitters), 109 (hours and warm-up) and 117 (design heat loss).

## Scope (CLAUDE.md process rule 10)

Systems module: emitter capacity per zone (CLAUDE.md, Brief 108) extended to cooling, and where an emitter's rated figures come from. The Building module's fabric and the comfort band are read, not changed. Engines 1 and 2 gain a cooling limit that mirrors 108's heating limit (Rule 8: a zone with no cooling units states nothing and stays unlimited, ideal loads; no muted values). Schema 2.7, nothing filled by the upgrade. Today's engine is not touched; the anchor stays 133.2.

**Out of scope:** latent cooling and dehumidification (sensible only, said on screen); re-rating a chilled-water coil for its water temperatures (a cooling output is stated at its rating and held fixed, as EnergyPlus's LimitCapacity takes it); refrigerant pipe-length derating; choosing the outdoor unit; any manufacturer beyond the first catalogue until Linzie names more.

## BEFORE DOING ANYTHING

- [ ] Read CLAUDE.md (Systems scope, Rules 8, 9, 11), 108's final report, 117's final report.
- [ ] Branch `chris/119-cooling-emitters` from main (e0f4a79). Anchor at start and close: 133.2.
- [ ] Files claimed: `frontend/src/thermal/schema/`, `frontend/src/thermal/engine/` (v2 only), `frontend/src/thermal/catalogue/` (new), `frontend/src/sim2/run/{seam.ts,EmitterSizing.tsx,emitters.css,__tests__/}`, `validation/energyplus/119_*`, `docs/audit/119/`. Not touched: `sim2/geometry/`, `sim2/library/`, `ResultsPanel.tsx`, `run.css`, `thermal/store/versions.ts` (the editor thread's). The editor picks catalogue items through the plan; this brief gives it the catalogue and the document fields.

## Part 0 — Reconnaissance (`docs/audit/119/00_reconnaissance.md`)

1. Where 108's heating cap enters Engines 1 and 2 (`zone.ts`, `network.ts` mode 2) and what the mirror for cooling needs.
2. Which emitter kinds can cool (fan coil, VRF indoor unit, other; not radiators, underfloor, electric) and what feeds them (a cooling system group, or none for a VRF unit's fixed output).
3. The catalogue: source, edition, what is printed (output at ΔT 50, exponent n), how a document records which item it used, and how the run checks the document's figures against it.
4. The EnergyPlus referee: ZoneHVAC:IdealLoadsAirSystem with LimitCapacity on cooling (sensible), as 108 did for heating.

## Part 1 — Schema 2.7 and the cooling limit

- Emitter gains `cooling_output_w` (one unit's sensible cooling, W, or null: it does not cool) and `cooling_system_group_id` (a cooling group serving the zone, or null for a fixed-output unit). Allowed on fan_coil, vrf_indoor, other; refused by name elsewhere.
- Emitter gains `catalogue_ref: { catalogue, item } | null` (Part 3).
- Engines 1 and 2: a zone whose emitters state any cooling output has its cooling limited to Σ count × cooling_output_w; above it the zone floats over its setpoint. Hours above the cooling setpoint and the highest temperature are reported per zone, as hours below are for heating.
- Hand tests to 0.01 K on both engines; closure every hour (Rule 9); a zone with no cooling units identical to 2.6 byte for byte.
- Commit: `119 P1: schema 2.7, cooling limited by the room's units (Engines 1 and 2)`.

## Part 2 — EnergyPlus referee

Cooled room and Bridgewater five storeys with cooling limited below the peak. Gate as first written: annual cooling ±5 % per zone, hours above the setpoint ±50 h. **Amended by the builder at P2 (review F2):** 108's heating gate, mirrored (annual cooling ±10 %, hours above ±20 % or ±50 h, highest ±1 K), so that the two limits are held to one gate. The change was made in the same commit as the results, and both verdicts are reported in `docs/audit/119/02_referee.md`. Report, never tune (Rule 10). Commit: `119 P2: cooling limit refereed against EnergyPlus`.

## Part 3 — Standard sizes from a published catalogue

- `thermal/catalogue/` holds each catalogue as data, with its source URL, title, edition, retrieval date and, where it can be fetched, its sha256. Each item: id, kind, type, height, length, output at its rating, rating basis (e.g. 75/65/20), exponent n — every figure as printed, none computed.
- The run checks an emitter with a `catalogue_ref` against its item (rated output, rating, n) and names any difference; it never fills from it (Rule 3: the document states its figures; the reference says where they came from).
- Sizing: where a room is short, the panel names the smallest catalogue item(s) of the same kind and height that cover the shortfall at the run's flow temperatures.
- Commit: `119 P3: emitter catalogue and the run's check against it`.

## Part 4 — The sizing panel

EmitterSizing shows cooling beside heating: per room the cooling peak, the units' cooling, hours above, and what would cover it; and the catalogue suggestion for a short room. Browser check at 1440×900. Commit: `119 P4: cooling and catalogue sizes in the emitter panel`.

## Part 5 — Independent review

Ask the coordinator for a review thread; answer in `docs/audit/119/05_review_response.md`.

## Part 6 — Close

Final report, archive, current.md, STATUS.md, CLAUDE.md Systems line (cooling limited by units; catalogue), anchor 133.2, PR to main.
