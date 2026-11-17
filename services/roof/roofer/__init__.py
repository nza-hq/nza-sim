"""decodED's roofer job (Brief 56 Part 2): for one school, fetch the EA LiDAR tiles over its site, clip
them, run roofer (3DBAG, GPL-3, v1.0.0, a separate executable) on decodED's own footprints, and write the
one JSON per school that src/twin/roofer/output.ts reads — the contract Brief 39's spike loader
(src/twin/roofer/spike.ts, `SpikeSchool`) established, in EPSG:27700 with no origin to rebuild.

It lives in the roof container with CGAL because it is bound by the same rule (Brief 20 D3, Brief 56 D4):
server-side, a separate process, outputs only. Nothing here is imported by anything a browser runs.

Modules: tiles (the EA Survey Data Download index and tile cache) · gpkg (footprints as a GeoPackage,
no GDAL needed) · cloud (clip, reclassify, diagnostics, terrain) · cityjson (roofer's CityJSONSeq →
triangles and rows) · job (one run, end to end) · store (the per-school outputs on disk) · queue (one
job at a time, a status per URN). roof/app.py exposes POST /roofer/run and GET /roofer/{urn}.

The heavy imports (numpy, scipy, shapely, pyproj, laspy, mapbox_earcut) are inside the functions that
need them, so a laptop's `roof` env without them still serves /roof/* and reports roofer as unavailable.
"""

from __future__ import annotations

import os
import shutil
import subprocess

#: The roofer version the spike ran (nza-roofer-spike @ 1bb9196, Rev A: "roofer v1.0.0 built from source").
ROOFER_VERSION = "1.0.0"
#: The EA tile nodata value roofer passed through as a floor height at Torquay (spike STATUS Rev C).
NODATA_FLOOR = -2147545


def roofer_binary() -> str | None:
    """The roofer executable, or None. ROOFER_BIN wins, else PATH."""
    env = os.environ.get("ROOFER_BIN", "").strip()
    if env and os.path.exists(env):
        return env
    return shutil.which("roofer")


def roofer_version() -> str | None:
    """`roofer --version`'s first line, or None when it cannot run."""
    binary = roofer_binary()
    if not binary:
        return None
    env = dict(os.environ)
    for src, dst in (("ROOFER_GDAL_DATA", "GDAL_DATA"), ("ROOFER_PROJ_DATA", "PROJ_DATA")):
        if os.environ.get(src):
            env[dst] = os.environ[src]
    try:
        out = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=20, env=env)
    except (OSError, subprocess.SubprocessError):
        return None
    text = (out.stdout or out.stderr or "").strip().splitlines()
    return text[0] if text else None


def deps_available() -> tuple[bool, str]:
    """Whether the job's Python dependencies import. (ok, the missing one or '')."""
    # Brief 195 P2: found, not imported. The job runs in its own process (child.py), so the web process need not
    # carry numpy, scipy, shapely, pyproj and laspy (~70 MB resident) for its whole life just to say they are there.
    import importlib.util

    for name in ("numpy", "scipy", "shapely", "pyproj", "laspy", "mapbox_earcut"):
        try:
            if importlib.util.find_spec(name) is None:
                return False, f"{name}: not installed"
        except (ImportError, ValueError) as err:
            return False, f"{name}: {err}"
    return True, ""


def availability() -> dict:
    """What /health reports: can this container run the roofer job, and with what."""
    ok, missing = deps_available()
    version = roofer_version()
    return {
        "available": bool(version) and ok,
        "version": version,
        "pinned": ROOFER_VERSION,
        "deps": ok,
        **({"missing": missing} if missing else {}),
    }
