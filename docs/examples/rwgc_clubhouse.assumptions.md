# Royal Wimbledon Golf Club clubhouse: what the model takes, and from where

Model: `docs/examples/rwgc_clubhouse.plan.json`, made by `scripts/example_rwgc_plan.mts`. In NZA Sim, open it with
**Open an example → Royal Wimbledon Golf Club clubhouse**. Built 18 Nov 2026 for NZA project 24022.

This is a real building. Each figure below either comes from a source (named) or is an **assumption** (marked).
Replace an assumption when better information arrives.

## Sources

| What | Source |
|---|---|
| Rooms, floors, windows, doors | SolidPoint's measured survey, Revit `1706 - Royal Wimbledon Golf Club_Rvt23_rev2` (K_Client/2025_09_03), converted to IFC/GLB |
| Construction blocks and U-values | CA-1000 RWGC Energy Calcs, "U Values" and "Building Inputs" (Atkins fabric survey for glazing); Energy Strategy RP-1000 P01.1 §3.2 |
| Heating, hot water, BMS | Energy Strategy §4.1–4.4 |
| Radiators and fan convectors | CA-1000 "XX-Rad Schedule" (outputs at ΔT50) |
| Which rooms have which system | Heating strategy sketch SK-1000 P01, "Existing" (radiators, fan convectors, DX and radiators, extract only, unconditioned) |
| Opening hours | RFI dump 2026-10-05, "Opening hours.xlsx" |
| Meter check | 2025 clubhouse gas 330,648 kWh (British Gas); electricity 212,360 kWh (half-hourly; 11–12 kW overnight floor) |

## Geometry

- **Three floors, stacked 3.0 m apart.** NZA Sim now supports stacked floors. Ground 1,590 m² (two blocks: the
  clubhouse and the pro shop), first 442 m², second 53 m². Total 2,085 m².
- The Revit rooms are traced onto a 0.25 m grid so that they tile each floor wall to wall, as NZA Sim needs. Walls and
  small gaps go to the nearest room, and the outline sits 0.15 m outside the rooms' inside faces. Floor areas therefore
  run about 5–8 % above Revit's room areas, which are measured to the inside faces.
- Rooms under 2 m² (WC cubicles, risers, ducts) are folded into the rooms next to them. The Bar (402) and one Toilet
  (381) have no floor faces in the export, so they are recovered from the gaps they leave.
- **Assumption:** Revit's +y is taken as north (the dining room's large windows face south, as the calcs say).
- **Assumption:** one storey height for every floor (3.0 m). The double-height dining room (5.2 m) and Lounge 3
  (4.5 m) are modelled at 3.0 m, which understates their volume.
- The first floor in Revit is 442 m², against 561 m² in CA-1000. The calcs' extra first-floor area is not in the
  survey, so it is left out.
- Windows, doors and curtain-wall glass are placed on the nearest outside wall within 1 m (doors within 0.6 m).
  Inside doors are dropped. Where two openings overlap on a wall, the larger is kept (32 dropped). No wall is more than
  80 % glass, so that EnergyPlus has some wall around its windows. The result is 119 m² of glazing and 68 m² of doors,
  against 229 m² of windows and doors in CA-1000.
- **Assumption:** every roof is flat. Pitched roofs are not stacked yet. The roof U-values from the calcs already
  include the lofts.
- Six small patches of upper floor (0.6–4.4 m² each) sit over no room below. These are taken as floors open to
  outside air.

## Zones (29) and construction blocks

| Block (CA-1000) | Walls / windows / roof / ground floor, U W/m²K | Zones |
|---|---|---|
| 1, c.1880s original | 1.7 / 4.0 single / 0.8 / 0.7 | Lounges 1 and 2, entrance and stair, west toilets, west back of house, men's changing (2), showers, trophy room, roof stores |
| 2, c.1910–30 | 1.6 / 4.0 / 0.8 / 0.7 | Lounge 3 (fan convectors) |
| 3, c.1960s–90s | 0.6 / 2.8 / 0.35 / 0.35 | Main, double-height and east dining rooms, bar, kitchen, south corridor, ladies' changing and lounge, plant room, office, first-floor corridor, caretaker's flat |
| 4, c.2000s | 0.4 / 2.0 / 0.22 / 0.25 | Staff room, equipment store |
| 5, c.1960 pro shop | 1.4 / 2.8 / 0.8 / 0.7 | Pro shop, pro shop office, golf simulator, pro shop lounge |

- The U-values are typed over the nearest library construction. Layers are scaled to the U.
- **Assumption:** which block each room belongs to is read from the plan (the calcs give areas, not room lists).
  Block 1's areas match well. Block 4 comes out larger, because the survey's equipment store is all Block 4.
- **Assumption:** floors between storeys use the library's "interior floor / ceiling" construction.
- **Assumption:** air leakage is 12 m³/h·m² at 50 Pa for the whole building. The calcs give 0.1–0.75 ACH by block,
  and the strategy calls air leakage "likely the single biggest driver of heat loss". Thermal bridging is ×1.5 the
  ISO 14683 defaults. Site: suburban, normal exposure.

## Systems

