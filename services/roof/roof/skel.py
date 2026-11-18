# Copied from nza-twin-lab @ 4da46dc (services/roof/roof/skel.py) on 2026-10-01. Diverged: yes — HAND-EDITED IN DECODED (Brief 29 P1, Route E): `extruded_roof()` drives the bridge's `--weighted` mode. See docs/provenance.md §4.
"""The straight-skeleton bridge: the C++ executable built from skel/skel.cpp (CGAL, GPL-3,
server-side only). Builds it on first use with the env's compiler; runs it per polygon."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / "skel" / "skel.cpp"
WIN = sys.platform == "win32"
BIN = HERE / "skel" / ("skel.exe" if WIN else "skel")


class SkeletonError(Exception):
    """The polygon is not simple, or CGAL could not build its skeleton."""


# Brief 195 (4 Nov 2026, hand-edited in decodED): each skeleton runs as its own process, and until now with no
# ceiling. A polygon CGAL cannot finish took the whole container's memory, and the host restarted the service
# for everyone (the 21:36 memory email, Hartpury College's 269 sections). Each run now has a memory cap and a
# time limit; a run over either is a SkeletonError like any other, so that one section is drawn flat and
# flagged and every other roof is drawn. These are new, lower ceilings, not raised ones.
SKEL_MEMORY_MB = int(os.environ.get("ROOF_SKEL_MEMORY_MB", "200"))
SKEL_TIMEOUT_S = float(os.environ.get("ROOF_SKEL_TIMEOUT_S", "10"))


def _capped() -> None:  # runs in the child, before CGAL starts
    import resource
    cap = SKEL_MEMORY_MB * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (cap, cap))
    try:  # if the host still runs short, take this run, not the service
        with open("/proc/self/oom_score_adj", "w") as f:
            f.write("1000")
    except OSError:
        pass


def _run(args: list[str], text_in: str, what: str) -> str:
    try:
        proc = subprocess.run(
            args, input=text_in, capture_output=True, text=True, env=_run_env(),
            timeout=SKEL_TIMEOUT_S, preexec_fn=None if WIN else _capped,
        )
    except subprocess.TimeoutExpired as err:
        raise SkeletonError(f"{what} took over {SKEL_TIMEOUT_S:g} s") from err
    if proc.returncode != 0:
        why = proc.stderr.strip()[-300:]
        if proc.returncode < 0 or "bad_alloc" in why or "MemoryError" in why:
            why = f"{what} went over its {SKEL_MEMORY_MB} MB ({why or f'signal {-proc.returncode}'})"
        raise SkeletonError(why or f"{what} exit {proc.returncode}")
    return proc.stdout


def env_prefix() -> Path:
    if WIN:
        return Path(os.environ.get("CONDA_PREFIX") or Path(sys.executable).resolve().parent)
    return Path(os.environ.get("CONDA_PREFIX") or Path(sys.executable).resolve().parent.parent)


def _run_env() -> dict[str, str]:
    """Windows: the env's Library/bin (gmp, mpfr DLLs) must be on PATH for skel.exe."""
    env = dict(os.environ)
    if WIN:
        env["PATH"] = str(env_prefix() / "Library" / "bin") + os.pathsep + env.get("PATH", "")
    return env


