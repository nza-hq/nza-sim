"""One job at a time per container, a queue, a status per URN (Brief 56 Part 2.4).

Brief 198 (Linzie, 4 Nov 2026 22:51): a Pro user measures ONE building at a time (`options.building`, with
`options.on_request`). Its footprints hash is that building's, so its output never overwrites the site's or another
building's; its state is kept in its own status file (store.py), so a build reading the site's state never sees it.

`submit()` returns at once with the state. The same school with the same footprints is never queued twice:
done answers from the store, pending/running answer with that state. Brief 195 P1 (4 Nov 2026): a failed job is
NOT queued again for the same footprints unless the request says `options.retry` — it used to be, and Hartpury
College's out-of-memory job restarted the service on every build. The worker is one daemon thread; the container's
host restarts it with the container, and a job in flight then is recorded as failed (`INTERRUPTED`), not left running.

Brief 173: the queue is bounded (`ROOFER_QUEUE_MAX`, default 20). A job takes minutes when its EA tile is not
cached, so twenty waiting is an hour or more of work already promised; past that `submit()` raises `QueueFull`
and the route answers 429 with a Retry-After, and the caller (decodED's build) asks again later. A job already
pending or running for the same (URN, footprints hash) is answered with that state first — it is never queued
or counted twice — and the put never blocks (`put_nowait`), so a full queue costs the event loop nothing.
"""

from __future__ import annotations

import json
import os
import queue as _queue
import signal
import subprocess
import sys
import tempfile
import threading
import traceback
from collections import deque
from pathlib import Path

from . import batches as _batches
from . import child as _child
from . import job as _job
from . import store

#: Brief 195 P2: the directory `python -m roofer.child` runs from (services/roof, the image's /srv/roof)
_SERVICE_DIR = str(Path(__file__).resolve().parent.parent)

QUEUE_MAX = max(1, int(os.environ.get("ROOFER_QUEUE_MAX", "20")))
# What a 429 tells the caller to wait: roofer's own run is seconds, so a slot usually frees within a minute
# unless every queued school is on an uncached tile. ROOFER_QUEUE_RETRY_AFTER_S overrides it.
RETRY_AFTER_S = max(1, int(os.environ.get("ROOFER_QUEUE_RETRY_AFTER_S", "60")))

_q: "_queue.Queue[dict]" = _queue.Queue(maxsize=QUEUE_MAX)
_lock = threading.Lock()
_inflight: dict[tuple[int, str], str] = {}  # (urn, hash) → pending | running
_inflight_building: dict[tuple[int, str], str | None] = {}  # (urn, hash) → the one building it measures, if any
_worker: threading.Thread | None = None
#: Linzie 7 Nov 2026: a big site's next batch waits here, not on _q, so a school asked meanwhile goes first
_later: deque = deque()
_recent: deque = deque(maxlen=20)
_log_lines: dict[int, deque] = {}
_store_dir = store.DEFAULT_STORE_DIR
_cache_dir = None


class QueueFull(Exception):
    """Brief 173: the queue holds QUEUE_MAX jobs and this one is not among them. `retry_after_s` is the wait to suggest."""

    def __init__(self, queued: int, retry_after_s: int = RETRY_AFTER_S):
        super().__init__(f"roofer queue full ({queued}/{QUEUE_MAX})")
        self.queued = queued
        self.retry_after_s = retry_after_s


def configure(store_dir: str | None = None, cache_dir: str | None = None) -> None:
    global _store_dir, _cache_dir
    if store_dir:
        _store_dir = store_dir
    if cache_dir:
        _cache_dir = cache_dir


def _logger(urn: int):
    lines = _log_lines.setdefault(urn, deque(maxlen=60))

    def log(msg: str) -> None:
        lines.append(msg)
        print(msg, flush=True)

    return log


