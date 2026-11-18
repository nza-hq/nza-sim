"""Linzie 7 Nov 2026: big sites measured in batches of 30, one at a time, with other schools in between; the roofs
measured so far are joined under the site's own hash after each batch. The job itself is stubbed (it runs in CI)."""

import pytest

from roofer import batches, job, store
from roofer import queue as rq

SITE = {"type": "Polygon", "coordinates": [[[-1.53, 52.379], [-1.50, 52.379], [-1.50, 52.40], [-1.53, 52.40], [-1.53, 52.379]]]}


def _many(n, x0=-1.526):
    out = []
    for i in range(n):
        x = x0 + (i % 10) * 0.0003
        y = 52.38 + (i // 10) * 0.0003
        out.append({"id": f"osm:way:{i}", "footprint": {"type": "Polygon", "coordinates": [[[x, y], [x + 0.0002, y], [x + 0.0002, y + 0.0001], [x, y + 0.0001], [x, y]]]}})
    return out


def _fake_output(urn, key, fps):
    terrain = {"x0": 0.0, "y0": 0.0, "dx": 1.0, "w": 2, "h": 2, "z": [0.0, 0.0, 0.0, 0.0]}
    return {
        "schema": "x", "urn": urn, "footprints_hash": key, "crs": "EPSG:27700", "frame": {}, "ground_z": 10.0, "terrain": terrain,
        "survey": {"label": "nlp 2021", "tiles": [{"tile": "SP3075"}]}, "roofer": {"version": "1"},
        "footprints": {"given": len(fps), "run": len(fps), "under_10m2": []}, "nodata": {"value": -1, "buildings": []},
        "rows": [{"id": f["id"]} for f in fps], "outlines": [{"id": f["id"], "ring": []} for f in fps],
        "lod22": [{"id": f["id"], "triangles": 1, "roofTriangles": 1} for f in fps],
        "roof_tris": [[0] * 9 for _ in fps], "roof_tri_ids": [f["id"] for f in fps],
        "bytes_downloaded": 0, "timings": {"total_ms": 1000},
    }


@pytest.fixture(autouse=True)
def _setup(tmp_path, monkeypatch):
    monkeypatch.setattr(job, "AUTO_RUN", True)
    rq.configure(store_dir=str(tmp_path / "store"))
    monkeypatch.setattr(rq, "_ensure_worker", lambda: None)

    def child(item, log):
        store.save_output(item["urn"], item["hash"], _fake_output(item["urn"], item["hash"], item["footprints"]), rq._store_dir)
        return {"state": "done", "memory": {"peak_mb": 150.0}, "timings": {"total_ms": 1000}}

    monkeypatch.setattr(rq, "_run_child", child)
    yield
    while not rq._q.empty():
        rq._q.get_nowait()
        rq._q.task_done()
    rq._later.clear()
    with rq._lock:
        rq._inflight.clear()
        rq._inflight_building.clear()
    rq.configure(store_dir=store.DEFAULT_STORE_DIR)


def _step(last_was_later=False):
    item, from_q = rq._pick(last_was_later, block=False)
    assert item is not None
    rq._run_one(item)
    if from_q:
        rq._q.task_done()
    return item, from_q


def test_plan_keeps_every_footprint_once_in_batches_of_thirty():
    fps = _many(70)
    parts = batches.plan(fps)
    assert [len(p) for p in parts] == [30, 30, 10]
    assert sorted(f["id"] for p in parts for f in p) == sorted(f["id"] for f in fps)


def test_a_big_site_is_measured_batch_by_batch_and_the_roofs_so_far_are_drawable():
    fps = _many(70)
    key = job.footprints_hash(fps)
    s = rq.submit(146555, SITE, fps, {"reclass": True})
    assert s["state"] == "pending" and s["queued"] is True and s["batches"]["of"] == 3
    assert rq._q.qsize() == 1  # only the first batch is on the queue

    _step()
    st = rq.status(146555)
    assert st["state"] == "running" and st["hash"] == key and st["batches"]["done"] == 1
    assert st["output_available"] is True  # the first 30 roofs, under the site's own hash
    out = store.load_output(146555, key, rq._store_dir)
    assert out["footprints_hash"] == key and len(out["rows"]) == 30
    # asked again meanwhile: in flight, never a second run, and never "done" on a partial output
    again = rq.submit(146555, SITE, fps, {})
    assert again["queued"] is False and again["state"] == "running"

    _step(last_was_later=False)
    _step(last_was_later=True)
    st = rq.status(146555)
    assert st["state"] == "done" and st["batches"]["done"] == 3 and st["batches"]["failed"] == 0
    out = store.load_output(146555, key, rq._store_dir)
    assert len(out["rows"]) == 70 and len(out["roof_tri_ids"]) == 70 and out["footprints"]["run"] == 70
    assert out["batches"]["joined"] == 3
    # the batches' own files are not kept
    assert sorted(p.name for p in store._dir(146555, rq._store_dir).glob("*.json") if not p.name.startswith("status")) == [f"{key}.json"]


def test_a_small_school_asked_meanwhile_goes_between_two_batches():
    rq.submit(146555, SITE, _many(70), {})
    _, from_q = _step()  # batch 1 of the big site
    assert from_q is True and len(rq._later) == 1
    rq.submit(106703, SITE, _many(5, x0=-1.52), {})
    item, from_q = rq._pick(last_was_later=False, block=False)
    # after a queued job, the big site's next batch goes ...
    assert from_q is False and item["urn"] == 146555
    rq._run_one(item)
    # ... and after a batch, the small school goes before the batch after it
    item, from_q = rq._pick(last_was_later=True, block=False)
    assert from_q is True and item["urn"] == 106703
    rq._q.task_done()


def test_a_failed_batch_does_not_stop_the_others(monkeypatch):
    calls = {"n": 0}

    def child(item, log):
        calls["n"] += 1
        if calls["n"] == 2:
            return {"state": "failed", "error": "failed: memory: over its cap"}
        store.save_output(item["urn"], item["hash"], _fake_output(item["urn"], item["hash"], item["footprints"]), rq._store_dir)
        return {"state": "done", "memory": {"peak_mb": 150.0}}

    monkeypatch.setattr(rq, "_run_child", child)
    fps = _many(70)
    rq.submit(146555, SITE, fps, {})
    _step(); _step(); _step(last_was_later=True)
    st = rq.status(146555)
    assert st["state"] == "done" and st["batches"]["done"] == 2 and st["batches"]["failed"] == 1
    assert len(store.load_output(146555, job.footprints_hash(fps), rq._store_dir)["rows"]) == 40


def test_a_restart_between_batches_reads_as_interrupted_and_is_run_again_once():
    fps = _many(70)
    rq.submit(146555, SITE, fps, {})
    _step()
    rq._later.clear()  # the restart: nothing in this process any more
    with rq._lock:
        rq._inflight.clear()
    st = rq.status(146555)
    assert st["state"] == "failed" and st["error"] == rq.INTERRUPTED
    again = rq.submit(146555, SITE, fps, {})
    assert again["state"] == "pending" and again["queued"] is True and again["batches"]["of"] == 3


def test_past_the_batch_ceiling_measured_roofs_stay_a_request():
    s = rq.submit(110158, SITE, _many(batches.BATCH_MAX_BUILDINGS + 1), {})
    assert s["state"] == "skipped" and "on request" in s["error"]


def test_a_skip_from_the_building_limit_of_this_morning_is_asked_again():
    fps = _many(45)
    store.set_status(146555, "skipped", rq._store_dir, hash=job.footprints_hash(fps), error="45 buildings, over 30: measured roofs are on request for a site this big")
    assert rq.submit(146555, SITE, fps, {})["state"] == "pending"


def test_a_skip_for_two_tiles_is_asked_again_but_three_stands():
    fps = _many(10)
    key = job.footprints_hash(fps)
    store.set_status(146555, "skipped", rq._store_dir, hash=key, error="the site spans 2 EA tiles, over 1: measured roofs are on request for a site this big")
    assert rq.submit(146555, SITE, fps, {})["state"] == "pending"
    with rq._lock:
        rq._inflight.clear()
    store.set_status(146556, "skipped", rq._store_dir, hash=key, error="the site spans 3 EA tiles, over 2: measured roofs are on request for a site this big")
    assert rq.submit(146556, SITE, fps, {})["state"] == "skipped"
