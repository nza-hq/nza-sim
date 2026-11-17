"""The EA tile index and the tile cache (Brief 56 Part 2.1).

The index is the Defra Survey Data Download's own search, found by reading the app's bundle on 27 Oct 2026
(environment.data.gov.uk/survey): `POST https://environment.data.gov.uk/tiles/collections/survey/search`
with a GeoJSON Polygon in WGS84 lng/lat (`content-type: application/geo+json`; EPSG:27700 coordinates
are refused with "must be <= 180") answers every product × year × resolution × 5 km tile that covers it:

    {"count": 22, "results": [{"product": {"id": "national_lidar_programme_point_cloud", "label": …},
      "year": {"id": "2021"}, "resolution": {"id": "1", "label": "1m"},
      "tile": {"id": "SP3075", "label": "SP37nw"},
      "label": "national_lidar_programme_point_cloud-2021-1m-SP37nw",
      "uri": "https://environment.data.gov.uk/tiles/collections/survey/national_lidar_programme_point_cloud/2021/1/SP3075"}, …]}

The `uri` is the download the spike used by hand (run_spike.sh): a zip of LAZ files (59–190 MB at Finham's
SP3075; HEAD answers 405, GET streams). The app refuses an area touching 48 tiles or more; a school's
site + 40 m touches one to four. Licence: Open Government Licence v3 (the National LIDAR Programme and
the LIDAR Point Cloud datasets on data.gov.uk). docs/provenance.md names this source.

Survey choice (brief 2.1): the National LiDAR Programme point cloud first (latest year per tile), else the
older `lidar_point_cloud` collections (latest year). A tile with neither is reported, not invented.
"""

from __future__ import annotations

import json
import os
import re
import time
import zipfile
from pathlib import Path

import httpx

SEARCH_URL = "https://environment.data.gov.uk/tiles/collections/survey/search"
NLP = "national_lidar_programme_point_cloud"
OLDER = "lidar_point_cloud"
POINT_CLOUDS = (NLP, OLDER)
#: Where downloaded tiles live between jobs (several schools share a 5 km tile). The container's disk.
DEFAULT_CACHE_DIR = os.environ.get("ROOFER_CACHE_DIR") or "/srv/roof/cache"
#: The margin round the site the spike clipped to (run_site.py: site.total_bounds ± 40).
SITE_MARGIN_M = 40.0
#: 7 Nov 2026 (measured roofs free for small sites): the most the tile cache may hold. The disk is 10 GB (render.yaml)
#: and also holds the per-school outputs; a tile is 60 to 220 MB, so without a ceiling the free visits fill the disk
#: within days. Past it, the tiles used longest ago are deleted before a new one is fetched (a later visit to that
#: area downloads its tile again). ROOFER_TILE_CACHE_GB sets it.
TILE_CACHE_MAX_BYTES = int(float(os.environ.get("ROOFER_TILE_CACHE_GB", "6")) * 1024**3)
#: Room kept free for the tile about to be fetched (the largest seen was ~220 MB zipped; the zip and its LAZ overlap).
TILE_ROOM_BYTES = 500 * 1024**2
#: A tile directory with no `.done` marker this old is a download that died (a restart): it is deleted.
STALE_PART_S = 3600


def search(polygon_lnglat: dict, timeout_s: float = 90.0) -> dict:
    """The index's answer for a GeoJSON Polygon (lng/lat). Raises httpx.HTTPStatusError on a refusal."""
    with httpx.Client(timeout=timeout_s) as c:
        r = c.post(SEARCH_URL, content=json.dumps(polygon_lnglat), headers={"content-type": "application/geo+json"})
        r.raise_for_status()
        return r.json()


def point_cloud_results(answer: dict) -> list[dict]:
    """Only the point-cloud rows, flattened: product, year, resolution, tile, label, uri."""
    out = []
    for r in answer.get("results", []):
        pid = (r.get("product") or {}).get("id")
        if pid not in POINT_CLOUDS:
            continue
        out.append(
            {
                "product": pid,
                "year": str((r.get("year") or {}).get("id")),
                "resolution": str((r.get("resolution") or {}).get("id")),
                "tile": (r.get("tile") or {}).get("id"),
                "tile_label": (r.get("tile") or {}).get("label"),
                "label": r.get("label"),
                "uri": r.get("uri"),
            }
        )
    return out


def candidates_per_tile(rows: list[dict]) -> dict[str, list[dict]]:
    """Per 5 km tile, the point clouds in the order to try them: the newest NLP year first, then older NLP
    years, then the older `lidar_point_cloud` collections newest first. The index can list a tile whose
    download answers 404 (Ormiston Bushfield, run 40482803562), so the job walks this list."""
    by_tile: dict[str, list[dict]] = {}
    for r in rows:
        if r["tile"]:
            by_tile.setdefault(r["tile"], []).append(r)
    out: dict[str, list[dict]] = {}
    for tile, rs in sorted(by_tile.items()):
        nlp = sorted((r for r in rs if r["product"] == NLP), key=lambda r: r["year"], reverse=True)
        older = sorted((r for r in rs if r["product"] == OLDER), key=lambda r: r["year"], reverse=True)
        out[tile] = nlp + older
    return out


def pick_survey(rows: list[dict]) -> dict:
    """Per 5 km tile, the survey to use first: the newest NLP year, else the newest older point cloud.

    Returns {"tiles": [row…], "candidates": {tile: [row…]}, "missing": [], "label": "…"}.
    """
    cands = candidates_per_tile(rows)
    chosen = [rs[0] for rs in cands.values() if rs]
    labels = sorted({f"{r['product']} {r['year']}" for r in chosen})
    return {"tiles": chosen, "candidates": cands, "missing": [], "label": " + ".join(labels) if labels else "no point cloud"}


