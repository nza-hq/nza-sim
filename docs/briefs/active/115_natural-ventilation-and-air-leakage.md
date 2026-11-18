# Brief 115: Simulate v2, air movement (air leakage, trickle vents, openable windows)

**Status: APPROVED by Linzie 16 Nov 15:06 ("Yes to both": input placement and referee gates as written).** Written by the natural-ventilation design thread. Design: https://claude.ai/artifact/XDaxZV42uc7LdmiEbaRvvj.
Starts after 112 and 114, in the order below.
**Decided 16 Nov 08:34 (Linzie):** new models default to `air_method: 'weather_driven'`; existing models keep
`'today'` (fixed n50/20) until switched, so Bridgewater stays 133.2.

**Numbering:** 113 is the decodED link, 114 is Controls and back of house (workspace-plan thread). This is 115.
The meter check moves to 116 or later.
**Owners:** P0 to P5 and P8 belong to the building thread (schema, `thermal/engine/`, `sim2/run/`, referees).
P6 and P7 belong to the editor thread (workspace steps and results).
**Order:** after 112 and 114 (window rules live in 114's Controls step). Phase 2 (air between rooms) is a
separate brief, 115b, after this one closes.

## Scope (Rule 10)

Simulate v2 only. Today's NZA Sim (`instantCalc.js`, State 1/2/inline-legacy, `openingCoefficients.js`) is not
touched; `openingCoefficients.js` is read, not changed. Placement per the workspace rules: air leakage, trickle vents
and the window's physical opening are **Fabric**; window positions and heights are **Shape**; terrain and shielding
are **Site**; when windows may open and the open-above temperature are **Profiles**; how windows are used is
**Controls** (Brief 114). Nothing here goes in Systems: natural ventilation uses no energy.

## Why

Linzie, 16 Nov 00:55: natural ventilation and air leakage must be part of the model and well thought through: where
openings go, a profile for when and how windows open, how far they open, and a stated method for infiltration,
natural ventilation and stack. Today's tool has three separate correlations (n50/20 leakage, wind-only vents,
windows with stack only in temperature mode), labels single-sided and cross by hand, and has never been refereed.
The new engine refuses operable openings.

## The method (from the design proposal)

One air model for every opening to outside, solved per room per time step:

1. Wind at each opening's height from the EPW 10 m wind, power law by terrain (EnergyPlus's exponents and
   boundary-layer depths).
2. Wind pressure Cp × ½ρU² per facade; Cp from wind angle: Swami and Chandra (low-rise) or Akins (high-rise), as
   AirflowNetwork's surface-average calculation.
3. Stack from each opening's height and the room and outside temperatures; each room has its own neutral level.
4. Leakage: power-law cracks, Q = C·Δp^n, n = 0.67, C from q50 × envelope area at 50 Pa, shared over the room's
   outside elements by area and height.
5. Trickle vents and windows: orifices, Q = Cd·A·√(2Δp/ρ), Cd from `openingCoefficients.js` or stated; tall
   openings two-way (neutral height within the opening), as AirflowNetwork's detailed opening.
6. Single-sided wind turbulence for rooms with all openings on one facade: the turbulence and wind part of the
   EN 16798-7 single-sided formula, as its own result line, switchable.
7. Effective area from style (side-hung, top-hung, bottom-hung, centre-pivot, sliding, louvre), openable share,
   restrictor and opening angle, per EN 16798-7.
8. Room conductance ρc·Q each step from the previous step's room temperature, through the existing hourly
   ventilation slot (zone.ts Sherman–Morrison; network.ts Z-system).

Mechanical extract imbalance (MEV) enters the balance as a fixed flow. Balanced MVHR does not.

## Rules this must keep

- **No fallbacks (Rule 9 spirit, 105 practice).** Every input is stated on the document. Older documents are
  upgraded with `air_method: 'today'` written explicitly, which runs today's n50/20 leakage and wind-only vent
  formulas exactly as now.
- **The anchor holds.** Bridgewater under `air_method: 'today'` gives EUI 133.2 exactly. Under `'weather_driven'` its
  result is a new, stated second anchor, refereed by R1.
- **Rule 9.** Air leakage, trickle vents, windows, single-sided turbulence (and later air between rooms) are each a
  line in the per-room and building breakdowns, checked integrand-against-display.
- **Rule 8.** At "Fabric only" and "+ Spaces" there are no windows in the run (removed, not closed). Windows arrive
  with Controls at "+ Systems".
- **Rule 11.** Effective opening area derived in one function, read by engine, display and referee writer.
- **Controls must be expressible in EnergyPlus** (AirflowNetwork venting control), so every one can be refereed.
- **No tuning.** A miss is diagnosed to a term, as in 103 to 109.
- **Speed.** One zone < 100 ms; 50 rooms with windows < 2 s on IT15.

