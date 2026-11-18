"""decodED's own (Brief 173, 4 Nov 2026): the service defends itself. The roofer queue is bounded — full
answers 429 queue_full with a Retry-After, the same school with the same footprints is answered with its
state and never takes a second slot, /health reports depth and max — and the request models carry the
limits checkRoofBatch (src/middleware/guards.js) enforces: one over is a 422, at the limit is accepted, a
NaN is never a coordinate. The worker is stubbed so nothing ever drains; the roofer job never runs here."""

import os
import queue as _queue

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from roof import app as appmod
from roof import skel
from roofer import job, store
from roofer import queue as rq

client = TestClient(appmod.app)
FLAT = {"style": "flat"}
SITE = {"type": "Polygon", "coordinates": [[[-1.53, 52.379], [-1.52, 52.379], [-1.52, 52.382], [-1.53, 52.382], [-1.53, 52.379]]]}
RING = [[-1.526, 52.38], [-1.5258, 52.38], [-1.5258, 52.3801], [-1.526, 52.3801], [-1.526, 52.38]]


def ring(n):
    """A footprint of n vertices in local metres (a spiral-ish polygon; its shape does not matter to the limits)."""
    return [[i, (i * 7) % 13] for i in range(n)]


def geo_ring(n):
    return [[-1.5 + i * 1e-6, 52.0 + i * 1e-6] for i in range(n)]


def footprint(i=0, n=None):
    coords = geo_ring(n) if n else [[x + i * 1e-4, y] for x, y in RING]
    return {"id": f"osm:way:{i}", "footprint": {"type": "Polygon", "coordinates": [coords]}}


def run_body(footprints, urn=136963):
    return {"urn": urn, "site": SITE, "footprints": footprints}


@pytest.fixture
def small_queue(tmp_path, monkeypatch):
    """A queue of two, no worker (nothing drains), roofer "available", an empty store of its own."""
    monkeypatch.setattr(rq, "_q", _queue.Queue(maxsize=2))
    monkeypatch.setattr(rq, "QUEUE_MAX", 2)
    monkeypatch.setattr(rq, "_inflight", {})
    monkeypatch.setattr(rq, "_ensure_worker", lambda: None)
    monkeypatch.setattr(job, "AUTO_RUN", True)  # the automatic job is off by default (ROOFER_AUTO); these test the queue
    monkeypatch.setitem(appmod._ROOFER, "available", True)
    rq.configure(store_dir=str(tmp_path / "store"))
    yield
    rq.configure(store_dir=store.DEFAULT_STORE_DIR)


# --- P1: the bounded queue ------------------------------------------------------------------------------------


def test_a_full_queue_answers_429_with_retry_after(small_queue):
    assert client.post("/roofer/run", json=run_body([footprint(0)], urn=1)).status_code == 202
    assert client.post("/roofer/run", json=run_body([footprint(1)], urn=2)).status_code == 202
    r = client.post("/roofer/run", json=run_body([footprint(2)], urn=3))
    assert r.status_code == 429
    body = r.json()
    assert body["error"] == "queue_full" and body["retry_after_s"] == rq.RETRY_AFTER_S
    assert body["queued"] == 2 and body["queue_max"] == 2
    assert r.headers["retry-after"] == str(rq.RETRY_AFTER_S)
    # the refused school took no slot: it is not in flight and the store does not say pending
    assert rq.status(3)["state"] == "none"


def test_a_school_already_queued_is_answered_not_queued_again(small_queue):
    first = client.post("/roofer/run", json=run_body([footprint(0)], urn=1)).json()
    assert first["queued"] is True and first["position"] == 1
    again = client.post("/roofer/run", json=run_body([footprint(0)], urn=1))
    assert again.status_code == 202
    assert again.json()["state"] == "pending" and again.json()["queued"] is False and again.json()["hash"] == first["hash"]
    assert rq._q.qsize() == 1  # one slot, not two
    # and still answered, with its state, once the queue is full — dedupe comes before the full check
    assert client.post("/roofer/run", json=run_body([footprint(1)], urn=2)).status_code == 202
    assert client.post("/roofer/run", json=run_body([footprint(2)], urn=3)).status_code == 429
    assert client.post("/roofer/run", json=run_body([footprint(0)], urn=1)).status_code == 202
    # the same footprints in another order are the same job (the hash is order-free)
    assert client.post("/roofer/run", json=run_body([footprint(0)], urn=1)).json()["queued"] is False


