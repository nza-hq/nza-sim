# Brief 125: the outside surface film, as EnergyPlus works it out

Decision: Linzie, 17 Nov 2026 23:50, decision card "How should the hourly run treat the outside surface film?", option A, "Follow EnergyPlus's method" (wind, height and terrain as EnergyPlus does it; every result moves; a brief and all referees re-run).

Cause and evidence: `docs/audit/examples/school_heating_gap.md` (the extended school's run heats 38 % more than EnergyPlus; the outside film is most of it).

## Scope (Rule 10)

Systems module? No. This is the hourly run's envelope physics (Building module, State 1 terms: conduction through opaque elements and glazing at their outside face). It changes how fast an outside face gives heat to the outdoor air. It adds no system, gain or control.

- The 15-minute run (`runOptionsFor`, tier 2) takes the new film. The instant monthly estimate (tier 1, ISO 52016-1 monthly, fixed R_se) is unchanged and says so. EnergyPlus (tier 3) is the method being followed.
- Engine 1's one-zone fixed-film path and the referee options (`RUN_OPTIONS`, `REFEREE_OPTIONS`) keep ISO 52016-1's fixed 20 W/m²K, so every Brief 103 and 104 referee number stays reproducible; `'doe2'` is an option they can take.
- Rule 14's three-location parity is about today's app's `instantCalc.js`; this brief does not touch today's app.

## BEFORE DOING ANYTHING

1. Read CLAUDE.md, STATUS.md, this brief, `docs/audit/examples/school_heating_gap.md`.
2. `git log --oneline -5` on `sim2/125-outside-film` (off `sim2/example-school`).
3. EnergyPlus 25.2 at `ENERGYPLUS_DIR`; the London TMYx file is never committed.

## Part 1: EnergyPlus's method, measured (done before the code)

EnergyPlus 25.2's own hourly outputs on the plain school (Output:Variables Surface Outside Face Convection Heat Transfer Coefficient, Surface Outside Face Temperature, Surface Outside Face Outdoor Air Wind Speed, Site Rain Status, Site Wind Speed and Direction, 4 steps an hour), against the formulas below:

- DOE-2 (EnergyPlus's default outside algorithm), per outside face and step:
  - h_n = Walton's natural convection (as TARP inside) from the face's temperature at the step before and the outdoor dry bulb, by the face's outward tilt;
  - h_f = a·V_z^b: windward a 3.26, b 0.89; leeward a 3.55, b 0.617 (MoWITT's forced terms); leeward when the wind comes from more than 90° off the face's azimuth (EnergyPlus's Windward test); a face within 0.98 of horizontal is always windward;
  - h = h_n + R_f·(√(h_n² + h_f²) − h_n), R_f the outside layer's roughness: MediumRough 1.52 (every opaque layer the translator writes), 1.0 for glazing (VerySmooth); at least 0.1 W/m²K (EnergyPlus's low limit);
  - V_z = V_met·(270/10)^0.14·(z/δ)^α at the face's centroid height z, the site's terrain (Country 0.14/270, Suburbs 0.22/370, City 0.33/460), wind speed linear between hours and direction the short way round.
  - Check on z3_wall_1 (south, MediumRough) and its glass, 33,687 dry steps: mean error 0.00 W/m²K, sd 0.09 (wall) and 0.06 (glass).
- Rain: a wind-exposed face is wet when the weather is raining; its film is 1,000 W/m²K to the outdoor wet bulb. Raining = the weather code (present weather observation 0 and any of the first three code digits below 9) read between hours ≥ 0.5, or the liquid precipitation depth read between hours ≥ 0.8 mm. Check: 35,038 of 35,040 steps agree with Site Rain Status (1,353 raining).
- Dry-step mean coefficients on this site: 3.1 to 4.5 W/m²K, against our fixed 20.

## Part 2: one canonical read for the site's terrain and each face's height

- `airflow.ts`: `EP_TERRAIN`, `siteTerrain(site)` (the translator's mapping, moved, not changed), `windFactorAt(z, terrain)`.
- `outsideFaceZ(zone, tilt)`: the centroid height the run and the translator both use (a vertical face at mid-height of its zone; a face looking up within 45° at the zone's top; one looking down at its floor).
- `toEnergyPlus.ts` places each outside surface so its centroid sits at `outsideFaceZ` (windows sit inside it), and takes its terrain from `siteTerrain`. EnergyPlus results move a little: wind at the face's own height.

Commit: "Brief 125 P2: one read for the site's terrain and each outside face's height (run and EnergyPlus)".

## Part 3: the film in the network solver

- `epw.ts` reads present weather observation and codes (fields 26, 27) and liquid precipitation depth (field 33) when present; absent fields mean no rain, said in the run's notes.
- `outsideConvection.ts`: the constants (in `constants.ts`), `doe2Film`, `rainAt`, `wetBulb`.
- `network.ts`: `outside_convection` input. Each step, each face to outside air gets its film from the step before's outside surface temperature; its element chain is re-factorised and the interface rebuilt (as TARP already rebuilds it). Rain: film 1,000 to the wet bulb. The boundary term stays one line per element (Rule 9), closure checked each step.
- `model.ts`: `surface_physics.outside_convection: 'doe2'` runs on the network solver; terrain from `siteTerrain`; heights from `outsideFaceZ`.
- Tests: the formulas against Part 1's EnergyPlus samples; closure; a wind-free, dry weather gives h_n only.

Commit: "Brief 125 P3: DOE-2 outside film and rain, as EnergyPlus, in the network solver".

## Part 4: the run takes it; every referee re-run

- `seam.ts` `QUARTER_HOUR_OPTIONS`: `outside_convection: 'doe2'`.
- Re-run and record before/after: extended school (plain and as built, against EnergyPlus), community centre, Bridgewater anchor (133.2 before), the Brief 115/123/124 EnergyPlus referees, speed (50 rooms ≤ 15 s).
- On screen: the Run's notes say the outside film follows EnergyPlus's DOE-2 method with rain; the instant estimate says it keeps ISO's fixed film.

Commit: "Brief 125 P4: the 15-minute run uses EnergyPlus's outside film; referees re-run".

## Part 5: documents

STATUS.md, CLAUDE.md module scope line under Systems? No: under "EnergyPlus runs in Simulate v2" one sentence; `school_heating_gap.md` closing section with the after numbers; this brief to archive when merged.

## Out of scope, recorded

- Inside convection (TARP) as the run's default: about 5 % more on the school; a separate choice for Linzie.
- The sky temperature (11 K vs the file's own long-wave): about 1 %.
- `airflow.ts`'s weather-driven air reads 'urban' as 0.22/370 while the translator sends 'urban' to EnergyPlus as City (0.33/460): a mismatch between the air model and EnergyPlus, found here, not fixed here.
