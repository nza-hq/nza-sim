#!/usr/bin/env python3
"""Brief 102 Part 3: export the local SQLite library to docs/audit/102/library_export.json, with provenance.

Read-only. Opens the database with SQLite's `mode=ro`, so it cannot write to it. Stop the dev server first
(CLAUDE.md process rule 11) so the read sees one consistent state.

What is exported, as sim.library_items kinds (0002_model_store.sql):
  construction  <- library_items.library_type 'construction'
  system_template <- 'system'
  profile       <- 'schedule'
  weather       <- each *.epw in data/weather/current/ (file name, sha256, size; the bytes stay local)
Not exported, and listed under `skipped` with the reason: 'benchmark' rows (CRREM pathways; no sim kind).
The 7 system templates bundled in frontend/src/data/systemTemplatesLibrary.js are code, not library rows, and
are not exported here (docs/audit/102/03_library.md).

Each item: { kind, key, body, provenance }. `body` is the row's config_json exactly; `key` is its `name`.
No version: the seed script decides it (an unchanged body adds nothing; a changed one is the next version).

Idempotent: if the items are the same as the existing export's, the file is left untouched (exported_at
included). Run (PowerShell, from the repo root):
  python scripts/102_export_library.py                 # data/nza_sim.db
  python scripts/102_export_library.py --db path\\to\\nza_sim.db
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import socket
import sqlite3
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT = REPO / "docs" / "audit" / "102" / "library_export.json"
KIND = {"construction": "construction", "system": "system_template", "schedule": "profile"}
SKIP = {"benchmark": "CRREM benchmark pathways: not a model input and no sim.library_items kind"}


def sha256_file(p: pathlib.Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(REPO / "data" / "nza_sim.db"))
    ap.add_argument("--weather-dir", default=str(REPO / "data" / "weather" / "current"))
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()

    db = pathlib.Path(a.db).resolve()
    if not db.is_file():
        print(f"no database at {db}", file=sys.stderr)
        return 2
    con = sqlite3.connect(f"{db.as_uri()}?mode=ro", uri=True)
    rows = con.execute(
        "select id, library_type, name, display_name, description, config_json, is_default, created_at, updated_at "
        "from library_items order by library_type, name"
    ).fetchall()
    con.close()

    items, skipped, seen = [], {}, set()
    for rid, ltype, name, display, desc, cfg, is_default, created, updated in rows:
        if ltype in SKIP:
            skipped.setdefault(ltype, {"reason": SKIP[ltype], "keys": []})["keys"].append(name)
            continue
        if ltype not in KIND:
            print(f"unknown library_type {ltype!r} on {rid}: refusing to guess a kind", file=sys.stderr)
            return 3
        kind = KIND[ltype]
        if (kind, name) in seen:
            print(f"duplicate {kind} {name!r}", file=sys.stderr)
            return 3
        seen.add((kind, name))
        items.append({
            "kind": kind,
            "key": name,
            "body": json.loads(cfg),
            "provenance": {
                "source": "nza-sim sqlite",
                "sqlite_id": rid,
                "library_type": ltype,
                "display_name": display,
                "description": desc,
                "is_default": bool(is_default),
                "created_at": created,
                "updated_at": updated,
                "brief": 102,
            },
        })

    wdir = pathlib.Path(a.weather_dir)
    for epw in sorted(wdir.glob("*.epw")) if wdir.is_dir() else []:
        digest = sha256_file(epw)
        items.append({
            "kind": "weather",
            "key": epw.name,
            "body": {"file_name": epw.name, "file_hash": digest, "bytes": epw.stat().st_size},
            "provenance": {"source": "nza-sim data/weather/current", "brief": 102},
        })

    items.sort(key=lambda i: (i["kind"], i["key"]))
    counts = {}
    for i in items:
        counts[i["kind"]] = counts.get(i["kind"], 0) + 1

    out = pathlib.Path(a.out)
    if out.is_file():
        prev = json.loads(out.read_text(encoding="utf-8"))
        if prev.get("items") == items and prev.get("skipped") == skipped and prev.get("source_db_sha256") == sha256_file(db):
            print(f"unchanged: {out.relative_to(REPO) if out.is_relative_to(REPO) else out}")
            print(json.dumps(counts))
            return 0

    doc = {
        "_note": "Brief 102 P3. Read-only export of the local nza-sim SQLite library. Seed with scripts/102_seed_library.mjs.",
        "exported_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "machine": socket.gethostname(),
        "source_db_sha256": sha256_file(db),
        "counts": counts,
        "skipped": skipped,
        "items": items,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out}")
    print(json.dumps(counts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
