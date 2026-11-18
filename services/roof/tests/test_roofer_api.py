"""Brief 56 Part 2.4: the roofer endpoints. Without roofer installed, /roofer/run says so (503) and
/roofer/{urn} answers `none`; the token covers /roofer/* as it covers /roof/*; the footprints hash is
stable and order-free; the store round-trips. The job itself runs in CI (roof-image.yml) against the EA
tiles — never here."""

import pytest
from fastapi.testclient import TestClient

from roof import app as appmod
from roofer import job, store
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
    rq.configure(store_dir=str(tmp_path / "store"))
    yield
    rq.configure(store_dir=store.DEFAULT_STORE_DIR)


def test_health_reports_roofer():
    body = client.get("/health").json()
    assert "roofer" in body and set(body["roofer"]) >= {"available", "version", "pinned", "deps", "queued", "store"}
    assert body["roofer"]["pinned"] == "1.0.0"


def test_status_for_an_unknown_school_is_none():
    r = client.get("/roofer/999999")
    assert r.status_code == 200 and r.json()["state"] == "none"
    assert client.get("/roofer/999999/output").status_code == 404


def test_run_without_roofer_is_503(monkeypatch):
    monkeypatch.setitem(appmod._ROOFER, "available", False)
    r = client.post("/roofer/run", json={"urn": 136963, "site": SITE, "footprints": FP})
    assert r.status_code == 503 and r.json()["detail"]["error"] == "roofer_unavailable"


def test_run_validates_the_body():
    assert client.post("/roofer/run", json={"urn": 0, "site": SITE, "footprints": FP}).status_code == 422
    assert client.post("/roofer/run", json={"urn": 1, "site": SITE, "footprints": []}).status_code == 422
    assert client.post("/roofer/run", json={"urn": 1, "site": {"type": "Point", "coordinates": [[[0, 0]]]}, "footprints": FP}).status_code == 422


def test_token_covers_roofer_routes(monkeypatch):
    monkeypatch.setenv("ROOF_SERVICE_TOKEN", "s3cret")
    assert client.get("/roofer/1").status_code == 401
    assert client.post("/roofer/run", json={"urn": 1, "site": SITE, "footprints": FP}).status_code == 401
    assert client.get("/roofer/1", headers={"authorization": "Bearer s3cret"}).status_code == 200
    assert client.get("/health").status_code == 200


def test_footprints_hash_is_stable_and_order_free():
    a = job.footprints_hash(FP)
    b = job.footprints_hash([{"id": "osm:way:1", "footprint": {"type": "Polygon", "coordinates": [[[-1.526, 52.38], [-1.5258, 52.38], [-1.5258, 52.3801], [-1.526, 52.3801], [-1.526, 52.38]]]}}])
    assert a == b and len(a) == 16
    two = FP + [{"id": "osm:way:0", "footprint": FP[0]["footprint"]}]
    assert job.footprints_hash(two) == job.footprints_hash(list(reversed(two)))
    assert job.footprints_hash(two) != a
    # the bytes the TypeScript side hashes (src/twin/roofer/output.ts): ids sorted, lng/lat to six decimals,
    # so a seventh-decimal wobble is the same footprint and a moved vertex is not
    one = [{"id": "x", "footprint": {"type": "Polygon", "coordinates": [[[-1.5, 52.0], [-1.4, 52.0], [-1.4, 52.1], [-1.5, 52.0]]]}}]
    wobble = [{"id": "x", "footprint": {"type": "Polygon", "coordinates": [[[-1.5000001, 52.0], [-1.4, 52.0], [-1.4, 52.1], [-1.5, 52.0]]]}}]
    moved = [{"id": "x", "footprint": {"type": "Polygon", "coordinates": [[[-1.5001, 52.0], [-1.4, 52.0], [-1.4, 52.1], [-1.5, 52.0]]]}}]
    assert job.footprints_hash(one) == job.footprints_hash(wobble) != job.footprints_hash(moved)
    # pinned: src/twin/roofer/output.test.ts asserts this same value for this same footprint
    assert job.footprints_hash(one) == "4f8f1ad980f9ac86"


def test_store_round_trip(tmp_path):
    d = tmp_path / "s"
    assert store.status(5, d)["state"] == "none"
    store.set_status(5, "pending", d, hash="abc")
    assert store.status(5, d)["state"] == "pending" and store.status(5, d)["hash"] == "abc"
    assert not store.has_output(5, "abc", d)
    store.save_output(5, "abc", {"schema": job.SCHEMA, "urn": 5, "rows": []}, d)
    store.set_status(5, "done", d, hash="abc")
    assert store.has_output(5, "abc", d)
    assert store.load_output(5, None, d)["urn"] == 5
    assert store.load_output(5, "abc", d)["schema"] == job.SCHEMA
    assert store.outputs(d) == {"schools": 1, "outputs": 1, "bytes": store.outputs(d)["bytes"]} and store.outputs(d)["bytes"] > 10