def _build_msvc() -> Path:
    """Windows: compile with cl.exe from the Visual Studio Build Tools, inside vcvars64."""
    env = env_prefix() / "Library"
    vswhere = Path(os.environ.get("ProgramFiles(x86)", "")) / "Microsoft Visual Studio" / "Installer" / "vswhere.exe"
    root = subprocess.run(
        [str(vswhere), "-products", "*", "-latest", "-property", "installationPath"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    vcvars = Path(root) / "VC" / "Auxiliary" / "Build" / "vcvars64.bat"
    cl = (
        f'cl /nologo /O2 /EHsc /std:c++17 /bigobj /DCGAL_USE_GMP /DCGAL_USE_MPFR /I"{env / "include"}" '
        f'"{SRC}" /Fe:"{BIN}" /Fo:"{BIN.parent}\\\\" /link /LIBPATH:"{env / "lib"}" gmp.lib mpfr.lib'
    )
    subprocess.run(f'call "{vcvars}" && {cl}', shell=True, check=True)
    return BIN


def build() -> Path:
    """Compile skel.cpp against the env's CGAL headers (once; ~40 s)."""
    if WIN:
        return _build_msvc()
    env = env_prefix()
    cxx = env / "bin" / "clang++"
    if not cxx.exists():
        cxx = env / "bin" / "c++"
    cmd = [
        str(cxx), "-O2", "-std=c++17", f"-I{env / 'include'}", "-DCGAL_USE_GMP", "-DCGAL_USE_MPFR",
        str(SRC), "-o", str(BIN), f"-L{env / 'lib'}", "-lgmp", "-lmpfr", f"-Wl,-rpath,{env / 'lib'}",
    ]
    subprocess.run(cmd, check=True)
    return BIN


def ensure_built() -> Path:
    if not BIN.exists() or BIN.stat().st_mtime < SRC.stat().st_mtime:
        build()
    return BIN


def cgal_version() -> str:
    out = subprocess.run(
        [str(ensure_built()), "--version"], capture_output=True, text=True, check=True, env=_run_env()
    )
    return out.stdout.strip()


Ring = list[tuple[float, float]]
SkelFace = list[tuple[float, float, float]]  # (x, y, time), CCW; first two = the contour edge


def interior_skeleton(outer: Ring, holes: list[Ring] | None = None) -> list[SkelFace]:
    """One face per contour edge, vertices as (x, y, time). Raises SkeletonError if not simple."""
    rings = [outer, *(holes or [])]
    lines = [str(len(rings))]
    for ring in rings:
        lines.append(str(len(ring)))
        lines.extend(f"{x!r} {y!r}" for x, y in ring)
    tokens = _run([str(ensure_built())], "\n".join(lines) + "\n", "skel").split()
    it = iter(tokens)
    faces: list[SkelFace] = []
    for _ in range(int(next(it))):
        m = int(next(it))
        faces.append([(float(next(it)), float(next(it)), float(next(it))) for _ in range(m)])
    return faces


def weighted_skeleton(outer: Ring, angles_deg: list[float], holes: list[Ring] | None = None,
                      hole_angles: list[list[float]] | None = None) -> list[SkelFace]:
    """Brief 29 (Route E): the weighted skeleton over `outer` when the edge starting at vertex i
    rises at `angles_deg[i]` (0 < a ≤ 90; 90 = a vertical gable end). One face per contour edge,
    vertices as (x, y, time) — and because the bridge weights each edge by tan(angle), **time is
    the height above the eave plane**. Raises SkeletonError for a non-simple ring, a bad angle, or
    a failed build."""
    rings = [outer, *(holes or [])]
    ring_angles = [angles_deg, *(hole_angles or [[45.0] * len(h) for h in (holes or [])])]
    for ring, angs in zip(rings, ring_angles):
        if len(angs) != len(ring):
            raise SkeletonError(f"{len(angs)} angles for a ring of {len(ring)} edges")
    lines = [str(len(rings))]
    for ring, angs in zip(rings, ring_angles):
        lines.append(str(len(ring)))
        lines.extend(f"{x!r} {y!r} {a!r}" for (x, y), a in zip(ring, angs))
    tokens = _run([str(ensure_built()), "--weighted"], "\n".join(lines) + "\n", "skel --weighted").split()
    it = iter(tokens)
    faces: list[SkelFace] = []
    for _ in range(int(next(it))):
        m = int(next(it))
        faces.append([(float(next(it)), float(next(it)), float(next(it))) for _ in range(m)])
    return faces
