#!/usr/bin/env python3
"""
Brief 115 P4: referees R1 (air leakage) and R2 (windows opening by temperature) in EnergyPlus AirflowNetwork.

One room at Chicago O'Hare (validation/energyplus/115_air_spec.json, the inputs Engine 2's test reads too), walls split into
three equal bands so each band's crack sits where the engine puts its cracks. AirflowNetwork MultizoneWithoutDistribution,
wind pressure coefficients "Input" with the engine's own Swami-Chandra table (the same values both sides), external
nodes at the engine's heights ("ExternalNode" height selection), 4 time steps an hour. Heating (and for the cooled cases
cooling) by ideal loads. The weather is the committed Chicago O'Hare TMY3 EPW (the Denver .mos has no usable wind direction).

Each case of the spec is run; the hourly AFN inflow mass, the venting opening factor and the room's temperature and loads
are written to docs/audit/115/02_energyplus.json, which the engine's test (airReferee.test.ts) reads and gates.

Usage: python3 -I validation/energyplus/115_air_referee.py --energyplus <path> [--runs <dir>]
Nothing touches data/ or a database.
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
spec_ = importlib.util.spec_from_file_location("bestest", HERE / "103_bestest_twin.py")
B = importlib.util.module_from_spec(spec_)
spec_.loader.exec_module(B)  # type: ignore[union-attr]
SPEC = json.loads((HERE / "115_air_spec.json").read_text())
CR = json.loads((HERE / "104_cooled_room_spec.json").read_text())
OUT = REPO / "docs/audit/115/02_energyplus.json"

TERRAIN = {"open": (0.14, 270.0), "suburban": (0.22, 370.0), "urban": (0.22, 370.0), "city": (0.33, 460.0)}


def swami_chandra(alpha: float, G: float) -> float:
    """The engine's airflow.ts swamiChandra, term for term."""
    s2, c2, s, s3 = math.sin(alpha / 2), math.cos(alpha / 2), math.sin(alpha), math.sin(2 * alpha * G)
    return 0.6 * math.log(1.248 - 0.703 * s2 - 1.175 * s * s + 0.131 * s3 ** 3 + 0.769 * c2 + 0.07 * G * G * s2 * s2 + 0.717 * c2 * c2)


def cp_table(az: float, G: float) -> list[float]:
    out = []
    for i in range(36):
        a = abs(((i * 10 - az) % 360 + 360) % 360)
        if a > 180:
            a = 360 - a
        out.append(swami_chandra(math.radians(a), G))
    return out


def layers(ep: dict, cname: str) -> None:
    names = []
    for j, (d, k, cp, rho) in enumerate(CR["constructions"][cname]):
        nm = f"{cname}_{j}"
        t, _, o = B.mat(nm, d, k, cp, rho)
        o["solar_absorptance"] = CR["solar_absorptance"]
        o["thermal_absorptance"] = CR["thermal_emissivity"]
        ep[t][nm] = o
        names.append(nm)
    c = {"outside_layer": names[0]}
    for j, n in enumerate(names[1:], start=2):
        c[f"layer_{j}"] = n
    ep["Construction"][cname] = c


def geometry():
    """Facades (azimuth, width along x or y), envelope area, wall areas net of windows, as the engine's document has them."""
    Wd, D, Hh = SPEC["width_m"], SPEC["depth_m"], SPEC["height_m"]
    return Wd, D, Hh


