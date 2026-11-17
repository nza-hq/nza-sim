"""Brief 195 Part 3: the streamed point-cloud steps (stream.py) agree with Brief 56's in-memory ones (cloud.py) on
the same synthetic cloud — a flat-ish ground with one class-6 roof and one unclassified shed — in many small
chunks, so the chunk seams are crossed. Skipped where the job's libraries are not installed; the image has them."""

import pytest

from roofer import cloud, deps_available, stream
from test_roofer_cloud import _fps, _write_cloud  # same synthetic cloud as Brief 56

needs_deps = pytest.mark.skipif(not deps_available()[0], reason=f"roofer job deps missing: {deps_available()[1]}")


@needs_deps
@pytest.mark.parametrize("chunk", ["10000", "1000000"])
def test_streamed_matches_in_memory(tmp_path, monkeypatch, chunk):
    import laspy
    from shapely.geometry import box

    monkeypatch.setenv("ROOFER_CHUNK_POINTS", chunk)
    src = tmp_path / "tile.laz"
    _write_cloud(src)
    fps = _fps()
    site = box(432045, 275045, 432135, 275135)
    work = tmp_path / "w"
    work.mkdir()
    pc = stream.process([str(src)], site, fps, work, reclass=True, log=lambda m: None)

    # the reference: cloud.py over the same points (the stream's own clip, so both see one cloud)
    diag, ground_z = cloud.diagnostics(pc["cloud"], fps)
    grid, fall = cloud.terrain(pc["cloud"], fps)
    rc = cloud.reclassify(pc["cloud"], fps, tmp_path / "ref.laz")

    assert pc["clipped"]["files_read"] == 1 and pc["clipped"]["points"] > 9000
    assert abs(pc["ground_z"] - ground_z) < 0.02
    for fid in ("roof", "shed"):
        a, b = pc["diag"][fid], diag[fid]
        assert a["dens"] == b["dens"] and a["c6_dens"] == b["c6_dens"], (fid, a, b)
        assert abs(a["raised_pct"] - b["raised_pct"]) <= 2, (fid, a, b)
        assert (pc["fall"][fid] is None) == (fall[fid] is None)
        if fall[fid] is not None:
            assert abs(pc["fall"][fid] - fall[fid]) <= 0.1
    assert pc["reclass"]["reclassified_footprints"] == rc["reclassified_footprints"] == 1
    assert abs(pc["reclass"]["points"] - rc["points"]) <= max(5, rc["points"] // 50)
    assert (pc["terrain"]["w"], pc["terrain"]["h"], pc["terrain"]["x0"], pc["terrain"]["y0"]) == (grid["w"], grid["h"], grid["x0"], grid["y0"])
    assert max(abs(p - q) for p, q in zip(pc["terrain"]["z"], grid["z"])) < 0.05

    # roofer's cloud: the shed's points are class 6 now, and nothing is further than 40 m from a footprint
    las = laspy.read(str(pc["roofer_cloud"]))
    import numpy as np
    shed = (las.x >= 432121) & (las.x <= 432129) & (las.y >= 275121) & (las.y <= 275127)
    assert (np.asarray(las.classification)[shed] == 6).mean() > 0.9
    assert pc["roofer_points"] == len(las.points) <= pc["clipped"]["points"]


@needs_deps
def test_the_clip_keeps_the_site_polygon_not_its_box(tmp_path, monkeypatch):
    from shapely.geometry import Polygon

    monkeypatch.setenv("ROOFER_CHUNK_POINTS", "10000")
    src = tmp_path / "tile.laz"
    _write_cloud(src)
    fps = _fps()
    # an L-shaped site: its bounding box is the 200 m square, the polygon about half of it
    site = Polygon([(432000, 275000), (432200, 275000), (432200, 275060), (432100, 275060), (432100, 275200), (432000, 275200)])
    work = tmp_path / "w"
    work.mkdir()
    pc = stream.process([str(src)], site, fps, work, log=lambda m: None)
    assert pc["clipped"]["points"] < 38000  # the box would keep every one of the ~39,000 points
    with pytest.raises(RuntimeError, match="no LiDAR"):
        stream.process([str(src)], Polygon([(0, 0), (10, 0), (10, 10)]), [{"id": "x", "poly": Polygon([(1, 1), (5, 1), (5, 5)]), "area_m2": 8}], work, log=lambda m: None)


def test_chunk_size_is_bounded(monkeypatch):
    monkeypatch.setenv("ROOFER_CHUNK_POINTS", "5000000")
    assert stream.chunk_points() == 1_000_000
    monkeypatch.setenv("ROOFER_CHUNK_POINTS", "x")
    assert stream.chunk_points() == 250_000
