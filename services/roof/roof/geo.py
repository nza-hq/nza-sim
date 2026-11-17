# Copied from nza-twin-lab @ 4da46dc (services/roof/roof/geo.py) on 2026-10-01. Diverged: no.
"""Face geometry, ported from packages/contract/src/geo.ts and orientedBox.ts (Brief 07).

Everything a constructed face carries besides its ring — area, tilt, azimuth, cardinal — is
computed here exactly as the TypeScript contract computes it, so the service's faces are the
contract's faces. Rings are Z-up local metres; a face ring is CCW seen from above (L17).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

XY = tuple[float, float]
XYZ = tuple[float, float, float]
Cardinal = Literal["N", "NE", "E", "SE", "S", "SW", "W", "NW", "flat"]
CARDINALS: tuple[Cardinal, ...] = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")

DEG = math.pi / 180


def signed_area_xy(ring: list[XY]) -> float:
    """Shoelace; positive for CCW."""
    a = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a / 2


def open_ring(ring: list[XY]) -> list[XY]:
    """Drop a duplicated closing vertex and zero-length repeats."""
    out: list[XY] = []
    for p in ring:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 1e-9:
            out.append((float(p[0]), float(p[1])))
    if len(out) > 1 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < 1e-9:
        out.pop()
    return out


def ensure_ccw(ring: list[XY]) -> list[XY]:
    return list(reversed(ring)) if signed_area_xy(ring) < 0 else list(ring)


def ensure_cw(ring: list[XY]) -> list[XY]:
    return list(reversed(ring)) if signed_area_xy(ring) > 0 else list(ring)


def newell_normal(verts: list[XYZ]) -> XYZ | None:
    if len(verts) < 3:
        return None
    nx = ny = nz = 0.0
    for i, a in enumerate(verts):
        b = verts[(i + 1) % len(verts)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    length = math.hypot(nx, ny, nz)
    if length < 1e-12:
        return None
    return (nx / length, ny / length, nz / length)


def polygon_3d_area(verts: list[XYZ]) -> float:
    """Newell's method: exact for any simple planar polygon."""
    if len(verts) < 3:
        return 0.0
    nx = ny = nz = 0.0
    for i, a in enumerate(verts):
        b = verts[(i + 1) % len(verts)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    return math.hypot(nx, ny, nz) / 2


def polygon_tilt_deg(verts: list[XYZ]) -> float:
    n = newell_normal(verts)
    if n is None:
        return 0.0
    return math.degrees(math.acos(min(1.0, max(0.0, abs(n[2])))))


def polygon_azimuth_deg(verts: list[XYZ]) -> float:
    """Down-slope direction, degrees from north (E = 90); 0 for flat. Winding-independent (F4)."""
    n = newell_normal(verts)
    if n is None:
        return 0.0
    up = -1.0 if n[2] < 0 else 1.0
    dx, dy = n[0] * up, n[1] * up
    if math.hypot(dx, dy) < 1e-9:
        return 0.0
    return (math.degrees(math.atan2(dx, dy)) + 360) % 360


def azimuth_to_cardinal(az: float) -> Cardinal:
    a = (az % 360 + 360) % 360
    return CARDINALS[round(a / 45) % 8]


def ccw_from_above(verts: list[XYZ]) -> list[XYZ]:
    """L17: every face ring is CCW seen from above (its Newell normal points up)."""
    n = newell_normal(verts)
    return list(reversed(verts)) if n is not None and n[2] < 0 else list(verts)


@dataclass(frozen=True)
class OrientedBox:
    center: XY
    length: float
    width: float
    rotation: float  # math angle (radians, CCW from world +X) of the long axis
    corners: tuple[XY, XY, XY, XY]


def _convex_hull(points: list[XY]) -> list[XY]:
    pts = sorted(set(points))
    if len(pts) <= 1:
        return pts

    def cross(o: XY, a: XY, b: XY) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[XY] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[XY] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _box_along_angle(points: list[XY], edge_angle: float) -> OrientedBox:
    cos, sin = math.cos(-edge_angle), math.sin(-edge_angle)
    xs = [p[0] * cos - p[1] * sin for p in points]
    ys = [p[0] * sin + p[1] * cos for p in points]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    w, h = max_x - min_x, max_y - min_y
    long_along_edge = w >= h
    length, width = (w, h) if long_along_edge else (h, w)
    rotation = edge_angle if long_along_edge else edge_angle + math.pi / 2
    dcx, dcy = (min_x + max_x) / 2, (min_y + max_y) / 2
    cb, sb = math.cos(edge_angle), math.sin(edge_angle)
    center = (dcx * cb - dcy * sb, dcx * sb + dcy * cb)
    corners = tuple(
        (px * cb - py * sb, px * sb + py * cb)
        for px, py in ((min_x, min_y), (max_x, min_y), (max_x, max_y), (min_x, max_y))
    )
    return OrientedBox(center, length, width, rotation, corners)  # type: ignore[arg-type]


def oriented_bounding_box(points: list[XY]) -> OrientedBox:
    """Minimum-area rectangle over the points (rotating calipers on the hull), as the contract."""
    if len(points) < 3:
        p = points[0] if points else (0.0, 0.0)
        return OrientedBox(p, 0.0, 0.0, 0.0, (p, p, p, p))
    hull = _convex_hull(points)
    best: OrientedBox | None = None
    for i, a in enumerate(hull):
        b = hull[(i + 1) % len(hull)]
        box = _box_along_angle(points, math.atan2(b[1] - a[1], b[0] - a[0]))
        if best is None or box.length * box.width < best.length * best.width:
            best = box
    return best if best is not None else _box_along_angle(points, 0.0)


def box_to_world(p: XY, box: OrientedBox) -> XY:
    cos, sin = math.cos(box.rotation), math.sin(box.rotation)
    return (box.center[0] + p[0] * cos - p[1] * sin, box.center[1] + p[0] * sin + p[1] * cos)


def is_rectangular(footprint: list[XY], tol_deg: float = 1.0) -> bool:
    """Exactly 4 corners, each 90° ± tol (route.ts Decision A) — at any rotation."""
    p = open_ring(footprint)
    if len(p) != 4:
        return False
    for i in range(4):
        prev, cur, nxt = p[(i + 3) % 4], p[i], p[(i + 1) % 4]
        v1 = (prev[0] - cur[0], prev[1] - cur[1])
        v2 = (nxt[0] - cur[0], nxt[1] - cur[1])
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        if l1 < 1e-6 or l2 < 1e-6:
            return False
        cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)
        if abs(math.acos(max(-1.0, min(1.0, cos))) - math.pi / 2) > tol_deg * DEG:
            return False
    return True


def face_record(role: str, ring: list[XYZ], face_id: str) -> dict:
    """A contract RoofFace from a world ring: CCW from above, with its derived fields. Skeleton
    vertices that are collinear along a ridge are kept on purpose: a neighbour across the ridge
    may meet it there, and dropping them one face at a time tears the 3D closure (T20)."""
    verts = ccw_from_above(ring)
    tilt = polygon_tilt_deg(verts)
    az = polygon_azimuth_deg(verts)
    return {
        "id": face_id,
        "role": role,
        "cardinal": "flat" if tilt < 1 else azimuth_to_cardinal(az),
        "geometry": [[round(x, 6), round(y, 6), round(z, 6)] for x, y, z in verts],
        "area_m2": round(polygon_3d_area(verts), 1),
        "tilt_deg": round(tilt, 1),
        "azimuth_deg": round(az) % 360,
    }
