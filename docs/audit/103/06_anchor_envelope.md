# Brief 103 Part 6: the Bridgewater envelope

**Gate (a) passes.** Every path's conductance and annual loss at the setpoint agrees with today's State 1 to within
0.001 %. Transmitted solar differs by −8.9 %. That difference is fully explained by two of Engine 1's stated choices,
and taking them out leaves 0.000 %.

> **Updated in Part 6b (15 Nov 2026):** `REFEREE_OPTIONS` now puts the sun's beam on the floor, as EnergyPlus does.
> Gate (b) moves to heating 89.98 (−0.5 %) and cooling 15.32 MWh (+12.2 %): still a miss, with the same diagnosis.
> `06_anchor_envelope.json` holds the re-run. The tables below are the Part 6 run, kept as recorded. See
> [`07_bestest_referee.md`](07_bestest_referee.md).

**Gate (b): heating passes, cooling misses.** Against the EnergyPlus referee, heating is −0.6 % and cooling is
+13.1 % (15.45 against 13.65 MWh). Instrumentation places the cooling miss in the internal-mass representation. Engine
1 has one zone with its internal capacity on the air node. The referee has four concrete floor slabs between five
zones, and the slabs absorb solar. Removing only the slabs' mass in the referee moves its cooling by +6.6 MWh, so
Engine 1's +1.8 MWh sits inside that effect. The window solar admitted over the year agrees to about 2 %. Nothing
was tuned.

- Script: [`scripts/103_anchor_envelope.mts`](../../../scripts/103_anchor_envelope.mts), run from `frontend/` with
  `npx vite-node ../scripts/103_anchor_envelope.mts`. It is `.mts`, not the brief's `.mjs`, because the engine is
  TypeScript. Output: [`06_anchor_envelope.json`](06_anchor_envelope.json).
- Instrumentation: [`validation/energyplus/103_window_solar_diagnostic.py`](../../../validation/energyplus/103_window_solar_diagnostic.py).
  Output: [`06_window_solar_diagnostic.json`](06_window_solar_diagnostic.json).
- Inputs:
  - `bridgewater_anchor_v2.yaml`, converted with `fromBuildingConfig` (building id `bridgewater-anchor`). State 1 was
    measured on this fixture.
  - `report_baseline_v1.yaml`, which the referee builds. The script checks the two carry the same envelope, and that
    Engine 1 gives identical results on both.
  - The anchor EPW (sha `c6571102…cf2`).
  - Engine 1 runs with `REFEREE_OPTIONS`: air-temperature control, 25 warm-up days, actual sun day and apparent solar
    time.
- Today's State 1 reproduces its recorded **129.2 / 98.6 MWh** in this run.

## Table 1, gate (a): State 1 against Engine 1, per path

State 1 does not report its conductances, so they are read back from its own outputs. Each path's annual heating
loss at the setpoint is divided by that path's driving degree-hours, under State 1's own convention
(`instantCalc.js` `losses_at_setpoint`):

- walls and roof: sol-air, `T_out + α·I/25`;
- glazing, leakage and bridging: `T_out`;
- the floor: `T_ground`, the annual mean;
- vents: weighted by the hourly wind speed.

Engine 1's losses use its own conductances and its own surface solar under the same convention. Its solar equals
today's `solarCalc` to Float32 (Part 2).

