# Copied from nza-twin-lab @ 4da46dc (services/roof/tests/test_route.py) on 2026-10-01. Diverged: no.
"""Part 3: routing — rectangle → parametric (all 14 styles), mono over the real footprint, L →
skeleton, a rectangle-only style on an L is a hip and says so, invalid → flat and says so; and
V10: the Finham batch (26 buildings from the Brief 06 fixture) constructs in under 2 s."""

import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from roof.app import app
from roof.route import construct

FIX = Path(__file__).parent / "fixtures"
L24 = [(0, 0), (24, 0), (24, 6), (12, 6), (12, 12), (0, 12)]
RECT = [(0, 0), (20, 0), (20, 10), (0, 10)]


def test_rectangle_goes_parametric_for_every_style():
    ref = json.loads((FIX / "parametric-reference.json").read_text())
    for case, r in ref["shapes"].items():
        if not case.endswith(":axis:longest"):
            continue
        out = construct(r["footprint"], r["roof"], ref["eave"])
        assert len(out.faces) == len(r["faces"]), case
        assert out.flags == [] and not out.fell_back_to_flat


def test_mono_on_an_L_is_one_plane_over_the_real_footprint():
    out = construct(L24, {"style": "mono", "pitch_deg": 20, "high_side": "N"}, 6)
    assert len(out.faces) == 1 and out.faces[0]["cardinal"] == "S"
    assert len(out.faces[0]["geometry"]) == 6


def test_rectangle_only_styles_on_an_L_are_hips_that_say_so():
    out = construct(L24, {"style": "mansard", "lower_pitch_deg": 70, "upper_pitch_deg": 15, "break_height_m": 2.5, "ridge_axis": "longest"}, 6)
    assert out.flags == ["STYLE_APPROXIMATED_AS_HIP: mansard"]
    assert len(out.faces) == 6 and not out.fell_back_to_flat


def test_a_quad_that_does_not_fill_its_box_goes_to_the_skeleton():
    # Four corners within 1° of square, but 1 % of the box is not building (Cowbridge osm:way:839920827).
    quad = [(0, 0), (30, 0), (30.3, 12), (0, 12.2)]
    out = construct(quad, {"style": "gable", "pitch_deg": 30, "ridge_axis": "longest"}, 6)
    assert out.faces[0]["id"].startswith("f")  # skeleton faces, not parametric "p" faces
    plan = abs(sum(quad[i][0] * quad[(i + 1) % 4][1] - quad[(i + 1) % 4][0] * quad[i][1] for i in range(4))) / 2
    tiled = sum(abs(sum(g[i][0] * g[(i + 1) % len(g)][1] - g[(i + 1) % len(g)][0] * g[i][1] for i in range(len(g)))) / 2 for g in (f["geometry"] for f in out.faces))
    assert abs(tiled - plan) / plan < 0.001


def test_flat_with_a_courtyard_tiles_outer_minus_hole():
    out = construct(COURT, {"style": "flat", "parapet_height_m": 0}, 6, holes=[HOLE])
    assert not out.fell_back_to_flat and len(out.faces) == 8
    tiled = sum(abs(sum(g[i][0] * g[(i + 1) % len(g)][1] - g[(i + 1) % len(g)][0] * g[i][1] for i in range(len(g)))) / 2 for g in (f["geometry"] for f in out.faces))
    assert abs(tiled - (40 * 30 - 16 * 10)) < 1e-6
    assert all(f["cardinal"] == "flat" for f in out.faces)


COURT = [(0, 0), (40, 0), (40, 30), (0, 30)]
HOLE = [(12, 10), (28, 10), (28, 20), (12, 20)]


def test_invalid_polygons_are_flat_and_flagged():
    out = construct([(0, 0), (10, 10), (10, 0), (0, 10)], {"style": "gable", "pitch_deg": 30, "ridge_axis": "longest"}, 6)
    assert out.fell_back_to_flat and out.flags[0].startswith("INVALID_POLYGON")
    assert len(out.faces) == 1
    out = construct([(0, 0), (1, 1)], {"style": "hip", "pitch_deg": 30}, 6)
    assert out.fell_back_to_flat and out.faces == []


def test_finham_batch_under_two_seconds_with_per_building_ms():
    site = json.loads((FIX / "finham-buildings.json").read_text())
    t = time.perf_counter()
    r = TestClient(app).post("/roof/construct-batch", json={"buildings": site["buildings"]})
    wall = time.perf_counter() - t
    assert r.status_code == 200
    body = r.json()
    assert len(body["results"]) == 26
    assert wall < 2.0, f"batch took {wall:.2f} s"
    assert body["ms"] < 2000
    fell = [i for i, x in body["results"].items() if x["fell_back_to_flat"]]
    assert fell == [], f"fell back: {fell}"
    for x in body["results"].values():
        assert "ms" in x and x["faces"]
