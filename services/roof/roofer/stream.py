"""Brief 195 Part 3: the point-cloud steps, streamed. Never a whole tile, and never the whole clipped cloud, in memory.

cloud.py (Brief 56) read every point in the site's bounding box into one array, then read the clipped cloud back
whole three more times (reclassify, diagnostics, terrain) and built a k-d tree over every ground point to find each
point's height above ground. On Hartpury College (192 ha, two EA tiles) that ran the container out of memory on
2 GB. The same steps here, chunk by chunk:

  pass 0  every tile that touches the region, ROOFER_CHUNK_POINTS at a time (default 250,000; the brief's ceiling
          is 1,000,000). Keep only the points inside the site + 40 m (the polygon, not its bounding box) and the
          footprints + 40 m; write them straight to `cloud.laz`. On the way, the ground (class 2) points build a
          ground grid (mean z per cell), a 1 cm histogram for the site's median ground z, and their extent.
  pass 1  `cloud.laz` again: each point's height above ground is its z less the ground grid at its cell (empty
          cells take the nearest filled one) — the bounded height-above-ground step. Per footprint: the counts
          RECLASS and the diagnostics need, the terrain sums, and the ground z in each footprint's 1–4 m ring.
  pass 2  `cloud.laz` once more: write `roofer.laz`, what roofer reads: the points within 40 m of a footprint,
          with RECLASS applied to the footprints that need it. On a compact school that is nearly every point; on
          an estate of fields it is a small part of the site.

What changes for the method (for Imi's review):
  * height above ground is from a ground grid of GROUND_CELL_M (1 m; 2 m when the region would need more than
    GROUND_MAX_CELLS cells), not from the single nearest ground point. Under a roof both take the nearest ground
    beside it; on open ground they agree to within the cell's spread.
  * the site's ground z is the median to 1 cm (a histogram), not exact.
  * the clip keeps the site + 40 m polygon and footprints + 40 m, not their bounding box + 40 m; roofer is given
    the footprints + 40 m only. The terrain grid covers the same area; cells outside it are filled from the
    nearest ground as before.
Every number the rows report (dens, raised_pct, c6_dens, fall, the terrain grid) keeps cloud.py's definition:
tests/test_roofer_stream.py runs both on the same synthetic cloud and compares them.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from .cloud import BUILDING, GROUND, INNER_M, RAISED_M, RECLASS_FROM, RING_IN_M, RING_MIN_POINTS, RING_OUT_M, TERRAIN_CELL_M, TERRAIN_MAX_SIDE

MARGIN_M = 40.0
GROUND_CELL_M = 1.0
GROUND_MAX_CELLS = 6_000_000
Z_MIN, Z_MAX, Z_BIN = -100.0, 1400.0, 0.01


def chunk_points() -> int:
    try:
        v = int(os.environ.get("ROOFER_CHUNK_POINTS", "250000"))
    except ValueError:
        v = 250_000
    return max(10_000, min(v, 1_000_000))


def _out_header(src_header):
    import laspy

    h = laspy.LasHeader(point_format=src_header.point_format.id, version=src_header.version)
    h.offsets, h.scales = src_header.offsets, src_header.scales
    return h


def _record(chunk, mask, out_header):
    """The masked points of `chunk` as a record in `out_header`'s format and scales (tiles may differ in both)."""
    import laspy
    import numpy as np

    n = int(mask.sum())
    rec = laspy.ScaleAwarePointRecord.zeros(n, header=out_header)
    names = set(chunk.point_format.dimension_names)
    for name in out_header.point_format.dimension_names:
        if name in ("X", "Y", "Z") or name not in names:
            continue
        rec[name] = np.asarray(chunk[name])[mask]
    rec.x, rec.y, rec.z = np.asarray(chunk.x)[mask], np.asarray(chunk.y)[mask], np.asarray(chunk.z)[mask]
    return rec


class _Footprints:
    """Each footprint's shapes and bounds, prepared once."""

    def __init__(self, fps):
        import shapely

        self.items = []
        for f in fps:
            poly = f["poly"]
            inner = poly.buffer(-INNER_M)
            ring = poly.buffer(RING_OUT_M).difference(poly.buffer(RING_IN_M))
            for g in (poly, inner, ring):
                shapely.prepare(g)
            self.items.append({"id": f["id"], "poly": poly, "inner": inner, "ring": ring, "b": poly.bounds, "rb": ring.bounds})


