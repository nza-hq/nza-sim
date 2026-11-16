# Brief 112 Part 1: schema 2.8, the demand/energy split

16 Nov 2026. Linzie's rule (16 Nov 00:22, 00:41): "Spaces is demand, Systems is energy".

## Where each field lives

| Thing | Space (demand) | System (energy) |
|---|---|---|
| Lighting | `lux` on the space's lighting profile, **or** `magnitude` (a W/m² stated directly, "stated, not from lux") | `efficacy_w_m2_per_100lux` on the lighting system group |
| Hot water | `dhw: { basis: per_person \| per_m2, litres_per_day }` on the space's occupancy profile | `services.dhw`: store, tap and cold temperatures, load shape, pump; the heater's efficiency on the hot water system group |

- In the document, a "space type" is its profiles: the editor writes one occupancy, lighting and equipment profile per space type (`sim2/geometry/toDocument.ts`). So the space's demand sits on those profiles, beside the people per m² and the equipment W/m² that already live there.
- **One derivation (Rule 11).** W/m² = lux ÷ 100 × efficacy is worked out only in `thermal/engine/lighting.ts` (`lightingWm2`). The efficacy of a zone's luminaires is read by `zoneEfficacy`. The W/m² is never stored on the document.

## Choices made, and why

1. **Older documents keep the stated W/m² form.** The upgrade guesses no lux and no efficacy, so today's models still open and run unchanged (the brief's recommendation).
2. **A lighting profile states lux or a W/m², not both.** If it stated both, which one counts would be hidden. The schema refuses it by name.
3. **Two lighting systems with different efficacies in one lux zone are refused for now.** The gains would need to split the light by share, each share at its own W/m². Two systems with the same efficacy are fine.
4. **Hot water litres are copied onto every occupancy profile** by the upgrade and by today's converter. Every zone then uses what it did before.
   - **Per m² with a zone that has no occupancy is refused, naming the zone.** Such a zone had hot water before, and the new shape has nowhere to carry it. It is refused rather than dropped.
   - In the editor, a space type with no people and per m² use gets a note on the page (the editor thread's part of this P1).
5. **A hot water system with no space stating use is named**, as stated use with no system already was (Brief 107 review F1).

## Checks

- `demandSplit.test.ts` (10 tests): lux × efficacy against the stated W/m², hour for hour; the refusals; the upgrade.
- Systems: a heater with no use is named.
- The converter's trace follows the move (`schema.test.ts`, every copied value verbatim).
- Bridgewater is unchanged. Re-running `scripts/107_gate.mts` rewrites `docs/audit/107/02_gate.json` byte for byte, and the anchor is still 133.2.
