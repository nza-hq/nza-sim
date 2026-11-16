/**
 * Brief 114, owed from Brief 120 (review F11): a cooling system's capacity against EnergyPlus.
 *
 * Run from frontend/:  npx vite-node ../scripts/114_cooling_capacity.mts
 * The cooled room's middle room, cooled by one system whose capacity_kw is Brief 119's cap ('tight' 800 W, 'mild'
 * 1,100 W; validation/energyplus/119_cooling_spec.json), with no cooling units stated. EnergyPlus: the committed
 * Brief 119 run (docs/audit/119/02_energyplus.json, ideal loads at LimitCapacity, total capacity). With one room on
 * the system, the plant limit and a unit limit should give the same room; the run is compared with both, under
 * Brief 119's gate (annual cooling ±10 %, hours above ±20 % or ±50 h, highest ±1 K). This checks the plant path's
 * cooling direction; how a short cooling plant shares between rooms (in proportion to ask) stays unrefereed.
 * Writes docs/audit/114/05_cooling_capacity.json.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import { REFEREE_OPTIONS, runModel, type ModelResults } from '../frontend/src/thermal/engine/index'
import { cooledRoomDocument } from '../frontend/src/thermal/engine/__tests__/cooledRoom'
import { MOS, readMos } from '../frontend/src/thermal/engine/__tests__/denver'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const SPEC = JSON.parse(read('validation/energyplus/119_cooling_spec.json').toString())
const EP = JSON.parse(read('docs/audit/119/02_energyplus.json').toString())
if (EP.spec_sha256 !== sha(read('validation/energyplus/119_cooling_spec.json'))) throw new Error('EnergyPlus results are of another caps file')
const W = readMos(readFileSync(MOS))
const pct = (a: number, b: number) => +((a / b - 1) * 100).toFixed(1)
const row = (r: ModelResults) => {
  const z = r.zones.find((x) => x.zone_id === 'middle')!
  return { cool_mwh: +(z.annual.cooling_kwh / 1000).toFixed(4), unmet_h: z.annual.unmet_cooling_hours ?? 0, max_c: +z.annual.max_control_c.toFixed(3) }
}
const out: Record<string, unknown> = {}
let pass = true
for (const [name, caps] of Object.entries<Record<string, number>>(SPEC.cases)) {
  const run = (how: 'plant' | 'unit') => {
    const { doc, lib } = cooledRoomDocument()
    const d: any = structuredClone(doc)
    const cool = d.system_groups.find((g: any) => g.service === 'cooling')
    if (!cool) d.system_groups.push({ id: 'chiller', service: 'cooling', zones: ['middle'], enabled: true, share_pct: 100, source: 'electricity', efficiency_metric: 3 })
    const g = d.system_groups.find((x: any) => x.service === 'cooling')
    g.zones = ['middle']
    if (how === 'plant') g.capacity_kw = caps.middle / 1000
    else d.zones.find((z: any) => z.id === 'middle').emitters = [{ id: 'u', kind: 'vrf_indoor', count: 1, heats: false, cooling_output_w: caps.middle, rated_output_w: null, radiant_fraction: null, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
    return runModel(ModelDocument.parse(d), W, lib, REFEREE_OPTIONS)
  }
  const rp = run('plant'), ru = run('unit')
  const p = EP.cooled_room[name].zones.middle
  const e = row(rp), u = row(ru)
  const du = e.unmet_h - p.unmet_hours
  const g = { cooling_pct: pct(e.cool_mwh, p.cool_mwh), unmet_diff_h: du, max_diff_k: +(e.max_c - p.max_c).toFixed(2) }
  const ok = Math.abs(g.cooling_pct) <= 10 && (Math.abs(du) <= 50 || Math.abs(du / p.unmet_hours) <= 0.2) && Math.abs(g.max_diff_k) <= 1
  pass &&= ok
  const plant = rp.plants.find((x) => x.zones.some((z) => z.zone_id === 'middle'))
  out[name] = { cap_w: caps.middle, plant_limited: e, unit_limited: u, energyplus: { cool_mwh: p.cool_mwh, unmet_h: p.unmet_hours, max_c: p.max_c }, ...g, passes: ok,
    plant_hours_short: plant ? +plant.hours_short.toFixed(1) : null, plant_equals_unit: JSON.stringify(e) === JSON.stringify(u) }
}
const res = { source: 'scripts/114_cooling_capacity.mts', spec_sha256: sha(read('validation/energyplus/119_cooling_spec.json')), energyplus: 'docs/audit/119/02_energyplus.json', passes: pass, cases: out }
writeFileSync(path.join(root, 'docs/audit/114/05_cooling_capacity.json'), JSON.stringify(res, null, 1) + '\n')
console.log(JSON.stringify(res, null, 1))
