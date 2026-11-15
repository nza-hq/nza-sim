#!/usr/bin/env python3
"""
Brief 108 review F1: the cooled room with its heated rooms heated by hot-water radiators on a 50 C plant loop.

The 'iso_conv' model of 104_cooled_room.py (as 108_radiant_referee.py), with each heated room's ideal loads replaced by
ZoneHVAC:Baseboard:RadiantConvective:Water, all convective, on a plant loop held at the spec's flow temperature
(DistrictHeating:Water, adiabatic pipes, a pump that adds no heat). At its maximum water flow the baseboard's output
follows the room: effectiveness-NTU at a fixed UA gives output = k x (water inlet - zone air). The rating inputs are
chosen, by EnergyPlus's documented sizing (Engineering Reference 15.4.3.3, eqs 15.724-15.731 and 15.719), so that k is
the spec's design output over (flow - setpoint), which is what Engine 2's EN 442 radiator at exponent 1 and constant
flow gives. The referee then measures the k and the maximum water flow EnergyPlus actually ran with.

Usage: python3 -I validation/energyplus/108_hotwater_referee.py --energyplus <path> [--runs <dir>]
Writes docs/audit/108/09_hotwater_energyplus.json. Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
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


C = load("cooled", "104_cooled_room.py")
R = load("radiant", "108_radiant_referee.py")
HW = json.loads((HERE / "108_hotwater_spec.json").read_text())
TOL = 0.5
OUT = REPO / "docs/audit/108/09_hotwater_energyplus.json"
CP_W = 4180.0     # J/kgK, water near 45 C (EnergyPlus's water property table gives 4180 within 0.1 %)
CP_A = 1004.84    # J/kgK, dry air (EnergyPlus PsyCpAirFnW at zero humidity)
RHO_HW = 983.2    # kg/m3, water at 60 C: the density EnergyPlus turns a hot-water maximum volume flow into mass flow with
T_AVG = None      # rated average water temperature: the mean of the design flow and return


def ep_k(q_std: float, m: float, t_avg: float) -> float:
    """EnergyPlus's output per kelvin of (water inlet - air inlet) at water flow m, for a rated capacity q_std."""
    ma = 0.0062 + 0.0000275 * q_std                                   # eq 15.726
    tw_in = q_std / (2 * m * CP_W) + t_avg; tw_out = 2 * t_avg - tw_in  # eqs 15.724-5
    ta_out = q_std / (ma * CP_A) + 18.0                               # eq 15.727
    d1, d2 = tw_in - ta_out, tw_out - 18.0
    if d1 <= 0 or d2 <= 0:
        return math.nan
    ua = q_std / ((d1 - d2) / math.log(d1 / d2))                      # eqs 15.728-31
    cw, ca = m * CP_W, ma * CP_A
    cmin, cmax = min(cw, ca), max(cw, ca)
    cr, ntu = cmin / cmax, ua / cmin
    eps = 1 - math.exp((ntu ** 0.22 / cr) * (math.exp(-cr * ntu ** 0.78) - 1))  # eq 15.719
    return eps * cmin


def rating(design_w: float) -> dict:
    """The baseboard's rating inputs for an emitter giving design_w at the spec's flow, return and setpoint."""
    f, r, room = HW["flow_c"], HW["return_c"], HW["rated_room_c"]
    m = design_w / (CP_W * (f - r))           # the design water flow, held at the cap
    target = design_w / (f - room)            # Engine 2's k at exponent 1, constant flow
    t_avg = 0.5 * (f + r)
    lo, hi = 0.2 * design_w, 5 * design_w
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        k = ep_k(mid, m, t_avg)
        if math.isnan(k) or k > target:
            hi = mid
        else:
            lo = mid
    q = 0.5 * (lo + hi)
    return {"rated_capacity_w": q, "rated_average_water_c": t_avg, "water_kg_s": m, "k_target_w_per_k": target, "k_predicted_w_per_k": ep_k(q, m, t_avg)}


