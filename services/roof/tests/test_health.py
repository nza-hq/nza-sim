# Copied from nza-twin-lab @ 4da46dc (services/roof/tests/test_health.py) on 2026-10-01. Diverged: no.
"""Part 1: the service answers /health with CGAL's version (the bridge builds and runs)."""

from fastapi.testclient import TestClient

from roof.app import app


def test_health_reports_cgal():
    r = TestClient(app).get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["cgal"].startswith("CGAL 6.")