def tile_dir(cache_dir: str | Path, row: dict) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", f"{row['product']}-{row['year']}-{row['resolution']}-{row['tile']}")
    return Path(cache_dir) / "tiles" / safe


def fetch_tile(row: dict, cache_dir: str | Path = DEFAULT_CACHE_DIR, timeout_s: float = 1800.0, log=print, keep=None) -> dict:
    """Download one tile's zip (unless cached), unzip the LAZ files beside it, delete the zip.

    Returns {"dir", "laz": [paths], "bytes": downloaded now (0 when cached), "cached": bool, "ms"}.
    A tile is cached when its directory holds a `.done` marker; a half-written download never counts.
    `keep`: tile directories this job already holds, never deleted to make room for this one.
    """
    t0 = time.perf_counter()
    d = tile_dir(cache_dir, row)
    done = d / ".done"
    if done.exists():
        _touch(d)
        laz = sorted(str(p) for p in d.glob("*.laz"))
        return {"dir": str(d), "laz": laz, "bytes": 0, "cached": True, "ms": round((time.perf_counter() - t0) * 1000)}
    freed = make_room(cache_dir, keep=set(keep or ()) | {str(d)}, log=log)
    if freed["deleted"]:
        log(f"[roofer] tile cache: deleted {freed['deleted']} tile(s) used longest ago ({freed['bytes'] / 1e6:.0f} MB) to make room")
    d.mkdir(parents=True, exist_ok=True)
    zpath = d / "tile.zip.part"
    n = 0
    log(f"[roofer] fetching {row['label']} from {row['uri']}")
    with httpx.Client(timeout=httpx.Timeout(timeout_s, connect=60.0), follow_redirects=True) as c, c.stream("GET", row["uri"]) as r:
        r.raise_for_status()
        with open(zpath, "wb") as fh:
            for chunk in r.iter_bytes(1 << 20):
                fh.write(chunk)
                n += len(chunk)
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            if name.lower().endswith((".laz", ".las")):
                target = d / Path(name).name
                with z.open(name) as src, open(target, "wb") as dst:
                    while True:
                        buf = src.read(1 << 20)
                        if not buf:
                            break
                        dst.write(buf)
    zpath.unlink(missing_ok=True)
    laz = sorted(str(p) for p in d.glob("*.laz")) + sorted(str(p) for p in d.glob("*.las"))
    (d / "tile.json").write_text(json.dumps(row, indent=1))
    done.write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    log(f"[roofer] {row['label']}: {n / 1e6:.1f} MB, {len(laz)} LAZ file(s)")
    return {"dir": str(d), "laz": laz, "bytes": n, "cached": False, "ms": round((time.perf_counter() - t0) * 1000)}


def cache_usage(cache_dir: str | Path = DEFAULT_CACHE_DIR) -> dict:
    """Bytes on disk under the tile cache, and how many tiles."""
    root = Path(cache_dir) / "tiles"
    if not root.exists():
        return {"tiles": 0, "bytes": 0}
    tiles = [p for p in root.iterdir() if p.is_dir()]
    size = sum(f.stat().st_size for p in tiles for f in p.rglob("*") if f.is_file())
    return {"tiles": len(tiles), "bytes": size}


def _touch(d: Path) -> None:
    """Mark a tile as used now (its `.used` time orders the cache, oldest deleted first)."""
    try:
        (d / ".used").touch()
    except OSError:
        pass


def _last_used(d: Path) -> float:
    for name in (".used", ".done"):
        try:
            return (d / name).stat().st_mtime
        except OSError:
            continue
    try:
        return d.stat().st_mtime
    except OSError:
        return 0.0


def _size(d: Path) -> int:
    return sum(f.stat().st_size for f in d.rglob("*") if f.is_file())


def make_room(cache_dir: str | Path = DEFAULT_CACHE_DIR, keep: set[str] | None = None, need: int = TILE_ROOM_BYTES, limit: int | None = None, log=print) -> dict:
    """Delete the tiles used longest ago until the cache plus `need` fits under `limit` (TILE_CACHE_MAX_BYTES).
    A dead download (no `.done`, over STALE_PART_S old) goes first. Tiles in `keep` are never deleted.
    Returns {"deleted": n, "bytes": freed}."""
    import shutil

    limit = TILE_CACHE_MAX_BYTES if limit is None else limit
    keep = {str(k) for k in (keep or set())}
    root = Path(cache_dir) / "tiles"
    if not root.exists():
        return {"deleted": 0, "bytes": 0}
    dirs = [p for p in root.iterdir() if p.is_dir() and str(p) not in keep]
    sizes = {p: _size(p) for p in root.iterdir() if p.is_dir()}
    total = sum(sizes.values())
    deleted, freed = 0, 0
    now = time.time()
    dead = [p for p in dirs if not (p / ".done").exists() and now - _last_used(p) > STALE_PART_S]
    done = sorted((p for p in dirs if (p / ".done").exists()), key=_last_used)
    for p in dead + done:
        if p not in dead and total + need <= limit:
            break
        try:
            shutil.rmtree(p)
        except OSError as err:
            log(f"[roofer] tile cache: could not delete {p.name}: {err}")
            continue
        total -= sizes.get(p, 0)
        freed += sizes.get(p, 0)
        deleted += 1
    return {"deleted": deleted, "bytes": freed}
