#!/usr/bin/env python3
"""
Brief 105 Part 6 (brief deliverable 5): the Brief 104 cooled room with internal gains, in EnergyPlus.

The model is validation/energyplus/104_cooled_room.py's, unchanged (its spec file and its two runs, base and iso_conv),
with one ElectricEquipment per room from 105_cooled_room_gains_spec.json: Watts/Area at the spec's W/m2, fraction
radiant the spec's, latent and lost 0, on a Schedule:Compact written from the spec's three day types (weekdays,
Saturday, Sunday and all other days; the run starts on a Monday, no holidays). EnergyPlus spreads the radiant part over
the room's inside surfaces by area, as Engine 2 does; the rest goes to the room's air.

Engine 2 expands the same spec through gains.ts (frontend/src/thermal/engine/__tests__/cooled_room_gains.test.ts), so
the schedule is expanded independently on each side.

Usage: python3 -I validation/energyplus/105_cooled_room_gains.py --energyplus <path> [--runs <dir>]
Writes docs/audit/105/06_cooled_room_gains_energyplus.json. Nothing touches data/ or a database.
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
spec_ = importlib.util.spec_from_file_location("cooled", HERE / "104_cooled_room.py")
C = importlib.util.module_from_spec(spec_)
spec_.loader.exec_module(C)  # type: ignore[union-attr]
GAINS = json.loads((HERE / "105_cooled_room_gains_spec.json").read_text())
OUT = REPO / "docs/audit/105/06_cooled_room_gains_energyplus.json"


def compact(name: str, sched: dict) -> dict:
    """A Schedule:Compact holding each day type's 24 values as hour intervals (index i: i:00 to i+1:00)."""
    fields: list = [{"field": "Through: 12/31"}]
    for label, key in (("For: Weekdays", "weekday"), ("For: Saturday", "saturday"), ("For: Sunday Holidays AllOtherDays", "sunday")):
        fields.append({"field": label})
        v = sched[key]
        for i in range(24):
            if i == 23 or v[i + 1] != v[i]:
                fields += [{"field": f"Until: {i + 1:02d}:00"}, {"field": v[i]}]
    return {"schedule_type_limits_name": "Any", "data": fields}


def with_gains(ep: dict) -> dict:
    ep.setdefault("Schedule:Compact", {})
    ep["ElectricEquipment"] = {}
    for g in GAINS["gains"]:
        z = g["room"]
        ep["Schedule:Compact"][f"{z}_gain"] = compact(f"{z}_gain", g["schedule"])
        ep["ElectricEquipment"][f"{z}_eq"] = {
            "zone_or_zonelist_or_space_or_spacelist_name": z, "schedule_name": f"{z}_gain",
            "design_level_calculation_method": "Watts/Area", "watts_per_floor_area": g["w_per_m2"],
            "fraction_latent": 0.0, "fraction_radiant": g["radiant_fraction"], "fraction_lost": 0.0}
    ep["Output:Variable"]["v6"] = {"key_value": "*", "variable_name": "Zone Electric Equipment Radiant Heating Energy", "reporting_frequency": "Hourly"}
    ep["Output:Variable"]["v7"] = {"key_value": "*", "variable_name": "Zone Electric Equipment Convective Heating Energy", "reporting_frequency": "Hourly"}
    return ep


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    B = C.B
    if hashlib.sha256(B.MOS.read_bytes()).hexdigest() != B.MOS_SHA:
        raise SystemExit("Denver .mos sha mismatch")
    runs = Path(a.runs or tempfile.mkdtemp(prefix="105_cooled_gains_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()  # noqa: E731
    res = {"source": "validation/energyplus/105_cooled_room_gains.py",
           "spec_sha256": sha(HERE / "104_cooled_room_spec.json"), "gains_spec_sha256": sha(HERE / "105_cooled_room_gains_spec.json"),
           "weather_mos_sha256": B.MOS_SHA, "runs": {}}
    import sqlite3
    for name, flags in (("base", frozenset()), ("iso_conv", frozenset({"iso_conv"}))):
        ep = with_gains(C.model(flags))
        r = C.run(a.energyplus, ep, epw, runs / name)
        con = sqlite3.connect(runs / name / "eplusout.sql")
        for z in r["zones"]:
            tot = 0.0
            for v in ("Zone Electric Equipment Radiant Heating Energy", "Zone Electric Equipment Convective Heating Energy"):
                (s,) = con.execute("""select sum(r.Value) from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
                    join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and t.EnvironmentPeriodIndex =
                    (select max(EnvironmentPeriodIndex) from EnvironmentPeriods)""", (v, z)).fetchone()
                tot += s or 0.0
            r["zones"][z]["gains_mwh"] = tot / 3.6e9
        con.close()
        res["runs"][name] = r
        print(name, json.dumps({z: {k: round(v, 3) for k, v in d.items()} for z, d in r["zones"].items()}))
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
