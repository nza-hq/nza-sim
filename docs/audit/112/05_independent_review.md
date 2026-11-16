# Brief 112 — independent review (engine parts P1–P4)

16 Nov 2026. Branch `chris/112-demand-energy-split`, commits a658aa7..e76dd3e (P1, P1 editor, P2, P3, P4). This is a read-only review. No code was changed on the branch and nothing was pushed. The builder answers in `05_review_response.md`.

**What was run here:**

- The v2 suites (`src/thermal`, `src/sim2`): 394 pass and 2 skip. The two skipped tests need the anchor EPW. That makes 396, which matches the builder's count.
- Seven mutations of the new code (table below).
- The P4 Bridgewater gate, re-run on the committed Denver weather with five lux and efficacy pairs instead of one.
- The three levels on Bridgewater (Denver).
- A 2.7 document put through `upgradeDocument` and through the seam.

**Not run here:** anything on the anchor EPW. The proxy still blocks the download. Today's engine is untouched (see the table), so 133.2 holds by construction, but the re-run on IT15 that the brief asks for is not recorded with a place or time (F7).

## Verdict

The split is built cleanly and the three engine claims are true:

- Lighting from lux × efficacy gives exactly what the stated W/m² gives.
- Lighting heat leaves "+ Spaces" and arrives at "+ Systems", by removal and not by muting.
- Hot water use now sits on the space.

No tuning was found. Bridgewater's 100 lux and 2.0 efficacy are openly derived from its stated 2 W/m², and the doc says they are not survey values.

There is one real bug, and it should be fixed before close. **A 2.7 document is upgraded with today's gain fallbacks filled in (F1). The seam also refuses every 2.7 document outright (F2).** P1 bumped the version but did not carry two version lists along with it, as 119 did for 2.6.

## The checks asked for

| Check | Result |
|---|---|
| **No tuning (Rule 10)** | **Confirmed.** No constant in `thermal/engine` changed. The gate's lux = 50 × W/m² at 2.0 W/m² per 100 lux is declared in the script header and in `04_gate.md` as "picked to reproduce today's input". I re-ran it with 400 × 0.5, 300 × ⅔ and 250 × 0.8: every end use is identical (0 kWh). 200 × 2.0 doubles lighting to 78,029 kWh, so the path is linear and live. |
| **Today's engine untouched** | **Confirmed.** The diff touches only `thermal/`, `sim2/`, `scripts/112_gate.mts`, docs and STATUS. Nothing in today's engine or `nza_engine/` changed. |
| **Schema 2.8** | Lux on the lighting profile, `efficacy_w_m2_per_100lux` on the system group (refused on other services), and lux and a W/m² together are refused. Hot water `dhw: {basis, litres_per_day}` sits on the occupancy profile, and `services.dhw` keeps only temperatures, shape and pump. **Correct, apart from the upgrade path (F1, F2) and the missing controls (F3).** |
| **No invention (lighting)** | **Holds for lighting.** The upgrade guesses no lux and no efficacy; old documents keep the stated W/m². **Broken for gains generally on 2.7 → 2.8 (F1).** |
| **Rule 11 (one derivation)** | `lightingWm2` is the only place lux becomes W/m², and the gains are its only caller. Lighting energy reads the gains' `electric_w`, so it goes through the same function. **The guard test is a name-pattern check and can be walked past (F5).** |
| **Rule 8 (levels remove)** | **Confirmed.** `levelDocument` removes lighting profiles and references at '+ Spaces'. The mutation that keeps them is caught by `levels.test.ts`. On Bridgewater (Denver) there is no lighting term at fabric or spaces, and 39,014 kWh at systems. |
| **Rule 9 (closure at three levels)** | **Real.** The engine refuses a run whose hourly balance misses (`checkClosure`, integrand against display), so every run that returns has closed. The gate's own "closes" column re-sums the displayed lines (display against display). That is a harmless second look, not the proof. The proof is that the run returned. |
| **Bridgewater exact** | **Confirmed independently** on Denver weather: EUI 148.33 for both stated and lux forms, and lighting 39,014.30 kWh (lighting does not depend on weather here). |
| **Tests (396)** | 394 + 2 skips without the EPW = 396. **Confirmed.** |

## Mutations

| # | Mutation | Caught? |
|---|---|---|
| M1 | `lightingWm2` ignores lux and returns the efficacy | **Yes** (2 tests). The 300 × 2.5 unit test catches it. The Bridgewater gate alone would not, because there lux ÷ 100 = 1. |
| M2 | Lux path drops `areaShare` | **No** (F4) |
| M3 | '+ Spaces' keeps lighting | **Yes** (1) |
| M4 | A second derivation written `lux * e / 100` in `seam.ts` | **No** (F5) |
| M5 | A hot water system with no use stated is no longer named | **Yes** (1) |
| M6 | Hot water basis ignored (always per person) | **Yes** (4) |
| M7 | The upgrade stops copying litres onto occupancy profiles | **Yes** (5) |

## Findings

### F1 — High: the 2.7 → 2.8 upgrade fills today's gain fallbacks into null fields

In `upgrade.ts:117`, `stateTodaysGainInputs` runs for every `from` that is not 2.3–2.6, so it now runs for 2.7. That fills in, among others:

