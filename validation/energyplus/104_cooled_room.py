#!/usr/bin/env python3
"""
Brief 104 Part 4 (e): the cooled room in EnergyPlus.

Three rooms in a row (validation/energyplus/104_cooled_room_spec.json, the inputs Engine 2's test reads too): the
outer two heated at 20 C, the middle one cooled at 24 C, joined by two block partitions. Denver TMY3 weather, the
committed .mos turned into an EPW exactly as 103_bestest_twin.py does. The floor's outside face is exposed to outdoor
air with no sun and no wind, as in BESTEST and in Engine 2's document. Windows are WindowMaterial:SimpleGlazingSystem
with the spec's U and SHGC (Engine 2 reads the same two numbers through the same Simple Window Model).

Two runs:
  base      EnergyPlus's own surface convection (DOE-2 outside, TARP inside) and 4 time steps an hour.
  iso_conv  outside convection fixed at ISO 52016-1's 20 W/m2K, inside by tilt (walls, windows and partitions 2.5,
            roof 5.0, floor 0.7), Engine 2's default surface coefficients, everything else as base.

Usage: python3 -I validation/energyplus/104_cooled_room.py --energyplus <path> [--runs <dir>]
Writes docs/audit/104/04_cooled_room_energyplus.json. Nothing touches data/ or a database.
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
spec_ = importlib.util.spec_from_file_location("bestest", HERE / "103_bestest_twin.py")
B = importlib.util.module_from_spec(spec_)
spec_.loader.exec_module(B)  # type: ignore[union-attr]
SPEC = json.loads((HERE / "104_cooled_room_spec.json").read_text())
OUT = REPO / "docs/audit/104/04_cooled_room_energyplus.json"


def layers(ep: dict, cname: str) -> None:
    names = []
    for j, (d, k, cp, rho) in enumerate(SPEC["constructions"][cname]):
        nm = f"{cname}_{j}"
        t, _, o = B.mat(nm, d, k, cp, rho)
        o["solar_absorptance"] = SPEC["solar_absorptance"]
        o["thermal_absorptance"] = SPEC["thermal_emissivity"]
        ep[t][nm] = o
        names.append(nm)
    c = {"outside_layer": names[0]}
    for j, n in enumerate(names[1:], start=2):
        c[f"layer_{j}"] = n
    ep["Construction"][cname] = c


def model(flags: frozenset) -> dict:
    D, Hh = SPEC["depth_m"], SPEC["height_m"]
    ep: dict = {
        "Version": {"Version 1": {"version_identifier": "25.2"}},
        "SimulationControl": {"SimulationControl 1": {"do_zone_sizing_calculation": "No", "do_system_sizing_calculation": "No",
                              "do_plant_sizing_calculation": "No", "run_simulation_for_sizing_periods": "No",
                              "run_simulation_for_weather_file_run_periods": "Yes"}},
        "Building": {"CooledRoom": {"north_axis": 0, "terrain": "Country", "solar_distribution": "FullInteriorAndExterior",
                     "maximum_number_of_warmup_days": 50, "minimum_number_of_warmup_days": 6,
                     "loads_convergence_tolerance_value": 0.04, "temperature_convergence_tolerance_value": 0.4}},
        "Timestep": {"Timestep 1": {"number_of_timesteps_per_hour": 4}},
        "RunPeriod": {"Year": {"begin_month": 1, "begin_day_of_month": 1, "end_month": 12, "end_day_of_month": 31,
                      "day_of_week_for_start_day": "Monday"}},
        "Site:Location": {"Denver": {"latitude": 39.83, "longitude": -104.65, "time_zone": -7.0, "elevation": 1650.0}},
        "GlobalGeometryRules": {"GlobalGeometryRules 1": {"starting_vertex_position": "UpperLeftCorner",
                                "vertex_entry_direction": "Counterclockwise", "coordinate_system": "Relative"}},
        "Zone": {}, "Material": {}, "Material:NoMass": {}, "Construction": {},
        "WindowMaterial:SimpleGlazingSystem": {"win": {"u_factor": SPEC["window"]["u_w_per_m2k"],
                                               "solar_heat_gain_coefficient": SPEC["window"]["shgc"], "visible_transmittance": 0.7}},
        "ScheduleTypeLimits": {"Any": {}},
        "Schedule:Constant": {"one": {"schedule_type_limits_name": "Any", "hourly_value": 1.0}},
        "ZoneInfiltration:DesignFlowRate": {},
        "ThermostatSetpoint:SingleHeating": {}, "ThermostatSetpoint:SingleCooling": {}, "ZoneControl:Thermostat": {},
        "ZoneHVAC:IdealLoadsAirSystem": {}, "ZoneHVAC:EquipmentList": {}, "ZoneHVAC:EquipmentConnections": {},
        "Output:Variable": {
            "v1": {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Heating Energy", "reporting_frequency": "Hourly"},
            "v2": {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Cooling Energy", "reporting_frequency": "Hourly"},
            "v3": {"key_value": "*", "variable_name": "Zone Mean Air Temperature", "reporting_frequency": "Hourly"},
            "v4": {"key_value": "*", "variable_name": "Surface Window Transmitted Solar Radiation Energy", "reporting_frequency": "Hourly"},
            "v5": {"key_value": "*", "variable_name": "Surface Inside Face Conduction Heat Transfer Energy", "reporting_frequency": "Hourly"},
        },
        "Output:SQLite": {"Output:SQLite 1": {"option_type": "Simple"}},
    }
    for c in ("wall", "roof", "floor", "partition"):
        layers(ep, c)
    ep["Construction"]["window"] = {"outside_layer": "win"}
    S, W, hci = {}, {}, {}

    def surf(name, zone, typ, cons, pts, boundary="Outdoors", other=None, sun="SunExposed", wind="WindExposed", h_in=2.5):
        o = {"surface_type": typ, "construction_name": cons, "zone_name": zone, "outside_boundary_condition": boundary,
             "sun_exposure": sun, "wind_exposure": wind, "vertices": B.verts(pts)}
        if other:
            o["outside_boundary_condition_object"] = other
        S[name] = o
        hci[name] = h_in

    rooms = SPEC["rooms"]
    for i, r in enumerate(rooms):
        z, x0, x1 = r["id"], r["x0"], r["x1"]
        ep["Zone"][z] = {}
        surf(f"{z}_south", z, "Wall", "wall", [(x0, 0, Hh), (x0, 0, 0), (x1, 0, 0), (x1, 0, Hh)])
        surf(f"{z}_north", z, "Wall", "wall", [(x1, D, Hh), (x1, D, 0), (x0, D, 0), (x0, D, Hh)])
        surf(f"{z}_roof", z, "Roof", "roof", [(x0, D, Hh), (x0, 0, Hh), (x1, 0, Hh), (x1, D, Hh)], h_in=5.0)
        surf(f"{z}_floor", z, "Floor", "floor", [(x1, D, 0), (x1, 0, 0), (x0, 0, 0), (x0, D, 0)], sun="NoSun", wind="NoWind", h_in=0.7)
        if i == 0:
            surf(f"{z}_west", z, "Wall", "wall", [(x0, D, Hh), (x0, D, 0), (x0, 0, 0), (x0, 0, Hh)])
        else:
            surf(f"{z}_to_{rooms[i - 1]['id']}", z, "Wall", "partition", [(x0, D, Hh), (x0, D, 0), (x0, 0, 0), (x0, 0, Hh)],
                 boundary="Surface", other=f"{rooms[i - 1]['id']}_to_{z}", sun="NoSun", wind="NoWind")
        if i == len(rooms) - 1:
            surf(f"{z}_east", z, "Wall", "wall", [(x1, 0, Hh), (x1, 0, 0), (x1, D, 0), (x1, D, Hh)])
        else:
            surf(f"{z}_to_{rooms[i + 1]['id']}", z, "Wall", "partition", [(x1, 0, Hh), (x1, 0, 0), (x1, D, 0), (x1, D, Hh)],
                 boundary="Surface", other=f"{rooms[i + 1]['id']}_to_{z}", sun="NoSun", wind="NoWind")
        wx = r["window_width_m"]
        cx = (x0 + x1) / 2
        a, b = cx - wx / 2, cx + wx / 2
        top = SPEC["window"]["sill_m"] + SPEC["window"]["height_m"]
        W[f"{z}_window"] = {"surface_type": "Window", "construction_name": "window", "building_surface_name": f"{z}_south", "number_of_vertices": 4,
                            "vertex_1_x_coordinate": a, "vertex_1_y_coordinate": 0, "vertex_1_z_coordinate": top,
                            "vertex_2_x_coordinate": a, "vertex_2_y_coordinate": 0, "vertex_2_z_coordinate": SPEC["window"]["sill_m"],
                            "vertex_3_x_coordinate": b, "vertex_3_y_coordinate": 0, "vertex_3_z_coordinate": SPEC["window"]["sill_m"],
                            "vertex_4_x_coordinate": b, "vertex_4_y_coordinate": 0, "vertex_4_z_coordinate": top}
        hci[f"{z}_window"] = 2.5
        ep["ZoneInfiltration:DesignFlowRate"][f"{z}_inf"] = {
            "zone_or_zonelist_or_space_or_spacelist_name": z, "schedule_name": "one", "design_flow_rate_calculation_method": "AirChanges/Hour",
            "air_changes_per_hour": SPEC["infiltration_ach_at_site"], "constant_term_coefficient": 1, "temperature_term_coefficient": 0,
            "velocity_term_coefficient": 0, "velocity_squared_term_coefficient": 0}
        ep["Schedule:Constant"][f"{z}_sp"] = {"schedule_type_limits_name": "Any", "hourly_value": r["heat_c"] if r["heat_c"] is not None else r["cool_c"]}
        heat = r["heat_c"] is not None
        ep["Schedule:Constant"][f"{z}_ctl"] = {"schedule_type_limits_name": "Any", "hourly_value": 1 if heat else 2}
        kind = "ThermostatSetpoint:SingleHeating" if heat else "ThermostatSetpoint:SingleCooling"
        ep[kind][f"{z}_tsp"] = {"setpoint_temperature_schedule_name": f"{z}_sp"}
        ep["ZoneControl:Thermostat"][f"{z}_tstat"] = {"zone_or_zonelist_name": z, "control_type_schedule_name": f"{z}_ctl",
                                                      "control_1_object_type": kind, "control_1_name": f"{z}_tsp"}
        ep["ZoneHVAC:IdealLoadsAirSystem"][f"{z}_ideal"] = {"zone_supply_air_node_name": f"{z}_supply", "heating_limit": "NoLimit",
                                                            "cooling_limit": "NoLimit", "dehumidification_control_type": "None",
                                                            "humidification_control_type": "None"}
        ep["ZoneHVAC:EquipmentList"][f"{z}_eq"] = {"load_distribution_scheme": "SequentialLoad", "equipment": [{
            "zone_equipment_object_type": "ZoneHVAC:IdealLoadsAirSystem", "zone_equipment_name": f"{z}_ideal",
            "zone_equipment_cooling_sequence": 1, "zone_equipment_heating_or_no_load_sequence": 1}]}
        ep["ZoneHVAC:EquipmentConnections"][f"{z}_conn"] = {"zone_name": z, "zone_conditioning_equipment_list_name": f"{z}_eq",
                                                            "zone_air_inlet_node_or_nodelist_name": f"{z}_supply", "zone_air_node_name": f"{z}_air",
                                                            "zone_return_air_node_or_nodelist_name": f"{z}_return"}
    for k in ("ThermostatSetpoint:SingleHeating", "ThermostatSetpoint:SingleCooling"):
        if not ep[k]:
            del ep[k]
    ep["BuildingSurface:Detailed"] = S
    ep["FenestrationSurface:Detailed"] = W
    if "iso_conv" in flags:
        ep["SurfaceProperty:ConvectionCoefficients:MultipleSurface"] = {"ext": {"surface_type": "AllExteriorSurfaces",
            "convection_coefficient_1_location": "Outside", "convection_coefficient_1_type": "Value", "convection_coefficient_1": 20.0}}
        ep["SurfaceProperty:ConvectionCoefficients"] = {f"in_{n}": {"surface_name": n, "convection_coefficient_1_location": "Inside",
            "convection_coefficient_1_type": "Value", "convection_coefficient_1": v} for n, v in hci.items()}
    return ep


def run(energyplus: str, ep: dict, epw: Path, d: Path) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    (d / "in.epJSON").write_text(json.dumps(ep, indent=1))
    p = subprocess.run([energyplus, "-w", str(epw), "-d", str(d), str(d / "in.epJSON")], capture_output=True, text=True)
    err = (d / "eplusout.err").read_text(errors="replace")
    sev = len(re.findall(r"\*\* Severe  \*\*", err))
    if p.returncode != 0 or sev:
        raise SystemExit(f"EnergyPlus failed in {d}\n{err[-3000:]}")
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name, key):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and t.EnvironmentPeriodIndex =
            (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    out = {"warnings": len(re.findall(r"\*\* Warning \*\*", err)), "zones": {}}
    rooms = SPEC["rooms"]
    for i, r in enumerate(rooms):
        z = r["id"]
        heat = series("Zone Ideal Loads Zone Sensible Heating Energy", f"{z}_ideal")
        cool = series("Zone Ideal Loads Zone Sensible Cooling Energy", f"{z}_ideal")
        tz = series("Zone Mean Air Temperature", z)
        trans = sum(series("Surface Window Transmitted Solar Radiation Energy", f"{z}_window"))
        # Heat into this room through its partitions (inside-face conduction, positive into the face's zone is
        # EnergyPlus's "into the surface" convention reversed: the variable is positive when heat flows into the zone).
        part = 0.0
        for j in (i - 1, i + 1):
            if 0 <= j < len(rooms):
                part += sum(series("Surface Inside Face Conduction Heat Transfer Energy", f"{z}_to_{rooms[j]['id']}"))
        out["zones"][z] = {"heat_mwh": sum(heat) / 3.6e9, "cool_mwh": sum(cool) / 3.6e9, "transmitted_solar_mwh": trans / 3.6e9,
                           "partition_inside_face_conduction_mwh": part / 3.6e9,
                           "min_c": min(tz), "max_c": max(tz), "mean_c": sum(tz) / len(tz)}
    con.close()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    if hashlib.sha256(B.MOS.read_bytes()).hexdigest() != B.MOS_SHA:
        raise SystemExit("Denver .mos sha mismatch")
    runs = Path(a.runs or tempfile.mkdtemp(prefix="104_cooled_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    res = {"source": "validation/energyplus/104_cooled_room.py", "spec": "validation/energyplus/104_cooled_room_spec.json",
           "spec_sha256": hashlib.sha256((HERE / "104_cooled_room_spec.json").read_bytes()).hexdigest(),
           "weather_mos_sha256": B.MOS_SHA, "runs": {}}
    for name, flags in (("base", frozenset()), ("iso_conv", frozenset({"iso_conv"}))):
        r = run(a.energyplus, model(flags), epw, runs / name)
        res["runs"][name] = r
        print(name, json.dumps({z: {k: round(v, 3) for k, v in d.items()} for z, d in r["zones"].items()}))
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