| Path | State 1 W/K | Engine 1 W/K | Δ % | State 1 heating kWh | Engine 1 heating kWh | State 1 cooling kWh | Engine 1 cooling kWh | Within 1 % |
|---|---|---|---|---|---|---|---|---|
| External walls (sol-air) | 238.135 | 238.135 | 0.000 | 17,855.4 | 17,855.4 | 836.5 | 836.5 | yes |
| Roof (sol-air) | 126.479 | 126.479 | 0.000 | 8,949.9 | 8,949.9 | 1,340.8 | 1,340.8 | yes |
| Ground floor (T_ground) | 109.615 | 109.615 | 0.000 | 9,354.3 | 9,354.3 | 0.0 | 0.0 | yes |
| Glazing | 895.319 | 895.319 | 0.000 | 77,291.4 | 77,291.4 | 307.4 | 307.4 | yes |
| Fabric leakage (q50 ÷ 20) | 308.296 | 308.297 | 0.000 | 26,614.7 | 26,614.7 | 105.8 | 105.8 | yes |
| Permanent vents (W/K per m/s of wind) | 53.361 | 53.361 | 0.000 | 16,246.0 | 16,246.0 | 65.1 | 65.1 | yes |
| Thermal bridging | 278.080 | 278.080 | 0.000 | 24,006.2 | 24,006.2 | 95.5 | 95.5 | yes |
| **Transmitted solar, as run** | 147,785.4 kWh | 134,573.1 kWh | −8.94 | | | | | **no**, by design |
| Transmitted solar, today's sun convention, ÷ F_W 0.9 | 147,785.4 kWh | 147,785.4 kWh | 0.000 | | | | | yes |

Bridging is 278.080 W/K whether State 1 reports it directly or its loss is divided by the degree-hours.

**Transmitted solar.** The −8.94 % has two parts, both stated in Engine 1 and neither a bug:

1. **F_W = 0.9** (ISO 13790 §11.4.2), the non-normal-incidence factor on g. Today's engine has no such factor.
2. **The sun convention.** Engine 1 runs on the actual day and apparent solar time (`REFEREE_OPTIONS`). Today uses
   the mid-month day and clock time.

Run Engine 1 with today's convention and divide by 0.9, and it equals State 1 exactly. Whether F_W stays is part of
the physics-refinement decision. The referee shows it is in the right direction; see below.

## Table 2, gate (b): EnergyPlus referee (Part 5, r0) against Engine 1

| MWh | Referee | Engine 1 | Δ % | Within ±10 % | State 1 (information) |
|---|---|---|---|---|---|
| Heating | 90.46 | 89.91 | −0.6 | yes | 129.2 |
| Cooling | 13.65 | 15.45 | +13.1 | **no** | 98.6 |

Today's hourly engine with the bridging fix gives 76.0 / 41.9 MWh on Run Bi's comparison
(`cooling_gap_root_cause.md`). That is shown for information only, and it was not re-run here.

| Month | Referee heating | Engine 1 heating | Referee cooling | Engine 1 cooling |
|---|---|---|---|---|
| Jan | 19.84 | 19.90 | 0.00 | 0.00 |
| Feb | 14.61 | 14.66 | 0.00 | 0.00 |
| Mar | 12.85 | 12.33 | 0.00 | 0.00 |
| Apr | 3.55 | 3.02 | 0.00 | 0.00 |
| May | 0.27 | 0.13 | 0.03 | 0.35 |
| Jun | 0.00 | 0.00 | 3.44 | 4.44 |
| Jul | 0.00 | 0.00 | 8.44 | 8.20 |
| Aug | 0.00 | 0.00 | 1.73 | 2.46 |
| Sep | 0.26 | 0.52 | 0.02 | 0.00 |
| Oct | 6.10 | 6.44 | 0.00 | 0.00 |
| Nov | 14.16 | 14.24 | 0.00 | 0.00 |
| Dec | 18.83 | 18.67 | 0.00 | 0.00 |

Engine 1 closes its balance to 4.9e-9 Wh in the worst hour.

The monthly pattern is a timing difference, not a difference in level:

- In spring, Engine 1 needs less heating (March −0.52, April −0.53 MWh).
- In early summer it needs more cooling (May +0.32, June +1.00, August +0.73 MWh).
- In autumn it needs more heating (September +0.26, October +0.34 MWh).
- At the peak, July, it needs slightly less cooling (−0.24 MWh).

So Engine 1 turns solar into load sooner and stores less of it than the referee does.

## Diagnosis of the cooling miss (+1.80 MWh)

**1. The annual window solar reaching the zone agrees to about 2 %.** This is not the cause.

