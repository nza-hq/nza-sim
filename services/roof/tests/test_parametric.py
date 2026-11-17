# Copied from nza-twin-lab @ 4da46dc (services/roof/tests/test_parametric.py) on 2026-10-01. Diverged: no.
"""Part 3 (V3): the 14 parametric shapes on the 20 × 10 rectangle (axis-aligned and rotated
0.5 rad; gable and hip on both axes) match the TypeScript engine face for face — role, cardinal,
area, tilt, azimuth and every vertex — before that engine is deleted. Reference recorded from
packages/roof (routeRoofFaces) on 27 Sep 2026: tests/fixtures/parametric-reference.json."""

import json
from pathlib import Path

import pytest

from roof.generators import ROOF_SHAPES, parametric_faces

REF = json.loads((Path(__file__).parent / "fixtures" / "parametric-reference.json").read_text())


def key(face):
    # The TypeScript engine rounds 359.6 to 360; the contract's range is 0..360, so 360 is 0.
    return (face["role"], face["cardinal"], face["area_m2"], face["tilt_deg"], face["azimuth_deg"] % 360)


def vertices(face):
    return sorted(tuple(round(c, 4) for c in v) for v in face["geometry"])


@pytest.mark.parametrize("case", sorted(REF["shapes"]))
def test_shape_matches_the_typescript_engine(case):
    ref = REF["shapes"][case]
    faces = parametric_faces(ref["footprint"], ref["roof"], REF["eave"])
    assert len(faces) == len(ref["faces"]), case
    assert sorted(map(key, faces)) == sorted(map(key, ref["faces"])), case
    # The same vertex sets face by face (the engine's rings were not always CCW — F4 — so the
    # order may differ; the service's are, by L17, and test_skeleton asserts it).
    assert sorted(map(vertices, faces)) == sorted(map(vertices, ref["faces"])), case


def test_every_contract_shape_has_a_reference_case():
    styles = {c.split(":")[0] for c in REF["shapes"]}
    assert styles == set(ROOF_SHAPES)
