# Brief 108 review F2: the radiant share against EnergyPlus

Scripts:
- EnergyPlus run: `validation/energyplus/108_radiant_referee.py` (spec `108_radiant_spec.json`, results
  `08_radiant_energyplus.json`).
- Comparison: `scripts/108_radiant.mts` (`08_radiant.json`).

## Setup

- **The building:** the cooled room, Denver weather. EnergyPlus runs the `iso_conv` model, as Parts 3 and 104.
- **EnergyPlus heating:** each heated room has a `ZoneHVAC:Baseboard:RadiantConvective:Electric` in place of ideal
  loads. Its efficiency is 1, it is 30 % radiant, and the radiation is spread over the room's inside surfaces by area,
  windows included, with none on people.
- **Engine 2 heating:** a fixed-output electric emitter, 30 % radiant.
- **Cases:** unlimited (100 kW), tight (800 W) and mild (1,100 W), all chosen before any comparison.

**EnergyPlus's heat input is read as its baseboard electricity.** At efficiency 1 that is the heat it gives.
Its "Baseboard Total Heating Energy" reads 26 % lower (1.41 against 1.91 MWh, unlimited west). That output is not what
the baseboard puts in, and its definition is not traced here, so it is not used.

## Results (west room; east within 0.01 MWh and 1 h)

| Case | Engine 2 MWh | EnergyPlus MWh | Heating | Unmet h E2 / EP | Lowest °C E2 / EP |
|---|---|---|---|---|---|
| Unlimited | 1.969 | 1.905 | +3.4 % | 0 / 273 | 20.00 / 19.23 |
| Tight 800 W | 1.899 | 1.853 | +2.5 % | 644 / 693 | 13.65 / 13.60 |
| Mild 1,100 W | 1.962 | 1.901 | +3.2 % | 74 / 278 | 16.90 / 16.69 |

**Annual heating with a radiant share agrees within 3.4 %** in all three cases, inside the ±10 % gate. The all-convective
cases in Part 3 were −3.3 to −3.7 %. The tight case passes the whole gate: unmet hours −49 h, lowest temperature
within 0.05 K.

## The hours below

**EnergyPlus's radiant baseboard does not hold its own setpoint, even with unlimited capacity.** The unlimited case
has 273 hours more than 0.5 K below 20 °C, with the air down to 19.2 °C. Its capacity is 100 kW and its highest hour
uses 1,473 W.

That 1,473 W equals the all-convective ideal loads' peak in Part 3 (1,471 W). In the coldest hour, the baseboard gives
what an all-convective system would need. The radiant 30 % goes into the surfaces first, so the air falls short. Engine 2
holds the setpoint and gives 1,547 W, which is the extra a radiant share needs under air control.

So the object referees the radiant share's **annual heat**. It cannot referee **hours below** with a radiant share,
because its own control leaves hours below that have nothing to do with the cap. The mild case's 204-hour gap is
mostly those hours (273 in the unlimited case). The mechanism inside EnergyPlus is inferred from the equal peaks, not
traced in its source.

## What this changes

- The panel's ⓘ says annual heat with a radiant share is checked against EnergyPlus (within 4 %), and that hours below
  with a radiant share are not.
- Hours below with a radiant share would need a referee that controls a radiant emitter to its setpoint. That is open
  (STATUS).
