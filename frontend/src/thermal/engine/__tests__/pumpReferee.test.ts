/**
 * Brief 114 Part 2: the pumps against EnergyPlus (validation/energyplus/114_pump_referee.py, 114_pump_spec.json).
 *
 * The 108 hot-water referee's two rooms on radiators at 50/40 ('mild'), Engine 2 at REFEREE_OPTIONS with the rooms
 * rated by the room (as 108's (i)), the heating system's pumps at the spec's power, run three ways. The gate is the
 * spec's, written before either program ran. Results are written to docs/audit/114/02_engine.json for the report.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REFEREE_OPTIONS, runModel } from '../model'
import { readEntryKwh, runSystems } from '../systems'
import { ModelDocument } from '../../schema/model'
import { cooledRoomDocument } from './cooledRoom'
import { MOS, readMos } from './denver'

const W = readMos(fs.readFileSync(MOS))
const repo = (p: string) => new URL(`../../../../../${p}`, import.meta.url)

describe('Brief 114 P2: pumps against EnergyPlus', () => {
  it('fixed with demand ±5 %, variable with demand ±15 %, continuous in the same season ±1 % (the spec\'s gate; all year fails, recorded)', async () => {
    const { createHash } = await import('node:crypto')
    const specFile = fs.readFileSync(repo('validation/energyplus/114_pump_spec.json'))
    const SPEC = JSON.parse(specFile.toString())
    const EP = JSON.parse(fs.readFileSync(repo('docs/audit/114/02_energyplus.json'), 'utf8'))
    expect(EP.pump_spec_sha256).toBe(createHash('sha256').update(specFile).digest('hex'))
    const HW = JSON.parse(fs.readFileSync(repo('validation/energyplus/108_hotwater_spec.json'), 'utf8'))
    const caps: Record<string, number> = HW.cases[SPEC.case]
    const { doc, lib } = cooledRoomDocument()
    const d: any = structuredClone(doc)
    d.system_groups = [
      { id: 'boiler', service: 'heating', zones: ['west', 'east'], enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, design_flow_c: HW.flow_c, design_return_c: HW.return_c },
      { id: 'chiller', service: 'cooling', zones: ['middle'], enabled: true, share_pct: 100, source: 'electricity', efficiency_metric: 3 },
    ]
    for (const z of d.zones) if (caps[z.id]) z.emitters = [{ id: `${z.id}_rad`, kind: 'radiator', count: 1, rated_output_w: caps[z.id], radiant_fraction: HW.radiant_fraction, system_group_id: 'boiler', rated_flow_c: HW.flow_c, rated_return_c: HW.return_c, rated_room_c: HW.rated_room_c, exponent_n: HW.exponent_n }]
    const results = runModel(ModelDocument.parse(d), W, lib, REFEREE_OPTIONS)
    const out: Record<string, unknown> = {}
    const tol: Record<string, number> = { fixed_with_demand: 0.05, fixed_continuous: 0.01, variable_with_demand: 0.15, fixed_continuous_in_season: 0.01 }
    for (const [name, v] of Object.entries<any>(SPEC.variants)) {
      d.system_groups[0].pumps = { power: { w: SPEC.pump_w }, speed: v.speed, runs: v.runs }
      const r = runSystems(ModelDocument.parse(d), results, W.hours)
      if (!r.ok) throw new Error(JSON.stringify(r.missing))
      const p = r.systems.pumps[0], kwh = readEntryKwh(r.systems, 'pumps', p.id)
      const ep = EP.runs[name]
      out[name] = { engine_kwh: kwh, engine_hours_run: p.hours_run, engine_design_w: p.design_w, ep_kwh: ep.pump_kwh, ep_hours_on: ep.hours_pump_on, diff: kwh / ep.pump_kwh - 1 }
    }
    fs.writeFileSync(repo('docs/audit/114/02_engine.json'), JSON.stringify(out, null, 1) + '\n')
    // fixed_continuous fails its gate as written (-25 %), recorded in 02_referee.md: EnergyPlus's Continuous pump runs
    // all year, the brief's 'continuous' its season. Its miss is exactly the out-of-season hours: the engine equals
    // EnergyPlus given the same season (fixed_continuous_in_season, added after the first run).
    const o = out as Record<string, any>
    expect(o.fixed_continuous.diff).toBeLessThan(-0.2)
    expect(o.fixed_continuous.engine_kwh).toBeCloseTo(EP.runs.fixed_continuous_in_season.pump_kwh, 6)
    for (const name of Object.keys(SPEC.variants)) if (name !== 'fixed_continuous') expect(Math.abs(o[name].diff), name).toBeLessThanOrEqual(tol[name])
  })
})
