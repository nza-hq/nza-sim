#!/usr/bin/env python3
"""
Brief 111 Part 2: "Fabric only" on Bridgewater as five storeys, in EnergyPlus.

Brief 104's gate referee r2_z (validation/energyplus/104_zones_referee.py, as 105_gains_referee.py builds it: the
document's frame and internal capacity, each slab one construction seen from both sides, bridging and infiltration
allocated by zone as Engine 2 allocates them), with no internal gains and no ventilation entries (its only ZoneVentilation objects are the permanent louvres,
which are envelope and stay), and
infiltration at standard air density (Brief 105's attributed convention, as its gate run r2_z_gains_vent_std).
The thermostat is removed and replaced, not widened (Rule 8): each zone gets a ThermostatSetpoint:SingleHeating at
the stated fabric temperature, so there is no cooling at all.

Usage: python3 -I validation/energyplus/111_fabric_referee.py --energyplus <path> [--heat-c 21] [--runs <dir>]
Writes docs/audit/111/02_fabric_energyplus.json. Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
spec = importlib.util.spec_from_file_location("gains", HERE / "105_gains_referee.py")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)  # type: ignore[union-attr]
Z, A, R = G.Z, G.A, G.R
OUT = REPO / "docs/audit/111/02_fabric_energyplus.json"


def build(fx, today, psi, tg, heat_c: float):
    flags = G.RUNS["r2_z"]
    ep, notes = A.build_run([f for f in flags if f not in ("tb_by_zone", "inf_by_zone", "slab_reversed")], fx, today, psi, tg)
    Z.slab_reversed(ep, notes)
    Z.tb_by_zone(ep, fx, psi, notes)
    Z.inf_by_zone(ep, notes)
    for k in ("ZoneVentilation:DesignFlowRate", "ZoneInfiltration:DesignFlowRate"):
        for o in ep.get(k, {}).values():
            o["density_basis"] = "Standard"
    for k in ("OtherEquipment", "People", "Lights", "ElectricEquipment"):
        if ep.get(k):
            raise SystemExit(f"r2_z unexpectedly has {k}")
    # The only ZoneVentilation objects are the permanent louvres (envelope, Building module), which stay.
    if any(not n.endswith("_permvent_louvre") for n in ep.get("ZoneVentilation:DesignFlowRate", {})):
        raise SystemExit("r2_z has a ventilation object that is not a permanent vent")
    # Heating only: the dual thermostat removed, a single heating one in its place.
    ep.pop("ThermostatSetpoint:DualSetpoint", None)
    ep["Schedule:Compact"]["fabric_heat"] = {"schedule_type_limits_name": "Temperature",
                                             "data": [{"field": "Through: 12/31"}, {"field": "For: AllDays"}, {"field": "Until: 24:00"}, {"field": heat_c}]}
    ep.setdefault("Schedule:Constant", {})["control_single_heating"] = {"hourly_value": 1.0}
    ep["ThermostatSetpoint:SingleHeating"] = {}
    for name, t in ep["ZoneControl:Thermostat"].items():
        z = t["zone_or_zonelist_name"]
        ep["ThermostatSetpoint:SingleHeating"][f"{z}_heat"] = {"setpoint_temperature_schedule_name": "fabric_heat"}
        ep["ZoneControl:Thermostat"][name] = {"zone_or_zonelist_name": z, "control_type_schedule_name": "control_single_heating",
                                              "control_1_object_type": "ThermostatSetpoint:SingleHeating", "control_1_name": f"{z}_heat"}
    notes.append(f"fabric: no gains, no ventilation entries, heating only at {heat_c} C (single heating thermostat), infiltration at standard density")
    return ep, notes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--heat-c", type=float, default=21.0)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    today, psi, tg = R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW)
    root = Path(a.runs or tempfile.mkdtemp(prefix="111_fabric_"))
    ep, notes = build(fx, today, psi, tg, a.heat_c)
    res = R.run_ep(a.energyplus, ep, root / "fabric")
    s = R.summarise(res, ep)
    out = {"source": "validation/energyplus/111_fabric_referee.py", "epw_sha256": R.EPW_SHA, "heat_c": a.heat_c, "notes": notes,
           "heating_mwh": s["heating_mwh"], "cooling_mwh": s["cooling_mwh"], "heating_monthly_mwh": s["heating_monthly_mwh"],
           "zones": Z.per_zone(root / "fabric", ep), "severe": s["severe"], "warnings": res["warnings"], "energyplus_version": res["version"]}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps({k: out[k] for k in ("heating_mwh", "cooling_mwh", "severe")}), json.dumps({z: round(v["heating_mwh"], 3) for z, v in out["zones"].items()}))


if __name__ == "__main__":
    main()
