# Brief 121 — Simulate v2: setpoints as profiles

**Status:** ACTIVE, 17 Nov 2026. Asked for by Linzie (17 Nov 00:31): "Aren't temperature set points a profile? Isn't window operation a profile? … the way that IES would do profiles … You'd apply it to heating systems. You'd apply it to temperatures." The coordinator confirmed (00:42) that this brief should be written and built. Window operation as a profile landed in Brief 115 (8ea6652). This brief does setpoints.
**Owner:** the building/engine thread (P0–P3, P5); the editor thread (P4: the profile kinds in the workspace, to the field names agreed on 17 Nov 00:40).

## BEFORE DOING ANYTHING

1. Read CLAUDE.md in full, STATUS.md and `docs/briefs/current.md`.
2. Read Brief 109 (heating hours and setbacks, refereed against EnergyPlus) and Brief 115's temperature profile kind (`schema/model.ts`, `TemperatureProfile`).
3. Today's engine and the Bridgewater 133.2 anchor are not touched. This is Simulate v2 only.

## Scope (CLAUDE.md rule 10)

**Systems module**, under its "heating hours and setbacks per zone" line (Brief 109). The comfort band of the Building module is not changed.

A zone's heating and cooling setpoints may each follow a temperature profile (°C per hour, by weekday, saturday and sunday) instead of one figure, with or without hours and a setback. Nothing else changes: emitters, plant capacity and design heat loss read the same figures as today.

## Design

- `zones[].setpoints.heat_ref` and `cool_ref` (schema 2.11, this branch's own version, so no bump). Each names a temperature profile, or is null as today.
- **With `heat_ref`:**
  - The heating setpoint each hour is the profile's value, in every hour. The profile carries any setback, so `setback_c` must be empty.
  - A low value (for example 5 °C frost protection) is how a profile states "off".
  - `heat_c` stays the zone's in-use heating setpoint: emitters are rated at it (108), design heat loss follows it (117), and the sizing run holds it (109 decision 4). It must equal the profile's highest value; anything else is refused by name. One figure, checked, so the two cannot drift (Rule 11).
- **With `cool_ref`:**
  - The cooling setpoint each hour is the profile's value.
  - Cooling still runs only in the in-use hours (`hours_ref`) when they are given, and every hour when they are not.
  - `cool_c` must equal the profile's lowest value.
- `hours_ref` keeps its meaning: in-use hours, for reports, cooling hours and pumps.
- The heating setpoint must stay below the cooling setpoint in every hour. A crossing is refused by name.
- Refused by name:
  - a missing profile, or one that is not a temperature profile;
  - `heat_ref` with `setback_c`;
  - `heat_ref` without `heat_c`, or `cool_ref` without `cool_c`;
  - `heat_c` not the profile's highest value, or `cool_c` not its lowest.
- The run steps in quarter hours where Brief 109 would for a zone with hours (`runOptionsFor`). The sizing run (`steadyDocument`) drops the profiles as it drops hours and setbacks.

## Parts

### P1 — Schema and engine
- **Files:** `frontend/src/thermal/schema/model.ts` (setpoints `heat_ref`, `cool_ref`; references checked); `frontend/src/thermal/engine/model.ts` (`zoneSetpointHours` reads the profiles); `frontend/src/sim2/run/seam.ts` (`runOptionsFor`, `steadyDocument`).
- **Verification:**
  - A profile that holds `heat_c` in the in-use hours and `setback_c` outside them gives exactly Brief 109's result (every hour, to 1e-9). That result is refereed against EnergyPlus, so the profile path inherits that referee.
  - A cooling profile that holds `cool_c` with `hours_ref` gives exactly today's result.
  - A shaped profile (19 °C at 07:00–09:00, 21 °C to 18:00, 16 °C overnight) heats between the two flat cases. Each hour's setpoint is read back from the run.
  - Every refusal is tested.
  - Full suite and build pass. The Bridgewater digest is unchanged.
- **Commit:** "Brief 121 P1: setpoints as profiles (heat_ref, cool_ref)".

### P2 — Referee
No new EnergyPlus run. The engine path is the hourly setpoint array that Brief 109 refereed against EnergyPlus (`Schedule:Compact` setpoints, which is itself a temperature profile). P1's exact-equivalence tests tie the new input to that path. State this in `docs/audit/121/02_referee.md`.

### P3 — Community centre
Run the community centre office with an IES-style heating profile against its run "B" hours and setback. Report the heating and the peak.

### P4 — Workspace (editor thread)
Profiles step: heating_setpoint and cooling_setpoint kinds. Spaces choose "one temperature + hours" or "a profile". The editor writes `heat_c` as the profile's highest value.

### P5 — Close
- STATUS.md, `current.md`, and the CLAUDE.md Systems scope line ("Heating hours and setbacks per zone (Brief 109)", amended).
- The brief is archived.
- Independent review if Linzie wants one. The change is small and inherits a referee.

## Deliverables
1. Schema, engine and seam changes with tests (P1).
2. `docs/audit/121/02_referee.md` (P2).
3. `docs/audit/121/03_community_centre.md` (P3).
4. STATUS.md, `current.md` and the CLAUDE.md scope line (P5).