def _run_child(item: dict, log) -> dict:
    """Brief 195 P2: run the job in its own process (roofer/child.py) under a memory cap, streaming its log.
    Returns the child's small result: {"state": "done", ...} or {"state": "failed", "error": ...}."""
    urn, key = item["urn"], item["hash"]
    with tempfile.TemporaryDirectory(prefix=f"roofer-{urn}-") as tmp:
        req_path, res_path = os.path.join(tmp, "request.json"), os.path.join(tmp, "result.json")
        with open(req_path, "w", encoding="utf-8") as fh:
            json.dump({"urn": urn, "hash": key, "site": item["site"], "footprints": item["footprints"], "options": item.get("options"), "store_dir": str(_store_dir), "cache_dir": str(_cache_dir) if _cache_dir else None}, fh)
        proc = subprocess.Popen(
            [sys.executable, "-m", "roofer.child", req_path, res_path],
            cwd=_SERVICE_DIR,
            env=_child.child_env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            start_new_session=True,  # its own process group: the watchdog kills the job and roofer under it together
        )
        watch = _Watchdog(proc.pid, _child.memory_mb())
        watch.start()
        assert proc.stdout is not None
        for line in proc.stdout:
            log(line.rstrip("\n")[:500])
        code = proc.wait()
        watch.stop()
        body = None
        if os.path.exists(res_path):
            try:
                with open(res_path, encoding="utf-8") as fh:
                    body = json.load(fh)
            except (OSError, json.JSONDecodeError):
                body = None
    peak = {"peak_mb": round(watch.peak_mb, 1), "cap_mb": _child.memory_mb()}
    if watch.tripped:
        return {"state": "failed", "error": f"{_child.MEMORY}: the job passed its {_child.memory_mb()} MB cap ({watch.tripped_mb:.0f} MB resident) and was stopped", "memory": peak}
    if code < 0:  # killed by a signal: the kernel's out-of-memory kill is SIGKILL
        sig = -code
        why = f"{_child.MEMORY}: killed by signal {sig} (the container ran out of memory)" if sig == signal.SIGKILL else f"killed by signal {sig}"
        return {"state": "failed", "error": why, "memory": peak}
    if body is None:
        return {"state": "failed", "error": f"the job process exited {code} without a result" + (f" ({_child.MEMORY})" if code == _child.EXIT_MEMORY else ""), "memory": peak}
    body["memory"] = {**(body.get("memory") or {}), **peak}
    return body


def _rss_kb(pid: int) -> int:
    try:
        with open(f"/proc/{pid}/status", encoding="ascii", errors="replace") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1])
    except (OSError, ValueError):
        pass
    return 0


def _group_rss_mb(pgid: int) -> float:
    """Resident memory of every process in the job's group (the job, and roofer under it), in MB."""
    total = 0
    try:
        pids = [int(p) for p in os.listdir("/proc") if p.isdigit()]
    except OSError:
        return 0.0
    for pid in pids:
        try:
            with open(f"/proc/{pid}/stat", encoding="ascii", errors="replace") as fh:
                fields = fh.read().rsplit(")", 1)[1].split()
            if int(fields[2]) == pgid:  # field 5 of /proc/pid/stat, after the name: the process group
                total += _rss_kb(pid)
        except (OSError, ValueError, IndexError):
            continue
    return total / 1024


class _Watchdog(threading.Thread):
    """Brief 195 P2: every WATCH_S, the job group's resident memory; past the cap, SIGKILL to the whole group."""

    WATCH_S = 0.1

    def __init__(self, pgid: int, cap_mb: int):
        super().__init__(name="roofer-watchdog", daemon=True)
        self.pgid, self.cap_mb = pgid, cap_mb
        self.peak_mb = 0.0
        self.tripped = False
        self.tripped_mb = 0.0
        self._halt = threading.Event()

    def run(self) -> None:
        while not self._halt.is_set():
            mb = _group_rss_mb(self.pgid)
            self.peak_mb = max(self.peak_mb, mb)
            if mb > self.cap_mb and not self.tripped:
                self.tripped, self.tripped_mb = True, mb
                try:
                    os.killpg(self.pgid, signal.SIGKILL)
                except OSError:
                    pass
            self._halt.wait(self.WATCH_S)

    def stop(self) -> None:
        self._halt.set()
        self.join(timeout=1)


def building_of(options: dict | None) -> str | None:
    """Brief 198: the one building a Pro request measures (`options.building`), or None for a site job."""
    b = (options or {}).get("building")
    return str(b)[:200] if b else None


def _batch_of(item: dict) -> dict | None:
    """Linzie 7 Nov 2026: a big site's batch: {"site_hash", "i", "of"}, or None for an ordinary job."""
    b = (item.get("options") or {}).get("batch")
    return b if isinstance(b, dict) and b.get("site_hash") else None


