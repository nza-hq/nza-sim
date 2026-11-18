"""One roofer run for one school, end to end (Brief 56 Part 2.2–2.3).

In: the URN, the site polygon and decodED's footprints (GeoJSON, lng/lat — the ProjectFile's own, with
decodED's ids: D3), options. Out: the one JSON per school (`decoded-roofer-output/1`) that
src/twin/roofer/output.ts reads. Everything in EPSG:27700, heights in metres AOD, no origin.

Steps, with the spike's numbers (scripts/run_site.py, run_spike.sh):
  1 footprints and site → EPSG:27700 (pyproj; OSTN15 when its grid is available, else the Helmert — recorded);
    footprints under 10 m² are set aside (run_site.py line 22)
  2 the EA index for the site + 40 m → the tiles and the survey (tiles.py); fetch, cached on the container's disk
  3 clip to the site + 40 m; RECLASS (on by default, as every spike viewer run was) — streamed (stream.py, Brief 195)
  4 roofer --srs EPSG:27700 --id-attribute fid_s --lod12 --lod22 -j 1 <cloud> <fp.gpkg> <out> (Brief 195: -j 1)
  5 diagnostics, terrain, the CityJSON → triangles and rows; the nodata guard
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from . import ROOFER_VERSION, roofer_binary, roofer_version
from . import cityjson, gpkg, stream, tiles

SCHEMA = "decoded-roofer-output/1"
MIN_FOOTPRINT_M2 = 10.0
#: Brief 195 P3: one roofer thread by default (Starter has half a CPU; each thread holds its own buildings' points)
ROOFER_JOBS = int(os.environ.get("ROOFER_JOBS", "1"))
ROOFER_TIMEOUT_S = float(os.environ.get("ROOFER_TIMEOUT_S", "1800"))

#: Brief 195 P4: the automatic job (a build asking because it has nothing to draw) runs only for a site of at most
#: AUTO_MAX_BUILDINGS footprints on one EA tile. From the sweep-01 census (docs/audit/sweep-01, 205 schools with a
#: real outline): the median school has 3 buildings, the 99th percentile 25, the largest 44; 60 leaves room above every
#: one of them. Campuses are past it (Hartpury College ~110, Eton 125–137, universities 100+). Above it, or past one
#: tile, the template roofs stand and measured roofs are a request (`options.on_request`; a Pro feature, its UI a later
#: brief). Both are settings, not limits on the service: a request is never refused for its size.
#: Linzie 7 Nov 2026 (decision card): measured roofs are FREE for a site of up to 30 buildings, run by themselves on a
#: visit; above that they stay Pro, one building at a time (Brief 198).
AUTO_MAX_BUILDINGS = int(os.environ.get("ROOFER_AUTO_MAX_BUILDINGS", "30"))
#: Linzie 4 Nov 2026 17:36 turned the automatic job off (Pro on request only); Linzie 7 Nov 2026 turned it back on for
#: small sites (the limits above). Each job runs in its own process under a memory watchdog (#402, #412), so one site
#: cannot take the service down. ROOFER_AUTO=0 is the kill switch.
AUTO_RUN = os.environ.get("ROOFER_AUTO", "1").strip() != "0"
#: 7 Nov 2026: two EA tiles (was one), so a site on a tile edge (Hartpury College) is measured too: its whole-site run
#: at 512 MB peaked at 182 MB over two tiles, and the tile cache keeps the disk in bounds (tiles.TILE_CACHE_MAX_BYTES).
AUTO_MAX_TILES = int(os.environ.get("ROOFER_AUTO_MAX_TILES", "2"))
EA_TILE_M = 5000.0  # the EA's point clouds come as OS 5 km squares (SP3075 …)


class TooBigForAuto(Exception):
    """Brief 195 P4: this site is past the automatic job's size; measured roofs are on request."""


def auto_skip_reason(n_footprints: int, options: dict | None) -> str | None:
    """Why the automatic job does not run for this many footprints, or None. Checked before the job is queued."""
    if (options or {}).get("on_request"):
        return None
    if not AUTO_RUN:
        return "measured roofs are run on request (Pro); the template roofs stand until then"
    # Linzie 7 Nov 2026: past AUTO_MAX_BUILDINGS a site is measured in batches (batches.py, queue.py) up to
    # BATCH_MAX_BUILDINGS; only past that do measured roofs stay a request (Pro, one building at a time)
    from .batches import BATCH_MAX_BUILDINGS

    if n_footprints > BATCH_MAX_BUILDINGS:
        return f"{n_footprints} buildings, over {BATCH_MAX_BUILDINGS}: measured roofs are on request for a site this big"
    return None


