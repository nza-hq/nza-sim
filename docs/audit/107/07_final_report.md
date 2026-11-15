# Brief 107: final report (systems by zone group)

**What it does.** Simulate v2 now turns each zone's heating and cooling demand into the energy the installed systems use:
- each system's share of a zone, and its efficiency (SCOP, SEER or η);
- hot water by the tap-mix model;
- fans from SFP × flow × the hours they run;
- lighting, small power and auxiliary from the gains' own electricity.

From those come the end uses, the totals by fuel, an hourly electricity profile, and the delivered-energy EUI (`readSystemsEui`, v2's own Rule 11 boundary). The results panel shows them under "Energy used".

**Evidence:**
- **Path by path** ([`02_gate.md`](02_gate.md)). Fed today's demand on Bridgewater, every end use equals today's to ≤ 0.4 kWh.
- **On Engine 2's own demand** (five storeys). The EUI is 131.89 against today's 133.2. The difference is all demand: heating +1.03 and cooling −2.35 kWh/m², everything else 0.00.
- **Against EnergyPlus** ([`03_tolerances.md`](03_tolerances.md)). Heating and cooling electricity are −3.9 % and +9.3 %, within ±10 %. The EUI row is information only, because two-thirds of it is shared input.
- **Independent review** ([`05`](05_independent_review.md)). No tuning, and Rule 11 is clean. All nine findings are fixed or stated ([`06`](06_review_response.md)). Most important: hot water can no longer drop out unseen, and what the systems serve is checked against the model's demand (Rule 9, integrand against display).
- **Tests and today's engine.** 176 thermal and sim2 tests pass. No file of today's engine is touched; anchor 133.2.

**Open, carried forward:**
- **Out of scope here:** carbon, the custom service setpoint (it needs a second run), and system capacity.
- **Listed on the panel as "not used yet":** capacity, control schedules and defrost. Brief 108's emitters will be the first capacity input that is used.
- **Hourly output:** `electricity_w` is computed and tested, but not shown yet. It is for load profiles and calibration (roadmap).
