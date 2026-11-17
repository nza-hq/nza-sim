"""Brief 56 Part 2.3: roofer's CityJSONSeq → triangles and rows. The fixture is two buildings (os000 flat,
os001 slanted) cut from the spike's committed Finham run C (nza-roofer-spike @ 1bb9196,
results/cityjson/run_C.city.jsonl) — roofer's output, read the way run_site.py read it. Skipped where the
job's libraries are not installed (a laptop's roof env); the image has them."""

import json
from pathlib import Path

import pytest

from roofer import NODATA_FLOOR, cityjson, deps_available

FIX = Path(__file__).parent / "fixtures" / "roofer" / "finham-run_C-slice.city.jsonl"
needs_deps = pytest.mark.skipif(not deps_available()[0], reason=f"roofer job deps missing: {deps_available()[1]}")


@needs_deps
def test_read_run_gives_triangles_in_absolute_27700(tmp_path):
    (tmp_path / "x.city.jsonl").write_text(FIX.read_text())
    m = cityjson.read_run(str(tmp_path))
    assert set(m) >= {"os000", "os001"}
    # os000 is the block built after the survey (spike Rev B): an LoD0 outline and no LoD2.2 mesh
    assert m["os000"]["tris"] == [] and m["os000"]["attrs"]["rf_roof_type"] == "horizontal"
    # os001 is the main block (5,474 m² outline): roofer calls it "slanted", its roof area is 99 % under 5°
    main = m["os001"]
    assert main["attrs"]["rf_roof_type"] == "slanted"
    assert len(main["tris"]) == 328 and sum(main["roof"]) == 94
    # absolute coordinates: Finham's SP37nw tile, metres, heights AOD (roofer's floor there is 82.5 m)
    x, y, z = main["tris"][0][:3]
    assert 432000 < x < 432500 and 275500 < y < 276000 and 70 < z < 120
    assert main["pitched_frac"] == 0.01, "the share of roof area tilted over 5°"
    assert main["mean_pitch"] is not None and 5 < main["mean_pitch"] < 10, "the area-weighted tilt of that share"
    assert 5000 < main["roof_area_m2"] < 6000


@needs_deps
def test_rows_follow_the_field_dictionary(tmp_path):
    (tmp_path / "x.city.jsonl").write_text(FIX.read_text())
    m = cityjson.read_run(str(tmp_path))
    fps = [{"id": "os001", "area_m2": 523.4}, {"id": "os000", "area_m2": 853.0}, {"id": "os999", "area_m2": 40.0}]
    diag = {"os001": {"dens": 2.8, "raised_pct": 90, "c6_dens": 2.1}, "os000": {"dens": 1.0, "raised_pct": 0, "c6_dens": 0.0}, "os999": {"dens": 0.1, "raised_pct": 0, "c6_dens": 0.0}}
    rows, nodata = cityjson.rows_for(fps, m, diag, {"os001": 0.6, "os000": None, "os999": None}, ground_z=80.8)
    assert [r["id"] for r in rows] == ["os000", "os001", "os999"], "largest first"
    by = {r["id"]: r for r in rows}
    assert by["os001"]["outcome"] == "LoD2.2 flat/stepped" and by["os001"]["roof_type"] == "slanted"
    assert by["os001"]["rmse_lod22"] == 0.44 and by["os001"]["bld_dens"] == 2.1 and by["os001"]["ground_fall_m"] == 0.6
    assert by["os001"]["h_ridge"] is None, "run C carries no rf_h_roof_ridge"
    assert by["os001"]["h_ground_aod"] == 82.5 and by["os001"]["roof_area_m2"] > 5000
    assert by["os000"]["outcome"] == "no model" and by["os000"]["roof_type"] == "horizontal"
    assert by["os999"]["outcome"] == "no model" and by["os999"]["roof_type"] is None
    assert set(by["os001"]) >= {"id", "area_m2", "outcome", "roof_type", "pitched_frac", "mean_pitch", "rmse_lod22", "dens", "bld_dens", "raised_pct", "h_ridge", "ground_fall_m"}
    assert nodata == []


def test_nodata_floor_is_guarded():
    assert cityjson._guard(NODATA_FLOOR) is None
    assert cityjson._guard(-2147545.0) is None
    assert cityjson._guard("x") is None
    assert cityjson._guard(84.69) == 84.69
    rows, nodata = cityjson.rows_for(
        [{"id": "t1", "area_m2": 100}],
        {"t1": {"attrs": {"rf_h_roof_ridge": NODATA_FLOOR, "rf_h_ground": 12.0, "rf_rmse_lod22": 0.3}, "tris": [[0] * 9], "roof": [1], "pitched_frac": 0.0, "mean_pitch": None, "roof_area_m2": 1.0}},
        {"t1": {"dens": 1, "raised_pct": 50, "c6_dens": 1}},
        {},
        10.0,
    )
    assert rows[0]["h_ridge"] is None and rows[0]["h_ground_aod"] == 12.0
    assert nodata == ["t1"]


def test_fixture_is_cityjsonseq():
    lines = FIX.read_text().splitlines()
    head = json.loads(lines[0])
    assert head["type"] == "CityJSON" and head["metadata"]["referenceSystem"].endswith("/27700")
    assert all(json.loads(l)["type"] == "CityJSONFeature" for l in lines[1:])
