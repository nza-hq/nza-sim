#!/usr/bin/env python3
"""
Brief 105 Part 6: the five-zone EnergyPlus referee for the per-floor accuracy work.

Every run is Brief 104's referee r2_z or r2_z_e2like (validation/energyplus/104_zones_referee.py), with one more change:

  ts_1      one time step an hour (EnergyPlus's default here is 4). With Engine 2's surface simplifications this is the
            referee for Engine 2 at one step an hour; r2_z_e2like (4 steps) is the referee for Engine 2 at 4 steps.
  out_only  in place of iso_conv: the outside coefficient fixed at 20 W/m2K on every outdoor face and window (Engine 2's
            h_ce), and the inside left to EnergyPlus's own algorithm, TARP. With sky_fixed and lw_area this is "r2_z
            with Engine 2's simplifications except inside convection", the referee for Engine 2's 'tarp' option.

Every run also writes, hourly, each slab face's inside-face conduction and temperature and each zone's air temperature,
so the roof storey's slab gap (Brief 104 Part 5: 0.77 MWh through z5's floor in Engine 2, 1.28 in r2_z_e2like) can be
followed hour by hour (docs/audit/105/06_slab_hourly.json, written by scripts/105_per_floor.mts from these).

Runs:
  r2_z_e2like      Brief 104's (4 steps), repeated with the hourly slab outputs
  r2_z_e2like_ts1  the same at one step an hour
  r2_z_e2tarp      r2_z_e2like with out_only in place of iso_conv (inside TARP), 4 steps
  r2_z_e2tarp_ts1  the same at one step an hour
  r2_z             Brief 104's gate referee, repeated with the hourly slab outputs

Usage: python3 -I validation/energyplus/105_per_floor_referee.py --energyplus <path> [--runs <dir>] [--only a,b] [--out f.json]
       python3 -I validation/energyplus/105_per_floor_referee.py --energyplus - --merge a.json b.json …
Writes docs/audit/105/06_referee.json and <runs>/<run>/slab_hourly.json. Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sqlite3
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
spec = importlib.util.spec_from_file_location("zones", HERE / "104_zones_referee.py")
Zr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(Zr)  # type: ignore[union-attr]
A, R = Zr.A, Zr.R
OUT = REPO / "docs/audit/105/06_referee.json"
E2 = ["frame_split", "docmass", "slab_reversed", "tb_by_zone", "inf_by_zone", "sky_fixed", "lw_area"]
RUNS = {
    "r2_z_e2like": E2 + ["iso_conv"],
    "r2_z_e2like_ts1": E2 + ["iso_conv", "ts_1"],
    "r2_z_e2tarp": E2 + ["out_only"],
    "r2_z_e2tarp_ts1": E2 + ["out_only", "ts_1"],
    "r2_z": ["frame_split", "docmass", "slab_reversed", "tb_by_zone", "inf_by_zone"],
}
MWH = 3.6e9


def out_only(ep: dict, notes: list) -> None:
    cc = {}
    for n, s in ep["BuildingSurface:Detailed"].items():
        if s["outside_boundary_condition"] == "Outdoors":
            cc[f"c_{n}"] = {"surface_name": n, "convection_coefficient_1_location": "Outside",
                            "convection_coefficient_1_type": "Value", "convection_coefficient_1": 20.0}
    for n in ep["FenestrationSurface:Detailed"]:
        cc[f"c_{n}"] = {"surface_name": n, "convection_coefficient_1_location": "Outside",
                        "convection_coefficient_1_type": "Value", "convection_coefficient_1": 20.0}
    ep["SurfaceProperty:ConvectionCoefficients"] = cc
    if ep.get("SurfaceConvectionAlgorithm:Inside", {}).get("SurfaceConvectionAlgorithm:Inside 1", {}).get("algorithm", "TARP") != "TARP":
        raise SystemExit("the referee's inside convection algorithm is not TARP")
    notes.append(f"out_only: outside coefficient 20 on {len(cc)} surfaces; inside left to TARP")


def hourly_outputs(ep: dict) -> None:
    ov = ep.setdefault("Output:Variable", {})
    for i, v in enumerate(["Surface Inside Face Conduction Heat Transfer Rate", "Surface Inside Face Temperature",
                           "Surface Inside Face Convection Heat Gain Rate", "Zone Mean Air Temperature"]):
        ov[f"p6_{i}"] = {"key_value": "*", "variable_name": v, "reporting_frequency": "Hourly"}


def slab_hourly(d: Path, ep: dict) -> dict:
    """Per zone, hourly: heat into the zone through its slab faces (W, EnergyPlus's sign), those faces' mean inside
    temperature, and the zone air temperature."""
    surf = {n.upper(): v for n, v in ep["BuildingSurface:Detailed"].items()}
    con = sqlite3.connect(d / "eplusout.sql")
    env = "(select max(EnvironmentPeriodIndex) from EnvironmentPeriods)"
    q = f"""select d.Name, d.KeyValue, r.TimeIndex, r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
             join Time t using (TimeIndex) where t.EnvironmentPeriodIndex = {env} and d.ReportingFrequency = 'Hourly'
             and d.Name in ('Surface Inside Face Conduction Heat Transfer Rate', 'Surface Inside Face Temperature',
                            'Surface Inside Face Convection Heat Gain Rate', 'Zone Mean Air Temperature') order by r.TimeIndex"""
    times: dict = {}
    out: dict = {}
    for name, key, ti, val in con.execute(q):
        h = times.setdefault(ti, len(times))
        if name == "Zone Mean Air Temperature":
            z = out.setdefault(key.title(), {})
            z.setdefault("air_c", []).append(val)
            continue
        sf = surf.get(key.upper())
        if not sf or sf["outside_boundary_condition"] != "Surface":
            continue
        z = out.setdefault(sf["zone_name"], {})
        kind = "floor" if sf["surface_type"] == "Floor" else "ceiling"
        f = z.setdefault(kind, {"conduction_w": {}, "convection_w": {}, "temp_c": {}})
        tag = {"Surface Inside Face Conduction Heat Transfer Rate": "conduction_w", "Surface Inside Face Temperature": "temp_c",
               "Surface Inside Face Convection Heat Gain Rate": "convection_w"}[name]
        f[tag][h] = f[tag].get(h, 0.0) + val if tag != "temp_c" else val
    con.close()
    H = len(times)
    for z in out.values():
        for kind in ("floor", "ceiling"):
            if kind in z:
                for tag in ("conduction_w", "convection_w", "temp_c"):
                    z[kind][tag] = [round(z[kind][tag].get(h, 0.0), 3) for h in range(H)]
        if "air_c" in z:
            z["air_c"] = [round(v, 4) for v in z["air_c"]]
    return {"hours": H, "zones": dict(sorted(out.items()))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--out", default=None, help="write this JSON instead (runs in parallel each write their own; --merge joins them)")
    ap.add_argument("--merge", nargs="*", default=None, help="join these per-run JSON files into docs/audit/105/06_referee.json")
    a = ap.parse_args()
    if a.merge is not None:
        out = json.loads(OUT.read_text()) if OUT.exists() else {"runs": {}}
        for f in a.merge:
            part = json.loads(Path(f).read_text())
            out["runs"].update(part["runs"])
            out["energyplus_version"] = part["energyplus_version"]
        out["source"], out["epw_sha256"] = "validation/energyplus/105_per_floor_referee.py", R.EPW_SHA
        OUT.write_text(json.dumps(out, indent=1) + "\n")
        return
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    today, psi, tg = R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW)
    root = Path(a.runs or tempfile.mkdtemp(prefix="105_floor_"))
    want = a.only.split(",") if a.only else list(RUNS)
    dest = Path(a.out) if a.out else OUT
    out = json.loads(dest.read_text()) if dest.exists() and a.only else {"runs": {}}
    for name in want:
        flags = RUNS[name]
        base = [f for f in flags if f not in ("tb_by_zone", "inf_by_zone", "slab_reversed", "out_only")]
        ep, notes = A.build_run(base, fx, today, psi, tg)
        if "slab_reversed" in flags:
            Zr.slab_reversed(ep, notes)
        if "tb_by_zone" in flags:
            Zr.tb_by_zone(ep, fx, psi, notes)
        if "inf_by_zone" in flags:
            Zr.inf_by_zone(ep, notes)
        if "out_only" in flags:
            out_only(ep, notes)
        hourly_outputs(ep)
        res = R.run_ep(a.energyplus, ep, root / name)
        s = R.summarise(res, ep)
        ts = ep["Timestep"]["Timestep 1"]["number_of_timesteps_per_hour"]
        out["runs"][name] = {"flags": flags, "notes": notes, "timesteps_per_hour": ts, "heating_mwh": s["heating_mwh"],
                             "cooling_mwh": s["cooling_mwh"], "zones": Zr.per_zone(root / name, ep), "severe": s["severe"],
                             "warnings": res["warnings"]}
        out["energyplus_version"] = res["version"]
        (root / name / "slab_hourly.json").write_text(json.dumps(slab_hourly(root / name, ep)) + "\n")
        print(f"{name:16s} ts {ts}  heat {s['heating_mwh']:8.3f}  cool {s['cooling_mwh']:7.3f}  severe {s['severe']}  "
              + " ".join(f"{z}:{v['heating_mwh']:.2f}/{v['cooling_mwh']:.2f}/{v.get('slab_inside_face_conduction_mwh', 0):.2f}"
                         for z, v in out["runs"][name]["zones"].items()), flush=True)
    out["source"] = "validation/energyplus/105_per_floor_referee.py"
    out["epw_sha256"] = R.EPW_SHA
    dest.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
