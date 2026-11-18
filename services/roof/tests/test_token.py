"""decodED's own (26 Oct 2026): a hosted service with ROOF_SERVICE_TOKEN answers /roof/* only to a
caller holding it; /health stays open for the host's health check; unset changes nothing."""

from fastapi.testclient import TestClient

from roof.app import app

client = TestClient(app)
RECT = {"footprint": [[0, 0], [20, 0], [20, 10], [0, 10]], "roof": {"style": "flat"}, "eave_m": 6}


def test_no_token_set_is_open(monkeypatch):
    monkeypatch.delenv("ROOF_SERVICE_TOKEN", raising=False)
    assert client.post("/roof/construct", json=RECT).status_code == 200


def test_token_set_refuses_a_caller_without_it(monkeypatch):
    monkeypatch.setenv("ROOF_SERVICE_TOKEN", "s3cret")
    assert client.post("/roof/construct", json=RECT).status_code == 401
    bad = {"authorization": "Bearer nope"}
    assert client.post("/roof/construct-batch", json={"buildings": []}, headers=bad).status_code == 401


def test_token_set_answers_decoded(monkeypatch):
    monkeypatch.setenv("ROOF_SERVICE_TOKEN", "s3cret")
    ok = {"authorization": "Bearer s3cret"}
    assert client.post("/roof/construct", json=RECT, headers=ok).status_code == 200


def test_health_stays_open(monkeypatch):
    monkeypatch.setenv("ROOF_SERVICE_TOKEN", "s3cret")
    assert client.get("/health").status_code == 200
