#!/usr/bin/env python3
"""
Brief 117 Part 2: the design heat loss against EnergyPlus held steady at the design conditions.

Each building is run in EnergyPlus on a weather file whose every hour is the design condition: dry bulb at the engine's
design outdoor temperature (docs/audit/117/02_engine_design.json, scripts/117_design.mts), no sun, a sky at the air
temperature (horizontal infrared = sigma T^4) and the wind at 4 m/s. There are no internal gains. Each room's ideal
loads hold it at its design internal temperature. Inside and outside convection are the engine's fixed coefficients
(104_attribution.py iso_conv). Two months are run, and the last hour is read, once it is the same as 24 hours before.

  cooled room   104_cooled_room.py's model (iso_conv), every room heated to its design temperature (the middle room
                to its stated 12 C), with infiltration at the spec's at-site rate and standard density.
  bridgewater   Brief 105's gate referee r2_z_gains_vent_std without its gains (108_bridgewater_capped.py's build
                with no add_gains), heated to 21 C with cooling off. Ground at the anchor EPW's annual mean, as before.

Compared with each room's design heat loss less its minimum-air-change top-up and warm-up (neither is in EnergyPlus;
both are checked by hand in the Part 1 tests).
Gate, stated in the brief before running: each room within +-3 %, the building within +-2 %.

Usage: python3 -I validation/energyplus/117_design_referee.py --energyplus <path> --gains <dir> [--runs <dir>]
Writes docs/audit/117/02_referee.json. Nothing touches data/ or a database.
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
ENGINE = REPO / "docs/audit/117/02_engine_design.json"
SPEC_SITE_ACH = json.loads((HERE / "104_cooled_room_spec.json").read_text())["infiltration_ach_at_site"]
OUT = REPO / "docs/audit/117/02_referee.json"
SIGMA = 5.670374419e-8
WIND = 4.0
ROOM_GATE, BUILDING_GATE = 0.03, 0.02
# 'iso_conv': the engine's year-run surface physics (fixed convection, long-wave between faces), as built first.
# 'combined': the design method's own films (combined_films). See docs/audit/117/02_referee.md for why both.
VARIANTS = ("iso_conv", "combined")
AIR_VARS = ("Zone Infiltration Sensible Heat Loss Energy", "Zone Ventilation Sensible Heat Loss Energy")


def load(name: str, file: str):
    s = importlib.util.spec_from_file_location(name, HERE / file)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)  # type: ignore[union-attr]
    return m


def steady_epw(src: Path, dst: Path, t: float) -> None:
    """Every hour of src at dry bulb t, no sun, sky at t, wind WIND, pressure constant, no rain or snow; the header kept."""
    lines = src.read_text(encoding="latin-1").splitlines()
    p0 = lines[8].split(",")[9]  # the first hour's station pressure, held all year
    out = []
    for i, l in enumerate(lines):
        f = l.split(",")
        if i < 8 or len(f) < 22:
            out.append(l)
            continue
        f[6] = f"{t:.2f}"                          # dry bulb
        f[7] = f"{t - 2:.2f}"                      # dew point (no latent load in ideal loads here)
        f[8] = "86"                                # relative humidity
        f[9] = p0                                  # station pressure, constant
        f[10] = f[11] = "0"                        # extraterrestrial radiation
        f[12] = f"{SIGMA * (t + 273.15) ** 4:.1f}"  # horizontal infrared: a sky at the air temperature
        for k in (13, 14, 15, 16, 17, 18, 19):     # global, direct, diffuse radiation and illuminance
            f[k] = "0"
        f[21] = f"{WIND:.1f}"
        f[26], f[27] = "9", "999999999"            # no present weather (no rain on the surfaces)
        for k, v in ((30, "0"), (31, "88"), (33, "0"), (34, "0")):  # no snow, no rain
            if k < len(f):
                f[k] = v
        out.append(",".join(f))
    dst.write_text("\n".join(out) + "\n", encoding="latin-1")


# The design method's surface films (ISO 6946, as the engine's U-values hold them): inside, convection and radiation
# together to surroundings at the room's temperature; outside, 0.04 m2K/W.
COMBINED_IN = {"Wall": 1 / 0.13, "Roof": 1 / 0.10, "Ceiling": 1 / 0.10, "Floor": 1 / 0.17}
COMBINED_OUT = 1 / 0.04


def combined_films(ep: dict, notes: list) -> None:
    """The method's own assumption in EnergyPlus: each face's film all by convection at the ISO 6946 combined value,
    and long-wave radiation off (every material's thermal absorptance 0.001), so no face exchanges heat with another.
    Glazing keeps its fixed emissivity (WindowMaterial:SimpleGlazingSystem has no input for it)."""
    cc = {}
    for n, o in ep["BuildingSurface:Detailed"].items():
        c = {"surface_name": n, "convection_coefficient_1_location": "Inside", "convection_coefficient_1_type": "Value",
             "convection_coefficient_1": COMBINED_IN[o["surface_type"]]}
        if o["outside_boundary_condition"] == "Outdoors":
            c.update({"convection_coefficient_2_location": "Outside", "convection_coefficient_2_type": "Value", "convection_coefficient_2": COMBINED_OUT})
        cc[f"cf_{n}"] = c
    for n in ep.get("FenestrationSurface:Detailed", {}):
        cc[f"cf_{n}"] = {"surface_name": n, "convection_coefficient_1_location": "Inside", "convection_coefficient_1_type": "Value",
                         "convection_coefficient_1": COMBINED_IN["Wall"], "convection_coefficient_2_location": "Outside",
                         "convection_coefficient_2_type": "Value", "convection_coefficient_2": COMBINED_OUT}
    ep.pop("SurfaceProperty:ConvectionCoefficients:MultipleSurface", None)
    ep["SurfaceProperty:ConvectionCoefficients"] = cc
    n = 0
    for k in ("Material", "Material:NoMass"):
        for m in ep.get(k, {}).values():
            m["thermal_absorptance"] = 0.001
            n += 1
    notes.append(f"combined_films: ISO 6946 combined films as convection on {len(cc)} surfaces; long-wave off on {n} materials")


def week(ep: dict) -> None:
    for rp in ep["RunPeriod"].values():
        rp.update({"begin_month": 1, "begin_day_of_month": 1, "end_month": 2, "end_day_of_month": 28})


def run(energyplus: str, ep: dict, epw: Path, d: Path) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    ep.setdefault("Output:Variable", {})["h_117"] = {"key_value": "*", "variable_name": "Zone Ideal Loads Zone Sensible Heating Energy", "reporting_frequency": "Hourly"}
    ep["Output:Variable"]["t_117"] = {"key_value": "*", "variable_name": "Zone Mean Air Temperature", "reporting_frequency": "Hourly"}
    for i, v in enumerate(AIR_VARS):
        ep["Output:Variable"][f"a_117_{i}"] = {"key_value": "*", "variable_name": v, "reporting_frequency": "Hourly"}
    ep["Output:SQLite"] = {"Output:SQLite 1": {"option_type": "Simple"}}
    (d / "in.epJSON").write_text(json.dumps(ep, indent=1))
    p = subprocess.run([energyplus, "-w", str(epw), "-d", str(d), str(d / "in.epJSON")], capture_output=True, text=True)
    err = (d / "eplusout.err").read_text(errors="replace") if (d / "eplusout.err").exists() else p.stderr
    if p.returncode != 0 or re.search(r"\*\*  Fatal  \*\*|\*\* Severe  \*\*", err):
        raise SystemExit(f"EnergyPlus failed in {d}\n{err[-3000:]}")
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name, key):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency = 'Hourly'
            and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    out = {}
    for z in ep["Zone"]:
        ideal = next(n for n, o in ep["ZoneHVAC:EquipmentConnections"].items() if o["zone_name"] == z)
        eq = ep["ZoneHVAC:EquipmentList"][ep["ZoneHVAC:EquipmentConnections"][ideal]["zone_conditioning_equipment_list_name"]]
        key = eq["equipment"][0]["zone_equipment_name"]
        h = series("Zone Ideal Loads Zone Sensible Heating Energy", key)
        tz = series("Zone Mean Air Temperature", z)
        w, w24 = h[-1] / 3600.0, h[-25] / 3600.0
        if abs(w - w24) > 1e-3 * max(1.0, w):
            raise SystemExit(f"{z}: not steady ({w:.2f} W now, {w24:.2f} W a day before)")
        air = sum((series(v, z) or [0.0])[-1] for v in AIR_VARS) / 3600.0
        out[z] = {"w": w, "air_c": tz[-1], "air_w": air}
    con.close()
    out_v = subprocess.run([energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    return {"zones": out, "warnings": len(re.findall(r"\*\* Warning \*\*", err)), "version": out_v}


def compare(engine: dict, ep_zones: dict, names: dict) -> dict:
    rows, e_tot, p_tot = {}, 0.0, 0.0
    for z in engine["zones"]:
        t = z["terms_w"]
        calc = z["total_w"] - t.get("minimum_air_change", 0.0) - t.get("warm_up", 0.0)
        ep_w = ep_zones[names[z["zone_id"]]]["w"]
        # Attribution (Rule 10): the air terms each side; the rest is fabric (conduction, bridging, ground, partitions).
        air = sum(t.get(k, 0.0) for k in ("infiltration", "vents", "mechanical_ventilation"))
        ep_air = ep_zones[names[z["zone_id"]]]["air_w"]
        rows[z["zone_id"]] = {"engine_w": round(calc, 2), "energyplus_w": round(ep_w, 2), "diff_pct": round(100 * (calc - ep_w) / ep_w, 3),
                              "energyplus_air_c": round(ep_zones[names[z["zone_id"]]]["air_c"], 3), "internal_c": z["internal_c"],
                              "air_engine_w": round(air, 2), "air_energyplus_w": round(ep_air, 2),
                              "fabric_engine_w": round(calc - air, 2), "fabric_energyplus_w": round(ep_w - ep_air, 2),
                              "pass": abs(calc - ep_w) <= ROOM_GATE * ep_w}
        if z["heated"]:
            e_tot += calc
            p_tot += ep_w
    b = {"engine_w": round(e_tot, 2), "energyplus_w": round(p_tot, 2), "diff_pct": round(100 * (e_tot - p_tot) / p_tot, 3),
         "pass": abs(e_tot - p_tot) <= BUILDING_GATE * p_tot}
    return {"rooms": rows, "building_heated": b}


def cooled(a, eng: dict, root: Path, variant: str) -> dict:
    C = load("cooled", "104_cooled_room.py")
    B = C.B
    ep = C.model(frozenset({"iso_conv"}))
    notes = ["104_cooled_room.py model, iso_conv; every room heated to its design temperature; two months at the design condition"]
    # Air at EnergyPlus's standard density (20 C at the site's pressure), as Bridgewater's (105 std_density), at 104's
    # at-site rate. With the default (outdoor-air density) the design temperature's colder, denser air carries 15 %
    # more heat than the engine's 0.33 Wh/m3K at the sea-level rate (first run, 16 Nov, in 02_referee.md).
    for o in ep["ZoneInfiltration:DesignFlowRate"].values():
        o["air_changes_per_hour"] = SPEC_SITE_ACH
        o["density_basis"] = "Standard"
    notes.append(f"infiltration {SPEC_SITE_ACH} ach at standard density")
    if variant == "combined":
        combined_films(ep, notes)
    week(ep)
    temps = {z["zone_id"]: z["internal_c"] for z in eng["zones"]}
    # Every room heated to its design temperature (the middle room is cooled in 104's model).
    ep.pop("ThermostatSetpoint:SingleCooling", None)
    ep.setdefault("ThermostatSetpoint:SingleHeating", {})
    for z, t in temps.items():
        ep["Schedule:Constant"][f"{z}_sp"]["hourly_value"] = t
        ep["Schedule:Constant"][f"{z}_ctl"]["hourly_value"] = 1
        ep["ThermostatSetpoint:SingleHeating"][f"{z}_tsp"] = {"setpoint_temperature_schedule_name": f"{z}_sp"}
        ep["ZoneControl:Thermostat"][f"{z}_tstat"]["control_1_object_type"] = "ThermostatSetpoint:SingleHeating"
    root.mkdir(parents=True, exist_ok=True)
    src = root / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, src)
    epw = root / "cooled_design.epw"
    steady_epw(src, epw, eng["outdoor_c"])
    r = run(a.energyplus, ep, epw, root / f"cooled_{variant}")
    return {"notes": notes,
            "warnings": r["warnings"], "energyplus_version": r["version"], "epw_sha256": hashlib.sha256(epw.read_bytes()).hexdigest(),
            **compare(eng, r["zones"], {z: z for z in temps})}


def bridgewater(a, eng: dict, root: Path, variant: str) -> dict:
    BWC = load("bwc", "108_bridgewater_capped.py")
    G, A, Z, R = BWC.G, BWC.A, BWC.Z, BWC.R
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    today, psi, tg = R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW)
    flags = G.RUNS["r2_z_gains_vent_std"]
    ep, notes = A.build_run([f for f in flags if f not in ("tb_by_zone", "inf_by_zone", "slab_reversed", "gains", "vent", "std_density")], fx, today, psi, tg)
    Z.slab_reversed(ep, notes)
    Z.tb_by_zone(ep, fx, psi, notes)
    Z.inf_by_zone(ep, notes)
    G.add_vent(ep, Path(a.gains), notes)
    for k in ("ZoneVentilation:DesignFlowRate", "ZoneInfiltration:DesignFlowRate"):
        for o in ep.get(k, {}).values():
            o["density_basis"] = "Standard"
    A.iso_conv(ep, notes)
    if variant == "combined":
        combined_films(ep, notes)
    week(ep)
    t = {z["internal_c"] for z in eng["zones"]}
    if len(t) != 1:
        raise SystemExit(f"bridgewater: one design temperature expected, got {t}")
    t = t.pop()
    ep["Schedule:Compact"]["hotel_heating_setpoint"] = {"schedule_type_limits_name": "Temperature",
        "data": [{"field": "Through: 12/31"}, {"field": "For: AllDays"}, {"field": "Until: 24:00"}, {"field": t}]}
    ep["Schedule:Compact"]["hotel_cooling_setpoint"] = {"schedule_type_limits_name": "Temperature",
        "data": [{"field": "Through: 12/31"}, {"field": "For: AllDays"}, {"field": "Until: 24:00"}, {"field": 99.0}]}
    notes.append(f"no gains; heating {t} C, cooling off; two months at the design condition")
    root.mkdir(parents=True, exist_ok=True)
    epw = root / "bridgewater_design.epw"
    steady_epw(R.EPW, epw, eng["outdoor_c"])
    r = run(a.energyplus, ep, epw, root / f"bridgewater_{variant}")
    zones = sorted(ep["Zone"])
    names = {z["zone_id"]: zones[i] for i, z in enumerate(eng["zones"])}
    return {"notes": notes, "warnings": r["warnings"], "energyplus_version": r["version"], "ground_c": tg,
            "epw_sha256": hashlib.sha256(epw.read_bytes()).hexdigest(), **compare(eng, r["zones"], names)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--gains", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    eng = json.loads(ENGINE.read_text())
    root = Path(a.runs or tempfile.mkdtemp(prefix="117_"))
    out = {"source": "validation/energyplus/117_design_referee.py", "engine": "docs/audit/117/02_engine_design.json",
           "engine_sha256": hashlib.sha256(ENGINE.read_bytes()).hexdigest(), "wind_m_s": WIND,
           "gate": {"room_pct": 100 * ROOM_GATE, "building_pct": 100 * BUILDING_GATE},
           "variants": {}}
    for v in VARIANTS:
        out["variants"][v] = {"cooled_room": cooled(a, eng["cooled_room"], root / "c", v), "bridgewater": bridgewater(a, eng["bridgewater"], root / "b", v)}
        for k in ("cooled_room", "bridgewater"):
            r = out["variants"][v][k]
            print(v, k, json.dumps({z: (x["diff_pct"], x["pass"]) for z, x in r["rooms"].items()}), json.dumps(r["building_heated"]), flush=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