def _run_batch(item: dict, b: dict) -> None:
    """One batch of a big site: run it as its own job, join its output onto the site's (saved under the site's hash, so
    the roofs measured so far can be drawn), then queue the next batch behind whatever was asked meanwhile."""
    urn, site_key = item["urn"], b["site_hash"]
    i, of = int(b["i"]), int(b["of"])
    prog = dict(store.status(urn, _store_dir).get("batches") or {})
    prog = {"done": int(prog.get("done", 0)), "of": of, "failed": int(prog.get("failed", 0)), "size": len(item["footprints"])} if i else {"done": 0, "of": of, "failed": 0, "size": len(item["footprints"])}
    with _lock:
        _inflight[(urn, site_key)] = "running"
    store.set_status(urn, "running", _store_dir, hash=site_key, error=None, batches=prog, **({"started_at": store.now()} if i == 0 else {}))
    log = _logger(urn)
    log(f"[roofer] URN {urn}: batch {i + 1} of {of} ({len(item['footprints'])} buildings)")
    stop_all = None
    try:
        res = _run_child(item, log)
        part = store.load_output(urn, item["hash"], _store_dir) if res.get("state") == "done" and store.has_output(urn, item["hash"], _store_dir) else None
        if part:
            have = store.load_output(urn, site_key, _store_dir) if prog["done"] else None
            prior = [have] if have and have.get("footprints_hash") == site_key else []
            joined = _batches.join(site_key, prior + [part])
            if prior:  # the batches joined so far, not the two parts of this join
                hb = have.get("batches") or {}
                joined["batches"] = {"joined": int(hb.get("joined", 1)) + 1, "hashes": list(hb.get("hashes") or [])[:200] + [part.get("footprints_hash")]}
            store.save_output(urn, site_key, joined, _store_dir)
            prog["done"] += 1
            peak = max(float((res.get("memory") or {}).get("peak_mb") or 0), float(prog.get("peak_mb") or 0))
            prog["peak_mb"] = round(peak, 1)
        elif res.get("state") == "skipped":
            stop_all = str(res.get("error"))[:500]  # the site's own size rule (its EA tiles): every batch would say the same
        else:
            prog["failed"] += 1
            prog["last_error"] = str(res.get("error") or "the batch ended without an output")[:300]
            log(f"[roofer] URN {urn}: batch {i + 1} of {of} failed: {prog['last_error']}")
    except Exception as err:  # noqa: BLE001 — a failed batch never kills the worker, and the site carries on
        traceback.print_exc()
        prog["failed"] += 1
        prog["last_error"] = f"{type(err).__name__}: {err}"[:300]
    finally:
        try:
            p = store._dir(urn, _store_dir) / f"{item['hash']}.json"
            if item["hash"] != site_key and p.exists():
                p.unlink()  # the batch's own file: joined into the site's, so not kept
        except OSError:
            pass
    rest = item.get("rest") or []
    if stop_all is not None:
        store.set_status(urn, "skipped", _store_dir, hash=site_key, finished_at=store.now(), error=stop_all, batches=prog)
        _recent.append({"urn": urn, "hash": site_key, "state": "skipped", "error": stop_all[:200]})
        rest = []
    elif rest:
        store.set_status(urn, "running", _store_dir, hash=site_key, error=None, batches=prog)
        nxt = rest[0]
        _later.append({"urn": urn, "hash": _job.footprints_hash(nxt), "site": item["site"], "footprints": nxt, "options": {**(item.get("options") or {}), "batch": {"site_hash": site_key, "i": i + 1, "of": of}}, "rest": rest[1:]})
        return  # still in flight: the site's slot is kept until its last batch
    elif prog["done"]:
        store.set_status(urn, "done", _store_dir, hash=site_key, finished_at=store.now(), error=None, batches=prog, buildings=None, memory={"peak_mb": prog.get("peak_mb")})
        _recent.append({"urn": urn, "hash": site_key, "state": "done", "batches": of})
    else:
        store.set_status(urn, "failed", _store_dir, hash=site_key, finished_at=store.now(), error=f"every batch failed: {prog.get('last_error', '')}"[:1500], batches=prog)
        _recent.append({"urn": urn, "hash": site_key, "state": "failed", "error": "every batch failed"})
    with _lock:
        _inflight.pop((urn, site_key), None)
        _inflight_building.pop((urn, site_key), None)


