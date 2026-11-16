# Brief 114: the Controls step and back-of-house energy — final report

16 Nov 2026, branch `chris/114-controls`. It is stacked on 120 (PR #44, which includes 112) and merges in the editor's P4 (`sim2/114-editor`, PR #46).

Asked by Linzie, 16 Nov 00:57: "a place to put in … back-of-house auxiliary energy, just so we've got some defaults: pumps, whether they're inverter-driven, and fans, whether they run continuously … almost like a little BMS section … a single place to view everything all at once."

## What was built

**Schema 2.10.** Older documents upgrade with nothing filled.
- **Pumps on each heating, cooling or hot water system.**
  - Power is given as W, W per kW, or W per m² of the floor served.
  - Speed is fixed or variable (inverter).
  - They run continuously in the system's season, with demand, or to a schedule.
  - The season is the months stated, or with none the months with load (Linzie 23:11).
- **Fans run continuously, to a schedule, or on demand.** On demand, they follow the people inside their hours and never go below a least share.
- **Other building loads:** lifts and external lighting. External lighting can run dusk to dawn, optionally inside a time clock.
- **A control map.** Each system, fan, lighting or window entry records who controls it (central BMS, local, time clock or manual) and a note. The controller is recorded and listed as "not yet used in the calculation"; it changes no number.

**Engine** (`thermal/engine/pumps.ts`, `systems.ts`, `ventilation.ts`).
- Pumps are a `pumps` end use. Other loads count as `auxiliary`. Both are electricity, appear only at "+ Systems" (Rule 8), and warm no room.
- An inverter pump follows EnergyPlus's default pump curve: power in proportion to load. This is labelled as ideal (Linzie 23:11, "Keep ideal, clearly labelled").
- A pump is sized on its system's capacity. Without one, a heating system's pump is sized on its rooms' design heat loss (Brief 117). Without either, W per kW is refused by name.
- Double counts beside old auxiliary profiles are refused by name: pumps, circulators, lifts and external lighting.

**Defaults ("Use defaults").**
- They come from NCM Modelling Guide 2021 (England), Table 14 (p. 32), constant speed: heating 0.6 W/m², chilled water 1.2.
- They are paired with the rooms' heating hours (para 103) when the rooms share them.
- They are filled only for systems with a water circuit (none for VRF or split systems), and labelled with their source.
- The fan SFPs are NCM's Notional building values.

**Screens** (editor thread, P4).
- Systems has a pumps block per system with "Use defaults", other loads, and how the fans run.
- The **Controls** step (step 7) holds the control map, the week over occupancy, flags, and preview-then-apply. It also writes each space type's heating hours and setback.

## Evidence

| Check | Result |
|---|---|
| EnergyPlus referee, two radiator rooms ([`02_referee.md`](02_referee.md)) | Fixed with demand −0.7 %, variable −2.7 % (pass). Continuous −25 % as written, because EnergyPlus runs all year. It is exact given the same season, and Linzie chose the season. |
| Bridgewater, five storeys, Denver | Byte for byte the same as before 114 when nothing new is stated: digest `2da3e6b5…e58b`, re-run after every change. NCM pumps change only the pumps line. All three levels close. |
| Today's engine | Untouched, so the anchor of 133.2 holds. |
| Owed from 120 ([`05_owed_from_120.md`](05_owed_from_120.md)) | Cooling capacity on one room equals 119's unit limit. Held-out wet case: shares 0.595/0.405 against EnergyPlus's 0.592/0.413. Heating is −3.4/−3.2 %, a narrow fail of ±3 %, matching the rooms' own −3.7/−4.0 % with no plant. |
| Independent review | 11 findings, all answered ([`05_review_response.md`](05_review_response.md)). Two went to Linzie on cards and were both answered 16 Nov 23:11. |
| Tests | 460 v2 tests: 458 pass, 2 skip (the anchor weather file is not in this container). Build clean. |

## Open, and owed

- The inverter saving (about 60 %) is larger than NCM's 17–50 %. It is shown as ideal; calibration against meters will tell.
- The NCM PDF's sha256 is still to be recorded on IT15.
- Sharing cooling capacity between rooms has no EnergyPlus referee.
- Window control rules wait for Brief 115. Their shape in `controls[]` is agreed.
- The pumps block should offer the season months (`season_months`). This is a small editor follow-up.
