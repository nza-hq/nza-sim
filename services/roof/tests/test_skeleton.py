# Copied from nza-twin-lab @ 4da46dc (services/roof/tests/test_skeleton.py) on 2026-10-01. Diverged: no.
"""Part 2 (V2): the skeleton path on the hard plans — tiling ±0.5 %, the ratio invariant ±2 %,
3D edge closure ±1 mm, no vertical faces, deterministic. Rectangle (must equal the parametric
hip: ridge L−W, height (W/2)·tan θ), L (Brief 02's 24×12), T, U, cross, courtyard (a hole),
and the Finham main block and largest Hartpury block from the Brief 06 fixtures."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from roof.geo import DEG, polygon_3d_area, signed_area_xy
from roof.skeleton import skeleton_faces

PITCH = 30.0
EAVE = 6.0

RECT = [(0, 0), (20, 0), (20, 10), (0, 10)]
L24 = [(0, 0), (24, 0), (24, 6), (12, 6), (12, 12), (0, 12)]
TEE = [(0, 0), (30, 0), (30, 10), (20, 10), (20, 25), (10, 25), (10, 10), (0, 10)]
U = [(0, 0), (30, 0), (30, 20), (22, 20), (22, 8), (8, 8), (8, 20), (0, 20)]
CROSS = [(10, 0), (20, 0), (20, 10), (30, 10), (30, 20), (20, 20), (20, 30), (10, 30), (10, 20), (0, 20), (0, 10), (10, 10)]
COURT_OUTER = [(0, 0), (40, 0), (40, 30), (0, 30)]
COURT_HOLE = [(12, 10), (28, 10), (28, 20), (12, 20)]
BLOCKS = json.loads((Path(__file__).parent / "fixtures" / "site-blocks.json").read_text())

PLANS = {
    "rectangle": (RECT, None),
    "L (Brief 02)": (L24, None),
    "T": (TEE, None),
    "U": (U, None),
    "cross": (CROSS, None),
    "courtyard": (COURT_OUTER, [COURT_HOLE]),
    "finham-main-block": ([tuple(p) for p in BLOCKS["finham-main-block"]["ring"]], None),
    "hartpury-largest": ([tuple(p) for p in BLOCKS["hartpury-largest"]["ring"]], None),
}


def plan_area(outer, holes=None):
    a = abs(signed_area_xy(outer))
    for h in holes or []:
        a -= abs(signed_area_xy(h))
    return a


def faces_plan_area(faces):
    return sum(abs(signed_area_xy([(x, y) for x, y, _ in f["geometry"]])) for f in faces)


def faces_surface_area(faces):
    return sum(polygon_3d_area([tuple(v) for v in f["geometry"]]) for f in faces)


def on_wall(a, b, rings):
    """Both endpoints project onto the same footprint edge (a wall plane) within 1 mm."""
    for ring in rings:
        n = len(ring)
        for i in range(n):
            p, q = ring[i], ring[(i + 1) % n]
            if _seg_dist(a, p, q) <= 1e-3 and _seg_dist(b, p, q) <= 1e-3:
                return True
    return False


def _seg_dist(v, p, q):
    vx, vy = v[0] - p[0], v[1] - p[1]
    dx, dy = q[0] - p[0], q[1] - p[1]
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, (vx * dx + vy * dy) / l2))
    return math.hypot(v[0] - (p[0] + t * dx), v[1] - (p[1] + t * dy))


def assert_closed_3d(faces, rings, tol=1e-3):
    """T20: every face edge is shared with exactly one other face's edge, matching in x, y AND z
    within `tol`, or lies on a wall. A height step at a reflex corner fails here."""
    edges = []
    for f in faces:
        g = f["geometry"]
        for i in range(len(g)):
            edges.append((f["id"], tuple(g[i]), tuple(g[(i + 1) % len(g)])))
    for fid, a, b in edges:
        if math.dist(a, b) < tol:
            continue
        shared = sum(
            1
            for oid, c, d in edges
            if oid != fid and ((math.dist(a, d) <= tol and math.dist(b, c) <= tol) or (math.dist(a, c) <= tol and math.dist(b, d) <= tol))
        )
        assert shared == 1 or (shared == 0 and on_wall(a, b, rings)), f"face {fid} edge {a}→{b} shared {shared}× and not on a wall"


def assert_roof_invariants(faces, outer, holes, pitch=PITCH):
    plan = plan_area(outer, holes)
    assert abs(faces_plan_area(faces) - plan) / plan <= 0.005, "tiling"
    ratio = faces_surface_area(faces) / plan
    assert abs(ratio - 1 / math.cos(pitch * DEG)) <= 0.02 * ratio, f"ratio {ratio:.4f}"
    for f in faces:
        assert f["tilt_deg"] < 89, f"vertical face {f['id']}"
        assert f["tilt_deg"] == pytest.approx(pitch, abs=0.15), f"face {f['id']} tilt {f['tilt_deg']}"
        ring = [(x, y) for x, y, _ in f["geometry"]]
        assert signed_area_xy(ring) > 0, f"face {f['id']} is not CCW (L17)"
        for _, _, z in f["geometry"]:
            assert z >= EAVE - 1e-6, "below eave"
    assert_closed_3d(faces, [outer, *(holes or [])])


@pytest.mark.parametrize("name", list(PLANS))
@pytest.mark.parametrize("gable", [False, True], ids=["hip", "gable"])
def test_plans_tile_close_and_keep_the_ratio(name, gable):
    outer, holes = PLANS[name]
    out = skeleton_faces(outer, PITCH, EAVE, gable=gable, holes=holes)
    assert out.faces, name
    assert not out.fell_back_to_flat
    assert_roof_invariants(out.faces, outer, holes)


def test_rectangle_hip_equals_the_parametric_hip():
    out = skeleton_faces(RECT, PITCH, EAVE, gable=False)
    assert len(out.faces) == 4
    zs = sorted({round(v[2], 6) for f in out.faces for v in f["geometry"]})
    assert zs == [EAVE, pytest.approx(EAVE + 5 * math.tan(PITCH * DEG))]
    ridge = sorted({(v[0], v[1]) for f in out.faces for v in f["geometry"] if v[2] > EAVE + 1e-6})
    assert ridge == [(5.0, 5.0), (15.0, 5.0)]  # ridge length L − W = 10
    assert sorted(f["role"] for f in out.faces) == ["hip_end", "hip_end", "main", "main"]
    assert sorted(f["cardinal"] for f in out.faces) == ["E", "N", "S", "W"]


def test_rectangle_gable_is_two_slopes_with_a_full_ridge():
    out = skeleton_faces(RECT, PITCH, EAVE, gable=True)
    assert len(out.faces) == 2
    assert out.flags == []
    ridge = sorted({(v[0], v[1]) for f in out.faces for v in f["geometry"] if v[2] > EAVE + 1e-6})
    assert ridge[0] == (0.0, 5.0) and ridge[-1] == (20.0, 5.0)  # the ridge spans wall to wall
    assert all(y == 5.0 for _, y in ridge)
    for f in out.faces:  # both slopes reach both walls at the ridge
        assert (0.0, 5.0) in {(v[0], v[1]) for v in f["geometry"]} and (20.0, 5.0) in {(v[0], v[1]) for v in f["geometry"]}
    assert sorted(f["cardinal"] for f in out.faces) == ["N", "S"]
    assert all(f["role"] == "main" for f in out.faces)


def test_L_has_a_valley_from_the_inside_corner_with_no_step():
    out = skeleton_faces(L24, PITCH, EAVE, gable=False)
    assert len(out.faces) == 6
    valley = [f for f in out.faces if f["role"] == "valley"]
    assert len(valley) == 2  # the two faces whose eave edge meets the reflex corner (12, 6)
    corner = [v for f in valley for v in f["geometry"] if abs(v[0] - 12) < 1e-6 and abs(v[1] - 6) < 1e-6]
    assert len(corner) == 2 and all(abs(v[2] - EAVE) < 1e-6 for v in corner)


def test_L_gable_gables_the_bar_end_and_hips_the_square_corner():
    # The 12 × 12 block's west and north ends are both triangles meeting at one apex: gabling
    # both would leave the corner unroofed, so neither is (counted), and the bar's east end is.
    out = skeleton_faces(L24, PITCH, EAVE, gable=True)
    assert out.flags == ["GABLE_ENDS_APPROXIMATED: 2"]
    assert len(out.faces) == 5
    assert any(abs(v[0] - 24) < 1e-6 and abs(v[1] - 3) < 1e-6 and v[2] > EAVE for f in out.faces for v in f["geometry"]), "the ridge reaches the east wall at its midpoint"
    assert_roof_invariants(out.faces, L24, None)


def test_gable_on_a_reflex_touching_wing_end_is_approximated_and_said():
    # A wing whose end edge meets a reflex corner cannot be gabled (no plane to run the ridge to).
    plan = [(0, 0), (20, 0), (20, 10), (10, 10), (10, 4), (0, 4)]
    out = skeleton_faces(plan, PITCH, EAVE, gable=True)
    assert any(f.startswith("GABLE_ENDS_APPROXIMATED") for f in out.flags)
    assert_roof_invariants(out.faces, plan, None)


def test_skewed_wing_end_is_gabled_planar_to_the_millimetre():
    # A wing whose end is 8° off square: the OSM case that left 1–3 cm steps with a midpoint rule.
    skew = [(0, 0), (20, 0), (21.4, 10), (0, 10)]
    out = skeleton_faces(skew, PITCH, EAVE, gable=True)
    assert out.flags == []
    assert len(out.faces) == 2
    for f in out.faces:
        g = [tuple(v) for v in f["geometry"]]
        n = _newell(g)
        c = [sum(v[i] for v in g) / len(g) for i in range(3)]
        for v in g:
            assert abs(sum((v[i] - c[i]) * n[i] for i in range(3))) < 1e-4, f"{f['id']} off-plane"
    assert_roof_invariants(out.faces, skew, None)


def _newell(g):
    nx = ny = nz = 0.0
    for i, a in enumerate(g):
        b = g[(i + 1) % len(g)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    ln = math.hypot(nx, ny, nz)
    return (nx / ln, ny / ln, nz / ln)


def test_deterministic():
    a = skeleton_faces(TEE, PITCH, EAVE, gable=True)
    b = skeleton_faces(TEE, PITCH, EAVE, gable=True)
    assert json.dumps(a.faces) == json.dumps(b.faces)


def test_invalid_polygon_raises():
    from roof.skel import SkeletonError

    with pytest.raises(SkeletonError):
        skeleton_faces([(0, 0), (10, 10), (10, 0), (0, 10)], PITCH, EAVE, gable=False)  # bow-tie
