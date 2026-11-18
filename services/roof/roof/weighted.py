"""decodED roof service — Brief 29 (Route E): a roof from an angle per footprint edge.

`{ "style": "edges", "angles_deg": [a0, a1, …] }`, one angle per edge of the outer ring (the edge
starting at vertex i), in degrees: the measured pitch for a sloping wall, 90 for a gable end (the
roof rises vertically off that wall). The weighted straight skeleton then decides the ridges and
hips; no family is named. Gable, hip, mono, half-hip and mixed pitches emerge from the angles.

A weighted skeleton cannot hold a 0° face (CGAL requires 0 < angle), so a flat edge is a level,
not an angle (brief D5): a building whose edges are all flat is built as one deck; a building
with some flat edges among pitched ones is flagged `EDGES_MIXED_FLAT` and its flat edges are
raised to `MIN_ANGLE_DEG` so the roof still closes — the honest answer there is Brief 09's
sections, and the flag says so.

Walls stand where CGAL puts them: a 90° edge gives a vertical face from the eave to the ridge,
labelled `gable_end_wall`; every other face is `main`. decodED's own code, no provenance header.
"""

from __future__ import annotations

import math

from . import skel
from .geo import XY, ensure_ccw, ensure_cw, face_record, open_ring, polygon_tilt_deg
from .skeleton import Constructed, flat_faces

MIN_ANGLE_DEG = 1.0
FLAT_BELOW_DEG = 8.0  # the producer's own flat threshold (roof-fit.ts FIT.SLOPE_DEG)
WALL_ABOVE_DEG = 89.5


def edges_faces(footprint: list[XY], angles_deg: list[float], eave: float,
                holes: list[list[XY]] | None = None) -> Constructed:
    """Roof faces over the polygon from one angle per outer edge. Raises skel.SkeletonError."""
    outer_in = open_ring(footprint)
    if len(outer_in) < 3:
        return Constructed(faces=[], flags=["INVALID_POLYGON: fewer than 3 vertices"], fell_back_to_flat=True)
    if len(angles_deg) != len(outer_in):
        raise ValueError(f"edges: {len(angles_deg)} angles for {len(outer_in)} edges")
    flags: list[str] = []
    angles = [float(a) for a in angles_deg]
    flat = [a < FLAT_BELOW_DEG for a in angles]
    if all(flat):
        return Constructed(faces=flat_faces(outer_in, eave), flags=["EDGES_ALL_FLAT"])
    if any(flat):
        flags.append(f"EDGES_MIXED_FLAT: {sum(flat)} of {len(flat)} edges under {FLAT_BELOW_DEG:g}° raised to {MIN_ANGLE_DEG:g}°")
    angles = [min(90.0, max(MIN_ANGLE_DEG, a)) for a in angles]

    # The bridge wants the outer ring CCW; keep the angles with their edges when it is reversed.
    outer = ensure_ccw(outer_in)
    if outer != outer_in:
        n = len(outer_in)
        angles = [angles[(2 * n - 2 - i) % n] for i in range(n)]
    inner = [ensure_cw(open_ring(h)) for h in (holes or []) if len(open_ring(h)) >= 3]
    raw = skel.weighted_skeleton(outer, angles, inner)

    # One face per contour edge; its vertices' times are heights above the eave (skel.py). A face
    # on a 90° edge is the gable wall itself — a sliver one centimetre off vertical — and the
    # neighbouring faces run to its ridge, so no extra wall is drawn.
    faces: list[dict] = []
    k = 0
    for ring in raw:
        lifted = [(x, y, t + eave) for x, y, t in ring]
        if len(lifted) < 3:
            continue
        tilt = polygon_tilt_deg(lifted)
        role = "gable_end_wall" if tilt >= WALL_ABOVE_DEG else "main"
        faces.append(face_record(role, lifted, f"e{k}"))
        k += 1
    if not any(f["role"] == "main" for f in faces):
        return Constructed(faces=flat_faces(outer_in, eave), flags=[*flags, "EDGES_NO_ROOF_FACES"], fell_back_to_flat=True)
    return Constructed(faces=faces, flags=flags)


def family_from_angles(angles_deg: list[float], edge_lengths: list[float]) -> str:
    """The family the angles imply, for a report line only (the geometry never needs it): the
    length-weighted share of the ring that is vertical (gable ends), pitched, or flat."""
    total = sum(edge_lengths) or 1.0
    vert = sum(l for a, l in zip(angles_deg, edge_lengths) if a >= WALL_ABOVE_DEG) / total
    flat = sum(l for a, l in zip(angles_deg, edge_lengths) if a < FLAT_BELOW_DEG) / total
    if flat >= 0.999:
        return "flat"
    if flat > 0.05:
        return "mixed"
    if vert < 0.05:
        return "hip"
    if vert > 0.6:
        return "mono"
    return "gable"
