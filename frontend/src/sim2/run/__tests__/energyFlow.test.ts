import { describe, expect, it } from 'vitest'
import { energyFlow, fuelSplit } from '../energyFlow'

// A hand-written energy summary in the run's shape (test input, not results shown anywhere).
const e = {
  ok: true as const, eui_kwh_per_m2: 100, total_kwh: 1000,
  by_fuel: [{ fuel: 'electricity', kwh: 400 }, { fuel: 'gas', kwh: 600 }],
  end_uses: [
    { end_use: 'heating', fuel: 'gas', kwh: 500 }, { end_use: 'heating', fuel: 'electricity', kwh: 50 },
    { end_use: 'cooling', fuel: 'electricity', kwh: 40 }, { end_use: 'dhw', fuel: 'gas', kwh: 100 },
    { end_use: 'fans', fuel: 'electricity', kwh: 60 }, { end_use: 'pumps', fuel: 'electricity', kwh: 10 },
    { end_use: 'lighting', fuel: 'electricity', kwh: 90 }, { end_use: 'small_power', fuel: 'electricity', kwh: 150 },
  ],
  systems: [
    { id: 'b', label: 'Boiler', service: 'heating', fuel: 'gas', efficiency: 0.9, served_kwh: 450, fuel_kwh: 500 },
    { id: 'hp', label: 'Heat pump', service: 'heating', fuel: 'electricity', efficiency: 3, served_kwh: 150, fuel_kwh: 50 },
    { id: 'c', label: 'Chiller', service: 'cooling', fuel: 'electricity', efficiency: 3, served_kwh: 120, fuel_kwh: 40 },
    { id: 'w', label: 'Water heater', service: 'dhw', fuel: 'gas', efficiency: 0.9, served_kwh: 90, fuel_kwh: 100 },
    { id: 'l', label: 'LED', service: 'lighting', fuel: 'electricity', efficiency: null, served_kwh: 90, fuel_kwh: 90 },
  ],
  not_modelled: [], no_hot_water: false, water_heaters: [], pumps: [], other_loads: [],
}

describe('energy flow for the Sankey (17 Nov 2026)', () => {
  const f = energyFlow(e as never)
  const out = (id: string) => f.links.filter((l) => l.source === id).reduce((a, l) => a + l.value_kWh, 0)
  const into = (id: string) => f.links.filter((l) => l.target === id).reduce((a, l) => a + l.value_kWh, 0)

  it('draws every kWh of every fuel (Rule 9): each fuel out equals its line in by_fuel', () => {
    expect(out('fuel_gas')).toBe(600)
    expect(out('fuel_electricity')).toBe(400)
  })
  it('each heating and hot water system balances: fuel in plus heat from outside equals heat out plus losses', () => {
    for (const id of ['sh_b', 'sh_hp', 'dhw_w']) expect(into(id)).toBe(out(id))
    expect(into('losses')).toBe(60)
    expect(out('ambient')).toBe(100)
  })
  it('end uses with no listed system pass through their own node (fans, pumps, small power)', () => {
    expect(into('moving')).toBe(70)
    expect(into('equip_del')).toBe(150)
    expect(f.nodes.find((n) => n.id === 'sh_b')?.metric).toBe('90% eff')
    expect(f.nodes.find((n) => n.id === 'sc_c')?.metric).toBe('SEER 3.0')
  })
  it('the footer split', () => {
    expect(fuelSplit(e as never)).toEqual({ total_kWh: 1000, electricity_kWh: 400, electricity_pct: 40, gas_kWh: 600, gas_pct: 60 })
  })
})
