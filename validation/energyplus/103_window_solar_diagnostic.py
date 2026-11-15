#!/usr/bin/env python3
"""
Brief 103 Part 6 instrumentation: where the referee's window solar goes.

Re-runs the Part 5 referee (r0) with extra outputs only (no input changes), and reports per facade and annual:
incident solar on the windows' outside faces, transmitted solar, solar absorbed in the glazing, and the window's
normal-incidence optical properties EnergyPlus derived from the SimpleGlazingSystem (U, SHGC, the equivalent glazing
layer). Then one isolating perturbation of the referee: the interior floor slabs with their mass removed (same
resistance). Prints JSON (committed as docs/audit/103/06_window_solar_diagnostic.json).

Usage: python3 validation/energyplus/103_window_solar_diagnostic.py --energyplus <path> [--runs <dir>]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sqlite3
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("referee", HERE / "103_referee.py")
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)  # type: ignore[union-attr]

MWH = 3.6e9
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    checks: list = []
    ep, _info = R.build(set(), fx, R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW), checks)
    win = ep["FenestrationSurface:Detailed"]
    area = {n: R.poly_area(w) for n, w in win.items()}
    extra = ["Surface Outside Face Incident Solar Radiation Rate per Area", "Surface Window Transmitted Solar Radiation Rate",
             "Surface Window Total Glazing Layers Absorbed Solar Radiation Rate"]
    for i, v in enumerate(extra):
        ep["Output:Variable"][f"diag_{i}"] = {"key_value": "*", "variable_name": v, "reporting_frequency": "Hourly"}
    ep["Output:VariableDictionary"] = {"Output:VariableDictionary 1": {"key_field": "IDF"}}
    ep["Output:Constructions"] = {"Output:Constructions 1": {"details_type_1": "Constructions"}}
    d = Path(a.runs or tempfile.mkdtemp(prefix="103_windiag_")) / "r0_window_diag"
    d.mkdir(parents=True, exist_ok=True)
    (d / "in.epJSON").write_text(json.dumps(ep))
    subprocess.run([a.energyplus, "-w", str(R.EPW), "-d", str(d), str(d / "in.epJSON")], check=True, capture_output=True)
    con = sqlite3.connect(d / "eplusout.sql")
    rows = con.execute("""select d.Name, d.KeyValue, t.Month, sum(r.Value) from ReportData r
        join ReportDataDictionary d using (ReportDataDictionaryIndex) join Time t using (TimeIndex)
        where d.ReportingFrequency = 'Hourly' and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods)
        group by d.Name, d.KeyValue, t.Month""").fetchall()
    con.close()
    upper = {n.upper(): n for n in win}
    out: dict = {"by_facade_mwh": {}, "monthly_mwh": {}}
    for name, key, month, val in rows:
        wn = upper.get(key.upper())
        if wn is None:
            continue
        face = win[wn]["building_surface_name"].split("_")[-1]
        # Hourly rates (W or W/m2) summed over hours give Wh; per-area rates times the window's area.
        wh = val * area[wn] if name.endswith("per Area") else val
        short = {extra[0]: "incident", extra[1]: "transmitted", extra[2]: "absorbed_in_glazing"}.get(name)
        if short is None:
            continue
        f = out["by_facade_mwh"].setdefault(face, {})
        f[short] = f.get(short, 0.0) + wh / 1e6
        m = out["monthly_mwh"].setdefault(short, [0.0] * 12)
        m[int(month) - 1] += wh / 1e6
    tot = {k: sum(f.get(k, 0.0) for f in out["by_facade_mwh"].values()) for k in
           ("incident", "transmitted", "absorbed_in_glazing")}
    out["total_mwh"] = tot
    out["annual_transmitted_over_incident"] = tot["transmitted"] / tot["incident"]
    eio = (d / "eplusout.eio").read_text(errors="replace")
    m = re.findall(r"^ WindowConstruction,.*$", eio, re.M)
    hdr = re.findall(r"^! <WindowConstruction>.*$", eio, re.M)
    out["window_construction_eio"] = {"header": hdr[0] if hdr else None, "rows": m}
    out["areas_m2"] = {k: round(sum(area[n] for n in win if win[n]["building_surface_name"].endswith("_" + k)), 3) for k in "NESW"}
    out["window_glazing_layer_eio"] = re.findall(r"^ WindowMaterial:Glazing,.*$", eio, re.M)

    # Isolating perturbation for the zone count: the referee with the interior floor slabs' MASS removed (each slab
    # becomes one NoMass layer of the same thermal resistance, so floor-to-floor conduction is unchanged).
    ep2, _ = R.build(set(), fx, R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW), [])
    r_slab, _ = R.construction_r(ep2, "interior_floor_ceiling")
    ep2["Material:NoMass"]["IntFloor_NoMass"] = {"roughness": "MediumRough", "thermal_resistance": r_slab}
    ep2["Construction"]["interior_floor_ceiling"] = {"outside_layer": "IntFloor_NoMass"}
    res = R.run_ep(a.energyplus, ep2, d.parent / "r0_slabs_no_mass")
    s2 = R.summarise(res, ep2)
    out["slabs_no_mass"] = {"slab_r_m2k_per_w": r_slab, "heating_mwh": s2["heating_mwh"], "cooling_mwh": s2["cooling_mwh"],
                            "heating_monthly_mwh": s2["heating_monthly_mwh"], "cooling_monthly_mwh": s2["cooling_monthly_mwh"],
                            "severe": s2["severe"], "fatal": s2["fatal"]}
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
