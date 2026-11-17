/**
 * Brief 124 P1–P2: the contents on the air node and finishes on inside faces.
 *
 * - D3: a finish named on a face gives exactly the layer stack written by hand (the concrete-frame room of the 17 Nov
 *   investigation: carpet on the floor face, a suspended ceiling on the ceiling face, both), hour for hour.
 * - D3: on an element with a stated U the finish adds its resistance: U = 1 / (1/U_stated + R_finish).
 * - The schema refuses a finish on glazing and a zone_b finish on a surface with one inside face; the library resolves
 *   and pins finish keys like constructions.
 * - D1/D2: today's 250 kJ/K·m² upgrades to ISO 52016-1's 10 kJ/K·m²; any other figure stays.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { opaqueElement } from '../elements'
import { REFEREE_OPTIONS, runModel } from '../model'
import { runMonthly } from '../monthly'
import { ModelDocument } from '../../schema/model'
import { LEGACY_INTERNAL_HEAT_CAPACITY_J_PER_K_M2, TODAY, upgradeDocument } from '../../schema/upgrade'
import { resolveConstructions } from '../../../sim2/run/library'
import { build } from './massRoom'
import { MOS, readMos } from './denver'

const SPEC = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../validation/energyplus/mass_finishes_spec.json'), 'utf8'))
const weather = readMos(fs.readFileSync(MOS))
const OPTS = { ...REFEREE_OPTIONS, internal_gains: 'profiles' as const, ventilation: 'document' as const }

describe('Brief 124 D3: finishes on inside faces', () => {
  for (const c of ['exposed', 'carpet', 'ceiling_void', 'carpet_and_void']) {
    it(`${c}: as finishes, the same hours as the slab written by hand`, () => {
      const hand = build(SPEC, weather, 'denver', c, 10_000, true)
      const fin = build(SPEC, weather, 'denver', c, 10_000, true, { finishes: true })
      const a = runModel(hand.doc, weather, hand.lib, OPTS).zones[0], b = runModel(fin.doc, weather, fin.lib, OPTS).zones[0]
      expect(Array.from(b.hourly.cooling_w)).toEqual(Array.from(a.hourly.cooling_w))
      expect(Array.from(b.hourly.heating_w)).toEqual(Array.from(a.hourly.heating_w))
      const ma = runMonthly(hand.doc, weather, hand.lib, { solar: OPTS.solar, glazing_solar: 'optical', internal_gains: 'profiles' } as any).zones[0]
      const mb = runMonthly(fin.doc, weather, fin.lib, { solar: OPTS.solar, glazing_solar: 'optical', internal_gains: 'profiles' } as any).zones[0]
      expect(mb.c_m_j_per_k).toBe(ma.c_m_j_per_k)
      expect(mb.cooling_kwh).toBe(ma.cooling_kwh)
    })
  }
  it('with a stated U, the finish adds its resistance on top', () => {
    const layers = SPEC.external_wall.map(([d, k, cp, rho]: number[]) => ({ kind: 'Material', thickness: d, conductivity: k, density: rho, specific_heat: cp }))
    const carpet = [{ kind: 'Material', thickness: 0.01, conductivity: 0.06, density: 200, specific_heat: 1300 }]
    const e = opaqueElement({ id: 'g', area_m2: 10, tilt_deg: 180, boundary: 'ground', layers, stated_u: 0.22, emissivity: null, path: 'p', inside_finish: carpet })
    expect(e.u_w_per_m2k).toBeCloseTo(1 / (1 / 0.22 + 0.01 / 0.06), 12)
    const series = 1 / (1 / e.g_boundary + Array.from(e.g).reduce((t, g) => t + 1 / g, 0) + 0.17)  // + R_si downward
    expect(series).toBeCloseTo(e.u_w_per_m2k, 2)
  })
  it('the schema refuses a finish on glazing and a zone_b finish on a surface with one inside face', () => {
    const { doc } = build(SPEC, weather, 'denver', 'exposed', 10_000, true)
    const d: any = structuredClone(doc)
    d.surfaces.find((s: any) => s.id === 'window').inside_finish = { key: 'finish_carpet' }
    expect(() => ModelDocument.parse(d)).toThrow('takes no inside finish')
    const e: any = structuredClone(doc)
    e.surfaces.find((s: any) => s.id === 'north').inside_finish_b = { key: 'finish_carpet' }
    expect(() => ModelDocument.parse(e)).toThrow('inside_finish_b is for a surface between zones')
  })
  it('the library resolves and pins a finish like a construction', () => {
    const { doc } = build(SPEC, weather, 'denver', 'carpet', 10_000, true, { finishes: true })
    const r = resolveConstructions(doc)
    expect(r.missing.some((m) => m.path.endsWith('inside_finish.key') && m.what.includes('finish_carpet'))).toBe(true)
  })
})

describe('Brief 124 D1/D2: the contents on the air node', () => {
  it('ISO 52016-1 Table B.17: 10 kJ/K per m²; today\'s 250 kJ/K·m² upgrades to it, any other figure stays', () => {
    expect(TODAY.internal_heat_capacity_j_per_k_m2).toBe(10_000)
    const { doc } = build(SPEC, weather, 'denver', 'exposed', LEGACY_INTERNAL_HEAT_CAPACITY_J_PER_K_M2, true)
    const old: any = { ...structuredClone(doc), schema_version: '2.11' }
    expect(upgradeDocument(old).zones[0].internal_heat_capacity_j_per_k_m2).toBe(10_000)
    old.zones[0].internal_heat_capacity_j_per_k_m2 = 40_000
    expect(upgradeDocument(old).zones[0].internal_heat_capacity_j_per_k_m2).toBe(40_000)
  })
})
