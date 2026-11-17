#!/usr/bin/env python3
"""
Brief 123 P5: the roof-shape referee in EnergyPlus. A 20 x 10 m single-storey box at Chicago O'Hare
(validation/energyplus/123_roof_spec.json, the inputs the engine's loftBox.ts reads too):

  F0 / F0c  flat roof (heated; heated and cooled)
  L1 / L2   gable cold loft: the attic an unconditioned zone (slopes and triangular gables its surfaces, the ceiling an
            interzone Surface pair), 3 air changes an hour by ZoneInfiltration:DesignFlowRate
  M1 / M2   warm mono-pitch, room open to the slope (the north wall and the east and west walls carry the rise)

Ideal loads in the room only (the loft has no system objects, Rule 8). iso_conv surface coefficients, Timestep 4,
EulerMethod. Writes docs/audit/123/02_energyplus.json (hourly room and loft temperatures, loads, ceiling conduction).

Usage: python3 -I validation/energyplus/123_roof_referee.py --energyplus <path> [--runs <dir>]
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
SPEC = json.loads((HERE / "123_roof_spec.json").read_text())
CR = json.loads((HERE / "104_cooled_room_spec.json").read_text())
OUT = REPO / "docs/audit/123/02_energyplus.json"


def construction(ep: dict, cname: str, rows: list, reverse: bool = False, as_name: str | None = None) -> None:
    names = []
    for j, (d, k, cp, rho) in enumerate(rows):
        nm = f"{cname}_{j}"
        t, _, o = B.mat(nm, d, k, cp, rho)
        o["solar_absorptance"] = CR["solar_absorptance"]
        o["thermal_absorptance"] = CR["thermal_emissivity"]
        ep[t][nm] = o
        names.append(nm)
    if reverse:
        names = names[::-1]
    c = {"outside_layer": names[0]}
    for j, n in enumerate(names[1:], start=2):
        c[f"layer_{j}"] = n
    ep["Construction"][as_name or cname] = c


def model(case: dict) -> dict:
    W, D, H = SPEC["width_x_m"], SPEC["depth_y_m"], SPEC["height_m"]
    roof = case["roof"]
    cold, warm = roof == "gable_cold", roof == "mono_warm"
    r = (D / 2) * math.tan(math.radians(SPEC["gable"]["pitch_deg"])) if cold else D * math.tan(math.radians(SPEC["mono"]["pitch_deg"])) if warm else 0.0
    zones = {"room": {}}
    if cold:
        zones["loft"] = {}
    ep: dict = {
        "Version": {"Version 1": {"version_identifier": "25.2"}},
        "SimulationControl": {"SimulationControl 1": {"do_zone_sizing_calculation": "No", "do_system_sizing_calculation": "No",
                              "do_plant_sizing_calculation": "No", "run_simulation_for_sizing_periods": "No",
                              "run_simulation_for_weather_file_run_periods": "Yes"}},
        "Building": {"RoofBox": {"north_axis": 0, "terrain": "Suburbs", "solar_distribution": "FullInteriorAndExterior",
                     "maximum_number_of_warmup_days": 50, "minimum_number_of_warmup_days": 6,
                     "loads_convergence_tolerance_value": 0.04, "temperature_convergence_tolerance_value": 0.4}},
        "Timestep": {"Timestep 1": {"number_of_timesteps_per_hour": 4}},
        "ZoneAirHeatBalanceAlgorithm": {"ZoneAirHeatBalanceAlgorithm 1": {"algorithm": "EulerMethod"}},
        "RunPeriod": {"Year": {"begin_month": 1, "begin_day_of_month": 1, "end_month": 12, "end_day_of_month": 31,
                      "day_of_week_for_start_day": "Monday"}},
        "Site:Location": {"Chicago": {"latitude": 41.98, "longitude": -87.92, "time_zone": -6.0, "elevation": 201.0}},
        "GlobalGeometryRules": {"GlobalGeometryRules 1": {"starting_vertex_position": "UpperLeftCorner",
                                "vertex_entry_direction": "Counterclockwise", "coordinate_system": "Relative"}},
        "Zone": zones, "Material": {}, "Material:NoMass": {}, "Construction": {},
        "WindowMaterial:SimpleGlazingSystem": {"win": {"u_factor": CR["window"]["u_w_per_m2k"], "solar_heat_gain_coefficient": CR["window"]["shgc"],
                                               "visible_transmittance": 0.7}},
        "ScheduleTypeLimits": {"Any": {}},
        "Schedule:Constant": {"one": {"schedule_type_limits_name": "Any", "hourly_value": 1.0},
                              "heat_sp": {"schedule_type_limits_name": "Any", "hourly_value": SPEC["heat_c"]},
                              "cool_sp": {"schedule_type_limits_name": "Any", "hourly_value": SPEC["cool_c"]},
                              "ctl": {"schedule_type_limits_name": "Any", "hourly_value": 4 if case["cool"] else 1}},
        "ZoneControl:Thermostat": {}, "ZoneHVAC:IdealLoadsAirSystem": {}, "ZoneHVAC:EquipmentList": {}, "ZoneHVAC:EquipmentConnections": {},
        "Output:Variable": {
            "v1": {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Heating Energy", "reporting_frequency": "Hourly"},
            "v2": {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Cooling Energy", "reporting_frequency": "Hourly"},
            "v3": {"key_value": "*", "variable_name": "Zone Mean Air Temperature", "reporting_frequency": "Hourly"},
            "v4": {"key_value": "room_ceiling", "variable_name": "Surface Inside Face Conduction Heat Transfer Energy", "reporting_frequency": "Hourly"},
        },
        "Output:SQLite": {"Output:SQLite 1": {"option_type": "Simple"}},
    }
    construction(ep, "wall", CR["constructions"]["wall"])
    construction(ep, "floor", CR["constructions"]["floor"])
    for k in ("tiles", "warm_slope", "flat_roof"):
        construction(ep, k, SPEC["constructions"][k])
    # The ceiling's layers run loft side first: the room's ceiling has the loft outside; the loft's floor is reversed.
    construction(ep, "ceiling", SPEC["constructions"]["ceiling"])
    construction(ep, "ceiling_rev", SPEC["constructions"]["ceiling"], reverse=True, as_name="ceiling_rev")
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
    inf = {"infl_room": {"zone_or_zonelist_or_space_or_spacelist_name": "room", "schedule_name": "one",
                         "design_flow_rate_calculation_method": "AirChanges/Hour", "air_changes_per_hour": SPEC["room_ach"],
                         "constant_term_coefficient": 1, "temperature_term_coefficient": 0, "velocity_term_coefficient": 0,
                         "velocity_squared_term_coefficient": 0}}
    if cold:
        inf["infl_loft"] = {**inf["infl_room"], "zone_or_zonelist_or_space_or_spacelist_name": "loft", "air_changes_per_hour": SPEC["loft_ach"]}
    ep["ZoneInfiltration:DesignFlowRate"] = inf

    Hn = H + (r if warm else 0.0)  # the north wall's height (a warm mono-pitch's high side)
    out = lambda st, c, z, pts, sun=True: {"surface_type": st, "construction_name": c, "zone_name": z, "outside_boundary_condition": "Outdoors",
                                          "sun_exposure": "SunExposed" if sun else "NoSun", "wind_exposure": "WindExposed" if sun else "NoWind",
                                          "vertices": B.verts(pts)}
    S = {
        "south": out("Wall", "wall", "room", [(0, 0, H), (0, 0, 0), (W, 0, 0), (W, 0, H)]),
        "north": out("Wall", "wall", "room", [(W, D, Hn), (W, D, 0), (0, D, 0), (0, D, Hn)]),
        "east": out("Wall", "wall", "room", [(W, 0, H), (W, 0, 0), (W, D, 0), (W, D, Hn)]),
        "west": out("Wall", "wall", "room", [(0, D, Hn), (0, D, 0), (0, 0, 0), (0, 0, H)]),
        "floor": out("Floor", "floor", "room", [(W, D, 0), (W, 0, 0), (0, 0, 0), (0, D, 0)], sun=False),
    }
    if roof == "flat":
        S["roof"] = out("Roof", "flat_roof", "room", [(0, D, H), (0, 0, H), (W, 0, H), (W, D, H)])
    if warm:
        S["slope"] = out("Roof", "warm_slope", "room", [(0, D, H + r), (0, 0, H), (W, 0, H), (W, D, H + r)])
    if cold:
        S["room_ceiling"] = {"surface_type": "Ceiling", "construction_name": "ceiling", "zone_name": "room", "outside_boundary_condition": "Surface",
                             "outside_boundary_condition_object": "loft_floor", "sun_exposure": "NoSun", "wind_exposure": "NoWind",
                             "vertices": B.verts([(0, D, H), (0, 0, H), (W, 0, H), (W, D, H)])}
        S["loft_floor"] = {"surface_type": "Floor", "construction_name": "ceiling_rev", "zone_name": "loft", "outside_boundary_condition": "Surface",
                           "outside_boundary_condition_object": "room_ceiling", "sun_exposure": "NoSun", "wind_exposure": "NoWind",
                           "vertices": B.verts([(W, D, H), (W, 0, H), (0, 0, H), (0, D, H)])}
        R = H + r
        S["slope_s"] = out("Roof", "tiles", "loft", [(0, D / 2, R), (0, 0, H), (W, 0, H), (W, D / 2, R)])
        S["slope_n"] = out("Roof", "tiles", "loft", [(W, D / 2, R), (W, D, H), (0, D, H), (0, D / 2, R)])
        S["gable_e"] = out("Wall", "wall", "loft", [(W, D / 2, R), (W, 0, H), (W, D, H)])
        S["gable_w"] = out("Wall", "wall", "loft", [(0, D / 2, R), (0, D, H), (0, 0, H)])
    Wn = {}
    for w in SPEC["windows"]:
        z0, z1 = w["sill_m"], w["sill_m"] + w["height_m"]
        a, b_ = (W - w["width_m"]) / 2, (W + w["width_m"]) / 2
        v = [(a, 0, z1), (a, 0, z0), (b_, 0, z0), (b_, 0, z1)] if w["facade"] == "south" else [(W - a, D, z1), (W - a, D, z0), (W - b_, D, z0), (W - b_, D, z1)]
        o = {"surface_type": "Window", "construction_name": "window", "building_surface_name": w["facade"], "number_of_vertices": 4}
        for i, (x, y, z) in enumerate(v, start=1):
            o[f"vertex_{i}_x_coordinate"], o[f"vertex_{i}_y_coordinate"], o[f"vertex_{i}_z_coordinate"] = x, y, z
        Wn[f"{w['facade']}_window"] = o
    ep["BuildingSurface:Detailed"] = S
    ep["FenestrationSurface:Detailed"] = Wn

    # iso_conv: outside 20 W/m2K; inside by the engine's heat-flow direction from the zone (heatFlowDirection: tilt < 60
    # upward 5.0, tilt > 120 downward 0.7, else 2.5).
    def tilt(name: str) -> float:
        if name in Wn or name in ("south", "north", "east", "west", "gable_e", "gable_w"):
            return 90.0
        if name in ("floor", "loft_floor"):
            return 180.0
        if name == "slope_s" or name == "slope_n":
            return SPEC["gable"]["pitch_deg"]
        if name == "slope":
            return SPEC["mono"]["pitch_deg"]
        return 0.0
    hci = lambda t: 5.0 if t < 60 else 0.7 if t > 120 else 2.5
    ep["SurfaceProperty:ConvectionCoefficients:MultipleSurface"] = {"ext": {"surface_type": "AllExteriorSurfaces",
        "convection_coefficient_1_location": "Outside", "convection_coefficient_1_type": "Value", "convection_coefficient_1": 20.0}}
    ep["SurfaceProperty:ConvectionCoefficients"] = {f"in_{n}": {"surface_name": n, "convection_coefficient_1_location": "Inside",
        "convection_coefficient_1_type": "Value", "convection_coefficient_1": hci(tilt(n))} for n in list(S) + list(Wn)}
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
    room = series("Zone Mean Air Temperature", "room")
    loft = series("Zone Mean Air Temperature", "loft")
    ceil = series("Surface Inside Face Conduction Heat Transfer Energy", "room_ceiling")
    con.close()
    rr = lambda xs, k=3: [round(x, k) for x in xs]
    return {"warnings": len(re.findall(r"\*\* Warning \*\*", err)),
            "heat_kwh": sum(heat) / 3.6e6, "cool_kwh": sum(cool) / 3.6e6,
            # EnergyPlus: positive is heat conducted into the zone at the inside face.
            "ceiling_into_room_kwh": sum(ceil) / 3.6e6 if ceil else None,
            "hourly": {"room_c": rr(room), "loft_c": rr(loft) if loft else None,
                       "heat_wh": rr([x / 3600 for x in heat], 2), "cool_wh": rr([x / 3600 for x in cool], 2)}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    ap.add_argument("--only", default=None)
    a = ap.parse_args()
    epw = REPO / SPEC["weather"]["file"]
    if hashlib.sha256(epw.read_bytes()).hexdigest() != SPEC["weather"]["sha256"]:
        raise SystemExit("weather sha mismatch")
    runs = Path(a.runs or tempfile.mkdtemp(prefix="123_roof_"))
    res = {"source": "validation/energyplus/123_roof_referee.py", "spec": "validation/energyplus/123_roof_spec.json",
           "spec_sha256": hashlib.sha256((HERE / "123_roof_spec.json").read_bytes()).hexdigest(),
           "weather_sha256": SPEC["weather"]["sha256"], "cases": {}}
    for name, case in SPEC["cases"].items():
        if a.only and name != a.only:
            continue
        o = run(a.energyplus, model(case), epw, runs / name)
        res["cases"][name] = o
        h = o["hourly"]
        print(name, json.dumps({"heat_kwh": round(o["heat_kwh"], 1), "cool_kwh": round(o["cool_kwh"], 1), "ceiling_kwh": o["ceiling_into_room_kwh"] and round(o["ceiling_into_room_kwh"], 1),
                                "loft_mean": h["loft_c"] and round(sum(h["loft_c"]) / len(h["loft_c"]), 2), "loft_max": h["loft_c"] and max(h["loft_c"]), "warnings": o["warnings"]}))
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res) + "\n")


if __name__ == "__main__":
    main()
