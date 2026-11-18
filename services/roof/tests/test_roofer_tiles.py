"""Brief 56 Part 2.1: the EA index answer → the survey per tile. The fixture is the index's own answer for a
box round Finham Park on 27 Oct 2026 (tests/fixtures/roofer/ea-search-finham.json), recorded with curl; the
test never touches the network."""

import json
from pathlib import Path

from roofer import tiles

FIX = Path(__file__).parent / "fixtures" / "roofer" / "ea-search-finham.json"


def test_point_cloud_rows_are_flattened():
    rows = tiles.point_cloud_results(json.loads(FIX.read_text()))
    assert rows, "the fixture holds point-cloud rows"
    assert all(r["product"] in tiles.POINT_CLOUDS for r in rows)
    nlp = [r for r in rows if r["product"] == tiles.NLP]
    assert nlp and nlp[0]["tile"] == "SP3075" and nlp[0]["year"] == "2021" and nlp[0]["resolution"] == "1"
    assert nlp[0]["uri"] == "https://environment.data.gov.uk/tiles/collections/survey/national_lidar_programme_point_cloud/2021/1/SP3075"


def test_pick_survey_prefers_the_newest_national_programme_year():
    rows = tiles.point_cloud_results(json.loads(FIX.read_text()))
    s = tiles.pick_survey(rows)
    assert [t["tile"] for t in s["tiles"]] == ["SP3075"]
    assert s["tiles"][0]["product"] == tiles.NLP and s["tiles"][0]["year"] == "2021"
    assert s["label"] == "national_lidar_programme_point_cloud 2021"


def test_pick_survey_falls_back_to_the_older_point_cloud():
    rows = [
        {"product": tiles.OLDER, "year": "2010", "resolution": "NaN", "tile": "SX9192", "tile_label": "SX91nw", "label": "a", "uri": "u1"},
        {"product": tiles.OLDER, "year": "2017", "resolution": "NaN", "tile": "SX9192", "tile_label": "SX91nw", "label": "b", "uri": "u2"},
        {"product": tiles.NLP, "year": "2020", "resolution": "1", "tile": "SX9193", "tile_label": "SX91ne", "label": "c", "uri": "u3"},
    ]
    s = tiles.pick_survey(rows)
    by = {t["tile"]: t for t in s["tiles"]}
    assert by["SX9192"]["year"] == "2017" and by["SX9192"]["product"] == tiles.OLDER
    assert by["SX9193"]["year"] == "2020" and by["SX9193"]["product"] == tiles.NLP
    assert s["label"] == "lidar_point_cloud 2017 + national_lidar_programme_point_cloud 2020"


def test_candidates_per_tile_walk_newest_first_then_older_collections():
    """A listed tile can answer 404 (TL1595 NLP 2019, run 40482803562): the job walks the candidates in this order."""
    rows = [
        {"product": tiles.OLDER, "year": "2017", "resolution": "NaN", "tile": "TL1595", "tile_label": "TL19ne", "label": "o17", "uri": "u1"},
        {"product": tiles.NLP, "year": "2019", "resolution": "1", "tile": "TL1595", "tile_label": "TL19ne", "label": "n19", "uri": "u2"},
        {"product": tiles.NLP, "year": "2022", "resolution": "1", "tile": "TL1595", "tile_label": "TL19ne", "label": "n22", "uri": "u3"},
        {"product": tiles.OLDER, "year": "2010", "resolution": "NaN", "tile": "TL1595", "tile_label": "TL19ne", "label": "o10", "uri": "u4"},
    ]
    c = tiles.candidates_per_tile(rows)
    assert [r["label"] for r in c["TL1595"]] == ["n22", "n19", "o17", "o10"]
    s = tiles.pick_survey(rows)
    assert s["tiles"][0]["label"] == "n22" and s["candidates"]["TL1595"][1]["label"] == "n19"


def test_tile_dir_is_a_safe_name(tmp_path):
    d = tiles.tile_dir(tmp_path, {"product": tiles.NLP, "year": "2021", "resolution": "1", "tile": "SP3075"})
    assert d.name == "national_lidar_programme_point_cloud-2021-1-SP3075"
    assert d.parent == tmp_path / "tiles"
