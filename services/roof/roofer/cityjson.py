"""roofer's CityJSONSeq → roof triangles in EPSG:27700 and the per-building row (Brief 56 Part 2.3).

A port of nza-roofer-spike `scripts/run_site.py` step 5 and `scripts/cj_to_mesh.py`, kept to the same
rules so the rows carry the field dictionary's meanings (docs/audit/39/field-dictionary.md):
  - every face of every LoD2.2 child geometry is ear-cut into triangles (Newell normal, drop the dominant axis);
  - GroundSurface faces are skipped; RoofSurface triangles are the roof (`roof = 1`), the rest walls;
  - `pitched_frac` is the share of roof area (triangles over 0.05 m²) tilted more than 5°, `mean_pitch` the
    area-weighted tilt of those; `outcome` is `no model` / `LoD2.2 pitched` (pitched_frac ≥ 0.3) / `LoD2.2 flat/stepped`;
  - `h_ridge` is roofer's `rf_h_roof_ridge` (AOD) less the site's ground_z, to 0.1 m; `rmse_lod22` to 0.01 m.
Differences from the spike, all deliberate: coordinates stay ABSOLUTE (no origin; spike.ts rebuilt one),
and the nodata floor roofer passed through at Torquay (NODATA_FLOOR) is guarded here: any height at or
below it is null and the building is listed under `nodata`.
"""

from __future__ import annotations

import glob
import json
import math
import os

from . import NODATA_FLOOR

PITCH_MIN_DEG = 5.0
MIN_TRI_M2 = 0.05
PITCHED_FRAC = 0.3


def _triangulate(rings):
    """Ear-cut a 3-D face (outer ring + holes) into triangles, as cj_to_mesh.py does."""
    import mapbox_earcut as earcut
    import numpy as np

    rings = [np.asarray(r, float) for r in rings if len(r) >= 3]
    if not rings:
        return []
    P = rings[0]
    n = np.zeros(3)
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        n += [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]
    if not np.linalg.norm(n):
        return []
    n /= np.linalg.norm(n)
    ax = int(np.argmax(np.abs(n)))
    keep = [i for i in range(3) if i != ax]
    allp = np.vstack(rings)
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    idx = earcut.triangulate_float64(np.ascontiguousarray(allp[:, keep]), ends)
    return [allp[idx[i : i + 3]] for i in range(0, len(idx), 3)]


def _guard(v):
    """A roofer height, or None when it is missing or the EA nodata value."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f) or f <= NODATA_FLOOR + 1:
        return None
    return f


def read_run(out_dir: str, id_attribute: str = "fid_s") -> dict:
    """Every building in `<out_dir>/*.city.jsonl`: its attributes and its LoD2.2 mesh.

    Returns {id: {"attrs": {...}, "tris": [[9 floats]…] (absolute EPSG:27700), "roof": [0|1…],
    "pitched_frac", "mean_pitch", "roof_area_m2"}}.
    """
    import numpy as np

    out = {}
    for f in sorted(glob.glob(os.path.join(out_dir, "*.city.jsonl"))):
        with open(f, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
        if not lines:
            continue
        head = json.loads(lines[0])
        sc, tr = head["transform"]["scale"], head["transform"]["translate"]
        for line in lines[1:]:
            if not line.strip():
                continue
            o = json.loads(line)
            V = np.asarray(o["vertices"], float) * sc + tr if o.get("vertices") else np.zeros((0, 3))
            for cid, co in o["CityObjects"].items():
                if co.get("type") != "Building":
                    continue
                A = co.get("attributes", {}) or {}
                bid = str(A.get(id_attribute, cid))
                pos, roof, ra, slopes = [], [], [], []
                for ch in co.get("children", []):
                    for gm in o["CityObjects"].get(ch, {}).get("geometry", []):
                        if str(gm.get("lod")) != "2.2":
                            continue
                        sem = gm.get("semantics")
                        for si, shell in enumerate(gm["boundaries"]):
                            for fi, face in enumerate(shell):
                                st = "WallSurface"
                                if sem and sem["values"][si][fi] is not None:
                                    st = sem["surfaces"][sem["values"][si][fi]]["type"]
                                if st == "GroundSurface":
                                    continue
                                for T in _triangulate([[V[i] for i in ring] for ring in face]):
                                    pos.append([round(float(v), 3) for v in T.ravel()])
                                    is_roof = st == "RoofSurface"
                                    roof.append(1 if is_roof else 0)
                                    if is_roof:
                                        nv = np.cross(T[1] - T[0], T[2] - T[0])
                                        ar = 0.5 * float(np.linalg.norm(nv))
                                        if ar > MIN_TRI_M2:
                                            ra.append(ar)
                                            slopes.append(math.degrees(math.acos(min(1.0, abs(float(nv[2])) / (2 * ar)))))
                rec = {"attrs": A, "tris": pos, "roof": roof, "pitched_frac": None, "mean_pitch": None, "roof_area_m2": round(sum(ra), 2)}
                if ra:
                    ra_a, sl_a = np.array(ra), np.array(slopes)
                    pitched = sl_a > PITCH_MIN_DEG
                    rec["pitched_frac"] = round(float(ra_a[pitched].sum() / ra_a.sum()), 2)
                    rec["mean_pitch"] = round(float(np.average(sl_a[pitched], weights=ra_a[pitched])), 1) if pitched.any() else None
                out[bid] = rec
    return out


def rows_for(footprints: list, meshes: dict, diag: dict, fall: dict, ground_z: float) -> tuple[list[dict], list[str]]:
    """One row per footprint in the spike's CSV order (largest first), with the SpikeRow fields, and the ids
    whose roofer heights hit the nodata guard."""
    rows, nodata = [], []
    for f in footprints:
        bid = f["id"]
        m = meshes.get(bid, {})
        A = m.get("attrs", {})
        d = diag.get(bid, {"dens": None, "raised_pct": None, "c6_dens": None})
        if not m or not m.get("tris"):
            outcome = "no model"
        elif (m.get("pitched_frac") or 0) >= PITCHED_FRAC:
            outcome = "LoD2.2 pitched"
        else:
            outcome = "LoD2.2 flat/stepped"
        ridge = _guard(A.get("rf_h_roof_ridge"))
        ground = _guard(A.get("rf_h_ground"))
        if A and (A.get("rf_h_roof_ridge") is not None and ridge is None or A.get("rf_h_ground") is not None and ground is None):
            nodata.append(bid)
        rmse = A.get("rf_rmse_lod22")
        rows.append(
            {
                "id": bid,
                "area_m2": int(round(f["area_m2"])),
                "outcome": outcome,
                "roof_type": A.get("rf_roof_type"),
                "pitched_frac": m.get("pitched_frac"),
                "mean_pitch": m.get("mean_pitch"),
                "rmse_lod22": None if rmse is None else round(float(rmse), 2),
                "dens": d["dens"],
                "bld_dens": d["c6_dens"],
                "raised_pct": d["raised_pct"],
                "h_ridge": None if ridge is None else round(ridge - ground_z, 1),
                "ground_fall_m": fall.get(bid),
                # Brief 56 additions, beside the spike's columns: roofer's own floor (AOD) and its point density
                "h_ground_aod": None if ground is None else round(ground, 2),
                "pt_density": None if A.get("rf_pt_density") is None else round(float(A["rf_pt_density"]), 2),
                "roof_area_m2": m.get("roof_area_m2"),
            }
        )
    rows.sort(key=lambda r: -r["area_m2"])
    return rows, nodata
