"""Brief 29 P1 (Route E): the weighted skeleton through the bridge. A rectangle with equal angles
is the parametric hip; its short ends at 90° make it the parametric gable; mixed angles on an L
build and tile the plan; a flat edge among pitched ones is flagged and still closes; all-flat is
one deck; a bad angle count is refused. decodED's own tests."""

from __future__ import annotations

import math

import pytest

from roof.geo import DEG, polygon_3d_area, signed_area_xy
from roof.route import construct
from roof.weighted import edges_faces, family_from_angles

RECT = [(0, 0), (20, 0), (20, 10), (0, 10)]
L24 = [(0, 0), (24, 0), (24, 6), (12, 6), (12, 12), (0, 12)]
EAVE = 6.0


def plan_area(faces: list[dict]) -> float:
    return sum(abs(signed_area_xy([(x, y) for x, y, _ in f["geometry"]])) for f in faces if f["role"] == "main")


def test_rectangle_equal_angles_is_the_hip():
    out = edges_faces(RECT, [30, 30, 30, 30], EAVE)
    main = [f for f in out.faces if f["role"] == "main"]
    assert len(main) == 4 and out.flags == [] and not out.fell_back_to_flat
    assert all(abs(f["tilt_deg"] - 30) < 0.2 for f in main)
    # ridge height = eave + (W/2)·tan 30, ridge length = L − W
    zmax = max(z for f in main for _, _, z in f["geometry"])
    assert abs(zmax - (EAVE + 5 * math.tan(30 * DEG))) < 1e-3
    assert abs(plan_area(main) - 200) < 1.0
    # sloped surface = plan / cos 30 for a hip of one pitch
    assert abs(sum(f["area_m2"] for f in main) - 200 / math.cos(30 * DEG)) < 1.0


def test_rectangle_with_vertical_ends_is_the_gable():
    # edges: 0 = south (long), 1 = east (short end), 2 = north (long), 3 = west (short end)
    out = edges_faces(RECT, [35, 90, 35, 90], EAVE)
    main = [f for f in out.faces if f["role"] == "main"]
    walls = [f for f in out.faces if f["role"] == "gable_end_wall"]
    assert len(main) == 2, [f["role"] for f in out.faces]
    assert len(walls) == 2
    assert all(abs(f["tilt_deg"] - 35) < 0.2 for f in main)
    zmax = max(z for f in main for _, _, z in f["geometry"])
    assert abs(zmax - (EAVE + 5 * math.tan(35 * DEG))) < 1e-3
    # the ridge runs the full length: both roof faces reach x = 0 and x = 20 at the ridge height
    ridge_xs = sorted({round(x, 3) for f in main for x, _, z in f["geometry"] if abs(z - zmax) < 1e-6})
    assert ridge_xs[0] < 0.02 and ridge_xs[-1] > 19.98  # the 89.9° wall leans a centimetre
    assert abs(plan_area(main) - 200) < 1.0


def test_one_pitched_edge_and_three_vertical_is_a_mono():
    out = edges_faces(RECT, [20, 90, 90, 90], EAVE)
    main = [f for f in out.faces if f["role"] == "main"]
    assert len(main) == 1 and abs(main[0]["tilt_deg"] - 20) < 0.2
    zmax = max(z for _, _, z in main[0]["geometry"])
    assert abs(zmax - (EAVE + 10 * math.tan(20 * DEG))) < 0.01  # three 89.9° walls: a centimetre


def test_mixed_angles_on_an_L_build_and_tile_the_plan():
    out = edges_faces(L24, [30, 90, 30, 40, 30, 90], EAVE)
    main = [f for f in out.faces if f["role"] == "main"]
    assert not out.fell_back_to_flat and out.flags == []
    assert abs(plan_area(main) - abs(signed_area_xy(L24))) < abs(signed_area_xy(L24)) * 0.005
    tilts = sorted({round(f["tilt_deg"]) for f in main})
    assert tilts == [30, 40], tilts


def test_a_flat_edge_among_pitched_is_flagged_and_still_closes():
    out = edges_faces(RECT, [30, 90, 0, 90], EAVE)
    assert any(f.startswith("EDGES_MIXED_FLAT") for f in out.flags)
    assert not out.fell_back_to_flat
    assert abs(plan_area(out.faces) - 200) < 1.0


def test_all_flat_is_one_deck():
    out = edges_faces(RECT, [0, 0, 0, 0], EAVE)
    assert out.flags == ["EDGES_ALL_FLAT"] and len(out.faces) == 1 and out.faces[0]["tilt_deg"] == 0


def test_clockwise_input_keeps_angles_with_their_edges():
    cw = list(reversed(RECT))  # (0,10),(20,10),(20,0),(0,0): edge 0 = north, 1 = east, 2 = south, 3 = west
    out = edges_faces(cw, [35, 90, 35, 90], EAVE)
    main = [f for f in out.faces if f["role"] == "main"]
    assert len(main) == 2 and all(abs(f["tilt_deg"] - 35) < 0.2 for f in main)


def test_wrong_angle_count_is_refused():
    with pytest.raises(ValueError):
        edges_faces(RECT, [30, 30, 30], EAVE)


def test_route_dispatches_edges_before_the_rectangle_shortcut():
    out = construct(RECT, {"style": "edges", "angles_deg": [30, 90, 30, 90]}, EAVE)
    assert len([f for f in out.faces if f["role"] == "main"]) == 2
    assert all(f["id"].startswith("e") for f in out.faces)


def test_family_from_angles():
    assert family_from_angles([30, 30, 30, 30], [20, 10, 20, 10]) == "hip"
    assert family_from_angles([30, 90, 30, 90], [20, 10, 20, 10]) == "gable"
    assert family_from_angles([20, 90, 90, 90], [20, 10, 20, 10]) == "mono"
    assert family_from_angles([0, 0, 0, 0], [20, 10, 20, 10]) == "flat"
    assert family_from_angles([30, 90, 0, 90], [20, 10, 20, 10]) == "mixed"
