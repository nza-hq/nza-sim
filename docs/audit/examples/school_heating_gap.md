# Extended school: why the 15-minute run heats more than EnergyPlus

17 Nov 2026, overnight. Building: `docs/examples/extended_school.plan.json`. Weather: London St James Park TMYx; the file is not committed. Method: `scripts/example_gap_bisect.mts` and EnergyPlus 25.2 with added Output:Variables. Nothing was tuned. No engine number changed as a result of this work.

## The gap

| Case | Run kWh | EnergyPlus kWh | Run vs EP |
|---|---|---|---|
| As built (school) | 38,571 | 27,871 | +38 % |
| Plain: no gains, 20 °C all year, no systems, windows shut | 91,265 | 69,344 | +31.6 % |

## One element kind at a time

The plain case was run with everything else set to near-zero U (glazing 0.3), bridging ×0.0001 and q50 0.01.

| Only… | Run | EnergyPlus | Gap |
|---|---|---|---|
| walls (1960s unfilled cavity U 1.42 on the old wing) | 22,952 | 17,715 | **+29.6 %** |
| windows (U 2.8 and 5.7 on the old wing) | 10,619 | 7,838 | **+35.5 %** |
| thermal bridging (carried on the walls in EnergyPlus) | 8,912 | 7,658 | +16.4 % |
| ground floor | 11,134 | 11,634 | −4.3 % |
| roof and loft | 7,008 | 7,790 | −10.0 % |
| air | 12,919 | 13,747 | −6.0 % |
| walls with a stated U of 0.3 instead | 7,564 | 7,091 | +6.7 % |

The gap belongs to the high-U elements that face the outside air: the old walls and old windows. The sun does not explain it. With every outside face made dark (absorptance and emissivity 0.01) and glazing g 0.01, the walls-only gap is still +18.9 %.

## Classroom 1, wall `z3_wall_1` (18 m², faces south), kWh a year

| Line | Run | EnergyPlus |
|---|---|---|
| Sun absorbed on the outside face | +12,523 | +12,424 |
| Heat lost from the outside face (convection plus long-wave, including the sky) | −13,929 | −13,411 |
| Through the wall into the room | **−1,406** | **−986** |

Both engines put the same sun on the wall. The difference is how fast the outside face gives heat to the air.

## Cause, and how much of it each part explains

1. **The outside surface film.** Our engine holds the outside convection coefficient at ISO 52016-1's fixed 20 W/m²K, whatever the wind. EnergyPlus works it out each hour from the wind at the wall (DOE-2). The St James Park file averages 1.6 m/s, a sheltered site.
   - With EnergyPlus's outside convection fixed at 20 W/m²K, EnergyPlus heating rises from 69,344 to 80,579 kWh. The plain gap falls from +31.6 % to **+13.3 %**.
   - Walls only: from +29.6 % to **+8.5 %**. Windows only: from +35.5 % to **+13.2 %**.
   - A lower outside film lowers a high-U element's effective U. Single glazing at U 5.7 has films for most of its resistance. A low film also lets more of the absorbed sun reach the room. Insulated elements barely change, which is why Bridgewater and the ground and roof cases agree.
2. **The inside film.** Our engine uses ISO 52016-1's fixed inside coefficients; EnergyPlus uses TARP. Our run with its own TARP option (`surface_physics.inside_convection: 'tarp'`) heats 87,049 kWh instead of 91,265, which is −4.6 %.
3. **The sky.** Our engine takes the sky 11 K below the air (ISO 52016-1 Annex B). This weather file's own long-wave data puts it 9.3 K below on average. Setting 9.33 in a local experiment gave 90,008 kWh, which is −1.4 %. The experiment was not kept.
4. **What is left.** About 6 %, consistent with glazing: EnergyPlus's window has its own films and a frame. Not yet split further.

## A check on the obvious fix

ISO 6946:2017 Annex C gives the outside film as 4 + 4·v. At this file's mean wind that is 10.35 W/m²K. As a local experiment, not kept, our film was set to that constant:

- Plain gap: from +31.6 % to +23.5 %.
- With TARP inside convection as well: +18.1 %.
- Walls only: +20.5 %. Windows only: +27.8 %.

So EnergyPlus's effective outside film here is well below what ISO 6946 gives from the weather station's wind. Its DOE-2 model reduces the wind for the wall's height and the suburban terrain, and lowers it again on the leeward side. Matching EnergyPlus would mean taking EnergyPlus's convection model, not ISO's. That is a choice of method to make on purpose, not a number to fit.

## What it means

