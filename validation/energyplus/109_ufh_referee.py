#!/usr/bin/env python3
"""
Brief 109 Part 3: the cooled room with underfloor heating in its two heated rooms' floors, in EnergyPlus 25.2.0.

Part 2's cooled room on office hours with a 15 C night setback (109_setback_referee.model, EulerMethod), with each
heated room's ideal loads replaced by ZoneHVAC:LowTemperatureRadiant:Electric in its floor:
  * the floor's construction copied as "floor_src" with ConstructionProperty:InternalHeatSource, the source after
    layer 1 (the insulation's inside face: the engine's source_layer_index 0), one-dimensional;
  * heating design capacity = the case's limit per room (tight 800 W, mild 1,100 W), the engine's emitter output;
  * air temperature control, HalfFlowPower with a 0.5 K throttling range (docs/audit/109 decision 5: EnergyPlus
    controls a radiant system by a throttling range; the engine's control is ideal, holding the setpoint while it
    can; the difference is stated, not tuned), the heating setpoint schedule Part 2's.
The middle room keeps its ideal-loads cooling. The unlimited case has no meaning for a radiant system with a
throttling range, so the referee runs the limited cases only.

Reported per heated room as 109_setback_referee.summarise reports them, with the heat put into the floor ("Zone
Radiant HVAC Heating Energy") as the heating.

Usage: python3 -I validation/energyplus/109_ufh_referee.py --energyplus <path> [--runs <dir>]
Writes docs/audit/109/03_ufh_energyplus.json. Nothing touches data/ or a database.
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
s_ = importlib.util.spec_from_file_location("sbr", HERE / "109_setback_referee.py")
SBR = importlib.util.module_from_spec(s_)
s_.loader.exec_module(SBR)  # type: ignore[union-attr]
C, SB = SBR.C, SBR.SB
OUT = REPO / "docs/audit/109/03_ufh_energyplus.json"
THROTTLE_K = 0.5
SOURCE_AFTER_LAYER = 1  # EnergyPlus counts layers from 1, outside first: the engine's source_layer_index 0


def model(caps: dict) -> dict:
    ep = SBR.model(None, "EulerMethod")
    ep["Construction"]["floor_src"] = dict(ep["Construction"]["floor"])
    ep["ConstructionProperty:InternalHeatSource"] = {"floor_src_source": {
        "construction_name": "floor_src", "thermal_source_present_after_layer_number": SOURCE_AFTER_LAYER,
        "temperature_calculation_requested_after_layer_number": SOURCE_AFTER_LAYER, "dimensions_for_the_ctf_calculation": 1,
        "tube_spacing": 0.15, "two_dimensional_temperature_calculation_position": 0.0}}
    ep["ZoneHVAC:LowTemperatureRadiant:Electric"] = {}
    for r in C.SPEC["rooms"]:
        z = r["id"]
        if r["heat_c"] is None:
            continue
        ep["BuildingSurface:Detailed"][f"{z}_floor"]["construction_name"] = "floor_src"
        del ep["ZoneHVAC:IdealLoadsAirSystem"][f"{z}_ideal"]
        ep["ZoneHVAC:LowTemperatureRadiant:Electric"][f"{z}_ufh"] = {
            "availability_schedule_name": "one", "zone_name": z, "surface_name_or_radiant_surface_group_name": f"{z}_floor",
            "heating_design_capacity_method": "HeatingDesignCapacity", "heating_design_capacity": float(caps[z]),
            "temperature_control_type": "MeanAirTemperature", "setpoint_control_type": "HalfFlowPower",
            "heating_throttling_range": THROTTLE_K, "heating_setpoint_temperature_schedule_name": f"{z}_sp"}
        ep["ZoneHVAC:EquipmentList"][f"{z}_eq"]["equipment"] = [{
            "zone_equipment_object_type": "ZoneHVAC:LowTemperatureRadiant:Electric", "zone_equipment_name": f"{z}_ufh",
            "zone_equipment_cooling_sequence": 1, "zone_equipment_heating_or_no_load_sequence": 1}]
        conn = ep["ZoneHVAC:EquipmentConnections"][f"{z}_conn"]
        conn.pop("zone_air_inlet_node_or_nodelist_name", None)
        conn.pop("zone_return_air_node_or_nodelist_name", None)
    ep["Output:Variable"]["ufh"] = {"key_value": "*", "variable_name": "Zone Radiant HVAC Heating Energy", "reporting_frequency": "Hourly"}
    ep["Output:Variable"]["ufh_src"] = {"key_value": "*", "variable_name": "Surface Internal Source Location Temperature", "reporting_frequency": "Hourly"}
    return ep


def run(energyplus: str, ep: dict, epw: Path, d: Path) -> dict:
    SBR.add_air_outputs(ep)
    d.mkdir(parents=True, exist_ok=True)
    (d / "in.epJSON").write_text(json.dumps(ep, indent=1))
    p = subprocess.run([energyplus, "-w", str(epw), "-d", str(d), str(d / "in.epJSON")], capture_output=True, text=True)
    err = (d / "eplusout.err").read_text(errors="replace")
    if p.returncode != 0 or re.findall(r"\*\* Severe  \*\*", err):
        raise SystemExit(f"EnergyPlus failed in {d}\n{err[-3000:]}")
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name, key):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency = 'Hourly'
            and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    days = SBR.day_of_year_types()
    sb, tol = SB["cooled_room"]["setback_c"], SB["unmet_tolerance_k"]
    out = {"warnings": len(re.findall(r"\*\* Warning \*\*", err)), "zones": {}}
    f = [SB["hours"][days[h // 24]][h % 24] for h in range(8760)]
    for r in C.SPEC["rooms"]:
        z = r["id"]
        tz = series("Zone Mean Air Temperature", z)
        if len(tz) != 8760:
            raise SystemExit(f"{z}: {len(tz)} hourly values")
        if r["heat_c"] is None:
            _, cool = SBR.air_heat_cool(con, z)
            out["zones"][z] = {"cool_mwh": sum(cool) / 1e6}
            continue
        heat = [v / 3600.0 for v in series("Zone Radiant HVAC Heating Energy", f"{z}_ufh")]
        src = series("Surface Internal Source Location Temperature", f"{z}_floor")
        if len(heat) != 8760:
            raise SystemExit(f"{z}: {len(heat)} hourly radiant values")
        sp = [sb + x * (r["heat_c"] - sb) for x in f]
        out["zones"][z] = {**SBR.summarise(heat, tz, sp, [x == 1 for x in f], days, tol),
                           "max_source_c": max(src) if src else None,
                           "weekday_mean_air_c": [sum(tz[d * 24 + i] for d in range(365) if days[d] == "weekday") / sum(1 for d in range(365) if days[d] == "weekday") for i in range(24)]}
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
    runs = Path(a.runs or tempfile.mkdtemp(prefix="109_ufh_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    sha = lambda f: hashlib.sha256((HERE / f).read_bytes()).hexdigest()
    res = {"source": "validation/energyplus/109_ufh_referee.py", "spec_sha256": sha("104_cooled_room_spec.json"),
           "setback_spec_sha256": sha("109_setback_spec.json"), "weather_mos_sha256": B.MOS_SHA,
           "throttling_range_k": THROTTLE_K, "source_after_layer": SOURCE_AFTER_LAYER, "runs": {}}
    for name, caps in SB["cooled_room"]["cases"].items():
        if caps is None:
            continue
        r = run(a.energyplus, model(caps), epw, runs / name)
        res["runs"][name] = r
        print(name, json.dumps({z: {k: round(v, 2) for k, v in d.items() if isinstance(v, (int, float))} for z, d in r["zones"].items()}), "warnings", r["warnings"])
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
