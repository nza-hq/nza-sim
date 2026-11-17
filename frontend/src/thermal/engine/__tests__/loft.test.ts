/**
 * Brief 123 P4.5: the unheated loft as an unconditioned zone. Schema refusals by name (Rule 8), the hourly run's
 * balance with the loft floating (Rule 9), the monthly estimate's ISO 13789 treatment, Fabric only, floor area, and the
 * rooms' leakage under a cold roof. The box is the referee's (loftBox.ts, 123_roof_spec.json) on Chicago TMY3.
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { ModelDocument } from '../../schema/model'
import { REFEREE_OPTIONS, runModel } from '../model'
import { runMonthly } from '../monthly'
import { parseEpw } from '../epw'
import type { Weather } from '../weather'
import { readDocFloorM2 } from '../systems'
import { levelDocument } from '../../../sim2/run/seam'
import { loftBoxDocument, ROOF_SPEC } from './loftBox'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const sum = (a: ArrayLike<number>) => Array.from(a).reduce((s, x) => s + x, 0)
const closes = (lines: { kwh: number }[]) => {
  const gross = lines.reduce((s, l) => s + Math.abs(l.kwh), 0)
  expect(Math.abs(sum(lines.map((l) => l.kwh)))).toBeLessThan(1e-6 * gross)
}

describe('Brief 123: the schema refuses anything that conditions or occupies a loft, by name', () => {
  const base = () => JSON.parse(JSON.stringify(loftBoxDocument('L1').doc))
  const refused = (edit: (d: any) => void, path: string) => {
    const d = base(); edit(d)
    const r = ModelDocument.safeParse(d)
    expect(r.success).toBe(false)
    expect(r.error!.issues.map((i) => i.path.join('.'))).toContain(path)
  }
  it('accepts the loft as built', () => expect(ModelDocument.safeParse(base()).success).toBe(true))
  it('a setpoint', () => refused((d) => { d.zones[1].setpoints.heat_c = 10 }, 'zones.1.setpoints.heat_c'))
  it('a control strategy', () => refused((d) => { d.zones[1].setpoints.control_strategy = 'active_setpoint' }, 'zones.1.setpoints.control_strategy'))
  it('an emitter', () => refused((d) => { d.zones[1].emitters = [{ id: 'e', kind: 'electric', count: 1, rated_output_w: 500, radiant_fraction: 0.2, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }] }, 'zones.1.emitters'))
  it('a ventilation entry', () => refused((d) => { d.zones[1].ventilation = [{ id: 'v', kind: 'mev', enabled: true, flow_rate: 10, flow_rate_basis: 'constant', sfp_w_per_l_s: 1, recovery_sensible_pct: null, control_schedule_ref: null, legacy_v25: null }] }, 'zones.1.ventilation'))
  it('a q50 in place of its air changes', () => refused((d) => { d.zones[1].infiltration_q50 = 5 }, 'zones.1.infiltration_q50'))
  it('no air changes', () => refused((d) => { d.zones[1].infiltration_ach = null }, 'zones.1.infiltration_ach'))
  it('no kind', () => refused((d) => { d.zones[1].unconditioned_kind = null }, 'zones.1.unconditioned_kind'))
  it('a kind on a conditioned zone', () => refused((d) => { d.zones[0].unconditioned_kind = 'ventilated_loft' }, 'zones.0.unconditioned_kind'))
  it('a document without the fields reads every zone as conditioned', () => {
    const d = JSON.parse(JSON.stringify(loftBoxDocument('F0').doc))
    for (const z of d.zones) { delete z.conditioning; delete z.unconditioned_kind }
    const p = ModelDocument.parse(d)
    expect(p.zones.every((z) => z.conditioning === 'conditioned' && z.unconditioned_kind === null)).toBe(true)
  })
})

describe('Brief 123: the loft in the hourly run and the monthly estimate', () => {
  let W: Weather
  beforeAll(async () => { W = await parseEpw(new Uint8Array(fs.readFileSync(repo(ROOF_SPEC.weather.file)))) })
  const OPTS = { ...REFEREE_OPTIONS }

  it('the loft floats with no heating line; each zone closes; the room\'s ceiling line is minus the loft\'s', () => {
    const { doc, lib } = loftBoxDocument('L1')
    const r = runModel(doc, W, lib, OPTS)
    const [room, loft] = r.zones
    expect(loft.annual.heating_kwh).toBe(0)
    expect(loft.annual.cooling_kwh).toBe(0)
    expect(loft.breakdown.some((l) => l.term === 'heating' || l.term === 'cooling')).toBe(false)
    closes(room.breakdown); closes(loft.breakdown)
    const iz = (z: typeof room) => sum(z.breakdown.filter((l) => l.term === 'interzone').map((l) => l.kwh))
    expect(iz(room)).toBeLessThan(0)
    expect(iz(room) + iz(loft)).toBeCloseTo(0, 6)
    // A winter night: the loft is far below the room and near outside. On a clear night the bare tiles see the sky and
    // the loft falls a little below outside (16 Jan 03:00: −6.6 °C against −5.6 °C; EnergyPlus −6.9 °C, and below
    // outside in 3,575 hours of its year), so "between outside and the room" holds only under cloud. A sunny noon: above.
    const t = loft.hourly.theta_air_c, tr = room.hourly.theta_air_c, te = W.hours.dry_bulb
    const night = 24 * 15 + 3  // 16 Jan, 03:00
    expect(t[night]).toBeLessThan(tr[night] - 20); expect(Math.abs(t[night] - te[night])).toBeLessThan(2)
    let noon = -1
    for (let d = 160; d < 220 && noon < 0; d++) { const h = 24 * d + 12; if (W.hours.global_horizontal[h] > 800) noon = h }
    expect(noon).toBeGreaterThan(0)
    expect(t[noon]).toBeGreaterThan(te[noon] + 5)
  })

  it('the monthly estimate: each zone closes, the loft has no heating, and the ceiling loss is b·U·A·Δθ with 0 < b < 1', () => {
    const { doc, lib } = loftBoxDocument('L1')
    const m = runMonthly(doc, W, lib, { solar: OPTS.solar, glazing_solar: OPTS.glazing_solar, internal_gains: 'none' })
    const [room, loft] = m.zones
    closes(room.breakdown); closes(loft.breakdown)
    expect(loft.heating_kwh).toBe(0)
    expect(loft.floor_m2).toBe(0)
    const iz = sum(room.breakdown.filter((l) => l.term === 'interzone').map((l) => l.kwh))
    expect(room.breakdown.find((l) => l.term === 'interzone')!.surface_id).toBe('ceiling')
    expect(m.notes.some((n) => /loft/.test(n))).toBe(true)
    // b = the ceiling's loss over the same ceiling straight to outside, U·A·Σ(θi − θe) (heated to 21 °C all year).
    const UA = runModel(doc, W, lib, OPTS).zones[0].conductances.elements.find((e) => e.surface_id === 'ceiling')!.h_w_per_k
    const b = (-iz * 1000) / (UA * sum(Array.from(W.hours.dry_bulb, (x) => 21 - x)))
    expect(b).toBeGreaterThan(0.5); expect(b).toBeLessThan(1)
  })

  it('Fabric only heats the room and leaves the loft unheated', () => {
    const { doc } = loftBoxDocument('L1')
    const f = levelDocument(doc, 'fabric', 21)
    expect(f.zones[0].setpoints.heat_c).toBe(21)
    expect(f.zones[1].conditioning).toBe('unconditioned')
    expect(f.zones[1].setpoints.heat_c).toBeNull()
    expect(f.zones[1].setpoints.control_strategy).toBeNull()
  })

  it('a loft adds no floor area', () => {
    expect(readDocFloorM2(loftBoxDocument('L1').doc)).toBe(200)
    expect(readDocFloorM2(loftBoxDocument('F0').doc)).toBe(200)
  })

  it('under a cold roof the room\'s leakage still counts the ceiling (today\'s method): q50 leakage equal to the flat box', () => {
    const leak = (c: string) => {
      const { doc, lib } = loftBoxDocument(c)
      const d = JSON.parse(JSON.stringify(doc)); d.zones[0].infiltration_q50 = 5; d.zones[0].infiltration_ach = null
      return runModel(ModelDocument.parse(d), W, lib, OPTS).zones[0].conductances.infiltration.h_w_per_k
    }
    expect(leak('L1')).toBeCloseTo(leak('F0'), 9)
  })
})

describe('Brief 123: design heat loss through the ceiling to a ventilated loft', () => {
  it('the loft sits at the outdoor design temperature unless stated; the room\'s line is "to_loft"; the loft is not in the total', async () => {
    const { designHeatLoss } = await import('../designHeatLoss')
    const W = await parseEpw(new Uint8Array(fs.readFileSync(repo(ROOF_SPEC.weather.file))))
    const { doc, lib } = loftBoxDocument('L1')
    const d = JSON.parse(JSON.stringify(doc))
    d.building.design = { outdoor: { stated_c: -5 }, warm_up_w_per_m2: null, vent_wind_m_s: null }
    d.zones[0].design_internal_c = 'follow_heat_c'
    const m = ModelDocument.parse(d)
    const r = designHeatLoss(m, runModel(m, W, lib, REFEREE_OPTIONS).zones, W)
    const [room, loft] = r.zones
    expect(loft.internal_c).toBe(-5); expect(loft.internal_source).toBe('outdoor_design'); expect(loft.heated).toBe(false)
    const c = room.lines.find((l) => l.surface_id === 'ceiling')!
    expect(c.term).toBe('to_loft'); expect(c.delta_t_k).toBe(26)
    expect(r.building_w).toBeCloseTo(room.total_w, 9)
  })
})