- The +38 % is not a missing term (Rule 9 holds: every line closes) and not a bug in either side's geometry or U. It is the outside film on old, leaky fabric at a sheltered site.
- The engine already has wind-driven outside convection, ISO 6946:2017 Annex C, h = 4 + 4·v, but only for a one-room run. The multi-room run refuses it, because it keeps one matrix factorisation for the year.
- Options, all Linzie's to choose, because each changes every result, including the Bridgewater anchor. Each needs a brief and every referee re-run.
  - (a) Keep ISO 52016-1's fixed films and label the gap.
  - (b) ISO 6946's wind-driven film plus TARP inside, which closes a little under half of it here.
  - (c) EnergyPlus's own DOE-2 outside convection, with height and terrain, which should close most of it. This makes our run follow EnergyPlus's method rather than ISO's.
  - The engine work is the same for (b) and (c): the outside film becomes an hourly input to the multi-room run, which already re-factorises every step for TARP.

## After Brief 125 (18 Nov 2026): the run takes EnergyPlus's outside film

Linzie chose (c) on 17 Nov at 23:50. The 15-minute run now works each outside face's film out as EnergyPlus does: DOE-2 from the wind at the face's height and the site's terrain, windward or leeward, plus wet faces in rain. This was checked against EnergyPlus's own coefficients face by face (`docs/briefs/active/125_outside-film.md`). Nothing was tuned.

| Case | Run before | Run after | EnergyPlus | Gap before | Gap after |
|---|---|---|---|---|---|
| Plain (no gains, 20 °C, no systems) | 91,265 | 82,114 | 69,370 | +31.6 % | +18.4 % |
| As built, heating | 38,571 | 36,271 | 28,011 | +38.4 % | +29.5 % |
| As built, cooling | 17,022 | 18,101 | 18,813 | −10.0 % | −3.8 % |
| Community centre, heating | 15,476 | 15,762 | 14,222 | +8.8 % | +10.8 % |
| Community centre, cooling | 15,926 | 16,681 | 17,262 | −7.7 % | −3.4 % |

EnergyPlus columns are after Brief 125 P2. It now places each surface at the height the run uses, so they move a little from the table above (69,344 → 69,370; 27,871 → 28,011).

Face by face, our film now matches EnergyPlus's. On z3_wall_1 in dry steps it averages 4.46 W/m²K against EnergyPlus's 4.51. Rain falls on 1,355 steps against EnergyPlus's 1,353.

What is left on the school (+18 % plain) is the other part of this note's list:

- inside convection: TARP, about −5 % at the fixed film;
- the sky: about −1 %;
- the window model: EnergyPlus's glass outer surface runs about 0.9 K warmer than ours on z3_glazing_1.

Each is a separate choice, not made here.

The community centre's heating moved slightly the other way, away from EnergyPlus. Its cooling moved towards it. It is insulated, so the film matters less than the other terms there.

## After Brief 126 (18 Nov 2026): the inside film, the sky, the window, and how bridging reaches EnergyPlus

Linzie answered "Please fix" on 18 Nov at 10:57. The 15-minute run now follows EnergyPlus for five things:

- **Inside film.** TARP, with ISO 15099 on windows.
- **Outside long-wave and sky.** From the weather file's own infrared.
- **Window glass.** EnergyPlus's simple glazing: emissivity 0.84, and a glass layer from EnergyPlus's own rating films.
- **Outdoor air.** It carries heat at its own density.

Each was checked against EnergyPlus's own outputs before it was written (`docs/briefs/active/126_inside-sky-window.md`). Nothing was tuned.

Tracing what was left showed a fourth cause. The translator had folded thermal bridging into the walls' U, so in EnergyPlus the bridging took the walls' sun and outside film. In the run, bridging is H·(θ_e − θ_air). The translator now carries it as exactly that conductance, which raises EnergyPlus's heating.

| Case | After 125 | After 126 | EnergyPlus |
|---|---|---|---|
| Plain, heating | 82,114 (+18.4 %) | 75,093 (−0.6 %) | 75,512 |
| As built, heating | 36,271 (+29.5 %) | 32,148 (+6.8 %) | 30,101 |
| As built, cooling | 18,101 (−3.8 %) | 17,960 (+0.9 %) | 17,805 |
| Community centre, heating | 15,762 (+10.8 %) | 16,281 (+7.6 %) | 15,138 |
| Community centre, cooling | 16,681 (−3.4 %) | 16,362 (−2.2 %) | 16,728 |

On the plain school, one kind at a time, every kind is now 3 % to 12 % below EnergyPlus:

| Element kind | Gap |
|---|---|
| Walls | −2.7 % |
| Glazing | −4.7 % |
| Ground | −10.5 % |
| Roof and loft | −12.4 % |
| Air | −6.1 % |
| Bridging | −8.4 % |

The ground, the loft and weather-driven air are the next to look at. The as-built school's remaining +6.8 % has not yet been split.
