# Copied from nza-twin-lab @ 4da46dc (services/roof/roof/app.py) on 2026-10-01.
# Diverged: yes — the open CORS middleware is removed. Upstream allowed any origin because its
# browser viewer called this service directly; in decodED nothing in a browser ever does. The
# producer runs server-side (Brief 20 D2) and src/services/roof-service.js is the only client, so
# a cross-origin POST is never made — and a GPL-3 CGAL service should not invite one. Removing it
# also drops the `fastapi.middleware.cors` import. Verified: the 68 service tests still pass, and
# verify/roof-service.mjs (a server-side Node client, no Origin header) is unaffected.
# Also diverged (26 Oct 2026): a hosted service answers only decodED. When ROOF_SERVICE_TOKEN is
# set, the /roof/* routes need `Authorization: Bearer <token>`; /health stays open for the host's
# health check. Unset (a laptop, bound to 127.0.0.1) changes nothing.
# Also diverged (Brief 56 Part 2, 27 Oct 2026): the roofer job rides in the same container (D4: one
# licence boundary, GPL-3 CGAL and GPL-3 roofer). POST /roofer/run queues one school; GET /roofer/{urn}
# answers pending | running | done | failed and, when done, the output JSON. Behind the same token.
# Also diverged (Brief 173, 4 Nov 2026): the service defends itself. The roofer queue is bounded and a full
# one answers 429 queue_full with a Retry-After; the request models carry the limits decodED's
# checkRoofBatch (src/middleware/guards.js) enforces, and more, so a bug on the Express side is a 422 here.
"""FastAPI app (D29): /health, /roof/construct, /roof/construct-batch, and (Brief 56) /roofer/run,
/roofer/{urn}. Thin: the geometry is in skeleton.py (any simple polygon) and, from Part 3,
generators.py (the 14 shapes on rectangles) behind route.py; the roofer job is roofer/job.py."""

from __future__ import annotations

import hmac
import math
import os
import time
from typing import Annotated

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

import roofer as roofer_pkg
from roofer import queue as roofer_queue

from . import skel
from .route import construct

app = FastAPI(title="decodED roof service", version="0.2.0")
# No CORS: decodED's Express is the only client (src/services/roof-service.js). The browser gets a
# finished ProjectFile from /api/twin/:urn and never speaks to this service — see the header.

# Brief 56: whether this container can run roofer is read once; a laptop's env without the job's
# dependencies (or the binary) serves /roof/* as before and says so here.
_ROOFER = roofer_pkg.availability()


@app.middleware("http")
async def only_decoded(request: Request, call_next):
    """With ROOF_SERVICE_TOKEN set (hosted), /roof/* and /roofer/* answer only a caller holding it."""
    token = os.environ.get("ROOF_SERVICE_TOKEN", "")
    if token and request.url.path.startswith("/roof"):
        given = request.headers.get("authorization", "")
        if not hmac.compare_digest(given.encode(), f"Bearer {token}".encode()):
            return JSONResponse({"detail": "unauthorised"}, status_code=401)
    return await call_next(request)


# --- Brief 173: the limits. The same numbers as src/middleware/limits.js (ROOF_BATCH_MAX_BUILDINGS,
# ROOF_MAX_VERTICES, BOUNDARY_MAX_VERTICES) so a body Express lets through is never a 422 here, and the
# service still refuses one that reaches it another way. A footprint ring is tens of vertices; the largest
# real site has 30 buildings; a school's eave is under 30 m; a NaN or an infinity is never a coordinate.
MAX_BUILDINGS = 200  # per batch, and footprints per roofer run
MAX_VERTICES = 500  # per footprint (holes included, as checkRoofBatch counts), and per GeoJSON ring
MAX_RINGS = 10  # holes per footprint; rings per GeoJSON polygon (the outer and its holes)
MAX_EAVE_M = 200.0
MAX_ID_LEN = 200

Finite = Annotated[float, Field(allow_inf_nan=False)]
XY = tuple[Finite, Finite]
Ring = Annotated[list[XY], Field(max_length=MAX_VERTICES)]


