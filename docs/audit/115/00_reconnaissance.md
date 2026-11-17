# Brief 115 P0 — reconnaissance: weather-driven air leakage, vents and windows

16 Nov 2026. Brief: [`../../briefs/active/115_natural-ventilation-and-air-leakage.md`](../../briefs/active/115_natural-ventilation-and-air-leakage.md) (approved by Linzie 16 Nov 15:06).

**Module scope.** Air leakage and permanent vents are Building (envelope); opening windows and their rules are Operation (occupant behaviour), carried by the Controls step's window entries (Brief 114's `controls[]`). Nothing goes in Systems: mechanical ventilation stays where it is. Under the schema's levels, windows are removed (not closed) at "Fabric only" and "+ Spaces" and arrive at "+ Systems" with their controls (Rule 8).

## What today's engine does (kept exactly under `air.method: 'today'`)

- `thermal/engine/air.ts`: leakage as a constant conductance from n50/20 (or a stated ach); vents as a wind-only flow per m/s (`ventCoefficient`), hourly through `ventConductance`.
- `model.ts` refused every operable opening ("the Operation module (not Engine 1)").
- Ventilation enters both solvers as an hourly conductance `hv` (W/K) read each step from `zIn`; `network.ts` is the per-step multizone solver.

Under `'today'` nothing moves: the Bridgewater gate (`scripts/114_gate.mts`) gives the same digest `2da3e6b5…e58b` (EUI 148.33 kWh/m² on Denver) after this brief; today's engine is untouched, so the anchor 133.2 holds by construction.

## The weather-driven method (`air.method: 'weather_driven'`)

One unknown per room each step, its pressure P_z; every opening to outside is a path. With the outdoor pressure at ground level as zero, the pressure across a path at height z, outside minus inside, is

    Δp = Cp·½·ρ_w·U(z)² + g·z·(ρ_z − ρ_o) − P_z

P_z balances the mass flows (Newton inside a bracket of the paths' own Δp at P = 0). Each line's heat is cp·m_in·(θ_e − θ_z), entered as a conductance cp·m_in for that step; the room's temperature is the previous step's (as EnergyPlus's AirflowNetwork and venting control lag one step).

Written term for term from EnergyPlus v25.2.0's source so the referee compares like with like:

| Piece | Formula | EnergyPlus source |
|---|---|---|
| Wind at height | U(z) = U_met·(270/10)^0.14·(z/δ)^a; open 0.14/270, suburban and urban 0.22/370, city 0.33/460 | `DataEnvironment::WindSpeedAt`; Site:WeatherStation defaults; terrains Country, Suburbs, Urban, City |
| Wall Cp | Swami–Chandra low-rise surface average, G = ln(facade width ÷ adjacent width), tabulated every 10° and read between linearly | `AirflowNetwork` `SurfaceAverageCalculation` |
| Air | ρ = P/(287·(T+273.15)·(1+1.6077687·w)); cp = 1004.84 + 1858.95·w; μ = 1.71432e-5 + 4.828e-8·T | `Psychrometrics`, `AirflowNetwork::Properties` |
| Densities | wind ρ at the hour's barometric pressure; stack ρ at standard pressure from elevation, 101325·(1 − 2.25577e-5·z)^5.2559 | `Solver.cpp` `calculate_wind_pressure`, `PStack` |
| Stack | PS = 9.8·h·(ρ_m − ρ_n), node heights 0, link height the opening's | `Solver.cpp` |
| Crack | m = k·C_T·|Δp|^n, or laminar k·C_T·√ρ/μ·Δp when smaller; C_T = (ρ_ref/ρ_up/(T_up/T_ave))^(n−1)·(μ_ref/μ_ave)^(2n−1) | `Elements.cpp` `SurfaceCrack::calculate` |
| Window | two-way flow over the height (analytic integral, Y = PDROP/(g·Δρ), F0/FH, DF0/DFH); below `MinRhoDiff` 1e-4 an orifice at mid-height | `Elements.cpp` `SimpleOpening::calculate` |
| Vent | orifice m = Cd·A·√(2·ρ_up·|Δp|) | (EnergyPlus `SpecifiedFlow`/`SimpleOpening` not used; vents are small, one-way per step) |
| Venting control | Temperature: open if T_zone > T_out and T_zone > VentTemp and the availability schedule allows; modulation 1 at ΔT ≤ lower, LimVal at ΔT ≥ upper, straight between | `Solver.cpp` `venting_control` |

**EnergyPlus quirks found and stated.** SimpleOpening treats its link height (the surface centroid) as the bottom of the opening; the referee therefore places EnergyPlus's window so that its centroid is the engine's sill. Below `MinRhoDiff` it uses a crack at mid-height. The two densities (wind at hourly pressure, stack at standard pressure) are mirrored.

**Our own choices (stated, not refereed by construction).**
- Leakage per room: k = ρ_ref·q50·A_env/3600/50^n (kg/s at 1 Pa), the room's envelope area as today's method takes it. It is shared over the room's outside walls by area, in three equal bands over its height. Roof and floor leakage is put on the walls (a roof's Cp is not in this brief). Shut windows leak nothing.
- Floor height of a zone: storey × storey height (`floor × height_m`).
- Facades by outward azimuth rounded to whole degrees; a facade's width is its outside wall and glazing area.
- Effective window area (Rule 11, `windowEffectiveArea`): openable fraction × the angle factor C(α) = 2.60e-7·α³ − 1.19e-4·α² + 1.86e-2·α (α in degrees), held to 0..1, for hung and pivot windows; sliding and louvre windows 1 (a louvre's restriction is in its cd).
- Single-sided turbulence (switchable): when every open window of a room is on one facade, q = ½·A_open·√0.001·U₁₀ (m³/s), its own line. Not refereed: EnergyPlus has no exact counterpart.

**EN 16798-7 clause caveat.** We do not hold BS EN 16798-7:2017. The angle factor and the single-sided wind term are taken as published in EN 15242:2007 secondary sources (CIBSE AM10 and the open literature quoting them); clause numbers are not cited because they could not be checked. Both are labelled "after EN 16798-7 (from EN 15242), equation as published in secondary sources". If a copy is obtained the clause numbers are added; the equations are not expected to change.

## Not modelled yet (refused by name, not ignored)

Adaptive window rules; least open and closed times; temperature profiles for open-above (state `open_above_c`); air between rooms, stairs, atria (115b); closing in wind or rain.

## Refusals (no fallbacks)

Under `'weather_driven'`: terrain, exponent and the turbulence switch must be stated (schema); every room states q50 (an ach is refused); a room with leakage needs an outside wall; vents state `height_m` and `cd`; windows sit on outside glazing and state `cd`, `sill_m < head_m`, style and (for hung and pivot) angle; a room with opening windows needs one window entry on the control map, with a rule and `open_fraction`; a temperature rule needs `open_above_c`, above the room's heating setpoint in every allowed hour (Brief 115 P1 validation); modulation's upper above its lower.