def _run_one(item: dict) -> None:
    b = _batch_of(item)
    if b:
        return _run_batch(item, b)
    urn, key = item["urn"], item["hash"]
    building = building_of(item.get("options"))
    with _lock:
        _inflight[(urn, key)] = "running"
    store.set_status(urn, "running", _store_dir, building, hash=key, started_at=store.now(), error=None)
    log = _logger(urn)
    try:
        res = _run_child(item, log)
        if res.get("state") == "done" and store.has_output(urn, key, _store_dir):
            fields = {k: res.get(k) for k in ("survey", "buildings", "roof_triangles", "timings", "bytes_downloaded", "memory")}
            store.set_status(urn, "done", _store_dir, building, hash=key, finished_at=store.now(), error=None, **fields)
            _recent.append({"urn": urn, "hash": key, "state": "done", "ms": (res.get("timings") or {}).get("total_ms"), "memory": res.get("memory")})
        elif res.get("state") == "skipped":
            msg = str(res.get("error"))[:500]
            log(f"[roofer] URN {urn} skipped: {msg}")
            store.set_status(urn, "skipped", _store_dir, building, hash=key, finished_at=store.now(), error=msg)
            _recent.append({"urn": urn, "hash": key, "state": "skipped", "error": msg[:200]})
        else:
            msg = str(res.get("error") or "the job ended without an output")[:1500]
            log(f"[roofer] URN {urn} failed: {msg}")
            store.set_status(urn, "failed", _store_dir, building, hash=key, finished_at=store.now(), error=msg, **({"memory": res["memory"]} if res.get("memory") else {}))
            _recent.append({"urn": urn, "hash": key, "state": "failed", "error": msg[:200]})
    except Exception as err:  # noqa: BLE001 — every failure is recorded, none kills the worker
        msg = f"{type(err).__name__}: {err}"[:1500]
        log(f"[roofer] URN {urn} failed: {msg}")
        traceback.print_exc()
        store.set_status(urn, "failed", _store_dir, building, hash=key, finished_at=store.now(), error=msg)
        _recent.append({"urn": urn, "hash": key, "state": "failed", "error": msg[:200]})
    finally:
        with _lock:
            _inflight.pop((urn, key), None)
            _inflight_building.pop((urn, key), None)


def _pick(last_was_later: bool, block: bool = True):
    """The next job and whether it came off _q. Linzie 7 Nov 2026: a big site's next batch (_later) and a newly asked
    school (_q) take turns, so a big site never holds the schools behind it for more than one batch."""
    if _later and (not last_was_later or _q.empty()):
        return _later.popleft(), False
    try:
        return (_q.get(timeout=1.0 if _later else None) if block else _q.get_nowait()), True
    except _queue.Empty:
        return None, False


def _loop() -> None:
    last_was_later = False
    while True:
        item, from_q = _pick(last_was_later)
        if item is None:
            last_was_later = False
            continue
        try:
            _run_one(item)
        finally:
            if from_q:
                _q.task_done()
            last_was_later = not from_q


def _ensure_worker() -> None:
    global _worker
    if _worker is None or not _worker.is_alive():
        _worker = threading.Thread(target=_loop, name="roofer-worker", daemon=True)
        _worker.start()


def still_skipped(last: dict) -> bool:
    """A recorded skip that still stands: only the job's own EA-tile finding, while the site is still over today's tile
    limit. Not the "run on request" one (the automatic job was off 4 to 7 Nov 2026), nor a building-count one (checked
    again just before this, with today's limits)."""
    import re

    err = str(last.get("error") or "")
    if err.startswith("measured roofs are run on request"):
        return False
    m = re.search(r"spans (\d+) EA tiles", err)
    if m:  # 7 Nov 2026: the tile limit went from one to two; a skip under the old one is asked again
        return int(m.group(1)) > _job.AUTO_MAX_TILES
    # a skip for the building count was checked again just before this (auto_skip_reason), with today's limits
    return False


def may_retry_interrupted(last: dict, key: str) -> bool:
    """A failure from a restart, for these footprints, not yet run again by an ordinary ask."""
    return str(last.get("error") or "").startswith("interrupted:") and last.get("interrupted_retry_hash") != key


