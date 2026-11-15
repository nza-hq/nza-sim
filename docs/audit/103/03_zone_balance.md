# Brief 103 Part 3 — one zone, ISO 52016-1 hourly balance, analytic cases

15 Nov 2026, branch `chris/103-engine-1`. No file of today's tool changed.

## What landed (`frontend/src/thermal/engine/`)

- `constants.ts`: the engine's only fixed numbers, each with its source, and copied into results later (Part 4).
  ISO 52016-1 Table 25 surface coefficients (h_ce 20, h_re 4.14 at ε 0.9, h_ri 5.13, h_ci 2.5 / 5.0 / 0.7), the
  sky difference Δθ_er 11 K, the convective share of transmitted solar 0.1, ISO 6946 R_se / R_si (only to turn a
  stated U into a layer resistance), ρc of air 1.2 × 1005 as today's engine.
- `elements.ts`: an element's node chain from its library layers. Massive layers are cut into sub-layers of at
  most 50 mm; no-mass layers are pure resistances. A stated U (per-project override, else the library's published U)
  wins over the layers, as in today's engine: the most resistive layer is resized so the ISO 6946 U equals it, and
  every mass stays. Windows are two massless surface nodes with the pane resistance from U. Inputs missing or out of
  range raise an error naming the path; nothing is defaulted.
- `linalg.ts`: dense LU with partial pivoting.
- `zone.ts`: `runZone`. The air node (with the zone's internal heat capacity) and every element's chain. Inside
  surfaces exchange with the air by convection and with each other by long-wave radiation through the area-weighted
  mean (ISO 52016-1 eq. 30). Outside faces exchange with outdoor air, lose F_sky·h_re·Δθ_er to the sky and absorb
  α·I. Bridging and ventilation couple the air node to outdoor air. Implicit Euler, Δt = 1 h.
  - **Solve once per run** (decision 7): everything that does not change hour to hour is factorised once. Hourly
    ventilation is a rank-one change on the air node, applied with Sherman–Morrison, so each hour is one
    substitution. Ideal unlimited heating and cooling: the free-floating state and the response to one watt are both
    known, and the system is linear, so the exact demand is found without iterating.
  - Control on **air** or **operative** temperature, stated by the caller. EnergyPlus's thermostat controls air.
  - Warm-up repeats the first day a stated number of times, as EnergyPlus does.

## Departures from ISO 52016-1, stated

1. Interior nodes come from the construction's own layers, not from ISO 52016-1's five nodes per mass-distribution
   class. The library carries real layers, and this is closer to the EnergyPlus referee.
2. A ground floor's outermost layer couples straight to the ground temperature (ISO 6946 R_se = 0), and the ground
   temperature is the document's `annual_mean_outdoor`, as today's engine. ISO 13370 is a later option.

## Gates

| Case | Hand calculation | Result |
|---|---|---|
| (a) steady, one construction all round, air control | Σ A·ΔT/(R_chain + 1/h_ci) + H_tb·ΔT + H_ve·ΔT | equal to 1e-6 W |
| (a) steady, wall + window, air control | the two-surface radiative network solved by Cramer's rule | equal to 1e-6 W |
| (a) steady, operative control | θ_s = 40·h_ci / (2·h_ci + 1/R) | equal to 1e-6 W; θ_op = 20 |
| (b) U from layers | 1 / (0.04 + 6.759 + 0.15/1.13 + 0.013/0.16 + 0.13) for the anchor wall; roof and ground films | equal to 1e-12 |
| (b) stated U | only the insulation resized; total mass unchanged | equal |
| (c) step change, massless envelope | θ_{n+1} − θ∞ = (θ_n − θ∞)·(C/Δt)/(C/Δt + K), every hour | equal to 1e-9 °C |
| (c) massive zone, constant solar | air and surface balances by hand | settled to 1e-4 °C |
| (d) adiabatic, no sun, no air | demand 0, temperature constant | 0 W; drift < 1e-9 °C |
| Closure, every hour of every case | \|Σ terms − demand − Δstorage\| | ≤ 1 Wh (largest seen 2e-8 Wh) |

**What case (a) shows, and why it matters for the referee.** With the air on the setpoint and all inside surfaces
alike, the air reaches the surfaces by convection alone (h_ci = 2.5 W/m²K on a wall), so the steady air-to-air
conductance of an element is A / (R_chain + 1/h_ci), not the ISO 6946 U·A (whose R_si = 0.13 assumes the radiant
surroundings at air temperature). For the anchor's well-insulated wall that is 3.7 % below U·A; for its U 1.4
glazing it is 27 % below. EnergyPlus with an air thermostat behaves the same way, and today's State 1 demand uses U·A.
This is one named, sized term in State 1's overstatement against EnergyPlus (`cooling_gap_root_cause.md`). Engine 1
still reports each element's conductance as U·A for gate (a) (Part 6), since that is the shared algebra.

## Speed (first look; Part 4 measures properly)

A Bridgewater-sized zone (10 elements, 44 nodes), a full year with 25 warm-up days, recorded: median **49 ms** in
Node (5 runs after a warm-up). Inside the 100 ms budget before any tuning.

## Schema note

Part 3 also requires `thermal_emissivity` on outside glazing (ISO 52016-1 applies the sky term to windows too). The
converter writes 0.9 and the 2.0 upgrade fills it. Schema stays 2.1 (not yet released beyond this branch).
