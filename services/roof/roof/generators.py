# Copied from nza-twin-lab @ 4da46dc (services/roof/roof/generators.py) on 2026-10-01. Diverged: no.
"""The 14 parametric roof shapes on a rectangle — a port of packages/roof/src/generators.ts
(itself nza-pv's generators, with the Brief 03 D13 / F2 / F3 edits). Same shapes, same
parameters, same face roles, same trig; each returns faces in OBB-local metres (+X along the
long axis, +Y across, +Z up) that regenerate.py-style glue maps to world metres.

Ported on 27 Sep 2026 (Brief 07, Part 3). Divergences: none in the trig; `flat` ignores the
parapet as the TypeScript does since D13 (render closes walls)."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .geo import DEG, XYZ, OrientedBox, box_to_world, face_record, oriented_bounding_box

ROOF_SHAPES = (
    "flat", "mono", "gable", "hip", "half_hip", "dutch_hip", "gambrel", "mansard", "saltbox",
    "sawtooth", "butterfly", "pyramid", "cross_gabled", "parallel_gables",
)
FACE_ROLES = (
    "main", "hip_end", "gable_end_wall", "dormer", "sawtooth_pitch", "sawtooth_glazing",
    "mansard_lower", "mansard_upper", "gambrel_lower", "gambrel_upper", "valley",
)


@dataclass(frozen=True)
class Input:
    half_l: float
    half_w: float
    eave: float
    box_rotation: float


LocalFace = tuple[str, list[XYZ]]


def _bearing_is_along_long_axis(bearing_deg: float, box_rotation: float) -> bool:
    bearing_math = math.pi / 2 - bearing_deg * DEG
    diff = ((bearing_math - box_rotation) % math.pi + math.pi) % math.pi
    if diff > math.pi / 2:
        diff = math.pi - diff
    return diff <= math.pi / 4


def _inverted_enum(roof: dict) -> bool:
    return roof["style"] in ("parallel_gables", "sawtooth")


def _rotated(roof: dict, box_rotation: float) -> str:
    """Precedence: ridge_bearing_deg (world) → legacy ridge_axis / orientation → 'longest'."""
    if isinstance(roof.get("ridge_bearing_deg"), (int, float)):
        along = _bearing_is_along_long_axis(float(roof["ridge_bearing_deg"]), box_rotation)
        if _inverted_enum(roof):
            return "shortest" if along else "longest"
        return "longest" if along else "shortest"
    if roof.get("ridge_axis") == "shortest" or roof.get("orientation") == "shortest":
        return "shortest"
    return "longest"


def _rect(hl: float, hw: float, z: float) -> list[XYZ]:
    return [(-hl, -hw, z), (hl, -hw, z), (hl, hw, z), (-hl, hw, z)]


def _rotate_z(p: XYZ, rad: float) -> XYZ:
    c, s = math.cos(rad), math.sin(rad)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2])


def _with_orientation(inp: Input, orientation: str, gen) -> list[LocalFace]:
    if orientation != "shortest":
        return gen(inp)
    swapped = Input(inp.half_w, inp.half_l, inp.eave, inp.box_rotation)
    return [(role, [_rotate_z(p, math.pi / 2) for p in ring]) for role, ring in gen(swapped)]


# --- shapes ------------------------------------------------------------------------------


def flat(i: Input, parapet: float) -> list[LocalFace]:
    return [("main", _rect(i.half_l, i.half_w, i.eave))]


def _high_bearing(high_side) -> float:
    if isinstance(high_side, (int, float)):
        return float(high_side) * DEG
    return {"N": 0.0, "E": math.pi / 2, "S": math.pi, "W": math.pi * 1.5}[high_side]


def mono(i: Input, pitch: float, high_side) -> list[LocalFace]:
    wb = _high_bearing(high_side)
    wx, wy = math.sin(wb), math.cos(wb)
    c, s = math.cos(i.box_rotation), math.sin(i.box_rotation)
    hx, hy = wx * c + wy * s, -wx * s + wy * c
    corners = [(-i.half_l, -i.half_w), (i.half_l, -i.half_w), (i.half_l, i.half_w), (-i.half_l, i.half_w)]
    projs = [x * hx + y * hy for x, y in corners]
    lo, hi = min(projs), max(projs)
    rng = (hi - lo) or 1.0
    rise = rng * math.tan(pitch * DEG)
    return [("main", [(x, y, i.eave + (p - lo) / rng * rise) for (x, y), p in zip(corners, projs)])]


def gable(i: Input, pitch: float) -> list[LocalFace]:
    z0, z1 = i.eave, i.eave + i.half_w * math.tan(pitch * DEG)
    hl, hw = i.half_l, i.half_w
    return [
        ("main", [(-hl, 0, z1), (hl, 0, z1), (hl, hw, z0), (-hl, hw, z0)]),
        ("main", [(-hl, -hw, z0), (hl, -hw, z0), (hl, 0, z1), (-hl, 0, z1)]),
    ]


def pyramid(i: Input, pitch: float) -> list[LocalFace]:
    hl, hw = i.half_l, i.half_w
    apex: XYZ = (0, 0, i.eave + min(hl, hw) * math.tan(pitch * DEG))
    e = i.eave
    return [
        ("main", [(-hl, hw, e), (hl, hw, e), apex]),
        ("main", [(hl, -hw, e), (-hl, -hw, e), apex]),
        ("hip_end", [(hl, hw, e), (hl, -hw, e), apex]),
        ("hip_end", [(-hl, -hw, e), (-hl, hw, e), apex]),
    ]


def hip(i: Input, pitch: float) -> list[LocalFace]:
    hl, hw = i.half_l, i.half_w
    if hw >= hl:
        return pyramid(i, pitch)
    z0, z1 = i.eave, i.eave + hw * math.tan(pitch * DEG)
    rh = hl - hw
    return [
        ("main", [(-rh, 0, z1), (rh, 0, z1), (hl, hw, z0), (-hl, hw, z0)]),
        ("main", [(-hl, -hw, z0), (hl, -hw, z0), (rh, 0, z1), (-rh, 0, z1)]),
        ("hip_end", [(hl, -hw, z0), (hl, hw, z0), (rh, 0, z1)]),
        ("hip_end", [(-hl, hw, z0), (-hl, -hw, z0), (-rh, 0, z1)]),
    ]


def half_hip(i: Input, pitch: float, hipped_end: str) -> list[LocalFace]:
    hl, hw = i.half_l, i.half_w
    if hw >= hl:
        return hip(i, pitch)
    z0, z1 = i.eave, i.eave + hw * math.tan(pitch * DEG)
    rh = hl - hw
    faces: list[LocalFace] = [
        ("main", [(-hl, 0, z1), (rh, 0, z1), (hl, hw, z0), (-hl, hw, z0)]),
        ("main", [(-hl, -hw, z0), (hl, -hw, z0), (rh, 0, z1), (-hl, 0, z1)]),
        ("hip_end", [(hl, -hw, z0), (hl, hw, z0), (rh, 0, z1)]),
    ]
    if hipped_end == "end":
        return faces
    return [(role, [(-x, y, z) for x, y, z in reversed(ring)]) for role, ring in faces]


def dutch_hip(i: Input, pitch: float, hip_ratio: float) -> list[LocalFace]:
    hl, hw = i.half_l, i.half_w
    z0, z1 = i.eave, i.eave + hw * math.tan(pitch * DEG)
    hip_part = min(hl * 0.45, hw * hip_ratio * 2)
    rh = max(0.1, hl - hip_part)
    return [
        ("main", [(-rh, 0, z1), (rh, 0, z1), (hl, hw, z0), (-hl, hw, z0)]),
        ("main", [(-hl, -hw, z0), (hl, -hw, z0), (rh, 0, z1), (-rh, 0, z1)]),
        ("hip_end", [(hl, -hw, z0), (hl, hw, z0), (rh, 0, z1)]),
        ("hip_end", [(-hl, hw, z0), (-hl, -hw, z0), (-rh, 0, z1)]),
    ]


def gambrel(i: Input, lower: float, upper: float, break_h: float) -> list[LocalFace]:
    hl, hw = i.half_l, i.half_w
    z0, z1 = i.eave, i.eave + break_h
    break_y = hw - break_h / math.tan(lower * DEG)
    if break_y <= 0.05:
        return gable(i, lower)
    z2 = z1 + break_y * math.tan(upper * DEG)
    return [
        ("gambrel_lower", [(-hl, break_y, z1), (hl, break_y, z1), (hl, hw, z0), (-hl, hw, z0)]),
        ("gambrel_lower", [(-hl, -hw, z0), (hl, -hw, z0), (hl, -break_y, z1), (-hl, -break_y, z1)]),
        ("gambrel_upper", [(-hl, 0, z2), (hl, 0, z2), (hl, break_y, z1), (-hl, break_y, z1)]),
        ("gambrel_upper", [(-hl, -break_y, z1), (hl, -break_y, z1), (hl, 0, z2), (-hl, 0, z2)]),
    ]


def mansard(i: Input, lower: float, upper: float, break_h: float) -> list[LocalFace]:
    hl, hw = i.half_l, i.half_w
    z0, z1 = i.eave, i.eave + break_h
    run = break_h / math.tan(lower * DEG)
    il, iw = max(0.1, hl - run), max(0.1, hw - run)
    z2 = z1 + iw * math.tan(upper * DEG)
    ur = max(0.0, il - iw)
    return [
        ("mansard_lower", [(-il, iw, z1), (il, iw, z1), (hl, hw, z0), (-hl, hw, z0)]),
        ("mansard_lower", [(-hl, -hw, z0), (hl, -hw, z0), (il, -iw, z1), (-il, -iw, z1)]),
        ("mansard_lower", [(hl, -hw, z0), (hl, hw, z0), (il, iw, z1), (il, -iw, z1)]),
        ("mansard_lower", [(-hl, hw, z0), (-hl, -hw, z0), (-il, -iw, z1), (-il, iw, z1)]),
        ("mansard_upper", [(-ur, 0, z2), (ur, 0, z2), (il, iw, z1), (-il, iw, z1)]),
        ("mansard_upper", [(-il, -iw, z1), (il, -iw, z1), (ur, 0, z2), (-ur, 0, z2)]),
        ("mansard_upper", [(il, -iw, z1), (il, iw, z1), (ur, 0, z2)]),
        ("mansard_upper", [(-il, iw, z1), (-il, -iw, z1), (-ur, 0, z2)]),
    ]


def saltbox(i: Input, front: float, back: float, offset_pct: float) -> list[LocalFace]:
    hl, hw = i.half_l, i.half_w
    z0 = i.eave
    ridge_y = offset_pct / 100 * hw * 0.9
    front_half, back_half = hw + ridge_y, hw - ridge_y
    front_rise = min(front_half, hw) * math.tan(front * DEG)
    back_rise = min(back_half, hw) * math.tan(back * DEG)
    z1 = i.eave + max(front_rise, back_rise)
    return [
        ("main", [(-hl, ridge_y, z1), (hl, ridge_y, z1), (hl, hw, z0), (-hl, hw, z0)]),
        ("main", [(-hl, -hw, z0), (hl, -hw, z0), (hl, ridge_y, z1), (-hl, ridge_y, z1)]),
    ]


def sawtooth(i: Input, count: int, pitch: float, glazing_w: float) -> list[LocalFace]:
    hl, hw = i.half_l, i.half_w
    count = max(2, int(count))
    bay = 2 * hl / count
    faces: list[LocalFace] = []
    for k in range(count):
        x0 = -hl + k * bay
        x1 = x0 + bay - glazing_w
        x2 = x0 + bay
        z_low, z_high = i.eave, i.eave + bay * math.tan(pitch * DEG)
        faces.append(("sawtooth_pitch", [(x0, -hw, z_low), (x1, -hw, z_high), (x1, hw, z_high), (x0, hw, z_low)]))
        faces.append(("sawtooth_glazing", [(x1, -hw, z_high), (x2, -hw, z_low), (x2, hw, z_low), (x1, hw, z_high)]))
    return faces


def parallel_gables(i: Input, count: int, pitch: float) -> list[LocalFace]:
    hl, hw = i.half_l, i.half_w
    bays = max(2, int(count))
    bay = 2 * hl / bays
    half_bay = bay / 2
    z1 = i.eave + half_bay * math.tan(pitch * DEG)
    faces: list[LocalFace] = []
    for k in range(bays):
        x0 = -hl + k * bay
        xm = x0 + half_bay
        x2 = x0 + bay
        faces.append(("main", [(x0, -hw, i.eave), (xm, -hw, z1), (xm, hw, z1), (x0, hw, i.eave)]))
        faces.append(("main", [(xm, -hw, z1), (x2, -hw, i.eave), (x2, hw, i.eave), (xm, hw, z1)]))
    return faces


def butterfly(i: Input, pitch: float, valley_depth: float) -> list[LocalFace]:
    hl, hw = i.half_l, i.half_w
    half_rise = hw * math.tan(pitch * DEG)
    valley_z = i.eave
    eave_top = i.eave + half_rise + max(0.0, valley_depth)
    return [
        ("main", [(-hl, 0, valley_z), (hl, 0, valley_z), (hl, hw, eave_top), (-hl, hw, eave_top)]),
        ("main", [(-hl, -hw, eave_top), (hl, -hw, eave_top), (hl, 0, valley_z), (-hl, 0, valley_z)]),
    ]


def cross_gabled(i: Input, pitch: float) -> list[LocalFace]:
    hl, w = i.half_l, i.half_w
    z0, z1 = i.eave, i.eave + w * math.tan(pitch * DEG)
    return [
        ("main", [(-hl, 0, z1), (hl, 0, z1), (hl, w, z0), (w, w, z0), (0, 0, z1), (-w, w, z0), (-hl, w, z0)]),
        ("main", [(-hl, -w, z0), (-w, -w, z0), (0, 0, z1), (w, -w, z0), (hl, -w, z0), (hl, 0, z1), (-hl, 0, z1)]),
        ("main", [(0, 0, z1), (0, -w, z1), (w, -w, z0)]),
        ("main", [(0, 0, z1), (w, w, z0), (0, w, z1)]),
        ("main", [(0, 0, z1), (0, w, z1), (-w, w, z0)]),
        ("main", [(0, 0, z1), (-w, -w, z0), (0, -w, z1)]),
    ]


def generate(roof: dict, i: Input) -> list[LocalFace]:
    s = roof["style"]
    r = i.box_rotation
    o = _rotated(roof, r)
    if s == "flat":
        return flat(i, float(roof.get("parapet_height_m", 0)))
    if s == "mono":
        return mono(i, float(roof["pitch_deg"]), roof["high_side"])
    if s == "gable":
        return _with_orientation(i, o, lambda x: gable(x, float(roof["pitch_deg"])))
    if s == "hip":
        return _with_orientation(i, o, lambda x: hip(x, float(roof["pitch_deg"])))
    if s == "half_hip":
        return _with_orientation(i, o, lambda x: half_hip(x, float(roof["pitch_deg"]), roof["hipped_end"]))
    if s == "dutch_hip":
        return _with_orientation(i, o, lambda x: dutch_hip(x, float(roof["pitch_deg"]), float(roof["hip_ratio"])))
    if s == "gambrel":
        return _with_orientation(i, o, lambda x: gambrel(x, float(roof["lower_pitch_deg"]), float(roof["upper_pitch_deg"]), float(roof["break_height_m"])))
    if s == "mansard":
        return _with_orientation(i, o, lambda x: mansard(x, float(roof["lower_pitch_deg"]), float(roof["upper_pitch_deg"]), float(roof["break_height_m"])))
    if s == "saltbox":
        return _with_orientation(i, o, lambda x: saltbox(x, float(roof["front_pitch_deg"]), float(roof["back_pitch_deg"]), float(roof["ridge_offset_pct"])))
    if s == "sawtooth":
        return _with_orientation(i, o, lambda x: sawtooth(x, int(roof["pitch_count"]), float(roof["pitch_deg"]), float(roof["glazing_strip_width_m"])))
    if s == "butterfly":
        return _with_orientation(i, o, lambda x: butterfly(x, float(roof["pitch_deg"]), float(roof["valley_depth_m"])))
    if s == "pyramid":
        return pyramid(i, float(roof["pitch_deg"]))
    if s == "cross_gabled":
        return cross_gabled(i, float(roof["pitch_deg"]))
    if s == "parallel_gables":
        return _with_orientation(i, o, lambda x: parallel_gables(x, int(roof["pitch_count"]), float(roof["pitch_deg"])))
    raise ValueError(f"unknown roof style {s!r}")


def parametric_faces(footprint, roof: dict, eave: float) -> list[dict]:
    """The regenerate.ts glue: OBB of the footprint → generator → world faces with metadata."""
    box: OrientedBox = oriented_bounding_box([tuple(p) for p in footprint])
    hl, hw = box.length / 2, box.width / 2
    if hl <= 0 or hw <= 0:
        return []
    local = generate(roof, Input(hl, hw, eave, box.rotation))
    faces = []
    for k, (role, ring) in enumerate(local):
        world = [(*box_to_world((x, y), box), z) for x, y, z in ring]
        faces.append(face_record(role, world, f"p{k}"))
    return faces