| System | Template | Figures |
|---|---|---|
| 4 × Ideal Concord Super 200V on LTHW, six BMS zones | **draft:** non-condensing gas boiler, 85 % (Energy Strategy) | 200 kW, 75/65 °C |
| CT circuit fan convectors (Lounge 3) | on the same boilers | 2 × 5 kW (rad schedule "Fan convector", manual input) |
| Beaumont 250 water heater (1992) | **draft:** direct gas water heater, 80 % (Energy Strategy) | 146 kW, 768 L, 60 °C store |
| Combi boilers, caretaker's flat and pro shop (Block 5) | condensing gas boiler (library, 92 %) | **assumed** 24 kW each, hot water first |
| DX splits: office, east dining room, pro shop office, golf simulator | split AC (library, SEER 2.8) | **assumed** 3.5 kW units: 1 / 2 / 1 / 2 |
| Kitchen extract (untempered make-up air) | MEV | **assumed** 8 l/s·m², 06:00–16:30 |
| Toilet, shower and changing extract | MEV | **assumed** 1.5 l/s·m², 06:00–22:00 |
| Lighting, fluorescent and LED | — | **assumed** 2.6 W/m² per 100 lux |

- Radiators are taken room by room from the rad schedule: 56 radiators, 90 kW at ΔT50. The schedule's location
  codes are matched to the survey's rooms. **Assumed** where the schedule lists none but the sketch shows radiators:
  bar (1 × K2 1600×400), staff room (2 × K2 1200×500), pro shop (3 × K2 1600×500), pro shop office, simulator and
  lounge, showers (1 × K2 1000×500).
- **Which rooms are cooled** (Linzie: "choose which systems are in which rooms"). The sketch marks only the east
  dining room as "DX units and radiators". The strategy says DX serves offices, prep kitchens and cellular spaces. The
  model cools the first-floor office, the pro shop office and the golf simulator too. The kitchen stays extract-only,
  as the sketch shows it.
- Unheated rooms (west back of house, plant room and stores, equipment store) are held above 5 °C (frost protection),
  because NZA Sim runs a room only with a setpoint. They have no emitters, and they barely call for heat.
- **Assumed** pumps: NCM defaults ("Use defaults"). Hot water circulation pump: 120 W.
- Controls are recorded: Trend IQ BMS on the boilers, hot water and toilet extract; local controls on the combis, DX
  and kitchen extract; lighting switched by hand. NZA Sim records these but does not use them in the calculation yet.

## Use and hours

- Members' areas: 07:30–21:00 every day, busiest at lunch. The bar's seasonal close (19:30 in winter to 22:30 in
  summer) is averaged to 21:00. Kitchen: 06:30–16:00 daily. Office: weekdays 07:30–17:30. Pro shop: 07:00–18:00
  daily (summer 19:00 and winter 17:00, averaged). Changing rooms: 06:30–20:00.
- **Assumed** seasonal busyness for members' areas, changing and pro shop: 0.6 in January rising to 1.2 in July.
- **Heating (assumed BMS times):** clubhouse 21 °C 06:00–21:00 every day, 16 °C set back (CA-1000's design and
  set-back temperatures). Office: weekdays 07:00–18:00. Caretaker's flat: 21 °C mornings and evenings. Pro shop:
  20 °C 06:30–18:00. Kitchen: 18 °C. DX cooling: 24 °C, 07:00–21:00.
- **Assumed** people: lounges 0.3/m², dining 0.5/m², changing 0.2/m², offices and shop 0.1/m², flat 2 people.
- **Assumed** hot water, chosen so the total is about 4–6 m³ a day (the strategy's figure): changing 40 L/person,
  kitchen 15 L/m², toilets 5 L/m², dining 6 L/person, flat 115 L/person.
- **Assumed** equipment (W/m², in use / always on): kitchen 100 / 12, bar 20 / 40 (cellar and bottle coolers),
  office 12 / 2, simulator 25 / 2, lounges 3 / 1.
- **Assumed** other loads: external lighting 1.5 kW, dusk to dawn; buggy charging 6 kW, 20:00–06:00. A further
  4 kW runs all the time for **base load not yet traced to a room**. The meter never drops below 11–12 kW overnight,
  and this 4 kW is what the model's rooms do not already explain. It should be replaced once submetering shows what
  it is.

## Check against the 2025 meters

On London weather (St James's Park TMYx, 2009–2023; the EPW is not committed). The run is
`scripts/example_three_tiers.mts`, and its results are in `docs/audit/examples/rwgc_clubhouse_three_tiers.json`.

| | Model (15-minute run) | EnergyPlus | 2025 meter |
|---|---|---|---|
| Gas | 317 MWh | 299 MWh | 331 MWh |
| Electricity | 204 MWh | 204 MWh | 212 MWh |
| Peak heating | 110 kW | 102 kW | (calcs: 128 kW design, 130 kW in the strategy) |

The base-load figure, the kitchen's equipment and the extract rates were adjusted towards the meters. Nothing else
was tuned. Several rooms are short of heat for part of the year: the 1880s changing rooms, the first-floor corridor
and the attic trophy room and stores, where the scheduled radiators are small for the fabric. This matches the
strategy's note that the radiators total about 89 kW against a heat loss of about the same.