def _all_finite(v, depth: int = 0) -> bool:
    """Every number in `v` (walked; depth-limited so a deep nest is refused) is finite — guards.js allFinite."""
    if depth > 6:
        return False
    if isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        return math.isfinite(v)
    if isinstance(v, str):  # "inf" and "nan" are floats to the generators (float(roof["pitch_deg"]))
        try:
            return math.isfinite(float(v))
        except ValueError:
            return True
    if isinstance(v, list):
        return all(_all_finite(x, depth + 1) for x in v)
    if isinstance(v, dict):
        return all(_all_finite(x, depth + 1) for x in v.values())
    return True


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """A 422 that says where and why, in a few words, and never echoes the body: the default handler
    repeats the offending input, and a bare NaN or Infinity in the JSON (Python's parser accepts them)
    then fails to serialise — a 500 for a body that should be a 422."""
    detail = [{"loc": list(e.get("loc", ())), "msg": str(e.get("msg", "invalid")), "type": str(e.get("type", ""))} for e in exc.errors()[:10]]
    return JSONResponse({"error": "invalid_request", "detail": detail}, status_code=422)


class ConstructRequest(BaseModel):
    footprint: Ring = Field(min_length=3, description="local metres, any winding")
    holes: Annotated[list[Ring], Field(max_length=MAX_RINGS)] = []
    roof: dict
    eave_m: Finite = Field(ge=0, le=MAX_EAVE_M)

    @model_validator(mode="after")
    def _bounded(self):
        vertices = len(self.footprint) + sum(len(h) for h in self.holes)
        if vertices > MAX_VERTICES:
            raise ValueError(f"{vertices} vertices (footprint and holes), over {MAX_VERTICES}")
        if not _all_finite(self.roof):
            raise ValueError("roof has a number that is not finite, or is nested too deep")
        return self


class BatchItem(ConstructRequest):
    id: str = Field(min_length=1, max_length=MAX_ID_LEN)


class BatchRequest(BaseModel):
    buildings: list[BatchItem] = Field(max_length=MAX_BUILDINGS)


@app.get("/health")
def health() -> dict:
    t = time.perf_counter()
    version = skel.cgal_version()
    # Brief 56: the roofer job's availability and its queue, for decodED's /api/health and the rigs
    return {"ok": True, "cgal": version, "skel_ms": round((time.perf_counter() - t) * 1000, 1), "roofer": {**_ROOFER, **roofer_queue.summary()}}


# --- Brief 56 Part 2.4: the roofer job -----------------------------------------------------------------


Position = Annotated[list[Finite], Field(min_length=2, max_length=3)]  # lng, lat (, height)
GeoRing = Annotated[list[Position], Field(min_length=3, max_length=MAX_VERTICES)]


class GeoJsonPolygon(BaseModel):
    type: str = Field(pattern="^Polygon$")
    coordinates: Annotated[list[GeoRing], Field(min_length=1, max_length=MAX_RINGS)]

    @field_validator("coordinates")
    @classmethod
    def _on_the_globe(cls, rings):
        for ring in rings:
            for pos in ring:
                if abs(pos[0]) > 180 or abs(pos[1]) > 90:
                    raise ValueError(f"position {pos[:2]} is not a longitude and a latitude")
        return rings


class RooferFootprint(BaseModel):
    id: str = Field(min_length=1, max_length=MAX_ID_LEN)
    footprint: GeoJsonPolygon


class RooferRunRequest(BaseModel):
    urn: int = Field(gt=0, lt=10**9)
    site: GeoJsonPolygon
    footprints: list[RooferFootprint] = Field(min_length=1, max_length=MAX_BUILDINGS)
    options: dict = {}


