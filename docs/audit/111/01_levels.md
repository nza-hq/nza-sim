# Brief 111 Part 1: simulate(doc, { level }) with run copies

- **API.** `simulate(doc, { weather, level?: 'fabric' | 'spaces' | 'systems', fabric_heat_c? })`. The level defaults to `systems`, which is today's run, value for value (tested).
- **The run copy.** `levelDocument(doc, level, heatC)` builds it as the table in `00_reconnaissance.md` sets out. Objects are removed, never zeroed or switched off (Rule 8). The copy is parsed against the schema, and the document itself is not changed (tested).
- **The fabric setpoint.** `fabric_heat_c` is required for `fabric`. Without it, the run names "Fabric only needs the temperature every room is heated to."
- **The summary.** It carries `level` and `fabric_heat_c`. `energy` is null below `systems`; the panel says so.
- **Plumbing.** The worker and the client pass `level` and `fabric_heat_c` through (`client.run(doc, delay, level, fabric_heat_c)`).
- **Tests** (`sim2/run/__tests__/levels.test.ts`, 6):
  - **Fabric copy:** no gain profile or reference, no ventilation entry, no emitter, no system; each zone at 21 °C with no cooling or setback. The envelope is identical.
  - **Spaces copy:** no mechanical ventilation, emitter or system; setpoints, profiles and references unchanged.
  - **Systems** is the document itself.
  - **Each level** closes, building and per zone, and each zone's heating line equals its demand (Rule 9).
  - **Fabric** has no gain, mechanical ventilation or cooling line, and needs more heat than spaces.
