# Brief 122 P2 — the monthly estimate (static) against the hourly run

**Result: every case passes the brief's heating gate (±10 %), by +1.5 % to +4.1 %.** Nothing was tuned: these are the first-run numbers. Each case uses the same document, the same weather and the same Fabric-only level (heated to 21 °C, no cooling) for both engines. The figures are in [`01_referee.json`](01_referee.json), written by `scripts/122_referee.mts`.

**Weather.** Bridgewater's anchor weather (Yeovilton TMYx) is not in this container, because `data/` is local only and the host it comes from is blocked here. So every case runs on London Gatwick IWEC (sha `c61a0a1e…dffc`). That file is not redistributable and is never committed. This is an engine-against-engine check, so both sides read the same file. Bridgewater's own 133.2 anchor is not involved.

## Annual heating (the gate)

| Case | Zones | Monthly estimate | Hourly run | Difference | Gate ±10 % |
|---|---|---|---|---|---|
| Bridgewater, one zone | 1 | 121.2 MWh | 116.4 MWh | +4.1 % | pass |
| Bridgewater, five storeys | 5 | 119.5 MWh | 114.8 MWh | +4.1 % | pass |
| Community centre, as saved | 9 | 41.8 MWh | 41.2 MWh | +1.5 % | pass |
| Community centre, today's air method | 9 | 41.8 MWh | 41.2 MWh | +1.5 % | pass |

The community centre plan states no air method, so it already runs on today's method and the two rows are the same run. The second row stays in so that a plan saved with weather-driven air later shows the difference.

**Per room (reported, not gated):**
- **Bridgewater by storey:** +8.3, −0.4, +2.1, −1.9 and +6.9 %.
- **Community centre by room:** −3.8 % (store) to +6.0 % (comms room).

The monthly method takes each room on its own, with no heat between rooms. In Fabric only every room is at the same temperature, so that heat is small, and it shows mainly on the ground and top storeys.

**By month.** The monthly estimate is higher in mid-winter (Bridgewater, one zone: January +1.5 MWh) and lower in May (0.2 against 1.3 MWh). On five storeys September is 2.1 against 0.4 MWh. Shoulder months are where a monthly utilisation factor is known to be coarsest. The year is within the gate.

## Each line's own effect

The two engines draw some lines at different places, so they are compared in groups:

- **The hourly run's fabric lines are at the outside face.** Its conduction, opaque solar and sky lines are each element's heat at its outside surface; they net to the fabric's heat into the room. The monthly method's lines are its ISO terms (U·A·Δθ; α·R_se·U·A·I; R_se·U·A·h_r·Δθ_sky·F_sky).
- **The pane is split differently.** The hourly run's `glazing_solar_absorbed` is all the solar absorbed in the pane, and its outward share is in the window's conduction line. The monthly line is only the inward share.

Bridgewater, one zone, kWh a year (heat into the room positive):

| Group | Monthly | Hourly | Note |
|---|---|---|---|
| Fabric: conduction + opaque solar + sky + pane absorbed | −114,043 | −129,880 | hourly room floats above 21 °C in mild hours and loses more |
| Thermal bridging | −26,221 | −29,063 | the same, through bridges |
| Infiltration (q50 ÷ 20) | −29,070 | −32,221 | the same, through air |
| Permanent vents | −16,666 | −16,682 | |
| Solar transmitted | +97,623 | +97,623 | the same hourly optics, summed by month: equal |
| Solar lost back out through glazing | −9,783 | −6,133 | monthly takes the inside split on diffuse plus floor reflection |
| Gains not used (monthly only) | −23,040 | — | in the hourly run this heat shows as the extra losses above |
| Heating | +121,200 | +116,375 | +4.1 % |

The monthly method keeps the room at 21 °C in every term and puts the gain it cannot use into one line, `gains_not_used`. The hourly run lets the room float above 21 °C, so the same heat leaves through the fabric, bridges and air lines; they are larger by 15.8 + 2.8 + 3.2 = 21.8 MWh. Against the monthly method's 23.0 MWh of unused gain, that leaves 1.2 MWh. The rest of the 4.8 MWh heating gap is mainly solar lost back out through the glazing (3.7 MWh more in the monthly estimate).

## Speed (P3)

Measured with `scripts/122_perf.mts`; results are in [`02_speed.json`](02_speed.json).

| Case | First call on a weather file | Each call after (median of 21) | Hourly run, Fabric only |
|---|---|---|---|
| Bridgewater, five storeys | 33.6 ms | 1.9 ms | 240 ms |
| Fifty rooms (Brief 104 grid) | 10.8 ms | **6.8 ms** (budget 10 ms: pass) | 1,461 ms |

These are engine times. The editor's own levelling and library check come on top.

**The first call is slower** because it works out the sun on each orientation and then keeps it for that weather file. After that, each edit costs the cached time.

## What the monthly estimate leaves out (shown with it, `notes`)

- **It is the ISO 52016-1 monthly method, not the hourly run.**
- **Each room alone:** heat between rooms is not counted.
- **Heated all day:** no heating hours, setbacks or setpoint profiles.
- **Weather-driven air is not used:** leakage is q50 ÷ 20, and vents use today's wind formula. A vent with no flow mode is taken as single-sided, and the note says so.
- **Constants are named** in `monthly.ts`: a₀ = 1 and τ₀ = 15 h (ISO 13790 12.2.1.1). C_m follows ISO 13786 Annex C simplified: 0.10 m, half the thickness, or the first insulating layer, where we read insulating as λ < 0.1 W/mK or a no-mass layer. The room's air and its stated internal capacity are added, as in the hourly run's air node.
