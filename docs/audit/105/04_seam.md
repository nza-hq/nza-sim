# Brief 105 Part 4: the run seam

**`frontend/src/sim2/run/`** is a new folder. The editor thread's folders are untouched.

| File | What it does |
|---|---|
| `library.ts` + `constructions.json` | Resolves each `construction_ref.key` to its library body and turns the body's epJSON layers into the engine's `layers` (`bodyFromLibrary`). The bodies are the committed Brief 102 export, whole (`scripts/sim2_run_constructions.mjs`), with their body hashes. This is the one file to swap when the seam reads NZA Sim's Supabase library. |
| `weather.ts` | A weather choice is either a local EPW read in the browser and never uploaded, or one of the organisation's files in the private `weather` bucket. The choice carries the file name and the station from the EPW header, so the panel can show both. |
| `seam.ts` | `simulate(doc, { weather }) → { ok, results, summary } \| { ok: false, missing }`. |
| `worker.ts`, `client.ts` | The seam in a web worker that holds the parsed weather. The run is debounced on edit, and only the latest run's answer is kept. |

## `simulate`

**1. The document is checked against schema 2.3.** An older stored version is upgraded first. A failure becomes a list
of missing inputs, never an exception.

**2. Preflight gathers every gap at once:**
- the weather file;
- each construction:
  - `unassigned:*`;
  - not in the library;
  - a body that is not the one the document pinned;
- the building's thermal bridging;
- each zone's heating and cooling setpoints;
- each zone's air leakage.

**3. The run.** Engine 2 on `REFEREE_OPTIONS` (the configuration the EnergyPlus gates passed on), with gains from
profiles and the document's ventilation.
- Anything the engine still refuses comes back named by its path, in words. Examples: "The space type "Lighting" needs
  a lighting power (W/m²).", "Say when the ventilation runs in "Storey 1"."
- No number is returned with a missing input (CLAUDE.md rules 2 and 3).

**4. The summary.**
- building heating, cooling and peaks;
- heating and cooling per zone;
- the building's breakdown, every term summed over the zones (heat between zones cancels, so it is left out);
- the weather file and station.

It is read through the results helpers (Rule 11).

## Checks (`src/sim2/run/__tests__`, 24 tests)

| Check | Result |
|---|---|
| Each of the 15 library constructions against the Bridgewater fixture's (today's database) | Layers, U and g equal, value for value |
| A fragment the converter cannot read | Named by its path |
| Bridgewater pinned to the export | Resolves cleanly |
| A converted document | Pins today's database body, not the export's, so every construction is reported as changed and not run. That is correct: it is a different body by hash. The editor pins the export's. |
| Unassigned, unknown and changed constructions | Each named once |
| `simulate` on Bridgewater's five storeys | Equals `runModel` zone by zone. The building breakdown sums to zero |
| Five gaps at once | All five listed in words, and no summary |
| An engine refusal (lighting with no power; ventilation with no schedule) | Comes back in words |
| A document that fails the schema | Named, not thrown |

## Weather on NZA Sim (dev): migration 0006, applied

- `supabase/migrations/0006_weather_bucket.sql` is applied to `jbjxduathkklruvbmeho` only.
- It creates a private `weather` bucket with a 5 MB file limit.
- Members of an organisation may read `<org id>/…`.

**Reads only.** Storing a file in the bucket from the app is a direct client write. supabase/README.md says writes go
only through security-definer functions, so that would be an exception. It is put to Linzie as a decision, with
"allow editors to upload into their own organisation's folder" recommended. Until it is decided:
- the panel reads a local EPW in the browser;
- files can be placed in an organisation's folder from the dashboard.