def model(caps: dict) -> tuple[dict, dict]:
    ep = C.model(frozenset({"iso_conv"}))
    S, W = ep["BuildingSurface:Detailed"], ep["FenestrationSurface:Detailed"]
    f = HW["flow_c"]
    ratings = {z: rating(float(cap)) for z, cap in caps.items()}
    bb, dsg = "ZoneHVAC:Baseboard:RadiantConvective:Water", "ZoneHVAC:Baseboard:RadiantConvective:Water:Design"
    ep[bb] = {}
    ep[dsg] = {"bb_design": {"heating_design_capacity_method": "HeatingDesignCapacity", "convergence_tolerance": 0.001,
                             "fraction_radiant": HW["radiant_fraction"], "fraction_of_radiant_energy_incident_on_people": 0.0}}
    for z in caps:
        del ep["ZoneHVAC:IdealLoadsAirSystem"][f"{z}_ideal"]
        wins = {n: R.area(o) for n, o in W.items() if S[o["building_surface_name"]]["zone_name"] == z}
        net = {n: R.area(o) - sum(a for wn, a in wins.items() if W[wn]["building_surface_name"] == n) for n, o in S.items() if o["zone_name"] == z}
        surf = {**net, **wins}; tot = sum(surf.values())
        g = ratings[z]
        ep[bb][f"{z}_bb"] = {"design_object": "bb_design", "inlet_node_name": f"{z}_bb_in", "outlet_node_name": f"{z}_bb_out",
                             "rated_average_water_temperature": g["rated_average_water_c"], "rated_water_mass_flow_rate": g["water_kg_s"],
                             "heating_design_capacity": g["rated_capacity_w"], "maximum_water_flow_rate": g["water_kg_s"] / RHO_HW,
                             "surface_fractions": [{"surface_name": n, "fraction_of_radiant_energy_to_surface": a / tot} for n, a in surf.items()]}
        ep["ZoneHVAC:EquipmentList"][f"{z}_eq"]["equipment"] = [{
            "zone_equipment_object_type": bb, "zone_equipment_name": f"{z}_bb",
            "zone_equipment_cooling_sequence": 1, "zone_equipment_heating_or_no_load_sequence": 1}]
        conn = ep["ZoneHVAC:EquipmentConnections"][f"{z}_conn"]
        conn.pop("zone_air_inlet_node_or_nodelist_name", None); conn.pop("zone_return_air_node_or_nodelist_name", None)

    # The plant loop: flow temperature held at the supply outlet; pipes adiabatic; the pump adds no heat to the water.
    vmax = 1.5 * sum(g["water_kg_s"] for g in ratings.values()) / RHO_HW
    pipe = lambda n: {"inlet_node_name": f"{n}_in", "outlet_node_name": f"{n}_out"}
    comp = lambda t, n, i, o: {"component_object_type": t, "component_name": n, "component_inlet_node_name": i, "component_outlet_node_name": o}
    ep["Schedule:Constant"]["hw_flow_c"] = {"schedule_type_limits_name": "Any", "hourly_value": f}
    ep["Pipe:Adiabatic"] = {n: pipe(n) for n in ("hw_sup_bypass", "hw_sup_exit", "hw_dem_entry", "hw_dem_bypass", "hw_dem_exit")}
    ep["Pump:VariableSpeed"] = {"hw_pump": {"inlet_node_name": "hw_sup_in", "outlet_node_name": "hw_pump_out", "design_maximum_flow_rate": vmax,
                                            "design_pump_head": 1.0, "design_power_consumption": 0.0, "motor_efficiency": 0.9,
                                            "fraction_of_motor_inefficiencies_to_fluid_stream": 0.0, "pump_control_type": "Intermittent"}}
    ep["DistrictHeating:Water"] = {"hw_source": {"hot_water_inlet_node_name": "hw_src_in", "hot_water_outlet_node_name": "hw_src_out", "nominal_capacity": 1.0e6}}
    ep["Branch"] = {
        "hw_sup_inlet": {"components": [comp("Pump:VariableSpeed", "hw_pump", "hw_sup_in", "hw_pump_out")]},
        "hw_sup_source": {"components": [comp("DistrictHeating:Water", "hw_source", "hw_src_in", "hw_src_out")]},
        "hw_sup_bypass": {"components": [comp("Pipe:Adiabatic", "hw_sup_bypass", "hw_sup_bypass_in", "hw_sup_bypass_out")]},
        "hw_sup_exit": {"components": [comp("Pipe:Adiabatic", "hw_sup_exit", "hw_sup_exit_in", "hw_sup_out")]},
        "hw_dem_entry": {"components": [comp("Pipe:Adiabatic", "hw_dem_entry", "hw_dem_in", "hw_dem_entry_out")]},
        "hw_dem_bypass": {"components": [comp("Pipe:Adiabatic", "hw_dem_bypass", "hw_dem_bypass_in", "hw_dem_bypass_out")]},
        "hw_dem_exit": {"components": [comp("Pipe:Adiabatic", "hw_dem_exit", "hw_dem_exit_in", "hw_dem_out")]},
        **{f"hw_{z}": {"components": [comp(bb, f"{z}_bb", f"{z}_bb_in", f"{z}_bb_out")]} for z in caps},
    }
    ep["Pipe:Adiabatic"]["hw_sup_exit"]["outlet_node_name"] = "hw_sup_out"
    ep["Pipe:Adiabatic"]["hw_dem_entry"]["inlet_node_name"] = "hw_dem_in"
    ep["Pipe:Adiabatic"]["hw_dem_exit"]["outlet_node_name"] = "hw_dem_out"
    for n in ("hw_sup_bypass", "hw_dem_bypass"):
        ep["Pipe:Adiabatic"][n] = {"inlet_node_name": f"{n}_in", "outlet_node_name": f"{n}_out"}
    ep["Pipe:Adiabatic"]["hw_sup_exit"]["inlet_node_name"] = "hw_sup_exit_in"
    ep["Pipe:Adiabatic"]["hw_dem_entry"]["outlet_node_name"] = "hw_dem_entry_out"
    ep["Pipe:Adiabatic"]["hw_dem_exit"]["inlet_node_name"] = "hw_dem_exit_in"
    dem = [f"hw_{z}" for z in caps] + ["hw_dem_bypass"]
    ep["BranchList"] = {"hw_sup_branches": {"branches": [{"branch_name": b} for b in ("hw_sup_inlet", "hw_sup_source", "hw_sup_bypass", "hw_sup_exit")]},
                        "hw_dem_branches": {"branches": [{"branch_name": b} for b in ["hw_dem_entry", *dem, "hw_dem_exit"]]}}
    ep["Connector:Splitter"] = {"hw_sup_split": {"inlet_branch_name": "hw_sup_inlet", "branches": [{"outlet_branch_name": b} for b in ("hw_sup_source", "hw_sup_bypass")]},
                                "hw_dem_split": {"inlet_branch_name": "hw_dem_entry", "branches": [{"outlet_branch_name": b} for b in dem]}}
    ep["Connector:Mixer"] = {"hw_sup_mix": {"outlet_branch_name": "hw_sup_exit", "branches": [{"inlet_branch_name": b} for b in ("hw_sup_source", "hw_sup_bypass")]},
                             "hw_dem_mix": {"outlet_branch_name": "hw_dem_exit", "branches": [{"inlet_branch_name": b} for b in dem]}}
    ep["ConnectorList"] = {"hw_sup_conn": {"connector_1_object_type": "Connector:Splitter", "connector_1_name": "hw_sup_split", "connector_2_object_type": "Connector:Mixer", "connector_2_name": "hw_sup_mix"},
                           "hw_dem_conn": {"connector_1_object_type": "Connector:Splitter", "connector_1_name": "hw_dem_split", "connector_2_object_type": "Connector:Mixer", "connector_2_name": "hw_dem_mix"}}
    ep["PlantEquipmentList"] = {"hw_equipment": {"equipment": [{"equipment_object_type": "DistrictHeating:Water", "equipment_name": "hw_source"}]}}
    ep["PlantEquipmentOperation:HeatingLoad"] = {"hw_heating": {"load_range_1_lower_limit": 0.0, "load_range_1_upper_limit": 1.0e9, "range_1_equipment_list_name": "hw_equipment"}}
    ep["PlantEquipmentOperationSchemes"] = {"hw_schemes": {"control_scheme_1_object_type": "PlantEquipmentOperation:HeatingLoad", "control_scheme_1_name": "hw_heating", "control_scheme_1_schedule_name": "one"}}
    ep["SetpointManager:Scheduled"] = {"hw_flow": {"control_variable": "Temperature", "schedule_name": "hw_flow_c", "setpoint_node_or_nodelist_name": "hw_sup_out"}}
    ep["PlantLoop"] = {"hw_loop": {"fluid_type": "Water", "plant_equipment_operation_scheme_name": "hw_schemes", "loop_temperature_setpoint_node_name": "hw_sup_out",
                                   "maximum_loop_temperature": 100.0, "minimum_loop_temperature": 5.0, "maximum_loop_flow_rate": vmax, "minimum_loop_flow_rate": 0.0,
                                   "plant_side_inlet_node_name": "hw_sup_in", "plant_side_outlet_node_name": "hw_sup_out", "plant_side_branch_list_name": "hw_sup_branches",
                                   "plant_side_connector_list_name": "hw_sup_conn", "demand_side_inlet_node_name": "hw_dem_in", "demand_side_outlet_node_name": "hw_dem_out",
                                   "demand_side_branch_list_name": "hw_dem_branches", "demand_side_connector_list_name": "hw_dem_conn", "load_distribution_scheme": "SequentialLoad"}}
    for i, v in enumerate(("Baseboard Total Heating Energy", "Baseboard Water Inlet Temperature", "Baseboard Water Outlet Temperature",
                           "Baseboard Total Heating Rate")):
        ep["Output:Variable"][f"hw{i}"] = {"key_value": "*", "variable_name": v, "reporting_frequency": "Timestep"}
    for z in caps:
        ep["Output:Variable"][f"hw_{z}_m"] = {"key_value": f"{z}_bb_in", "variable_name": "System Node Mass Flow Rate", "reporting_frequency": "Timestep"}
    ep["Output:Variable"]["hw_zt"] = {"key_value": "*", "variable_name": "Zone Mean Air Temperature", "reporting_frequency": "Timestep"}
    return ep, ratings