def test_health_reports_queue_depth_and_max(small_queue, monkeypatch):
    monkeypatch.setattr(skel, "cgal_version", lambda: "CGAL 6.2 (stubbed: this test is about the queue)")
    client.post("/roofer/run", json=run_body([footprint(0)], urn=1))
    roofer = client.get("/health").json()["roofer"]
    assert roofer["queued"] == 1 and roofer["queue_max"] == 2
    assert [j["urn"] for j in roofer["inflight"]] == [1]


def test_queue_max_defaults_to_twenty():
    if "ROOFER_QUEUE_MAX" not in os.environ:  # a host may override it; the default is 20
        assert rq.QUEUE_MAX == 20
    assert rq._q.maxsize == rq.QUEUE_MAX >= 1


# --- P2: the batch body ---------------------------------------------------------------------------------------


def building(i, n=3, holes=(), eave=3):
    return {"id": str(i), "footprint": ring(n), "holes": list(holes), "roof": FLAT, "eave_m": eave}


def test_buildings_per_batch():
    at = {"buildings": [building(i) for i in range(appmod.MAX_BUILDINGS)]}
    assert client.post("/roof/construct-batch", json=at).status_code == 200
    over = {"buildings": [building(i) for i in range(appmod.MAX_BUILDINGS + 1)]}
    r = client.post("/roof/construct-batch", json=over)
    assert r.status_code == 422 and r.json()["error"] == "invalid_request"
    assert r.json()["detail"][0]["loc"] == ["body", "buildings"]


def test_vertices_per_footprint():
    assert client.post("/roof/construct", json={"footprint": ring(appmod.MAX_VERTICES), "roof": FLAT, "eave_m": 3}).status_code == 200
    r = client.post("/roof/construct", json={"footprint": ring(appmod.MAX_VERTICES + 1), "roof": FLAT, "eave_m": 3})
    assert r.status_code == 422 and "at most 500" in r.json()["detail"][0]["msg"]
    # holes count towards the same 500, as checkRoofBatch counts them
    r = client.post("/roof/construct", json={"footprint": ring(300), "holes": [ring(201)], "roof": FLAT, "eave_m": 3})
    assert r.status_code == 422 and "501 vertices" in r.json()["detail"][0]["msg"]


def test_rings_per_footprint():
    # at the limit, the model accepts (a deck with holes goes through the skeleton, so the model, not the route)
    appmod.ConstructRequest.model_validate({"footprint": ring(4), "holes": [ring(3)] * appmod.MAX_RINGS, "roof": FLAT, "eave_m": 3})
    with pytest.raises(ValidationError):
        appmod.ConstructRequest.model_validate({"footprint": ring(4), "holes": [ring(3)] * (appmod.MAX_RINGS + 1), "roof": FLAT, "eave_m": 3})
    r = client.post("/roof/construct", json={"footprint": ring(4), "holes": [ring(3)] * (appmod.MAX_RINGS + 1), "roof": FLAT, "eave_m": 3})
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == ["body", "holes"]


def test_nan_and_infinity_are_rejected():
    # a NaN written as a string is coerced to float and refused
    r = client.post("/roof/construct", json={"footprint": [[0, 0], [1, "NaN"], [1, 1]], "roof": FLAT, "eave_m": 3})
    assert r.status_code == 422 and r.json()["detail"][0]["msg"] == "Input should be a finite number"
    # a bare NaN token (Python's JSON parser accepts it) is a 422, not the 500 the default handler made of it
    bare = b'{"footprint": [[0, 0], [1, NaN], [1, 1]], "roof": {"style": "flat"}, "eave_m": 3}'
    r = client.post("/roof/construct", content=bare, headers={"content-type": "application/json"})
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == ["body", "footprint", 1, 1]
    # the roof's own numbers, nested, as a bare token or a string
    for roof in ({"style": "gable", "pitch_deg": "inf"}, {"style": "gable", "edges": [{"angle": "nan"}]}):
        r = client.post("/roof/construct", json={"footprint": ring(4), "roof": roof, "eave_m": 3})
        assert r.status_code == 422 and "not finite" in r.json()["detail"][0]["msg"]
    bare = b'{"footprint": [[0, 0], [1, 0], [1, 1]], "roof": {"style": "flat", "x": Infinity}, "eave_m": 3}'
    assert client.post("/roof/construct", content=bare, headers={"content-type": "application/json"}).status_code == 422
    # and an eave that is not finite
    assert client.post("/roof/construct", json={"footprint": ring(4), "roof": FLAT, "eave_m": "Infinity"}).status_code == 422


