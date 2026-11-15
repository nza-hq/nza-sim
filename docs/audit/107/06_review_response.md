# Brief 107: response to the independent review

The review is [`05_independent_review.md`](05_independent_review.md). Every finding is fixed or stated. None is left for Linzie to accept.

| # | Finding | What changed |
|---|---|---|
| F1 | Hot water silently dropped | Every zone with hot water use must now be served by a hot water system: per m², every zone with floor; per person, every zone with occupants. Otherwise it is named ("Choose a hot water system for Storey 3"). Hot water use stated with no hot water system is also named. With neither stated, the panel says "No hot water system stated: hot water is not included." Tests: a group on one zone of three; use stated with no group. |
| F2 | Rule 9 check was display against display | `checkServed` compares what the groups serve, per service, with demand computed apart from serving: heating and cooling from the model's annual results, and hot water from the tap-mix summed over every zone before serving. A mismatch throws `ServedError`; the seam shows it as a fault in the tool, never as a number. The review's mutation M3 (one zone's heating dropped before serving) now fails every systems test. |
| F3 | Control factor | A null control factor is refused when more than one group shares a zone's lighting, small power or auxiliary, the only case where it matters. The ⓘ now says controls act through the gains and the factor only splits electricity between systems. |
| F4 | Inputs silently ignored | Capacity, control mechanism and control schedule on groups, and defrost penalty on ventilation, are listed under "Stated but not used yet", per system. A schedule the building lacks is listed as such rather than refused, because Bridgewater's hot water groups name today's library schedules, which are not carried over. Brief 108's emitters will be the first capacity input that is used. |
| F5 | Referee caveat, EUI tolerance | `03_tolerances.md` adds Brief 104 F1 (the referee copies Engine 2's allocation; +12 % cooling otherwise). The EUI row is marked information, not a gate. |
| F6 | One configuration; hourly shapes untested | New tests: one hot hour of heating lands in that hour of each group's fuel and of `electricity_w`, checked against hand values; hot water following occupancy has the same annual total and nothing at night. |
| F7 | ⓘ too broad | Now: "On the Bridgewater test building, given the same demand, it matches today's tool to the kWh; fans follow their schedule here." |
| F8 | EUI 0 on zero floor | A building with no floor area is refused by name. Floor area is read from one helper, `readDocFloorM2`, by both the systems and the seam. |
| F9 | Gate labels | `02_gate.md` says what each of today's rows is; the EUI row no longer has a kWh difference. |

**Re-run.** `107_gate.mts` gives the same figures: every end use matches today's to ≤ 0.4 kWh, and the five-storey EUI is 131.89. Tests: 176 pass. No file of today's engine is touched.
