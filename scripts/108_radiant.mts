/**
 * Brief 108 review F2: Engine 2's radiant heating share against EnergyPlus's ZoneHVAC:Baseboard:RadiantConvective:Electric.
 *
 * Run from frontend/:  npx vite-node ../scripts/108_radiant.mts
 * Reads docs/audit/108/08_radiant_energyplus.json (validation/energyplus/108_radiant_referee.py) and the spec
 * (validation/energyplus/108_radiant_spec.json). EnergyPlus's heat input is its baseboard electricity at efficiency 1
 * (its "Total Heating Energy" is not the input; see 08_radiant.md). Writes docs/audit/108/08_radiant.json.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import { REFEREE_OPTIONS, runModel } from '../frontend/src/thermal/engine/model'
import { cooledRoomDocument } from '../frontend/src/thermal/engine/__tests__/cooledRoom'
import { MOS, readMos } from '../frontend/src/thermal/engine/__tests__/denver'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const RAD = JSON.parse(read('validation/energyplus/108_radiant_spec.json').toString())
const EP = JSON.parse(read('docs/audit/108/08_radiant_energyplus.json').toString())
if (EP.radiant_spec_sha256 !== sha(read('validation/energyplus/108_radiant_spec.json'))) throw new Error('EnergyPlus results are of another radiant spec')
const W = readMos(readFileSync(MOS))
const pct = (a: number, b: number) => +((a / b - 1) * 100).toFixed(1)
const out: Record<string, unknown> = {}
for (const [name, caps] of Object.entries<Record<string, number>>(RAD.cases)) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  for (const z of d.zones) if (caps[z.id]) z.emitters = [{ id: `${z.id}_e`, kind: 'electric', count: 1, rated_output_w: caps[z.id], radiant_fraction: RAD.radiant_fraction, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
  const r = runModel(ModelDocument.parse(d), W, lib, REFEREE_OPTIONS)
  const rooms: Record<string, unknown> = {}
  for (const zid of ['west', 'east']) {
    const z = r.zones.find((x) => x.zone_id === zid)!, p = EP.runs[name].zones[zid]
    const e = { heat_mwh: z.annual.heating_kwh / 1000, unmet_hours: z.annual.unmet_heating_hours ?? 0, min_c: z.annual.min_control_c, peak_w: z.annual.peak_heating_w }
    rooms[zid] = {
      engine2: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, +v.toFixed(3)])),
      energyplus: { heat_mwh: +p.electricity_mwh.toFixed(3), unmet_hours: p.unmet_hours, min_c: +p.min_c.toFixed(3), peak_w: +p.peak_electricity_w.toFixed(1) },
      heating_pct: pct(e.heat_mwh, p.electricity_mwh), unmet_diff_h: e.unmet_hours - p.unmet_hours, min_diff_k: +(e.min_c - p.min_c).toFixed(2),
    }
  }
  out[name] = { caps, rooms }
}
const res = { source: 'scripts/108_radiant.mts', radiant_fraction: RAD.radiant_fraction, cases: out }
writeFileSync(path.join(root, 'docs/audit/108/08_radiant.json'), JSON.stringify(res, null, 1) + '\n')
console.log(JSON.stringify(res, null, 1))
