# Brief 126: the inside film, the sky and the window, as EnergyPlus works them out

**Decision.** Linzie, 18 Nov 2026, 10:57, "Please fix". She was answering the round-up note that the school's remaining heating gap against EnergyPlus came from three things: the inside air film, the sky temperature and the window model. Each could be fixed separately. The coordinator read her answer as: fix all three, as physics and not tuning, refereed against EnergyPlus, keep the 50-room run fast, and check Bridgewater.

This builds on Brief 125 (PR #69), the outside film.

## Scope (Rule 10)

**Module.** Building, State 1 terms, in the hourly run only:
- conduction through opaque elements and glazing, at their inside and outside faces;
- solar and long-wave exchange at the outside face;
- the heat the outdoor air carries in through infiltration, vents and ventilation.

**Not in scope.** No system, gain or control is added.

**Tiers.**
- The 15-minute run (`QUARTER_HOUR_OPTIONS`, tier 2) takes all of it.
- The instant monthly estimate (tier 1) keeps ISO 52016-1's fixed films and sky, and says so.
- `RUN_OPTIONS` and `REFEREE_OPTIONS` keep ISO's, so the Brief 103/104 referee numbers stay reproducible. Each new behaviour is an option they can take.

**Today's app.** Not touched. The Bridgewater anchor of 133.2 holds by construction, and Rule 14 does not apply.

## Part 1: EnergyPlus's method, measured before the code

EnergyPlus 25.2 was run on the plain school, with London TMYx weather and 4 steps an hour. The test surfaces were z3_wall_1 and its glass. The Output:Variables were:
- inside and outside face temperatures;
- inside convection coefficient;
- outside radiation coefficients to sky, air and ground;
- Site Sky Temperature and horizontal infrared;
- zone air temperature.

**Outside long-wave.** EnergyPlus's Exterior Longwave Radiation splits the face's view three ways:
- ground: view (1 − cos Σ)/2, at the outdoor air temperature;
- sky: view (1 + cos Σ)/2 × β, where β = √((1 + cos Σ)/2);
- air: the rest of the sky view.

Each coefficient is h = ε·σ·(T_s² + T_x²)(T_s + T_x), using the face's temperature from the step before. On the wall, all 35,040 steps match to 0.0000 W/m²K.

**Sky temperature.** T_sky = (IR/σ)^¼, with the file's horizontal infrared read on a line between hours. All 35,040 steps match exactly. The file's sky is 9.3 K below the air on average. ISO's is 11 K below, on a 0.5 view for a wall, against EnergyPlus's 0.354.

**Inside convection, opaque faces.** TARP (Walton). On the wall it matches with a mean error of −0.005 W/m²K.

**Inside convection, windows.** EnergyPlus's TARP does not use Walton on windows. It uses ISO 15099 (CalcISO15099WindowIntConvCoeff), with:
- air properties at T_a + ¼(T_s − T_a);
- the glass's height (3.16 m here).

It matches with a mean error of −0.009 W/m²K. Walton would give about 35 % more on this glass.

**Window glass.** The translator writes WindowMaterial:SimpleGlazingSystem. EnergyPlus's Simple Window Model gives the glass:
- emissivity 0.84;
- a layer resistance equal to 1/U less its own rating films: R_i = 1/(0.359073·ln U + 6.949915), and R_o = 1/(0.025342·U + 29.163853).

For U 5.7 the layer is 0.0093 m²K/W, against our 0.0054. The surfaces' default emissivity is 0.9.

**What was left after the three fixes.** Plain school +8.2 %. By element kind, against EnergyPlus's surface-by-surface conduction:
- **Thermal bridging.** The run's bridging is H·(θ_e − θ_air), per ISO 52016-1. The translator folded it into the walls' U, so in EnergyPlus it took the walls' sun and outside film. Walls plus bridging come to −39.4 MWh in the run against −31.5 MWh in EnergyPlus. This is a referee representation, not physics.
- **Outdoor air's heat capacity.** EnergyPlus takes air at its outdoor density (its infiltration default, `density_basis` Outdoor) and c_p from the humidity. That is about 7 % more heat per m³ in winter than our fixed 0.33 Wh/m³K.

## Part 2: code

**`epw.ts`.** Reads the horizontal infrared (field 13). A missing value is NaN.

**`outsideConvection.ts`:**
- `outsideLongwave`, `radiantH` and the views on `OutsideFace` (emissivity, ground, sky, air);
- `skyInfrared`, which uses Clark and Allen where the file's value is missing, as EnergyPlus does;
- `iso15099Inside`;
- `simpleGlazingLayerR`;
- `outdoorAirRhoCp`;
- `windowLayout`, `hostRectHeight` and `windowMargin`. These are one read of each window's host and glass height, shared with the translator (Rule 11).

**`network.ts`:**
- **TARP.** The interface keeps one factorisation, at each face's fixed h_ci. Each step's own coefficient enters as (h − h_ci)·(T_air − T_face) from the step before, on the face and opposite on the air. Every step closes.
  - Against a rebuild every step: school heating 32,148 vs 31,998 kWh (+0.5 %); community centre 16,281 vs 16,287 kWh.
  - It is about 6× faster.
- **Windows.** A window's inside face takes ISO 15099. It needs `window_height_m`.
- **Sky.** With `weather.sky_ir`, each film face's long-wave is EnergyPlus's. The element's h_re stays in the factorisation, and the difference enters from the step before. The sky line is h_sky·(T_sky − T_e) each step.
- **Outdoor air.** `outdoor_air` scales the volumetric air conductance by ρ·c_p of the outdoor air each step. The weather-driven lines are already c_p × mass flow and are left as they are.

**`model.ts`.** New options:
- `surface_physics.outside_longwave: 'energyplus'`, which needs `'doe2'`;
- `surface_physics.window: 'energyplus'`;
- `air_heat_capacity: 'outdoor'`.

**`elements.ts`.** `windowElement({ glass: 'energyplus' })`.

**`toEnergyPlus.ts`:**
- Thermal bridging is carried as `ZoneInfiltration:DesignFlowRate` "thermal bridging", at Standard density, with V = H/(ρ_std·c_p(w)) each hour. EnergyPlus's heat is then H·(θ_e − θ_air), the run's own. It is labelled in the notes and is no longer folded into the walls' U.
- Windows are placed from `windowLayout`.

**`seam.ts`.** `QUARTER_HOUR_OPTIONS` takes all of the above. `method_notes` says so in plain words, and the instant estimate's note says it keeps ISO's fixed rates.

## Part 3: re-run (London TMYx, EnergyPlus 25.2)

| Case | Before 126 (after 125) | After 126 | EnergyPlus |
|---|---|---|---|
| School plain, heating | 82,114 (+18.4 %) | 75,093 (−0.6 %) | 75,512 |
| School as built, heating | 36,271 (+29.5 %) | 32,148 (+6.8 %) | 30,101 |
| School as built, cooling | 18,101 (−3.8 %) | 17,960 (+0.9 %) | 17,805 |
| Community centre, heating | 15,762 (+10.8 %) | 16,281 (+7.6 %) | 15,138 |
| Community centre, cooling | 16,681 (−3.4 %) | 16,362 (−2.2 %) | 16,728 |

The EnergyPlus figures for the plain school (69,370 → 75,512) and the school as built (28,011 → 30,101) moved because bridging is now carried as the run has it.

**Plain school, one element kind at a time** (run vs EnergyPlus):

| Element kind | Gap |
|---|---|
| Walls | −2.7 % |
| Glazing | −4.7 % |
| Ground | −10.5 % |
| Roof and loft | −12.4 % |
| Air | −6.1 % |
| Bridging | −8.4 % |

All six are now below EnergyPlus, by 3 % to 12 %. Ground, roof and loft, and weather-driven air are the next things to look at.

**Speed.** On 50 rooms (Chicago, 4 steps an hour), heating moves −4.6 % and cooling +8.4 % against ISO's fixed films.

| Case | Before | After |
|---|---|---|
| 50 rooms | 9.4 s (outside film only) | 10.4 s |
| School as built | | 11.1 s |
| Community centre | | 5.2 s |

**Other checks.**
- The Brief 103/104/115/123/124 referees keep their options and all pass.
- Bridgewater anchor 133.2 is untouched (today's engine).
- Tests: `outsideConvection.test.ts` (Brief 126 blocks), `toEnergyPlus.test.ts` (bridging), `seam.test.ts` (notes, options).

## Out of scope, recorded

- **Inside long-wave.** The run's radiant star is ISO's h_ri 5.13 for every face. EnergyPlus uses ScriptF with each face's emissivity (glass 0.84).
- **The ground, the loft and weather-driven air.** These are in the per-kind table above. Not yet split.
- **Terrain mismatch.** The air model reads 'urban' terrain as 0.22/370, while the translator sends City (from Brief 125).