def test_submit_answers_done_from_the_store(tmp_path):
    d = tmp_path / "store"
    rq.configure(store_dir=str(d))
    key = job.footprints_hash(FP)
    store.save_output(136963, key, {"schema": job.SCHEMA, "urn": 136963, "rows": []}, d)
    store.set_status(136963, "done", d, hash=key)
    s = rq.submit(136963, SITE, FP, {})
    assert s["state"] == "done" and s["hash"] == key and s["queued"] is False
    st = rq.status(136963)
    assert st["output_available"] is True


# --- Brief 195 P1: no crash loop -----------------------------------------------------------------------------


def test_a_failed_job_is_not_queued_again_for_the_same_footprints(tmp_path):
    d = tmp_path / "store"
    rq.configure(store_dir=str(d))
    key = job.footprints_hash(FP)
    store.set_status(146555, "failed", d, hash=key, error="failed: memory")
    s = rq.submit(146555, SITE, FP, {"reclass": True})
    assert s["state"] == "failed" and s["queued"] is False and s["hash"] == key
    assert rq.summary()["queued"] == 0 and not rq.summary()["inflight"]
    assert store.status(146555, d)["error"] == "failed: memory"  # the reason is kept


def test_a_failed_job_runs_again_on_an_explicit_retry_or_new_footprints(tmp_path, monkeypatch):
    d = tmp_path / "store"
    rq.configure(store_dir=str(d))
    monkeypatch.setattr(rq, "_ensure_worker", lambda: None)  # nothing runs; we only look at what was queued
    key = job.footprints_hash(FP)
    store.set_status(146555, "failed", d, hash=key, error="failed: memory")
    try:
        s = rq.submit(146555, SITE, FP, {"retry": True})
        assert s["state"] == "pending" and s["queued"] is True
        moved = [{"id": "osm:way:1", "footprint": {"type": "Polygon", "coordinates": [[[-1.527, 52.38], [-1.5258, 52.38], [-1.5258, 52.3801], [-1.527, 52.3801], [-1.527, 52.38]]]}}]
        s2 = rq.submit(146556, SITE, moved, {})
        assert s2["state"] == "pending" and s2["queued"] is True
    finally:
        while not rq._q.empty():
            rq._q.get_nowait()
            rq._q.task_done()
        with rq._lock:
            rq._inflight.clear()


def test_a_job_left_running_by_a_restart_reads_as_failed_interrupted(tmp_path, monkeypatch):
    d = tmp_path / "store"
    rq.configure(store_dir=str(d))
    key = job.footprints_hash(FP)
    store.set_status(146555, "running", d, hash=key)  # the disk says running; this process holds no such job
    s = rq.status(146555)
    assert s["state"] == "failed" and s["error"] == rq.INTERRUPTED and s["hash"] == key
    assert store.status(146555, d)["state"] == "failed"  # written back, so the next read agrees
    # 7 Nov 2026: a restart is not the site's fault, so an ordinary ask runs it once more ...
    monkeypatch.setattr(rq, "_ensure_worker", lambda: None)
    try:
        again = rq.submit(146555, SITE, FP, {})
        assert again["state"] == "pending" and again["queued"] is True
    finally:
        _drain()
    # ... and when that run is cut off too, it stays failed: never a loop of restarts
    s = rq.status(146555)
    assert s["state"] == "failed" and s["error"] == rq.INTERRUPTED and s["interrupted_retry_hash"] == key
    third = rq.submit(146555, SITE, FP, {})
    assert third["state"] == "failed" and third["queued"] is False


def test_a_job_that_failed_on_its_own_is_still_not_asked_again(tmp_path):
    d = tmp_path / "store"
    rq.configure(store_dir=str(d))
    store.set_status(146555, "failed", d, hash=job.footprints_hash(FP), error="failed: memory: the job needed more than its 360 MB cap")
    s = rq.submit(146555, SITE, FP, {})
    assert s["state"] == "failed" and s["queued"] is False


def test_a_skip_from_when_the_automatic_job_was_off_no_longer_holds(tmp_path, monkeypatch):
    # Linzie 7 Nov 2026: free measured roofs up to 30 buildings; schools turned away 4 to 7 Nov are measured on their next visit
    d = tmp_path / "store"
    rq.configure(store_dir=str(d))
    monkeypatch.setattr(rq, "_ensure_worker", lambda: None)
    fps = _many(8)
    store.set_status(147310, "skipped", d, hash=job.footprints_hash(fps), error="measured roofs are run on request (Pro); the template roofs stand until then")
    try:
        assert rq.submit(147310, SITE, fps, {})["state"] == "pending"
    finally:
        _drain()


