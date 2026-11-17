"""Brief 56 Part 2.2: the point-cloud steps on a synthetic cloud — a flat ground at 80 m with one pitched
roof over a footprint and one unclassified shed — so clip, RECLASS, the diagnostics and the terrain grid are
checked without a tile. Skipped where the job's libraries are not installed; the image has them."""

import pytest

from roofer import cloud, deps_available

needs_deps = pytest.mark.skipif(not deps_available()[0], reason=f"roofer job deps missing: {deps_available()[1]}")


def _write_cloud(path):
    import laspy
    import numpy as np

    rng = np.random.default_rng(1)
    # ground: 200 × 200 m at 1 pt/m², z = 80 + a gentle 0.5 m fall west→east — and none under the two
    # buildings, as a real survey's ground class has none under a roof
    gx = rng.uniform(432000, 432200, 40000)
    gy = rng.uniform(275000, 275200, 40000)
    under = ((gx >= 432050) & (gx <= 432090) & (gy >= 275050) & (gy <= 275070)) | ((gx >= 432120) & (gx <= 432130) & (gy >= 275120) & (gy <= 275128))
    gx, gy = gx[~under], gy[~under]
    gz = 80 + (gx - 432000) / 400
    gc = np.full(gx.size, 2)
    # a gable roof over 432050–432090 × 275050–275070, eave 85, ridge 89 along x, class 6, 3 pts/m²
    rx = rng.uniform(432050, 432090, 2400)
    ry = rng.uniform(275050, 275070, 2400)
    rz = 85 + 4 * (1 - abs(ry - 275060) / 10)
    rc = np.full(rx.size, 6)
    # a shed over 432120–432130 × 275120–275128 left unclassified (class 1), 3 m up
    sx = rng.uniform(432120, 432130, 240)
    sy = rng.uniform(275120, 275128, 240)
    sz = np.full(sx.size, 83.2)
    sc = np.full(sx.size, 1)
    x = np.concatenate([gx, rx, sx])
    y = np.concatenate([gy, ry, sy])
    z = np.concatenate([gz, rz, sz])
    c = np.concatenate([gc, rc, sc])
    h = laspy.LasHeader(point_format=6, version="1.4")
    h.offsets = [432000, 275000, 0]
    h.scales = [0.01, 0.01, 0.01]
    las = laspy.LasData(h)
    las.x, las.y, las.z = x, y, z
    las.classification = c
    las.write(str(path))


def _fps():
    from shapely.geometry import box

    roof = box(432050, 275050, 432090, 275070)
    shed = box(432120, 275120, 432130, 275128)
    return [{"id": "roof", "poly": roof, "area_m2": roof.area}, {"id": "shed", "poly": shed, "area_m2": shed.area}]


@needs_deps
def test_clip_reclass_diagnostics_terrain(tmp_path):
    src = tmp_path / "tile.laz"
    _write_cloud(src)
    out = tmp_path / "cloud.laz"
    clipped = cloud.clip([str(src)], (432040, 275040, 432140, 275140), out)
    assert clipped["files_read"] == 1 and 9000 < clipped["points"] < 14000
    assert "no LiDAR" in str(pytest.raises(RuntimeError, cloud.clip, [str(src)], (0, 0, 10, 10), tmp_path / "none.laz").value)

    fps = _fps()
    rc = cloud.reclassify(out, fps, tmp_path / "reclass.laz")
    assert rc["reclassified_footprints"] == 1 and rc["points"] > 200, "the shed is rescued, the roof already has class 6"

    diag, ground_z = cloud.diagnostics(out, fps)
    assert 80 < ground_z < 80.6
    assert diag["roof"]["raised_pct"] > 90 and diag["roof"]["c6_dens"] > 2
    assert diag["shed"]["raised_pct"] > 90 and diag["shed"]["c6_dens"] == 0
    assert 2 < diag["roof"]["dens"] < 4

    grid, fall = cloud.terrain(out, fps)
    assert grid["w"] >= 2 and grid["h"] >= 2 and len(grid["z"]) == grid["w"] * grid["h"]
    assert 79.5 < min(grid["z"]) and max(grid["z"]) < 81
    assert fall["roof"] is not None and fall["roof"] < 0.4, "a gentle fall reads under 0.4 m"
    # the grid is absolute (no origin): its corner sits in the box
    assert 432040 <= grid["x0"] <= 432045 and 275040 <= grid["y0"] <= 275045
