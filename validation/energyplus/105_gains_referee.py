#!/usr/bin/env python3
"""
Brief 105 Part 2: the five-zone EnergyPlus referee for Bridgewater with internal gains.

Every run is Brief 104's gate referee r2_z (validation/energyplus/104_zones_referee.py: the document's frame and
internal capacity, each slab one construction seen from both sides, and bridging and infiltration allocated by zone as
Engine 2 allocates them), with the internal gains added:

  gains   each zone gets one OtherEquipment per gain profile it refers to, at 1 W design level x a Schedule:File
          column that holds the profile's hourly gain in W (scripts/105_gains.mts export, from gains.ts). Fraction
          latent 0, fraction lost 0, fraction radiant the profile's radiant_fraction. EnergyPlus spreads the radiant
          part over the zone's inside surfaces by area, as Engine 2 does; the rest goes to the zone air.

The referee takes the gains from gains.ts rather than from its own schedules (brief decision 2: one expansion of the
profiles, shared by the engine and the referee), so it checks the heat balance's response to the same gains. That
gains.ts is today's engine's gains is checked hour by hour in frontend/src/thermal/engine/__tests__/gains.test.ts.

Runs:
  r2_z         Brief 104's gate referee, no gains (repeated here as the baseline)
  r2_z_gains   r2_z with the gains

Usage: python3 -I validation/energyplus/105_gains_referee.py --energyplus <path> --gains <dir> [--runs <dir>]
Writes docs/audit/105/02_gains_referee.json. Nothing touches data/ or a database.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
spec = importlib.util.spec_from_file_location("zones", HERE / "104_zones_referee.py")
Z = importlib.util.module_from_spec(spec)
spec.loader.exec_module(Z)  # type: ignore[union-attr]
A, R = Z.A, Z.R
OUT = REPO / "docs/audit/105/02_gains_referee.json"
BASE = ["frame_split", "docmass", "slab_reversed", "tb_by_zone", "inf_by_zone"]
RUNS = {"r2_z": BASE, "r2_z_gains": BASE + ["gains"]}


def add_gains(ep: dict, gdir: Path, notes: list) -> None:
    meta = json.loads((gdir / "gains.json").read_text())
    csv = (gdir / "gains.csv").resolve()
    zones = sorted(ep["Zone"])  # Floor_1 … Floor_5, ground first
    if len(zones) != len({c["zone"] for c in meta["columns"]}):
        raise SystemExit(f"gains: {len(zones)} referee zones, {len({c['zone'] for c in meta['columns']})} engine zones")
    ep.setdefault("Schedule:File", {})
    ep.setdefault("OtherEquipment", {})
    total = 0.0
    for c in meta["columns"]:
        zname = zones[c["storey"] - 1]
        sname = f"gain_{c['zone']}_{c['profile_id']}"
        ep["Schedule:File"][sname] = {
            "file_name": str(csv), "column_number": c["column"], "rows_to_skip_at_top": 1,
            "number_of_hours_of_data": meta["hours"], "column_separator": "Comma", "interpolate_to_timestep": "No",
            "minutes_per_item": 60,
        }
        ep["OtherEquipment"][f"{sname}_eq"] = {
            "zone_or_zonelist_or_space_or_spacelist_name": zname, "fuel_type": "None", "schedule_name": sname,
            "design_level_calculation_method": "EquipmentLevel", "design_level": 1.0,
            "fraction_latent": 0.0, "fraction_radiant": c["radiant_fraction"], "fraction_lost": 0.0,
            "end_use_subcategory": c["kind"],
        }
        total += c["annual_kwh"]
    digest = hashlib.sha256(csv.read_bytes()).hexdigest()
    notes.append(f"gains: {len(meta['columns'])} OtherEquipment, {total / 1000:.3f} MWh a year in all, gains.csv sha256 {digest}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--gains", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    import yaml
    fx = yaml.safe_load(R.FIXTURE.read_text())
    today, psi, tg = R.today_constants(), R.iso14683_psi(), R.epw_mean_dry_bulb(R.EPW)
    root = Path(a.runs or tempfile.mkdtemp(prefix="105_gains_"))
    out = {"runs": {}}
    for name, flags in RUNS.items():
        ep, notes = A.build_run([f for f in flags if f not in ("tb_by_zone", "inf_by_zone", "slab_reversed", "gains")], fx, today, psi, tg)
        Z.slab_reversed(ep, notes)
        Z.tb_by_zone(ep, fx, psi, notes)
        Z.inf_by_zone(ep, notes)
        if "gains" in flags:
            add_gains(ep, Path(a.gains), notes)
        res = R.run_ep(a.energyplus, ep, root / name)
        s = R.summarise(res, ep)
        out["runs"][name] = {"flags": flags, "notes": notes, "heating_mwh": s["heating_mwh"], "cooling_mwh": s["cooling_mwh"],
                             "heating_monthly_mwh": s["heating_monthly_mwh"], "cooling_monthly_mwh": s["cooling_monthly_mwh"],
                             "zones": Z.per_zone(root / name, ep), "severe": s["severe"], "warnings": res["warnings"]}
        out["energyplus_version"] = res["version"]
        print(f"{name:12s} heat {s['heating_mwh']:8.3f}  cool {s['cooling_mwh']:7.3f}  severe {s['severe']}  "
              + " ".join(f"{z}:{v['heating_mwh']:.2f}/{v['cooling_mwh']:.2f}" for z, v in out["runs"][name]["zones"].items()), flush=True)
    out["source"] = "validation/energyplus/105_gains_referee.py"
    out["epw_sha256"] = R.EPW_SHA
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
