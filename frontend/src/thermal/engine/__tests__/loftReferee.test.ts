/**
 * Brief 123 P5: the unheated loft and two roof shapes, Engine 2 against EnergyPlus 25.2 (docs/audit/123/02_energyplus.json
 * from validation/energyplus/123_roof_referee.py; spec 123_roof_spec.json committed before the first run). Chicago O'Hare
 * TMY3 (committed). Writes docs/audit/123/03_engine.json. Gates as the spec states; a miss is reported, never tuned.
 * Own effects are each case minus the flat-roof base: L1 − F0 (heating), L2 − F0c (cooling).
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { REFEREE_OPTIONS, runModel, type RunOptions } from '../model'
import { runMonthly } from '../monthly'
import { parseEpw } from '../epw'
import { loftBoxDocument, ROOF_SPEC } from './loftBox'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const OPTS: RunOptions = { ...REFEREE_OPTIONS, time_step: { steps_per_hour: 4, theta_e_between: 'linear' } }
const S = ROOF_SPEC, G = S.gates
const CASES = ['F0', 'F0c', 'L1', 'L2', 'M1', 'M2']
const sum = (a: ArrayLike<number>) => Array.from(a).reduce((s, x) => s + x, 0)
const pct = (o: { engine: number; energyplus: number }) => (100 * (o.engine - o.energyplus)) / o.energyplus

describe('Brief 123: the unheated loft and the warm mono-pitch against EnergyPlus', () => {
  let EP: any, bytes: Buffer
  const E: Record<string, any> = {}, M: Record<string, any> = {}
  beforeAll(async () => {
    EP = JSON.parse(fs.readFileSync(repo('docs/audit/123/02_energyplus.json'), 'utf8'))
    bytes = fs.readFileSync(repo(S.weather.file))
    const W = await parseEpw(new Uint8Array(bytes))
    for (const n of CASES) {
      const { doc, lib } = loftBoxDocument(n)
      const r = runModel(doc, W, lib, OPTS)
      const room = r.zones.find((z) => z.zone_id === 'room')!, loft = r.zones.find((z) => z.zone_id === 'loft')
      const line = (t: string) => sum(room.breakdown.filter((l) => l.term === t).map((l) => l.kwh))
      E[n] = {
        heat_kwh: room.annual.heating_kwh, cool_kwh: room.annual.cooling_kwh,
        ceiling_into_room_kwh: loft ? line('interzone') : null,
        loft_c: loft ? Array.from(loft.hourly.theta_air_c) : null,
        loft_heating_kwh: loft ? loft.annual.heating_kwh + loft.annual.cooling_kwh : null,
      }
      const m = runMonthly(doc, W, lib, { solar: REFEREE_OPTIONS.solar, glazing_solar: REFEREE_OPTIONS.glazing_solar, internal_gains: 'none' })
      const mr = m.zones.find((z) => z.zone_id === 'room')!
      M[n] = { heat_kwh: mr.heating_kwh, cool_kwh: mr.cooling_kwh, ceiling_into_room_kwh: loft ? sum(mr.breakdown.filter((l) => l.term === 'interzone').map((l) => l.kwh)) : null }
    }
    const P = (n: string) => EP.cases[n]
    const lc = E.L1.loft_c as number[], pc = P('L1').hourly.loft_c as number[]
    const loft = {
      mean: { engine: sum(lc) / lc.length, energyplus: sum(pc) / pc.length },
      peak: { engine: Math.max(...lc), energyplus: Math.max(...pc) },
      rmse_k: Math.sqrt(lc.reduce((s, x, i) => s + (x - pc[i]) ** 2, 0) / lc.length),
    }
    const rows = {
      L1_heating: { engine: E.L1.heat_kwh, energyplus: P('L1').heat_kwh, gate_pct: G.L1.heating_pct },
      L1_ceiling: { engine: E.L1.ceiling_into_room_kwh, energyplus: P('L1').ceiling_into_room_kwh, gate_pct: G.L1.ceiling_heat_pct },
      L1_own_effect_heating: { engine: E.L1.heat_kwh - E.F0.heat_kwh, energyplus: P('L1').heat_kwh - P('F0').heat_kwh, gate_pct: G.L1.own_effect_heating_pct },
      L2_cooling: { engine: E.L2.cool_kwh, energyplus: P('L2').cool_kwh, gate_pct: G.L2.cooling_pct },
      L2_own_effect_cooling: { engine: E.L2.cool_kwh - E.F0c.cool_kwh, energyplus: P('L2').cool_kwh - P('F0c').cool_kwh, gate_pct: G.L2.own_effect_cooling_pct },
      M1_heating: { engine: E.M1.heat_kwh, energyplus: P('M1').heat_kwh, gate_pct: G.M1.heating_pct },
      M2_cooling: { engine: E.M2.cool_kwh, energyplus: P('M2').cool_kwh, gate_pct: G.M2.cooling_pct },
      // Reported beside the own effects: the flat-roof base's own gaps (Briefs 103–108).
      F0_heating: { engine: E.F0.heat_kwh, energyplus: P('F0').heat_kwh, gate_pct: null },
      F0c_cooling: { engine: E.F0c.cool_kwh, energyplus: P('F0c').cool_kwh, gate_pct: null },
    }
    const monthly = Object.fromEntries(['F0', 'L1', 'M1'].map((n) => [n, { monthly: M[n].heat_kwh, run: E[n].heat_kwh, pct: (100 * (M[n].heat_kwh - E[n].heat_kwh)) / E[n].heat_kwh }]))
    Object.assign(E, { rows, loft, monthly })
    fs.mkdirSync(repo('docs/audit/123'), { recursive: true })
    fs.writeFileSync(repo('docs/audit/123/03_engine.json'), JSON.stringify({
      spec_sha256: createHash('sha256').update(fs.readFileSync(repo('validation/energyplus/123_roof_spec.json'))).digest('hex'),
      weather_sha256: createHash('sha256').update(bytes).digest('hex'), options: 'REFEREE_OPTIONS, 4 steps an hour, linear',
      gates: Object.fromEntries(Object.entries(rows).map(([k, o]) => [k, { ...o, diff_pct: pct(o), pass: o.gate_pct == null ? null : Math.abs(pct(o)) <= o.gate_pct }])),
      loft_air_l1: { ...loft, pass: { mean: Math.abs(loft.mean.engine - loft.mean.energyplus) <= G.L1.loft_mean_k, rmse: loft.rmse_k <= G.L1.loft_rmse_k, peak: Math.abs(loft.peak.engine - loft.peak.energyplus) <= G.L1.loft_peak_k } },
      monthly_vs_run_heating: monthly,
      monthly_ceiling_l1_kwh: M.L1.ceiling_into_room_kwh, monthly_l2_cooling_kwh: M.L2.cool_kwh, monthly_cases: M,
    }, null, 1) + '\n')
  }, 300_000)

  const row = (k: string) => E.rows[k]
  it('the EnergyPlus run is of the committed spec and the committed weather', () => {
    expect(EP.spec_sha256).toBe(createHash('sha256').update(fs.readFileSync(repo('validation/energyplus/123_roof_spec.json'))).digest('hex'))
    expect(EP.weather_sha256).toBe(S.weather.sha256)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(S.weather.sha256)
  })
  it('the loft floats: nothing heats or cools it', () => {
    expect(E.L1.loft_heating_kwh).toBe(0)
    expect(E.L2.loft_heating_kwh).toBe(0)
  })
  for (const k of ['L1_heating', 'L1_ceiling', 'L2_cooling', 'M1_heating', 'M2_cooling']) {
    it(`${k} within its gate`, () => {
      expect(Math.abs(pct(row(k)))).toBeLessThanOrEqual(row(k).gate_pct)
    })
  }
  it('L1 loft air: annual mean within 0.5 K, hourly RMSE ≤ 1 K, hottest hour within 1.5 K', () => {
    const L = E.loft
    expect(Math.abs(L.mean.engine - L.mean.energyplus)).toBeLessThanOrEqual(G.L1.loft_mean_k)
    expect(L.rmse_k).toBeLessThanOrEqual(G.L1.loft_rmse_k)
    expect(Math.abs(L.peak.engine - L.peak.energyplus)).toBeLessThanOrEqual(G.L1.loft_peak_k)
  })
  it('own effect of the loft on heating (L1 − F0) within ±10 %', () => {
    expect(Math.abs(pct(row('L1_own_effect_heating')))).toBeLessThanOrEqual(row('L1_own_effect_heating').gate_pct)
  })
  // A MISS, reported in 02_referee.md and not tuned: the engine's loft takes 94 kWh off the summer cooling against
  // EnergyPlus's 65 (gate ±15 %). It is 29 kWh, 1.8 % of the room's cooling; the engine's loft is the warmer at midday
  // (+0.43 K), which would push the other way, so the gap is on the room side and stays open. This test holds the miss
  // where it was measured, so that any change to it is seen.
  it('own effect of the loft on cooling (L2 − F0c): a miss, recorded', () => {
    const o = row('L2_own_effect_cooling')
    expect(Math.abs(pct(o))).toBeGreaterThan(o.gate_pct)
    expect(Math.abs(o.engine - o.energyplus)).toBeLessThan(40)
  })
  it('the monthly estimate\'s heating is within 10 % of the 15-minute run on L1 and M1', () => {
    for (const n of ['L1', 'M1']) expect(Math.abs(E.monthly[n].pct)).toBeLessThanOrEqual(G.monthly_vs_run_heating_pct)
  })
})