- Incident on the windows: EnergyPlus 344.4 MWh; Engine 1 339.8 MWh (134.57 ÷ (0.55 × 0.8 × 0.9)). EnergyPlus uses
  an anisotropic sky and Engine 1 an isotropic one, a gap of −1.3 %.
- EnergyPlus's equivalent glazing layer, from `eplusout.eio`, is T = 0.356, R = 0.455, A = 0.189 at normal
  incidence, with SHGC 0.441. The fraction of absorbed solar that flows inward is (0.441 − 0.357) / 0.189 = 0.44.
- EnergyPlus transmits 103.4 MWh: 0.300 of incident over the year, below the 0.357 at normal incidence. It absorbs
  65.6 MWh in the glass, and about 0.44 × 65.6 ≈ 29 MWh of that reaches the zone. Solar into the zone is therefore
  about 132 MWh.
- Engine 1 admits 134.6 MWh as transmitted solar, g × (1 − frame) × F_W. That is within about 2 %.
- The 29 MWh is a normal-incidence ratio applied to the annual sum, so it is an estimate. EnergyPlus does not report
  the inward-flowing part separately.
- The facade split is the same. Transmitted over incident is 0.296 on the north-east facade (azimuth 42°, 508 m² of
  glass) and 0.308 on the south-west. F_W = 0.9 on g is consistent with EnergyPlus's angular loss: 0.300 annual
  against 0.357 at normal incidence is a factor of 0.84 on transmittance.

**2. Where the solar is stored: the interior floor slabs.** This is the cause.

- The referee is five floor zones with four 200 mm concrete slabs between them: 6,745 m² of massive inside surface.
  The transmitted beam lands on those slabs.
- Engine 1 has one zone. It spreads transmitted solar over its 4,027 m² of inside surfaces by area: walls, roof,
  ground floor and glazing. 16 % lands on the glazing itself. Its internal capacity, 250 kJ/m²K × floor area, sits on
  the air node, which does nothing while IdealLoads holds the air at the setpoint.
- **Isolating perturbation on the referee:** remove only the slabs' mass, keeping each slab's resistance at 0.528
  m²K/W so floor-to-floor conduction is unchanged.
  - Cooling: 13.65 → **20.29 MWh (+6.64)**.
  - Heating: 90.46 → **95.38 MWh (+4.92)**.
  - The monthly shape moves the same way as Engine 1's: cooling rises in April, May, June, August and September.
- Adding 250 kJ/m²K to each referee air node instead (Part 5, `mass_250`) moves cooling by only −0.81 MWh. Mass on
  the air node is far weaker than mass in a surface that the solar strikes.
- **Conclusion.** Engine 1's cooling (15.45) lies between the referee with slabs (13.65) and without slab mass
  (20.29), at 27 % of the slabs' effect. The miss is the brief's declared structural difference ("five stacked floor
  zones against one zone"), measured.
- **What would close it, as physics and not tuning:** the one-zone document carries the interior floors as internal
  partition elements, adiabatic layered chains inside the zone. Engine 1's element model already supports this. The
  schema does not yet: a 2.2 addition, shared with Brief 104's interzone surfaces.
- This is put forward as a refinement candidate for the decision, not done here.

**3. Ruled out with numbers.**

- Conductances: gate (a), 0.000 %.
- Infiltration: referee 30.81 MWh loss against Engine 1 29.04 net.
- Vents: 18.78 against 17.83.
- Opaque conduction totals: per-element net in the referee, 66.2 MWh.

These terms move heating, which agrees to −0.6 %.

## What changes

Nothing in either engine. Two refinement candidates go to the physics-refinement decision alongside BESTEST
(Part 4):

1. **Interior partitions in the one-zone document**, with solar distributed to them. This is the cooling-miss cause.
   It also bears on BESTEST 900, the heavy case, whose heating is +34 % above range.
2. **Keep F_W.** EnergyPlus's annual angular loss (0.84 on transmittance) supports a factor of about 0.9 on g. Gate
   (a)'s solar line is then a stated convention difference, not a bug.