## Parts

**P0 Reconnaissance (building thread).** Read `air.ts`, `ventilation.ts`, `model.ts` (vents, the operable refusal),
`zone.ts` and `network.ts` (where hourly ventilation enters and how a per-step value can be supplied), and
`instantCalc.js` openings code (reference only). Confirm EnergyPlus 25.2 AirflowNetwork inputs for each method step
and control. Confirm the EN 16798-7 clauses for the single-sided formula and opening-angle effective area, and write
the exact equations with clause numbers into `docs/audit/115/00_reconnaissance.md`. Stop for review.

**P1 Schema (building thread).** Version bump to the next 2.x, with upgrade:
- `building.site.terrain` ('open' | 'suburban' | 'urban' | 'city') and `building.site.shielding`.
- `building.air`: `air_method` ('today' | 'weather_driven'), `q50_m3_h_m2` or `n50_ach`, `test_area_basis`,
  `exponent` (0.67), optional `split` by element kind.
- Window construction types: `opening` { `style`, `openable_fraction`, `max_opening_angle_deg` or
  `restrictor_mm`, `cd` } and `trickle_vent` { `equivalent_area_mm2`, `type`, `cd` }.
- Glazing surfaces: `sill_height_m`, `head_height_m` (from Shape).
- Operable openings: `control_ref` points to a Controls entry (Brief 114).
- Controls entry with `target.kind: 'window'` (entry shape owned by Brief 114 P1: `{ id, target, controller,
  hours_ref?, ...kind fields }`; `hours_ref` is the allowed opening hours). Window fields, as in 114: `rule`
  ('temperature' | 'adaptive' | 'timetable'), `open_fraction` (of the restricted maximum), `open_above_ref?`
  (temperature profile), `min_open_h?`, `min_closed_h?`, `operation` ('by_hand' | 'automated'). Added by 115:
  `modulation?` { `full_open_below_dk`, `min_open_above_dk`, `min_fraction` } and `adaptive_category?`
  (EN 16798-1 I/II/III, required when rule is 'adaptive'). Whichever of 114 and 115 lands first writes the shape.
- Validation: open-above must exceed the room's heating setpoint in every allowed hour; refuse by name otherwise.

**P2 Engine: leakage and vents (building thread).** New `thermal/engine/airflow.ts`: wind profile, Cp, per-room
pressure balance (Newton, bracketed), cracks, vents. `air.ts` keeps `today` exactly. Hand-check tests: q50 at 50 Pa,
zero flow still and isothermal, two-way single opening, series cross-flow, AM10 worked examples.

**P3 Engine: windows and controls (building thread).** Effective area, two-way openings, single-sided turbulence
term, the control rules with modulation and minimum times, computed each step from the previous step's room
temperature. Per-room results: flows per path, hours open, heat per line.

**P4 Referees R1 to R3 (building thread).** EnergyPlus 25.2, AirflowNetwork MultiZoneWithoutDistribution, Euler at
4 steps per hour, written from the document (by the doc-to-EnergyPlus writer if it exists, otherwise by script saved
under `scripts/115_*`).
- R1 leakage, box_v1 and Bridgewater five storeys: hourly ACH R² ≥ 0.95, annual mean ±5 %, heating ±3 %, per storey ±10 %.
- R2 windows by temperature, one room, single-sided and cross: hours open ±5 %, cooling ±5 %, peak 0.5 K, hours above 28 °C ±10 %.
- R3 night cooling, Bridgewater storey: next-day peak 0.5 K, cooling ±5 %.
- Single-sided turbulence: compared with AirflowNetwork's advanced single-sided option, gated on EN 16798-7 hand values; stated as not exactly refereed.

**P5 Speed (building thread).** `scripts/115_perf.mts`; measure on IT15 at close.

**P6 Workspace inputs (editor thread).** Site terrain and shielding; Fabric air leakage preset with method; window
type opening and trickle vent fields; Shape sill and head heights; Profiles window-opening and open-above
profiles; Controls window rules (inside 114's step).

**P7 Results (editor thread).** The new lines in the heat flow view and room breakdown; "Window ventilation appears
at + Systems, with its controls" at "+ Spaces"; air arrows on the drawing for a chosen hour or the year.

**P8 Review and close.** Independent review in a separate thread (answer in `06_review_response.md`); STATUS,
archive, Notion design note, CLAUDE.md module scope lines; PR merged only on Linzie's word.

## Not in this brief

Air between rooms, stairs, atria, whole-building stack (115b). Overheating reports TM52/TM59. Occupant behaviour
models. Closing in wind or rain. CO₂-driven windows.