def submit(urn: int, site: dict, footprints: list[dict], options: dict | None = None) -> dict:
    """Queue a job unless its output exists or it is already in flight. Returns the status to answer with.
    Raises QueueFull (Brief 173) when the queue holds QUEUE_MAX jobs and this is not one of them.
    Brief 198: with `options.building`, the job measures that one building and its state is kept under it."""
    key = _job.footprints_hash(footprints)
    urn = int(urn)
    building = building_of(options)
    tag = {"building": building} if building else {}
    if store.has_output(urn, key, _store_dir) and not _partial(urn, key):
        if building:  # the building's own record says done too, so its next status read answers at once
            s = store.status(urn, _store_dir, building)
            if s.get("state") != "done" or s.get("hash") != key:
                s = store.set_status(urn, "done", _store_dir, building, hash=key, finished_at=store.now(), error=None)
            return {**s, "urn": urn, "state": "done", "hash": key, "queued": False}
        return {**store.status(urn, _store_dir), "urn": urn, "state": "done", "hash": key, "queued": False}
    # Brief 195 P4: too many buildings for the automatic job — answered at once, nothing is queued or spawned. A site past
    # one EA tile is found by the job itself, right after the frame step and before any download. `options.on_request`
    # (measured roofs asked for on purpose; Brief 198's Pro feature, one building at a time) runs either.
    skip = _job.auto_skip_reason(len(footprints), options)
    if skip:
        s = store.set_status(urn, "skipped", _store_dir, building, hash=key, finished_at=store.now(), error=skip)
        return {**s, "queued": False}
    if not (options or {}).get("on_request"):
        last = store.status(urn, _store_dir, building)
        if last.get("state") == "skipped" and last.get("hash") == key and still_skipped(last):
            return {**last, "urn": urn, "queued": False}
    # Brief 195 P1: a job that FAILED for these same footprints is not run again by an ordinary ask (a build asks
    # whenever it has nothing to draw; Hartpury College's job ran the container out of memory, so every build
    # restarted the service). Only a new footprints hash, or `options.retry` (an explicit request), runs it again.
    retry_interrupted = False
    if not (options or {}).get("retry"):
        last = status(urn, building)
        if last.get("state") == "failed" and last.get("hash") == key:
            # 7 Nov 2026: a job cut off by a restart (a deploy, or the 4 Nov out-of-memory restarts from before each job
            # had its own capped process) is not the site's fault: an ordinary ask runs it ONCE more, never twice
            retry_interrupted = may_retry_interrupted(last, key)
            if not retry_interrupted:
                return {**last, "urn": urn, "state": "failed", "hash": key, "queued": False, "retry": "send options.retry to run this job again"}
    if not building and not (options or {}).get("on_request") and len(footprints) > _job.AUTO_MAX_BUILDINGS:
        return _submit_batches(urn, key, site, footprints, options, retry_interrupted)
    with _lock:
        state = _inflight.get((urn, key))
        if state:  # the same school with the same footprints: answer with its state, never a second slot
            return {**store.status(urn, _store_dir, building), "urn": urn, "state": state, "hash": key, "queued": False}
        if _q.full():
            raise QueueFull(_q.qsize())
        _inflight[(urn, key)] = "pending"
        _inflight_building[(urn, key)] = building
        position = _q.qsize() + 1
    store.set_status(urn, "pending", _store_dir, building, hash=key, queued_at=store.now(), error=None, **({"interrupted_retry_hash": key} if retry_interrupted else {}))
    try:
        _q.put_nowait({"urn": urn, "hash": key, "site": site, "footprints": footprints, "options": options})
    except _queue.Full:  # filled between the check and the put: give the slot back, say so
        with _lock:
            _inflight.pop((urn, key), None)
            _inflight_building.pop((urn, key), None)
        store.set_status(urn, "failed", _store_dir, building, hash=key, finished_at=store.now(), error="queue_full")
        raise QueueFull(_q.qsize()) from None
    _ensure_worker()
    return {"urn": urn, "state": "pending", "hash": key, "queued": True, "position": position, **tag}


def _partial(urn: int, key: str) -> bool:
    """The site's output under `key` holds only some of its batches (the rest still to come, or cut off by a restart)."""
    st = store.status(urn, _store_dir)
    b = st.get("batches") or {}
    return st.get("hash") == key and bool(b) and st.get("state") != "done"


