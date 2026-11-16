/**
 * Brief 117 Part 3: the design heat loss panel and the emitter panel's design view show the summary's own numbers,
 * what is still needed in words, and the year-round check alone when no design conditions are stated.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DesignHeatLoss } from '../DesignHeatLoss'
import { EmitterSizing } from '../EmitterSizing'
import type { DesignSummary, DesignZoneSummary, EmitterZone, Summary } from '../seam'

const sizing = (over: Partial<NonNullable<DesignZoneSummary['emitters']>> = {}) => ({
  cap_w: 10400, peak_w: 12600, shortfall_w: 2200, design: { flow_c: 50, return_c: 40, room_c: 21 }, rated_now_w: 27400, needed_rated_w: 33200, note: null, unlisted_systems: [], ...over,
})
const dz = (over: Partial<DesignZoneSummary> = {}): DesignZoneSummary => ({
  id: 'z1', name: 'Storey 1', floor_m2: 100, heated: true, internal_c: 21, internal_source: 'follow_heat_c', ach: 0.6,
  terms: [{ term: 'fabric', w: 6000 }, { term: 'infiltration', w: 3000 }, { term: 'to_room', w: 0 }, { term: 'warm_up', w: 3600 }],
  total_w: 12600, w_per_m2: 126, emitters: sizing(), what_if_emitters: null, ...over,
})
const year: EmitterZone = { ...sizing({ peak_w: 9800, shortfall_w: 0 }), id: 'z1', name: 'Storey 1', unmet_hours: 0, min_c: 21, in_use: false, hours_at_cap: 0 }
const summary = (d: DesignSummary | null): Summary => ({
  engine: 'thermal-2', run_ms: 1, steps_per_hour: 1, weather: { file_name: 'w.epw', station: 'W', sha256: 'x' },
  building: { floor_m2: 100, heating_kwh: 1, cooling_kwh: 0, peak_heating_w: 0, peak_cooling_w: 0 },
  zones: [], breakdown: [], drafts: [], energy: { ok: false, missing: [] }, emitters: { zones: [year], cooling: [], what_if: null }, design_heat_loss: d,
} as unknown as Summary)
const ok = (zones: DesignZoneSummary[]): DesignSummary => ({ ok: true, outdoor_c: -4.6, outdoor_source: 'heating_99_6', ground_c: 11.3, warm_up_w_per_m2: 36, vent_wind_m_s: null, building_w: 12600, zones, what_if: null })
const panel = (s: Summary) => renderToStaticMarkup(<DesignHeatLoss summary={s} />)
const emit = (s: Summary) => renderToStaticMarkup(<EmitterSizing summary={s} whatIf={null} onWhatIf={() => {}} />)

describe('DesignHeatLoss', () => {
  it('nothing without design conditions', () => expect(panel(summary(null))).toBe(''))
  it('the building and each room, with where the outdoor temperature comes from', () => {
    const h = panel(summary(ok([dz(), dz({ id: 'z2', name: 'Store', heated: false, internal_c: 12, internal_source: 'stated', total_w: 800, w_per_m2: 8, emitters: null })])))
    expect(h).toContain('12.6 kW for the building, at -4.6 °C outside (the weather file&#x27;s 99.6 %).')
    expect(h).toContain('<strong>Storey 1</strong><span>12.6 kW</span>')
    expect(h).toContain('126 W/m² at 21.0 °C.')
    expect(h).toContain('8 W/m² at 12.0 °C, not heated: not in the total.')
  })
  it('what it still needs', () => {
    const h = panel(summary({ ok: false, missing: [{ path: 'zones[1].design_internal_c', what: 'State the design temperature for "Storey 2", or let it follow its heating setpoint.' }] }))
    expect(h).toContain('To work out the design heat loss:')
    expect(h).toContain('State the design temperature for &quot;Storey 2&quot;')
  })
})

describe('EmitterSizing, Brief 117', () => {
  it('with design conditions: the switch, on the design heat loss first, with no hours', () => {
    const h = emit(summary(ok([dz()])))
    expect(h).toContain('aria-pressed="true">Design heat loss</button>')
    expect(h).toContain('aria-pressed="false">Year-round check</button>')
    expect(h).toContain('1 of 1 zones with emitters are short of output for their design heat loss.')
    expect(h).toContain('Emitters give 10.4 kW at 50/40 °C with the room at 21.0 °C; the design heat loss is 12.6 kW.')
    expect(h).toContain('Needs 2.2 kW more at 50/40 °C: 33.2 kW rated at ΔT 50 (75/65/20 °C), against 27.4 kW there now.')
    expect(h).not.toContain('below the setpoint')
  })
  it('without design conditions: the year-round check alone, and what to state', () => {
    const h = emit(summary(null))
    expect(h).not.toContain('Year-round check')
    expect(h).toContain('To size against a design heat loss, state the design outdoor temperature.')
    expect(h).toContain('the peak need is 9.8 kW')
  })
})
