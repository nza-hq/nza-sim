#!/usr/bin/env python3
"""
Brief 103 instrumentation: ASHRAE 140 / BESTEST Cases 600, 900, 600FF and 900FF in EnergyPlus, built from the same
inputs Engine 1's test reads (frontend/src/thermal/engine/__tests__/bestest.test.ts, from the open LBNL Modelica
Buildings BESTEST models), so Engine 1 can be compared term by term with a referee on the reference case, as it is on
Bridgewater (Part 5 / 6).

EnergyPlus models the window as the specification does (two 3.048 mm Glass600 panes, 12 mm air, angular optics)
and computes its own convection, sky long-wave (from the weather file's horizontal infrared) and beam solar
distribution (FullInteriorAndExterior). Everything else is the specification: 8 x 6 x 2.7 m, two 3 x 2 m south
windows, layers outside first, 0.5 ach at Denver (EnergyPlus applies local air density), 200 W continuous (60 %
radiant), IdealLoads 20 / 27 C, solar absorptance 0.6 and emissivity 0.9 inside and out. The floor's outside face is
exposed to outdoor air with no sun and no wind, as in Engine 1's document.

Weather: the same Denver TMY3 725650 .mos file Engine 1 reads (sha pinned), turned back into an EPW (its 29 data
columns are the EPW's fields 7 to 35 in order; row k is TMY3 hour k, row 0 repeats hour 1, hour 8760 repeats 8759,
exactly as the Engine 1 test reads it).

Usage: python3 validation/energyplus/103_bestest_twin.py --energyplus <path> [--runs <dir>]
Writes docs/audit/103/bestest_energyplus.json: the four cases as specified ('base'), then Cases 600 and 900 with ONE
of Engine 1's ISO 52016-1 simplifications put into EnergyPlus at a time, so each simplification's effect on the
reference case is measured in the referee itself:
  hce20          outside convection fixed at ISO 52016-1's h_ce = 20 W/m2K (EnergyPlus otherwise: DOE-2, wind-driven)
  hci_iso        inside convection fixed at ISO 52016-1 Table 25 by heat-flow direction: walls 2.5, roof (ceiling) 5.0,
                 floor 0.7 W/m2K (EnergyPlus otherwise: TARP, temperature-driven)
  simple_window  the window as Engine 1 reads it: U 2.87 (EN 673), SHGC = normal-incidence g 0.760, through
                 WindowMaterial:SimpleGlazingSystem (EnergyPlus applies its own angular curve)
  all_three      the three together
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MOS = REPO / "validation/fixtures/weather/USA_CO_Denver.Intl.AP.725650_TMY3.mos"
MOS_SHA = "13f5a77b445b558dd162880a98e00ecaffe3bf567d88ca8581dfa88b589fbb48"
OUT = REPO / "docs/audit/103/bestest_energyplus.json"
MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
RANGES = {"600": {"heat": [3.993, 4.504], "cool": [5.432, 6.162]}, "900": {"heat": [1.379, 1.814], "cool": [2.267, 2.714]},
          "600FF": {"min": [-13.8, -9.9], "max": [62.4, 68.4], "mean": [24.3, 26.1]},
          "900FF": {"min": [0.6, 2.2], "max": [43.3, 46.0], "mean": [24.5, 25.7]}}


def mos_to_epw(mos: Path, epw: Path) -> None:
    text = mos.read_text(encoding="latin-1").splitlines()
    head = {}
    for l in text:
        m = re.match(r"^#(LOCATION|DESIGN CONDITIONS|TYPICAL/EXTREME PERIODS|GROUND TEMPERATURES|HOLIDAYS/DAYLIGHT SAVINGS|COMMENTS 1|COMMENTS 2|DATA PERIODS),", l)
        if m:
            head[m.group(1)] = l[1:]
    rows = [l.split() for l in text if l and not l.startswith("#") and len(l.split("\t")) > 20]
    if len(rows) != 8760:
        raise SystemExit(f"expected 8760 rows, found {len(rows)}")
    out = [head[k] for k in ("LOCATION", "DESIGN CONDITIONS", "TYPICAL/EXTREME PERIODS", "GROUND TEMPERATURES",
                             "HOLIDAYS/DAYLIGHT SAVINGS", "COMMENTS 1", "COMMENTS 2", "DATA PERIODS")]
    i = 0
    for m in range(1, 13):
        for d in range(1, MONTH_DAYS[m - 1] + 1):
            for hr in range(1, 25):
                r = rows[min(i + 1, 8759)]
                out.append(",".join(["1990", str(m), str(d), str(hr), "60", "?9?9?9?9E0?9?9?9?9?9?9?9?9?9?9?9?9?9?9?9*9*9?9?9?9"] + r[1:30]))
                i += 1
    epw.write_text("\n".join(out) + "\n")


def mat(name, d, k, cp, rho):
    if rho == 0:
        return "Material:NoMass", name, {"roughness": "Rough", "thermal_resistance": d / k, "thermal_absorptance": 0.9,
                                          "solar_absorptance": 0.6, "visible_absorptance": 0.6}
    return "Material", name, {"roughness": "Rough", "thickness": d, "conductivity": k, "specific_heat": cp, "density": rho,
                              "thermal_absorptance": 0.9, "solar_absorptance": 0.6, "visible_absorptance": 0.6}


LAYERS = {  # outside first, as bestest.test.ts LIB
    "wall600": [("w_wood", .009, .14, 900, 530), ("w_fibre", .066, .04, 840, 12), ("w_plaster", .012, .16, 840, 950)],
    "roof600": [("r_deck", .019, .14, 900, 530), ("r_fibre", .1118, .04, 840, 12), ("r_plaster", .010, .16, 840, 950)],
    "floor600": [("f_insul600", 1.003, .04, 0, 0), ("f_timber", .025, .14, 1200, 650)],
    "wall900": [("w_wood", .009, .14, 900, 530), ("w_foam", .0615, .04, 1400, 10), ("w_block", .100, .51, 1000, 1400)],
    "floor900": [("f_insul900", 1.007, .04, 0, 0), ("f_concrete", .080, 1.13, 1000, 1400)],
}


def verts(pts):
    return [{"vertex_x_coordinate": x, "vertex_y_coordinate": y, "vertex_z_coordinate": z} for x, y, z in pts]


def model(case: str, free: bool, flags: frozenset = frozenset()) -> dict:
    heavy = case.startswith("900")
    wall, floor, roof = ("wall900" if heavy else "wall600"), ("floor900" if heavy else "floor600"), "roof600"
    ep: dict = {
        "Version": {"Version 1": {"version_identifier": "25.2"}},
        "SimulationControl": {"SimulationControl 1": {"do_zone_sizing_calculation": "No", "do_system_sizing_calculation": "No",
                              "do_plant_sizing_calculation": "No", "run_simulation_for_sizing_periods": "No",
                              "run_simulation_for_weather_file_run_periods": "Yes"}},
        "Building": {"BESTEST": {"north_axis": 0, "terrain": "Country", "solar_distribution": "FullInteriorAndExterior",
                     "maximum_number_of_warmup_days": 50, "minimum_number_of_warmup_days": 6,
                     "loads_convergence_tolerance_value": 0.04, "temperature_convergence_tolerance_value": 0.4}},
        "Timestep": {"Timestep 1": {"number_of_timesteps_per_hour": 4}},
        "RunPeriod": {"Year": {"begin_month": 1, "begin_day_of_month": 1, "end_month": 12, "end_day_of_month": 31,
                      "day_of_week_for_start_day": "Monday"}},
        "Site:Location": {"Denver": {"latitude": 39.83, "longitude": -104.65, "time_zone": -7.0, "elevation": 1650.0}},
        "GlobalGeometryRules": {"GlobalGeometryRules 1": {"starting_vertex_position": "UpperLeftCorner",
                                "vertex_entry_direction": "Counterclockwise", "coordinate_system": "Relative"}},
        "Zone": {"Z": {}},
        "Material": {}, "Material:NoMass": {}, "Construction": {},
        "WindowMaterial:Glazing": {"Glass600": {"optical_data_type": "SpectralAverage", "thickness": 0.003048,
                                   "solar_transmittance_at_normal_incidence": 0.834,
                                   "front_side_solar_reflectance_at_normal_incidence": 0.075,
                                   "back_side_solar_reflectance_at_normal_incidence": 0.075,
                                   "visible_transmittance_at_normal_incidence": 0.834,
                                   "front_side_visible_reflectance_at_normal_incidence": 0.075,
                                   "back_side_visible_reflectance_at_normal_incidence": 0.075,
                                   "infrared_transmittance_at_normal_incidence": 0.0,
                                   "front_side_infrared_hemispherical_emissivity": 0.84,
                                   "back_side_infrared_hemispherical_emissivity": 0.84, "conductivity": 1.0}},
        "WindowMaterial:Gas": {"Air12": {"gas_type": "Air", "thickness": 0.012}},
        "ScheduleTypeLimits": {"Any": {}},
        "Schedule:Constant": {"one": {"schedule_type_limits_name": "Any", "hourly_value": 1.0},
                              "heat20": {"schedule_type_limits_name": "Any", "hourly_value": 20.0},
                              "cool27": {"schedule_type_limits_name": "Any", "hourly_value": 27.0},
                              "dual": {"schedule_type_limits_name": "Any", "hourly_value": 4}},
        "OtherEquipment": {"gain200": {"zone_or_zonelist_or_space_or_spacelist_name": "Z", "schedule_name": "one",
                           "fuel_type": "None", "design_level_calculation_method": "EquipmentLevel", "design_level": 200.0,
                           "fraction_latent": 0.0, "fraction_radiant": 0.6, "fraction_lost": 0.0}},
        "ZoneInfiltration:DesignFlowRate": {"inf": {"zone_or_zonelist_or_space_or_spacelist_name": "Z", "schedule_name": "one",
                                            "design_flow_rate_calculation_method": "AirChanges/Hour", "air_changes_per_hour": 0.5,
                                            "constant_term_coefficient": 1, "temperature_term_coefficient": 0,
                                            "velocity_term_coefficient": 0, "velocity_squared_term_coefficient": 0}},
        "Output:Variable": {
            "v1": {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Heating Energy", "reporting_frequency": "Hourly"},
            "v2": {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Cooling Energy", "reporting_frequency": "Hourly"},
            "v3": {"key_value": "*", "variable_name": "Zone Mean Air Temperature", "reporting_frequency": "Hourly"},
            "v4": {"key_value": "*", "variable_name": "Surface Window Transmitted Solar Radiation Energy", "reporting_frequency": "RunPeriod"},
            "v5": {"key_value": "*", "variable_name": "Surface Outside Face Incident Solar Radiation Rate per Area", "reporting_frequency": "Hourly"},
        },
        "Output:SQLite": {"Output:SQLite 1": {"option_type": "Simple"}},
    }
    used = set()
    for cname in (wall, floor, roof):
        for (n, d, k, cp, rho) in LAYERS[cname]:
            t, nm, o = mat(n, d, k, cp, rho)
            ep[t][nm] = o
        c = {"outside_layer": LAYERS[cname][0][0]}
        for j, l in enumerate(LAYERS[cname][1:], start=2):
            c[f"layer_{j}"] = l[0]
        ep["Construction"][cname] = c
        used.add(cname)
    ep["Construction"]["win600"] = {"outside_layer": "Glass600", "layer_2": "Air12", "layer_3": "Glass600"}
    S = {}
    def surf(name, typ, cons, pts, boundary="Outdoors", sun="SunExposed", wind="WindExposed"):
        S[name] = {"surface_type": typ, "construction_name": cons, "zone_name": "Z", "outside_boundary_condition": boundary,
                   "sun_exposure": sun, "wind_exposure": wind, "vertices": verts(pts)}
    h = 2.7
    surf("south", "Wall", wall, [(0, 0, h), (0, 0, 0), (8, 0, 0), (8, 0, h)])
    surf("north", "Wall", wall, [(8, 6, h), (8, 6, 0), (0, 6, 0), (0, 6, h)])
    surf("east", "Wall", wall, [(8, 0, h), (8, 0, 0), (8, 6, 0), (8, 6, h)])
    surf("west", "Wall", wall, [(0, 6, h), (0, 6, 0), (0, 0, 0), (0, 0, h)])
    surf("roof", "Roof", roof, [(0, 6, h), (0, 0, h), (8, 0, h), (8, 6, h)])
    surf("floor", "Floor", floor, [(8, 6, 0), (8, 0, 0), (0, 0, 0), (0, 6, 0)], sun="NoSun", wind="NoWind")
    ep["BuildingSurface:Detailed"] = S
    W = {}
    for nm, x0, x1 in (("win_a", 0.5, 3.5), ("win_b", 4.5, 7.5)):
        W[nm] = {"surface_type": "Window", "construction_name": "win600", "building_surface_name": "south", "number_of_vertices": 4,
                 "vertex_1_x_coordinate": x0, "vertex_1_y_coordinate": 0, "vertex_1_z_coordinate": 2.2,
                 "vertex_2_x_coordinate": x0, "vertex_2_y_coordinate": 0, "vertex_2_z_coordinate": 0.2,
                 "vertex_3_x_coordinate": x1, "vertex_3_y_coordinate": 0, "vertex_3_z_coordinate": 0.2,
                 "vertex_4_x_coordinate": x1, "vertex_4_y_coordinate": 0, "vertex_4_z_coordinate": 2.2}
    ep["FenestrationSurface:Detailed"] = W
    if "simple_window" in flags:
        ep["WindowMaterial:SimpleGlazingSystem"] = {"win600_simple": {"u_factor": 2.8697, "solar_heat_gain_coefficient": 0.7597,
                                                     "visible_transmittance": 0.7}}
        ep["Construction"]["win600"] = {"outside_layer": "win600_simple"}
        del ep["WindowMaterial:Glazing"], ep["WindowMaterial:Gas"]
    conv = {}
    if "hce20" in flags:
        conv["SurfaceProperty:ConvectionCoefficients:MultipleSurface"] = {"ext": {"surface_type": "AllExteriorSurfaces",
            "convection_coefficient_1_location": "Outside", "convection_coefficient_1_type": "Value", "convection_coefficient_1": 20.0}}
    if "hci_iso" in flags:
        hci = {"south": 2.5, "north": 2.5, "east": 2.5, "west": 2.5, "roof": 5.0, "floor": 0.7, "win_a": 2.5, "win_b": 2.5}
        conv["SurfaceProperty:ConvectionCoefficients"] = {f"in_{n}": {"surface_name": n, "convection_coefficient_1_location": "Inside",
            "convection_coefficient_1_type": "Value", "convection_coefficient_1": v} for n, v in hci.items()}
    ep.update(conv)
    if not free:
        ep["ZoneHVAC:IdealLoadsAirSystem"] = {"ideal": {"zone_supply_air_node_name": "Z_supply", "heating_limit": "NoLimit",
                                              "cooling_limit": "NoLimit", "dehumidification_control_type": "None",
                                              "humidification_control_type": "None"}}
        ep["ZoneHVAC:EquipmentList"] = {"eqlist": {"load_distribution_scheme": "SequentialLoad", "equipment": [{
            "zone_equipment_object_type": "ZoneHVAC:IdealLoadsAirSystem", "zone_equipment_name": "ideal",
            "zone_equipment_cooling_sequence": 1, "zone_equipment_heating_or_no_load_sequence": 1}]}}
        ep["ZoneHVAC:EquipmentConnections"] = {"conn": {"zone_name": "Z", "zone_conditioning_equipment_list_name": "eqlist",
                                               "zone_air_inlet_node_or_nodelist_name": "Z_supply", "zone_air_node_name": "Z_air",
                                               "zone_return_air_node_or_nodelist_name": "Z_return"}}
        ep["ThermostatSetpoint:DualSetpoint"] = {"dsp": {"heating_setpoint_temperature_schedule_name": "heat20",
                                                 "cooling_setpoint_temperature_schedule_name": "cool27"}}
        ep["ZoneControl:Thermostat"] = {"tstat": {"zone_or_zonelist_name": "Z", "control_type_schedule_name": "dual",
                                        "control_1_object_type": "ThermostatSetpoint:DualSetpoint", "control_1_name": "dsp"}}
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
    def series(name):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods)
            order by t.TimeIndex""", (name,))]
    heat, cool, tz = series("Zone Ideal Loads Zone Sensible Heating Energy"), series("Zone Ideal Loads Zone Sensible Cooling Energy"), series("Zone Mean Air Temperature")
    trans = sum(series("Surface Window Transmitted Solar Radiation Energy"))
    con.close()
    out = {"severe": sev, "warnings": len(re.findall(r"\*\* Warning \*\*", err)), "transmitted_solar_mwh": trans / 3.6e9}
    if heat:
        out.update({"heat_mwh": sum(heat) / 3.6e9, "cool_mwh": sum(cool) / 3.6e9, "peak_heat_kw": max(heat) / 3.6e6, "peak_cool_kw": max(cool) / 3.6e6})
    out.update({"min_c": min(tz), "max_c": max(tz), "mean_c": sum(tz) / len(tz)})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    if hashlib.sha256(MOS.read_bytes()).hexdigest() != MOS_SHA:
        raise SystemExit("Denver .mos sha mismatch")
    runs = Path(a.runs or tempfile.mkdtemp(prefix="103_bestest_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    mos_to_epw(MOS, epw)
    res = {"source": "validation/energyplus/103_bestest_twin.py", "weather_mos_sha256": MOS_SHA, "ranges": RANGES, "cases": {}}
    for case in ("600", "900", "600FF", "900FF"):
        r = run(a.energyplus, model(case, case.endswith("FF")), epw, runs / case)
        res["cases"][case] = r
        print(case, {k: round(v, 3) if isinstance(v, float) else v for k, v in r.items()})
    res["one_change"] = {}
    for name, flags in (("hce20", {"hce20"}), ("hci_iso", {"hci_iso"}), ("simple_window", {"simple_window"}),
                        ("all_three", {"hce20", "hci_iso", "simple_window"})):
        for case in ("600", "900", "900FF"):
            r = run(a.energyplus, model(case, case.endswith("FF"), frozenset(flags)), epw, runs / f"{case}_{name}")
            res["one_change"][f"{case}_{name}"] = r
            print(f"{case}_{name}", {k: round(v, 3) if isinstance(v, float) else v for k, v in r.items()})
    with open(runs / "version.txt", "w") as f:
        f.write(subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout)
    res["energyplus_version"] = (runs / "version.txt").read_text().strip()
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
