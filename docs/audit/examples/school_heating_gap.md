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
