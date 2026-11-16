#!/usr/bin/env python3
"""
Brief 109 Part 2: Bridgewater as five storeys in EnergyPlus, heated to office hours with a night setback.

Brief 105's gate referee r2_z_gains_vent_std (built as 108_bridgewater_capped.py builds it, unlimited), with the
thermostat's heating setpoint schedule replaced by setback_c + f x (heat_c - setback_c) from 109_setback_spec.json and
its cooling setpoint 99 C (never reached: cooling off) where f = 0. Weather-file holidays are off and 1 January is a
Monday, as in the engine's calendar.

Reported per storey, from hourly values, as 109_setback_referee.py reports them.

Usage: python3 -I validation/energyplus/109_bridgewater_setback.py --energyplus <path> --gains <dir> [--runs <dir>]
Writes docs/audit/109/02_bridgewater_energyplus.json. Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def load(name: str, file: str):
    s = importlib.util.spec_from_file_location(name, HERE / file)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)  # type: ignore[union-attr]
    return m


BWC = load("bwc", "108_bridgewater_capped.py")
SBR = load("sbr", "109_setback_referee.py")
R = BWC.R
SB = SBR.SB
OUT = REPO / "docs/audit/109/02_bridgewater_energyplus.json"


def build(fx, today, psi, tg, gdir: Path, algorithm: str):
    ep, notes = BWC.build(fx, today, psi, tg, gdir, None)
    ep["ZoneAirHeatBalanceAlgorithm"] = {"zone_air": {"algorithm": algorithm}}
    notes.append(f"zone air heat balance: {algorithm}")
    b = SB["bridgewater"]
    for rp in ep["RunPeriod"].values():
        rp["day_of_week_for_start_day"] = "Monday"
        rp["use_weather_file_holidays_and_special_days"] = "No"
    tst = ep["ThermostatSetpoint:DualSetpoint"]
    names = {(t["heating_setpoint_temperature_schedule_name"], t["cooling_setpoint_temperature_schedule_name"]) for t in tst.values()}
    if names != {("hotel_heating_setpoint", "hotel_cooling_setpoint")}:
        raise SystemExit(f"unexpected thermostat schedules {names}")
    days = {k: SB["hours"][k] for k, _ in SBR.DAYS}
    ep["Schedule:Compact"]["hotel_heating_setpoint"] = {"schedule_type_limits_name": "Temperature", "data": SBR.compact(
        {k: [b["setback_c"] + f * (b["heat_c"] - b["setback_c"]) for f in v] for k, v in days.items()})}
    ep["Schedule:Compact"]["hotel_cooling_setpoint"] = {"schedule_type_limits_name": "Temperature", "data": SBR.compact(
        {k: [b["cool_c"] if f > 0 else 99.0 for f in v] for k, v in days.items()})}
    notes.append(f"hours: heating {b['heat_c']} C in use, {b['setback_c']} C setback; cooling {b['cool_c']} C in use, off otherwise")
    return ep, notes


def one(a, fx, today, psi, tg, d: Path, alg: str, iso_conv: bool = False) -> dict:
    ep, notes = build(fx, today, psi, tg, Path(a.gains), alg)
    if iso_conv:
        # Review F4: the engine's fixed inside and outside convection in place of EnergyPlus's own (104_attribution.py).
        load("att", "104_attribution.py").iso_conv(ep, notes)
    SBR.add_air_outputs(ep)
    notes.append("heating and cooling: what entered the zone air (its heat balance's system terms), not the ideal-loads report")
    res = R.run_ep(a.energyplus, ep, d)
    s = R.summarise(res, ep)
    con = sqlite3.connect(d / "eplusout.sql")

    def series(name, key):
        return [v for (v,) in con.execute("""select r.Value from ReportData r join ReportDataDictionary d using (ReportDataDictionaryIndex)
            join Time t using (TimeIndex) where d.Name = ? and upper(d.KeyValue) = upper(?) and d.ReportingFrequency = 'Hourly'
            and t.EnvironmentPeriodIndex = (select max(EnvironmentPeriodIndex) from EnvironmentPeriods) order by t.TimeIndex""", (name, key))]
    days = SBR.day_of_year_types()
    b = SB["bridgewater"]
    f = [SB["hours"][days[h // 24]][h % 24] for h in range(8760)]
    sp = [b["setback_c"] + x * (b["heat_c"] - b["setback_c"]) for x in f]
    zones = {}
    for z in sorted(ep["Zone"]):
        heat, cool = SBR.air_heat_cool(con, z)
        rep = [v / 3600.0 for v in series("Zone Ideal Loads Zone Sensible Heating Energy", f"{z}_IdealLoads")]
        tz = series("Zone Mean Air Temperature", z)
        if len(tz) != 8760 or len(heat) != 8760:
            raise SystemExit(f"{z}: {len(tz)} / {len(heat)} hourly values")
        jan = {"tz_jan": [round(v, 3) for v in tz[:744]]} if iso_conv or a.variant else {}
        zones[z] = {**jan, **SBR.summarise(heat, tz, sp, [x == 1 for x in f], days, SB["unmet_tolerance_k"]), "cool_mwh": sum(cool) / 1e6,
                    "cooling_outside_hours_wh": sum(c for c, x in zip(cool, f) if x == 0),
                    "ideal_loads_reported": {"heat_mwh": sum(rep) / 1e6, "peak_w": max(rep), "weekday_morning_peak_w":
                                             SBR.summarise(rep, tz, sp, [x == 1 for x in f], days, SB["unmet_tolerance_k"])["weekday_morning_peak_w"]}}
    con.close()
    for z, x in zones.items():
        print(alg, z, json.dumps({k: round(v, 2) for k, v in x.items() if isinstance(v, (int, float))}), flush=True)
    return {"notes": notes, "heating_mwh": s["heating_mwh"], "cooling_mwh": s["cooling_mwh"], "severe": s["severe"], "warnings": res["warnings"],
            "energyplus_version": res["version"], "zones": zones}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--gains", required=True)
    ap.add_argument("--runs", default=None)
    # Review F4: 'iso_conv' (fixed convection, as the engine) or 'default' (EnergyPlus's own convection), EulerMethod only,
    # with January's hourly air temperatures, each to its own file beside the gated one.
    ap.add_argument("--variant", choices=["iso_conv", "default"], default=None)
    a = ap.parse_args()
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    today, psi, tg = R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW)
    root = Path(a.runs or tempfile.mkdtemp(prefix="109_bw_"))
    runs = {}
    if a.variant:
        runs["EulerMethod"] = one(a, fx, today, psi, tg, root / a.variant, "EulerMethod", a.variant == "iso_conv")
    else:
        for alg in SBR.ALGORITHMS:
            runs[alg] = one(a, fx, today, psi, tg, root / alg, alg)
    out = {"source": "validation/energyplus/109_bridgewater_setback.py", "epw_sha256": R.EPW_SHA,
           "setback_spec_sha256": hashlib.sha256((HERE / "109_setback_spec.json").read_bytes()).hexdigest(),
           "gains_csv_sha256": hashlib.sha256((Path(a.gains) / "gains.csv").read_bytes()).hexdigest(),
           "runs": runs}
    (OUT.with_name(f"02_bridgewater_{a.variant}_energyplus.json") if a.variant else OUT).write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
