# Brief 107 Part 2 — gate against today's systems path

Script: `scripts/107_gate.mts`, run from `frontend/` with `npx vite-node`. It needs the anchor EPW, checked by sha, and writes [`02_gate.json`](02_gate.json).

## (a) Path by path: the same demand gives the same energy

Today's `calculateInstant` was run on the fixture, as `_brief93_anchor.mjs --fixture` does. v2's `runSystems` took two inputs:
- today's annual heating and cooling demand (102.7 / 92.4 MWh) on the converted one-zone document;
- its own gains' electricity and fans, from `gains.ts` and `ventilation.ts` on the anchor weather's calendar.

| End use, MWh | Today | v2 | Difference, kWh |
|---|---|---|---|
| Heating (electricity) | 37.657 | 37.657 | −0.3 |
| Cooling (electricity) | 30.800 | 30.800 | 0.0 |
| Hot water heat pump (electricity) | 41.174 | 41.174 | −0.4 |
| Hot water boiler (gas) | 157.428 | 157.428 | +0.3 |
| Hot water pump | 1.051 | 1.051 | +0.2 |
| Fans | 40.613 | 40.613 | +0.1 |
| Lighting | 39.014 | 39.014 | +0.3 |
| Small power | 186.136 | 186.136 | +0.3 |
| Auxiliary | 27.699 | 27.699 | 0.0 |
| Hot water demand | 257.335 | 257.335 | −0.3 |
| **Electricity** | 404.144 | 404.144 | 0.0 |
| **Gas** | 157.428 | 157.428 | +0.3 |
| **EUI, kWh/m²** | 133.2 | 133.202 | (today rounds to 0.1) |

**Gate passes.** Every difference is within today's own rounding: it rounds each figure to 1 kWh.

Lighting, small power and auxiliary use `gains.ts` electricity, so this also confirms the electricity side of Brief 105's gains port, which had been gated on heat only.

## (b) On Engine 2's own demand

Bridgewater as five storeys, with the editor's run options (gains and ventilation from the document):

| | Today | Engine 2 + v2 systems | EUI effect, kWh/m² |
|---|---|---|---|
| Heating demand, MWh | 102.70 | 114.55 | +1.03 (through 95 % at SCOP 3 and 5 % at 1) |
| Cooling demand, MWh | 92.40 | 62.73 | −2.35 (at SEER 3) |
| Everything else | | | 0.00 |
| **EUI** | **133.2** | **131.9** | −1.3 |

**The whole difference is in demand.** Hot water, the pump, fans, lighting, small power and auxiliary agree exactly; per storey they sum to the one-zone figures.

**Which demand is right.** Brief 105's referee is EnergyPlus given the same gains and ventilation, at the same air density ([`03_ventilation.md`](../105/03_ventilation.md)). It gives 119.16 / 57.38 MWh.
- Engine 2 is −3.9 % / +9.3 % against it.
- Today's engine is −13.8 % / +61 % against it.
- So the v2 EUI moves away from 133.2 toward EnergyPlus.

The size of today's cooling overstatement matches what Brief 103's investigation found for today's instant estimate. Nothing was tuned (Rule 10).

**The anchor.** 133.2 is today's engine and is unchanged; no file of today's engine was edited. v2 does not reproduce it, by design: it is a different demand engine, gated against EnergyPlus.
