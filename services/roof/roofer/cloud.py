"""The point cloud: clip the tiles to the site, the spike's RECLASS rescue, per-footprint diagnostics, the
terrain grid. Ports of nza-roofer-spike `scripts/run_site.py` (steps 2, 2b, 4) and `scripts/terrain.py`,
with the same numbers (40 m margin, 0.5 m inner buffer, 2 m "raised", 2 m terrain cell, ≤ 160 × 160 grid,
1–4 m ground ring) so the rows mean what Brief 39's field dictionary says (docs/audit/39/field-dictionary.md).

Coordinates are EPSG:27700 throughout; heights are metres AOD as the LAZ carries them.
"""

from __future__ import annotations

import glob
import os
import time
from pathlib import Path

#: run_site.py line 70: points more than this above the nearest ground point count as "raised".
RAISED_M = 2.0
#: run_site.py line 67: the footprint shrunk by this before counting points inside it.
INNER_M = 0.5
#: terrain.py: the DTM cell, and the grid's largest side in the output.
TERRAIN_CELL_M = 2.0
TERRAIN_MAX_SIDE = 160
#: terrain.py: ground fall is the 95th − 5th percentile of ground points in a ring 1–4 m outside the outline.
RING_IN_M, RING_OUT_M, RING_MIN_POINTS = 1.0, 4.0, 10
GROUND, BUILDING = 2, 6
RECLASS_FROM = (1, 3, 4, 5)


def clip(laz_files: list[str], box: tuple[float, float, float, float], out_path: str | Path, log=print) -> dict:
    """Every point inside `box` (minx, miny, maxx, maxy) from the tiles whose header touches it, as one LAZ.

    Returns {"points", "files_read", "ms"}. Raises RuntimeError when no tile touches the box.
    """
    import laspy
    import numpy as np

    t0 = time.perf_counter()
    xmin, ymin, xmax, ymax = box
    parts, hdr, files_read = [], None, 0
    for f in sorted(laz_files):
        with laspy.open(f) as r:
            h = r.header
            if h.maxs[0] < xmin or h.mins[0] > xmax or h.maxs[1] < ymin or h.mins[1] > ymax:
                continue
            files_read += 1
            hdr = h
            for ch in r.chunk_iterator(5_000_000):
                m = (ch.x >= xmin) & (ch.x <= xmax) & (ch.y >= ymin) & (ch.y <= ymax)
                if m.any():
                    parts.append(ch[m].array)
    if hdr is None or not parts:
        raise RuntimeError(f"no LiDAR tile covers the site box {box}")
    o = laspy.LasData(laspy.LasHeader(point_format=hdr.point_format.id, version=hdr.version))
    o.header.offsets, o.header.scales = hdr.offsets, hdr.scales
    o.points = laspy.ScaleAwarePointRecord(np.concatenate(parts), hdr.point_format, hdr.scales, hdr.offsets)
    o.write(str(out_path))
    n = int(sum(len(p) for p in parts))
    log(f"[roofer] clipped {n:,} points from {files_read} file(s) into {Path(out_path).name}")
    return {"points": n, "files_read": files_read, "ms": round((time.perf_counter() - t0) * 1000)}


def _xyzc(las):
    import numpy as np

    return np.asarray(las.x), np.asarray(las.y), np.asarray(las.z), np.asarray(las.classification)


def _height_above_ground(x, y, z, c):
    """Each point's height above the nearest ground (class 2) point, and the ground mask."""
    import numpy as np
    from scipy.spatial import cKDTree

    g = c == GROUND
    if not g.any():
        return np.zeros_like(z), g
    _, gi = cKDTree(np.c_[x[g], y[g]]).query(np.c_[x, y])
    return z - z[g][gi], g


def _inside(poly, x, y, idx):
    from shapely import contains_xy

    return idx[contains_xy(poly, x[idx], y[idx])] if len(idx) else idx


def reclassify(cloud_path: str | Path, footprints: list, out_path: str | Path, log=print) -> dict:
    """run_site.py step 2b (RECLASS=1): a footprint with no class-6 points but raised returns gets those
    raised non-ground points (classes 1, 3, 4, 5 over RAISED_M above ground) set to class 6. Rescues the
    sheds and huts the EA left unclassified (every spike school's viewer run used it).

    `footprints`: [{"id", "poly": shapely Polygon}]. Returns {"reclassified_footprints", "points", "ms"}.
    """
    import laspy
    import numpy as np

    t0 = time.perf_counter()
    las = laspy.read(str(cloud_path))
    x, y, z, c = _xyzc(las)
    c = c.copy()
    hag, _ = _height_above_ground(x, y, z, c)
    nfix, npts = 0, 0
    for f in footprints:
        b = f["poly"].bounds
        idx = np.where((x >= b[0]) & (x <= b[2]) & (y >= b[1]) & (y <= b[3]))[0]
        idx = _inside(f["poly"], x, y, idx)
        if len(idx) and (c[idx] == BUILDING).sum() == 0:
            sel = idx[np.isin(c[idx], RECLASS_FROM) & (hag[idx] > RAISED_M)]
            if len(sel):
                c[sel] = BUILDING
                nfix += 1
                npts += int(len(sel))
    las.classification = c
    las.write(str(out_path))
    log(f"[roofer] reclassified {nfix} footprint(s), {npts:,} points")
    return {"reclassified_footprints": nfix, "points": npts, "ms": round((time.perf_counter() - t0) * 1000)}


