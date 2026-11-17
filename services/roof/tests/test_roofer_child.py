"""Brief 195 Part 2: the roofer job runs in its own process under a memory cap. A job planted to go over the cap
(ROOFER_ALLOW_PLANT=1, `options.plant_memory_mb`) must end as `failed: memory` while the web process keeps
answering /health — the container is never taken down by one school's job. roof-image.yml repeats this inside
the real image with a 512 MB container limit (Starter's) and construct-batch answering throughout."""

import time

import pytest
from fastapi.testclient import TestClient

from roof import app as appmod
from roofer import child, job, store
from roofer import queue as rq


@pytest.fixture(autouse=True)
def _automatic_job_on(monkeypatch):
    # these tests are about the automatic job, which is off by default (ROOFER_AUTO): switch it on for them
    monkeypatch.setattr(job, "AUTO_RUN", True)


client = TestClient(appmod.app)
SITE = {"type": "Polygon", "coordinates": [[[-1.53, 52.379], [-1.52, 52.379], [-1.52, 52.382], [-1.53, 52.382], [-1.53, 52.379]]]}
FP = [{"id": "osm:way:1", "footprint": {"type": "Polygon", "coordinates": [[[-1.526, 52.38], [-1.5258, 52.38], [-1.5258, 52.3801], [-1.526, 52.3801], [-1.526, 52.38]]]}}]


@pytest.fixture(autouse=True)
def own_store(tmp_path, monkeypatch):
    rq.configure(store_dir=str(tmp_path / "store"), cache_dir=str(tmp_path / "cache"))
    monkeypatch.setenv("ROOFER_ALLOW_PLANT", "1")
    monkeypatch.setenv("ROOFER_JOB_MEMORY_MB", "200")
    if not _cgal_builds():  # a laptop without the C++ toolchain: /health's CGAL probe is not what this tests
        monkeypatch.setattr(appmod.skel, "cgal_version", lambda: "CGAL (stubbed)")
    yield
    rq.configure(store_dir=store.DEFAULT_STORE_DIR)


def _cgal_builds() -> bool:
    try:
        appmod.skel.cgal_version()
        return True
    except Exception:  # noqa: BLE001
        return False


def _wait(urn, key, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = store.status(urn, rq._store_dir)
        if s.get("hash") == key and s.get("state") in ("done", "failed"):
            return s
        time.sleep(0.2)
    raise AssertionError(f"job {urn} did not finish: {store.status(urn, rq._store_dir)}")


def test_an_over_limit_job_fails_as_memory_and_the_web_process_stays_up():
    key = job.footprints_hash(FP)
    r = rq.submit(990001, SITE, FP, {"plant_memory_mb": 400})
    assert r["state"] == "pending"
    # the web process answers while the job runs and after it dies
    assert client.get("/health").status_code == 200
    s = _wait(990001, key)
    assert s["state"] == "failed"
    assert s["error"].startswith(child.MEMORY), s["error"]
    assert client.get("/health").status_code == 200
    assert client.get("/roofer/990001").json()["state"] == "failed"
    # and it is not run again by an ordinary ask (Part 1)
    again = rq.submit(990001, SITE, FP, {"plant_memory_mb": 400})
    assert again["state"] == "failed" and again["queued"] is False


def test_the_cap_is_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("ROOFER_JOB_MEMORY_MB", "300")
    assert child.memory_mb() == 300
    monkeypatch.setenv("ROOFER_JOB_MEMORY_MB", "nonsense")
    assert child.memory_mb() == child.DEFAULT_MEMORY_MB
    monkeypatch.setenv("ROOFER_JOB_MEMORY_MB", "1")
    assert child.memory_mb() == 64


def test_planting_is_off_unless_allowed(monkeypatch, tmp_path):
    monkeypatch.delenv("ROOFER_ALLOW_PLANT", raising=False)
    child._plant({"plant_memory_mb": 10_000})  # would raise MemoryError if it allocated


def test_a_job_that_fails_for_another_reason_says_so(monkeypatch):
    # the child reports the job's own error, not memory. roofer is hidden (as on a laptop) so the job fails at once,
    # before any EA download, the same on a laptop and in the image; the cap is clear of the libraries' own size.
    monkeypatch.setenv("ROOFER_JOB_MEMORY_MB", "1500")
    monkeypatch.setenv("ROOFER_BIN", "")
    monkeypatch.setenv("PATH", "/nonexistent")
    key = job.footprints_hash(FP)
    rq.submit(990002, SITE, FP, {})
    s = _wait(990002, key)
    assert s["state"] == "failed" and not s["error"].startswith(child.MEMORY)
    assert "roofer is not installed" in s["error"], s["error"]
