#!/usr/bin/env python3
"""
Brief 104 Part 1 instrumentation: Engine 1 against EnergyPlus-with-Engine-1's-simplifications ('e1_like' in
104_attribution.py) at a CONSTANT setpoint, so the zone load is linear in its drivers and each driver can be switched
off in both engines and compared hour by hour.

Drivers switched off (each in EnergyPlus here, and identically in Engine 1 by scripts/104_superposition.mts):
  win_dark     window SHGC -> 1e-4 (no solar through glazing)
  opaque_dark  outside solar absorptance of walls and roof -> 0
Every run: e1_like flags plus both setpoints at 22 C (heating and cooling share one setpoint).
Writes the hourly net sensible load (cooling - heating, W) per run to <runs>/<name>/net_w.json, and prints annual sums.

Usage: python3 -I validation/energyplus/104_superposition.py --energyplus <path> --runs <dir>
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sqlite3
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("attr", HERE / "104_attribution.py")
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)  # type: ignore[union-attr]
R = A.R
SET = 22.0
RUNS = {"all": set(), "win_dark": {"win_dark"}, "opaque_dark": {"opaque_dark"}, "both_dark": {"win_dark", "opaque_dark"}}


def build(extra: set, fx, today, psi, tg) -> dict:
    ep, _ = A.build_run(A.RUNS["e1_like"], fx, today, psi, tg)
    ep["Schedule:Compact"]["hotel_heating_setpoint"] = R.A._flat_temperature_schedule(SET)
    ep["Schedule:Compact"]["hotel_cooling_setpoint"] = R.A._flat_temperature_schedule(SET)
    if "win_dark" in extra:
        for o in ep["WindowMaterial:SimpleGlazingSystem"].values():
            o["solar_heat_gain_coefficient"] = 1e-4
    if "opaque_dark" in extra:
        for s in ep["BuildingSurface:Detailed"].values():
            if s["outside_boundary_condition"] != "Outdoors":
                continue
            outer = ep["Construction"][s["construction_name"]]["outside_layer"]
            mat = ep["Material:NoMass"].get(outer) or ep["Material"][outer]
            mat["solar_absorptance"] = 0.0
    return ep


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", required=True)
    a = ap.parse_args()
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    today, psi, tg = R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW)
    for name, extra in RUNS.items():
        ep = build(extra, fx, today, psi, tg)
        d = Path(a.runs) / name
        R.run_ep(a.energyplus, ep, d)
        con = sqlite3.connect(d / "eplusout.sql")
        def series(v):
            return [x for (x,) in con.execute("""select sum(r.Value) from ReportData r join ReportDataDictionary dd using (ReportDataDictionaryIndex)
                join Time t using (TimeIndex) where dd.Name = ? and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods)
                group by t.TimeIndex order by t.TimeIndex""", (v,))]
        h = series("Zone Ideal Loads Zone Sensible Heating Energy")
        c = series("Zone Ideal Loads Zone Sensible Cooling Energy")
        net = [(ci - hi) / 3600 for hi, ci in zip(h, c)]
        (d / "net_w.json").write_text(json.dumps(net))
        print(f"{name:12s} hours {len(net)} heat {sum(h)/3.6e9:8.3f} cool {sum(c)/3.6e9:8.3f} net {sum(net)/1e6:8.3f} MWh", flush=True)


if __name__ == "__main__":
    main()
