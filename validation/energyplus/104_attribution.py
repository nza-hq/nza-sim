#!/usr/bin/env python3
"""
Brief 104 Part 1: attribute Engine 1's Bridgewater cooling miss with one-change EnergyPlus runs.

Every run is the Brief 103 Part 5 referee (r0, validation/energyplus/103_referee.py, unchanged) with exactly the
changes its flags name, applied to the epJSON dict r0's build() returns. Nothing in nza_engine/ changes.

Flags (each is one of Engine 1's modelling choices, put into EnergyPlus):
  one_zone     the five floor zones become one zone (Floor_1 keeps its IdealLoads, thermostat, infiltration in ACH and
               vents x 5; its volume is the five zones'). The four slabs stay as surface pairs, now both faces in the
               one zone: same mass, same beam on the slab tops, one air node.
  no_slab      the four slab surface pairs are deleted (with one_zone: Engine 1's one-zone building, in EnergyPlus).
  airmass      Engine 1's internal capacity on the air node: 250 kJ/m2K x total floor area (ZoneCapacitanceMultiplier).
  sky_fixed    the sky at dry bulb - 11 K (WeatherProperty:SkyTemperature), Engine 1's delta_theta_sky.
  lw_area      inside long-wave by area-weighted view factors F_ij = A_j / A_zone (Engine 1's star network, ISO 52016-1
               eq. 30), through ZoneProperty:UserViewFactors:BySurfaceName.
  ts_1         one time step per hour (Engine 1's step).
  iso_conv     h_ce 20 on every outside face; h_ci by tilt from the zone: walls and windows 2.5, ceilings and roofs
               5.0, floors 0.7 (ISO 52016-1 Table 25, Engine 1's default).
  fullint      solar distribution FullInteriorAndExterior (the referee uses FullExterior; Part 0).

Usage: python3 -I validation/energyplus/104_attribution.py --energyplus <path> [--runs <dir>] [--only a,b]
Writes docs/audit/104/01_attribution.json. Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
spec = importlib.util.spec_from_file_location("referee", HERE / "103_referee.py")
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)  # type: ignore[union-attr]
OUT = REPO / "docs/audit/104/01_attribution.json"

ZONES = ["Floor_1", "Floor_2", "Floor_3", "Floor_4", "Floor_5"]
KEEP = "Floor_1"
FLOOR_A = None  # set from the model


def zone_refs(o: dict) -> set:
    return {v for v in o.values() if isinstance(v, str) and v in ZONES}


def to_one_zone(ep: dict, notes: list) -> None:
    surf = ep["BuildingSurface:Detailed"]
    for s in surf.values():
        s["zone_name"] = KEEP
    # Every other per-zone object (HVAC, thermostat, infiltration, vents) belonging to Floor_2..5 is removed.
    removed = 0
    for t in ("ZoneHVAC:IdealLoadsAirSystem", "ZoneHVAC:EquipmentList", "ZoneHVAC:EquipmentConnections",
              "ZoneControl:Thermostat", "ZoneInfiltration:DesignFlowRate", "ZoneVentilation:DesignFlowRate"):
        for n in list(ep.get(t, {})):
            o = ep[t][n]
            if any(z != KEEP and (n.startswith(z) or z in zone_refs(o)) for z in ZONES):
                del ep[t][n]
                removed += 1
    for z in ZONES[1:]:
        del ep["Zone"][z]
    a = sum(R.poly_area(s) for s in surf.values() if s["surface_type"] == "Floor" and s["outside_boundary_condition"] == "Ground")
    global FLOOR_A
    FLOOR_A = a
    zone = ep["Zone"][KEEP]
    zone["volume"] = 5 * a * 3.2
    zone["floor_area"] = 5 * a
    zone["ceiling_height"] = 5 * 3.2
    # Infiltration is in air changes per hour, so the merged volume carries the total. Vents are flow per zone: x 5.
    vents = ep["ZoneVentilation:DesignFlowRate"]
    assert len(vents) == 1, vents
    for v in vents.values():
        v["design_flow_rate"] = v["design_flow_rate"] * 5
    notes.append(f"one_zone: {removed} per-zone objects of Floor_2..5 removed; volume {zone['volume']:.1f} m3; vents x5")


def drop_slabs(ep: dict, notes: list) -> None:
    surf = ep["BuildingSurface:Detailed"]
    slabs = [n for n, s in surf.items() if s["outside_boundary_condition"] == "Surface"]
    for n in slabs:
        del surf[n]
    notes.append(f"no_slab: {len(slabs)} slab surfaces deleted")


def airmass(ep: dict, today: dict, notes: list) -> None:
    rho_c = 1.2041 * 1005.0
    zones = list(ep["Zone"])
    a_floor = FLOOR_A or sum(R.poly_area(s) for s in ep["BuildingSurface:Detailed"].values()
                             if s["surface_type"] == "Floor" and s["outside_boundary_condition"] == "Ground")
    # Per zone: the zone's own floor area (one zone: 5 x a; five zones: a each) and its own volume.
    per_zone_floor = 5 * a_floor if len(zones) == 1 else a_floor
    v = per_zone_floor * 3.2
    m = (rho_c * v + today["internal_heat_capacity_j_per_k_m2"] * per_zone_floor) / (rho_c * v)
    ep["ZoneCapacitanceMultiplier:ResearchSpecial"] = {"airmass": {
        "temperature_capacity_multiplier": round(m, 4), "humidity_capacity_multiplier": 1.0,
        "carbon_dioxide_capacity_multiplier": 1.0, "generic_contaminant_capacity_multiplier": 1.0}}
    notes.append(f"airmass: capacitance multiplier {m:.4f} on every zone")


def sky_fixed(ep: dict, notes: list) -> None:
    ep.setdefault("Schedule:Constant", {})["sky_dt"] = {"hourly_value": 11.0}
    # The object's name is the environment it applies to: the run period (warm-up included).
    rp = next(iter(ep["RunPeriod"]))
    ep["WeatherProperty:SkyTemperature"] = {rp: {"calculation_type": "DifferenceScheduleDryBulbValue",
                                                    "schedule_name": "sky_dt"}}
    ep["Output:Variable"]["sky_check"] = {"key_value": "*", "variable_name": "Site Sky Temperature", "reporting_frequency": "Hourly"}
    ep["Output:Variable"]["db_check"] = {"key_value": "*", "variable_name": "Site Outdoor Air Drybulb Temperature", "reporting_frequency": "Hourly"}
    notes.append("sky_fixed: sky temperature = dry bulb - 11 K")


def lw_area(ep: dict, notes: list) -> None:
    surf = ep["BuildingSurface:Detailed"]
    win = ep["FenestrationSurface:Detailed"]
    by_zone: dict = {}
    for n, s in surf.items():
        by_zone.setdefault(s["zone_name"], []).append((n, R.poly_area(s) - sum(R.poly_area(w) for w in win.values() if w["building_surface_name"] == n)))
    for n, w in win.items():
        by_zone[surf[w["building_surface_name"]]["zone_name"]].append((n, R.poly_area(w)))
    obj = {}
    for z, items in by_zone.items():
        tot = sum(a for _, a in items)
        obj[f"vf_{z}"] = {"zone_or_zonelist_or_space_or_spacelist_name": z, "view_factors": [
            {"from_surface": i, "to_surface": j, "view_factor": aj / tot} for i, _ in items for j, aj in items]}
    ep["ZoneProperty:UserViewFactors:BySurfaceName"] = obj
    notes.append(f"lw_area: view factors A_j / A_zone in {len(obj)} zone(s)")


def ts_1(ep: dict, notes: list) -> None:
    ep["Timestep"] = {"Timestep 1": {"number_of_timesteps_per_hour": 1}}
    notes.append("ts_1: one time step per hour")


def iso_conv(ep: dict, notes: list) -> None:
    surf = ep["BuildingSurface:Detailed"]
    win = ep["FenestrationSurface:Detailed"]
    cc = {}
    for n, s in surf.items():
        t = s["surface_type"]
        hci = {"Wall": 2.5, "Roof": 5.0, "Ceiling": 5.0, "Floor": 0.7}[t]
        o = {"surface_name": n, "convection_coefficient_1_location": "Inside", "convection_coefficient_1_type": "Value",
             "convection_coefficient_1": hci}
        if s["outside_boundary_condition"] == "Outdoors":
            o.update({"convection_coefficient_2_location": "Outside", "convection_coefficient_2_type": "Value",
                      "convection_coefficient_2": 20.0})
        cc[f"c_{n}"] = o
    for n in win:
        cc[f"c_{n}"] = {"surface_name": n, "convection_coefficient_1_location": "Inside", "convection_coefficient_1_type": "Value",
                        "convection_coefficient_1": 2.5, "convection_coefficient_2_location": "Outside",
                        "convection_coefficient_2_type": "Value", "convection_coefficient_2": 20.0}
    ep["SurfaceProperty:ConvectionCoefficients"] = cc
    notes.append(f"iso_conv: fixed coefficients on {len(cc)} surfaces")


def fullint(ep: dict, notes: list) -> None:
    for b in ep["Building"].values():
        b["solar_distribution"] = "FullInteriorAndExterior"
    notes.append("fullint: FullInteriorAndExterior")


RUNS = {
    "r0": [],
    "one_zone": ["one_zone"],
    "one_zone_no_slab": ["one_zone", "no_slab"],
    "e1_building": ["one_zone", "no_slab", "airmass"],
    "sky_fixed": ["sky_fixed"],
    "lw_area": ["lw_area"],
    "ts_1": ["ts_1"],
    "iso_conv": ["iso_conv"],
    "fullint": ["fullint"],
    "e1_like": ["one_zone", "no_slab", "airmass", "sky_fixed", "lw_area", "ts_1", "iso_conv"],
    "e1_building_sky": ["one_zone", "no_slab", "airmass", "sky_fixed"],
    "e1_building_lw": ["one_zone", "no_slab", "airmass", "lw_area"],
    "e1_building_ts": ["one_zone", "no_slab", "airmass", "ts_1"],
    "e1_building_conv": ["one_zone", "no_slab", "airmass", "iso_conv"],
}


def build_run(flags: list, fx: dict, today: dict, psi: dict, tg: float) -> tuple[dict, list]:
    checks: list = []
    ep, _ = R.build(set(), fx, today, psi, tg, checks)
    notes: list = []
    order = ["one_zone", "no_slab", "airmass", "sky_fixed", "lw_area", "ts_1", "iso_conv", "fullint"]
    for f in order:
        if f not in flags:
            continue
        if f == "one_zone":
            to_one_zone(ep, notes)
        elif f == "no_slab":
            drop_slabs(ep, notes)
        elif f == "airmass":
            airmass(ep, today, notes)
        else:
            globals()[f](ep, notes)
    bad = [c for c in checks if not c[1]]
    if bad and "one_zone" not in flags:
        raise SystemExit(f"referee build checks failed: {bad}")
    return ep, notes


BESTEST = {
    # The 103 twin's base (FullInteriorAndExterior), then Engine 1's simplifications one at a time and together.
    "900": [],
    "900_iso3": ["hce20", "hci_iso", "simple_window"],
    "900_iso3_sky": ["hce20", "hci_iso", "simple_window", "sky_fixed"],
    "900_iso3_lw": ["hce20", "hci_iso", "simple_window", "lw_area"],
    "900_iso3_ts": ["hce20", "hci_iso", "simple_window", "ts_1"],
    "900_e1_like": ["hce20", "hci_iso", "simple_window", "sky_fixed", "lw_area", "ts_1"],
    "600": [],
    "600_e1_like": ["hce20", "hci_iso", "simple_window", "sky_fixed", "lw_area", "ts_1"],
}


def bestest(energyplus: str, root: Path) -> dict:
    spec2 = importlib.util.spec_from_file_location("twin", HERE / "103_bestest_twin.py")
    T = importlib.util.module_from_spec(spec2)
    spec2.loader.exec_module(T)  # type: ignore[union-attr]
    root.mkdir(parents=True, exist_ok=True)
    epw = root / "Denver_725650_from_mos.epw"
    T.mos_to_epw(T.MOS, epw)
    out = {}
    for name, flags in BESTEST.items():
        case = name.split("_")[0]
        ep = T.model(case, False, frozenset(f for f in flags if f in ("hce20", "hci_iso", "simple_window")))
        notes: list = []
        for f in ("sky_fixed", "lw_area", "ts_1"):
            if f in flags:
                globals()[f](ep, notes)
        r = T.run(energyplus, ep, epw, root / f"bestest_{name}")
        out[name] = {"flags": flags, "notes": notes, "heating_mwh": round(r["heat_mwh"], 3), "cooling_mwh": round(r["cool_mwh"], 3),
                     "peak_heating_kw": round(r["peak_heat_kw"], 3), "peak_cooling_kw": round(r["peak_cool_kw"], 3)}
        print(f"BESTEST {name:16s} heat {r['heat_mwh']:.3f}  cool {r['cool_mwh']:.3f}", flush=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--bestest", action="store_true", help="run only the BESTEST set and merge it into the JSON")
    a = ap.parse_args()
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    today, psi, tg = R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW)
    root = Path(a.runs or tempfile.mkdtemp(prefix="104_attr_"))
    want = a.only.split(",") if a.only else list(RUNS)
    out = json.loads(OUT.read_text()) if OUT.exists() and (a.only or a.bestest) else {"runs": {}}
    if a.bestest:
        out["bestest"] = bestest(a.energyplus, root)
        want = []
    for name in want:
        ep, notes = build_run(RUNS[name], fx, today, psi, tg)
        res = R.run_ep(a.energyplus, ep, root / name)
        s = R.summarise(res, ep)
        out["runs"][name] = {"flags": RUNS[name], "notes": notes, "heating_mwh": s["heating_mwh"], "cooling_mwh": s["cooling_mwh"],
                             "heating_monthly_mwh": s["heating_monthly_mwh"], "cooling_monthly_mwh": s["cooling_monthly_mwh"],
                             "severe": s["severe"], "warnings": res["warnings"]}
        out["energyplus_version"] = res["version"]
        print(f"{name:20s} heat {s['heating_mwh']:8.3f}  cool {s['cooling_mwh']:7.3f}  severe {s['severe']}  warn {res['warnings']}", flush=True)
    out["source"] = "validation/energyplus/104_attribution.py"
    out["epw_sha256"] = R.EPW_SHA
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