def test_the_default_is_automatic_up_to_thirty_buildings():
    # read in a fresh process, with neither setting in its environment
    import os
    import subprocess
    import sys
    from pathlib import Path

    env = {k: v for k, v in os.environ.items() if k not in ("ROOFER_AUTO", "ROOFER_AUTO_MAX_BUILDINGS")}
    for k in ("ROOFER_BATCH_MAX_BUILDINGS", "ROOFER_AUTO_MAX_TILES"):
        env.pop(k, None)
    code = "from roofer import job; print(job.AUTO_RUN, job.AUTO_MAX_BUILDINGS, job.AUTO_MAX_TILES, job.auto_skip_reason(160, {}), job.auto_skip_reason(161, {}))"
    out = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1], env=env, capture_output=True, text=True, check=True).stdout
    # up to 30 buildings in one job; up to 160 in batches of 30 (Linzie 7 Nov 2026); past that, on request
    assert out.startswith("True 30 2 None 161 buildings, over 160")


# --- Brief 195 P4: the size threshold for the automatic job ---------------------------------------------------


def _many(n):
    out = []
    for i in range(n):
        x = -1.526 + i * 0.0003
        out.append({"id": f"osm:way:{i}", "footprint": {"type": "Polygon", "coordinates": [[[x, 52.38], [x + 0.0002, 52.38], [x + 0.0002, 52.3801], [x, 52.3801], [x, 52.38]]]}})
    return out


def test_over_n_buildings_the_automatic_job_is_skipped_and_says_why(tmp_path, monkeypatch):
    # 7 Nov 2026: past the batch ceiling (batches.py; up to it, a big site is measured in batches of 30)
    from roofer import batches

    rq.configure(store_dir=str(tmp_path / "store"))
    monkeypatch.setattr(batches, "BATCH_MAX_BUILDINGS", 60)
    fps = _many(61)
    s = rq.submit(146555, SITE, fps, {"reclass": True})
    assert s["state"] == "skipped" and s["queued"] is False and "61 buildings, over 60" in s["error"]
    assert rq.summary()["queued"] == 0
    assert rq.status(146555)["state"] == "skipped"
    # asked again by the next build: still skipped, still nothing queued
    assert rq.submit(146555, SITE, fps, {})["state"] == "skipped"


def test_on_request_runs_a_big_site_and_thirty_is_automatic(tmp_path, monkeypatch):
    # Linzie 7 Nov 2026: free measured roofs up to 30 buildings
    rq.configure(store_dir=str(tmp_path / "store"))
    monkeypatch.setattr(rq, "_ensure_worker", lambda: None)
    try:
        assert rq.submit(146555, SITE, _many(31), {"on_request": True})["state"] == "pending"
        assert rq.submit(136963, SITE, _many(30), {})["state"] == "pending"
    finally:
        while not rq._q.empty():
            rq._q.get_nowait()
            rq._q.task_done()
        with rq._lock:
            rq._inflight.clear()


def test_tiles_spanned():
    assert job.tiles_spanned((431000, 275000, 432000, 276000)) == 1  # inside SP3075
    assert job.tiles_spanned((434900, 275000, 435100, 276000)) == 2  # across an east edge
    assert job.tiles_spanned((434900, 279900, 435100, 280100)) == 4  # on a corner


def test_by_default_the_job_waits_to_be_asked(tmp_path, monkeypatch):
    # Linzie 4 Nov 17:36: no automatic job at any size; a Pro request (on_request) runs it
    rq.configure(store_dir=str(tmp_path / "store"))
    monkeypatch.setattr(job, "AUTO_RUN", False)
    monkeypatch.setattr(rq, "_ensure_worker", lambda: None)
    s = rq.submit(147310, SITE, _many(8), {})
    assert s["state"] == "skipped" and s["queued"] is False and "on request" in s["error"]
    assert rq.summary()["queued"] == 0
    try:
        assert rq.submit(147310, SITE, _many(8), {"on_request": True})["state"] == "pending"
    finally:
        while not rq._q.empty():
            rq._q.get_nowait()
            rq._q.task_done()
        with rq._lock:
            rq._inflight.clear()


# --- Brief 198: one building at a time (Pro) ------------------------------------------------------------------


def _drain():
    while not rq._q.empty():
        rq._q.get_nowait()
        rq._q.task_done()
    with rq._lock:
        rq._inflight.clear()
        rq._inflight_building.clear()


