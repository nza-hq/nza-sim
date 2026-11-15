/**
 * Brief 103 Part 2: the EPW parser and solar on any surface.
 *
 * Unit cases use a small generated EPW (a test input, not a result: Rule 2 is about what users see). The anchor cases
 * read the real Yeovilton EPW from data/weather/current when it is present (it is local data, not in git) and say so
 * when they skip.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: plain JS module, imported by the test only (the engine never imports frontend/src/utils)
import { computeHourlySolarByFacade } from '../../../utils/solarCalc.js'
import { EpwError, parseEpw, solarOnSurface, sunPosition } from '../index'
import type { Weather } from '../types'

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** A well-formed EPW text: 8 header lines and 8,760 rows whose values are simple functions of the hour index. */
function makeEpw(rowEdit?: (i: number, f: string[]) => void, leap = false): string {
  const head = [
    'LOCATION,Testville,ENG,GBR,Test,000000,51.0,-2.6,0.0,20.0',
    'DESIGN CONDITIONS,0', 'TYPICAL/EXTREME PERIODS,0', 'GROUND TEMPERATURES,0',
    'HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0', 'COMMENTS 1,test', 'COMMENTS 2,test', 'DATA PERIODS,1,1,Data,Sunday, 1/ 1,12/31',
  ]
  const days = leap ? [31, 29, ...MONTH_DAYS.slice(2)] : MONTH_DAYS
  const rows: string[] = []
  let i = 0
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= days[m - 1]; d++) for (let hr = 1; hr <= 24; hr++, i++) {
    const day = hr >= 7 && hr <= 18
    const f = ['2020', String(m), String(d), String(hr), '60', 'A7A7A7A7*0?9?9?9?9?9?9?9A7A7A7A7A7A7*0*0E8*0*0',
      (5 + (i % 20) / 2).toFixed(1), (2 + (i % 7) / 2).toFixed(1), String(60 + (i % 30)), String(101000 + (i % 500)),
      '0', '0', '300', day ? String(100 + (i % 400)) : '0', day ? String((i * 7) % 600) : '0', day ? String(50 + (i % 150)) : '0',
      '0', '0', '0', '0', String((i * 13) % 360), ((i % 9) * 0.7).toFixed(1), String(i % 11), String(i % 6),
      '9999', '99999', '9', '999999999', '0', '0.1', '0', '88', '0.16', '0', '1']
    rowEdit?.(i, f)
    rows.push(f.join(','))
  }
  return [...head, ...rows].join('\r\n') + '\r\n'
}
const bytes = (s: string) => new TextEncoder().encode(s)

describe('parseEpw', () => {
  it('reads the header and every field of every row, with the sha256 of the bytes', async () => {
    const text = makeEpw()
    const w = await parseEpw(bytes(text))
    expect(w.header).toEqual({ city: 'Testville', region: 'ENG', country: 'GBR', source: 'Test', wmo: '000000', latitude: 51, longitude: -2.6, time_zone: 0, elevation: 20 })
    expect(w.hours.count).toBe(8760)
    expect(w.sha256).toBe(createHash('sha256').update(bytes(text)).digest('hex'))
    const i = 4000
    expect([w.hours.month[i], w.hours.day[i], w.hours.hour[i]]).toEqual([6, 16, 17])
    expect(w.hours.dry_bulb[i]).toBe(5)
    expect(w.hours.dew_point[i]).toBe(2 + (i % 7) / 2)
    expect(w.hours.direct_normal[i]).toBe((i * 7) % 600)
    expect(w.hours.wind_speed[i]).toBe(Number(((i % 9) * 0.7).toFixed(1)))
    expect(w.hours.opaque_sky_cover[i]).toBe(i % 6)
  })
  it('accepts a leap year (8,784 rows)', async () => {
    expect((await parseEpw(bytes(makeEpw(undefined, true)))).hours.count).toBe(8784)
  })
  it('refuses a malformed value with its line number, never a zero', async () => {
    const bad = makeEpw((i, f) => { if (i === 100) f[6] = 'abc' })
    await expect(parseEpw(bytes(bad))).rejects.toThrow('EPW line 109: dry bulb is not a number')
    await expect(parseEpw(bytes(bad))).rejects.toBeInstanceOf(EpwError)
  })
  it('refuses a short row, an hour out of range, and a truncated file', async () => {
    await expect(parseEpw(bytes(makeEpw((i, f) => { if (i === 5) f.length = 20 })))).rejects.toThrow('EPW line 14: expected at least 24 fields')
    await expect(parseEpw(bytes(makeEpw((i, f) => { if (i === 0) f[3] = '25' })))).rejects.toThrow('EPW line 9: hour 25 out of range')
    const lines = makeEpw().split('\r\n'); lines.splice(500, 1)
    await expect(parseEpw(bytes(lines.join('\r\n')))).rejects.toThrow('found 8759')
    await expect(parseEpw(bytes('LOCATION,x'))).rejects.toThrow('too short')
  })
})

