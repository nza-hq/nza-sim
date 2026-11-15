#!/usr/bin/env python3
"""Brief 107 Part 3: the tolerance table, NZA (Engine 2 + v2 systems) | EnergyPlus | delta, per end use, Bridgewater five storeys.

EnergyPlus's ideal-load heating and cooling (Brief 105's referee with gains and ventilation, docs/audit/105/02_gains_referee.json)
go through the same systems (shares and efficiencies). Hot water, its pump, fans, lighting, small power and auxiliary are
inputs both sides share (the referee takes its gains from gains.ts; it has no hot water or fans), so they agree by
construction and are marked so. Reads docs/audit/107/02_gate.json; writes docs/audit/107/03_tolerances.json.
Usage: python3 -I scripts/107_tolerances.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
gate = json.loads((ROOT / "docs/audit/107/02_gate.json").read_text())
ref = json.loads((ROOT / "docs/audit/105/02_gains_referee.json").read_text())["runs"]
e2 = gate["engine2_five_storeys"]
eu = e2["end_uses"]
att = e2["attribution"]
floor = gate["floor_m2"]
# The building's systems (Bridgewater): heating 95 % at SCOP 3 + 5 % direct electric; cooling 100 % at SEER 3.
heat_per_demand = 0.95 / 3 + 0.05 / 1
cool_per_demand = 1 / 3
TOL = {"heating": 10, "cooling": 10, "eui": 5}
shared = ["dhw_electricity", "dhw_gas", "dhw_circulation", "fans", "lighting", "small_power", "auxiliary"]
out = {"source": "scripts/107_tolerances.py", "tolerances_pct": TOL, "referees": {}}
for name, run in (("standard_density (gate)", "r2_z_gains_vent_std"), ("default_density", "r2_z_gains_vent")):
    r = ref[run]
    ep = {
        "heating_demand": r["heating_mwh"], "cooling_demand": r["cooling_mwh"],
        "heating_electricity": r["heating_mwh"] * heat_per_demand, "cooling_electricity": r["cooling_mwh"] * cool_per_demand,
    }
    nza = {"heating_demand": att["heating_demand_mwh"]["engine2"], "cooling_demand": att["cooling_demand_mwh"]["engine2"],
           "heating_electricity": eu["heating_electricity"], "cooling_electricity": eu["cooling_electricity"]}
    rows = {}
    for k in ("heating_demand", "cooling_demand", "heating_electricity", "cooling_electricity"):
        d = (nza[k] / ep[k] - 1) * 100
        tol = TOL["heating" if "heating" in k else "cooling"]
        rows[k] = {"nza": round(nza[k], 3), "ep": round(ep[k], 3), "delta_pct": round(d, 1), "tolerance_pct": tol, "pass": abs(d) <= tol}
    for k in shared:
        rows[k] = {"nza": eu[k], "ep": eu[k], "delta_pct": 0.0, "tolerance_pct": None, "pass": None, "note": "shared input, equal by construction"}
    total_nza = eu["electricity"] + eu["gas"]
    total_ep = total_nza - eu["heating_electricity"] - eu["cooling_electricity"] + ep["heating_electricity"] + ep["cooling_electricity"]
    eui_nza, eui_ep = total_nza * 1000 / floor, total_ep * 1000 / floor
    d = (eui_nza / eui_ep - 1) * 100
    rows["eui_kwh_per_m2"] = {"nza": round(eui_nza, 2), "ep": round(eui_ep, 2), "delta_pct": round(d, 1), "tolerance_pct": TOL["eui"], "pass": abs(d) <= TOL["eui"]}
    out["referees"][name] = {"run": run, "rows": rows}
(ROOT / "docs/audit/107/03_tolerances.json").write_text(json.dumps(out, indent=1) + "\n")
for name, v in out["referees"].items():
    print(name)
    for k, r in v["rows"].items():
        print(f"  {k:22s} {r['nza']:9.3f} {r['ep']:9.3f} {r['delta_pct']:+6.1f}%  {r.get('note') or ('pass' if r['pass'] else 'MISS')}")
