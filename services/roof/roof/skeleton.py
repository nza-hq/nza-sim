# Copied from nza-twin-lab @ 4da46dc (services/roof/roof/skeleton.py) on 2026-10-01. Diverged: no.
"""Hip and gable roofs on any simple polygon from CGAL's straight skeleton (Brief 07, Part 2).

The skeleton gives one face per contour edge with each vertex's offset `time`; the roof is
that face lifted at `z = eave + time · tan(pitch)` — a plane rising inward from its eave edge,
which is exactly what a hip roof is, and on a rectangle exactly the parametric hip (ridge
L − W, height (W/2)·tan θ). Reflex corners produce valleys with no height step by construction.

Gable ends (the recipe says `gable`): a straight skeleton hips every wing end. A wing end is a
contour edge whose skeleton face is a triangle (one apex). Gabling it drops the triangle and
extends the two neighbouring faces to the wall along the ridge: the ridge meets the wall at the
point of the end edge that is equidistant from the two side walls (the side walls' bisector),
lifted by that distance · tan(pitch) — a point that lies on BOTH side planes exactly, whatever
the end's angles, so the extended faces stay planar to the millimetre (the midpoint only does
when the end is rectangular; on OSM outlines it left 1–3 cm steps). A wing end is not gabled
when its edge touches a reflex corner, when its neighbour is itself a wing end (two gables at
one corner leave it unroofed), or when the bisector misses the end edge (a wedge-shaped end);
those stay hips and are counted in `GABLE_ENDS_APPROXIMATED`. Ridge hints (`ridge_axis`,
`ridge_bearing_deg`) apply on rectangles only; on other plans the skeleton decides.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from . import skel
from .geo import DEG, XY, XYZ, ensure_ccw, ensure_cw, face_record, open_ring

GABLE_MARGIN = 0.05  # the ridge must meet the end edge inside its middle 90 % to be gabled
EPS = 1e-6


@dataclass
class Constructed:
    faces: list[dict]
    flags: list[str] = field(default_factory=list)
    fell_back_to_flat: bool = False


def _same(a: XY, b: XY) -> bool:
    return math.hypot(a[0] - b[0], a[1] - b[1]) < EPS


def _is_reflex(prev: XY, cur: XY, nxt: XY) -> bool:
    return (cur[0] - prev[0]) * (nxt[1] - cur[1]) - (cur[1] - prev[1]) * (nxt[0] - cur[0]) < -1e-7


def flat_faces(footprint: list[XY], eave: float) -> list[dict]:
    """One deck over the outer ring (a footprint with holes goes through the skeleton at pitch 0)."""
    ring = open_ring(footprint)
    if len(ring) < 3:
        return []
    return [face_record("main", [(x, y, eave) for x, y in ring], "f0")]


def skeleton_faces(
    footprint: list[XY],
    pitch_deg: float,
    eave: float,
    gable: bool,
    holes: list[list[XY]] | None = None,
) -> Constructed:
    """Hip (or gable-ended) roof over the polygon. Raises skel.SkeletonError for an invalid one."""
    outer = ensure_ccw(open_ring(footprint))
    inner = [ensure_cw(open_ring(h)) for h in (holes or []) if len(open_ring(h)) >= 3]
    slope = math.tan(pitch_deg * DEG)
    regions = skel.interior_skeleton(outer, inner)

    n = len(outer)
    reflex = [_is_reflex(outer[i - 1], outer[i], outer[(i + 1) % n]) for i in range(n)]
    flags: list[str] = []

    # Which contour edge each region belongs to (its first two vertices), and whether that
    # edge touches a reflex corner of the OUTER ring (a hole's edges never gable).
    def outer_index(a: XY, b: XY) -> int | None:
        for i in range(n):
            if _same(outer[i], a) and _same(outer[(i + 1) % n], b):
                return i
        return None

    edge_of = [outer_index((r[0][0], r[0][1]), (r[1][0], r[1][1])) for r in regions]

    gabled: set[int] = set()  # region indices that become gable ends
    wall_xy: dict[int, tuple[XY, float]] = {}  # region → (ridge-meets-wall point, its offset distance)
    approximated = 0
    if gable:
        triangle_edges = {edge_of[k] for k, r in enumerate(regions) if len(r) == 3 and edge_of[k] is not None}
        for k, region in enumerate(regions):
            i = edge_of[k]
            if i is None or len(region) != 3:
                continue
            a, b = outer[i], outer[(i + 1) % n]
            prev, nxt = outer[i - 1], outer[(i + 2) % n]
            neighbours = {(i - 1) % n, (i + 1) % n}
            wall = _ridge_wall_point(prev, a, b, nxt)
            ok = (
                not (reflex[i] or reflex[(i + 1) % n])  # a wall at an inside corner has no ridge to run to
                and not (neighbours & triangle_edges)  # two gables meeting at a corner would leave it unroofed
                and wall is not None  # the side walls' bisector meets the end edge
            )
            if ok:
                gabled.add(k)
                wall_xy[k] = wall
            else:
                approximated += 1
    if approximated:
        flags.append(f"GABLE_ENDS_APPROXIMATED: {approximated}")

    # Lift. For a gabled region, its apex moves to the wall (the midpoint of the edge, same z),
    # and the two neighbouring regions gain that wall point between the edge endpoint and apex.
    lifted: list[list[XYZ] | None] = []
    wall_point: dict[int, XYZ] = {}
    for k in gabled:
        (wx, wy), d = wall_xy[k]
        wall_point[k] = (wx, wy, eave + d * slope)
    apex_of = {k: (regions[k][2][0], regions[k][2][1]) for k in gabled}

    for k, r in enumerate(regions):
        if k in gabled:
            lifted.append(None)
            continue
        ring: list[XYZ] = []

        def wall_between(q: XYZ, p: XYZ) -> XYZ | None:
            # The gable wall point belongs between an edge endpoint and that edge's apex.
            for g, apex in apex_of.items():
                ga, gb = regions[g][0], regions[g][1]
                ends = ((ga[0], ga[1]), (gb[0], gb[1]))
                qa, pa = _same((q[0], q[1]), apex), _same((p[0], p[1]), apex)
                if (qa and any(_same((p[0], p[1]), e) for e in ends)) or (pa and any(_same((q[0], q[1]), e) for e in ends)):
                    return wall_point[g]
            return None

        for x, y, t in r:
            p: XYZ = (x, y, eave + t * slope)
            if ring and gabled:
                w = wall_between(ring[-1], p)
                if w is not None:
                    ring.append(w)
            ring.append(p)
        if len(ring) > 2 and gabled:
            w = wall_between(ring[-1], ring[0])  # the closing edge
            if w is not None:
                ring.append(w)
        lifted.append(ring)

    faces: list[dict] = []
    for k, ring in enumerate(lifted):
        if ring is None:
            continue
        i = edge_of[k]
        touches_reflex = i is not None and (reflex[i] or reflex[(i + 1) % n])
        role = "valley" if touches_reflex else ("hip_end" if len(ring) == 3 else "main")
        faces.append(face_record(role, ring, f"f{k}"))
    return Constructed(faces=faces, flags=flags)


def _inward_dist(p: XY, a: XY, b: XY) -> float:
    """Signed distance from p to the line a→b, positive on its left (the CCW polygon's inside)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < EPS:
        return 0.0
    return ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / -length


def _ridge_wall_point(prev: XY, a: XY, b: XY, nxt: XY) -> tuple[XY, float] | None:
    """Where the two side walls' bisector meets the end edge a→b (side walls prev→a and b→nxt),
    with that point's distance from either side wall. None when it misses the edge's middle."""
    lo = hi = None
    for s in (0.0, 1.0):
        p = (a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]))
        diff = _inward_dist(p, prev, a) - _inward_dist(p, b, nxt)
        if s == 0.0:
            lo = diff
        else:
            hi = diff
    if lo is None or hi is None or lo == hi:
        return None
    s = lo / (lo - hi)  # the distances are linear along the edge
    if s < GABLE_MARGIN or s > 1 - GABLE_MARGIN:
        return None
    p = (a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]))
    d = _inward_dist(p, prev, a)
    return (p, d) if d > EPS else None
