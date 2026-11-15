#!/usr/bin/env python3
"""
Brief 108 Part 3: Bridgewater as five storeys in EnergyPlus with the top storey's heating limited.

Brief 105's gate referee r2_z_gains_vent_std (validation/energyplus/105_gains_referee.py: Brief 104's r2_z with the
engine's own gains and ventilation, standard air density), run twice: as it is, and with Floor_5's
ZoneHVAC:IdealLoadsAirSystem at Heating Limit = LimitCapacity at the cap in 108_capped_spec.json ("bridgewater").

Reported per storey: annual heating and cooling (MWh); and per storey from hourly Zone Mean Air Temperature, the hours
more than 0.5 K below the 21 C heating setpoint, the lowest air temperature and the most heating in any hour.
EnergyPlus's own Zone Heating Setpoint Not Met Time is read too (OutputControl:ReportingTolerances at 0.5 K).

Usage: python3 -I validation/energyplus/108_bridgewater_capped.py --energyplus <path> --gains <dir> [--runs <dir>]
(--gains: scripts/105_gains.mts's export, as 105_gains_referee.py takes it.)
Writes docs/audit/108/03_bridgewater_capped_energyplus.json. Nothing touches data/ or a database.
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
spec = importlib.util.spec_from_file_location("gains", HERE / "105_gains_referee.py")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)  # type: ignore[union-attr]
Z, A, R = G.Z, G.A, G.R
CAPS = json.loads((HERE / "108_capped_spec.json").read_text())
OUT = REPO / "docs/audit/108/03_bridgewater_capped_energyplus.json"
SETPOINT_C = 21.0


def build(fx, today, psi, tg, gdir: Path, caps: dict | None):
    flags = G.RUNS["r2_z_gains_vent_std"]
    ep, notes = A.build_run([f for f in flags if f not in ("tb_by_zone", "inf_by_zone", "slab_reversed", "gains", "vent", "std_density")], fx, today, psi, tg)
    Z.slab_reversed(ep, notes)
    Z.tb_by_zone(ep, fx, psi, notes)
    Z.inf_by_zone(ep, notes)
    G.add_gains(ep, gdir, notes)
    G.add_vent(ep, gdir, notes)
    for k in ("ZoneVentilation:DesignFlowRate", "ZoneInfiltration:DesignFlowRate"):
        for o in ep.get(k, {}).values():
            o["density_basis"] = "Standard"
    for z, w in (caps or {}).items():
        o = ep["ZoneHVAC:IdealLoadsAirSystem"][f"{z}_IdealLoads"]
        o["heating_limit"] = "LimitCapacity"
        o["maximum_sensible_heating_capacity"] = float(w)
        notes.append(f"cap: {z} heating limited to {w} W")
    ep["Output:Variable"]["h_108"] = {"key_value": "*", "variable_name": "Zone Heating Setpoint Not Met Time", "reporting_frequency": "Hourly"}
    tol = CAPS["unmet_tolerance_k"]
    ep["OutputControl:ReportingTolerances"] = {"tol": {"tolerance_for_time_heating_setpoint_not_met": tol, "tolerance_for_time_cooling_setpoint_not_met": tol}}
    return ep, notes


def hourly(d: Path, ep: dict) -> dict:
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name, key):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency = 'Hourly'
            and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    tol = CAPS["unmet_tolerance_k"]
    out = {}
    for z in sorted(ep["Zone"]):
        tz = series("Zone Mean Air Temperature", z)
        heat = series("Zone Ideal Loads Zone Sensible Heating Energy", f"{z}_IdealLoads")
        out[z] = {"unmet_hours": sum(1 for t in tz if t < SETPOINT_C - tol), "ep_not_met_hours": sum(series("Zone Heating Setpoint Not Met Time", z)),
                  "min_c": min(tz), "peak_heating_w": max(heat) / 3600.0}
    con.close()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--gains", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    today, psi, tg = R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW)
    root = Path(a.runs or tempfile.mkdtemp(prefix="108_bw_"))
    out = {"source": "validation/energyplus/108_bridgewater_capped.py", "epw_sha256": R.EPW_SHA,
           "caps_sha256": hashlib.sha256((HERE / "108_capped_spec.json").read_bytes()).hexdigest(),
           "gains_csv_sha256": hashlib.sha256((Path(a.gains) / "gains.csv").read_bytes()).hexdigest(), "runs": {}}
    for name, caps in (("uncapped", None), ("capped", CAPS["bridgewater"]["caps"])):
        ep, notes = build(fx, today, psi, tg, Path(a.gains), caps)
        res = R.run_ep(a.energyplus, ep, root / name)
        s = R.summarise(res, ep)
        zones = Z.per_zone(root / name, ep)
        h = hourly(root / name, ep)
        for z in zones:
            zones[z].update(h[z])
        out["runs"][name] = {"notes": notes, "heating_mwh": s["heating_mwh"], "cooling_mwh": s["cooling_mwh"], "zones": zones,
                             "severe": s["severe"], "warnings": res["warnings"]}
        out["energyplus_version"] = res["version"]
        print(name, json.dumps({z: {k: round(v, 3) for k, v in d.items() if isinstance(v, (int, float))} for z, d in zones.items()}), flush=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
