#!/usr/bin/env python3
"""
Owed from Brief 120 (review F11): the held-out wet capacity case (114_heldout_spec.json) in EnergyPlus.

Runs 120_plant_referee.py's model and run, with 108's radiator rating at the held-out spec's flow and return (the
module-level spec values are replaced before any model is built; nothing else changes).
Usage: python3 -I validation/energyplus/114_heldout_referee.py --energyplus <path> [--runs <dir>]
Writes docs/audit/114/05_heldout_energyplus.json.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
s = importlib.util.spec_from_file_location("plant", HERE / "120_plant_referee.py")
P = importlib.util.module_from_spec(s)
s.loader.exec_module(P)  # type: ignore[union-attr]
SPEC = json.loads((HERE / "114_heldout_spec.json").read_text())
for k in ("flow_c", "return_c", "rated_room_c", "exponent_n", "radiant_fraction"):
    P.HWR.HW[k] = SPEC[k]
P.SPEC = SPEC
OUT = REPO / "docs/audit/114/05_heldout_energyplus.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--energyplus", required=True)
    ap.add_argument("--runs", default=None)
    a = ap.parse_args()
    B = P.C.B
    if hashlib.sha256(B.MOS.read_bytes()).hexdigest() != B.MOS_SHA:
        raise SystemExit("Denver .mos sha mismatch")
    runs = Path(a.runs or tempfile.mkdtemp(prefix="114_heldout_"))
    runs.mkdir(parents=True, exist_ok=True)
    epw = runs / "Denver_725650_from_mos.epw"
    B.mos_to_epw(B.MOS, epw)
    sha = lambda f: hashlib.sha256((HERE / f).read_bytes()).hexdigest()
    res = {"source": "validation/energyplus/114_heldout_referee.py", "spec_sha256": sha("114_heldout_spec.json"), "weather_mos_sha256": B.MOS_SHA, "runs": {}}
    for name, case in SPEC["cases"].items():
        ep, _ = P.model(case)
        r = P.run(a.energyplus, ep, case, epw, runs / name)
        res["runs"][name] = r
        print(name, json.dumps(r))
    res["energyplus_version"] = subprocess.run([a.energyplus, "--version"], capture_output=True, text=True).stdout.strip()
    OUT.write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()
