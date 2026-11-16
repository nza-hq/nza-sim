#!/usr/bin/env python3
"""
Brief 109 Part 2: the cooled room in EnergyPlus heated to office hours with a night setback.

The 'iso_conv' model of 104_cooled_room.py (as 108_capped_referee.py), with each heated room's heating setpoint from a
Schedule:Compact built from 109_setback_spec.json (setback_c + f x (heat_c - setback_c) by hour) and the cooled room's
thermostat on only where f > 0 (control type 0, uncontrolled, otherwise). Weather-file holidays are off, so every
Monday to Friday is a weekday, as in the engine's calendar (1 January a Monday). Cases: unlimited, and the 108 limits
(ZoneHVAC:IdealLoadsAirSystem at LimitCapacity).

Reported per heated room and case, all from hourly values: annual heating; hours more than 0.5 K below the hour's own
setpoint, and in use (f = 1); the lowest air temperature over all hours and in use; the mean of each weekday's highest
hourly heating; the mean weekday heating profile (24 values). And the middle room's cooling.

Usage: python3 -I validation/energyplus/109_setback_referee.py --energyplus <path> [--runs <dir>]
Each case runs under both zone air algorithms (ALGORITHMS). Writes docs/audit/109/02_cooled_room_energyplus.json. Nothing touches data/ or a database.
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
s_ = importlib.util.spec_from_file_location("cooled", HERE / "104_cooled_room.py")
C = importlib.util.module_from_spec(s_)
s_.loader.exec_module(C)  # type: ignore[union-attr]
SB = json.loads((HERE / "109_setback_spec.json").read_text())
OUT = REPO / "docs/audit/109/02_cooled_room_energyplus.json"
DAYS = (("weekday", "Weekdays"), ("saturday", "Saturday"), ("sunday", "Sunday AllOtherDays"))


def compact(values_by_day: dict) -> list:
    """Schedule:Compact fields from 24 hourly values per day type (hour index i is the hour ending i + 1)."""
    f = [{"field": "Through: 12/31"}]
    for key, label in DAYS:
        v = values_by_day[key]
        f.append({"field": f"For: {label}"})
        for i in range(24):
            if i == 23 or v[i + 1] != v[i]:
                f += [{"field": f"Until: {i + 1:02d}:00"}, {"field": v[i]}]
    return f


def day_of_year_types() -> list:
    """The engine's calendar: each hour's day type, 1 January a Monday, 365 days."""
    out = []
    for d in range(365):
        dow = d % 7
        out.append("saturday" if dow == 5 else "sunday" if dow == 6 else "weekday")
    return out


# EnergyPlus's zone air heat balance: its default (third-order backward difference) and the first-order Euler step the
# engines use. On a setpoint step with unlimited ideal loads the third-order form over-delivers in the first quarter
# hour (1,876.5 kW against Euler's 1,231.2 kW on Bridgewater's top storey, 21 Jan 07:00), the room overshoots to a
# 23.6 C hour mean and cooling takes 502.7 kW back the next step (docs/audit/109/02_referee.md). Both are run and
# reported; the gate is read against Euler.
ALGORITHMS = ("ThirdOrderBackwardDifference", "EulerMethod")


def model(caps: dict | None, algorithm: str = "ThirdOrderBackwardDifference") -> dict:
    ep = C.model(frozenset({"iso_conv"}))
    ep["ZoneAirHeatBalanceAlgorithm"] = {"zone_air": {"algorithm": algorithm}}
    ep["RunPeriod"]["Year"]["use_weather_file_holidays_and_special_days"] = "No"
    ep["Schedule:Compact"] = {}
    sb = SB["cooled_room"]["setback_c"]
    for r in C.SPEC["rooms"]:
        z = r["id"]
        if r["heat_c"] is not None:
            del ep["Schedule:Constant"][f"{z}_sp"]
            ep["Schedule:Compact"][f"{z}_sp"] = {"schedule_type_limits_name": "Any", "data": compact(
                {k: [sb + f * (r["heat_c"] - sb) for f in SB["hours"][k]] for k, _ in DAYS})}
        else:
            del ep["Schedule:Constant"][f"{z}_ctl"]
            ep["Schedule:Compact"][f"{z}_ctl"] = {"schedule_type_limits_name": "Any", "data": compact(
                {k: [2 if f > 0 else 0 for f in SB["hours"][k]] for k, _ in DAYS})}
    for z, w in (caps or {}).items():
        o = ep["ZoneHVAC:IdealLoadsAirSystem"][f"{z}_ideal"]
        o["heating_limit"] = "LimitCapacity"
        o["maximum_sensible_heating_capacity"] = float(w)
    return ep


# What heated the air. EnergyPlus's "Zone Ideal Loads Zone Sensible Heating" is m·cp·(T_supply − T_zone) with T_zone the
# zone's temperature before the step solves, so on a setpoint step it counts the whole step's temperature rise again
# (158.5 kW in the first quarter hour on a Bridgewater storey, 16 to 21 C; docs/audit/109/02_referee.md). The zone air
# heat balance's own terms are what entered the air: system air transfer plus system convective gain, each time step,
# heating where positive and cooling where negative, averaged to the hour. The ideal-loads figure is kept alongside.
AIR_TERMS = ("Zone Air Heat Balance System Air Transfer Rate", "Zone Air Heat Balance System Convective Heat Gain Rate")


def add_air_outputs(ep: dict) -> None:
    for i, v in enumerate(AIR_TERMS):
        ep.setdefault("Output:Variable", {})[f"air_{i}"] = {"key_value": "*", "variable_name": v, "reporting_frequency": "Timestep"}


def air_heat_cool(con, zone: str) -> tuple[list, list]:
    def ts(name):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency like 'Zone Timestep%'
            and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, zone))]
    a, b = (ts(n) for n in AIR_TERMS)
    if len(a) != len(b) or len(a) % 8760:
        raise SystemExit(f"{zone}: {len(a)} / {len(b)} time-step values")
    n = len(a) // 8760
    q = [x + y for x, y in zip(a, b)]
    heat = [sum(max(v, 0.0) for v in q[h * n:(h + 1) * n]) / n for h in range(8760)]
    cool = [sum(max(-v, 0.0) for v in q[h * n:(h + 1) * n]) / n for h in range(8760)]
    return heat, cool


def summarise(heat_w: list, tz: list, sp: list, use: list, days: list, tol: float) -> dict:
    wd = [d for d in range(365) if days[d] == "weekday"]
    prof = [sum(heat_w[d * 24 + i] for d in wd) / len(wd) for i in range(24)]
    return {
        "heat_mwh": sum(heat_w) / 1e6, "peak_w": max(heat_w),
        "unmet_hours": sum(1 for h in range(8760) if tz[h] < sp[h] - tol),
        "unmet_hours_in_use": sum(1 for h in range(8760) if use[h] and tz[h] < sp[h] - tol),
        "min_c": min(tz), "min_in_use_c": min(tz[h] for h in range(8760) if use[h]),
        "weekday_morning_peak_w": sum(max(heat_w[d * 24:(d + 1) * 24]) for d in wd) / len(wd),
        "weekday_profile_w": prof,
    }


def run(energyplus: str, ep: dict, epw: Path, d: Path) -> dict:
    add_air_outputs(ep)
    d.mkdir(parents=True, exist_ok=True)
    (d / "in.epJSON").write_text(json.dumps(ep, indent=1))
    p = subprocess.run([energyplus, "-w", str(epw), "-d", str(d), str(d / "in.epJSON")], capture_output=True, text=True)
    err = (d / "eplusout.err").read_text(errors="replace")
    if p.returncode != 0 or re.findall(r"\*\* Severe  \*\*", err):
        raise SystemExit(f"EnergyPlus failed in {d}\n{err[-3000:]}")
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name, key):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency = 'Hourly'
            and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    days = day_of_year_types()
    sb, tol = SB["cooled_room"]["setback_c"], SB["unmet_tolerance_k"]
    out = {"warnings": len(re.findall(r"\*\* Warning \*\*", err)), "zones": {}}
    for r in C.SPEC["rooms"]:
        z = r["id"]
        tz = series("Zone Mean Air Temperature", z)
        if len(tz) != 8760:
            raise SystemExit(f"{z}: {len(tz)} hourly values")
        f = [SB["hours"][days[h // 24]][h % 24] for h in range(8760)]
        if r["heat_c"] is None:
            _, cool = air_heat_cool(con, z)
            rep = [v / 3600.0 for v in series("Zone Ideal Loads Zone Sensible Cooling Energy", f"{z}_ideal")]
            out["zones"][z] = {"cool_mwh": sum(cool) / 1e6, "cooling_outside_hours_wh": sum(c for c, x in zip(cool, f) if x == 0),
                               "ideal_loads_reported_cool_mwh": sum(rep) / 1e6}
            continue
        heat, _ = air_heat_cool(con, z)
        rep = [v / 3600.0 for v in series("Zone Ideal Loads Zone Sensible Heating Energy", f"{z}_ideal")]
        sp = [sb + x * (r["heat_c"] - sb) for x in f]
        out["zones"][z] = {**summarise(heat, tz, sp, [x == 1 for x in f], days, tol), "ideal_loads_reported": {
            "heat_mwh": sum(rep) / 1e6, "peak_w": max(rep), "weekday_morning_peak_w": summarise(rep, tz, sp, [x == 1 for x in f], days, tol)["weekday_morning_peak_w"]}}
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
    runs = Path(a.runs or tempfile.mkdtemp(prefix="109_setback_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    sha = lambda f: hashlib.sha256((HERE / f).read_bytes()).hexdigest()
    res = {"source": "validation/energyplus/109_setback_referee.py", "spec_sha256": sha("104_cooled_room_spec.json"),
           "setback_spec_sha256": sha("109_setback_spec.json"), "weather_mos_sha256": B.MOS_SHA, "runs": {}}
    for alg in ALGORITHMS:
      res["runs"][alg] = {}
      for name, caps in SB["cooled_room"]["cases"].items():
        r = run(a.energyplus, model(caps, alg), epw, runs / alg / name)
        res["runs"][alg][name] = r
        print(alg, name, json.dumps({z: {k: round(v, 2) for k, v in d.items() if isinstance(v, (int, float))} for z, d in r["zones"].items()}), "warnings", r["warnings"])
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
