#!/usr/bin/env python3
"""
Brief 103 Part 5: the EnergyPlus fabric-only referee for the Bridgewater report baseline.

Builds the SAME building Engine 1 reads (validation/fixtures/report_baseline_v1.yaml, converted to a schema 2.1 model
document) as an EnergyPlus model with IdealLoads, then runs it. The assembler is used unchanged
(nza_engine/generators/epjson_assembler.py, mode "full", systems mode "ideal_loads"); this script only edits the
returned epJSON dict, and prints a check for every edit.

What the referee is (each one a stated input of the model document, or of the Building module's scope):
  * Envelope only. People, Lights, ElectricEquipment, operable openings and mechanical ventilation are DELETED from
    the model (CLAUDE.md rule 8: removed, not muted). What stays: fabric, glazing, infiltration (q50 / 20), the two
    permanent louvres on today's wind correlation, IdealLoads holding the comfort band (flat 21 / 24 °C, air
    temperature).
  * Window frame: the document's frame_fraction (0.2, TODAY.frame_fraction) stated as Engine 1 reads it: the
    window's U is a whole-window U over the full opening, and solar passes through the glass fraction only. In
    EnergyPlus that is the SimpleGlazingSystem SHGC = g x (1 - frame_fraction) on the full opening. No frame U is
    invented.
  * Outside solar absorptance of walls (0.6) and roof (0.7), outside emissivity 0.9: the document's values, set on
    the outside layer.
  * Ground: the document's method 'annual_mean_outdoor', the EPW's mean dry bulb, as Site:GroundTemperature:
    BuildingSurface for all 12 months (EnergyPlus otherwise defaults to 18 °C).
  * Thermal bridging: the document's ISO 14683 junctions x multiplier, each allocated to the element it belongs
    to: wall-to-roof on the roof, everything else (intermediate floors, ground-floor edge, corners, window
    perimeters) on the walls, nothing on the ground floor (Engine 1 drives every junction from outdoor air, not the
    ground). The assembler's uniform spread over wall, roof AND ground floor is switched off for this.
  * Wind: the document's louvre flow is Q = K x v with v the EPW wind speed. EnergyPlus scales wind to each zone's
    height by terrain (the assembler writes 'Urban', about 0.25-0.5 x the EPW speed at these heights), so the
    referee sets Site:WeatherStation and Site:HeightVariation to exponent 0 and no air-temperature gradient: every
    zone sees the EPW wind and the EPW dry bulb.

Physics the referee keeps as EnergyPlus's own (not aligned to Engine 1): surface convection and radiation, solar
distribution (FullExterior), angular glazing transmission, conduction transfer functions, 4 timesteps per hour, the
interior floor slabs as built by the geometry generator (5 floor zones).

Sensitivity variants change ONE thing from the referee, so each mismatch of the earlier Run Bi has a measured
effect, and 'bi_repro' puts all of Run Bi's inputs back to show this container reproduces it.

Usage:
  python3 -I validation/energyplus/103_referee.py --energyplus /path/to/energyplus [--variants all|r0]
Runs land in a scratch directory (--runs, default /tmp/... via tempfile); only the results JSON is written into the
repo (validation/energyplus/results/103_referee_fabric_only.json). Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

import yaml  # noqa: E402

from nza_engine.generators import epjson_assembler as A  # noqa: E402

FIXTURE = REPO / "validation/fixtures/report_baseline_v1.yaml"
EPW = REPO / "data/weather/current/GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw"
EPW_SHA = "c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2"
OUT_JSON = REPO / "validation/energyplus/results/103_referee_fabric_only.json"
UPGRADE_TS = REPO / "frontend/src/thermal/schema/upgrade.ts"

# ISO 14683 default psi, W/mK: frontend/src/thermal/engine/bridging.ts ISO14683_DEFAULT_PSI (read and checked below).
BRIDGING_TS = REPO / "frontend/src/thermal/engine/bridging.ts"
# ISO 6946 surface resistances (m2K/W) by element, as Engine 1's iso6946Films and the assembler's _apply_thermal_bridging.
FILMS = {"wall": (0.13, 0.04), "roof": (0.10, 0.04)}

KEEP_TOP = {"Zone", "BuildingSurface:Detailed", "FenestrationSurface:Detailed"}
FORBIDDEN = re.compile(r"VariableRefrigerant|Coil:|Fan:|Boiler|WaterHeater|Plant|Pump|Chiller|AirTerminal|"
                       r"HeatExchanger|OutdoorAir|AirLoopHVAC|WaterUse|ZoneHVAC:(?!IdealLoadsAirSystem|EquipmentList|EquipmentConnections)")

VARIANTS = {
    "r0": "the referee",
    "urban_wind": "r0 with the assembler's Urban terrain wind and temperature height scaling",
    "ground_18": "r0 with EnergyPlus's default 18 C ground",
    "no_frame": "r0 with SHGC = g on the full opening (no frame)",
    "uniform_bridging": "r0 with the assembler's uniform bridging dU over wall, roof and ground floor",
    "mass_250": "r0 plus 250 kJ/m2K x floor area on each zone's air node (ZoneCapacitanceMultiplier)",
    "library_absorptance": "r0 with the library layers' solar absorptance (0.7) instead of the document's",
    "bi_repro": "Run Bi's inputs: Urban wind, 18 C ground, no frame, uniform bridging, library absorptance",
}
VARIANT_FLAGS = {
    "r0": set(),
    "urban_wind": {"urban"},
    "ground_18": {"ground18"},
    "no_frame": {"noframe"},
    "uniform_bridging": {"uniform_tb"},
    "mass_250": {"mass"},
    "library_absorptance": {"lib_abs"},
    "bi_repro": {"urban", "ground18", "noframe", "uniform_tb", "lib_abs"},
}


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def today_constants() -> dict:
    """The TODAY constants the 2.0 -> 2.1 upgrade writes into the document (read from upgrade.ts, not retyped)."""
    src = UPGRADE_TS.read_text()
    got = {}
    for key in ("wall_solar_absorptance", "roof_solar_absorptance", "outside_emissivity", "frame_fraction",
                "internal_heat_capacity_j_per_k_m2"):
        m = re.search(rf"\b{key}:\s*([0-9_.]+)", src)
        if not m:
            raise SystemExit(f"upgrade.ts: {key} not found")
        got[key] = float(m.group(1).replace("_", ""))
    return got


def iso14683_psi() -> dict:
    src = BRIDGING_TS.read_text()
    block = re.search(r"ISO14683_DEFAULT_PSI\s*=\s*\{(.*?)\}", src, re.S).group(1)
    return {k: float(v) for k, v in re.findall(r"(\w+):\s*([0-9.]+)", block)}


def epw_mean_dry_bulb(epw: Path) -> float:
    rows = epw.read_text(encoding="latin-1").splitlines()[8:]
    vals = [float(r.split(",")[6]) for r in rows if r.strip()]
    return sum(vals) / len(vals)


def poly_area(obj: dict) -> float:
    """Area of a planar polygon in 3-D (Newell). Surfaces carry a 'vertices' list; windows carry vertex_N_x_coordinate fields."""
    nx = ny = nz = 0.0
    if "vertices" in obj:
        pts = [(v["vertex_x_coordinate"], v["vertex_y_coordinate"], v["vertex_z_coordinate"]) for v in obj["vertices"]]
    else:
        pts = [(obj[f"vertex_{i}_x_coordinate"], obj[f"vertex_{i}_y_coordinate"], obj[f"vertex_{i}_z_coordinate"])
               for i in range(1, int(obj["number_of_vertices"]) + 1)]
    for i, (x0, y0, z0) in enumerate(pts):
        x1, y1, z1 = pts[(i + 1) % len(pts)]
        nx += (y0 - y1) * (z0 + z1)
        ny += (z0 - z1) * (x0 + x1)
        nz += (x0 - x1) * (y0 + y1)
    return 0.5 * math.sqrt(nx * nx + ny * ny + nz * nz)


def construction_r(ep: dict, cname: str) -> tuple[float, str]:
    """Sum of layer resistances (no films) and the first NoMass layer's name."""
    c = ep["Construction"][cname]
    layers = [c["outside_layer"]] + [c[k] for k in sorted(k for k in c if k.startswith("layer_"))]
    r, insul = 0.0, None
    for ln in layers:
        if ln in ep.get("Material:NoMass", {}):
            r += ep["Material:NoMass"][ln]["thermal_resistance"]
            insul = insul or ln
        else:
            m = ep["Material"][ln]
            r += m["thickness"] / m["conductivity"]
    return r, insul