def test_a_one_building_job_keeps_its_own_state_and_never_touches_the_sites(tmp_path, monkeypatch):
    d = tmp_path / "store"
    rq.configure(store_dir=str(d))
    monkeypatch.setattr(job, "AUTO_RUN", False)
    monkeypatch.setattr(rq, "_ensure_worker", lambda: None)
    site_fps = _many(5)
    store.set_status(146555, "skipped", d, hash=job.footprints_hash(site_fps), error="on request")
    try:
        s = rq.submit(146555, SITE, site_fps[:1], {"on_request": True, "building": "osm:way:0"})
        assert s["state"] == "pending" and s["queued"] is True and s["building"] == "osm:way:0"
        # the site's own state is as it was; the building's says pending
        assert rq.status(146555)["state"] == "skipped"
        b = rq.status(146555, "osm:way:0")
        assert b["state"] == "pending" and b["hash"] == job.footprints_hash(site_fps[:1])
        # another building is its own job, in its own slot
        s2 = rq.submit(146555, SITE, site_fps[1:2], {"on_request": True, "building": "osm:way:1"})
        assert s2["state"] == "pending" and s2["queued"] is True
        assert rq.status(146555, "osm:way:2")["state"] == "none"
        # the same building asked twice is one job
        again = rq.submit(146555, SITE, site_fps[:1], {"on_request": True, "building": "osm:way:0"})
        assert again["state"] == "pending" and again["queued"] is False
        assert rq.summary()["queued"] == 2
    finally:
        _drain()


def test_a_one_building_job_done_failed_and_retried(tmp_path, monkeypatch):
    d = tmp_path / "store"
    rq.configure(store_dir=str(d))
    monkeypatch.setattr(rq, "_ensure_worker", lambda: None)
    one = _many(3)[2:]
    key = job.footprints_hash(one)
    opts = {"on_request": True, "building": "os/12#1"}
    # a failure for this building is not asked again unless retried, and says why
    store.set_status(146555, "failed", d, "os/12#1", hash=key, error="failed: memory")
    s = rq.submit(146555, SITE, one, opts)
    assert s["state"] == "failed" and s["queued"] is False and s["error"] == "failed: memory"
    assert (d / "146555" / "status.b-os_12_1.json").exists() and not (d / "146555" / "status.json").exists()
    try:
        assert rq.submit(146555, SITE, one, {**opts, "retry": True})["state"] == "pending"
    finally:
        _drain()
    # an output for these footprints answers done at once, under the building
    store.save_output(146555, key, {"schema": job.SCHEMA, "urn": 146555, "rows": []}, d)
    done = rq.submit(146555, SITE, one, opts)
    assert done["state"] == "done" and done["queued"] is False
    st = rq.status(146555, "os/12#1")
    assert st["state"] == "done" and st["output_available"] is True
    assert rq.status(146555)["state"] == "none"  # the site's state: untouched
    # the site's newest-output fallback never hands out a building's status file as an output
    assert store.outputs(d)["outputs"] == 1


def test_status_route_answers_for_one_building(tmp_path):
    d = tmp_path / "store"
    rq.configure(store_dir=str(d))
    store.set_status(146555, "running", d, "osm:way:9", hash="abc")
    with rq._lock:
        rq._inflight[(146555, "abc")] = "running"
    try:
        r = client.get("/roofer/146555", params={"building": "osm:way:9"})
        assert r.status_code == 200 and r.json()["state"] == "running" and r.json()["building"] == "osm:way:9"
        assert client.get("/roofer/146555").json()["state"] == "none"
    finally:
        _drain()


def test_a_drawn_roof_is_kept_once_for_that_job_only(tmp_path):
    d = tmp_path / "store"
    rq.configure(store_dir=str(d))
    store.set_status(146555, "done", d, "osm:way:9", hash="abc")
    answer = {"building": "osm:way:9", "state": "done", "hash": "abc", "quick": {"off_m": 1.2}, "measured": {"off_m": 0.4}}
    q = {"building": "osm:way:9", "hash": "abc"}
    assert client.get("/roofer/146555/drawn", params=q).status_code == 404
    # only a done answer, for the job the service ran
    assert client.put("/roofer/146555/drawn", params={**q, "hash": "zzz"}, json=answer).status_code == 409
    assert client.put("/roofer/146555/drawn", params=q, json={**answer, "state": "failed"}).status_code == 409
    assert client.put("/roofer/146555/drawn", params=q, json=answer).json() == {"kept": True}
    assert client.get("/roofer/146555/drawn", params=q).json() == answer
    # the drawn file never counts as a job's output
    assert store.outputs(d)["outputs"] == 0
    assert store.load_output(146555, None, d) is None
