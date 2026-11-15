/** Brief 103 Part 1 (QA M7): the run summary names auxiliary, counts district heat as heating, and never turns a
 * missing figure into 0. The shape mirrors calculateInstant's consumption block; the numbers are hand-set, small and
 * checkable, not a model result. */
import { describe, expect, it } from 'vitest'
import { instantSummary } from '../versions'

function result(over: Record<string, any> = {}) {
  const r: any = {
    consumption: {
      space_heating: { electricity_mwh: 10, gas_mwh: 5 },
      space_cooling: { electricity_mwh: 3 },
      dhw: { electricity_mwh: 2, gas_mwh: 4 },
      ventilation: [{ fan_electricity_mwh: 1 }, { fan_electricity_mwh: 0.5 }],
      lighting: { electricity_mwh: 6 },
      small_power: { electricity_mwh: 7 },
      total: { electricity_mwh: 31.5, gas_mwh: 9, district_heat_mwh: 0, kwh_per_m2_yr: 40.5 },
    },
    heat_balance: { annual: { gains: { internal: { auxiliary: { electricity_kwh: 2000 } } } } },
  }
  for (const [path, v] of Object.entries(over)) {
    const keys = path.split('.'); let o = r
    for (const k of keys.slice(0, -1)) o = o[k]
    if (v === undefined) delete o[keys.at(-1)!]; else o[keys.at(-1)!] = v
  }
  return r
}

describe('instantSummary', () => {
  it('names auxiliary from the engine figure and leaves nothing unitemised', () => {
    const s = instantSummary(result())
    expect(s.annual_by_end_use.auxiliary).toBe(2000)
    expect(s.annual_by_end_use.heating).toBe(15000)
    expect(s.annual_by_end_use.ventilation_fans).toBe(1500)
    expect(s.annual_by_end_use.not_itemised).toBe(0)
    expect(s.annual_by_fuel).toEqual({ electricity: 31500, gas: 9000 })
    expect(s.eui_kwh_m2).toBe(40.5)
  })
  it('counts district heat as heating and as its own fuel', () => {
    const s = instantSummary(result({ 'consumption.total.district_heat_mwh': 4 }))
    expect(s.annual_by_fuel.district_heat).toBe(4000)
    expect(s.annual_by_end_use.heating).toBe(19000)
    expect(s.annual_by_end_use.not_itemised).toBe(0)
  })
  it('keeps an unlisted remainder visible rather than hiding it', () => {
    const s = instantSummary(result({ 'consumption.total.electricity_mwh': 32.5 }))
    expect(s.annual_by_end_use.not_itemised).toBe(1000)
  })
  it.each([
    ['consumption.lighting.electricity_mwh', undefined],
    ['consumption.space_heating.gas_mwh', Number.NaN],
    ['consumption.total.district_heat_mwh', undefined],
    ['heat_balance.annual.gains.internal.auxiliary.electricity_kwh', undefined],
    ['consumption.dhw.electricity_mwh', '2'],
  ])('fails loudly when %s is %s', (path, v) => {
    expect(() => instantSummary(result({ [path]: v }))).toThrow(path)
  })
})
