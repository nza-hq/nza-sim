# Brief 114 P1: schema 2.10

`frontend/src/thermal/schema/model.ts`, upgrade in `upgrade.ts` (`to210`). The 2.9 → 2.10 upgrade fills nothing; the seam accepts 2.9 documents.

| Field | Where | Meaning |
|---|---|---|
| `pumps` | `system_groups[]` (heating, cooling, hot water only) | `{ power: {w} \| {w_per_kw_capacity} \| {w_per_m2}, speed: 'fixed' \| 'variable', runs: 'continuous' \| 'with_demand' \| 'schedule', schedule_ref, default_from }`. Null: none stated. |
| `runs`, `demand_min_fraction` | `zones[].ventilation[]` | `'continuous' \| 'schedule' \| 'demand'`; null keeps the schedule as before. Demand needs its least share. |
| `other_loads[]` | document | `{ id, kind: 'lift' \| 'external_lighting' \| 'other', label, power_w, runs: 'continuous' \| 'schedule' \| 'dusk_to_dawn', schedule_ref, default_from }` |
| `controls[]` | document | `{ id, target: { kind: 'system' \| 'ventilation' \| 'lighting' \| 'window', ref }, controller: 'central_bms' \| 'local' \| 'time_clock' \| 'manual' \| 'photocell', hours_ref, note, ...window fields }` (shape agreed with Brief 115). |

`w_per_m2` is added beyond the brief's two forms because the published defaults (NCM Table 14) are W per m² of floor.

**Refused by the schema, by path:** pumps on a lighting, small power or auxiliary system; a schedule on pumps that run with demand or continuously; a missing or unknown schedule; demand fans without a least share, or with a schedule; two control entries for one target; a control target that does not exist; `hours_ref` on anything but a window (a system's hours live on the system or zone); window fields on a non-window entry; an adaptive window rule without its EN 16798-1 category.

**Refused by the engine, by name:** an auxiliary profile whose id or label says "pump" beside system pumps (counted twice); demand fans in a zone with no occupancy profile.

**Where the controls' figures live.** Setpoints, setbacks and heating hours stay on the zone (`setpoints`), lighting controls on the lighting profile, pumps and fans on their system: the Controls step edits them there (00_reconnaissance.md decision 1).

**Defaults.** `thermal/catalogue/auxiliaryDefaults.ts`: NCM Modelling Guide 2021 Table 14 (p. 32; W/m², constant speed: heating 0.6, cooling 1.8 − 0.6 = 1.2), paired with the heating hours as NCM does for the Actual building (para 103; para 62 is the Notional twin), paras 66–67 (p. 23: the **Notional building's** SFPs 0.4 / 0.6 / 0.9 W per l/s; for the Actual building NCM leaves SFP to the user, paras 108–109). NCM gives a Notional secondary hot water circulation pump (para 58(d)); a hot water system's `pumps` here are its primary pumps, for which there is no published figure. (Citations corrected after the independent review, F9.) `defaultPumps(doc, id)` fills a system's pumps only when it has a water circuit (design flow stated, or wet emitters), labelled with the source. Read through a text extraction (the proxy blocks the PDF): to check against the page on IT15.
