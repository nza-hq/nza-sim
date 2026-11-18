/**
 * Brief 115: Linzie's two tests on the community centre's open-plan office, Engine 2 against EnergyPlus AirflowNetwork
 * (docs/audit/115/04_office_energyplus.json from validation/energyplus/115_office_referee.py, spec 115_office_spec.json
 * committed before the first run). Gatwick IWEC weather is not redistributable: set NZA_GATWICK_EPW to the file to run
 * this; without it the test skips. Writes docs/audit/115/04_office_engine.json. Gates as the spec states; own effects are
 * each case minus "shut" (heating) or "cooled" (cooling). Temperatures are air temperatures on both sides.
 */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { REFEREE_OPTIONS, runModel, type RunOptions } from '../model'
import { parseEpw } from '../epw'
import { officeDocument, OFFICE_SPEC } from './officeBox'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
// As airReferee.test.ts's AIR_REFEREE_OPTIONS (4 steps an hour, linear), with the gains from profiles.
const OPTS: RunOptions = { ...REFEREE_OPTIONS, time_step: { steps_per_hour: 4, theta_e_between: 'linear' }, internal_gains: 'profiles' }
const EPW = process.env.NZA_GATWICK_EPW ?? ''
const EP_PATH = repo('docs/audit/115/04_office_energyplus.json')
const have = !!EPW && fs.existsSync(EPW) && fs.existsSync(EP_PATH)

describe.skipIf(!have)('Brief 115: the community centre office against EnergyPlus', () => {
  let EP: any, bytes: Buffer, O: any, E: Record<string, any>, P: Record<string, any>
  const S = OFFICE_SPEC
  const pct = (o: { engine: number; energyplus: number }) => (100 * (o.engine - o.energyplus)) / o.energyplus
  beforeAll(async () => {
  EP = JSON.parse(fs.readFileSync(EP_PATH, 'utf8'))
  bytes = fs.readFileSync(EPW)
  const W = await parseEpw(new Uint8Array(bytes))
  const inUse: boolean[] = []
  for (let d = 0; d < 365; d++) for (let h = 0; h < 24; h++) inUse.push(d % 7 < 5 && S.hours.weekday[h] === 1)
  // Dec–Feb: hours 0..1415 (Jan, Feb) and 8016..8759 (Dec).
  const djf = (h: number) => h < 1416 || h >= 8016
  const read = (heat: number[], cool: number[], t: number[], inflow: number[], open: number[]) => {
    let a25 = 0, max = -Infinity, hd = 0
    for (let h = 0; h < t.length; h++) {
      if (inUse[h]) { if (t[h] > 25) a25++; if (t[h] > max) max = t[h] }
      if (djf(h)) hd += heat[h] / 1000
    }
    return {
      heat_kwh: heat.reduce((s, x) => s + x, 0) / 1000, cool_kwh: cool.reduce((s, x) => s + x, 0) / 1000, heat_djf_kwh: hd,
      hours_above_25_in_use: a25, max_in_use_c: max, inflow_t: inflow.reduce((s, x) => s + x, 0) / 1000, hours_open: open.filter((x) => x > 0).length,
    }
  }
  E = {}; P = {}
  for (const n of Object.keys(S.cases)) {
    const { doc, lib } = officeDocument(n)
    const z = runModel(doc, W, lib, OPTS).zones[0]
    E[n] = read(Array.from(z.hourly.heating_w), Array.from(z.hourly.cooling_w), Array.from(z.hourly.theta_air_c), Array.from(z.air!.inflow_kg_per_h), Array.from(z.air!.window_open_fraction))
    const h = EP.cases[n].hourly
    P[n] = read(h.heat_wh, h.cool_wh, h.theta_air_c, h.inflow_kg, h.open_factor)
  }
  const own = (a: string, b: string, k: string) => ({ engine: E[a][k] - E[b][k], energyplus: P[a][k] - P[b][k] })
  O = {
    wide_heating: own('wide', 'shut', 'heat_kwh'), wide_djf_heating: own('wide', 'shut', 'heat_djf_kwh'),
    mixed_cooling: own('mixed', 'cooled', 'cool_kwh'), passive_heating: own('passive', 'shut', 'heat_kwh'),
  }
  fs.writeFileSync(repo('docs/audit/115/04_office_engine.json'), JSON.stringify({
    spec_sha256: createHash('sha256').update(fs.readFileSync(repo('validation/energyplus/115_office_spec.json'))).digest('hex'),
    weather_sha256: createHash('sha256').update(bytes).digest('hex'), options: "REFEREE_OPTIONS, 4 steps an hour, internal_gains 'profiles'",
    cases: Object.fromEntries(Object.keys(S.cases).map((n) => [n, { engine: E[n], energyplus: P[n] }])),
    own_effects: Object.fromEntries(Object.entries(O).map(([k, o]) => [k, { ...o, miss_pct: pct(o) }])),
  }, null, 1) + '\n')
  }, 120_000)
  it('the EnergyPlus run is of the committed spec and the same weather', () => {
    expect(EP.spec_sha256).toBe(createHash('sha256').update(fs.readFileSync(repo('validation/energyplus/115_office_spec.json'))).digest('hex'))
    expect(EP.weather_sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
  it(`windows open all winter: their own effect on heating ±${S.gates.wide_heating_own_effect_pct} %, and on Dec–Feb heating`, () => {
    expect(Math.abs(pct(O.wide_heating))).toBeLessThanOrEqual(S.gates.wide_heating_own_effect_pct)
    expect(Math.abs(pct(O.wide_djf_heating))).toBeLessThanOrEqual(S.gates.wide_djf_heating_own_effect_pct)
  })
  it('passive cooling: hours above 25 °C in use ±10 % or ±20 h; warmest hour in use within 0.5 K', () => {
    const d = E.passive.hours_above_25_in_use - P.passive.hours_above_25_in_use
    expect(Math.abs(d) <= 20 || Math.abs(d) <= 0.1 * P.passive.hours_above_25_in_use).toBe(true)
    expect(Math.abs(E.passive.max_in_use_c - P.passive.max_in_use_c)).toBeLessThanOrEqual(S.gates.passive_max_in_use_k)
  })
  it(`mixed mode: the windows' own effect on cooling ±${S.gates.mixed_cooling_own_effect_pct} %`, () => {
    expect(Math.abs(pct(O.mixed_cooling))).toBeLessThanOrEqual(S.gates.mixed_cooling_own_effect_pct)
  })
})

describe('Brief 115 review F10: the office window is the community centre\'s top-hung window as the engine reads it', () => {
  it('0.098 (the spec) is windowEffectiveArea for 30 % of the glass, top-hung at 20°, to the spec\'s three places', async () => {
    const { windowEffectiveArea } = await import('../airflow')
    const f = windowEffectiveArea({ openable_fraction: 0.3, style: 'top_hung', opening_angle_deg: 20 }, 'office')
    expect(Math.abs(f - OFFICE_SPEC.window.openable_fraction)).toBeLessThan(5e-4)
  })
})
