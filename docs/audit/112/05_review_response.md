# Brief 112 — response to the independent review

16 Nov 2026. Review: [`05_independent_review.md`](05_independent_review.md). Branch `chris/112-demand-energy-split`, on top of the editor's P5 (1ff8849).

| # | Finding | Response |
|---|---|---|
| F1 | High: the 2.7 → 2.8 upgrade fills today's gain fallbacks | **Fixed.** `stateTodaysGainInputs` now runs only from 2.0–2.2 (`upgrade.ts`). New test in `upgrade.test.ts`: a 2.7 Bridgewater document with occupancy rate, W per person, area share, gain fraction and daylight factor left out upgrades to the 2.8 document with them still left out. It fails without the fix. (In 2.3 and later "unstated" is a missing key, not null; the schema has no null for these.) |
| F2 | Medium: the seam refuses every 2.7 document | **Fixed.** The seam upgrades 2.7 (`seam.ts`), after F1, so nothing is filled. New test in `seam.test.ts`: a 2.7 document gives the same zone results as its 2.8 form. The two upgrade refusals are intended and now stated in `01_schema.md` §7: per m² with a zone without occupancy is refused (no place for it, and dropping it would be silent); litres with no basis are dropped (today's engine never used them). |
| F3 | Medium: lighting controls stayed on the space | **Recorded, not moved.** `01_schema.md` §6: daylight and presence stay on the space's lighting profile; Brief 114's Controls step moves them. The editor's P5 STATUS line says the same. |
| F4 | Low: the lux path's area share is untested | **Fixed.** `demandSplit.test.ts`: lux at area share 0.5 equals the stated W/m² at 0.5 hour for hour, and is half the full-floor lux gain. |
| F5 | Low: the Rule 11 guard catches names, not arithmetic | **Strengthened.** The guard strips strings, comments and calls of `lightingWm2`, then refuses any lux or efficacy name with `*` or `/` on either side. It scans `frontend/src` and `scripts/`. Its own test checks it catches the review's three mutations (`lux * e / 100`, `(lux * eff) / 100`, `lux * 0.01 * e`) plus `e * p.lux`, and passes words and the gains' call. One file is allowed by name: `scripts/112_gate.mts`, which restates a stated W/m² as lux (the inverse, to test the path; declared in `04_gate.md`). The behavioural check the review suggested is in place through P5: the editor's inspector line reads `lightingWm2`. |
| F6 | Low: plain words and trace | **Fixed.** A WORDS row for `zones[i].profile_refs.lighting` ("Lighting in *room* is stated in lux, so it needs a lighting system with its efficacy (W/m² per 100 lux)."). The converter's trace points at every occupancy profile the litres are copied to. `lighting.ts` cites `lightingOneDerivation.test.ts`. STATUS P3 says occupants × occupancy rate. |
| F7 | Low: anchor re-run not recorded | **Recorded.** `node scripts/_brief93_anchor.mjs --fixture validation/fixtures/bridgewater_anchor_v2.yaml` gave 133.2 in the cloud container on 16 Nov 2026, on the anchor EPW (sha c6571102…cf2). Not re-run on IT15; today's engine is untouched by this brief. |
| F8 | Note: per m² hot water in a space with no people | **Open, for the editor.** The editor's P5 makes hot water a per-space input; a space type with no people and per m² use is still named on the page and left out. Writing a zero-density occupancy profile to carry it is allowed by the schema; whether the editor does that is its call (noted in STATUS). |

## Checks after the fixes

v2 suites (`src/thermal`, `src/sim2`): 401 pass, none skipped (the anchor EPW is present here). Build clean. Anchor re-run after the fixes: 133.2.