def _in_bounds(x, y, b):
    return (x >= b[0]) & (x <= b[2]) & (y >= b[1]) & (y <= b[3])


def process(laz_files: list[str], site_poly, fps: list, work: str | Path, reclass: bool = True, log=print) -> dict:
    """The whole point-cloud part of the job, streamed. Returns
    {"clipped": {points, files_read, ms}, "reclass": {...} | None, "diag", "ground_z", "terrain", "fall",
     "cloud": path of cloud.laz, "roofer_cloud": path of roofer.laz, "roofer_points", "ms"}."""
    import laspy
    import numpy as np
    import shapely
    from scipy import ndimage
    from shapely.ops import unary_union

    t0 = time.perf_counter()
    work = Path(work)
    chunk_n = chunk_points()
    fp_union = unary_union([f["poly"] for f in fps])
    near = fp_union.buffer(MARGIN_M)
    region = unary_union([site_poly.buffer(MARGIN_M), near])
    shapely.prepare(region)
    shapely.prepare(near)
    rx0, ry0, rx1, ry1 = region.bounds
    cell = GROUND_CELL_M
    if ((rx1 - rx0) / cell + 1) * ((ry1 - ry0) / cell + 1) > GROUND_MAX_CELLS:
        cell = 2.0
    nx, ny = int((rx1 - rx0) / cell) + 1, int((ry1 - ry0) / cell) + 1
    gsum = np.zeros((ny, nx), dtype=np.float32)
    gcnt = np.zeros((ny, nx), dtype=np.uint16)
    hist = np.zeros(int((Z_MAX - Z_MIN) / Z_BIN) + 1, dtype=np.int64)
    gext = [np.inf, np.inf, -np.inf, -np.inf]

    # pass 0 · tiles → cloud.laz (site + 40 m, footprints + 40 m), and the ground grid
    raw = work / "cloud.laz"
    writer, out_header, files_read, kept = None, None, 0, 0
    try:
        for f in sorted(laz_files):
            with laspy.open(f) as r:
                h = r.header
                if h.maxs[0] < rx0 or h.mins[0] > rx1 or h.maxs[1] < ry0 or h.mins[1] > ry1:
                    continue
                files_read += 1
                if writer is None:
                    out_header = _out_header(h)
                    writer = laspy.open(str(raw), mode="w", header=out_header)
                for ch in r.chunk_iterator(chunk_n):
                    x, y = np.asarray(ch.x), np.asarray(ch.y)
                    m = _in_bounds(x, y, (rx0, ry0, rx1, ry1))
                    if not m.any():
                        continue
                    idx = np.flatnonzero(m)
                    idx = idx[shapely.contains_xy(region, x[idx], y[idx])]
                    if not len(idx):
                        continue
                    m = np.zeros(len(x), dtype=bool)
                    m[idx] = True
                    rec = _record(ch, m, out_header)
                    writer.write_points(rec)
                    kept += len(idx)
                    c = np.asarray(ch.classification)[idx]
                    g = c == GROUND
                    if g.any():
                        gx, gy, gz = x[idx][g], y[idx][g], np.asarray(ch.z)[idx][g]
                        ix = ((gx - rx0) / cell).astype(np.int64)
                        iy = ((gy - ry0) / cell).astype(np.int64)
                        np.add.at(gsum, (iy, ix), gz.astype(np.float32))
                        np.add.at(gcnt, (iy, ix), 1)
                        zb = np.clip(((gz - Z_MIN) / Z_BIN).astype(np.int64), 0, len(hist) - 1)
                        hist += np.bincount(zb, minlength=len(hist))
                        gext = [min(gext[0], gx.min()), min(gext[1], gy.min()), max(gext[2], gx.max()), max(gext[3], gy.max())]
                    del ch, x, y, m, idx, rec
    finally:
        if writer is not None:
            writer.close()
    if writer is None or kept == 0:
        raise RuntimeError(f"no LiDAR tile covers the site region {tuple(round(v) for v in region.bounds)}")
    clipped = {"points": kept, "files_read": files_read, "ms": round((time.perf_counter() - t0) * 1000)}
    log(f"[roofer] streamed {kept:,} points from {files_read} file(s) into {raw.name} ({chunk_n:,} a chunk)")

    # the ground grid: mean z per cell, empty cells from the nearest filled one (bounded: one value per cell)
    have_ground = bool(gcnt.any())
    if have_ground:
        G = np.where(gcnt > 0, gsum / np.maximum(gcnt, 1), np.nan).astype(np.float32)
        del gsum
        empty = gcnt == 0
        if empty.any():
            iy_, ix_ = ndimage.distance_transform_edt(empty, return_distances=False, return_indices=True)
            G = G[iy_, ix_]
            del iy_, ix_
        del empty
        total = int(hist.sum())
        ground_z = float(Z_MIN + (np.searchsorted(np.cumsum(hist), (total + 1) // 2) + 0.5) * Z_BIN)
    else:
        G = None
        ground_z = None
    del gcnt

    items = _Footprints(fps).items
    n_fp = len(items)
    in_fp = np.zeros(n_fp, dtype=np.int64)
    c6_fp = np.zeros(n_fp, dtype=np.int64)
    inner_n = np.zeros(n_fp, dtype=np.int64)
    inner_raised = np.zeros(n_fp, dtype=np.int64)
    inner_c6 = np.zeros(n_fp, dtype=np.int64)
    ring_z: list[list] = [[] for _ in items]
    # terrain: class-2 points, TERRAIN_CELL_M cells from the ground's own corner, as cloud.terrain
    if have_ground:
        tx0, ty0, tx1, ty1 = gext
        tnx, tny = int((tx1 - tx0) / TERRAIN_CELL_M) + 1, int((ty1 - ty0) / TERRAIN_CELL_M) + 1
        tsum = np.zeros((tny, tnx))
        tcnt = np.zeros((tny, tnx))
    z_all_lo = []  # no ground at all: the 5th percentile of everything stands in (cloud.terrain), from a sample

    def hag_of(x, y, z):
        if G is None:
            return np.zeros_like(z)
        ix = np.clip(((x - rx0) / cell).astype(np.int64), 0, nx - 1)
        iy = np.clip(((y - ry0) / cell).astype(np.int64), 0, ny - 1)
        return z - G[iy, ix]

    # pass 1 · per-footprint counts, terrain sums, ring ground z
    with laspy.open(str(raw)) as r:
        for ch in r.chunk_iterator(chunk_n):
            x, y, z = np.asarray(ch.x), np.asarray(ch.y), np.asarray(ch.z)
            c = np.asarray(ch.classification)
            hag = hag_of(x, y, z)
            g = c == GROUND
            if have_ground and g.any():
                gx, gy, gz = x[g], y[g], z[g]
                ix = ((gx - tx0) / TERRAIN_CELL_M).astype(np.int64)
                iy = ((gy - ty0) / TERRAIN_CELL_M).astype(np.int64)
                np.add.at(tsum, (iy, ix), gz)
                np.add.at(tcnt, (iy, ix), 1)
            elif not have_ground and len(z):
                z_all_lo.append(np.percentile(z, 5))
            for k, it in enumerate(items):
                idx = np.flatnonzero(_in_bounds(x, y, it["b"]))
                if len(idx):
                    inside = idx[shapely.contains_xy(it["poly"], x[idx], y[idx])]
                    in_fp[k] += len(inside)
                    c6_fp[k] += int((c[inside] == BUILDING).sum())
                    if not it["inner"].is_empty and len(inside):
                        inn = inside[shapely.contains_xy(it["inner"], x[inside], y[inside])]
                        inner_n[k] += len(inn)
                        inner_raised[k] += int((hag[inn] > RAISED_M).sum())
                        inner_c6[k] += int((c[inn] == BUILDING).sum())
                if have_ground:
                    gi = np.flatnonzero(g & _in_bounds(x, y, it["rb"]))
                    if len(gi):
                        gi = gi[shapely.contains_xy(it["ring"], x[gi], y[gi])]
                        if len(gi):
                            ring_z[k].append(z[gi].astype(np.float32))
            del ch, x, y, z, c, hag, g

    diag = {}
    for k, it in enumerate(items):
        a = max(it["inner"].area, 1.0)
        diag[it["id"]] = {
            "dens": round(int(inner_n[k]) / a, 2),
            "raised_pct": int(round(100 * float(inner_raised[k]) / max(int(inner_n[k]), 1))),
            "c6_dens": round(float(inner_c6[k]) / a, 2),
        }
    fall = {}
    for k, it in enumerate(items):
        zs = np.concatenate(ring_z[k]) if ring_z[k] else np.zeros(0)
        fall[it["id"]] = round(float(np.percentile(zs, 95) - np.percentile(zs, 5)), 1) if len(zs) > RING_MIN_POINTS else None
    del ring_z

    if have_ground:
        Z = np.where(tcnt > 0, tsum / np.maximum(tcnt, 1), np.nan)
        del tsum
        ok = tcnt > 0
        if (~ok).any():
            iy_, ix_ = ndimage.distance_transform_edt(~ok, return_distances=False, return_indices=True)
            Z = Z[iy_, ix_]
        del tcnt
        step = max(1, int(np.ceil(max(tnx, tny) / TERRAIN_MAX_SIDE)))
        Zs = Z[::step, ::step]
        h_, w_ = Zs.shape
        terrain = {"x0": round(float(tx0), 2), "y0": round(float(ty0), 2), "dx": TERRAIN_CELL_M * step, "w": int(w_), "h": int(h_), "z": [round(float(v), 2) for v in Zs.ravel()], "source": f"class-2 ground points, {TERRAIN_CELL_M} m cells × {step} (streamed, Brief 195)"}
    else:
        floor = float(np.median(z_all_lo)) if z_all_lo else 0.0
        ground_z = floor
        bx = region.bounds
        terrain = {"x0": float(bx[0]), "y0": float(bx[1]), "dx": float(max(bx[2] - bx[0], bx[3] - bx[1], 1.0)), "w": 2, "h": 2, "z": [floor] * 4, "source": "no ground points: flat floor"}
        fall = {it["id"]: None for it in items}

    # pass 2 · roofer.laz: the points within 40 m of a footprint, RECLASS applied where a footprint needs it
    fix = [k for k in range(n_fp) if reclass and in_fp[k] and c6_fp[k] == 0]
    roofer_cloud = work / "roofer.laz"
    nfix_pts, fixed_fp, roofer_points = 0, set(), 0
    with laspy.open(str(raw)) as r, laspy.open(str(roofer_cloud), mode="w", header=_out_header(r.header)) as w:
        for ch in r.chunk_iterator(chunk_n):
            x, y = np.asarray(ch.x), np.asarray(ch.y)
            keep = shapely.contains_xy(near, x, y)
            if not keep.any():
                continue
            if fix:
                c = np.asarray(ch.classification).copy()
                hag = hag_of(x, y, np.asarray(ch.z))
                for k in fix:
                    it = items[k]
                    idx = np.flatnonzero(_in_bounds(x, y, it["b"]))
                    if not len(idx):
                        continue
                    idx = idx[shapely.contains_xy(it["poly"], x[idx], y[idx])]
                    sel = idx[np.isin(c[idx], RECLASS_FROM) & (hag[idx] > RAISED_M)]
                    if len(sel):
                        c[sel] = BUILDING
                        nfix_pts += len(sel)
                        fixed_fp.add(k)
                ch.classification = c
            w.write_points(ch[keep])
            roofer_points += int(keep.sum())
            del ch, x, y, keep
    rc = {"reclassified_footprints": len(fixed_fp), "points": nfix_pts, "ms": 0} if reclass else None
    if reclass:
        log(f"[roofer] reclassified {len(fixed_fp)} footprint(s), {nfix_pts:,} points")
    log(f"[roofer] roofer reads {roofer_points:,} of {kept:,} points (within {MARGIN_M:.0f} m of a footprint)")
    return {
        "clipped": clipped,
        "reclass": rc,
        "diag": diag,
        "ground_z": ground_z,
        "terrain": terrain,
        "fall": fall,
        "cloud": raw,
        "roofer_cloud": roofer_cloud,
        "roofer_points": roofer_points,
        "ground_cell_m": cell,
        "ms": round((time.perf_counter() - t0) * 1000),
    }
