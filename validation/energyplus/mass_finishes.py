#!/usr/bin/env python3
"""
Thermal mass behind finishes (Linzie 17 Nov 2026): the EnergyPlus referee for one concrete-frame office room with
four slab finishes (validation/energyplus/mass_finishes_spec.json, which scripts/mass_finishes.mts reads too).

The slab and the partition join this room to identical neighbours, so each is a surface pair inside this one zone
(both faces in the room). Ideal loads at 20/24 C for the conditioned runs; no HVAC and free_running_ach for the
free-running runs. Two convection variants: base (EnergyPlus's own TARP inside, DOE-2 outside) and iso_conv (our
engine's fixed coefficients).

Usage: python3 -I validation/energyplus/mass_finishes.py --energyplus <path> --epw <file> --out <json> [--runs <dir>]
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = json.loads((HERE / "mass_finishes_spec.json").read_text())


def verts(pts):
    return [{"vertex_x_coordinate": x, "vertex_y_coordinate": y, "vertex_z_coordinate": z} for x, y, z in pts]


def construction(ep: dict, cname: str, rows: list, tag: str, reverse_as: str | None = None) -> None:
    names = []
    for j, (d, k, cp, rho) in enumerate(rows):
        nm = f"{tag}_{j}" if not isinstance(tag, list) else tag[j]
        if rho == 0:
            ep["Material:NoMass"][nm] = {"roughness": "Rough", "thermal_resistance": d / k, "thermal_absorptance": 0.9,
                                         "solar_absorptance": 0.6, "visible_absorptance": 0.6}
        else:
            ep["Material"][nm] = {"roughness": "Rough", "thickness": d, "conductivity": k, "specific_heat": cp, "density": rho,
                                  "thermal_absorptance": 0.9, "solar_absorptance": 0.6, "visible_absorptance": 0.6}
        names.append(nm)
    def put(nm_list, cn):
        c = {"outside_layer": nm_list[0]}
        for j, n in enumerate(nm_list[1:], start=2):
            c[f"layer_{j}"] = n
        ep["Construction"][cn] = c
    put(names, cname)
    if reverse_as:
        put(list(reversed(names)), reverse_as)


def model(case: str, conditioned: bool, iso_conv: bool) -> dict:
    W, D, H = SPEC["width_m"], SPEC["depth_m"], SPEC["height_m"]
    on, off = SPEC["gains"]["weekday_on"]
    ep: dict = {
        "Version": {"Version 1": {"version_identifier": "25.2"}},
        "SimulationControl": {"SimulationControl 1": {"do_zone_sizing_calculation": "No", "do_system_sizing_calculation": "No",
                              "do_plant_sizing_calculation": "No", "run_simulation_for_sizing_periods": "No",
                              "run_simulation_for_weather_file_run_periods": "Yes"}},
        "Building": {"Mass": {"north_axis": 0, "terrain": "City", "solar_distribution": "FullInteriorAndExterior",
                     "maximum_number_of_warmup_days": 50, "minimum_number_of_warmup_days": 6,
                     "loads_convergence_tolerance_value": 0.04, "temperature_convergence_tolerance_value": 0.4}},
        "Timestep": {"Timestep 1": {"number_of_timesteps_per_hour": 4}},
        "RunPeriod": {"Year": {"begin_month": 1, "begin_day_of_month": 1, "end_month": 12, "end_day_of_month": 31,
                      "day_of_week_for_start_day": "Monday", "use_weather_file_holidays_and_special_days": "No",
                      "use_weather_file_daylight_saving_period": "No"}},
        "GlobalGeometryRules": {"GlobalGeometryRules 1": {"starting_vertex_position": "UpperLeftCorner",
                                "vertex_entry_direction": "Counterclockwise", "coordinate_system": "Relative"}},
        "Zone": {"room": {}}, "Material": {}, "Material:NoMass": {}, "Construction": {},
        "WindowMaterial:SimpleGlazingSystem": {"win": {"u_factor": SPEC["window"]["u_w_per_m2k"],
                                               "solar_heat_gain_coefficient": SPEC["window"]["shgc"], "visible_transmittance": 0.7}},
        "ScheduleTypeLimits": {"Any": {}},
        "Schedule:Constant": {"one": {"schedule_type_limits_name": "Any", "hourly_value": 1.0}},
        "Schedule:Compact": {"office": {"schedule_type_limits_name": "Any", "data": [
            {"field": "Through: 12/31"}, {"field": "For: Weekdays"},
            {"field": f"Until: {on:02d}:00"}, {"field": 0}, {"field": f"Until: {off:02d}:00"}, {"field": 1},
            {"field": "Until: 24:00"}, {"field": 0}, {"field": "For: AllOtherDays"}, {"field": "Until: 24:00"}, {"field": 0}]}},
        "ElectricEquipment": {"gains": {"zone_or_zonelist_or_space_or_spacelist_name": "room", "schedule_name": "office",
                              "design_level_calculation_method": "Watts/Area", "watts_per_floor_area": SPEC["gains"]["w_per_m2"],
                              "fraction_latent": 0, "fraction_radiant": SPEC["gains"]["radiant_fraction"], "fraction_lost": 0}},
        "ZoneInfiltration:DesignFlowRate": {"inf": {
            "zone_or_zonelist_or_space_or_spacelist_name": "room", "schedule_name": "one", "design_flow_rate_calculation_method": "AirChanges/Hour",
            "air_changes_per_hour": SPEC["infiltration_ach"] if conditioned else SPEC["free_running_ach"], "constant_term_coefficient": 1,
            "temperature_term_coefficient": 0, "velocity_term_coefficient": 0, "velocity_squared_term_coefficient": 0}},
        "Output:Variable": {
            "v1": {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Heating Energy", "reporting_frequency": "Hourly"},
            "v2": {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Cooling Energy", "reporting_frequency": "Hourly"},
            "v3": {"key_value": "*", "variable_name": "Zone Mean Air Temperature", "reporting_frequency": "Hourly"},
        },
        "Output:SQLite": {"Output:SQLite 1": {"option_type": "Simple"}},
    }
    mats = SPEC["materials"]
    slab = [mats[m] for m in SPEC["cases"][case]]
    construction(ep, "ext", SPEC["external_wall"], "ext")
    construction(ep, "part", SPEC["partition"], ["board", "cavity", "board"])   # symmetric: the same names reversed
    construction(ep, "slab", slab, SPEC["cases"][case], reverse_as="slab_rev")  # outside first = ceiling side (room below)
    ep["Construction"]["window"] = {"outside_layer": "win"}
    S, hci = {}, {}

    def surf(name, typ, cons, pts, boundary="Outdoors", other=None, h_in=2.5):
        o = {"surface_type": typ, "construction_name": cons, "zone_name": "room", "outside_boundary_condition": boundary,
             "sun_exposure": "SunExposed" if boundary == "Outdoors" else "NoSun",
             "wind_exposure": "WindExposed" if boundary == "Outdoors" else "NoWind", "vertices": verts(pts)}
        if other:
            o["outside_boundary_condition_object"] = other
        S[name] = o
        hci[name] = h_in

    surf("south", "Wall", "ext", [(0, 0, H), (0, 0, 0), (W, 0, 0), (W, 0, H)])
    surf("north", "Wall", "ext", [(W, D, H), (W, D, 0), (0, D, 0), (0, D, H)])
    surf("east", "Wall", "part", [(W, 0, H), (W, 0, 0), (W, D, 0), (W, D, H)], "Surface", "west")
    surf("west", "Wall", "part", [(0, D, H), (0, D, 0), (0, 0, 0), (0, 0, H)], "Surface", "east")
    surf("floor", "Floor", "slab", [(W, D, 0), (W, 0, 0), (0, 0, 0), (0, D, 0)], "Surface", "ceiling", h_in=0.7)
    surf("ceiling", "Ceiling", "slab_rev", [(0, D, H), (0, 0, H), (W, 0, H), (W, D, H)], "Surface", "floor", h_in=5.0)
    ww, wh, ws = SPEC["window"]["width_m"], SPEC["window"]["height_m"], SPEC["window"]["sill_m"]
    a, b = (W - ww) / 2, (W + ww) / 2
    ep["FenestrationSurface:Detailed"] = {"window": {"surface_type": "Window", "construction_name": "window", "building_surface_name": "south",
        "number_of_vertices": 4,
        "vertex_1_x_coordinate": a, "vertex_1_y_coordinate": 0, "vertex_1_z_coordinate": ws + wh,
        "vertex_2_x_coordinate": a, "vertex_2_y_coordinate": 0, "vertex_2_z_coordinate": ws,
        "vertex_3_x_coordinate": b, "vertex_3_y_coordinate": 0, "vertex_3_z_coordinate": ws,
        "vertex_4_x_coordinate": b, "vertex_4_y_coordinate": 0, "vertex_4_z_coordinate": ws + wh}}
    hci["window"] = 2.5
    ep["BuildingSurface:Detailed"] = S
    if conditioned:
        sp = SPEC["setpoints"]
        ep["Schedule:Constant"]["heat_sp"] = {"schedule_type_limits_name": "Any", "hourly_value": sp["heat_c"]}
        ep["Schedule:Constant"]["cool_sp"] = {"schedule_type_limits_name": "Any", "hourly_value": sp["cool_c"]}
        ep["Schedule:Constant"]["ctl"] = {"schedule_type_limits_name": "Any", "hourly_value": 4}
        ep["ThermostatSetpoint:DualSetpoint"] = {"dual": {"heating_setpoint_temperature_schedule_name": "heat_sp",
                                                          "cooling_setpoint_temperature_schedule_name": "cool_sp"}}
        ep["ZoneControl:Thermostat"] = {"tstat": {"zone_or_zonelist_name": "room", "control_type_schedule_name": "ctl",
                                                  "control_1_object_type": "ThermostatSetpoint:DualSetpoint", "control_1_name": "dual"}}
        ep["ZoneHVAC:IdealLoadsAirSystem"] = {"ideal": {"zone_supply_air_node_name": "supply", "heating_limit": "NoLimit",
                                                        "cooling_limit": "NoLimit", "dehumidification_control_type": "None",
                                                        "humidification_control_type": "None"}}
        ep["ZoneHVAC:EquipmentList"] = {"eq": {"load_distribution_scheme": "SequentialLoad", "equipment": [{
            "zone_equipment_object_type": "ZoneHVAC:IdealLoadsAirSystem", "zone_equipment_name": "ideal",
            "zone_equipment_cooling_sequence": 1, "zone_equipment_heating_or_no_load_sequence": 1}]}}
        ep["ZoneHVAC:EquipmentConnections"] = {"conn": {"zone_name": "room", "zone_conditioning_equipment_list_name": "eq",
                                                        "zone_air_inlet_node_or_nodelist_name": "supply", "zone_air_node_name": "air",
                                                        "zone_return_air_node_or_nodelist_name": "return"}}
    if iso_conv:
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
    if p.returncode != 0 or re.search(r"\*\* Severe  \*\*", err):
        raise SystemExit(f"EnergyPlus failed in {d}\n{err[-3000:]}")
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and t.EnvironmentPeriodIndex =
            (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name,))]
    heat, cool, tz = series("Zone Ideal Loads Zone Sensible Heating Energy"), series("Zone Ideal Loads Zone Sensible Cooling Energy"), series("Zone Mean Air Temperature")
    con.close()
    return {"warnings": len(re.findall(r"\*\* Warning \*\*", err)), "heat_kwh": sum(heat) / 3.6e6, "cool_kwh": sum(cool) / 3.6e6,
            "peak_cool_w": max(cool) / 3600 if cool else 0, "max_c": max(tz), "hours_over_26": sum(1 for t in tz if t > 26),
            "hours_over_28": sum(1 for t in tz if t > 28)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--epw", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    runs = Path(a.runs or tempfile.mkdtemp(prefix="mass_"))
    res = {"epw": Path(a.epw).name, "cases": {}}
    for case in SPEC["cases"]:
        row = {}
        for conv in ("base", "iso_conv"):
            c = run(a.energyplus, model(case, True, conv == "iso_conv"), Path(a.epw), runs / f"{case}_{conv}_cond")
            f = run(a.energyplus, model(case, False, conv == "iso_conv"), Path(a.epw), runs / f"{case}_{conv}_free")
            row[conv] = {"heat_kwh": c["heat_kwh"], "cool_kwh": c["cool_kwh"], "peak_cool_w": c["peak_cool_w"],
                         "free": {k: f[k] for k in ("max_c", "hours_over_26", "hours_over_28")}, "warnings": c["warnings"] + f["warnings"]}
        res["cases"][case] = row
        print(case, json.dumps(row))
    Path(a.out).write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
