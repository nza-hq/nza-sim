"""The per-school outputs on the container's disk (Brief 56 D5, second choice; Part 3 decides the first).

    <ROOFER_STORE_DIR>/<urn>/<footprints_hash>.json   one job's output (job.py)
    <ROOFER_STORE_DIR>/<urn>/status.json              the last job's state for this URN
    <ROOFER_STORE_DIR>/<urn>/status.b-<building>.json the last ONE-BUILDING job's state (Brief 198)
    <ROOFER_STORE_DIR>/<urn>/drawn/b-<building>.<hash>.json decodED's drawn answer for that job (Brief 198, 5 Nov)

ROOFER_STORE_DIR defaults to <ROOFER_CACHE_DIR>/store. A Supabase bucket (D5's first choice) would be
written from here, by this container only, once Chris rules on the second server-side secret — nothing in
this module assumes one. decodED reads outputs through GET /roofer/{urn} only.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

from . import tiles

DEFAULT_STORE_DIR = os.environ.get("ROOFER_STORE_DIR") or str(Path(tiles.DEFAULT_CACHE_DIR) / "store")

#: Brief 195 P4: "skipped" — the automatic job does not run for a site this big; measured roofs are on request.
STATES = ("none", "pending", "running", "done", "failed", "skipped")


def _dir(urn: int, store_dir: str | Path = DEFAULT_STORE_DIR) -> Path:
    return Path(store_dir) / str(int(urn))


def _safe(building: str) -> str:
    """A building id as a file name: decodED's ids carry '/', '#' and ':' (`os123#1`), so anything else is '_'."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", str(building))[:120]


def _status_path(urn: int, store_dir: str | Path, building: str | None) -> Path:
    """Brief 198 (Linzie, 4 Nov 2026 22:51): a Pro user measures one building at a time. That job's state lives in its
    own file, so it never stands in for (or overwrites) the site's own job, which a build reads in chooseSource."""
    return _dir(urn, store_dir) / (f"status.b-{_safe(building)}.json" if building else "status.json")


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def status(urn: int, store_dir: str | Path = DEFAULT_STORE_DIR, building: str | None = None) -> dict:
    p = _status_path(urn, store_dir, building)
    if not p.exists():
        return {"urn": int(urn), "state": "none", **({"building": building} if building else {})}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"urn": int(urn), "state": "none", "note": "status unreadable"}


def set_status(urn: int, state: str, store_dir: str | Path = DEFAULT_STORE_DIR, building: str | None = None, **fields) -> dict:
    assert state in STATES, state
    d = _dir(urn, store_dir)
    d.mkdir(parents=True, exist_ok=True)
    s = {**status(urn, store_dir, building), **fields, "urn": int(urn), "state": state, "updated_at": now(), **({"building": building} if building else {})}
    final = _status_path(urn, store_dir, building)
    tmp = final.with_name(final.name + ".tmp")
    tmp.write_text(json.dumps(s, indent=1), encoding="utf-8")
    tmp.replace(final)
    return s


def has_output(urn: int, key: str, store_dir: str | Path = DEFAULT_STORE_DIR) -> bool:
    return (_dir(urn, store_dir) / f"{key}.json").exists()


def save_output(urn: int, key: str, output: dict, store_dir: str | Path = DEFAULT_STORE_DIR) -> Path:
    d = _dir(urn, store_dir)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{key}.json.tmp"
    tmp.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    final = d / f"{key}.json"
    tmp.replace(final)
    return final


def load_output(urn: int, key: str | None = None, store_dir: str | Path = DEFAULT_STORE_DIR) -> dict | None:
    """The output for `key`, or, with no key, the one the status names, else the newest on disk."""
    d = _dir(urn, store_dir)
    if not d.exists():
        return None
    if key is None:
        key = status(urn, store_dir).get("hash")
    p = d / f"{key}.json" if key else None
    if p is None or not p.exists():
        outs = sorted((q for q in d.glob("*.json") if not q.name.startswith("status")), key=lambda q: q.stat().st_mtime, reverse=True)
        p = outs[0] if outs else None
    if p is None:
        return None
    return json.loads(p.read_text(encoding="utf-8"))


#: Brief 198 (5 Nov 2026): decodED's drawn answer for one building is a few KB; anything far bigger is refused.
DRAWN_MAX_BYTES = 512 * 1024


def _drawn_path(urn: int, building: str, hash: str, store_dir: str | Path) -> Path:
    return _dir(urn, store_dir) / "drawn" / f"b-{_safe(building)}.{_safe(hash)}.json"


def save_drawn(urn: int, building: str, hash: str, answer: dict, store_dir: str | Path = DEFAULT_STORE_DIR) -> Path:
    """Keep decodED's drawn answer for one building's measured roof, so it is drawn once: decodED's server runs on many
    short-lived copies, and each would otherwise rebuild the whole school to draw it again (Hartpury: 30 s and more)."""
    text = json.dumps(answer, separators=(",", ":"))
    if len(text.encode("utf-8")) > DRAWN_MAX_BYTES:
        raise ValueError("drawn answer too big")
    final = _drawn_path(urn, building, hash, store_dir)
    final.parent.mkdir(parents=True, exist_ok=True)
    tmp = final.with_name(final.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(final)
    return final


def load_drawn(urn: int, building: str, hash: str, store_dir: str | Path = DEFAULT_STORE_DIR) -> dict | None:
    p = _drawn_path(urn, building, hash, store_dir)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def outputs(store_dir: str | Path = DEFAULT_STORE_DIR) -> dict:
    """What the store holds: schools with an output, bytes."""
    root = Path(store_dir)
    if not root.exists():
        return {"schools": 0, "outputs": 0, "bytes": 0}
    files = [p for p in root.glob("*/*.json") if not p.name.startswith("status")]
    return {"schools": len({p.parent.name for p in files}), "outputs": len(files), "bytes": sum(p.stat().st_size for p in files)}
