/**
 * Brief 108 review F1: Engine 2's hourly re-rated radiators against EnergyPlus's hot-water baseboard on a 50 °C loop.
 *
 * Run from frontend/:  npx vite-node ../scripts/108_hotwater.mts
 * Reads docs/audit/108/09_hotwater_energyplus.json (validation/energyplus/108_hotwater_referee.py) and the spec
 * (validation/energyplus/108_hotwater_spec.json). Each heated room gets one radiator rated at the spec's flow, return and
 * setpoint, exponent 1, all convective, on a heating system at that flow and return. Engine 2 runs twice: with the
 * output following the room each hour (emitter_rating 'room', the default) and held at the setpoint ('setpoint').
 * Writes docs/audit/108/09_hotwater.json.
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
const HW = JSON.parse(read('validation/energyplus/108_hotwater_spec.json').toString())
const EP = JSON.parse(read('docs/audit/108/09_hotwater_energyplus.json').toString())
if (EP.hotwater_spec_sha256 !== sha(read('validation/energyplus/108_hotwater_spec.json'))) throw new Error('EnergyPlus results are of another hot-water spec')
const W = readMos(readFileSync(MOS))
const pct = (a: number, b: number) => +((a / b - 1) * 100).toFixed(1)
const r3 = (v: number) => +v.toFixed(3)
const out: Record<string, unknown> = {}
for (const [name, caps] of Object.entries<Record<string, number>>(HW.cases)) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  d.system_groups = [{ id: 'lthw', service: 'heating', zones: Object.keys(caps), enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, design_flow_c: HW.flow_c, design_return_c: HW.return_c }]
  for (const z of d.zones) if (caps[z.id]) z.emitters = [{ id: `${z.id}_rad`, kind: 'radiator', count: 1, rated_output_w: caps[z.id], radiant_fraction: HW.radiant_fraction, system_group_id: 'lthw', rated_flow_c: HW.flow_c, rated_return_c: HW.return_c, rated_room_c: HW.rated_room_c, exponent_n: HW.exponent_n }]
  const m = ModelDocument.parse(d)
  const runs = { room: runModel(m, W, lib, REFEREE_OPTIONS), setpoint: runModel(m, W, lib, { ...REFEREE_OPTIONS, emitter_rating: 'setpoint' }) }
  const rooms: Record<string, unknown> = {}
  for (const zid of Object.keys(caps)) {
    const p = EP.runs[name].zones[zid]
    const row: Record<string, unknown> = { energyplus: { heat_mwh: r3(p.heat_mwh), unmet_hours: p.unmet_hours, min_c: r3(p.min_c), peak_w: +p.peak_heating_w.toFixed(1), k_w_per_k: r3(p.k_measured_median_w_per_k) } }
    for (const [rating, r] of Object.entries(runs)) {
      const z = r.zones.find((x) => x.zone_id === zid)!
      const e = { heat_mwh: z.annual.heating_kwh / 1000, unmet_hours: z.annual.unmet_heating_hours ?? 0, min_c: z.annual.min_control_c, peak_w: z.annual.peak_heating_w }
      row[`engine2_${rating}`] = {
        heat_mwh: r3(e.heat_mwh), unmet_hours: e.unmet_hours, min_c: r3(e.min_c), peak_w: +e.peak_w.toFixed(1),
        heating_pct: pct(e.heat_mwh, p.heat_mwh), unmet_diff_h: e.unmet_hours - p.unmet_hours, min_diff_k: +(e.min_c - p.min_c).toFixed(2),
        closure_max_wh: z.closure.max_wh,
      }
    }
    rooms[zid] = row
  }
  out[name] = { design_output_w: caps, rooms }
}
const res = { source: 'scripts/108_hotwater.mts', flow_c: HW.flow_c, return_c: HW.return_c, exponent_n: HW.exponent_n, radiant_fraction: HW.radiant_fraction, cases: out }
writeFileSync(path.join(root, 'docs/audit/108/09_hotwater.json'), JSON.stringify(res, null, 1) + '\n')
console.log(JSON.stringify(res, null, 1))