@app.post("/roofer/run", status_code=202)
def roofer_run(req: RooferRunRequest):
    """Queue roofer for one school (decodED's site polygon and footprints, lng/lat). Returns at once.
    Brief 173: 429 queue_full (with Retry-After) when the queue holds ROOFER_QUEUE_MAX jobs and this is not
    one of them; the same school with the same footprints already queued or running is answered with that state."""
    if not _ROOFER["available"]:
        raise HTTPException(status_code=503, detail={"error": "roofer_unavailable", **_ROOFER})
    try:
        return roofer_queue.submit(req.urn, req.site.model_dump(), [f.model_dump() for f in req.footprints], req.options)
    except roofer_queue.QueueFull as full:
        return JSONResponse(
            {"error": "queue_full", "retry_after_s": full.retry_after_s, "queued": full.queued, "queue_max": roofer_queue.QUEUE_MAX},
            status_code=429,
            headers={"Retry-After": str(full.retry_after_s)},
        )


@app.get("/roofer/{urn}")
def roofer_status(urn: int, output: int = 0, building: str | None = None) -> dict:
    """pending | running | done | failed | none for this URN; `?output=1` adds the JSON when done.
    Brief 198: `?building=<id>` answers for that building's own one-building job (Pro, measured on request)."""
    s = roofer_queue.status(urn, building[:200] if building else None)
    if output and s.get("state") == "done":
        s["output"] = roofer_queue.output(urn, s.get("hash"))
    return s


@app.get("/roofer/{urn}/output")
def roofer_output(urn: int, hash: str | None = None) -> dict:
    """The output JSON for this URN (the newest, or the footprints hash asked for). 404 when there is none."""
    out = roofer_queue.output(urn, hash)
    if out is None:
        raise HTTPException(status_code=404, detail={"error": "no_roofer_output", "urn": urn, **roofer_queue.status(urn)})
    return out


@app.get("/roofer/{urn}/drawn")
def roofer_drawn(urn: int, building: str, hash: str) -> dict:
    """Brief 198 (5 Nov 2026): decodED's drawn answer for one building's measured roof, kept so it is drawn once.
    404 when none is kept for that building and job."""
    d = roofer_queue.drawn(urn, building[:200], hash[:64])
    if d is None:
        raise HTTPException(status_code=404, detail={"error": "no_drawn_roof", "urn": urn})
    return d


@app.put("/roofer/{urn}/drawn")
def roofer_keep_drawn(urn: int, building: str, hash: str, answer: dict = Body(...)) -> dict:
    """Keep decodED's drawn answer (only a done one, for a job this service ran: its status must name that hash)."""
    s = roofer_queue.status(urn, building[:200])
    if s.get("state") != "done" or s.get("hash") != hash or answer.get("state") != "done":
        raise HTTPException(status_code=409, detail={"error": "not_this_job", "urn": urn})
    try:
        roofer_queue.keep_drawn(urn, building[:200], hash[:64], answer)
    except ValueError as err:
        raise HTTPException(status_code=413, detail={"error": str(err)})
    return {"kept": True}


def _construct(req: ConstructRequest) -> dict:
    t = time.perf_counter()
    out = construct(req.footprint, req.roof, req.eave_m, req.holes)
    return {
        "faces": out.faces,
        "flags": out.flags,
        "fell_back_to_flat": out.fell_back_to_flat,
        "ms": round((time.perf_counter() - t) * 1000, 2),
    }


@app.post("/roof/construct")
def roof_construct(req: ConstructRequest) -> dict:
    try:
        return _construct(req)
    except ValueError as err:  # an unknown style is the caller's bug, not a fallback
        raise HTTPException(status_code=422, detail=str(err)) from err


@app.post("/roof/construct-batch")
def roof_construct_batch(req: BatchRequest) -> dict:
    t = time.perf_counter()
    results = {}
    for b in req.buildings:
        try:
            results[b.id] = _construct(b)
        except ValueError as err:
            results[b.id] = {"faces": [], "flags": [f"CONSTRUCT_ERROR: {err}"], "fell_back_to_flat": True, "ms": 0}
    return {"results": results, "ms": round((time.perf_counter() - t) * 1000, 1)}