def tiles_spanned(box: tuple[float, float, float, float]) -> int:
    """How many EA 5 km tiles an EPSG:27700 box touches."""
    import math

    nx = math.floor(box[2] / EA_TILE_M) - math.floor(box[0] / EA_TILE_M) + 1
    ny = math.floor(box[3] / EA_TILE_M) - math.floor(box[1] / EA_TILE_M) + 1
    return int(nx * ny)


def footprints_hash(footprints: list[dict]) -> str:
    """The key the store and decodED agree on (src/twin/roofer/output.ts `footprintsHash` is the same
    bytes): the ids sorted, each with its rings' lng/lat to 6 decimals, one line per footprint, sha256,
    first 16 hex digits. A changed footprint set is a new job; a rebuilt file with the same footprints is not."""
    lines = []
    for f in sorted(footprints, key=lambda f: str(f["id"])):
        rings = f["footprint"]["coordinates"]
        lines.append(str(f["id"]) + "|" + "/".join(";".join(f"{float(c[0]):.6f},{float(c[1]):.6f}" for c in ring) for ring in rings))
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()[:16]


def _transformer(sample_lnglat):
    """lng/lat → EPSG:27700. pyproj's operations best first — OSTN15 where its grid can be read (the container
    sets PROJ_NETWORK=ON), else the 7-parameter Helmert that decodED's toBNG also uses — and the FIRST that
    gives finite coordinates for a sample point wins. A grid-based operation whose grid cannot be fetched
    answers inf, not an error (CI run 40480506060: "Shell empty after removing invalid points"), so the choice
    is tested, never assumed. Returns (transformer, frame record)."""
    import math

    from pyproj import Transformer
    from pyproj.transformer import TransformerGroup

    g = TransformerGroup("EPSG:4326", "EPSG:27700", always_xy=True)
    candidates = list(g.transformers) + [Transformer.from_crs("EPSG:4326", "EPSG:27700", always_xy=True)]
    tried = []
    for t in candidates:
        x, y = t.transform(sample_lnglat[0], sample_lnglat[1])
        if math.isfinite(x) and math.isfinite(y) and 0 < x < 800000 and -100000 < y < 1400000:
            return t, {"operation": t.description, "best_available": bool(g.best_available), "skipped": tried, "unavailable": [str(u) for u in g.unavailable_operations][:3]}
        tried.append(t.description[:80])
    raise RuntimeError(f"no lng/lat → EPSG:27700 operation gives finite coordinates for {sample_lnglat} (tried {tried})")


def _to_en(t, ring):
    import math

    xs, ys = t.transform([c[0] for c in ring], [c[1] for c in ring])
    out = [(round(float(x), 3), round(float(y), 3)) for x, y in zip(xs, ys)]
    if any(not (math.isfinite(x) and math.isfinite(y)) for x, y in out):
        raise RuntimeError(f"the frame operation gave a non-finite coordinate for a ring near {ring[0]}")
    return out


def _open_ring(r):
    return r[:-1] if len(r) > 1 and r[0] == r[-1] else r