def build(flags: set, fx: dict, today: dict, psi: dict, t_ground: float, checks: list) -> tuple[dict, dict]:
    bc = copy.deepcopy(fx["building_config"])
    choices = copy.deepcopy(fx["construction_choices"])
    info: dict = {}

    original_tb = A._apply_thermal_bridging
    if "uniform_tb" not in flags:
        A._apply_thermal_bridging = lambda _c, _b: 0.0
    try:
        ep = A.assemble_epjson(bc, choices, EPW, systems_config={"mode": "ideal_loads"}, mode="full")
    finally:
        A._apply_thermal_bridging = original_tb

    # Envelope only: delete, don't mute.
    for k in ("People", "Lights", "ElectricEquipment", "ZoneVentilation:WindandStackOpenArea"):
        ep.pop(k, None)
    dfr = ep.get("ZoneVentilation:DesignFlowRate", {})
    ep["ZoneVentilation:DesignFlowRate"] = {n: o for n, o in dfr.items() if n.endswith("_permvent_louvre")}
    bad = sorted(k for k in ep if FORBIDDEN.search(k))
    checks.append(("no system objects other than IdealLoads", not bad, bad or "none"))
    checks.append(("IdealLoads in every zone", len(ep.get("ZoneHVAC:IdealLoadsAirSystem", {})) == len(ep["Zone"]),
                   f"{len(ep.get('ZoneHVAC:IdealLoadsAirSystem', {}))} of {len(ep['Zone'])}"))
    checks.append(("no People / Lights / ElectricEquipment / operable openings",
                   not any(k in ep for k in ("People", "Lights", "ElectricEquipment", "ZoneVentilation:WindandStackOpenArea")), "deleted"))
    vents = ep["ZoneVentilation:DesignFlowRate"]
    checks.append(("ZoneVentilation = the permanent louvres only", len(vents) == len(ep["Zone"]) and
                   all(v["velocity_term_coefficient"] == 1.0 and v["constant_term_coefficient"] == 0.0 for v in vents.values()),
                   f"{len(vents)} objects, design flow {sorted({v['design_flow_rate'] for v in vents.values()})} m3/s per (m/s)"))

    # Comfort band, flat, from the fixture's comfort_band (the Building module's band, not a system setpoint).
    lo, hi = float(fx["comfort_band"]["lower_c"]), float(fx["comfort_band"]["upper_c"])
    ep["Schedule:Compact"]["hotel_heating_setpoint"] = A._flat_temperature_schedule(lo)
    ep["Schedule:Compact"]["hotel_cooling_setpoint"] = A._flat_temperature_schedule(hi)
    tst = ep["ThermostatSetpoint:DualSetpoint"]
    checks.append(("thermostat = flat comfort band", all(t["heating_setpoint_temperature_schedule_name"] == "hotel_heating_setpoint"
                   and t["cooling_setpoint_temperature_schedule_name"] == "hotel_cooling_setpoint" for t in tst.values()), f"{lo} / {hi} C"))
    infil = ep["ZoneInfiltration:DesignFlowRate"]
    sch_inf = {o["schedule_name"] for o in infil.values()}
    inf_flat = all([f["field"] for f in ep["Schedule:Compact"][s]["data"]] == ["Through: 12/31", "For: AllDays", "Until: 24:00", 1.0]
                   for s in sch_inf)
    info["infiltration_ach"] = sorted({o["air_changes_per_hour"] for o in infil.values()})
    checks.append(("infiltration = q50 / 20 on an always-1 schedule", sch_inf == {"hotel_ventilation_continuous"} and inf_flat,
                   f"{info['infiltration_ach']} ach"))

    # Window frame: SHGC = g x (1 - frame fraction) on the full opening; U is the whole-window U.
    gl = ep["WindowMaterial:SimpleGlazingSystem"]
    for name, o in gl.items():
        g = o["solar_heat_gain_coefficient"]
        o["solar_heat_gain_coefficient"] = g if "noframe" in flags else round(g * (1 - today["frame_fraction"]), 6)
        info.setdefault("glazing", {})[name] = {"u": o["u_factor"], "g": g, "shgc_used": o["solar_heat_gain_coefficient"]}

    # Outside solar absorptance and emissivity, from the document's TODAY values.
    if "lib_abs" not in flags:
        for cname, key in ((choices["external_wall"], "wall_solar_absorptance"), (choices["roof"], "roof_solar_absorptance")):
            outer = ep["Construction"][cname]["outside_layer"]
            mat = ep["Material:NoMass"].get(outer) or ep["Material"][outer]
            mat["solar_absorptance"] = today[key]
            mat["thermal_absorptance"] = today["outside_emissivity"]
            info.setdefault("outside_layers", {})[cname] = {"layer": outer, "solar_absorptance": today[key],
                                                            "thermal_absorptance": today["outside_emissivity"]}

    # Ground.
    if "ground18" not in flags:
        ep["Site:GroundTemperature:BuildingSurface"] = {"Site:GroundTemperature:BuildingSurface 1": {
            f"{m}_ground_temperature": round(t_ground, 4) for m in
            ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december")}}

    # Wind and outdoor temperature at every zone = the EPW values.
    if "urban" not in flags:
        ep["Site:WeatherStation"] = {"Site:WeatherStation 1": {
            "wind_sensor_height_above_ground": 10.0, "wind_speed_profile_exponent": 0.0,
            "wind_speed_profile_boundary_layer_thickness": 270.0, "air_temperature_sensor_height_above_ground": 1.5}}
        ep["Site:HeightVariation"] = {"Site:HeightVariation 1": {
            "wind_speed_profile_exponent": 0.0, "wind_speed_profile_boundary_layer_thickness": 270.0,
            "air_temperature_gradient_coefficient": 0.0}}

    # Areas from the generated geometry (the exact surfaces EnergyPlus integrates).
    surf, win = ep["BuildingSurface:Detailed"], ep["FenestrationSurface:Detailed"]
    a_win = {n: poly_area(w) for n, w in win.items()}
    a_by = {"wall": 0.0, "roof": 0.0, "floor": 0.0}
    for n, s in surf.items():
        if s["outside_boundary_condition"] == "Outdoors" and s["surface_type"] == "Wall":
            a_by["wall"] += poly_area(s) - sum(a for wn, a in a_win.items() if win[wn]["building_surface_name"] == n)
        elif s["outside_boundary_condition"] == "Outdoors" and s["surface_type"] == "Roof":
            a_by["roof"] += poly_area(s)
        elif s["outside_boundary_condition"] == "Ground":
            a_by["floor"] += poly_area(s)
    a_glz = {}
    for wn, w in win.items():
        face = w["building_surface_name"].split("_")[-1]
        a_glz[face] = a_glz.get(face, 0.0) + a_win[wn]
    info["areas_m2"] = {**{k: round(v, 3) for k, v in a_by.items()}, "glazing": round(sum(a_win.values()), 3)}

    # Bridging, per element (Engine 1's junctions: bridging.ts computeBridging).
    tb = bc.get("thermal_bridges") or {}
    mult = float(tb.get("multiplier", 1))
    L, W, nf, fh = float(bc["length"]), float(bc["width"]), int(bc["num_floors"]), float(bc["floor_height"])
    perim = 2 * (L + W)
    facade_glz = {"N": 0.0, "E": 0.0, "S": 0.0, "W": 0.0}
    for k, v in a_glz.items():
        facade_glz[k] = facade_glz.get(k, 0.0) + v
    # One glazing surface per facade in Engine 1's document: its area is the facade's glazing summed over storeys.
    junctions = {
        "wall_to_roof": perim, "wall_to_intermediate_floor": perim * max(0, nf - 1), "wall_to_ground_floor": perim,
        "external_corner": 4 * nf * fh, "window_perimeter": sum(4 * math.sqrt(a) for a in facade_glz.values() if a > 0),
        "door_perimeter": 0.0,
    }
    h = {k: junctions[k] * psi[k] * mult for k in junctions}
    H = sum(h.values())
    H_assembler = A._nza_thermal_bridging_H_TB(bc)
    checks.append(("Engine 1 junctions = the assembler's _nza_thermal_bridging_H_TB (within 0.1 W/K)", abs(H - H_assembler) <= 0.1,
                   f"{H:.3f} vs {H_assembler:.3f} W/K"))
    H_roof = h["wall_to_roof"]
    H_wall = H - H_roof
    info["bridging"] = {"multiplier": mult, "junctions_m": {k: round(v, 4) for k, v in junctions.items()},
                        "h_w_per_k": {k: round(v, 4) for k, v in h.items()}, "total_w_per_k": round(H, 4),
                        "allocation": "uniform (assembler)" if "uniform_tb" in flags else {"roof": round(H_roof, 4), "wall": round(H_wall, 4), "ground_floor": 0}}
    if "uniform_tb" not in flags:
        applied = 0.0
        for elem, cname, h_e in (("wall", choices["external_wall"], H_wall), ("roof", choices["roof"], H_roof)):
            rsi, rse = FILMS[elem]
            r_layers, insul = construction_r(ep, cname)
            u_old = 1 / (rsi + rse + r_layers)
            u_new = u_old + h_e / a_by[elem]
            ep["Material:NoMass"][insul]["thermal_resistance"] += (1 / u_new) - (rsi + rse + r_layers)
            r2, _ = construction_r(ep, cname)
            applied += (1 / (rsi + rse + r2) - u_old) * a_by[elem]
            info["bridging"].setdefault("constructions", {})[cname] = {
                "u_iso6946_before": round(u_old, 5), "u_iso6946_after": round(1 / (rsi + rse + r2), 5),
                "insulation_layer": insul, "r_after": round(ep["Material:NoMass"][insul]["thermal_resistance"], 5)}
        checks.append(("bridging applied per element = Engine 1 H_TB (within 0.1 W/K)", abs(applied - H) <= 0.1,
                       f"{applied:.3f} vs {H:.3f} W/K (roof {H_roof:.2f}, walls {H_wall:.2f}, ground floor 0)"))

    if "mass" in flags:
        v_zone = L * W * fh
        rho_c = 1.2041 * 1005.0  # EnergyPlus's standard air (OutBaroPress at sea level, 20 C), J/m3K
        m = (rho_c * v_zone + today["internal_heat_capacity_j_per_k_m2"] * L * W) / (rho_c * v_zone)
        ep["ZoneCapacitanceMultiplier:ResearchSpecial"] = {"mass_250": {
            "temperature_capacity_multiplier": round(m, 4), "humidity_capacity_multiplier": 1.0,
            "carbon_dioxide_capacity_multiplier": 1.0, "generic_contaminant_capacity_multiplier": 1.0}}
        info["capacitance_multiplier"] = round(m, 4)

    # Outputs: replace the assembler's set with what this comparison reads.
    hourly = ["Zone Ideal Loads Zone Sensible Heating Energy", "Zone Ideal Loads Zone Sensible Cooling Energy",
              "Zone Ideal Loads Supply Air Total Heating Energy", "Zone Ideal Loads Supply Air Total Cooling Energy",
              "Zone Mean Air Temperature"]
    annual = ["Surface Inside Face Conduction Heat Transfer Energy", "Zone Infiltration Sensible Heat Loss Energy",
              "Zone Infiltration Sensible Heat Gain Energy", "Zone Ventilation Sensible Heat Loss Energy",
              "Zone Ventilation Sensible Heat Gain Energy", "Surface Window Transmitted Solar Radiation Energy",
              "Surface Window Heat Loss Energy", "Surface Window Heat Gain Energy", "Zone Total Internal Total Heating Energy"]
    ep["Output:Variable"] = {**{f"h_{i}": {"key_value": "*", "variable_name": v, "reporting_frequency": "Hourly"} for i, v in enumerate(hourly)},
                             **{f"a_{i}": {"key_value": "*", "variable_name": v, "reporting_frequency": "RunPeriod"} for i, v in enumerate(annual)}}
    for k in ("Output:Meter", "Output:VariableDictionary"):
        ep.pop(k, None)
    return ep, info


def run_ep(energyplus: str, ep: dict, d: Path) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    (d / "in.epJSON").write_text(json.dumps(ep, indent=1))
    p = subprocess.run([energyplus, "-w", str(EPW), "-d", str(d), str(d / "in.epJSON")], capture_output=True, text=True)
    err = (d / "eplusout.err").read_text(errors="replace") if (d / "eplusout.err").exists() else p.stderr
    sev = len(re.findall(r"\*\* Severe  \*\*", err))
    fat = len(re.findall(r"\*\*  Fatal  \*\*", err))
    warn = len(re.findall(r"\*\* Warning \*\*", err))
    if p.returncode != 0 or fat:
        raise SystemExit(f"EnergyPlus failed in {d} (rc {p.returncode}, severe {sev}, fatal {fat})\n{err[-3000:]}")
    con = sqlite3.connect(d / "eplusout.sql")
    q = """select d.Name, d.KeyValue, d.ReportingFrequency, t.Month, sum(r.Value)
             from ReportData r join ReportDataDictionary d on r.ReportDataDictionaryIndex = d.ReportDataDictionaryIndex
             join Time t on r.TimeIndex = t.TimeIndex
            where t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods)
            group by d.Name, d.KeyValue, d.ReportingFrequency, t.Month"""
    rows = con.execute(q).fetchall()
    monthly: dict = {}
    annual: dict = {}
    for name, key, freq, month, val in rows:
        if freq == "Hourly":
            monthly.setdefault(name, [0.0] * 12)[int(month) - 1] += val
        else:
            annual.setdefault(name, {})[key] = annual.setdefault(name, {}).get(key, 0.0) + val
    tmean = con.execute("""select avg(r.Value) from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
                           join Time t using (TimeIndex) where d.Name = 'Zone Mean Air Temperature'
                           and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods)""").fetchone()[0]
    ver = con.execute("select EnergyPlusVersion from Simulations").fetchone()[0]
    con.close()
    return {"monthly_j": monthly, "annual_j": annual, "zone_mean_air_c": tmean,
            "severe": sev, "fatal": fat, "warnings": warn, "version": ver}


MWH = 3.6e9


def summarise(res: dict, ep: dict) -> dict:
    mo = res["monthly_j"]
    heat = [v / MWH for v in mo["Zone Ideal Loads Zone Sensible Heating Energy"]]
    cool = [v / MWH for v in mo["Zone Ideal Loads Zone Sensible Cooling Energy"]]
    heat_sup = sum(mo["Zone Ideal Loads Supply Air Total Heating Energy"]) / MWH
    cool_sup = sum(mo["Zone Ideal Loads Supply Air Total Cooling Energy"]) / MWH
    an = res["annual_j"]
    surf = ep["BuildingSurface:Detailed"]
    win = ep["FenestrationSurface:Detailed"]
    cond = {"wall": 0.0, "roof": 0.0, "ground_floor": 0.0, "interior_slabs": 0.0}
    for key, v in an.get("Surface Inside Face Conduction Heat Transfer Energy", {}).items():
        name = next((n for n in list(surf) + list(win) if n.upper() == key.upper()), None)
        if name in win:
            continue
        if name and surf[name]["outside_boundary_condition"] == "Outdoors":
            cond["roof" if surf[name]["surface_type"] == "Roof" else "wall"] += v
        elif name and surf[name]["outside_boundary_condition"] == "Ground":
            cond["ground_floor"] += v
        else:
            cond["interior_slabs"] += v
    tot = lambda n: sum(an.get(n, {}).values()) / MWH  # noqa: E731
    return {
        "heating_mwh": round(sum(heat), 3), "cooling_mwh": round(sum(cool), 3),
        "heating_monthly_mwh": [round(v, 3) for v in heat], "cooling_monthly_mwh": [round(v, 3) for v in cool],
        "supply_air_total_heating_mwh": round(heat_sup, 3), "supply_air_total_cooling_mwh": round(cool_sup, 3),
        # Inside-face conduction, EnergyPlus sign: positive = heat INTO the zone. Annual net, MWh.
        "inside_face_conduction_net_mwh": {k: round(v / MWH, 3) for k, v in cond.items()},
        "infiltration_mwh": {"loss": round(tot("Zone Infiltration Sensible Heat Loss Energy"), 3), "gain": round(tot("Zone Infiltration Sensible Heat Gain Energy"), 3)},
        "permanent_vents_mwh": {"loss": round(tot("Zone Ventilation Sensible Heat Loss Energy"), 3), "gain": round(tot("Zone Ventilation Sensible Heat Gain Energy"), 3)},
        "window_transmitted_solar_mwh": round(tot("Surface Window Transmitted Solar Radiation Energy"), 3),
        # Window heat balance at the inside face (EnergyPlus's own window terms; opaque inside-face conduction does not cover windows).
        "window_heat_mwh": {"loss": round(tot("Surface Window Heat Loss Energy"), 3), "gain": round(tot("Surface Window Heat Gain Energy"), 3)},
        "internal_gains_mwh": round(tot("Zone Total Internal Total Heating Energy"), 3),
        "zone_mean_air_c": round(res["zone_mean_air_c"], 3),
        "severe": res["severe"], "fatal": res["fatal"], "warnings": res["warnings"],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--variants", default="all")
    ap.add_argument("--runs", default=None, help="scratch directory for EnergyPlus run folders")
    a = ap.parse_args()
    if sha256(EPW) != EPW_SHA:
        raise SystemExit("anchor EPW sha256 mismatch")
    fx = yaml.safe_load(FIXTURE.read_text())
    today, psi = today_constants(), iso14683_psi()
    t_ground = epw_mean_dry_bulb(EPW)
    runs = Path(a.runs or tempfile.mkdtemp(prefix="103_referee_"))
    names = list(VARIANTS) if a.variants == "all" else a.variants.split(",")
    out = {"brief": "103 Part 5", "fixture": str(FIXTURE.relative_to(REPO)), "fixture_sha256": sha256(FIXTURE),
           "weather": EPW.name, "weather_sha256": EPW_SHA, "ground_temperature_c": round(t_ground, 4),
           "document_constants": today, "iso14683_psi": psi, "timesteps_per_hour": None, "variants": {}}
    for n in names:
        checks: list = []
        ep, info = build(VARIANT_FLAGS[n], fx, today, psi, t_ground, checks)
        out["timesteps_per_hour"] = ep["Timestep"]["Timestep 1"]["number_of_timesteps_per_hour"]
        res = run_ep(a.energyplus, ep, runs / n)
        s = summarise(res, ep)
        checks.append(("internal gains = 0", s["internal_gains_mwh"] == 0, f"{s['internal_gains_mwh']} MWh"))
        checks.append(("0 severe, 0 fatal", res["severe"] == 0 and res["fatal"] == 0, f"{res['severe']} severe, {res['fatal']} fatal, {res['warnings']} warnings"))
        out["energyplus_version"] = res["version"]
        out["variants"][n] = {"what": VARIANTS[n], "inputs": info, **s,
                              "checks": [{"check": c, "ok": bool(ok), "detail": str(d)} for c, ok, d in checks]}
        print(f"\n== {n}: {VARIANTS[n]}")
        for c, ok, d in checks:
            print(f"  [{'ok' if ok else 'FAIL'}] {c}: {d}")
        print(f"  heating {s['heating_mwh']:.2f} MWh, cooling {s['cooling_mwh']:.2f} MWh (zone sensible); supply-air total "
              f"{s['supply_air_total_heating_mwh']:.2f} / {s['supply_air_total_cooling_mwh']:.2f}; mean air {s['zone_mean_air_c']:.2f} C")
        if not all(ok for _, ok, _ in checks):
            raise SystemExit(f"check failed in {n}")
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(out, indent=1) + "\n")
    print(f"\nwrote {OUT_JSON.relative_to(REPO)}; run folders in {runs}")


if __name__ == "__main__":
    main()
