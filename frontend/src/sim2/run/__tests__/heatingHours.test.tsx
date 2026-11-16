/**
 * Brief 109 Part 4: the heating hours panel shows the summary's own numbers, nothing when no zone is heated to hours,
 * and a cold morning's time back in words.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HeatingHours, when } from '../HeatingHours'
import type { Summary, ZoneHours } from '../seam'

const hours = (over: Partial<ZoneHours> = {}): ZoneHours => ({
  setpoint_c: 21, setback_c: 16, in_use_hours: 3132, unmet_in_use_hours: 0, min_in_use_c: 20.99,
  morning_peak: { w: 328462, hour: 21 * 24 + 7 }, later_peak: { w: 30100, hour: 21 * 24 + 8 },
  limited: false, recovery: { mornings: 63, median_h: 0, not_reached: 0 }, ...over,
})
const summary = (zs: (ZoneHours | null)[]): Summary => ({
  engine: 'thermal-2', run_ms: 1, steps_per_hour: 1, weather: { file_name: 'w.epw', station: 'W', sha256: 'x' },
  building: { floor_m2: 100, heating_kwh: 1, cooling_kwh: 0, peak_heating_w: 0, peak_cooling_w: 0, monthly: { heating_kwh: [], cooling_kwh: [] } },
  zones: zs.map((h, i) => ({ id: `z${i}`, name: `Storey ${i + 1}`, floor_m2: 1, heating_kwh: 1, cooling_kwh: 0, heated: true, cooled: false, breakdown: [], monthly: { heating_kwh: [], cooling_kwh: [] }, by_surface: [], window_solar: [], hours: h })),
  breakdown: [], by_surface: [], window_solar: [], hourly: null, drafts: [], energy: { ok: false, missing: [] }, emitters: null,
})
const html = (s: Summary) => renderToStaticMarkup(<HeatingHours summary={s} />)

describe('HeatingHours', () => {
  it('nothing when no zone is heated to hours', () => {
    expect(html(summary([null, null]))).toBe('')
  })
  it('when: the engine\'s calendar, 1 January a Monday', () => {
    expect(when(7)).toBe('Mon 1 Jan, 07:00')
    expect(when(21 * 24 + 7)).toBe('Mon 22 Jan, 07:00')
    expect(when(31 * 24 + 23)).toBe('Thu 1 Feb, 23:00')
    expect(when(8759)).toBe('Mon 31 Dec, 23:00')
  })
  it('a zone that holds its setpoint: hours in use, the two peaks with when, back in the first hour', () => {
    const h = html(summary([hours(), null]))
    expect(h).toContain('Storey 1')
    expect(h).not.toContain('Storey 2')
    expect(h).toContain('holds its setpoint')
    expect(h).toContain('In use 3,132 hours a year; lowest in use 21.0 °C.')
    expect(h).toContain('Heat to recover in the first hour 328.5 kW (Mon 22 Jan, 07:00); later peak 30.1 kW (Mon 22 Jan, 08:00).')
    expect(html(summary([hours({ limited: true })]))).toContain('Morning peak 328.5 kW (Mon 22 Jan, 07:00); later peak')
    expect(h).toContain('On a cold morning it is back within 0.5 °C of 21.0 °C in the first hour.')
  })
  it('a zone that falls short: hours below, the time back, and the mornings it never gets there', () => {
    const h = html(summary([hours({ unmet_in_use_hours: 841, min_in_use_c: 12.4, recovery: { mornings: 63, median_h: 3, not_reached: 5 } })]))
    expect(h).toContain('841 h below')
    expect(h).toContain('In use 3,132 hours a year; 841 of them more than 0.5 °C below the setpoint; lowest in use 12.4 °C.')
    expect(h).toContain('On a cold morning it takes 3 hours to get back within 0.5 °C of 21.0 °C. On 5 of those 63 mornings it does not get back that day.')
    const never = html(summary([hours({ recovery: { mornings: 63, median_h: null, not_reached: 63 } })]))
    expect(never).toContain('On a cold morning it does not get back to 21.0 °C that day.')
  })
})
