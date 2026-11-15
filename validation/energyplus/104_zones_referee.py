#!/usr/bin/env python3
"""
Brief 104 Part 5: the five-zone EnergyPlus referee for Bridgewater, per zone.

Every run is Part 1's referee r1 (validation/energyplus/104_attribution.py: the Brief 103 referee r0 with the document's
frame as glass and frame sub-windows, and the document's 250 kJ/m2K internal capacity on each zone's air) with the
changes its flags name. This script adds one change and reads every result per zone, monthly.

  tb_by_zone  thermal bridging allocated per zone as Engine 2 allocates it (frontend/src/thermal/engine/model.ts and
              bridging.ts, zone_share): the roof junction on the top zone's roof (as r0 already does), the ground
              junction on the bottom zone's walls, half of each slab's perimeter junction to each zone it joins,
              corners and window perimeters equally by storey. r0 spreads every wall junction over all walls by area
              (equal by storey), which is the same total by a different allocation. Each zone's walls get their own
              copy of the wall construction with the insulation resized to that zone's dU.

  inf_by_zone infiltration allocated per zone as Engine 2 allocates it: each zone's air change rate is q50 x its own
              envelope area (walls with their windows, roof, ground floor) / its own volume / 20, so the building's
              total is unchanged. r0 gives every zone the building's rate (q50 x total envelope / total volume / 20),
              which puts the roof's and ground floor's leakage into the middle storeys too.

  slab_reversed  the upper face of each slab (the storey above's floor) gets the slab construction with its layers
              reversed, so the carpet is that floor's inside face. r0 (from today's EnergyPlus assembler) gives both
              faces of the pair the same carpet-first construction, which EnergyPlus warns about ("does not have the
              same materials in the reverse order") and runs anyway: each storey's floor then has plaster, not carpet,
              as its inside face, and the slab is not one construction seen from two sides.

Runs:
  r1           the referee as Part 1 ran it
  r1_tbz       r1 with tb_by_zone (Engine 2's per-storey document)
  r1_one_zone  r1 as one zone (Part 1's one_zone change: the slabs stay, both faces in the one zone)

Usage: python3 -I validation/energyplus/104_zones_referee.py --energyplus <path> [--runs <dir>] [--only r1_tbz]
Writes docs/audit/104/05_referee_zones.json. Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import math
import sqlite3
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
spec = importlib.util.spec_from_file_location("attr", HERE / "104_attribution.py")
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)  # type: ignore[union-attr]
R = A.R
OUT = REPO / "docs/audit/104/05_referee_zones.json"
RUNS = {
    "r1": ["frame_split", "docmass"],
    "r1_tbz": ["frame_split", "docmass", "tb_by_zone"],
    "r1_one_zone": ["frame_split", "docmass", "one_zone"],
    # The gate's referee: Engine 2's per-zone allocation of bridging and infiltration.
    "r1_z": ["frame_split", "docmass", "tb_by_zone", "inf_by_zone"],
    "r1_z_e2like": ["frame_split", "docmass", "tb_by_zone", "inf_by_zone", "iso_conv", "sky_fixed", "lw_area"],
    # With the slab pairs made consistent (r2): the gate is r2_z.
    "r2": ["frame_split", "docmass", "slab_reversed"],
    "r2_z": ["frame_split", "docmass", "slab_reversed", "tb_by_zone", "inf_by_zone"],
    "r2_z_e2like": ["frame_split", "docmass", "slab_reversed", "tb_by_zone", "inf_by_zone", "iso_conv", "sky_fixed", "lw_area"],
    "r2_one_zone": ["frame_split", "docmass", "slab_reversed", "one_zone"],
    "r2_one_zone_e2like": ["frame_split", "docmass", "slab_reversed", "one_zone", "iso_conv", "sky_fixed", "lw_area"],
    # Diagnosis (Part 5): Engine 2's surface simplifications put into the referee.
    "r1_tbz_iso": ["frame_split", "docmass", "tb_by_zone", "iso_conv"],
    "r1_tbz_e2like": ["frame_split", "docmass", "tb_by_zone", "iso_conv", "sky_fixed", "lw_area"],
    "r1_one_zone_e2like": ["frame_split", "docmass", "one_zone", "iso_conv", "sky_fixed", "lw_area"],
}
MWH = 3.6e9


def area(pts: list) -> float:
    """Area of a planar polygon from its vertices (Newell)."""
    nx = ny = nz = 0.0
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        x0, y0, z0 = p["vertex_x_coordinate"], p["vertex_y_coordinate"], p["vertex_z_coordinate"]
        x1, y1, z1 = q["vertex_x_coordinate"], q["vertex_y_coordinate"], q["vertex_z_coordinate"]
        nx += (y0 - y1) * (z0 + z1); ny += (z0 - z1) * (x0 + x1); nz += (x0 - x1) * (y0 + y1)
    return 0.5 * math.sqrt(nx * nx + ny * ny + nz * nz)


def sub_area(w: dict) -> float:
    pts = [{"vertex_x_coordinate": w[f"vertex_{i}_x_coordinate"], "vertex_y_coordinate": w[f"vertex_{i}_y_coordinate"],
            "vertex_z_coordinate": w[f"vertex_{i}_z_coordinate"]} for i in range(1, int(w.get("number_of_vertices", 4)) + 1)]
    return area(pts)


def tb_by_zone(ep: dict, fx: dict, psi: dict, notes: list) -> dict:
    bc = fx["building_config"]
    mult = float((bc.get("thermal_bridges") or {}).get("multiplier", 1))
    L, W, nf, fh = float(bc["length"]), float(bc["width"]), int(bc["num_floors"]), float(bc["floor_height"])
    perim = 2 * (L + W)
    S, F = ep["BuildingSurface:Detailed"], ep["FenestrationSurface:Detailed"]
    zones = sorted({s["zone_name"] for s in S.values()})
    walls = {z: [n for n, s in S.items() if s["zone_name"] == z and s["surface_type"] == "Wall" and s["outside_boundary_condition"] == "Outdoors"] for z in zones}
    net = {z: sum(area(S[n]["vertices"]) - sum(sub_area(w) for w in F.values() if w["building_surface_name"] == n) for n in walls[z]) for z in zones}
    # The building's window junction as r0 states it (one square per facade); shared equally by storey, as Engine 2
    # shares it by glazing area (each storey has the same glazing on each facade).
    facade = {}
    for w in F.values():
        f = w["building_surface_name"].split("_")[-1]
        facade[f] = facade.get(f, 0.0) + sub_area(w)
    win_total = sum(4 * math.sqrt(a) for a in facade.values() if a > 0)
    h_wall_total = (perim * psi["wall_to_ground_floor"] + perim * max(0, nf - 1) * psi["wall_to_intermediate_floor"]
                    + 4 * nf * fh * psi["external_corner"] + win_total * psi["window_perimeter"]) * mult
    cname = "bridgwater_ext_wall"
    rsi, rse = R.FILMS["wall"]
    r_layers, insul = R.construction_r(ep, cname)
    u_now = 1 / (rsi + rse + r_layers)  # r0 already holds the uniform allocation h_wall_total / A_walls
    a_all = sum(net.values())
    alloc = {}
    total = 0.0
    for i, z in enumerate(zones):
        shared = (1 if i > 0 else 0) + (1 if i < nf - 1 else 0)
        h = ((perim if i == 0 else 0.0) * psi["wall_to_ground_floor"] + 0.5 * perim * shared * psi["wall_to_intermediate_floor"]
             + 4 * fh * psi["external_corner"] + (win_total / nf) * psi["window_perimeter"]) * mult
        total += h
        u_z = u_now - h_wall_total / a_all + h / net[z]
        cz, mz = f"{cname}_{z}", f"{insul}_{z}"
        ep["Material:NoMass"][mz] = copy.deepcopy(ep["Material:NoMass"][insul])
        ep["Material:NoMass"][mz]["thermal_resistance"] += 1 / u_z - (rsi + rse + r_layers)
        c = copy.deepcopy(ep["Construction"][cname])
        for k, v in c.items():
            if v == insul:
                c[k] = mz
        ep["Construction"][cz] = c
        for n in walls[z]:
            S[n]["construction_name"] = cz
        alloc[z] = {"h_w_per_k": round(h, 4), "u_wall": round(u_z, 5), "net_wall_m2": round(net[z], 3)}
    if abs(total - h_wall_total) > 1e-6:
        raise SystemExit(f"tb_by_zone: per-zone wall junctions {total} != {h_wall_total}")
    notes.append(f"tb_by_zone: wall junctions {h_wall_total:.3f} W/K by zone {json.dumps(alloc)}")
    return alloc


def slab_reversed(ep: dict, notes: list) -> None:
    S = ep["BuildingSurface:Detailed"]
    pairs = [(n, s) for n, s in S.items() if s["outside_boundary_condition"] == "Surface" and s["surface_type"] == "Floor"]
    names = {s["construction_name"] for _, s in pairs}
    for cname in names:
        c = ep["Construction"][cname]
        layers = [c["outside_layer"]] + [c[k] for k in sorted((k for k in c if k.startswith("layer_")), key=lambda k: int(k.split("_")[1]))]
        rev = {"outside_layer": layers[-1]}
        for j, l in enumerate(reversed(layers[:-1]), start=2):
            rev[f"layer_{j}"] = l
        ep["Construction"][f"{cname}_reversed"] = rev
    for _, s in pairs:
        s["construction_name"] = f"{s['construction_name']}_reversed"
    notes.append(f"slab_reversed: {len(pairs)} upper slab faces given the reversed construction (inside face {layers[0]})")


def inf_by_zone(ep: dict, notes: list) -> dict:
    S = ep["BuildingSurface:Detailed"]
    inf = ep["ZoneInfiltration:DesignFlowRate"]
    zones = sorted({s["zone_name"] for s in S.values()})
    env = {z: sum(area(s["vertices"]) for s in S.values() if s["zone_name"] == z and s["outside_boundary_condition"] in ("Outdoors", "Ground"))
           for z in zones}
    vol = {z: ep["Zone"][z].get("volume") for z in zones}
    if any(v in (None, "Autocalculate", "autocalculate") for v in vol.values()):
        # Equal storeys: each zone's volume is its floor area x storey height, the same for every zone.
        vol = {z: 1.0 for z in zones}
    rates = {o["zone_or_zonelist_or_space_or_spacelist_name"]: o["air_changes_per_hour"] for o in inf.values()}
    n0 = set(rates.values())
    if len(n0) != 1:
        raise SystemExit(f"inf_by_zone: expected one building rate, found {n0}")
    n0 = n0.pop()
    a_tot, v_tot = sum(env.values()), sum(vol.values())
    alloc = {}
    for o in inf.values():
        z = o["zone_or_zonelist_or_space_or_spacelist_name"]
        o["air_changes_per_hour"] = n0 * (env[z] / vol[z]) / (a_tot / v_tot)
        alloc[z] = {"envelope_m2": round(env[z], 3), "ach": round(o["air_changes_per_hour"], 6)}
    tot = sum(alloc[z]["ach"] * vol[z] for z in zones) / v_tot
    if abs(tot - n0) > 1e-5:
        raise SystemExit(f"inf_by_zone: volume-weighted rate {tot} != {n0}")
    notes.append(f"inf_by_zone: building rate {n0:.6f} ach shared by envelope area {json.dumps(alloc)}")
    return alloc


def per_zone(d: Path, ep: dict) -> dict:
    con = sqlite3.connect(d / "eplusout.sql")
    q = """select d.Name, d.KeyValue, t.Month, sum(r.Value) from ReportData r
             join ReportDataDictionary d on r.ReportDataDictionaryIndex = d.ReportDataDictionaryIndex
             join Time t on r.TimeIndex = t.TimeIndex
            where t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods)
              and d.ReportingFrequency = 'Hourly'
              and d.Name in ('Zone Ideal Loads Zone Sensible Heating Energy', 'Zone Ideal Loads Zone Sensible Cooling Energy')
            group by d.Name, d.KeyValue, t.Month"""
    out: dict = {}
    for name, key, month, val in con.execute(q):
        z = key.upper().replace("_IDEALLOADS", "").title().replace("Floor_", "Floor_")
        k = "heating_monthly_mwh" if "Heating" in name else "cooling_monthly_mwh"
        out.setdefault(z, {"heating_monthly_mwh": [0.0] * 12, "cooling_monthly_mwh": [0.0] * 12})[k][int(month) - 1] += val / MWH
    # Heat into each zone through its slab faces (inside-face conduction, EnergyPlus's sign: positive into the zone).
    surf = {n.upper(): v for n, v in ep["BuildingSurface:Detailed"].items()}
    q2 = """select d.KeyValue, sum(r.Value) from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
             join Time t using (TimeIndex) where d.Name = 'Surface Inside Face Conduction Heat Transfer Energy'
              and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) group by d.KeyValue"""
    slabs: dict = {}
    for key, val in con.execute(q2):
        sf = surf.get(key.upper())
        if sf and sf["outside_boundary_condition"] == "Surface":
            slabs[sf["zone_name"]] = slabs.get(sf["zone_name"], 0.0) + val / MWH
    con.close()
    for zn, v in slabs.items():
        out.setdefault(zn, {"heating_monthly_mwh": [0.0] * 12, "cooling_monthly_mwh": [0.0] * 12})["slab_inside_face_conduction_mwh"] = round(v, 4)
    for z in out.values():
        z["heating_mwh"] = round(sum(z["heating_monthly_mwh"]), 4)
        z["cooling_mwh"] = round(sum(z["cooling_monthly_mwh"]), 4)
        z["heating_monthly_mwh"] = [round(v, 4) for v in z["heating_monthly_mwh"]]
        z["cooling_monthly_mwh"] = [round(v, 4) for v in z["cooling_monthly_mwh"]]
    return dict(sorted(out.items()))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    ap.add_argument("--only", default=None)
    a = ap.parse_args()
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    today, psi, tg = R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW)
    root = Path(a.runs or tempfile.mkdtemp(prefix="104_zones_"))
    want = a.only.split(",") if a.only else list(RUNS)
    out = json.loads(OUT.read_text()) if OUT.exists() and a.only else {"runs": {}}
    for name in want:
        flags = RUNS[name]
        ep, notes = A.build_run([f for f in flags if f not in ("tb_by_zone", "inf_by_zone", "slab_reversed")], fx, today, psi, tg)
        if "slab_reversed" in flags:
            slab_reversed(ep, notes)
        if "tb_by_zone" in flags:
            tb_by_zone(ep, fx, psi, notes)
        if "inf_by_zone" in flags:
            inf_by_zone(ep, notes)
        res = R.run_ep(a.energyplus, ep, root / name)
        s = R.summarise(res, ep)
        out["runs"][name] = {"flags": flags, "notes": notes, "heating_mwh": s["heating_mwh"], "cooling_mwh": s["cooling_mwh"],
                             "heating_monthly_mwh": s["heating_monthly_mwh"], "cooling_monthly_mwh": s["cooling_monthly_mwh"],
                             "zones": per_zone(root / name, ep), "severe": s["severe"], "warnings": res["warnings"]}
        out["energyplus_version"] = res["version"]
        print(f"{name:12s} heat {s['heating_mwh']:8.3f}  cool {s['cooling_mwh']:7.3f}  severe {s['severe']}  "
              + " ".join(f"{z}:{v['heating_mwh']:.2f}/{v['cooling_mwh']:.2f}" for z, v in out["runs"][name]["zones"].items()), flush=True)
    out["source"] = "validation/energyplus/104_zones_referee.py"
    out["epw_sha256"] = R.EPW_SHA
    OUT.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