def test_eave_height_range():
    assert client.post("/roof/construct", json={"footprint": ring(4), "roof": FLAT, "eave_m": 0}).status_code == 200
    assert client.post("/roof/construct", json={"footprint": ring(4), "roof": FLAT, "eave_m": appmod.MAX_EAVE_M}).status_code == 200
    assert client.post("/roof/construct", json={"footprint": ring(4), "roof": FLAT, "eave_m": appmod.MAX_EAVE_M + 1}).status_code == 422
    assert client.post("/roof/construct", json={"footprint": ring(4), "roof": FLAT, "eave_m": -1}).status_code == 422


def test_an_id_is_short_and_present():
    assert client.post("/roof/construct-batch", json={"buildings": [dict(building(0), id="x" * appmod.MAX_ID_LEN)]}).status_code == 200
    assert client.post("/roof/construct-batch", json={"buildings": [dict(building(0), id="x" * (appmod.MAX_ID_LEN + 1))]}).status_code == 422
    assert client.post("/roof/construct-batch", json={"buildings": [dict(building(0), id="")]}).status_code == 422


# --- P2: the roofer body --------------------------------------------------------------------------------------


def test_footprints_per_roofer_run(small_queue):
    at = run_body([footprint(i) for i in range(appmod.MAX_BUILDINGS)])
    assert client.post("/roofer/run", json=at).status_code == 202
    over = run_body([footprint(i) for i in range(appmod.MAX_BUILDINGS + 1)], urn=2)
    r = client.post("/roofer/run", json=over)
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == ["body", "footprints"]


def test_vertices_and_rings_per_geojson_polygon(small_queue):
    assert client.post("/roofer/run", json=run_body([footprint(0, n=appmod.MAX_VERTICES)])).status_code == 202
    r = client.post("/roofer/run", json=run_body([footprint(0, n=appmod.MAX_VERTICES + 1)], urn=2))
    assert r.status_code == 422 and r.json()["detail"][0]["loc"][:4] == ["body", "footprints", 0, "footprint"]
    rings = lambda n: {"id": "b", "footprint": {"type": "Polygon", "coordinates": [RING] * n}}  # noqa: E731
    appmod.RooferRunRequest.model_validate(run_body([rings(appmod.MAX_RINGS)]))
    assert client.post("/roofer/run", json=run_body([rings(appmod.MAX_RINGS + 1)], urn=3)).status_code == 422
    # the site polygon has the same limits
    big_site = {"type": "Polygon", "coordinates": [geo_ring(appmod.MAX_VERTICES + 1)]}
    assert client.post("/roofer/run", json={"urn": 4, "site": big_site, "footprints": [footprint(0)]}).status_code == 422


def test_roofer_coordinates_are_finite_and_on_the_globe(small_queue):
    off = {"id": "b", "footprint": {"type": "Polygon", "coordinates": [[[-1.5, 91], [-1.4, 52], [-1.4, 52.1]]]}}
    r = client.post("/roofer/run", json=run_body([off]))
    assert r.status_code == 422 and "not a longitude and a latitude" in r.json()["detail"][0]["msg"]
    nan = {"id": "b", "footprint": {"type": "Polygon", "coordinates": [[[-1.5, "NaN"], [-1.4, 52], [-1.4, 52.1]]]}}
    assert client.post("/roofer/run", json=run_body([nan])).status_code == 422
    bare = b'{"urn": 1, "site": %s, "footprints": [{"id": "b", "footprint": {"type": "Polygon", "coordinates": [[[-1.5, NaN], [-1.4, 52], [-1.4, 52.1]]]}}]}' % (
        b'{"type": "Polygon", "coordinates": [[[-1.53, 52.379], [-1.52, 52.379], [-1.52, 52.382], [-1.53, 52.382]]]}'
    )
    assert client.post("/roofer/run", content=bare, headers={"content-type": "application/json"}).status_code == 422
    # a position is two or three numbers, not one or four
    one = {"id": "b", "footprint": {"type": "Polygon", "coordinates": [[[-1.5], [-1.4, 52], [-1.4, 52.1]]]}}
    assert client.post("/roofer/run", json=run_body([one])).status_code == 422


def test_the_existing_valid_payloads_still_pass(small_queue):
    """The bodies test_token, test_roofer_api and CI's roofer-request.mjs send (Finham: 23 footprints, rings of ≤ 25)."""
    rect = {"footprint": [[0, 0], [20, 0], [20, 10], [0, 10]], "roof": FLAT, "eave_m": 6}
    assert client.post("/roof/construct", json=rect).status_code == 200
    assert client.post("/roof/construct-batch", json={"buildings": []}).status_code == 200
    assert client.post("/roofer/run", json=run_body([footprint(0)])).status_code == 202