def run(energyplus: str, ep: dict, ratings: dict, epw: Path, d: Path) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    (d / "in.epJSON").write_text(json.dumps(ep, indent=1))
    p = subprocess.run([energyplus, "-w", str(epw), "-d", str(d), str(d / "in.epJSON")], capture_output=True, text=True)
    err = (d / "eplusout.err").read_text(errors="replace")
    if p.returncode != 0 or re.findall(r"\*\* Severe  \*\*", err):
        raise SystemExit(f"EnergyPlus failed in {d}\n{err[-4000:]}")
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name, key, freq):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency = ? and t.EnvironmentPeriodIndex =
            (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key, freq))]
    out = {"warnings": len(re.findall(r"\*\* Warning \*\*", err)), "zones": {}}
    for r in C.SPEC["rooms"]:
        if r["heat_c"] is None:
            continue
        z, g = r["id"], ratings[r["id"]]
        heat = series("Baseboard Total Heating Energy", f"{z}_bb", "Zone Timestep")
        rate = series("Baseboard Total Heating Rate", f"{z}_bb", "Zone Timestep")
        mdot = series("System Node Mass Flow Rate", f"{z}_bb_in", "Zone Timestep")
        tin = series("Baseboard Water Inlet Temperature", f"{z}_bb", "Zone Timestep")
        tz = series("Zone Mean Air Temperature", z, "Zone Timestep")
        n = len(tz) // 8760
        hourly = [sum(tz[i * n:(i + 1) * n]) / n for i in range(8760)]
        full = [i for i, m in enumerate(mdot) if m >= 0.999 * g["water_kg_s"]]
        # k at full flow: output over (water inlet - zone air). The zone air of the step stands in for the baseboard's
        # inlet air, which EnergyPlus takes from the zone air node during its iteration.
        ks = sorted(rate[i] / (tin[i] - tz[i]) for i in full if tin[i] - tz[i] > 1)
        out["zones"][z] = {
            "heat_mwh": sum(heat) / 3.6e9, "unmet_hours": sum(1 for t in hourly if t < r["heat_c"] - TOL), "min_c": min(hourly),
            "peak_heating_w": max(rate), "max_water_kg_s": max(mdot), "water_inlet_c_range": [min(t for t, m in zip(tin, mdot) if m > 0), max(tin)],
            "full_flow_steps": len(full), "k_measured_median_w_per_k": ks[len(ks) // 2] if ks else None,
            "k_measured_range_w_per_k": [ks[0], ks[-1]] if ks else None, "rating": g}
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
    runs = Path(a.runs or tempfile.mkdtemp(prefix="108_hotwater_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    sha = lambda f: hashlib.sha256((HERE / f).read_bytes()).hexdigest()
    res = {"source": "validation/energyplus/108_hotwater_referee.py", "spec_sha256": sha("104_cooled_room_spec.json"),
           "hotwater_spec_sha256": sha("108_hotwater_spec.json"), "weather_mos_sha256": B.MOS_SHA, "runs": {}}
    for name, caps in HW["cases"].items():
        ep, ratings = model(caps)
        r = run(a.energyplus, ep, ratings, epw, runs / name)
        res["runs"][name] = r
        print(name, json.dumps({z: {k: (round(v, 4) if isinstance(v, float) else v) for k, v in d.items() if k != "rating"} for z, d in r["zones"].items()}), "warnings", r["warnings"])
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