def run(urn: int, site: dict, footprints: list[dict], options: dict | None = None, work_dir: str | Path | None = None, cache_dir: str | Path = tiles.DEFAULT_CACHE_DIR, log=print) -> dict:
    """The job. `site`: GeoJSON Polygon (lng/lat). `footprints`: [{"id", "footprint": GeoJSON Polygon}].
    Raises on a failure that leaves nothing to say (no tile, roofer exited non-zero); the queue records it."""
    from shapely.geometry import Polygon

    options = {"reclass": True, **(options or {})}
    t_all = time.perf_counter()
    timings: dict[str, int] = {}
    binary = roofer_binary()
    if not binary:
        raise RuntimeError("roofer is not installed in this container (ROOFER_BIN / PATH)")
    key = footprints_hash(footprints)
    work = Path(work_dir or Path(cache_dir) / "work" / f"{urn}-{key}")
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    # 1 · the frame
    t = time.perf_counter()
    first = site["coordinates"][0][0]
    tr, frame = _transformer((float(first[0]), float(first[1])))
    site_rings = [_to_en(tr, _open_ring(r)) for r in site["coordinates"]]
    site_poly = Polygon(site_rings[0], site_rings[1:])
    fps, small = [], []
    for f in footprints:
        rings = [_to_en(tr, _open_ring(r)) for r in f["footprint"]["coordinates"]]
        poly = Polygon(rings[0], rings[1:])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.area < MIN_FOOTPRINT_M2 or poly.is_empty:
            small.append(str(f["id"]))
            continue
        fps.append({"id": str(f["id"]), "rings": rings, "poly": poly, "area_m2": poly.area})
    if not fps:
        raise RuntimeError("no footprint of 10 m² or more to reconstruct")
    minx, miny, maxx, maxy = site_poly.bounds
    for f in fps:
        b = f["poly"].bounds
        minx, miny, maxx, maxy = min(minx, b[0]), min(miny, b[1]), max(maxx, b[2]), max(maxy, b[3])
    box = (minx - tiles.SITE_MARGIN_M, miny - tiles.SITE_MARGIN_M, maxx + tiles.SITE_MARGIN_M, maxy + tiles.SITE_MARGIN_M)
    timings["frame_ms"] = round((time.perf_counter() - t) * 1000)
    # Brief 195 P4: past one EA tile, the automatic job stops here — before any download
    n_tiles = tiles_spanned(box)
    if n_tiles > AUTO_MAX_TILES and not options.get("on_request"):
        raise TooBigForAuto(f"the site spans {n_tiles} EA tiles, over {AUTO_MAX_TILES}: measured roofs are on request for a site this big")

    # 2 · the tiles
    t = time.perf_counter()
    inv = tr  # the same operation, inverse direction, for the index's lng/lat box
    corners_en = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
    lng, lat = inv.transform([c[0] for c in corners_en], [c[1] for c in corners_en], direction="INVERSE")
    index_poly = {"type": "Polygon", "coordinates": [[[float(a), float(b)] for a, b in zip(lng, lat)] + [[float(lng[0]), float(lat[0])]]]}
    answer = tiles.search(index_poly)
    survey = tiles.pick_survey(tiles.point_cloud_results(answer))
    if not survey["tiles"]:
        raise RuntimeError(f"the EA index lists no point cloud over this site ({answer.get('count', 0)} rows, none a point cloud)")
    fetched = []
    held = []  # this job's tile directories: never deleted to make room for its next tile
    laz = []
    bytes_dl = 0
    import httpx

    for tile_id, cands in survey["candidates"].items():
        # the newest survey first; a download the index lists but the server refuses (404 at Ormiston Bushfield,
        # run 40482803562) falls to the next survey for that tile, and the record says which were refused
        refused = []
        got = None
        for row in cands:
            try:
                got = tiles.fetch_tile(row, cache_dir, log=log, keep=set(held))
            except httpx.HTTPStatusError as err:
                refused.append({"label": row["label"], "status": err.response.status_code})
                log(f"[roofer] {row['label']}: HTTP {err.response.status_code} — trying the next survey for {tile_id}")
                continue
            fetched.append({**row, "laz_files": len(got["laz"]), "bytes": got["bytes"], "cached": got["cached"], "ms": got["ms"], **({"refused_first": refused} if refused else {})})
            laz += got["laz"]
            held.append(got["dir"])
            bytes_dl += got["bytes"]
            break
        if got is None:
            raise RuntimeError(f"no point cloud could be downloaded for tile {tile_id}: {refused}")
    survey = {**survey, "tiles_used": fetched, "label": " + ".join(sorted({f"{r['product']} {r['year']}" for r in fetched})) or survey["label"]}
    timings["tiles_ms"] = round((time.perf_counter() - t) * 1000)

    # 3 · clip, reclassify, diagnostics, terrain — Brief 195 P3: streamed, chunk by chunk (stream.py), never a
    # whole tile or the whole clipped cloud in memory; roofer reads the points within 40 m of a footprint
    pc = stream.process(laz, site_poly, fps, work, reclass=bool(options.get("reclass")), log=log)
    clipped, reclass = pc["clipped"], pc["reclass"]
    timings["clip_ms"] = pc["ms"]
    run_cloud = pc["roofer_cloud"]

    # 4 · roofer
    fp_path = work / "fp.gpkg"
    gpkg.write_footprints(fp_path, [{"id": f["id"], "rings": f["rings"]} for f in fps])
    out_dir = work / "roofer"
    out_dir.mkdir()
    args = [binary, "--srs", "EPSG:27700", "--id-attribute", "fid_s", "--lod12", "--lod22", "-j", str(ROOFER_JOBS), str(run_cloud), str(fp_path), str(out_dir)]
    t = time.perf_counter()
    log(f"[roofer] {' '.join(args[1:])}")
    # roofer's own GDAL/PROJ data (its tarball's share/), for its process only — never the env's pyproj
    env = dict(os.environ)
    for src, dst in (("ROOFER_GDAL_DATA", "GDAL_DATA"), ("ROOFER_PROJ_DATA", "PROJ_DATA")):
        if os.environ.get(src):
            env[dst] = os.environ[src]
    with open(work / "roofer.log", "w", encoding="utf-8") as lf:
        proc = subprocess.run(args, stdout=lf, stderr=subprocess.STDOUT, timeout=ROOFER_TIMEOUT_S, check=False, env=env)
    timings["roofer_ms"] = round((time.perf_counter() - t) * 1000)
    if proc.returncode != 0:
        tail = (work / "roofer.log").read_text(encoding="utf-8", errors="replace")[-2000:]
        raise RuntimeError(f"roofer exited {proc.returncode}: {tail}")

    # 5 · the output
    t = time.perf_counter()
    meshes = cityjson.read_run(str(out_dir))
    diag, ground_z, terrain, fall = pc["diag"], pc["ground_z"], pc["terrain"], pc["fall"]
    rows, nodata = cityjson.rows_for(fps, meshes, diag, fall, ground_z)
    roof_tris, roof_ids, lod22 = [], [], []
    for f in fps:
        m = meshes.get(f["id"])
        if not m:
            lod22.append({"id": f["id"], "triangles": 0, "roofTriangles": 0})
            continue
        nroof = 0
        for tri, is_roof in zip(m["tris"], m["roof"]):
            if is_roof:
                roof_tris.append(tri)
                roof_ids.append(f["id"])
                nroof += 1
        lod22.append({"id": f["id"], "triangles": len(m["tris"]), "roofTriangles": nroof})
    timings["output_ms"] = round((time.perf_counter() - t) * 1000)
    timings["total_ms"] = round((time.perf_counter() - t_all) * 1000)
    disk = sum(p.stat().st_size for p in work.rglob("*") if p.is_file())

    output = {
        "schema": SCHEMA,
        "urn": int(urn),
        "footprints_hash": key,
        "made_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "crs": "EPSG:27700",
        "frame": frame,
        "survey": {**{k: v for k, v in survey.items() if k not in ("candidates", "tiles_used")}, "tiles": fetched, "box_27700": [round(v, 2) for v in box]},
        "roofer": {"version": roofer_version() or ROOFER_VERSION, "pinned": ROOFER_VERSION, "args": args[1:-3], "reclass": bool(options.get("reclass")), **({"reclassified_footprints": reclass["reclassified_footprints"]} if reclass else {}), "returncode": proc.returncode},
        "ground_z": round(ground_z, 2),
        "footprints": {"given": len(footprints), "run": len(fps), "under_10m2": small},
        "nodata": {"value": cityjson.NODATA_FLOOR, "buildings": nodata},
        "rows": rows,
        "outlines": [{"id": f["id"], "ring": [[x, y] for x, y in f["rings"][0]]} for f in fps],
        "lod22": lod22,
        "roof_tris": roof_tris,
        "roof_tri_ids": roof_ids,
        "terrain": terrain,
        "points": {"clipped": clipped["points"], "files_read": clipped["files_read"], "roofer": pc["roofer_points"], "ground_cell_m": pc["ground_cell_m"], "chunk": stream.chunk_points()},
        "bytes_downloaded": bytes_dl,
        "work_bytes": disk,
        "timings": timings,
    }
    (work / "output.json").write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    log(f"[roofer] URN {urn}: {len(fps)} footprints, {len(roof_tris)} roof triangles, {sum(1 for r in rows if r['outcome'] != 'no model')} modelled, in {timings['total_ms'] / 1000:.0f} s")
    return output
