# Copied from nza-twin-lab @ 4da46dc (services/roof/tests/test_api.py) on 2026-10-01. Diverged: no.
"""D29 over HTTP: construct a gable on the Brief 02 L, a hip on the Finham main block, and a
batch; an invalid polygon is a flagged flat, not an error; an unknown style is a 422."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from roof.app import app

client = TestClient(app)
L24 = [[0, 0], [24, 0], [24, 6], [12, 6], [12, 12], [0, 12]]
BLOCKS = json.loads((Path(__file__).parent / "fixtures" / "site-blocks.json").read_text())


def test_construct_gable_on_the_L():
    r = client.post("/roof/construct", json={"footprint": L24, "roof": {"style": "gable", "pitch_deg": 30, "ridge_axis": "longest"}, "eave_m": 6})
    assert r.status_code == 200
    body = r.json()
    assert body["fell_back_to_flat"] is False
    assert len(body["faces"]) == 5
    assert body["flags"] == ["GABLE_ENDS_APPROXIMATED: 2"]
    assert body["ms"] < 500
    face = body["faces"][0]
    assert set(face) == {"id", "role", "cardinal", "geometry", "area_m2", "tilt_deg", "azimuth_deg"}


def test_construct_hip_on_the_finham_main_block():
    b = BLOCKS["finham-main-block"]
    r = client.post("/roof/construct", json={"footprint": b["ring"], "roof": {"style": "hip", "pitch_deg": 37}, "eave_m": b["eave_m"]})
    body = r.json()
    assert r.status_code == 200 and not body["fell_back_to_flat"]
    assert len(body["faces"]) == b["vertices"]  # one face per eave edge
    assert round(sum(abs_plan(f) for f in body["faces"])) == round(b["area_m2"])


def abs_plan(face):
    g = face["geometry"]
    return abs(sum(g[i][0] * g[(i + 1) % len(g)][1] - g[(i + 1) % len(g)][0] * g[i][1] for i in range(len(g)))) / 2


def test_batch_and_invalid_polygon_and_unknown_style():
    r = client.post(
        "/roof/construct-batch",
        json={
            "buildings": [
                {"id": "a", "footprint": L24, "roof": {"style": "hip", "pitch_deg": 30}, "eave_m": 6},
                {"id": "bowtie", "footprint": [[0, 0], [10, 10], [10, 0], [0, 10]], "roof": {"style": "hip", "pitch_deg": 30}, "eave_m": 6},
                {"id": "flat", "footprint": L24, "roof": {"style": "flat", "parapet_height_m": 0}, "eave_m": 6},
            ]
        },
    )
    assert r.status_code == 200
    res = r.json()["results"]
    assert len(res["a"]["faces"]) == 6 and not res["a"]["fell_back_to_flat"]
    assert res["bowtie"]["fell_back_to_flat"] is True and res["bowtie"]["flags"][0].startswith("INVALID_POLYGON")
    assert len(res["flat"]["faces"]) == 1 and res["flat"]["faces"][0]["cardinal"] == "flat"
    bad = client.post("/roof/construct", json={"footprint": L24, "roof": {"style": "igloo"}, "eave_m": 6})
    assert bad.status_code == 422
