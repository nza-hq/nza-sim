#!/usr/bin/env python3
"""
Brief 108 review F2: the cooled room with its heated rooms heated by ZoneHVAC:Baseboard:RadiantConvective:Electric.

The 'iso_conv' model of 104_cooled_room.py (as 108_capped_referee.py), with each heated room's ideal loads replaced by
an electric baseboard at the capacity and radiant fraction in 108_radiant_spec.json. Its radiation is spread over the
room's inside surfaces (windows included) by area, as Engine 2 spreads a heating emitter's radiant share; none on
people. Reported as 108_capped_referee.py reports, with heating from the baseboard's own energy.

Usage: python3 -I validation/energyplus/108_radiant_referee.py --energyplus <path> [--runs <dir>]
Writes docs/audit/108/08_radiant_energyplus.json. Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sqlite3
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
spec_ = importlib.util.spec_from_file_location("cooled", HERE / "104_cooled_room.py")
C = importlib.util.module_from_spec(spec_)
spec_.loader.exec_module(C)  # type: ignore[union-attr]
RAD = json.loads((HERE / "108_radiant_spec.json").read_text())
TOL = 0.5
OUT = REPO / "docs/audit/108/08_radiant_energyplus.json"


def area(o: dict) -> float:
    """A planar polygon's area from its vertices (epJSON 'vertices' list or numbered fields)."""
    if "vertices" in o:
        v = [(p["vertex_x_coordinate"], p["vertex_y_coordinate"], p["vertex_z_coordinate"]) for p in o["vertices"]]
    else:
        v = [(o[f"vertex_{i}_x_coordinate"], o[f"vertex_{i}_y_coordinate"], o[f"vertex_{i}_z_coordinate"]) for i in range(1, 5) if f"vertex_{i}_x_coordinate" in o]
    sx = sy = sz = 0.0
    for i in range(len(v)):
        (x1, y1, z1), (x2, y2, z2) = v[i], v[(i + 1) % len(v)]
        sx += y1 * z2 - z1 * y2; sy += z1 * x2 - x1 * z2; sz += x1 * y2 - y1 * x2
    return 0.5 * (sx * sx + sy * sy + sz * sz) ** 0.5


def model(caps: dict) -> dict:
    ep = C.model(frozenset({"iso_conv"}))
    S, W = ep["BuildingSurface:Detailed"], ep["FenestrationSurface:Detailed"]
    ep["ZoneHVAC:Baseboard:RadiantConvective:Electric"] = {}
    for z, cap in caps.items():
        del ep["ZoneHVAC:IdealLoadsAirSystem"][f"{z}_ideal"]
        wins = {n: area(o) for n, o in W.items() if S[o["building_surface_name"]]["zone_name"] == z}
        net = {}
        for n, o in S.items():
            if o["zone_name"] != z:
                continue
            net[n] = area(o) - sum(a for wn, a in wins.items() if W[wn]["building_surface_name"] == n)
        surf = {**net, **wins}
        tot = sum(surf.values())
        ep["ZoneHVAC:Baseboard:RadiantConvective:Electric"][f"{z}_bb"] = {
            "heating_design_capacity_method": "HeatingDesignCapacity", "heating_design_capacity": float(cap), "efficiency": 1.0,
            "fraction_radiant": RAD["radiant_fraction"], "fraction_of_radiant_energy_incident_on_people": 0.0,
            "surface_fractions": [{"surface_name": n, "fraction_of_radiant_energy_to_surface": a / tot} for n, a in surf.items()]}
        ep["ZoneHVAC:EquipmentList"][f"{z}_eq"]["equipment"] = [{
            "zone_equipment_object_type": "ZoneHVAC:Baseboard:RadiantConvective:Electric", "zone_equipment_name": f"{z}_bb",
            "zone_equipment_cooling_sequence": 1, "zone_equipment_heating_or_no_load_sequence": 1}]
        conn = ep["ZoneHVAC:EquipmentConnections"][f"{z}_conn"]
        conn.pop("zone_air_inlet_node_or_nodelist_name", None); conn.pop("zone_return_air_node_or_nodelist_name", None)
    ep["Output:Variable"]["bb"] = {"key_value": "*", "variable_name": "Baseboard Total Heating Energy", "reporting_frequency": "Hourly"}
    ep["Output:Variable"]["bbe"] = {"key_value": "*", "variable_name": "Baseboard Electricity Energy", "reporting_frequency": "Hourly"}
    ep["Output:Variable"]["bbr"] = {"key_value": "*", "variable_name": "Baseboard Radiant Heating Energy", "reporting_frequency": "Hourly"}
    return ep


def run(energyplus: str, ep: dict, epw: Path, d: Path) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    (d / "in.epJSON").write_text(json.dumps(ep, indent=1))
    p = subprocess.run([energyplus, "-w", str(epw), "-d", str(d), str(d / "in.epJSON")], capture_output=True, text=True)
    err = (d / "eplusout.err").read_text(errors="replace")
    if p.returncode != 0 or re.findall(r"\*\* Severe  \*\*", err):
        raise SystemExit(f"EnergyPlus failed in {d}\n{err[-3000:]}")
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name, key):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and t.EnvironmentPeriodIndex =
            (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    out = {"warnings": len(re.findall(r"\*\* Warning \*\*", err)), "zones": {}}
    for r in C.SPEC["rooms"]:
        if r["heat_c"] is None:
            continue
        z = r["id"]
        heat = series("Baseboard Total Heating Energy", f"{z}_bb")
        rad = series("Baseboard Radiant Heating Energy", f"{z}_bb")
        tz = series("Zone Mean Air Temperature", z)
        elec = series("Baseboard Electricity Energy", f"{z}_bb")
        out["zones"][z] = {"heat_mwh": sum(heat) / 3.6e9, "electricity_mwh": sum(elec) / 3.6e9, "peak_electricity_w": max(elec) / 3600.0, "radiant_share": sum(rad) / sum(heat) if sum(heat) else 0.0,
                           "unmet_hours": sum(1 for t in tz if t < r["heat_c"] - TOL), "min_c": min(tz), "peak_heating_w": max(heat) / 3600.0}
    con.close()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    B = C.B
    if hashlib.sha256(B.MOS.read_bytes()).hexdigest() != B.MOS_SHA:
        raise SystemExit("Denver .mos sha mismatch")
    runs = Path(a.runs or tempfile.mkdtemp(prefix="108_radiant_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    sha = lambda f: hashlib.sha256((HERE / f).read_bytes()).hexdigest()
    res = {"source": "validation/energyplus/108_radiant_referee.py", "spec_sha256": sha("104_cooled_room_spec.json"),
           "radiant_spec_sha256": sha("108_radiant_spec.json"), "weather_mos_sha256": B.MOS_SHA, "runs": {}}
    for name, caps in RAD["cases"].items():
        r = run(a.energyplus, model(caps), epw, runs / name)
        res["runs"][name] = r
        print(name, json.dumps({z: {k: round(v, 3) for k, v in d.items()} for z, d in r["zones"].items()}), "warnings", r["warnings"])
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