- occupancy rate 0.75 and 75 W per person;
- area share, gain fraction and relationship;
- daylight factor;
- radiant fraction 0.3.

It fills them on every gain profile where the 2.7 document left them null. In 2.3 and later, null means "not yet stated", and the engine refuses it by name.

I reproduced this. A 2.7 occupancy profile with `occupancy_rate`, `sensible_w_per_person` and `radiant_fraction` all null comes out of `upgradeDocument` as 0.75 / 75 / 0.3, and a null lighting profile comes out with area share 1 and gain fraction 1. This is the 105 review's F1 coming back.

**Fix:** add `'2.7'` to that exclusion, and add an upgrade test that a 2.7 null stays null.

### F2 — Medium: the seam refuses every 2.7 document

At `seam.ts:411` the seam upgrades only 2.3–2.6. A 2.7 document gets "This building was saved in an older format (2.7). Open it in the editor and save it again", which I reproduced. Brief 119 added 2.6 to this list when it bumped the version. 112 did not add 2.7.

Saved versions and runs stored at 2.7 (Brief 102 stores the document) will not re-run until they are re-saved. That may be acceptable, but it is not stated anywhere. If 2.7 is added, F1 must be fixed first, or the seam will run filled-in fallbacks.

Two cases still need a decision:

- The 2.7 → 2.8 upgrade refuses "per m² with a zone without occupancy".
- It discards litres stated with no basis.

Both are fine as refusals. Say which behaviour is intended.

### F3 — Medium: lighting controls stayed on the space, not on Systems

The brief's table puts "controls (daylight, presence)" under Systems, and P1 says "Systems gain efficacy **plus controls**". On the branch:

- `daylight_factor` and `relationship_to_occupancy` (presence and spill) are still on the space's lighting profile.
- The system group's `control_factor` only weights the energy split between groups. It never reduces lighting.

So after 112, lighting's demand side still carries its controls. Brief 114 amends the brief to move controls to a new Controls step, which may be the intended home. Either way, `01_schema.md` does not mention the deviation, and P5's "each field appears on exactly one step" depends on it.

**Fix:** state where daylight and presence live now and which brief moves them.

### F4 — Low: the lux path's area share is untested

Removing `areaShare` from the lux branch (`gains.ts:226`) passes all 396 tests. Every lux test and the gate use `area_share: 1`. The code is right today. Add one case with area share below 1, compared against the stated W/m² form.

### F5 — Low: the Rule 11 guard catches names, not arithmetic

`lightingOneDerivation.test.ts` looks for `efficacy` next to `*` or `/`, or for `lux / 100`. A second derivation written `lux * e / 100`, `(lux * eff) / 100` or `lux * 0.01 * e` passes (M4). It also does not scan `scripts/` or anything outside `frontend/src`. That is acceptable as a tripwire, but it does not hold the rule the way the brief says.

**Possible fix:** make `lightingWm2` the only exported route, keep efficacy behind `zoneEfficacy`, and add a behavioural test that the inspector's line (P5) equals the gains' W/m².

### F6 — Low: plain-words and trace details

- The "lux with no lighting system" refusal reads "…(W/m² per 100 lux) (zones[0].profile_refs.lighting)." with the raw path showing. It falls through to the fallback in `explain`. Add a WORDS row for `zones[i].profile_refs.lighting`.
- The converter's trace points the hot water litres only at the **first** occupancy profile, though the litres are copied to all of them. That is fine for Bridgewater, which has one. Say so in the trace, or point at each copy.
- `lighting.ts`'s header cites `__tests__/lighting.test.ts`, but the file is `lightingOneDerivation.test.ts`.
- STATUS P3 says hot water is per "design occupants". The code uses `occ.people`, which already includes `occupancy_rate` (0.75 by default). This is unchanged from 107, but the wording should match the code.

### F7 — Low: the anchor re-run on IT15 is not recorded

The brief's P4 says "Re-run the 133.2 anchor on IT15". `04_gate.md` says the anchor script "still gives 133.2" but not where or when it ran. Since today's engine is untouched this is a formality. Record it at close.

### F8 — Note (editor's P1): per-m² hot water in a space with no people now leaves the model

Before 112, per-m² hot water applied to every zone's floor. Now `toDocument.ts` writes `dhw` only onto occupancy profiles, so a space type with no people (a kitchen, plant or store with per-m² use) loses its hot water. The loss is named on the page ("not in the model until it has people"), so it is not silent.

But the schema allows `dhw` on an occupancy profile with zero density, and `systems.test.ts` does exactly that. So the editor could write such a profile and keep the hot water. Worth deciding in P5, where hot water becomes per space.

## Not checked

- Anything on the anchor EPW: the 107 gate's byte-for-byte rewrite, and 04_gate.json's own numbers. My Denver re-run reproduces their shape: exact equality, lighting 39,014 kWh, no lighting at fabric or spaces.
- The editor's P5 (not built yet).
- The heat-flow sentence "Lighting heat appears at + Systems, because it depends on the luminaires". It exists only as a code comment in `seam.ts`, and showing it is a P5/UI job.

Review scripts (scratch, not committed): `probe112.mts` (Bridgewater on Denver, five lux and efficacy pairs, refusals, levels), `up27.mts` and `seam27.mts` (F1, F2), `mut.sh` (M1–M7).
