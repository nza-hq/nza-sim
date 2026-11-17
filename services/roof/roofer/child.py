"""Brief 195 Part 2: one roofer job in its OWN process, with a memory cap below the container's.

Hartpury College's job (4 Nov 2026) ran the whole container out of memory, on Starter (512 MB) and then on
Standard (2 GB). It ran in a thread of the web process, so the host's out-of-memory kill took `/roof/*` and
`/health` with it and every school's roofs came back flat. Here the job is a child process:

  * the parent (queue.py) watches the RESIDENT memory of the job and everything under it (the roofer executable
    too) every 100 ms; past `ROOFER_JOB_MEMORY_MB` it kills the whole process group, and the job ends as
    `failed: memory`. The web process never notices. (An address-space limit, RLIMIT_AS, was tried first and failed
    in CI: numpy, scipy, pyproj and lazrs reserve more address space than they ever use, so the conda image ran out
    of address space at 78 MB resident.)
  * the child's `oom_score_adj` is raised to 1000, so if the container's memory runs out between two looks (the
    host's limit is for the whole container) the kernel kills the job, not the web process.
  * one decompression thread (lazrs's parallel reader spawns one per host core, and Render's hosts have many),
    one BLAS thread, two malloc arenas.

The parent (queue.py) runs `python -m roofer.child <request.json> <result.json>`, streams the child's log lines,
and reads one small JSON back. The child writes the job's output to the store itself, so the output (tens of MB
for a big site) never passes through the web process.

Exit codes: 0 done or skipped (Brief 195 P4: too big for the automatic job) · 3 memory (MemoryError, or roofer died of
an allocation failure) · 1 any other failure. A child killed by a signal (the watchdog's kill, or the kernel's OOM
kill: SIGKILL) is a memory failure; the parent decides.
"""

from __future__ import annotations

import json
import os
import resource
import sys

#: The job's resident-memory cap (the job and roofer under it, together). Starter has 512 MB for the whole container;
#: the web process takes ~70–100 MB.
DEFAULT_MEMORY_MB = 360
EXIT_MEMORY = 3
#: How a failure for lack of memory is worded in the store (decodED shows it after "the last job failed: ").
MEMORY = "failed: memory"


def memory_mb() -> int:
    try:
        v = int(os.environ.get("ROOFER_JOB_MEMORY_MB", DEFAULT_MEMORY_MB))
    except ValueError:
        v = DEFAULT_MEMORY_MB
    return max(64, v)


def child_env() -> dict:
    """The environment the child (and roofer under it) runs with: small allocator footprint, one BLAS thread."""
    env = dict(os.environ)
    env.setdefault("MALLOC_ARENA_MAX", "2")
    for k in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "RAYON_NUM_THREADS"):
        env.setdefault(k, "1")
    return env


def _first_to_go() -> None:
    try:  # the kernel's choice when the container is out of memory: this process (and roofer under it) first
        with open("/proc/self/oom_score_adj", "w") as fh:
            fh.write("1000")
    except OSError:
        pass  # not Linux, or not allowed: the watchdog still holds


def _peak_rss_mb() -> dict:
    me = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    kids = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    scale = 1024 if sys.platform != "darwin" else 1024 * 1024  # ru_maxrss: KB on Linux, bytes on macOS
    return {"job_mb": round(me / scale, 1), "roofer_mb": round(kids / scale, 1), "cap_mb": memory_mb()}


def _plant(options: dict) -> None:
    """Brief 195 P2 proof: with ROOFER_ALLOW_PLANT=1 (CI and tests only), `options.plant_memory_mb` allocates that
    much before the job starts, so a test can make a job go over the cap on purpose."""
    mb = int(options.get("plant_memory_mb") or 0)
    if mb and os.environ.get("ROOFER_ALLOW_PLANT") == "1":
        print(f"[roofer] planted: allocating {mb} MB (cap {memory_mb()} MB)", flush=True)
        import time

        held = []
        for _ in range(0, mb, 16):  # 16 MB at a time, every page touched (resident, not just reserved), as a job grows
            b = bytearray(16 << 20)
            for i in range(0, len(b), 4096):
                b[i] = 1
            held.append(b)
            time.sleep(0.02)


def main(argv: list[str]) -> int:
    req_path, result_path = argv[1], argv[2]
    _first_to_go()
    with open(req_path, encoding="utf-8") as fh:
        req = json.load(fh)

    def result(body: dict) -> None:
        with open(result_path, "w", encoding="utf-8") as fh:
            json.dump(body, fh)

    try:
        return _main(req, result)
    except MemoryError:
        import traceback

        where = " < ".join(f"{os.path.basename(f.filename)}:{f.lineno} {f.name}" for f in reversed(traceback.extract_tb(sys.exc_info()[2])[-4:]))
        result({"state": "failed", "error": f"{MEMORY}: the job needed more than its {memory_mb()} MB cap (at {where})", "memory": _peak_rss_mb()})
        return EXIT_MEMORY
    except Exception as err:  # noqa: BLE001 — every failure is recorded
        from .job import TooBigForAuto

        if isinstance(err, TooBigForAuto):  # Brief 195 P4: the size rule, before any download
            result({"state": "skipped", "error": str(err), "memory": _peak_rss_mb()})
            return 0
        msg = f"{type(err).__name__}: {err}"[:1500]
        if "bad_alloc" in msg or "Cannot allocate memory" in msg or "MemoryError" in msg:
            result({"state": "failed", "error": f"{MEMORY}: {msg[:300]}", "memory": _peak_rss_mb()})
            return EXIT_MEMORY
        result({"state": "failed", "error": msg, "memory": _peak_rss_mb()})
        return 1


def _main(req: dict, result) -> int:
    _plant(req.get("options") or {})
    from . import job, store

    kwargs = {"log": lambda m: print(m, flush=True)}
    if req.get("cache_dir"):
        kwargs["cache_dir"] = req["cache_dir"]
    out = job.run(req["urn"], req["site"], req["footprints"], req.get("options"), **kwargs)
    out["memory"] = _peak_rss_mb()
    store.save_output(req["urn"], req["hash"], out, req["store_dir"])
    result(
        {
            "state": "done",
            "survey": out["survey"]["label"],
            "buildings": out["footprints"]["run"],
            "roof_triangles": len(out["roof_tris"]),
            "timings": out["timings"],
            "bytes_downloaded": out["bytes_downloaded"],
            "memory": out["memory"],
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
