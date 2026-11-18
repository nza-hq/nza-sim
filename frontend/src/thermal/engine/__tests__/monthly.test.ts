/**
 * Brief 122 P1: the monthly estimate (static). A box against a hand calculation to the kWh; every zone's lines close;
 * no glazing gives no solar line; a 0 W/K bridge gives no bridging.
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseEpw } from '../epw'
import { runMonthly, MONTHLY_CONSTANTS } from '../monthly'
import { REFEREE_OPTIONS } from '../model'
import { airBoxDocument, AIR_SPEC } from './airBox'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const W = await parseEpw(new Uint8Array(fs.readFileSync(repo(AIR_SPEC.weather.file))))
const OPTS = { solar: REFEREE_OPTIONS.solar, glazing_solar: 'optical' as const, internal_gains: 'none' as const }

/** The air box with today's air, its windows' openings removed, and (optionally) no glazing and no sun or sky. */
function box(opts: { glazing: boolean; dark: boolean; bridges?: { mode: string; multiplier: number | null } }) {
  const { doc, lib } = airBoxDocument(opts.glazing ? 'R2_single' : 'R1_q5')
  const d: any = structuredClone(doc)
  d.building.air = { method: 'today', exponent: null, single_sided_turbulence: null }
  d.controls = []
  for (const s of d.surfaces) {
    s.openings = []
    if (opts.dark && s.kind !== 'glazing') { s.solar_absorptance = 0; s.thermal_emissivity = 0 }
  }
  if (opts.bridges) d.building.thermal_bridging = { ...d.building.thermal_bridging, ...opts.bridges }
  return { doc: d, lib }
}

const closes = (z: { breakdown: { kwh: number }[] }) => Math.abs(z.breakdown.reduce((s, l) => s + l.kwh, 0))

describe('monthly estimate (Brief 122 P1)', () => {
  it('a box with no sun, sky or glazing: heating is Σ U·A·(θ − θe) + infiltration, to the kWh', () => {
    const { doc, lib } = box({ glazing: false, dark: true })
    const r = runMonthly(doc, W, lib, OPTS)
    const z = r.zones[0]
    // By hand: monthly means of the weather file, the elements' own U (from the hourly builder), q50 ÷ 20.
    const hours = new Array(12).fill(0), te = new Array(12).fill(0)
    for (let h = 0; h < W.hours.count; h++) { const m = W.hours.month[h] - 1; hours[m]++; te[m] += W.hours.dry_bulb[h] }
    let tg = 0
    for (let h = 0; h < W.hours.count; h++) tg += W.hours.dry_bulb[h] / W.hours.count
    const cond = z.breakdown.filter((l) => l.term === 'conduction')
    expect(cond.length).toBe(6)
    const ua = z.h_tr_w_per_k
    const V = doc.zones[0].area_m2 * doc.zones[0].height_m
    const A = doc.surfaces.reduce((s: number, x: any) => s + x.area_m2, 0)
    const Hinf = 0.33 * (AIR_SPEC.cases.R1_q5.q50 ?? AIR_SPEC.q50) * A / 20
    expect(z.h_ve_w_per_k).toBeCloseTo(Hinf, 9)
    let hand = 0
    for (let m = 0; m < 12; m++) {
      const dt = doc.zones[0].setpoints.heat_c - te[m] / hours[m]
      if (dt <= 0) continue
      hand += ((ua + Hinf) * dt * hours[m]) / 1000
    }
    // The floor faces outside here (a raised box), so no ground term: every element is against the month's air.
    expect(z.heating_kwh).toBeCloseTo(hand, 0)
    expect(z.breakdown.some((l) => l.term === 'solar_transmitted')).toBe(false)
    expect(z.breakdown.some((l) => l.term === 'bridging' && l.kwh !== 0)).toBe(false)
    expect(closes(z)).toBeLessThan(1e-6)
    void tg
  })

  it('with glazing, sun and sky: the lines close, solar is per window, utilisation below 1', () => {
    const { doc, lib } = box({ glazing: true, dark: false })
    const r = runMonthly(doc, W, lib, OPTS)
    const z = r.zones[0]
    expect(closes(z)).toBeLessThan(1e-6)
    const sol = z.breakdown.filter((l) => l.term === 'solar_transmitted')
    expect(sol.map((l) => l.surface_id)).toEqual(['south_window'])
    expect(sol[0].kwh).toBeGreaterThan(0)
    const unused = z.breakdown.find((l) => l.term === 'gains_not_used')!
    expect(unused.kwh).toBeLessThan(0)
    expect(z.tau_h).toBeGreaterThan(0)
    expect(r.engine).toBe('monthly-static')
    expect(r.notes[0]).toMatch(/Monthly estimate \(static\)/)
    expect(MONTHLY_CONSTANTS.tau_0_h).toBe(15)
  })

  it('a 0 W/K bridge gives no bridging; a stated one gives its line', () => {
    const none = runMonthly(box({ glazing: true, dark: false, bridges: { mode: 'absent', multiplier: null } }).doc, W, box({ glazing: true, dark: false }).lib, OPTS).zones[0]
    expect(none.breakdown.find((l) => l.term === 'bridging')!.kwh).toBe(0)
    const { doc, lib } = box({ glazing: true, dark: false, bridges: { mode: 'iso14683_auto', multiplier: 1 } })
    const some = runMonthly(doc, W, lib, OPTS).zones[0]
    expect(some.breakdown.find((l) => l.term === 'bridging')!.kwh).toBeLessThan(0)
    expect(some.heating_kwh).toBeGreaterThan(none.heating_kwh)
    expect(closes(some)).toBeLessThan(1e-6)
  })

  it('cooling at a cooling setpoint: Q_C ≥ 0 and the lines still close', () => {
    const { doc, lib } = box({ glazing: true, dark: false })
    doc.zones[0].setpoints.cool_c = 24
    const z = runMonthly(doc, W, lib, OPTS).zones[0]
    expect(z.cooling_kwh).toBeGreaterThan(0)
    expect(z.monthly.cooling_kwh.every((x) => x >= 0)).toBe(true)
    expect(closes(z)).toBeLessThan(1e-6)
  })
  it('heating hours with a setback (ISO 13790 13.2.2): less heating than all day, the difference its own line, still closing', () => {
    const { doc, lib } = box({ glazing: true, dark: false })
    const cont = runMonthly(doc, W, lib, OPTS)
    const d: any = structuredClone(doc)
    d.profiles.push({ id: 'day', kind: 'schedule', day_types: { weekday: Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 17 ? 1 : 0)), saturday: Array(24).fill(0), sunday: Array(24).fill(0) } })
    for (const z of d.zones) z.setpoints = { ...z.setpoints, setback_c: 12, hours_ref: 'day' }
    const int = runMonthly(d, W, lib, OPTS)
    const h = (r: typeof cont) => r.zones.reduce((t, z) => t + z.heating_kwh, 0)
    expect(h(int)).toBeLessThan(h(cont))
    const saved = int.zones.flatMap((z) => z.breakdown).filter((l) => l.term === 'intermittent_heating').reduce((t, l) => t + l.kwh, 0)
    expect(saved).toBeGreaterThan(0)
    expect(cont.zones.flatMap((z) => z.breakdown).some((l) => l.term === 'intermittent_heating')).toBe(false)
    for (const z of int.zones) expect(closes(z)).toBeLessThan(1e-6)
  })
})
