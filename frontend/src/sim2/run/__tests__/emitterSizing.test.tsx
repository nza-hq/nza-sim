/**
 * Brief 108 Part 5: the emitter panel shows the summary's own numbers, nothing when no zone states emitters, and why a
 * what-if cannot run.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmitterSizing } from '../EmitterSizing'
import type { CoolingZone, EmitterZone, Summary } from '../seam'

const zone = (over: Partial<EmitterZone> = {}): EmitterZone => ({
  id: 'z1', name: 'Storey 1', cap_w: 10400, peak_w: 23200, shortfall_w: 12800, design: { flow_c: 50, return_c: 40, room_c: 21 },
  rated_now_w: 27400, needed_rated_w: 61000, note: null, unlisted_systems: [], unmet_hours: 634, min_c: 18.04, in_use: false, hours_at_cap: 1200, catalogue: null, ...over,
})
const summary = (emitters: Summary['emitters']): Summary => ({
  engine: 'thermal-2', run_ms: 1, steps_per_hour: 1, weather: { file_name: 'w.epw', station: 'W', sha256: 'x' },
  building: { floor_m2: 100, heating_kwh: 111800, cooling_kwh: 0, peak_heating_w: 0, peak_cooling_w: 0 },
  zones: [], breakdown: [], drafts: [], energy: { ok: false, missing: [] }, emitters, design_heat_loss: null,
})
const html = (s: Summary, whatIf = null) => renderToStaticMarkup(<EmitterSizing summary={s} whatIf={whatIf} onWhatIf={() => {}} />)

describe('EmitterSizing', () => {
  it('nothing when no zone states emitters', () => {
    expect(html(summary(null))).toBe('')
  })
  it('one pair: the output against the peak, the hours below, and the rating needed', () => {
    const h = html(summary({ cooling: [], cooling_unstated: [], zones: [zone()], what_if: null }))
    expect(h).toContain('1 of 1 zones with emitters are short of output.')
    expect(h).toContain('Emitters give 10.4 kW at 50/40 °C; the peak need is 23.2 kW.')
    expect(h).toContain('634 hours a year more than 0.5 °C below the setpoint; lowest 18.0 °C.')
    expect(h).toContain('Needs 12.8 kW more at 50/40 °C: 61.0 kW rated at ΔT 50 (75/65/20 °C), against 27.4 kW there now.')
  })
  it('fixed-output units: the note, no rating', () => {
    const h = html(summary({ cooling: [], cooling_unstated: [], zones: [zone({ design: null, needed_rated_w: null, rated_now_w: null, note: 'Only fixed-output emitters.' })], what_if: null }))
    expect(h).toContain('Only fixed-output emitters.')
    expect(h).not.toContain('rated at ΔT 50')
  })
  it('two pairs side by side, and the building at each', () => {
    const other = zone({ cap_w: 23200, shortfall_w: 0, unmet_hours: 0, min_c: 21, needed_rated_w: 27400, design: { flow_c: 70, return_c: 60, room_c: 21 } })
    const h = html(summary({ cooling: [], cooling_unstated: [], zones: [zone()], what_if: { ok: true, flow_c: 70, return_c: 60, heating_kwh: 116700, zones: [other], energy: { ok: false, missing: [] } } }))
    expect(h).toContain('<th>50/40 °C</th><th>70/60 °C</th>')
    expect(h).toContain('<td>Heating delivered</td><td>111.8 MWh</td><td>116.7 MWh</td>')
    expect(h).toContain('<td>Hours below</td><td>634</td><td>0</td>')
    expect(h).not.toContain('Emitters give 10.4 kW at')
    // Review F3: the colder pair's lower energy is said not to be a saving; the form says only temperatures change.
    expect(h).toContain('50/40 °C: less heat')  // only the pair with hours below
    expect(h).toContain('Lower energy there is not a saving.')
    expect(h).toContain('the systems and their efficiency stay as they are')
  })
  it('review F6 and F7: zones at different pairs are headed "As designed"; an unlisted system is named', () => {
    const other = zone({ id: 'z2', name: 'Storey 2', design: { flow_c: 45, return_c: 35, room_c: 21 }, unlisted_systems: ['Panel heaters'] })
    const h = html(summary({ cooling: [], cooling_unstated: [], zones: [zone(), other], what_if: { ok: true, flow_c: 70, return_c: 60, heating_kwh: 1, zones: [zone({ unmet_hours: 0 }), zone({ id: 'z2', unmet_hours: 0 })], energy: { ok: false, missing: [] } } }))
    expect(h).toContain('<th>Building</th><th>As designed</th><th>70/60 °C</th>')
    expect(h).toContain('Also heated by &quot;Panel heaters&quot;, with no emitters listed here')
    expect(h).toContain('As designed: less heat')
  })
  it('a few watts short reads "under 0.1 kW", never "0.0 kW" (browser check on the editor, 15 Nov)', () => {
    const h = html(summary({ cooling: [], cooling_unstated: [], zones: [zone({ shortfall_w: 9.6, peak_w: 1215, cap_w: 1205.4, unmet_hours: 0 })], what_if: null }))
    expect(h).toContain('under 0.1 kW short')
    expect(h).not.toContain('0.0 kW')
  })
  it('a what-if that cannot run says why', () => {
    const h = html(summary({ cooling: [], cooling_unstated: [], zones: [zone()], what_if: { ok: false, flow_c: 30, return_c: 20, missing: [{ path: 'p', what: 'The return must be above the room.' }] } }))
    expect(h).toContain('30/20 °C cannot be compared:')
    expect(h).toContain('The return must be above the room.')
  })
  it('Brief 119: cooling units against the cooling peak, the hours above and the highest temperature', () => {
    const c: CoolingZone = { id: 'm', name: 'Office', cap_w: 800, peak_w: 1411, shortfall_w: 611, unmet_hours: 379, max_c: 28.22, in_use: false, hours_at_cap: 539 }
    const h = html(summary({ zones: [], cooling: [c], cooling_unstated: [], what_if: null }))
    expect(h).toContain('1 of 1 zones with cooling units are short of cooling.')
    expect(h).toContain('Units give 0.8 kW of cooling; the peak need is 1.4 kW.')
    expect(h).toContain('379 hours a year more than 0.5 °C above the setpoint; highest 28.2 °C.')
    expect(h).not.toContain('Compare at another flow')  // no heating emitters, no flow-temperature what-if
    const ok = html(summary({ zones: [zone()], cooling: [{ ...c, cap_w: 2000, shortfall_w: 0, unmet_hours: 0, max_c: 24 }], cooling_unstated: [], what_if: null }))
    expect(ok).toContain('All 1 zones with cooling units have enough cooling.')
    expect(ok).not.toContain('above the setpoint')
  })
  it('Brief 119: the catalogue\'s suggestion for a short room', () => {
    const h = html(summary({ cooling: [], cooling_unstated: [], zones: [zone({ catalogue: { catalogue: 'stelrad-vita-compact', title: 'Stelrad Vita Compact', item: '76602220', type: 'K2 (Type 22, double panel double convector)', height_mm: 600, length_mm: 2000, output_w: 3465, count: 2, extra_rated_w: 6100 } })], what_if: null }))
    expect(h).toContain('From Stelrad Vita Compact: add 2 × 600 × 2000 mm K2 (3,465 W each at ΔT 50) for the 6,100 W still needed.')
  })
  it('review F10: a unit that could cool but states no cooling is said, not silently unlimited', () => {
    const h = html(summary({ zones: [zone()], cooling: [], cooling_unstated: [{ id: 'z1', name: 'Storey 1' }], what_if: null }))
    expect(h).toContain('Storey 1: its units state no cooling output, so its cooling is not limited. State the cooling per unit to check it.')
  })
})
