# Copied from nza-twin-lab @ 4da46dc (services/roof/tests/conftest.py) on 2026-10-01. Diverged: no.
"""Build and run the straight-skeleton binary once before any test. It is not in git (skel/skel
is ignored), so a fresh checkout compiles it on the first request — ~40 s, 88 s on a loaded
machine — and even once built, the first spawn of a cold binary took 1.0 s under load. A test
that times a request (test_api: ms < 500) would fail once for no reason of its own. This is what
/health does when a live service starts. Imports: pytest, roof.skel (cgal_version)."""

import pytest

from roof import skel


@pytest.fixture(scope="session", autouse=True)
def skeleton_binary() -> None:
    skel.cgal_version()  # ensure_built(), then one run
