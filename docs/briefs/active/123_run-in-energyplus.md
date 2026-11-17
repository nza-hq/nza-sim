# Brief 123 — Simulate v2: Run in EnergyPlus (the third tier)

**Asked by:** Linzie, 17 Nov 2026 10:27: "Instant, 15 minutes, then Energy+". Earlier, in the project chat: "as soon as we start doing the other, different, detailed way (which needs a run because it's more complex), we might as well do it the exact same way that the industry recognises now."

**Scope (CLAUDE.md process rule 10).** A results feature across Building, Operation and Systems. It changes no module's data model and no engine's physics. EnergyPlus is a third result, shown beside NZA Sim's hourly run and never merged with it (Rule 11). It reads from EnergyPlus what EnergyPlus produces: each room's heating, cooling and temperatures (Rule 7). Energy in its column is those loads through the systems' stated efficiencies, by the same conversion as the hourly run, and is labelled so.

## BEFORE DOING ANYTHING

- [x] Read CLAUDE.md, STATUS.md and this brief.
- [x] EnergyPlus 25.2.0 is installed where it will run (IT15: `C:\EnergyPlusV25-2-0`; the container: the Linux build).
- [x] Weather files stay out of git (EPW files are not redistributable).

## Hosting decision

EnergyPlus cannot run in a browser. The runner (`frontend/plugins/energyplusRunner.js`) is plain Node with no packages, mounted as Vite dev-server middleware (`frontend/plugins/energyplus.js`, ahead of the `/api` proxy). So `npm run dev` on a computer with EnergyPlus installed runs it, with no extra server, account or cost. A cloud runner can later mount the same three routes; that is an account and cost decision for Linzie, so it is not taken here.

**Deviation from Rule 5, stated.** Rule 5 puts EnergyPlus input generation in Python `nza_engine/`. That is today's app. Simulate v2's model document, engine and seam are TypeScript in the browser, so the translator is TypeScript beside them (`thermal/energyplus/toEnergyPlus.ts`) and the runner is Node. The Python path is untouched.

## Parts

1. **Translator** `frontend/src/thermal/energyplus/toEnergyPlus.ts`: ModelDocument → epJSON plus an hourly `schedules.csv`, using the U-values, bridging, air-change rates and vent coefficients the hourly run itself used. Refuses in words what it cannot carry yet (weather-driven air, other ground methods, a non-8,760-hour year, windows with no host). Every approximation is a note shown with the results.
2. **Runner** `frontend/plugins/energyplusRunner.js` and middleware `frontend/plugins/energyplus.js`: `GET /api/sim2/energyplus/status`, `POST /runs`, `GET /runs/:id`; one run at a time, own temp folder each, Version set to the installed EnergyPlus.
3. **Check** `scripts/123_energyplus.mts` → [`docs/audit/123/01_check.json`](../../audit/123/01_check.json), report [`docs/audit/123/01_check.md`](../../audit/123/01_check.md): Bridgewater (anchor fixture, five storeys, Yeovilton) and the community centre as drawn and with run B's hours (Gatwick).
4. **Workspace**: "Run in EnergyPlus" beside Run in the strip, and an EnergyPlus section on Heat flow: NZA Sim and EnergyPlus side by side (heating, cooling, peaks, energy, EUI; by zone; by month; the notes; warnings and severe errors). Its own worker (`sim2/run/energyplusWorker.ts`). Greys and says so when the model has changed since.
5. **Tests and close**: `thermal/energyplus/__tests__/toEnergyPlus.test.ts` (windows in their hosts, room-to-room pairs opposite, areas match, schedules complete, refusal); full suite and build; browser check at 1440×900; STATUS.md, CLAUDE.md.

## Follow-ups (not in this brief)

- Weather-driven air through EnergyPlus AirflowNetwork.
- Overhangs and fins (the model holds no window positions yet).
- System capacity (Brief 120) and wet emitters re-rated hourly (Brief 108) are carried as fixed per-room caps.
- The office's first hour of cooling in community centre run B (see the report).
- A cloud runner, if Linzie wants EnergyPlus without a local install.
