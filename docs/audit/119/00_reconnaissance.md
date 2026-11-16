# Brief 119 Part 0 — Reconnaissance

16 Nov 2026, branch `chris/119-cooling-emitters` from main e0f4a79 (109 and 117 merged). Anchor 133.2.

## 1. Where 108's heating limit enters the engines, and the cooling mirror

- **Engine 1** (`engine/zone.ts`): each hour, heating is `min(φ to hold heat_c, cap)`; the cooling branch is unlimited. Mirror: `max(φ to hold cool_c, −cap_c)`, a fixed `cooling_cap_w` input.
- **Engine 2** (`engine/network.ts`): an active set per zone: 0 free, 1 held at heat_c, −1 held at cool_c, 2 heating at its limit (free, with the cap as a known input through the heating response columns EW/RW). Mirror: mode −2, cooling at its limit, its known input −cap_c through the cooling columns EWc/RWc, on the admittance, dense and operative paths; −1 → −2 when the held cooling exceeds the cap, −2 → −1 when the free zone would fall below cool_c. The full-state update already picks the cooling input vector by φ's sign.
- **Model** (`engine/model.ts`): passes the cap per zone; reports hours above the cooling setpoint (more than UNMET_K, as heating), in use, the highest control temperature, and hours at the cooling cap. `emitter_limit: 'none'` (the sizing run) lifts both limits.

## 2. Which units cool

| kind | heats | cools | what feeds it |
|---|---|---|---|
| radiator, underfloor | yes (wet, EN 442) | no | heating group |
| electric | yes (fixed) | no | none |
| fan_coil | yes (wet) or no | yes, stated W | heating group for its heat; its cooling is stated, not re-rated |
| vrf_indoor | yes (fixed) or no | yes, stated W | none |
| other | either | yes, stated W | heating group if wet |

Decisions:
1. **A cooling output is held fixed** at its stated sensible W (no re-rating by chilled-water or refrigerant temperature), as EnergyPlus's `LimitCapacity` on sensible cooling takes it. Latent cooling is out of scope and said on screen.
2. **`heats` flag.** A unit can cool without heating (a cooling-only cassette beside radiators). Every 2.6 emitter heated, so `heats` reads true when left out: the meaning the field always had, not a filled value. A unit with `heats: false` must leave every heating field empty and must state its cooling.
3. **No cooling system link.** A unit's cooling is not re-rated, so naming the chiller or VRF system that feeds it changes nothing in the run; energy stays with the system groups' shares (Brief 107). Not added (YAGNI); revisit if chilled-water re-rating is asked for.
4. **Rule 8.** A zone none of whose units cool has no cooling limit (ideal loads, as before). A zone whose units cool and has no cooling setpoint is refused, the mirror of 108's heating rule.

## 3. The catalogue

- No emitter catalogue exists in NZA Sim today (`nza_engine/library/systems.py` holds plant only; the Brief 102 library export has no emitter rows).
- First candidate: Stelrad Vita Compact (K2 = Type 22), output table at ΔT 50 (75/65/20, EN 442 tested by CETIAT), lengths 400–2000 mm at 450 and 600 mm, exponent n printed per type and height (K2: 1.33 at 300/450/600, 1.34 at 700). Source https://www.stelrad.com/wp-content/uploads/2021/11/26979_Vita-Compact_Web.pdf, read 16 Nov 2026 through a text extraction (the container's proxy blocks the download, so no sha256 yet; the column-to-type mapping is inferred from the piping table and must be checked against the page before data lands).
- Linzie asked (16 Nov) which catalogue to use first; the answer goes in §5.
- A document records `catalogue_ref: {catalogue, item}` beside its own figures; the run checks the figures against the item and names any difference. It never fills from it (Rule 3).

## 4. EnergyPlus referee

`ZoneHVAC:IdealLoadsAirSystem` with `Cooling Limit = LimitCapacity` and `Maximum Sensible Cooling Capacity` = Σ units, dehumidification and humidification off, as 108 did for heating. Gate stated before running: annual cooling ±5 % per zone, hours above the cooling setpoint ±50 h.

## 5. Linzie's answers

(pending)
