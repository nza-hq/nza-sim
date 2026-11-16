#!/usr/bin/env python3
"""
Brief 119 Part 2: cooling limited to the room's units, in EnergyPlus.

The mirror of 108_capped_referee.py and 108_bridgewater_capped.py: each limited zone's ZoneHVAC:IdealLoadsAirSystem
at Cooling Limit = LimitCapacity, Maximum Sensible Cooling Capacity at the cap in 119_cooling_spec.json. Above the
cap the zone floats, as Engine 2's 'cooling at its limit' state. Dehumidification and humidification stay off (the
base models' setting), so the limit is on sensible cooling only.

Cases: the cooled room (104_cooled_room.py 'iso_conv', Denver), unlimited / tight / mild on its middle room; and
Bridgewater as five storeys (105's gate referee r2_z_gains_vent_std), unlimited / storey 3 limited.

Reported per zone: annual cooling (MWh), hours the zone air is more than 0.5 K above the cooling setpoint (from hourly
Zone Mean Air Temperature, as the engine counts them; EnergyPlus's own Zone Cooling Setpoint Not Met Time too), the
highest air temperature, the most cooling in any hour.

Usage: python3 -I validation/energyplus/119_cooling_referee.py --energyplus <path> --gains <dir> [--runs <dir>]
Writes docs/audit/119/02_energyplus.json. Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def load(name: str, file: str):
    s = importlib.util.spec_from_file_location(name, HERE / file)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)  # type: ignore[union-attr]
    return m


CAP = load("capped", "108_capped_referee.py")
BW = load("bwcapped", "108_bridgewater_capped.py")
C, G, R = CAP.C, BW.G, BW.R
SPEC = json.loads((HERE / "119_cooling_spec.json").read_text())
OUT = REPO / "docs/audit/119/02_energyplus.json"
TOL = SPEC["unmet_tolerance_k"]


def limit_cooling(o: dict, w: float) -> None:
    # EnergyPlus's ideal loads limit cooling by its total capacity only (there is no sensible cooling capacity field;
    # an unknown epJSON field is ignored and the capacity then reads 0 W). With dehumidification off the supply air
    # removes no moisture, so total equals sensible; the latent cooling is read and reported to show it.
    o["cooling_limit"] = "LimitCapacity"
    o["maximum_total_cooling_capacity"] = float(w)


def series(con, name, key):
    return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
        join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency = 'Hourly'
        and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]


def not_met(ep: dict) -> None:
    ep["Output:Variable"]["l_119"] = {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Latent Cooling Energy", "reporting_frequency": "Hourly"}
    ep["Output:Variable"]["c_119"] = {"key_value": "*", "variable_name": "Zone Cooling Setpoint Not Met Time", "reporting_frequency": "Hourly"}
    ep["OutputControl:ReportingTolerances"] = {"tol": {"tolerance_for_time_heating_setpoint_not_met": TOL, "tolerance_for_time_cooling_setpoint_not_met": TOL}}


def cooled_room(energyplus: str, runs: Path) -> dict:
    B = C.B
    if hashlib.sha256(B.MOS.read_bytes()).hexdigest() != B.MOS_SHA:
        raise SystemExit("Denver .mos sha mismatch")
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    out = {}
    for name, caps in [("unlimited", None)] + list(SPEC["cases"].items()):
        ep = C.model(frozenset({"iso_conv"}))
        for z, w in (caps or {}).items():
            limit_cooling(ep["ZoneHVAC:IdealLoadsAirSystem"][f"{z}_ideal"], w)
        not_met(ep)
        d = runs / f"cooled_{name}"
        CAP.run(energyplus, ep, epw, d)  # runs and checks for severe errors; its heating summary is not used here
        con = sqlite3.connect(d / "eplusout.sql")
        zones = {}
        for r in C.SPEC["rooms"]:
            if r["cool_c"] is None:
                continue
            z = r["id"]
            cool = series(con, "Zone Ideal Loads Zone Sensible Cooling Energy", f"{z}_ideal")
            latent = series(con, "Zone Ideal Loads Zone Latent Cooling Energy", f"{z}_ideal")
            tz = series(con, "Zone Mean Air Temperature", z)
            zones[z] = {"cool_mwh": sum(cool) / 3.6e9, "unmet_hours": sum(1 for t in tz if t > r["cool_c"] + TOL),
                        "ep_not_met_hours": sum(series(con, "Zone Cooling Setpoint Not Met Time", z)), "max_c": max(tz),
                        "peak_cooling_w": max(cool) / 3600.0, "latent_mwh": sum(latent) / 3.6e9, "hours": len(tz)}
        con.close()
        out[name] = {"caps": caps, "zones": zones}
        print("cooled", name, json.dumps({z: {k: round(v, 3) for k, v in q.items()} for z, q in zones.items()}), flush=True)
    return out


def bridgewater(energyplus: str, gains: Path, runs: Path) -> dict:
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    today, psi, tg = R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW)
    spc = SPEC["bridgewater"]["cooling_setpoint_c"]
    out = {}
    for name, caps in (("unlimited", None), ("limited", SPEC["bridgewater"]["caps"])):
        ep, notes = BW.build(fx, today, psi, tg, gains, None)
        for z, w in (caps or {}).items():
            limit_cooling(ep["ZoneHVAC:IdealLoadsAirSystem"][f"{z}_IdealLoads"], w)
            notes.append(f"cap: {z} cooling limited to {w} W")
        not_met(ep)
        d = runs / f"bw_{name}"
        res = R.run_ep(energyplus, ep, d)
        s = R.summarise(res, ep)
        con = sqlite3.connect(d / "eplusout.sql")
        zones = {}
        for z in sorted(ep["Zone"]):
            cool = series(con, "Zone Ideal Loads Zone Sensible Cooling Energy", f"{z}_IdealLoads")
            latent = series(con, "Zone Ideal Loads Zone Latent Cooling Energy", f"{z}_IdealLoads")
            tz = series(con, "Zone Mean Air Temperature", z)
            zones[z] = {"cool_mwh": sum(cool) / 3.6e9, "unmet_hours": sum(1 for t in tz if t > spc + TOL),
                        "ep_not_met_hours": sum(series(con, "Zone Cooling Setpoint Not Met Time", z)), "max_c": max(tz),
                        "peak_cooling_w": max(cool) / 3600.0, "latent_mwh": sum(latent) / 3.6e9, "hours": len(tz)}
        con.close()
        out[name] = {"caps": caps, "notes": notes, "cooling_mwh": s["cooling_mwh"], "heating_mwh": s["heating_mwh"], "zones": zones,
                     "severe": s["severe"], "warnings": res["warnings"], "energyplus_version": res["version"]}
        print("bw", name, json.dumps({z: {k: round(v, 3) for k, v in q.items()} for z, q in zones.items()}), flush=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--gains", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    runs = Path(a.runs or tempfile.mkdtemp(prefix="119_"))
    runs.mkdir(parents=True, exist_ok=True)
    sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
    res = {"source": "validation/energyplus/119_cooling_referee.py", "spec_sha256": sha(HERE / "119_cooling_spec.json"),
           "cooled_spec_sha256": sha(HERE / "104_cooled_room_spec.json"), "weather_mos_sha256": C.B.MOS_SHA, "epw_sha256": R.EPW_SHA,
           "gains_csv_sha256": sha(Path(a.gains) / "gains.csv")}
    res["cooled_room"] = cooled_room(a.energyplus, runs)
    res["bridgewater"] = bridgewater(a.energyplus, Path(a.gains), runs)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