def diagnostics(cloud_path: str | Path, footprints: list) -> tuple[dict, float]:
    """run_site.py step 4: per footprint `dens`, `raised_pct`, `c6_dens` (the field dictionary's `bld_dens`),
    and the site's `ground_z` (the median of every ground point). Returns ({id: {...}}, ground_z)."""
    import laspy
    import numpy as np

    las = laspy.read(str(cloud_path))
    x, y, z, c = _xyzc(las)
    hag, g = _height_above_ground(x, y, z, c)
    ground_z = float(np.median(z[g])) if g.any() else float(np.percentile(z, 5))
    diag = {}
    for f in footprints:
        poly = f["poly"]
        b = poly.bounds
        idx = np.where((x >= b[0]) & (x <= b[2]) & (y >= b[1]) & (y <= b[3]))[0]
        inner = poly.buffer(-INNER_M)
        inside = _inside(inner, x, y, idx) if not inner.is_empty else idx[:0]
        a = max(inner.area, 1.0)
        diag[f["id"]] = {
            "dens": round(len(inside) / a, 2),
            "raised_pct": int(round(100 * float((hag[inside] > RAISED_M).sum()) / max(len(inside), 1))),
            "c6_dens": round(float((c[inside] == BUILDING).sum()) / a, 2),
        }
    return diag, ground_z


def terrain(cloud_path: str | Path, footprints: list, cell: float = TERRAIN_CELL_M) -> tuple[dict, dict]:
    """terrain.py: a gridded DTM from the ground points (mean per cell, nearest-filled under buildings),
    downsampled to at most TERRAIN_MAX_SIDE a side, in ABSOLUTE EPSG:27700 (x0, y0) and metres AOD (z) —
    the spike's grid was local to its origin; this one needs none (Brief 56 Part 2.3). And the ground fall
    per footprint. Returns (terrain, {id: fall_m | None})."""
    import laspy
    import numpy as np
    from scipy.interpolate import griddata
    from shapely import contains_xy

    las = laspy.read(str(cloud_path))
    x, y, z, c = _xyzc(las)
    g = c == GROUND
    if g.sum() < 4:
        # no classified ground: the 5th percentile of everything stands in as a flat floor
        floor = float(np.percentile(z, 5))
        return {"x0": float(x.min()), "y0": float(y.min()), "dx": float(max(x.max() - x.min(), y.max() - y.min(), 1.0)), "w": 2, "h": 2, "z": [floor] * 4, "source": "no ground points: flat floor"}, {f["id"]: None for f in footprints}
    gx, gy, gz = x[g], y[g], z[g]
    x0, y0, x1, y1 = gx.min(), gy.min(), gx.max(), gy.max()
    nx, ny = int((x1 - x0) / cell) + 1, int((y1 - y0) / cell) + 1
    ix, iy = ((gx - x0) / cell).astype(int), ((gy - y0) / cell).astype(int)
    s = np.zeros((ny, nx))
    n = np.zeros((ny, nx))
    np.add.at(s, (iy, ix), gz)
    np.add.at(n, (iy, ix), 1)
    Z = np.where(n > 0, s / np.maximum(n, 1), np.nan)
    yy, xx = np.mgrid[0:ny, 0:nx]
    ok = ~np.isnan(Z)
    if (~ok).any() and ok.any():
        Z[~ok] = griddata(np.c_[xx[ok], yy[ok]], Z[ok], (xx[~ok], yy[~ok]), method="nearest")
    fall = {}
    for f in footprints:
        poly = f["poly"]
        ring = poly.buffer(RING_OUT_M).difference(poly.buffer(RING_IN_M))
        b = ring.bounds
        idx = np.where((gx >= b[0]) & (gx <= b[2]) & (gy >= b[1]) & (gy <= b[3]))[0]
        idx = idx[contains_xy(ring, gx[idx], gy[idx])] if len(idx) else idx
        fall[f["id"]] = round(float(np.percentile(gz[idx], 95) - np.percentile(gz[idx], 5)), 1) if len(idx) > RING_MIN_POINTS else None
    step = max(1, int(np.ceil(max(nx, ny) / TERRAIN_MAX_SIDE)))
    Zs = Z[::step, ::step]
    h, w = Zs.shape
    grid = {"x0": round(float(x0), 2), "y0": round(float(y0), 2), "dx": cell * step, "w": int(w), "h": int(h), "z": [round(float(v), 2) for v in Zs.ravel()], "source": f"class-2 ground points, {cell} m cells × {step}"}
    return grid, fall


def laz_in(directory: str | Path) -> list[str]:
    return sorted(glob.glob(os.path.join(str(directory), "*.laz"))) + sorted(glob.glob(os.path.join(str(directory), "*.las")))
