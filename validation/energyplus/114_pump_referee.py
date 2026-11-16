#!/usr/bin/env python3
"""
Brief 114 Part 2: a heating system's pumps in EnergyPlus, against Engine 2's pumps end use.

108_hotwater_referee.py's model (two rooms on ZoneHVAC:Baseboard:RadiantConvective:Water, a DistrictHeating:Water
source at 50 C, adiabatic pipes), with the loop's pump given 114_pump_spec.json's design power and run as a constant-
or variable-speed pump, intermittent or continuous. The pump's design flow (and the loop's maximum) is the radiators'
summed design flow, so a flow fraction of 1 is every radiator at full flow. The pump adds no heat to the water
(motor efficiency 0.001, so the shaft work that EnergyPlus always puts into the water is 0.1 % of the power, and fraction of motor inefficiencies to fluid 0; the engine counts none either). Variable speed keeps EnergyPlus's default
part-load coefficients (0, 1, 0, 0) and a design minimum flow of 0.

Reported per variant: annual pump electricity, hours with pump power above zero (hourly), and for variable speed the
hourly flow fraction against the hourly heat fraction (the baseboards' heat over its busiest hour), so the difference
between EnergyPlus's flow fraction and the engine's load fraction can be read off.
Usage: python3 -I validation/energyplus/114_pump_referee.py --energyplus <path> [--runs <dir>]
Writes docs/audit/114/02_energyplus.json. Nothing touches data/ or a database.
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
MONTHS_OF_HOUR = [m for m, n in enumerate([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], start=1) for _ in range(n * 24)]
C = HWR.C
SPEC = json.loads((HERE / "114_pump_spec.json").read_text())
OUT = REPO / "docs/audit/114/02_energyplus.json"


MONTH_END = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def season_schedule(months: set[int]) -> dict:
    data = []
    for m in range(1, 13):
        data += [{"field": f"Through: {m}/{MONTH_END[m - 1]}"}, {"field": "For: AllDays"}, {"field": "Until: 24:00"}, {"field": 1.0 if m in months else 0.0}]
    return {"schedule_type_limits_name": "Any", "data": data}


def model(variant: dict, season: set[int] | None = None) -> tuple[dict, dict]:
    caps = HWR.HW["cases"][SPEC["case"]]
    ep, ratings = HWR.model(caps)
    vdes = sum(g["water_kg_s"] for g in ratings.values()) / HWR.RHO_HW
    ep["PlantLoop"]["hw_loop"]["maximum_loop_flow_rate"] = vdes
    base = {"inlet_node_name": "hw_sup_in", "outlet_node_name": "hw_pump_out", "design_maximum_flow_rate": vdes,
            "design_pump_head": 1.0, "design_power_consumption": SPEC["pump_w"], "motor_efficiency": 0.001,
            "fraction_of_motor_inefficiencies_to_fluid_stream": 0.0, "pump_control_type": variant["ep_control"]}
    del ep["Pump:VariableSpeed"]
    if variant["ep_object"] == "Pump:VariableSpeed":
        ep["Pump:VariableSpeed"] = {"hw_pump": {**base, "coefficient_1_of_the_part_load_performance_curve": 0.0,
                                                "coefficient_2_of_the_part_load_performance_curve": 1.0,
                                                "coefficient_3_of_the_part_load_performance_curve": 0.0,
                                                "coefficient_4_of_the_part_load_performance_curve": 0.0,
                                                "design_minimum_flow_rate": 0.0}}
    else:
        base["design_flow_rate"] = base.pop("design_maximum_flow_rate")
        ep["Pump:ConstantSpeed"] = {"hw_pump": base}
    if variant.get("ep_season"):
        ep.setdefault("Schedule:Compact", {})["pump_season"] = season_schedule(season)
        ep[variant["ep_object"]]["hw_pump"]["pump_flow_rate_schedule_name"] = "pump_season"
    ep["Branch"]["hw_sup_inlet"]["components"][0]["component_object_type"] = variant["ep_object"]
    for i, v in enumerate(("Pump Electricity Rate", "Pump Mass Flow Rate")):
        ep["Output:Variable"][f"pu{i}"] = {"key_value": "hw_pump", "variable_name": v, "reporting_frequency": "Hourly"}
    return ep, {"design_m3s": vdes, "design_kg_s": vdes * HWR.RHO_HW, "ratings": ratings}


def run(energyplus: str, ep: dict, info: dict, epw: Path, d: Path) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    (d / "in.epJSON").write_text(json.dumps(ep, indent=1))
    p = subprocess.run([energyplus, "-w", str(epw), "-d", str(d), str(d / "in.epJSON")], capture_output=True, text=True)
    err = (d / "eplusout.err").read_text(errors="replace")
    if p.returncode != 0 or re.findall(r"\*\* Severe  \*\*", err):
        raise SystemExit(f"EnergyPlus failed in {d}\n{err[-4000:]}")
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name, key):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency = 'Hourly' and t.EnvironmentPeriodIndex =
            (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    pw = series("Pump Electricity Rate", "hw_pump")
    mf = series("Pump Mass Flow Rate", "hw_pump")
    def steps(name, key):  # 108's model reports the baseboards at the zone timestep; summed to the hour here
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency = 'Zone Timestep' and t.EnvironmentPeriodIndex =
            (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    st = [a + b for a, b in zip(*(steps("Baseboard Total Heating Energy", f"{z}_bb") for z in ("west", "east")))]
    n = len(st) // len(pw)
    heat = [sum(st[i * n:(i + 1) * n]) for i in range(len(pw))]  # J per hour
    con.close()
    peak = max(heat)
    flow_frac = [m / info["design_kg_s"] for m in mf]
    load_frac = [h / peak for h in heat]
    on = [i for i, h in enumerate(heat) if h > 0]
    months = sorted({MONTHS_OF_HOUR[i] for i in on})
    return {
        "months_with_heat": months,
        "warnings": len(re.findall(r"\*\* Warning \*\*", err)), "hours": len(pw),
        "pump_kwh": sum(pw) / 1000.0, "hours_pump_on": sum(1 for x in pw if x > 1e-6), "hours_with_heat": len(on),
        "heat_kwh": sum(heat) / 3.6e6, "peak_heat_w": peak / 3600.0,
        "sum_flow_fraction_heat_hours": sum(flow_frac[i] for i in on), "sum_load_fraction_heat_hours": sum(load_frac[i] for i in on),
        "flow_vs_load_deciles": [
            {"load_from": k / 10, "load_to": (k + 1) / 10, "hours": len(b), "mean_flow_fraction": sum(flow_frac[i] for i in b) / len(b)}
            for k in range(10) for b in [[i for i in on if k / 10 < load_frac[i] <= (k + 1) / 10 or (k == 0 and load_frac[i] == 0)]] if b],
        "design_kg_s": info["design_kg_s"],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    B = C.B
    if hashlib.sha256(B.MOS.read_bytes()).hexdigest() != B.MOS_SHA:
        raise SystemExit("Denver .mos sha mismatch")
    runs = Path(a.runs or tempfile.mkdtemp(prefix="114_pumps_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    sha = lambda f: hashlib.sha256((HERE / f).read_bytes()).hexdigest()
    res = {"source": "validation/energyplus/114_pump_referee.py", "pump_spec_sha256": sha("114_pump_spec.json"),
           "hotwater_spec_sha256": sha("108_hotwater_spec.json"), "weather_mos_sha256": B.MOS_SHA, "runs": {}}
    season = None
    for name, v in SPEC["variants"].items():
        ep, info = model(v, season)
        r = run(a.energyplus, ep, info, epw, runs / name)
        res["runs"][name] = r
        if name == "fixed_with_demand":
            season = set(r["months_with_heat"])
        print(name, json.dumps({k: (round(x, 3) if isinstance(x, float) else x) for k, x in r.items() if k != "flow_vs_load_deciles"}))
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
