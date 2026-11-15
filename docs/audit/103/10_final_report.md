# Brief 103 final report: Simulate v2 Engine 1

Engine 1 is a pure TypeScript, one-zone, hourly ISO 52016-1 envelope engine in `frontend/src/thermal/engine/`. It
runs from the model document and an EPW, and nothing in today's tool changed. Branch `chris/103-engine-1`.

## What landed, per Part

| Part | Commit | Result |
|---|---|---|
| Brief, Rev B | d1d295b, 8a4d680 | Brief on disk. Rev B: EnergyPlus as the demand referee, per-element bridging, speed budget. |
| P0 | 3b84614 | Reconnaissance (`00_reconnaissance.md`). |
| P1 | 05abacc | 102 QA store fixes. Migration 0005 applied on NZA Sim (dev) only. |
| P2 | 55a2c95 | EPW parser equal to the backend's value for value. Solar equal to today's `solarCalc` on 43,800 values. Schema 2.1. |
| P3 | e1f36a8 | One-zone balance. Analytic cases (a)–(d) agree to rounding; closure under 1 Wh every hour. |
| P4 | 9f71318 | The document-driven engine, results, and a breakdown line per term. BESTEST escalated. |
| P5 | 34c6584 | The EnergyPlus referee on the same building: **90.46 / 13.65 MWh**. |
| P6 | a9be2ef | Bridgewater gates. (a) passes on every path at 0.000 %. (b): heating passes, cooling misses. |
| P6a | b60ec73 | BESTEST twin in EnergyPlus. It is in range, and each ISO simplification is measured inside it. |
| P6b | 194f6e0 | Surface-physics options. The referee runs with the beam on the floor. |
| P6c | 4f03c12 | Independent review fixes (`08`, `09`). |
| P7 | this commit | Close. |

## The anchor envelope

**Gate (a): every path agrees with State 1 at 0.000 %.** This covers walls, roof, ground floor, glazing, leakage,
vents and bridging. Transmitted solar differs by −8.94 % by design: the F_W of 0.9 plus the sun convention. With
those removed it is 0.000 %.

**Gate (b): Engine 1 against the EnergyPlus referee, MWh.**

| | Referee | Engine 1 | Δ | Within ±10 % |
|---|---|---|---|---|
| Heating | 90.46 | 89.98 | −0.5 % | yes, net of offsetting terms (about ±3 %) |
| Cooling | 13.65 | 15.32 | +12.2 % | **no**, recorded as open |

**The cooling miss is recorded as open.** Interior slab mass is consistent with it: removing the slabs' mass in the
referee moves cooling by 6.6 MWh. That does not prove the slabs are the cause, because BESTEST 900, with one zone and
no slabs, shows a residual of the same sign.

## The reference case: BESTEST

| | Heating MWh | Cooling MWh | Range heating | Range cooling |
|---|---|---|---|---|
| 600, Engine 1 | 4.547 | 5.628 | 3.993–4.504 | 5.432–6.162 |
| 600, EnergyPlus | 4.289 | 6.016 | | |
| 900, Engine 1 | 2.186 | 2.755 | 1.379–1.814 | 2.267–2.714 |
| 900, EnergyPlus | 1.652 | 2.507 | | |

- **Engine 1 is outside the range on 600 heating (+0.04) and on 900 heating and cooling (+0.37 / +0.04).** These are
  escalated, not tuned.
- **Peaks:** 600 peak cooling is below its range, and 900 peak heating is above its range.
- **EnergyPlus from the same inputs is in range** on all four cases.
- **Engine 1's three ISO simplifications, put into EnergyPlus, explain most of the gap.** With them, EnergyPlus gives
  4.683 on 600 heating. The 900 residual is open.

## Speed

- One zone: 35 ms in Node, 25 ms in a browser worker (budget 100 ms).
- 50 independent zones: 0.91 s and 1.02 s (budget 2 s).
- Node and worker give identical numbers.

## Divergences from the brief and the design note

1. **Script type:** `103_anchor_envelope.mts`, not `.mjs`, because the engine is TypeScript.
2. **Gate (b) reference:** Run Bi's 68.7 / 34.8 MWh was replaced by Part 5's like-for-like referee, 90.46 / 13.65.
   Run Bi reproduces exactly once its four input mismatches are put back.
3. **Part 6a/6b/6c added:** the BESTEST twin, the surface-physics options, and the review fixes.
4. **Run options:** `REFEREE_OPTIONS` puts the beam on the floor. Wind-driven and heat-flow convection are options,
   off by default.
5. **New refusals:** Engine 1 refuses a library y-factor other than 1, refuses a missing ISO 14683 multiplier, and
   refuses an unbalanced result.
6. **Interior partitions** are deferred to 104 and not added to schema 2.x here.

## Lessons proposals

1. **A referee must model the same building before its number is a gate.** Run Bi differed from the document in four
   inputs: frame, ground, wind and bridging allocation. Those were worth more than the engine difference.
2. **Measure a simplification inside the referee.** Put the simplification into the referee and compare there; do not
   argue about it from outside. One run per simplification settled what argument could not.
3. **Closure must fail at run time, and the display sum must be asserted.** The review's mutation test showed a
   dropped breakdown line passed every test until this was enforced. This is Rule 9's door-bug class.
4. **A choice that lands nearest needs a stated reason that would hold if it did not.** Otherwise record it as open.

## What 104 (multi-zone) needs from this engine

- **Interzone surfaces.** `SurfaceKind` already has `partition`, `floor` and `ceiling`, and `zone_b` takes any zone
  id. The interface system grows from (E+1) per zone to the coupled set. Keep factorise-once.
- **Interior slabs as real elements.** This is the open cooling-miss item.
- **Open physics items, testable cheaply on BESTEST 900:**
  - inside long-wave by view factors;
  - the sky from the EPW's infrared;
  - a sub-hourly step;
  - a TARP-form natural-convection option.
- **The y-factor:** the document must say how to carry a library y-factor. Engine 1 refuses one for now.
- **Unvalidated shared inputs:** ground (an ISO 13370 virtual layer, worth 3.7 MWh) and wind exposure (worth 5.0 MWh).
- **The 50-zone budget:** 1.0 s in a worker for independent zones. The coupled solve must stay under 2 s.
