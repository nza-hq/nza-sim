"""7 Nov 2026: the tile cache has a ceiling. Free measured roofs for small sites fetch a 60–220 MB EA tile per new
area; without a ceiling the 10 GB disk fills. Past it, the tiles used longest ago go first; a job's own tiles never."""

import os
import time

from roofer import tiles


def _tile(root, name, mb, used_ago_s, done=True):
    d = root / "tiles" / name
    d.mkdir(parents=True)
    (d / "a.laz").write_bytes(b"\0" * int(mb * 1024 * 1024))
    t = time.time() - used_ago_s
    if done:
        (d / ".done").write_text("x")
        os.utime(d / ".done", (t, t))
        (d / ".used").touch()
        os.utime(d / ".used", (t, t))
    os.utime(d, (t, t))
    return d


def test_the_tiles_used_longest_ago_go_first_until_there_is_room(tmp_path):
    old = _tile(tmp_path, "old", 3, 300)
    mid = _tile(tmp_path, "mid", 3, 200)
    new = _tile(tmp_path, "new", 3, 100)
    mb = 1024 * 1024
    out = tiles.make_room(tmp_path, need=2 * mb, limit=10 * mb, log=lambda *_: None)
    assert out["deleted"] == 1 and not old.exists() and mid.exists() and new.exists()


def test_a_tile_in_use_by_this_job_is_never_deleted(tmp_path):
    old = _tile(tmp_path, "old", 3, 300)
    mid = _tile(tmp_path, "mid", 3, 200)
    mb = 1024 * 1024
    tiles.make_room(tmp_path, keep={str(old)}, need=4 * mb, limit=6 * mb, log=lambda *_: None)
    assert old.exists() and not mid.exists()


def test_under_the_ceiling_nothing_is_deleted_and_a_dead_download_always_is(tmp_path):
    keep = _tile(tmp_path, "keep", 1, 300)
    dead = _tile(tmp_path, "dead", 1, tiles.STALE_PART_S + 60, done=False)
    out = tiles.make_room(tmp_path, need=0, limit=100 * 1024 * 1024, log=lambda *_: None)
    assert keep.exists() and not dead.exists() and out["deleted"] == 1


def test_a_cache_hit_marks_the_tile_as_used(tmp_path):
    row = {"product": "p", "year": "2021", "resolution": "1", "tile": "SP3075"}
    d = tiles.tile_dir(tmp_path, row)
    d.mkdir(parents=True)
    (d / ".done").write_text("x")
    t = time.time() - 1000
    os.utime(d / ".done", (t, t))
    got = tiles.fetch_tile(row, tmp_path, log=lambda *_: None)
    assert got["cached"] is True
    assert time.time() - (d / ".used").stat().st_mtime < 60
