# Brief 105: response to the independent review

The review is [`07_independent_review.md`](07_independent_review.md). Its verdict: no tuning, and Rules 2, 3 and 9 hold. None of the nine findings blocks the close.

| # | What was done |
|---|---|
| F1 | **Fixed.** The seam now refuses a document in an older schema version, with "This building was saved in an older format (…). Open it in the editor and save it again", instead of upgrading it and filling today's fallbacks. Converted documents (Brief 103's pattern) still go through the converter, which writes the current version. Test: `seam.test.ts`. |
| F2 | **Fixed.** The panel's ⓘ now says the 4 % / 10 % are "with the same air density", and quotes −11 % / +10 % with EnergyPlus's default outdoor air density. |
| F3 | **Follow-up.** A per-zone breakdown on tap, including heat from neighbouring zones (the engine already has the lines). Carried to the next brief. |
| F4 | **Stated** in [`02_gains.md`](02_gains.md): a gain profile with no schedule of its own uses the occupancy schedule, as today's tool does. |
| F5 | **Fixed** in `gains.ts`: an active schedule exception without values for the day type is refused (at `….schedule.exceptions`), not read as 0; `area_share` below 0 is refused; `gain_fraction` and `standby_factor` outside 0–1 are refused, not clamped. Four new expectations in `gains.test.ts`. The fixed daylight hours (9–16) are stated in `02_gains.md`. |
| F6 | **Stated, follow-up.** A construction the document does not pin in `library_refs` runs on whatever the library holds. The editor writes pins for what it uses; requiring a pin for every construction (or listing the unpinned ones in the panel) is carried to the next brief. |
| F7 | **Fixed** in [`06_per_floor.md`](06_per_floor.md): the reason TARP is not in `REFEREE_OPTIONS` is that those options are spread into the editor's run options, and the five-storey speed miss (1.0–1.2 s against 150 ms) is recorded. |
| F8 | **Fixed** in `network.ts`: with sub-steps, an hour's closure is now the mean of each step's own residual size, so residuals of opposite sign cannot cancel. One step an hour gives the same values as before; all thermal and sim2 tests pass (156). |
| F9 | **Note kept.** Ventilation uses 0.33 Wh/m³K, and an MVHR with summer bypass is refused, not modelled. Library MVHR templates with `summer_bypass: true` will be refused until bypass is modelled. |

The anchor is unchanged at 133.2: no file of today's engine changed.
