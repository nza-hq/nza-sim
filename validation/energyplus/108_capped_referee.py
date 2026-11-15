#!/usr/bin/env python3
"""
Brief 108 Part 3: the cooled room in EnergyPlus with its heated rooms' heating limited.

The 'iso_conv' model of 104_cooled_room.py (Engine 2's surface coefficients, Denver weather, the same spec), with each
heated room's ZoneHVAC:IdealLoadsAirSystem set to Heating Limit = LimitCapacity at the cap in 108_capped_spec.json.
Below the cap the room floats, as Engine 2's 'heating at its limit' state.

Reported per room and case: annual heating (MWh), hours the zone air is more than 0.5 K below the heating setpoint
(counted from hourly Zone Mean Air Temperature, as Engine 2 counts them; EnergyPlus's own Zone Heating Setpoint Not
Met Time is also read, with OutputControl:ReportingTolerances at 0.5 K), the lowest air temperature, and the most
heating in any hour.

Usage: python3 -I validation/energyplus/108_capped_referee.py --energyplus <path> [--runs <dir>]
Writes docs/audit/108/03_cooled_room_capped_energyplus.json. Nothing touches data/ or a database.
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
CAPS = json.loads((HERE / "108_capped_spec.json").read_text())
OUT = REPO / "docs/audit/108/03_cooled_room_capped_energyplus.json"


def model(caps: dict | None) -> dict:
    ep = C.model(frozenset({"iso_conv"}))
    if caps:
        for z, w in caps.items():
            o = ep["ZoneHVAC:IdealLoadsAirSystem"][f"{z}_ideal"]
            o["heating_limit"] = "LimitCapacity"
            o["maximum_sensible_heating_capacity"] = float(w)
    ep["Output:Variable"]["v6"] = {"key_value": "*", "variable_name": "Zone Heating Setpoint Not Met Time", "reporting_frequency": "Hourly"}
    ep["OutputControl:ReportingTolerances"] = {"tol": {"tolerance_for_time_heating_setpoint_not_met": CAPS["unmet_tolerance_k"],
                                                       "tolerance_for_time_cooling_setpoint_not_met": CAPS["unmet_tolerance_k"]}}
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
    tol = CAPS["unmet_tolerance_k"]
    for r in C.SPEC["rooms"]:
        if r["heat_c"] is None:
            continue
        z = r["id"]
        heat = series("Zone Ideal Loads Zone Sensible Heating Energy", f"{z}_ideal")
        tz = series("Zone Mean Air Temperature", z)
        nm = series("Zone Heating Setpoint Not Met Time", z)
        out["zones"][z] = {"heat_mwh": sum(heat) / 3.6e9, "unmet_hours": sum(1 for t in tz if t < r["heat_c"] - tol),
                           "ep_not_met_hours": sum(nm), "min_c": min(tz), "peak_heating_w": max(heat) / 3600.0}
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
    runs = Path(a.runs or tempfile.mkdtemp(prefix="108_capped_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    sha = lambda f: hashlib.sha256((HERE / f).read_bytes()).hexdigest()
    res = {"source": "validation/energyplus/108_capped_referee.py", "spec_sha256": sha("104_cooled_room_spec.json"),
           "caps_sha256": sha("108_capped_spec.json"), "weather_mos_sha256": B.MOS_SHA, "runs": {}}
    for name, caps in [("uncapped", None)] + list(CAPS["cases"].items()):
        r = run(a.energyplus, model(caps), epw, runs / name)
        res["runs"][name] = r
        print(name, json.dumps({z: {k: round(v, 3) for k, v in d.items()} for z, d in r["zones"].items()}))
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
