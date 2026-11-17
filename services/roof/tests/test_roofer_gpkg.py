"""Brief 56 D3: decodED's footprints as the GeoPackage roofer reads, written without GDAL. The round trip
reads the same bytes src/twin/roofer/spike.ts `gpkgRings` parses (magic GP, flags, envelope, ISO WKB)."""

import sqlite3

from roofer import gpkg

SQUARE = [[(432200.0, 275700.0), (432220.0, 275700.0), (432220.0, 275710.0), (432200.0, 275710.0)]]
HOLED = [[(0.0, 0.0), (30.0, 0.0), (30.0, 30.0), (0.0, 30.0)], [(10.0, 10.0), (20.0, 10.0), (20.0, 20.0), (10.0, 20.0)]]


def test_round_trip_keeps_ids_rings_and_closes_them(tmp_path):
    p = tmp_path / "fp.gpkg"
    n = gpkg.write_footprints(p, [{"id": "osm:way:1", "rings": SQUARE}, {"id": "osm:way:2", "rings": HOLED}])
    assert n == 2
    back = {f["id"]: f["rings"] for f in gpkg.read_rings(p)}
    assert set(back) == {"osm:way:1", "osm:way:2"}
    assert back["osm:way:1"][0][0] == back["osm:way:1"][0][-1] == (432200.0, 275700.0)
    assert len(back["osm:way:1"][0]) == 5
    assert len(back["osm:way:2"]) == 2 and len(back["osm:way:2"][1]) == 5


def test_blob_header_is_what_spike_ts_reads():
    b = gpkg.gpkg_blob(SQUARE)
    assert b[:2] == b"GP" and b[2] == 0
    flags = b[3]
    assert flags & 1 == 1, "little-endian"
    assert (flags >> 1) & 0x07 == 1, "a 32-byte xy envelope"
    # after the 8-byte header and the envelope: WKB byte order 1, type 3 (Polygon), one ring of five points
    o = 8 + 32
    assert b[o] == 1
    assert int.from_bytes(b[o + 1 : o + 5], "little") == 3
    assert int.from_bytes(b[o + 5 : o + 9], "little") == 1
    assert int.from_bytes(b[o + 9 : o + 13], "little") == 5


def test_tables_name_the_layer_and_the_srs(tmp_path):
    p = tmp_path / "fp.gpkg"
    gpkg.write_footprints(p, [{"id": "a", "rings": SQUARE}])
    db = sqlite3.connect(p)
    try:
        assert db.execute("select table_name, data_type, srs_id from gpkg_contents").fetchone() == ("footprints", "features", 27700)
        assert db.execute("select column_name, geometry_type_name, srs_id from gpkg_geometry_columns").fetchone() == ("geom", "POLYGON", 27700)
        assert db.execute("select organization_coordsys_id from gpkg_spatial_ref_sys where srs_id = 27700").fetchone() == (27700,)
        assert db.execute("pragma application_id").fetchone()[0] == 0x47504B47
    finally:
        db.close()
