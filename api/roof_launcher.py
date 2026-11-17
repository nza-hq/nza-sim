"""
api/roof_launcher.py

Brief 123: start the roof service (services/roof, copied from decodED) beside NZA Sim's backend, and stop it
with the backend. A port of decodED's src/services/roof-launcher.js. It never raises: a roof service that
will not start leaves pitched roofs on rectangles only, said on screen.

The service runs CGAL (GPL-3) as its own process on this machine. The browser never reaches it: the
frontend asks NZA Sim's backend (api/routers/roof.py), which asks the service.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

import httpx

WIN = sys.platform == "win32"
ROOF_DIR = Path(__file__).resolve().parent.parent / "services" / "roof"
DEFAULT_URL = "http://127.0.0.1:8009"

_child: subprocess.Popen | None = None


def base_url() -> str:
    """ROOF_SERVICE_URL, or this machine's port 8009; empty turns the service off."""
    return os.environ.get("ROOF_SERVICE_URL", DEFAULT_URL).rstrip("/")


def env_candidates() -> list[Path]:
    """Where a `roof` conda env usually lives (decodED's list). ROOF_ENV wins."""
    home = Path.home()
    c = [os.environ.get("ROOF_ENV")] + [str(home / d / "envs" / "roof") for d in ("miniconda3", "miniforge3", "mambaforge", "anaconda3")]
    c += ["/opt/homebrew/Caskroom/miniforge/base/envs/roof", "/opt/conda/envs/roof"]
    return [Path(p) for p in c if p]


def python_of(env: Path) -> Path:
    return env / ("python.exe" if WIN else "bin/python")


def find_env() -> Path | None:
    return next((p for p in env_candidates() if python_of(p).exists()), None)


def _loopback(url: str) -> tuple[str, str] | None:
    u = urlparse(url)
    if u.scheme != "http" or u.hostname not in ("127.0.0.1", "localhost", "::1"):
        return None
    return ("127.0.0.1" if u.hostname == "localhost" else u.hostname, str(u.port or 80))


async def health() -> dict:
    url = base_url()
    if not url:
        return {"ok": False, "reason": "ROOF_SERVICE_URL is empty (off)"}
    try:
        async with httpx.AsyncClient(timeout=2.0) as c:
            r = await c.get(f"{url}/health")
            if r.status_code == 200:
                return {"ok": True, **r.json()}
            return {"ok": False, "reason": f"health answered {r.status_code}"}
    except httpx.HTTPError as e:
        return {"ok": False, "reason": f"not answering at {url} ({type(e).__name__})"}


async def start(wait_s: float = 60.0) -> dict:
    """Start the service if this backend should; wait up to wait_s for it to answer."""
    global _child
    if os.environ.get("ROOF_AUTOSTART") == "0":
        return {"started": False, "reason": "ROOF_AUTOSTART=0"}
    url = base_url()
    at = _loopback(url) if url else None
    if not at:
        return {"started": False, "reason": f"not this machine's service ({url or 'off'})"}
    if (await health())["ok"]:
        print(f"Roof service: already answering at {url}")
        return {"started": False, "reason": "already running"}
    env = find_env()
    if not env:
        print("Roof service: no `roof` conda env, so pitched roofs work on rectangular blocks only.\n"
              "  Make it once with:  conda env create -f services/roof/environment.yml")
        return {"started": False, "reason": "no conda env"}
    run_env = {**os.environ, "CONDA_PREFIX": str(env)}
    if WIN:
        run_env["PATH"] = f"{env / 'Library' / 'bin'};{run_env.get('PATH', '')}"
    print(f"Roof service: starting on {at[0]}:{at[1]} (the first run compiles CGAL, about 40 s)")
    _child = subprocess.Popen(
        [str(python_of(env)), "-m", "uvicorn", "roof.app:app", "--host", at[0], "--port", at[1], "--no-access-log"],
        cwd=ROOF_DIR, env=run_env, stdin=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if WIN else 0,
    )
    loop = asyncio.get_running_loop()
    until = loop.time() + wait_s
    while _child and _child.poll() is None and loop.time() < until:
        h = await health()
        if h["ok"]:
            print(f"Roof service: ready ({h.get('cgal')})")
            return {"started": True}
        await asyncio.sleep(1.0)
    if _child and _child.poll() is not None:
        print(f"Roof service: stopped (exit {_child.returncode}); pitched roofs work on rectangular blocks only")
        _child = None
        return {"started": False, "reason": "exited"}
    print("Roof service: still starting; roofs follow once it answers")
    return {"started": True}


def stop() -> None:
    global _child
    if _child and _child.poll() is None:
        _child.terminate()
    _child = None
