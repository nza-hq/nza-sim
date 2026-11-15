/**
 * Simulate v2 Engine 1 (Brief 103 Part 2): the EPW parser.
 *
 * Reads the EnergyPlus Weather format: 8 header lines, then one row per hour. Field numbers follow the EnergyPlus
 * "Auxiliary Programs" EPW data dictionary (0-based here): 0 year, 1 month, 2 day, 3 hour, 6 dry bulb, 7 dew point,
 * 8 relative humidity, 9 pressure, 13 global horizontal, 14 direct normal, 15 diffuse horizontal, 20 wind direction,
 * 21 wind speed, 22 total sky cover, 23 opaque sky cover.
 *
 * Unlike the backend parser (api/routers/weather.py parse_epw), this refuses a malformed row with its line number
 * instead of writing zeros: inputs fail loudly (brief principles). On a well-formed file the two give the same
 * arrays value for value (Part 2 gate, scripts/103_epw_parity.mjs).
 */
import { sha256HexBytes } from '../schema/canonical'
import type { Weather } from './types'

export class EpwError extends Error {
  constructor(message: string, readonly line: number | null) {
    super(line == null ? message : `EPW line ${line}: ${message}`)
    this.name = 'EpwError'
  }
}

const num = (s: string | undefined, line: number, field: string): number => {
  const v = s === undefined ? NaN : Number(s.trim())
  if (s === undefined || s.trim() === '' || !Number.isFinite(v)) throw new EpwError(`${field} is not a number (${JSON.stringify(s)})`, line)
  return v
}

/** Parses an EPW file's bytes. Async only because the SHA-256 uses Web Crypto (browser and Node alike). */
export async function parseEpw(bytes: Uint8Array): Promise<Weather> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const sha256 = await sha256HexBytes(copy)
  // EPW files are ASCII in practice; latin-1 matches the backend's reading and never throws.
  const text = new TextDecoder('latin1').decode(copy)
  const lines = text.split(/\r?\n/)
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  if (lines.length < 9) throw new EpwError(`too short: ${lines.length} lines, need 8 header lines and data`, null)
  const loc = lines[0].split(',')
  if (loc[0].trim().toUpperCase() !== 'LOCATION') throw new EpwError('the first line is not a LOCATION record', 1)
  const header = {
    city: (loc[1] ?? '').trim(), region: (loc[2] ?? '').trim(), country: (loc[3] ?? '').trim(),
    source: (loc[4] ?? '').trim(), wmo: (loc[5] ?? '').trim(),
    latitude: num(loc[6], 1, 'latitude'), longitude: num(loc[7], 1, 'longitude'),
    time_zone: num(loc[8], 1, 'time zone'), elevation: num(loc[9], 1, 'elevation'),
  }
  const rows = lines.slice(8)
  const n = rows.length
  if (n !== 8760 && n !== 8784) throw new EpwError(`expected 8,760 or 8,784 hourly rows, found ${n}`, null)
  const f64 = () => new Float64Array(n)
  const h = {
    count: n, year: new Int16Array(n), month: new Int8Array(n), day: new Int8Array(n), hour: new Int8Array(n),
    dry_bulb: f64(), dew_point: f64(), relative_humidity: f64(), pressure: f64(),
    global_horizontal: f64(), direct_normal: f64(), diffuse_horizontal: f64(),
    wind_direction: f64(), wind_speed: f64(), total_sky_cover: f64(), opaque_sky_cover: f64(),
  }
  for (let i = 0; i < n; i++) {
    const line = i + 9
    const p = rows[i].split(',')
    if (p.length < 24) throw new EpwError(`expected at least 24 fields, found ${p.length}`, line)
    h.year[i] = num(p[0], line, 'year')
    const month = num(p[1], line, 'month'), day = num(p[2], line, 'day'), hour = num(p[3], line, 'hour')
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new EpwError(`month ${month} out of range`, line)
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new EpwError(`day ${day} out of range`, line)
    if (!Number.isInteger(hour) || hour < 1 || hour > 24) throw new EpwError(`hour ${hour} out of range`, line)
    h.month[i] = month; h.day[i] = day; h.hour[i] = hour
    h.dry_bulb[i] = num(p[6], line, 'dry bulb')
    h.dew_point[i] = num(p[7], line, 'dew point')
    h.relative_humidity[i] = num(p[8], line, 'relative humidity')
    h.pressure[i] = num(p[9], line, 'pressure')
    h.global_horizontal[i] = num(p[13], line, 'global horizontal')
    h.direct_normal[i] = num(p[14], line, 'direct normal')
    h.diffuse_horizontal[i] = num(p[15], line, 'diffuse horizontal')
    h.wind_direction[i] = num(p[20], line, 'wind direction')
    h.wind_speed[i] = num(p[21], line, 'wind speed')
    h.total_sky_cover[i] = num(p[22], line, 'total sky cover')
    h.opaque_sky_cover[i] = num(p[23], line, 'opaque sky cover')
  }
  return { header, hours: h, sha256 }
}
