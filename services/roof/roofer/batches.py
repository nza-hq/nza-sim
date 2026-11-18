"""Big sites in batches (Linzie, 7 Nov 2026: "Yes, in batches of 30").

A site of more than AUTO_MAX_BUILDINGS footprints (and at most BATCH_MAX_BUILDINGS) is measured as several jobs of
BATCH_SIZE footprints each, run one at a time, with other schools' jobs allowed in between (queue.py). Memory was
never the reason big sites were Pro (Hartpury College 182 MB, Eton 192 MB, whole, at 512 MB); the wait was: one big
site held every small school behind it. After each batch its output is joined onto the site's, saved under the
site's own footprints hash, so decodED draws the roofs measured so far and the rest as before.

The job's output is absolute (EPSG:27700 triangles, outlines and terrain), so joining is concatenation: the rows,
outlines, LOD2.2 counts and roof triangles of every batch, one terrain grid (each batch's covers the whole site + 40 m,
stream.py), and the counts summed.
"""

from __future__ import annotations

import os

#: footprints per batch: the free automatic size (job.AUTO_MAX_BUILDINGS), so a batch is never bigger than a small site
BATCH_SIZE = max(1, int(os.environ.get("ROOFER_BATCH_BUILDINGS", "30")))
#: above this many footprints the site stays Pro (one building at a time): universities and the largest estates
BATCH_MAX_BUILDINGS = int(os.environ.get("ROOFER_BATCH_MAX_BUILDINGS", "160"))
#: how the grid groups neighbours: footprints in the same 150 m strip are taken west to east, strips south to north
STRIP_M = 150.0


def _centre(f: dict) -> tuple[float, float]:
    ring = f["footprint"]["coordinates"][0]
    xs = [float(p[0]) for p in ring]
    ys = [float(p[1]) for p in ring]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def plan(footprints: list[dict], size: int = BATCH_SIZE) -> list[list[dict]]:
    """The site's footprints in batches of `size`, neighbours together (strips of ~STRIP_M, lng/lat degrees scaled)."""
    if not footprints:
        return []
    strip_deg = STRIP_M / 111_000.0
    order = sorted(footprints, key=lambda f: (int(_centre(f)[1] // strip_deg), _centre(f)[0], str(f["id"])))
    return [order[i : i + size] for i in range(0, len(order), size)]


def join(site_hash: str, parts: list[dict]) -> dict:
    """One output for the site from its batches' outputs (in order). The first batch's frame, survey and terrain."""
    first = parts[0]
    out = {k: v for k, v in first.items()}
    out["footprints_hash"] = site_hash
    for k in ("rows", "outlines", "lod22", "roof_tris", "roof_tri_ids"):
        out[k] = [x for p in parts for x in (p.get(k) or [])]
    out["nodata"] = {**(first.get("nodata") or {}), "buildings": [b for p in parts for b in ((p.get("nodata") or {}).get("buildings") or [])]}
    out["footprints"] = {
        "given": sum((p.get("footprints") or {}).get("given", 0) for p in parts),
        "run": sum((p.get("footprints") or {}).get("run", 0) for p in parts),
        "under_10m2": [x for p in parts for x in ((p.get("footprints") or {}).get("under_10m2") or [])],
    }
    tiles = {}
    for p in parts:
        for t in (p.get("survey") or {}).get("tiles") or []:
            tiles.setdefault(t.get("tile") or t.get("label"), t)
    out["survey"] = {**(first.get("survey") or {}), "tiles": list(tiles.values())}
    out["bytes_downloaded"] = sum(p.get("bytes_downloaded") or 0 for p in parts)
    out["timings"] = {k: sum((p.get("timings") or {}).get(k, 0) for p in parts) for k in (first.get("timings") or {})}
    out["batches"] = {"joined": len(parts), "hashes": [p.get("footprints_hash") for p in parts]}
    return out
