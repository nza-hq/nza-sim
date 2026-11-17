"""Brief 195 (4 Nov 2026): each straight-skeleton run has a memory cap and a time limit, so one polygon CGAL cannot
finish fails alone (that section flat and flagged) and never takes the service's memory. The stand-in binaries
below stand for a run that never ends and a run that keeps allocating."""

from __future__ import annotations

import sys

import pytest

from roof import skel
from roof.route import construct

SQUARE = [(0.0, 0.0), (20.0, 0.0), (20.0, 10.0), (0.0, 10.0)]
L24 = [(0.0, 0.0), (24.0, 0.0), (24.0, 6.0), (12.0, 6.0), (12.0, 12.0), (0.0, 12.0)]  # not a rectangle: a skeleton


def _stand_in(tmp_path, body: str):
    p = tmp_path / "skel-stand-in"
    p.write_text(f"#!{sys.executable}\n{body}\n")
    p.chmod(0o755)
    return p


@pytest.mark.skipif(sys.platform == "win32", reason="the memory cap is a POSIX rlimit")
def test_a_skeleton_that_keeps_allocating_stops_at_its_cap(tmp_path, monkeypatch):
    hog = _stand_in(tmp_path, "x = []\nwhile True:\n    x.append(bytearray(8 * 1024 * 1024))")
    monkeypatch.setattr(skel, "ensure_built", lambda: hog)
    monkeypatch.setattr(skel, "SKEL_MEMORY_MB", 100)
    with pytest.raises(skel.SkeletonError, match="went over its 100 MB"):
        skel.interior_skeleton(SQUARE)


def test_a_skeleton_that_never_ends_stops_at_its_time_limit(tmp_path, monkeypatch):
    sleeper = _stand_in(tmp_path, "import time\ntime.sleep(60)")
    monkeypatch.setattr(skel, "ensure_built", lambda: sleeper)
    monkeypatch.setattr(skel, "SKEL_TIMEOUT_S", 0.5)
    with pytest.raises(skel.SkeletonError, match="took over 0.5 s"):
        skel.weighted_skeleton(SQUARE, [30.0] * 4)


def test_that_section_is_drawn_flat_and_flagged_the_rest_still_build(tmp_path, monkeypatch):
    sleeper = _stand_in(tmp_path, "import time\ntime.sleep(60)")
    real = skel.ensure_built()
    monkeypatch.setattr(skel, "SKEL_TIMEOUT_S", 0.5)
    monkeypatch.setattr(skel, "ensure_built", lambda: sleeper)
    out = construct(L24, {"style": "hip", "pitch_deg": 30}, 6.0)
    assert out.fell_back_to_flat and out.faces
    assert out.flags[0].startswith("INVALID_POLYGON: skel took over 0.5 s")
    monkeypatch.setattr(skel, "ensure_built", lambda: real)
    assert not construct(L24, {"style": "hip", "pitch_deg": 30}, 6.0).fell_back_to_flat
