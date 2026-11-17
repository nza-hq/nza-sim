# Copied from nza-twin-lab @ 4da46dc (services/roof/roof/route.py) on 2026-10-01. Diverged: yes — HAND-EDITED IN DECODED (Brief 29 P1, Route E): the `edges` style routes to the weighted skeleton. See docs/provenance.md §4.
"""Which constructor a footprint goes to (Part 3): a rectangle → the 14 parametric shapes
(exact, and they carry every style); `flat` → one deck over the actual footprint; `mono` → one
plane over the actual footprint; anything else pitched → CGAL's skeleton as a hip, or as a
gable with the wing-end rule. Non-rectangular plans only know `flat`, `mono`, `gable` and `hip`
(the other ten shapes are rectangle vocabulary — they go to the skeleton as a hip and say so,
`STYLE_APPROXIMATED_AS_HIP`). Fallback to flat happens ONLY for an invalid polygon
(self-intersecting, fewer than 3 vertices), flagged `INVALID_POLYGON`."""

from __future__ import annotations

import math

from .generators import ROOF_SHAPES, parametric_faces
from .geo import DEG, XY, face_record, is_rectangular, open_ring, oriented_bounding_box, signed_area_xy
from .skel import SkeletonError
from .skeleton import Constructed, flat_faces, skeleton_faces
from .weighted import edges_faces

PITCHED_ON_ANY_PLAN = {"gable", "hip"}
# A "rectangle" for the parametric shapes must also FILL its bounding box: four corners within
# 1° of square can still leave a 1 % sliver between the quad and its OBB (Cowbridge
# osm:way:839920827), and parametric faces cover the box, not the quad.
RECT_AREA_TOL = 0.002


def fills_its_box(ring: list[XY]) -> bool:
    box = oriented_bounding_box(ring)
    plan = abs(signed_area_xy(ring))
    return plan > 0 and abs(box.length * box.width - plan) / plan <= RECT_AREA_TOL


def mono_faces(footprint: list[XY], eave: float, pitch_deg: float, high_side) -> list[dict]:
    """One tilted plane over the actual footprint (route.ts monoFace), rising towards `high_side`."""
    p = open_ring(footprint)
    if isinstance(high_side, (int, float)):
        bearing = float(high_side) * DEG
    else:
        bearing = {"N": 0.0, "E": math.pi / 2, "S": math.pi, "W": math.pi * 1.5}[high_side]
    hx, hy = math.sin(bearing), math.cos(bearing)
    projs = [x * hx + y * hy for x, y in p]
    lo = min(projs)
    slope = math.tan(pitch_deg * DEG)
    return [face_record("main", [(x, y, eave + (pr - lo) * slope) for (x, y), pr in zip(p, projs)], "m0")]


def construct(footprint: list[XY], roof: dict, eave: float, holes: list[list[XY]] | None = None) -> Constructed:
    style = roof.get("style")
    # Hand-edited in decodED (Brief 29 P1, Route E): an angle per edge goes to the weighted
    # skeleton before any shape vocabulary — a rectangle with measured edges is not a preset.
    if style == "edges":
        ring = open_ring(footprint)
        if len(ring) < 3:
            return Constructed(faces=[], flags=["INVALID_POLYGON: fewer than 3 vertices"], fell_back_to_flat=True)
        try:
            return edges_faces(ring, list(roof.get("angles_deg", [])), eave, holes)
        except SkeletonError as err:
            return Constructed(faces=flat_faces(ring, eave), flags=[f"INVALID_POLYGON: {err}"], fell_back_to_flat=True)
    if style not in ROOF_SHAPES:
        raise ValueError(f"unknown roof style {style!r}")
    ring = open_ring(footprint)
    if len(ring) < 3:
        return Constructed(faces=[], flags=["INVALID_POLYGON: fewer than 3 vertices"], fell_back_to_flat=True)
    if is_rectangular(ring) and fills_its_box(ring) and not holes:
        return Constructed(faces=parametric_faces(ring, roof, eave))
    if style == "flat":
        if holes:
            # A deck with a courtyard: one ring cannot hold a hole, so the skeleton's partition at
            # pitch 0 tiles outer − holes exactly with horizontal faces.
            try:
                return skeleton_faces(ring, 0.0, eave, gable=False, holes=holes)
            except SkeletonError as err:
                return Constructed(faces=flat_faces(ring, eave), flags=[f"INVALID_POLYGON: {err}"], fell_back_to_flat=True)
        return Constructed(faces=flat_faces(ring, eave))
    if style == "mono":
        return Constructed(faces=mono_faces(ring, eave, float(roof["pitch_deg"]), roof["high_side"]))
    flags: list[str] = []
    if style not in PITCHED_ON_ANY_PLAN:
        flags.append(f"STYLE_APPROXIMATED_AS_HIP: {style}")
    pitch = float(roof.get("pitch_deg", roof.get("lower_pitch_deg", roof.get("front_pitch_deg", 30))))
    try:
        out = skeleton_faces(ring, pitch, eave, gable=style == "gable", holes=holes)
    except SkeletonError as err:
        return Constructed(faces=flat_faces(ring, eave), flags=[f"INVALID_POLYGON: {err}"], fell_back_to_flat=True)
    out.flags = flags + out.flags
    return out