def model(case: dict, conv: str) -> dict:
    Wd, D, Hh = geometry()
    nb = SPEC["bands"]
    bh = Hh / nb
    n = SPEC["exponent"]
    win = SPEC["window"]
    windows = case["windows"]
    wins = []  # (facade, spec)
    if windows in ("single", "cross", "shut"):
        wins.append(("south", win))
    if windows == "cross":
        wins.append(("north", SPEC["cross_window"]))
    ep: dict = {
        "Version": {"Version 1": {"version_identifier": "25.2"}},
        "SimulationControl": {"SimulationControl 1": {"do_zone_sizing_calculation": "No", "do_system_sizing_calculation": "No",
                              "do_plant_sizing_calculation": "No", "run_simulation_for_sizing_periods": "No",
                              "run_simulation_for_weather_file_run_periods": "Yes"}},
        "Building": {"AirBox": {"north_axis": 0, "terrain": SPEC["terrain"]["energyplus"], "solar_distribution": "FullInteriorAndExterior",
                     "maximum_number_of_warmup_days": 50, "minimum_number_of_warmup_days": 6,
                     "loads_convergence_tolerance_value": 0.04, "temperature_convergence_tolerance_value": 0.4}},
        "Timestep": {"Timestep 1": {"number_of_timesteps_per_hour": 4}},
        "RunPeriod": {"Year": {"begin_month": 1, "begin_day_of_month": 1, "end_month": 12, "end_day_of_month": 31,
                      "day_of_week_for_start_day": "Monday"}},
        "Site:Location": {"Chicago": {"latitude": 41.98, "longitude": -87.92, "time_zone": -6.0, "elevation": 201.0}},
        "GlobalGeometryRules": {"GlobalGeometryRules 1": {"starting_vertex_position": "UpperLeftCorner",
                                "vertex_entry_direction": "Counterclockwise", "coordinate_system": "Relative"}},
        "Zone": {"room": {}}, "Material": {}, "Material:NoMass": {}, "Construction": {},
        "WindowMaterial:SimpleGlazingSystem": {"win": {"u_factor": win["u_w_per_m2k"], "solar_heat_gain_coefficient": win["shgc"],
                                               "visible_transmittance": 0.7}},
        "ScheduleTypeLimits": {"Any": {}},
        "Schedule:Constant": {"one": {"schedule_type_limits_name": "Any", "hourly_value": 1.0},
                              "heat_sp": {"schedule_type_limits_name": "Any", "hourly_value": SPEC["heat_c"]},
                              "cool_sp": {"schedule_type_limits_name": "Any", "hourly_value": SPEC["cool_c"]},
                              "ctl": {"schedule_type_limits_name": "Any", "hourly_value": 4 if case["cool"] else 1},
                              "vent_sp": {"schedule_type_limits_name": "Any", "hourly_value": SPEC["rule"]["open_above_c"]}},
        "ZoneControl:Thermostat": {}, "ZoneHVAC:IdealLoadsAirSystem": {}, "ZoneHVAC:EquipmentList": {}, "ZoneHVAC:EquipmentConnections": {},
        "Output:Variable": {
            "v1": {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Heating Energy", "reporting_frequency": "Hourly"},
            "v2": {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Cooling Energy", "reporting_frequency": "Hourly"},
            "v3": {"key_value": "*", "variable_name": "Zone Mean Air Temperature", "reporting_frequency": "Hourly"},
            "v4": {"key_value": "*", "variable_name": "AFN Zone Infiltration Mass", "reporting_frequency": "Hourly"},
            "v5": {"key_value": "*", "variable_name": "AFN Surface Venting Window or Door Opening Factor", "reporting_frequency": "Hourly"},
            "v6": {"key_value": "*", "variable_name": "AFN Zone Infiltration Sensible Heat Loss Energy", "reporting_frequency": "Hourly"},
            "v7": {"key_value": "*", "variable_name": "AFN Zone Infiltration Sensible Heat Gain Energy", "reporting_frequency": "Hourly"},
            # EnergyPlus reports air through an opening its venting control has opened as "ventilation", the rest as "infiltration".
            "v8": {"key_value": "*", "variable_name": "AFN Zone Ventilation Mass", "reporting_frequency": "Hourly"},
        },
        "Output:SQLite": {"Output:SQLite 1": {"option_type": "Simple"}},
    }
    for c in ("wall", "roof", "floor"):
        layers(ep, c)
    ep["Construction"]["window"] = {"outside_layer": "win"}
    if case["cool"]:
        ep["ThermostatSetpoint:DualSetpoint"] = {"dual": {"heating_setpoint_temperature_schedule_name": "heat_sp",
                                                          "cooling_setpoint_temperature_schedule_name": "cool_sp"}}
        ctl = ("ThermostatSetpoint:DualSetpoint", "dual")
    else:
        ep["ThermostatSetpoint:SingleHeating"] = {"heat": {"setpoint_temperature_schedule_name": "heat_sp"}}
        ctl = ("ThermostatSetpoint:SingleHeating", "heat")
    ep["ZoneControl:Thermostat"]["tstat"] = {"zone_or_zonelist_name": "room", "control_type_schedule_name": "ctl",
                                             "control_1_object_type": ctl[0], "control_1_name": ctl[1]}
    ep["ZoneHVAC:IdealLoadsAirSystem"]["ideal"] = {"zone_supply_air_node_name": "supply", "heating_limit": "NoLimit", "cooling_limit": "NoLimit",
                                                   "dehumidification_control_type": "None", "humidification_control_type": "None"}
    ep["ZoneHVAC:EquipmentList"]["eq"] = {"load_distribution_scheme": "SequentialLoad", "equipment": [{
        "zone_equipment_object_type": "ZoneHVAC:IdealLoadsAirSystem", "zone_equipment_name": "ideal",
        "zone_equipment_cooling_sequence": 1, "zone_equipment_heating_or_no_load_sequence": 1}]}
    ep["ZoneHVAC:EquipmentConnections"]["conn"] = {"zone_name": "room", "zone_conditioning_equipment_list_name": "eq",
                                                   "zone_air_inlet_node_or_nodelist_name": "supply", "zone_air_node_name": "air",
                                                   "zone_return_air_node_or_nodelist_name": "return"}

    # Facades: south y=0 (180), east x=Wd (90), north y=D (0), west x=0 (270). Each wall in bands.
    fac = {"south": (180.0, Wd), "east": (90.0, D), "north": (0.0, Wd), "west": (270.0, D)}
    area = {f: w * Hh for f, (_, w) in fac.items()}  # outside wall + glazing facing that way (the engine's facade width)
    side = {"south": ("east", "west"), "north": ("east", "west"), "east": ("north", "south"), "west": ("north", "south")}
    S, Wn = {}, {}

    def wall(f, b):
        z0, z1 = b * bh, (b + 1) * bh
        if f == "south":
            pts = [(0, 0, z1), (0, 0, z0), (Wd, 0, z0), (Wd, 0, z1)]
        elif f == "north":
            pts = [(Wd, D, z1), (Wd, D, z0), (0, D, z0), (0, D, z1)]
        elif f == "east":
            pts = [(Wd, 0, z1), (Wd, 0, z0), (Wd, D, z0), (Wd, D, z1)]
        else:
            pts = [(0, D, z1), (0, D, z0), (0, 0, z0), (0, 0, z1)]
        S[f"{f}_{b}"] = {"surface_type": "Wall", "construction_name": "wall", "zone_name": "room", "outside_boundary_condition": "Outdoors",
                         "sun_exposure": "SunExposed", "wind_exposure": "WindExposed", "vertices": B.verts(pts)}

    for f in fac:
        for b in range(nb):
            wall(f, b)
    S["roof"] = {"surface_type": "Roof", "construction_name": "roof", "zone_name": "room", "outside_boundary_condition": "Outdoors",
                 "sun_exposure": "SunExposed", "wind_exposure": "WindExposed", "vertices": B.verts([(0, D, Hh), (0, 0, Hh), (Wd, 0, Hh), (Wd, D, Hh)])}
    S["floor"] = {"surface_type": "Floor", "construction_name": "floor", "zone_name": "room", "outside_boundary_condition": "Outdoors",
                  "sun_exposure": "NoSun", "wind_exposure": "NoWind", "vertices": B.verts([(Wd, D, 0), (Wd, 0, 0), (0, 0, 0), (0, D, 0)])}
    win_area = {}
    for f, w in wins:
        z0, z1 = w["energyplus_z0_m"], w["energyplus_z0_m"] + w["height_m"]
        band = int(z0 // bh)
        assert int((z1 - 1e-9) // bh) == band, "a window must sit inside one band"
        L = fac[f][1]
        a, b_ = (L - w["width_m"]) / 2, (L + w["width_m"]) / 2
        if f == "south":
            v = [(a, 0, z1), (a, 0, z0), (b_, 0, z0), (b_, 0, z1)]
        else:  # north: walking from x=Wd to x=0
            v = [(Wd - a, D, z1), (Wd - a, D, z0), (Wd - b_, D, z0), (Wd - b_, D, z1)]
        o = {"surface_type": "Window", "construction_name": "window", "building_surface_name": f"{f}_{band}", "number_of_vertices": 4}
        for i, (x, y, z) in enumerate(v, start=1):
            o[f"vertex_{i}_x_coordinate"], o[f"vertex_{i}_y_coordinate"], o[f"vertex_{i}_z_coordinate"] = x, y, z
        Wn[f"{f}_window"] = o
        win_area[f] = w["width_m"] * w["height_m"]
    ep["BuildingSurface:Detailed"] = S
    if conv == "iso":
        # Brief 104's iso_conv: outside 20 W/m2K, inside by tilt (walls and windows 2.5, roof 5.0, floor 0.7), the engine's
        # REFEREE_OPTIONS surface coefficients, so the room's own fabric gap (Briefs 103 to 108) is not read as an air gap.
        hci = {n: (5.0 if n == "roof" else 0.7 if n == "floor" else 2.5) for n in list(S) + list(Wn)}
        ep["SurfaceProperty:ConvectionCoefficients:MultipleSurface"] = {"ext": {"surface_type": "AllExteriorSurfaces",
            "convection_coefficient_1_location": "Outside", "convection_coefficient_1_type": "Value", "convection_coefficient_1": 20.0}}
        ep["SurfaceProperty:ConvectionCoefficients"] = {f"in_{n}": {"surface_name": n, "convection_coefficient_1_location": "Inside",
            "convection_coefficient_1_type": "Value", "convection_coefficient_1": v} for n, v in hci.items()}
    if Wn:
        ep["FenestrationSurface:Detailed"] = Wn

    # Leakage, as the engine: k = rho_ref q50 A_env / 3600 / 50^n, over the outside walls (net of glazing) by area, 3 bands.
    q50 = case["q50"]
    if q50 > 0 or Wn:
        rho_ref = 101325 / (287.0 * (20 + 273.15) * (1 + 1.6077687 * 1e-5))
        A_env = 2 * Wd * Hh + 2 * D * Hh + 2 * Wd * D
        k_tot = rho_ref * q50 * A_env / 3600 / 50 ** n
        net = {f: area[f] - win_area.get(f, 0.0) for f in fac}
        wall_area = sum(net.values())
        a_exp, delta = TERRAIN[SPEC["terrain"]["engine"]]
        ep["AirflowNetwork:SimulationControl"] = {"afn": {
            "airflownetwork_control": "MultizoneWithoutDistribution", "wind_pressure_coefficient_type": "Input",
            "height_selection_for_local_wind_pressure_calculation": "ExternalNode", "building_type": "LowRise",
            "maximum_number_of_iterations": 500, "initialization_type": "ZeroNodePressures",
            "relative_airflow_convergence_tolerance": 1e-6, "absolute_airflow_convergence_tolerance": 1e-8,
            "convergence_acceleration_limit": -0.5, "azimuth_angle_of_long_axis_of_building": 0,
            "ratio_of_building_width_along_short_axis_to_width_along_long_axis": 1, "allow_unsupported_zone_equipment": "Yes"}}
        z = {"zone_name": "room", "ventilation_control_mode": "NoVent"}
        if case["windows"] in ("single", "cross"):
            z.update({"ventilation_control_mode": "Temperature", "ventilation_control_zone_temperature_setpoint_schedule_name": "vent_sp",
                      "venting_availability_schedule_name": "one"})
            if case.get("modulation"):
                m = SPEC["modulation"]
                z.update({"minimum_venting_open_factor": m["min_fraction"],
                          "indoor_and_outdoor_temperature_difference_lower_limit_for_maximum_venting_open_factor": m["lower_dk"],
                          "indoor_and_outdoor_temperature_difference_upper_limit_for_minimum_venting_open_factor": m["upper_dk"]})
            else:
                z.update({"minimum_venting_open_factor": 1.0})
        elif case["windows"] == "shut":
            z["ventilation_control_mode"] = "NoVent"
        ep["AirflowNetwork:MultiZone:Zone"] = {"room_afn": z}
        ep["AirflowNetwork:MultiZone:ReferenceCrackConditions"] = {"ref": {"reference_temperature": 20.0, "reference_barometric_pressure": 101325.0,
                                                                           "reference_humidity_ratio": 0.0}}
        dirs = {f"wind_direction_{i + 1}": float(i * 10) for i in range(36)}
        ep["AirflowNetwork:MultiZone:WindPressureCoefficientArray"] = {"dirs": dirs}
        wpc, nodes, surf, cracks = {}, {}, {}, {}
        for f, (az, w) in fac.items():
            sides = [area[s] for s in side[f]]
            G = math.log(area[f] / (sum(sides) / len(sides)))
            vals = {"airflownetwork_multizone_windpressurecoefficientarray_name": "dirs"}
            for i, v in enumerate(cp_table(az, G)):
                vals[f"wind_pressure_coefficient_value_{i + 1}"] = v
            wpc[f"cp_{f}"] = vals
            for b in range(nb):
                zc = (b + 0.5) * bh
                nodes[f"node_{f}_{b}"] = {"external_node_height": zc, "wind_pressure_coefficient_curve_name": f"cp_{f}",
                                          "symmetric_wind_pressure_coefficient_curve": "No", "wind_angle_type": "Absolute"}
                if k_tot > 0:
                    cracks[f"crack_{f}_{b}"] = {"air_mass_flow_coefficient_at_reference_conditions": k_tot * net[f] / wall_area / nb,
                                                "air_mass_flow_exponent": n, "reference_crack_conditions": "ref"}
                    surf[f"s_{f}_{b}"] = {"surface_name": f"{f}_{b}", "leakage_component_name": f"crack_{f}_{b}",
                                          "external_node_name": f"node_{f}_{b}", "window_door_opening_factor_or_crack_factor": 1.0}
        for f, w in wins:
            # The engine's window: sill = EnergyPlus centroid, head = centroid + height, wind at the middle of that.
            zc = w["energyplus_z0_m"] + w["height_m"] / 2
            nodes[f"node_{f}_win"] = {"external_node_height": zc + w["height_m"] / 2, "wind_pressure_coefficient_curve_name": f"cp_{f}",
                                      "symmetric_wind_pressure_coefficient_curve": "No", "wind_angle_type": "Absolute"}
            surf[f"s_{f}_win"] = {"surface_name": f"{f}_window", "leakage_component_name": "opening", "external_node_name": f"node_{f}_win",
                                  # "shut": the zone's venting control is NoVent, which keeps the window closed (factor 0) every step.
                                  "window_door_opening_factor_or_crack_factor": win["openable_fraction"] * SPEC["rule"]["open_fraction"]}
        ep["AirflowNetwork:MultiZone:WindPressureCoefficientValues"] = wpc
        ep["AirflowNetwork:MultiZone:ExternalNode"] = nodes
        if cracks:
            ep["AirflowNetwork:MultiZone:Surface:Crack"] = cracks
        if wins:
            ep["AirflowNetwork:MultiZone:Component:SimpleOpening"] = {"opening": {
                "air_mass_flow_coefficient_when_opening_is_closed": 1e-9, "air_mass_flow_exponent_when_opening_is_closed": 0.65,
                "minimum_density_difference_for_two_way_flow": 1e-4, "discharge_coefficient": win["cd"]}}
        ep["AirflowNetwork:MultiZone:Surface"] = surf
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
    heat = series("Zone Ideal Loads Zone Sensible Heating Energy", "ideal")
    cool = series("Zone Ideal Loads Zone Sensible Cooling Energy", "ideal")
    tz = series("Zone Mean Air Temperature", "room")
    inf = series("AFN Zone Infiltration Mass", "room") or [0.0] * len(tz)
    vent = series("AFN Zone Ventilation Mass", "room") or [0.0] * len(tz)
    inf = [a + b for a, b in zip(inf, vent)]
    opening = series("AFN Surface Venting Window or Door Opening Factor", "south_window") or [0.0] * len(tz)
    con.close()
    r = lambda xs, k=4: [round(x, k) for x in xs]
    return {"warnings": len(re.findall(r"\*\* Warning \*\*", err)),
            "heat_kwh": sum(heat) / 3.6e6, "cool_kwh": sum(cool) / 3.6e6,
            "hourly": {"inflow_kg": r(inf), "open_factor": r(opening), "theta_air_c": r(tz, 3),
                       "heat_wh": r([x / 3600 for x in heat], 2), "cool_wh": r([x / 3600 for x in cool], 2)}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--convection", choices=["iso", "base"], default="iso")
    a = ap.parse_args()
    epw = REPO / SPEC["weather"]["file"]
    if hashlib.sha256(epw.read_bytes()).hexdigest() != SPEC["weather"]["sha256"]:
        raise SystemExit("weather sha mismatch")
    runs = Path(a.runs or tempfile.mkdtemp(prefix="115_air_"))
    runs.mkdir(parents=True, exist_ok=True)
    res = {"source": "validation/energyplus/115_air_referee.py", "spec": "validation/energyplus/115_air_spec.json",
           "spec_sha256": hashlib.sha256((HERE / "115_air_spec.json").read_bytes()).hexdigest(),
           "weather_sha256": SPEC["weather"]["sha256"], "convection": a.convection, "cases": {}}
    for name, case in SPEC["cases"].items():
        if a.only and name != a.only:
            continue
        out = run(a.energyplus, model(case, a.convection), epw, runs / a.convection / name)
        res["cases"][name] = out
        h = out["hourly"]
        print(name, json.dumps({"heat_kwh": round(out["heat_kwh"], 1), "cool_kwh": round(out["cool_kwh"], 1),
                                "inflow_t": round(sum(h["inflow_kg"]) / 1000, 2), "hours_open": sum(1 for x in h["open_factor"] if x > 0),
                                "max_c": max(h["theta_air_c"]), "warnings": out["warnings"]}))
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    out = OUT if a.convection == "iso" else OUT.with_name("02_energyplus_base.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res) + "\n")


if __name__ == "__main__":
    main()
