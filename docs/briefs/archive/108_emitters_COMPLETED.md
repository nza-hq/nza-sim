# Brief 108 — Simulate v2: emitters per room, capped heat output, re-rated for flow temperature

Written 15 Nov 2026 by Linzie's project agent.

**What Linzie asked for** (15 Nov 21:28), quoted:

> "One thing I do want to build into this is a behind-the-metre tool. We can say, 'Right, we've got two radiators in room one. Each of those radiators has 500 W output. Then the most heat that they can ever give out is 1 kW in that room.' I want to do this so we can help size systems. If we ever did change from a gas boiler wet radiator system to one with a heat pump, then we can figure out how those radiators might perform at lower flow and return temperatures."

**Follow-ups from Linzie** (15 Nov 21:35):
- *Not just radiators.* Any terminal unit (VRF indoor units, fan coils, electric heaters, underfloor) "can do X kW". This brief covers every kind.
- *Dynamics.* Heat should not arrive instantly. This brief carries each emitter's radiant share (heat that warms the room's surfaces first). The time response goes to Brief 109:
  - underfloor heat into the slab;
  - emitter warm-up;
  - morning boost within capacity.
- *End goal.* Realistic hourly load profiles, compared and calibrated against metered data. Outputs stay hourly per system.

## Scope (CLAUDE.md process rule 10), and the scope change it needs

This brief is in the Systems module, and it changes the Simulate v2 engine (Engines 1 and 2). Today's engine (`instantCalc.js`, `systemsEngine.js`, `nza_engine/`) is not touched.

**The scope change.** CLAUDE.md's Systems scope says "proportional split only (no priority+capacity…)". That rule is about stacking systems. Emitter output limiting the heat a room can receive is a new thing.
- The CLAUDE.md Systems scope gains one line in Part 6: "Emitter capacity per zone (Brief 108, Linzie 15 Nov 2026): a zone's heating is limited to its emitters' output at the system's flow and return temperatures; the zone then runs below its setpoint, and the unmet hours are reported."
- Proportional split between systems stays as it is.
- The design note's scope fence ("no plant curves, no part load") is unchanged. This brief rates emitters, not plant.

**Out of scope:**
- weather-compensated flow temperatures (one design flow and return per system for now);
- heat pump COP varying with flow temperature;
- pipework and distribution;
- cooling emitter limits;
- the editor's own input screens. The editor thread builds those against the schema here, and is told when the schema lands.

## BEFORE DOING ANYTHING

- [ ] Read CLAUDE.md (Systems scope, Rules 8, 9, 10), the Brief 107 docs, and `zone.ts` / `network.ts` control code (Engine 1 `phi`, Engine 2 active set).
- [ ] Brief 107 is closed, or at least reviewed, before Part 2 changes the engine.
- [ ] Branch `chris/108-emitters` (stacked on 107).

## Part 0 — Reconnaissance

- **File:** `docs/audit/108/00_reconnaissance.md`.
- **Rating method.** EN 442 rating:
  - Output is Q = Q_rated × (ΔT / ΔT_rated)^n.
  - ΔT is the log-mean water-to-room temperature difference: (T_flow − T_return) / ln((T_flow − T_room) / (T_return − T_room)).
  - The rated condition is 75/65/20 °C (ΔT 50 K).
  - Typical n: 1.3 for panel radiators, about 1.1 for underfloor heating, and about 1.0 for fan coils. Fan coils are rated by their own data.
- **Engine control paths.** How each engine's control would take a cap:
  - Engine 1 limits `phi`.
  - Engine 2 adds a third active-set state, "heating at its limit", in which the zone floats with a known heat input.
- **What today's tool has.** `capacity_kw` exists on systems, unused by today's engine.
- **The EnergyPlus referee.** The plan is `ZoneHVAC:IdealLoadsAirSystem` with `Heating Limit = LimitCapacity` at each zone's emitter output. Part 0 checks that this is EnergyPlus's convention.
- **Commit:** `108 P0: reconnaissance`.

## Part 1 — Schema 2.4: emitters per zone, design temperatures per heating system

