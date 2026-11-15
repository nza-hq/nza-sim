# Brief 103 Part 4 — infiltration, vents, solar, comfort band, results; the reference case

15 Nov 2026, branch `chris/103-engine-1`. No file of today's tool changed.

## What landed (`frontend/src/thermal/engine/`)

- `model.ts`: `runZoneModel(document, weather, library, options)`. It reads only Building-module inputs from the
  document and raises an error naming the path for anything missing. It handles one zone; multi-zone is 104.
  - `REFEREE_OPTIONS` is the setting the EnergyPlus comparison uses:
    - air thermostat;
    - ideal convective heating and cooling;
    - 25 warm-up days;
    - albedo 0.2;
    - the actual day of the year for the sun;
    - apparent solar time.
- `air.ts`: infiltration from q50 (n50/20 over the whole envelope) and permanent vents (single-sided and cross),
  ported from today's engine with a provenance header. The stack term is absent, as today.
- `bridging.ts`: ISO 14683 junctions and ψ values, ported. It reads the zone polygon, storeys and glazing.
- `shading.ts`: today's overhang and fin factor, ported.
- `solar.ts`:
  - New `solar_time` option: `'clock'` is today; `'apparent'` applies longitude and the equation of time (Duffie & Beckman).
  - The sun track is computed once per weather file and shared by every surface.
- `results.ts`: `ZoneResults` with one exposure per quantity (Rule 11) and a `readZone*` helper for each:
  - hourly air, operative and mean radiant temperature;
  - hourly heating and cooling;
  - annual totals and peaks;
  - conductances per element, glazing, infiltration, vents and bridging;
  - a breakdown line for every term of the balance, per element where it has one (Rule 9);
  - the closure.
- `zone.ts`:
  - Each element's layer chain is condensed onto its inside surface once (static condensation). What remains is a
    system of size elements + 1, factorised once. Each hour is now O(nodes), down from O(nodes²), with identical
    results; the analytic cases are unchanged.
  - The zone also accepts other gains with a convective share. The document maps nothing to it; it exists for
    BESTEST's fixed 200 W.
- Engine constant `glazing_angle_factor` F_W = 0.9 (ISO 13790 11.4.2, kept by ISO 52016-1 Annex B): normal-incidence
  g reduced for the mean angle of incidence. Today's engine applies none. Part 6 compares transmitted solar with this
  factor named.
- Schema 2.1 additions in this Part (not yet released beyond this branch):
  - Every permanent vent states its cd and flow mode. The converter writes today's resolved values.
  - Outside glazing and exposed floors carry emissivity.

## Gate: the published reference case (ASHRAE 140 / BESTEST 600 and 900) — **FAILS for heating; escalated**

**Inputs** come from the open LBNL Modelica Buildings library BESTEST models (BSD licence):
- layers, 0.414 ach of sea-level air, 200 W (60 % radiant), 20/27 °C on air;
- the window computed from `Glass600` (U 2.87, g 0.760, EN 673 / ISO 9050);
- Denver TMY3 725650 weather, held locally with its sha256 pinned.

**Ranges** are the same library's ASHRAE 140 reference-program records. The test is
`engine/__tests__/bestest.test.ts`.

| Case | Annual heating MWh | Annual cooling MWh | Peak heating kW | Peak cooling kW |
|---|---|---|---|---|
| 600 Engine 1 | **4.698** (range 3.993–4.504, **+4.3 % above max**) | 5.725 (5.432–6.162, in) | 3.304 (3.020–3.359, in) | **5.134** (5.422–6.481, below) |
| 900 Engine 1 | **2.436** (range 1.379–1.814, **+34 % above max**) | **2.976** (2.267–2.714, **+9.7 % above**) | **2.857** (2.443–2.778, above) | 3.315 (2.556–3.376, in) |

**Free-floating checks, a diagnostic** (ranges are the same library's 600FF and 900FF records):

| Case | min °C | max °C | mean °C |
|---|---|---|---|
| 600FF | −12.4 (range −13.8 to −9.9, in) | 62.4 (62.4–68.4, at the edge) | 24.45 (24.3–26.1, in) |
| 900FF | **−1.0** (range 0.6–2.2, below) | **46.3** (43.3–46.0, above) | **24.47** (24.5–25.7, just below) |

The lightweight case is close. In the heavyweight case the zone swings too far: its mass does too little.

**What I tried.** These are sensitivity probes, none adopted; each moves 900 heating:

| Probe | 600 heat / cool | 900 heat / cool |
|---|---|---|
| as built | 4.70 / 5.72 | 2.44 / 2.98 |
| floor inside convection 2.5 or 5.0 instead of 0.7 (direction of flow) | 4.88–5.00 / 6.05–6.26 | 2.44–2.45 / 3.05–3.11 |
| 60–90 % of transmitted solar onto the floor instead of by area | 4.53–4.60 / 5.63–5.66 | 2.17–2.28 / 2.75–2.83 |
| 90 % to floor, floor h_ci 5 | 4.61 / 6.36 | 2.11 / 3.22 |
| massive layers cut to 10 mm instead of 50 mm | unchanged | unchanged |
| no sky term (diagnostic only) | 4.37 / 6.01 | 2.17 / 3.31 |
| outside convection 10 instead of 20 | 4.64 / 6.33 | 2.25 / 3.40 |

**Reading.**
- Discretisation is not the cause.
- No single ISO 52016-1 simplification closes the 900 heating gap. The two physical ones each move it by 0.2–0.3 MWh:
  - transmitted solar spread over surfaces by area, where EnergyPlus and the reference programs put the beam on the floor;
  - fixed inside convection whatever the direction of heat flow.
- The constant g with F_W, the fixed outside film and the constant sky difference also matter. A published
  comparison of the ISO 52016-1 method against EnergyPlus names these same assumptions as non-negligible:
  De Luca, Bianco Mauthe Degerfeld, Ballarini, Corrado, *Energies* 14(20) 6841, 2021.
- I found no published ISO 52016-1 Case 900 numbers to compare with. ISO/TR 52016-2 is paid.
- Not tuned (Rule 10). The decision on which refinements to adopt is escalated with this table.

## First look at the anchor (information; gate (b) is Part 5–6)

Engine 1 on the Bridgewater anchor document with `REFEREE_OPTIONS`: **heating 89.9 MWh, cooling 15.4 MWh**, closure
4.9e-9 Wh. Run Bi (EnergyPlus) gave 68.7 / 34.8.

Before any physics is blamed, three places where Run Bi's model is **not** the document's envelope have been found:
1. **Window frame.** EnergyPlus glazes the whole opening (`wwr × facade`, no frame). The document, State 1 and
   Engine 1 put 20 % of each opening in frame, so EnergyPlus admits about 25 % more solar.
2. **Ground temperature.** The assembler writes no `Site:GroundTemperature:BuildingSurface`, so EnergyPlus uses its
   default 18 °C. The document says the annual mean outdoor temperature: 10.6 °C for the anchor EPW.
3. **Bridging** is spread as a uniform ΔU over walls, roof and the ground floor (the decision-6 tidy-up).

Internal mass is a fourth difference: the document carries 250 kJ/K·m² and Run Bi none, but Run Ci showed it moves
EnergyPlus by 2 % or less. Part 5 builds the referee with all four made equal to the document. The gap is judged
only after that.