def _submit_batches(urn: int, key: str, site: dict, footprints: list[dict], options: dict | None, retry_interrupted: bool) -> dict:
    """Linzie 7 Nov 2026: a site past AUTO_MAX_BUILDINGS, measured in batches of BATCH_SIZE (batches.py). Its first batch
    goes on the queue like any school; each next one is queued when the last finishes (_run_batch), behind what was
    asked meanwhile. The site's own hash is in flight until its last batch."""
    parts = _batches.plan(footprints)
    with _lock:
        state = _inflight.get((urn, key))
        if state:
            return {**store.status(urn, _store_dir), "urn": urn, "state": state, "hash": key, "queued": False}
        if _q.full():
            raise QueueFull(_q.qsize())
        _inflight[(urn, key)] = "pending"
        _inflight_building[(urn, key)] = None
        position = _q.qsize() + 1
    prog = {"done": 0, "of": len(parts), "failed": 0, "size": _batches.BATCH_SIZE}
    store.set_status(urn, "pending", _store_dir, hash=key, queued_at=store.now(), error=None, batches=prog, **({"interrupted_retry_hash": key} if retry_interrupted else {}))
    first = {"urn": urn, "hash": _job.footprints_hash(parts[0]), "site": site, "footprints": parts[0], "options": {**(options or {}), "batch": {"site_hash": key, "i": 0, "of": len(parts)}}, "rest": parts[1:]}
    try:
        _q.put_nowait(first)
    except _queue.Full:
        with _lock:
            _inflight.pop((urn, key), None)
            _inflight_building.pop((urn, key), None)
        store.set_status(urn, "failed", _store_dir, hash=key, finished_at=store.now(), error="queue_full")
        raise QueueFull(_q.qsize()) from None
    _ensure_worker()
    return {"urn": urn, "state": "pending", "hash": key, "queued": True, "position": position, "batches": prog}


#: Brief 195 P1: what a job left pending or running by a restart is recorded as. A job in flight lives in this
#: process; when the process dies (the host's out-of-memory kill is the usual reason) the disk still says running,
#: and nothing would ever finish it. It is failed instead, with this reason, and not asked again for these footprints.
INTERRUPTED = "interrupted: the service restarted while this job was in flight (most likely out of memory)"


def status(urn: int, building: str | None = None) -> dict:
    """The site's job (no `building`), or Brief 198's one-building job for `building`."""
    s = store.status(urn, _store_dir, building)
    with _lock:
        live = {k[1]: v for k, v in _inflight.items() if k[0] == int(urn)}
    if live and s.get("hash") in live:
        s["state"] = live[s["hash"]]
    elif s.get("state") in ("pending", "running"):
        s = store.set_status(urn, "failed", _store_dir, building, finished_at=store.now(), error=INTERRUPTED)
    if s.get("state") in ("pending", "running"):
        s["log"] = list(_log_lines.get(int(urn), []))[-8:]
    s["output_available"] = bool(s.get("hash")) and store.has_output(urn, s["hash"], _store_dir)
    return s


def output(urn: int, key: str | None = None) -> dict | None:
    return store.load_output(urn, key, _store_dir)


def drawn(urn: int, building: str, key: str) -> dict | None:
    """Brief 198: decodED's drawn answer for one building's job, if kept."""
    return store.load_drawn(urn, building, key, _store_dir)


def keep_drawn(urn: int, building: str, key: str, answer: dict) -> None:
    store.save_drawn(urn, building, key, answer, _store_dir)


def summary() -> dict:
    with _lock:
        inflight = [{"urn": k[0], "hash": k[1], "state": v} for k, v in _inflight.items()]
    return {"inflight": inflight, "queued": _q.qsize(), "queue_max": QUEUE_MAX, "worker_alive": bool(_worker and _worker.is_alive()), "recent": list(_recent)[-5:], "store": store.outputs(_store_dir), "tile_cache": _tile_cache()}


def _tile_cache() -> dict:
    """7 Nov 2026: what the tile cache holds against its ceiling (tiles.TILE_CACHE_MAX_BYTES), for /health."""
    from . import tiles

    try:
        return {**tiles.cache_usage(_cache_dir or tiles.DEFAULT_CACHE_DIR), "max_bytes": tiles.TILE_CACHE_MAX_BYTES}
    except OSError:
        return {"tiles": None, "bytes": None, "max_bytes": tiles.TILE_CACHE_MAX_BYTES}