- **Each zone gets `emitters[]`**, as settled in Part 0 (decision 1), with `kind` one of `radiator`, `underfloor`, `fan_coil`, `vrf_indoor`, `electric`, `other`.
  - Every emitter states its count, its output, and its `radiant_fraction` (the share of its heat that goes to the room's surfaces rather than the air).
  - A wet emitter (`radiator`, `underfloor`, wet `fan_coil`, `other`) names its heating group and its rating: flow, return and room temperatures, and exponent n.
  - A `vrf_indoor` or `electric` unit has a fixed output in kW. A VRF unit's capacity falling with outdoor temperature is out of scope here and stated.
  - Nothing is defaulted.
- **Each heating system group gets** `design_flow_c` and `design_return_c` (nullable; required when any zone it serves has emitters).
- **Optional per zone.** A zone without emitters is uncapped, as today: ideal loads. The panel says so ("no emitters stated: output not limited").
- **Upgrade and converter.**
  - The 2.3 → 2.4 upgrade adds empty lists.
  - The converter writes none, so today's projects run as before.
  - The seam keeps refusing older versions (Brief 105 F1).
- **Commit:** `108 P1: schema 2.4, emitters`.

## Part 2 — Capped heating in Engines 1 and 2

- **The cap.** A zone's maximum heating, W, is Σ count × rated_output × (ΔT / ΔT_rated)^n.
  - ΔT is taken at the system's design flow and return and the zone's heating setpoint, held for the year (a design rating, stated).
  - A zone served by several heating systems (shares) takes each share's emitters at that system's temperatures. Part 0 settles the exact form.
- **Engine 1:** `phi` is limited to the cap.
- **Radiant share.** Heating's radiant part goes to the zone's surfaces, by the zone's emitters' output-weighted radiant fraction. Today it is all to the air in Engine 2 (`hc_convective_fraction`), so this becomes a per-zone value. With no emitters stated, nothing changes.
- **Engine 2:** a third state in the active set. A capped zone floats with its heating fixed at the cap. Convergence stays guarded.
- **Results:**
  - per zone: unmet heating hours (hours the control temperature is more than 0.5 K below the setpoint, stated), the lowest temperature, and the hours at the cap;
  - peak demand uncapped (from a second, uncapped pass, or recorded in the same pass), against the cap.
- **Closure and breakdown (Rule 9).** Both hold every hour. The heating line is the capped heat.
- **Tests:**
  - a cap above the peak changes nothing, value for value;
  - one zone in constant cold weather settles at the temperature where loss equals the cap, analytically;
  - two zones, one capped: the neighbour picks up the extra heat it now loses through the partition;
  - closure every hour.
- **Commit:** `108 P2: emitter-capped heating`.

## Part 3 — The EnergyPlus referee

- **The cases:**
  - the cooled-room twin with the heated rooms capped below their peak;
  - Bridgewater five storeys with one storey capped.
- **Referee:** `IdealLoadsAirSystem` `LimitCapacity` at the same cap.
- **Gate:** unmet hours, lowest temperature and annual heating within agreed tolerances, printed. Proposed: annual heating ±10 %, unmet hours ±20 % or ±50 h, lowest temperature ±1 K.
- **Commit:** `108 P3: referee`.

## Part 4 — Systems and sizing

- **Systems.** `systems.ts` serves the capped heat; energy falls with it, and the unmet hours say why.
- **Sizing, per zone:**
  - the peak demand;
  - the emitters' output at the design temperatures;
  - the shortfall;
  - the rated output (ΔT 50) the zone would need at those temperatures: peak ÷ (ΔT / 50)^n, using the zone's emitter exponent.
- **What-if (Linzie's case).** The same rooms at a second pair of flow and return temperatures, for example 70/60 against 50/40. The seam runs the building twice, changing only the design temperatures, and reports both side by side.
- **Commit:** `108 P4: sizing`.

## Part 5 — Results panel

- **Per zone:** emitters' output against peak need, unmet hours and lowest temperature, and "needs X W more at 50/40 °C (Y W rated at ΔT 50)".
- **Building:** zones short of output, and the energy at each pair of temperatures.
- **Browser check** at 1440×900 on the editor's fixture with emitters added.
- **Commit:** `108 P5: emitters in the panel`.

## Part 6 — Close

- An independent review by a separate thread.
- The CLAUDE.md Systems scope line, STATUS, `current.md`, archive, and design note Rev A.10.
- A PR into main; it is merged only with Linzie's approval.
- **Commit:** `108 P6: close`.

## Verification (falsifiable)

1. All tests pass. With no emitters stated, every result equals Brief 107's, value for value.
2. Analytic: the capped zone's temperature equals the balance at the cap to 0.01 K. Closure holds every hour.
3. The referee is within the printed tolerances.
4. Sizing: the stated rated output, re-run at those temperatures, leaves zero unmet hours (to rounding).
5. No file of today's engine is touched. The anchor is 133.2.
