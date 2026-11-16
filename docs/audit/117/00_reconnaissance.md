# Brief 117 Part 0: reconnaissance

16 Nov 2026. This part covers what the v2 model already holds for a design heat loss, which sources the method can rest on, and the decisions. One question is open with Linzie: whether we can work from the text of BS EN 12831-1:2017.

## 1. What the model already resolves (one read path each, Rule 11)

| Quantity | Where | Used for |
|---|---|---|
| Each element's area and U-value (W/m²K), including the window's whole U | `ZoneResults.conductances.elements` (model.ts, from `elements.ts`) | transmission |
| Interzone surfaces, each with both zones | the document's surfaces with `zone_b` set to a zone; Engine 2's network | heat between rooms at different design temperatures |
| Thermal bridging, W/K per zone (ISO 14683 junctions × the document's multiplier, or legacy α %) | `computeBridging` (bridging.ts), `conductances.bridging.total_w_per_k` | transmission (bridging) |
| Infiltration as an air change rate: n = q50 · A_envelope / V / 20, or a stated ach | `infiltration()` (air.ts) | design infiltration |
| Mechanical ventilation per zone (flow, heat recovery, hours) | `ventilation.ts` | design ventilation |
| Ground temperature: the weather file's mean annual dry bulb | model.ts (`building.site.ground.method = 'annual_mean_outdoor'`) | ground floors |
| Each room's heating setpoint | `zones[].setpoints.heat_c` | design internal temperature (if `follow_heat_c`) |
| Emitters' EN 442 output at a flow/return pair and a room temperature | `emitters.ts` (`ratedAt`, Brief 108) | output against the design load |

The design calculation reads these. It never re-derives an area, a U-value or a bridging total. The engine's own conductances are the single source.

## 2. Sources

- **MCS MIS 3005-D (2025), cl. 3.4.1.** Heat load calculations "shall … comply with BS EN 12831-1:2017".
  - **Design outdoor temperature:** CIBSE Guide A (2015) Table 2.5, at the 99 % or 99.6 % level by the designer's choice. If 99.6 % is used, "no uplift factor for intermittent heating is required".
  - **Solid floors:** ΔT is the internal design temperature minus the local annual average external temperature. This is already how the model sets its ground temperature.
  - **Suspended floors:** internal design temperature minus the design outdoor temperature.
  - **Internal design temperatures:** Table 1, from CIBSE.
- **MCS Heat Load Calculator documentation** (public). It gives:
  - design conditions by station from CIBSE Guide A, with −0.6 °C per whole 100 m of altitude above the reference station;
  - internal temperatures from CIBSE DHDG 2026 Table 2-2;
  - a minimum of 0.5 ach in rooms with an external envelope;
  - mechanical ventilation at SAP 10.2 rates;
  - a default air permeability of 12 m³/h·m² at 50 Pa (BS EN 12831-1 Table B.6).
- **BS EN 12831-1:2017 itself** is not public. Its formulas for infiltration from q50, the ground term (f_g1, f_g2, G_w, U_equiv) and the reheat allowance Φ_hu are only in the paid text. None is written here from memory (Rule 10). **Open with Linzie (decision card, 16 Nov).**

## 3. Design outdoor temperature from the weather file

The anchor EPW (Yeovilton TMYx 2011–2025): the 0.4 % coldest hour (99.6 %) is −4.6 °C, the 1 % coldest is −3.5 °C, and the minimum is −6.8 °C. The CIBSE Guide A stations nearest Yeovilton are Southampton (−4.8 / −3.4), Cardiff (−3.1 / −1.5) and Plymouth (−1.5 / −0.2). So `from_weather: 'heating_99_6'` gives a defensible figure, but it is not the CIBSE station value MCS asks for. The design block therefore takes either a stated temperature (the CIBSE value) or the weather-file percentile, and the screen says which.

## 4. Decisions

1. **Terms per room:** transmission to outside (elements + bridging), to the ground, to unheated spaces and to rooms at other design temperatures; ventilation (infiltration + mechanical, at design flows); warm-up allowance. Each is one breakdown line (Rule 9), and the lines sum to the room's design load. For the building total, heat between heated rooms cancels.
2. **Design outdoor temperature:** stated (°C) or `from_weather: 'heating_99_6'` / `'heating_99'`. Never filled.
3. **Design internal temperature per room:** stated, or `follow_heat_c`. The screen shows which.
4. **Ground:** ΔT to the model's ground temperature (annual mean outdoor), as MIS 3005-D cl. 3.4.1(c) does for solid floors, with the construction's U. Any further EN 12831 ground factors wait on the standard's text (decision card).
5. **Infiltration:** the model's own n (q50/20, or stated ach), with the 0.5 ach minimum for a room with an external envelope (MCS). Design ventilation for a room is max(infiltration + mechanical, minimum). Mechanical air with heat recovery enters at the recovered supply temperature. The EN 12831 infiltration form waits on the standard.
6. **Warm-up allowance:** off unless stated. When stated, it is either the standard's factor (needs the text) or a stated W/m² of floor. The panel notes that at a 99.6 % design temperature MCS requires no intermittent uplift.
7. **Emitters:** their EN 442 output at the design flow and return, with the room at its design internal temperature (108's function), for the base pair and the what-if pair. This gives the shortfall and the rating at ΔT 50 that covers it.
8. **Referee:** an EnergyPlus design day (steady, no sun, no gains) for transmission + ventilation, as in the brief. The ground term and the warm-up allowance are checked by hand.

## 5. Linzie's answer (16 Nov 11:38)

On the card "Can we get a copy of BS EN 12831-1:2017 for the heat loss method?", Linzie chose "No, use published UK sources". So the method rests on MCS MIS 3005-D and the MCS calculator's public method, with CIBSE design temperatures. Decision 4 (ground) stays as MIS 3005-D cl. 3.4.1(c) gives it: ΔT to the annual mean outdoor temperature, with the construction's U. EN 12831's further ground factors are left out, and the panel names that. Decision 5 (infiltration) stays as the model's own n with the 0.5 ach minimum. Decision 6 (warm-up) is a stated W/m² of floor, or none. The standard's own factor is not used.

## 6. Corrections after the review (16 Nov, 04_independent_review.md)

- **F3:** the current MIS 3005-D is Issue 3.0 (05/12/2025), and its heat load rules are in cl. 5.5.1 (a) design outdoor temperature from Table 2, (c) solid floors, (d) suspended floors. They are not in cl. 3.4.1 as §2 says. The code and the schema now cite Issue 3.0 cl. 5.5.1.
- **F4:** the 0.5 ach minimum is the MCS Heat Load Calculator's, from CIBSE Domestic Heating Design Guide 2026 Table 2-18. It is not in MIS 3005-D. The code and the panel now say so.
- **F2:** under 5.5.1(d) a suspended floor is counted against the design outdoor temperature. Here it is counted as solid, and the panel now says its loss is understated.
