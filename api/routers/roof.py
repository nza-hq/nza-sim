"""
api/routers/roof.py

Brief 123: the browser's only way to the roof service (services/roof, CGAL, GPL-3, a separate process).
Thin: forwards a batch of blocks (footprint in local metres, roof recipe) and returns the service's faces,
or 503 with the reason when the service is not answering. Nothing is guessed here.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from api import roof_launcher

router = APIRouter(prefix="/api/roof", tags=["roof"])


@router.get("/health")
async def roof_health():
    return await roof_launcher.health()


@router.post("/construct-batch")
async def construct_batch(body: dict = Body(...)):
    url = roof_launcher.base_url()
    if not url:
        return JSONResponse({"error": "roof_service_off"}, status_code=503)
    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(f"{url}/roof/construct-batch", json=body)
    except httpx.HTTPError as e:
        return JSONResponse({"error": "roof_service_unavailable", "reason": type(e).__name__}, status_code=503)
    return JSONResponse(r.json(), status_code=r.status_code)
