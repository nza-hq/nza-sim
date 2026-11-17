#!/usr/bin/env python3
"""
Brief 115: the community centre's open-plan office as a referee room (validation/energyplus/115_office_spec.json), in
EnergyPlus AirflowNetwork, for Linzie's two tests: windows open all winter, and passive cooling against a cooling system.

The room is built by 115_air_referee.py's model() from the office spec (same banding, cracks, Cp arrays, external nodes,
iso_conv surface coefficients), then given what the office adds: office hours with a setback (Schedule:Compact), a gain
(ElectricEquipment), cooling only in hours, and the window control per case:
  shut                  NoVent (windows closed every step)
  always                Constant (open by the opening factor every step)
  temperature_in_hours  Temperature (open above 22 C when the room is warmer than outside), available only in office hours
Zone air by EulerMethod, as Brief 109's referee (a setpoint step, docs/audit/109/02_referee.md).

Usage: python3 -I validation/energyplus/115_office_referee.py --energyplus <path> --epw <Gatwick IWEC> [--runs <dir>]
Writes docs/audit/115/04_office_energyplus.json. Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
s_ = importlib.util.spec_from_file_location("air", HERE / "115_air_referee.py")
A = importlib.util.module_from_spec(s_)
s_.loader.exec_module(A)  # type: ignore[union-attr]
OFFICE = json.loads((HERE / "115_office_spec.json").read_text())
OUT = REPO / "docs/audit/115/04_office_energyplus.json"


def compact(sched: dict, on, off) -> dict:
    """Schedule:Compact from a day-type table of 0..1 (on/off None: the values themselves; else on where 1, off where 0)."""
    fields: list = [{"field": "Through: 12/31"}]
    for label, key in (("For: Weekdays", "weekday"), ("For: Saturday", "saturday"), ("For: Sunday Holidays AllOtherDays", "sunday")):
        fields.append({"field": label})
        v = [x if on is None else (on if x else off) for x in sched[key]]
        for i in range(24):
            if i == 23 or v[i + 1] != v[i]:
                fields += [{"field": f"Until: {i + 1:02d}:00"}, {"field": v[i]}]
    return {"schedule_type_limits_name": "Any", "data": fields}


def office_model(case: dict) -> dict:
    A.SPEC = OFFICE
    ep = A.model({"q50": OFFICE["q50"], "windows": case["windows"], "modulation": False, "cool": case["cool"]}, "iso")
    w = OFFICE["weather"]
    ep["Site:Location"] = {"Gatwick": {"latitude": w["lat"], "longitude": w["lon"], "time_zone": w["time_zone"], "elevation": w["elevation"]}}
    ep["ZoneAirHeatBalanceAlgorithm"] = {"ZoneAirHeatBalanceAlgorithm 1": {"algorithm": "EulerMethod"}}
    sc = ep["Schedule:Constant"]
    for k in ("heat_sp", "cool_sp", "vent_sp"):
        sc.pop(k, None)
    ep["Schedule:Compact"] = {
        "heat_sp": compact(OFFICE["hours"], OFFICE["heat_c"], OFFICE["setback_c"]),
        # Cooling only in hours: outside them a setpoint the room never reaches.
        "cool_sp": compact(OFFICE["hours"], OFFICE["cool_c"], 99.0),
        "vent_sp": compact(OFFICE["hours"], OFFICE["rule"]["open_above_c"], OFFICE["rule"]["open_above_c"]),
        "hours": compact(OFFICE["hours"], 1.0, 0.0),
        "gain": compact(OFFICE["gain"]["schedule"], None, None),
    }
    g = OFFICE["gain"]
    ep["ElectricEquipment"] = {"gain": {"zone_or_zonelist_or_space_or_spacelist_name": "room", "schedule_name": "gain",
                               "design_level_calculation_method": "Watts/Area", "watts_per_floor_area": g["w_per_m2"],
                               "fraction_latent": 0.0, "fraction_radiant": g["radiant_fraction"], "fraction_lost": 0.0}}
    z = ep["AirflowNetwork:MultiZone:Zone"]["room_afn"]
    for k in list(z):
        if k != "zone_name":
            z.pop(k)
    ctl = case["control"]
    if ctl == "shut":
        z["ventilation_control_mode"] = "NoVent"
    elif ctl == "always":
        z.update({"ventilation_control_mode": "Constant", "venting_availability_schedule_name": "one"})
    elif ctl == "temperature_in_hours":
        z.update({"ventilation_control_mode": "Temperature", "ventilation_control_zone_temperature_setpoint_schedule_name": "vent_sp",
                  "venting_availability_schedule_name": "hours", "minimum_venting_open_factor": 1.0})
    else:
        raise SystemExit(f"unknown control {ctl}")
    return ep


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--epw", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    epw = Path(a.epw)
    if hashlib.sha256(epw.read_bytes()).hexdigest() != OFFICE["weather"]["sha256"]:
        raise SystemExit("weather sha mismatch")
    runs = Path(a.runs or tempfile.mkdtemp(prefix="115_office_"))
    res = {"source": "validation/energyplus/115_office_referee.py",
           "spec_sha256": hashlib.sha256((HERE / "115_office_spec.json").read_bytes()).hexdigest(),
           "weather_sha256": OFFICE["weather"]["sha256"], "cases": {}}
    for name, case in OFFICE["cases"].items():
        out = A.run(a.energyplus, office_model(case), epw, runs / name)
        res["cases"][name] = out
        h = out["hourly"]
        print(name, json.dumps({"heat_kwh": round(out["heat_kwh"], 1), "cool_kwh": round(out["cool_kwh"], 1),
                                "inflow_t": round(sum(h["inflow_kg"]) / 1000, 2), "hours_open": sum(1 for x in h["open_factor"] if x > 0),
                                "max_c": max(h["theta_air_c"]), "warnings": out["warnings"]}))
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.write_text(json.dumps(res) + "\n")


if __name__ == "__main__":
    main()
