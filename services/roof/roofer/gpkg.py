"""Footprints as a GeoPackage, written with sqlite3 alone (Brief 56 D3).

roofer reads its footprints through GDAL (any vector format); the spike handed it a GeoPackage made by
geopandas. decodED's container does not carry GDAL's Python stack, so this writes the few tables a
GeoPackage needs (gpkg_spatial_ref_sys, gpkg_contents, gpkg_geometry_columns, the feature table) and
each polygon as a GeoPackage binary (the "GP" header + ISO WKB), the inverse of what
src/twin/roofer/spike.ts `gpkgRings` reads. One layer, `footprints`, EPSG:27700, a `fid_s` id column —
the names roofer was run with (`--id-attribute fid_s`).
"""

from __future__ import annotations

import sqlite3
import struct
from pathlib import Path

EPSG_27700_WKT = (
    'PROJCS["OSGB36 / British National Grid",GEOGCS["OSGB36",DATUM["Ordnance_Survey_of_Great_Britain_1936",'
    'SPHEROID["Airy 1830",6377563.396,299.3249646]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],'
    'PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",49],PARAMETER["central_meridian",-2],'
    'PARAMETER["scale_factor",0.9996012717],PARAMETER["false_easting",400000],PARAMETER["false_northing",-100000],'
    'UNIT["metre",1],AUTHORITY["EPSG","27700"]]'
)


def wkb_polygon(rings: list[list[tuple[float, float]]]) -> bytes:
    """ISO WKB, little-endian, 2-D Polygon; every ring closed."""
    out = [struct.pack("<BII", 1, 3, len(rings))]
    for ring in rings:
        pts = list(ring)
        if pts and pts[0] != pts[-1]:
            pts.append(pts[0])
        out.append(struct.pack("<I", len(pts)))
        for x, y in pts:
            out.append(struct.pack("<dd", float(x), float(y)))
    return b"".join(out)


def gpkg_blob(rings: list[list[tuple[float, float]]], srs_id: int = 27700) -> bytes:
    """GeoPackage binary: magic GP, version 0, flags (little-endian, envelope type 1), srs id, envelope, WKB."""
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    flags = 0b00000011  # envelope indicator 1 (minx,maxx,miny,maxy), little-endian byte order
    header = struct.pack("<BBBBi", 0x47, 0x50, 0, flags, srs_id) + struct.pack("<dddd", min(xs), max(xs), min(ys), max(ys))
    return header + wkb_polygon(rings)


def write_footprints(path: str | Path, footprints: list[dict], layer: str = "footprints", id_column: str = "fid_s") -> int:
    """`footprints`: [{"id": str, "rings": [[(E, N), …], …]}] in EPSG:27700. Returns the row count."""
    p = Path(path)
    if p.exists():
        p.unlink()
    db = sqlite3.connect(p)
    try:
        db.execute("PRAGMA application_id = 0x47504B47")  # 'GPKG'
        db.execute("PRAGMA user_version = 10300")  # GeoPackage 1.3
        db.executescript(
            """
            CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER NOT NULL PRIMARY KEY,
              organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
            CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE,
              description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER,
              CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
            CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL,
              srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL,
              CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
              CONSTRAINT uk_gc_table_name UNIQUE (table_name),
              CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
              CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id));
            """
        )
        db.executemany(
            "INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)",
            [
                ("Undefined cartesian SRS", -1, "NONE", -1, "undefined", "undefined cartesian coordinate reference system"),
                ("Undefined geographic SRS", 0, "NONE", 0, "undefined", "undefined geographic coordinate reference system"),
                ("WGS 84 geodetic", 4326, "EPSG", 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]', "WGS 84"),
                ("OSGB36 / British National Grid", 27700, "EPSG", 27700, EPSG_27700_WKT, "British National Grid"),
            ],
        )
        db.execute(f'CREATE TABLE "{layer}" (fid INTEGER PRIMARY KEY AUTOINCREMENT, "{id_column}" TEXT, geom POLYGON)')
        xs = [p[0] for f in footprints for r in f["rings"] for p in r]
        ys = [p[1] for f in footprints for r in f["rings"] for p in r]
        db.execute(
            "INSERT INTO gpkg_contents (table_name, data_type, identifier, min_x, min_y, max_x, max_y, srs_id) VALUES (?,?,?,?,?,?,?,?)",
            (layer, "features", layer, min(xs) if xs else None, min(ys) if ys else None, max(xs) if xs else None, max(ys) if ys else None, 27700),
        )
        db.execute("INSERT INTO gpkg_geometry_columns VALUES (?,?,?,?,?,?)", (layer, "geom", "POLYGON", 27700, 0, 0))
        db.executemany(f'INSERT INTO "{layer}" ("{id_column}", geom) VALUES (?, ?)', [(f["id"], gpkg_blob(f["rings"])) for f in footprints])
        db.commit()
    finally:
        db.close()
    return len(footprints)


def read_rings(path: str | Path, layer: str = "footprints") -> list[dict]:
    """Read back what write_footprints wrote (the tests' round trip; the same bytes spike.ts parses)."""
    db = sqlite3.connect(Path(path))
    try:
        col = db.execute("SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?", (layer,)).fetchone()[0]
        out = []
        for fid_s, blob in db.execute(f'SELECT fid_s, "{col}" FROM "{layer}"'):
            flags = blob[3]
            env = [0, 32, 48, 48, 64][(flags >> 1) & 0x07]
            o = 8 + env
            le = blob[o] == 1
            o += 1
            (gtype,) = struct.unpack("<I" if le else ">I", blob[o : o + 4])
            o += 4
            assert gtype % 1000 == 3, gtype
            (nrings,) = struct.unpack("<I" if le else ">I", blob[o : o + 4])
            o += 4
            rings = []
            for _ in range(nrings):
                (n,) = struct.unpack("<I" if le else ">I", blob[o : o + 4])
                o += 4
                ring = []
                for _ in range(n):
                    x, y = struct.unpack("<dd" if le else ">dd", blob[o : o + 16])
                    o += 16
                    ring.append((x, y))
                rings.append(ring)
            out.append({"id": fid_s, "rings": rings})
        return out
    finally:
        db.close()
