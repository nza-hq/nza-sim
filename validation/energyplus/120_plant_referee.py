#!/usr/bin/env python3
"""
Brief 120 Part 2: a plant with a capacity feeding two rooms' radiators, in EnergyPlus.

108_hotwater_referee.py's model (the cooled room's heated rooms on ZoneHVAC:Baseboard:RadiantConvective:Water, all
convective, on a 50 C plant loop), with the loop's source, DistrictHeating:Water, at Nominal Capacity = the spec's
plant_w instead of unlimited. When the rooms ask for more, the source gives its capacity, the loop's flow temperature
falls, and each baseboard gives what the cooler water gives it: EnergyPlus's own sharing. Radiators are sized per
room by 108's documented method (rating()).

Reported per room: annual heating, unmet hours (hourly zone air more than 0.5 K below 20 C), lowest air temperature;
per plant step: the source's heat rate and each room's baseboard rate, so the sharing in the short steps can be
compared. Usage: python3 -I validation/energyplus/120_plant_referee.py --energyplus <path> [--runs <dir>]
Writes docs/audit/120/02_energyplus.json. Nothing touches data/ or a database.
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


def load(name: str, file: str):
    s = importlib.util.spec_from_file_location(name, HERE / file)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)  # type: ignore[union-attr]
    return m


HWR = load("hotwater", "108_hotwater_referee.py")
C = HWR.C
SPEC = json.loads((HERE / "120_plant_spec.json").read_text())
OUT = REPO / "docs/audit/120/02_energyplus.json"
TOL = 0.5


def model(case: dict) -> tuple[dict, dict]:
    for k in ("flow_c", "return_c", "rated_room_c", "exponent_n", "radiant_fraction"):
        if SPEC[k] != HWR.HW[k]:
            raise SystemExit(f"spec {k} differs from 108_hotwater_spec.json, whose rating method this uses")
    ep, ratings = HWR.model(case["radiators"])
    ep["DistrictHeating:Water"]["hw_source"]["nominal_capacity"] = float(case["plant_w"])
    ep["Output:Variable"]["hw_src"] = {"key_value": "hw_source", "variable_name": "District Heating Water Rate", "reporting_frequency": "Timestep"}
    ep["Output:Variable"]["hw_tsup"] = {"key_value": "hw_sup_out", "variable_name": "System Node Temperature", "reporting_frequency": "Timestep"}
    return ep, ratings


def run(energyplus: str, ep: dict, case: dict, epw: Path, d: Path) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    (d / "in.epJSON").write_text(json.dumps(ep, indent=1))
    p = subprocess.run([energyplus, "-w", str(epw), "-d", str(d), str(d / "in.epJSON")], capture_output=True, text=True)
    err = (d / "eplusout.err").read_text(errors="replace")
    if p.returncode != 0 or re.findall(r"\*\* Severe  \*\*", err):
        raise SystemExit(f"EnergyPlus failed in {d}\n{err[-4000:]}")
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name, key):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency = 'Zone Timestep'
            and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    if not series("Baseboard Total Heating Rate", "west_bb"):
        def series(name, key):  # noqa: F811 - plant-side variables report at the system timestep
            return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
                join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and t.EnvironmentPeriodIndex =
                (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    src = series("District Heating Water Rate", "hw_source")
    tsup = series("System Node Temperature", "hw_sup_out")
    rooms = [z for z in case["radiators"]]
    rate = {z: series("Baseboard Total Heating Rate", f"{z}_bb") for z in rooms}
    heat = {z: series("Baseboard Total Heating Energy", f"{z}_bb") for z in rooms}
    tz = {z: series("Zone Mean Air Temperature", z) for z in rooms}
    n = len(tz[rooms[0]]) // 8760
    cap = case["plant_w"]
    short = [i for i, q in enumerate(src) if q >= cap * 0.999]
    out = {"warnings": len(re.findall(r"\*\* Warning \*\*", err)), "steps_per_hour": n, "plant_w": cap,
           "plant": {"heat_mwh": sum(src) / n / 1e6, "peak_w": max(src), "short_steps": len(short), "short_hours": len(short) / n,
                     "min_flow_c": min(tsup), "steps": len(src)}, "rooms": {}}
    for z in rooms:
        hourly = [sum(tz[z][i * n:(i + 1) * n]) / n for i in range(8760)]
        given = sum(rate[z][i] for i in short)
        out["rooms"][z] = {"heat_mwh": sum(heat[z]) / 3.6e9, "unmet_hours": sum(1 for t in hourly if t < 20.0 - TOL), "min_c": min(hourly),
                           "peak_w": max(rate[z]), "share_of_plant_in_short_steps": given / sum(src[i] for i in short) if short else None}
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
    runs = Path(a.runs or tempfile.mkdtemp(prefix="120_plant_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    sha = lambda f: hashlib.sha256((HERE / f).read_bytes()).hexdigest()
    res = {"source": "validation/energyplus/120_plant_referee.py", "spec_sha256": sha("120_plant_spec.json"), "cooled_room_spec_sha256": sha("104_cooled_room_spec.json"),
           "weather_mos_sha256": B.MOS_SHA, "runs": {}}
    for name, case in SPEC["cases"].items():
        ep, _ = model(case)
        r = run(a.energyplus, ep, case, epw, runs / name)
        res["runs"][name] = r
        print(name, json.dumps(r))
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
