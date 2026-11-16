# Brief 112 — final report

16 Nov 2026, branch `chris/112-demand-energy-split`. Simulate v2 only. Today's engine untouched (anchor 133.2).

## What a person gets

- **Spaces say what the room needs.** Each space type states the light it needs (lux) and its hot water use (litres a day per person or per m²), beside its people and equipment. The inspector shows the lighting power it comes to as a read-only line ("5.0 W/m², from 200 lux × 2.5").
- **Systems say how the kit meets it.** A lighting system is its luminaires' efficacy (W/m² per 100 lux), on electricity. The hot water system keeps the store, tap and cold temperatures, the pump and its hours.
- **Lighting heat arrives with the luminaires.** At "+ Spaces" there is no lighting heat, and the page says so ("Lighting heat appears at + Systems, because it depends on the luminaires"). At "+ Systems" it arrives.
- **Older models still open and run.** A W/m² stated before lux existed stays, shown as "stated, not from lux". Nothing is guessed: no lux, no efficacy, no gain inputs.

## Parts

| Part | Commit | Result |
|---|---|---|
| P1 schema 2.8 | 798a124, 52daba3 (editor) | `lux` on the lighting profile or a stated W/m², not both; `efficacy_w_m2_per_100lux` on the lighting system; hot water `dhw: {basis, litres_per_day}` on the occupancy profile; the 2.7 upgrade copies the building's litres onto every occupancy profile |
| P2 one derivation | 3102d76 | `lightingWm2` in `thermal/engine/lighting.ts` is the only place lux becomes W/m², held by a test (strengthened at P5 review) |
| P3 levels | 95ebc4f | "+ Spaces" removes lighting (Rule 8); closure holds at all three levels (Rule 9) |
| P4 gates | e76dd3e | Bridgewater restated as 100 lux × 2.0 gives every end use exactly (0 kWh difference; lighting 39.014 MWh, v2 EUI 131.89); the two-zone fixture closes at all three levels; 107 gate byte for byte |
| P5 workspace (editor) | 1ff8849 | Spaces and Systems steps, the inspector line, the Lighting system kind, old plans' litres onto space types |
| P5 review | e7d2cb5 | F1–F8 answered ([`05_review_response.md`](05_review_response.md)); F1 (2.7 upgrade filled gain fallbacks) fixed |

## Tested against a real project

Bridgewater (the anchor fixture and its EPW), five storeys:
- the P4 gate, stated W/m² against lux × efficacy (identical);
- the three levels;
- the editor's browser check on Bridgewater with 200 lux and LED 2.5 (+ Spaces heating 41 kWh/m², + Systems 36, lighting 5.3 MWh, energy used 85 kWh/m²).

Anchor 133.2, re-run in the cloud container on 16 Nov after the review fixes. 401 v2 tests pass with the EPW present, none skipped. The build is clean.

## Open, recorded

- Lighting controls (daylight, presence) stay on the space's lighting profile until Brief 114's Controls step (review F3).
- Two lighting systems with different efficacies in one lux zone are refused for now.
- A space type with no people and per m² hot water is named on the page and left out of the model (review F8, the editor's call).
- Fresh air stays on the ventilation system (editor's P5 note).
- The anchor re-run on IT15 the brief asks for was done in the cloud container instead; today's engine is untouched.