/** The four facades plus the roof, from today's solarCalc and from solarOnSurface. Float32 is what today stores. */
function compareWithToday(w: Weather, orientation: number) {
  const legacy = computeHourlySolarByFacade({
    temperature: w.hours.dry_bulb, direct_normal: w.hours.direct_normal, diffuse_horizontal: w.hours.diffuse_horizontal,
    month: w.hours.month, hour: w.hours.hour,
  }, w.header.latitude, orientation)
  const opts = { albedo: 0.2, sun_day: 'mid_month' as const, solar_time: 'clock' as const }
  const mine = {
    f1: solarOnSurface(w, orientation, 90, opts).total, f2: solarOnSurface(w, orientation + 90, 90, opts).total,
    f3: solarOnSurface(w, orientation + 180, 90, opts).total, f4: solarOnSurface(w, orientation + 270, 90, opts).total,
    roof: solarOnSurface(w, 0, 0, opts).total,
  }
  // Today's arrays are Float32: rounding each of ours to Float32 must give today's value exactly, hour by hour.
  let mismatches = 0
  for (const k of ['f1', 'f2', 'f3', 'f4', 'roof'] as const) {
    for (let i = 0; i < w.hours.count; i++) if (Math.fround(mine[k][i]) !== legacy[k][i]) mismatches++
  }
  return mismatches
}

describe('solarOnSurface', () => {
  it('equals today\'s solarCalc on four facades and the roof, exactly once rounded to Float32', async () => {
    const w = await parseEpw(bytes(makeEpw()))
    expect(compareWithToday(w, 0)).toBe(0)
    expect(compareWithToday(w, 42)).toBe(0)
  })
  it('a horizontal surface receives DNI·sin(altitude) + DHI', async () => {
    const w = await parseEpw(bytes(makeEpw()))
    const roof = solarOnSurface(w, 123, 0, { albedo: 0.2, sun_day: 'mid_month', solar_time: 'clock' })
    const i = 4000 - 4  // 16 June, 13:00-14:00
    const sun = sunPosition(51, 151 + 15, 12.5)
    expect(roof.total[i]).toBeCloseTo(w.hours.direct_normal[i] * Math.sin(sun.altitude) + w.hours.diffuse_horizontal[i], 9)
    expect(roof.reflected[i]).toBe(0)
  })
  it('puts the equinox noon sun due south at latitude 51', () => {
    const s = sunPosition(51, 80, 12)
    expect(s.azimuth).toBeCloseTo(Math.PI, 6)
    expect(s.altitude / (Math.PI / 180)).toBeCloseTo(90 - 51 + 23.45 * Math.sin(2 * Math.PI * 364 / 365), 6)
  })
  it('a tilted surface splits sky and ground diffuse by its view factors', async () => {
    const w = await parseEpw(bytes(makeEpw()))
    const s = solarOnSurface(w, 180, 30, { albedo: 0.3, sun_day: 'actual', solar_time: 'clock' })
    const i = 4000
    expect(s.diffuse[i]).toBeCloseTo(w.hours.diffuse_horizontal[i] * (1 + Math.cos(Math.PI / 6)) / 2, 9)
    const sun = sunPosition(51, 151 + 16, 16.5)
    expect(s.reflected[i]).toBeCloseTo((w.hours.direct_normal[i] * Math.sin(sun.altitude) + w.hours.diffuse_horizontal[i]) * 0.3 * (1 - Math.cos(Math.PI / 6)) / 2, 9)
  })
  it('refuses a missing albedo or an unknown sun-day option instead of assuming one', async () => {
    const w = await parseEpw(bytes(makeEpw()))
    expect(() => solarOnSurface(w, 0, 90, { albedo: undefined as unknown as number, sun_day: 'mid_month', solar_time: 'clock' })).toThrow('albedo')
    expect(() => solarOnSurface(w, 0, 90, { albedo: 0.2, sun_day: 'noon' as never, solar_time: 'clock' })).toThrow('sun_day')
  })
})

const ANCHOR_EPW = path.resolve(__dirname, '../../../../../data/weather/current/GBR_ENG_Yeovilton.AF.038530_TMYx.2011-2025.epw')
describe.skipIf(!fs.existsSync(ANCHOR_EPW))('the anchor EPW (local data; skipped when absent)', () => {
  it('parses with the pinned sha256 and matches today\'s solar on the anchor\'s facades (orientation 42°)', async () => {
    const w = await parseEpw(new Uint8Array(fs.readFileSync(ANCHOR_EPW)))
    expect(w.sha256).toBe('c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2')
    expect(w.hours.count).toBe(8760)
    expect(compareWithToday(w, 42)).toBe(0)
  })
})
