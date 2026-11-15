/**
 * Simulate v2 Engine 1 (Brief 103): shared types. The engine is pure: no DOM, no I/O, no React, and no imports from
 * frontend/src/utils/ (ported code is copied in with a provenance header).
 */

/** One EPW file, parsed. Hourly arrays are all the same length (8,760, or 8,784 for a leap year). */
export interface Weather {
  header: {
    city: string
    region: string
    country: string
    source: string
    wmo: string
    /** Degrees north. */
    latitude: number
    /** Degrees east. */
    longitude: number
    /** Hours from UTC. */
    time_zone: number
    /** Metres. */
    elevation: number
  }
  hours: {
    count: number
    year: Int16Array
    month: Int8Array
    day: Int8Array
    /** EPW hour, 1 to 24 (1 = 00:00 to 01:00). */
    hour: Int8Array
    /** °C (EPW field 6). */
    dry_bulb: Float64Array
    /** °C (field 7). */
    dew_point: Float64Array
    /** % (field 8). */
    relative_humidity: Float64Array
    /** Pa (field 9). */
    pressure: Float64Array
    /** Wh/m² (field 13). */
    global_horizontal: Float64Array
    /** Wh/m² (field 14). */
    direct_normal: Float64Array
    /** Wh/m² (field 15). */
    diffuse_horizontal: Float64Array
    /** Degrees from north (field 20). */
    wind_direction: Float64Array
    /** m/s (field 21). */
    wind_speed: Float64Array
    /** Tenths (field 22). */
    total_sky_cover: Float64Array
    /** Tenths (field 23). */
    opaque_sky_cover: Float64Array
  }
  /** Lower-case hex SHA-256 of the file's bytes, as given to parseEpw. */
  sha256: string
}

/** Hourly irradiance incident on one surface, W/m² (equal to Wh/m² for the hour). */
export interface SurfaceIrradiance {
  direct: Float64Array
  diffuse: Float64Array
  reflected: Float64Array
  total: Float64Array
}
