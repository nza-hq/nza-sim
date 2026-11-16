/**
 * Brief 120 Part 2: Engine 2's plant capacity against EnergyPlus's DistrictHeating:Water at its nominal capacity.
 *
 * Run from frontend/:  npx vite-node ../scripts/120_referee.mts
 * Reads docs/audit/120/02_energyplus.json (validation/energyplus/120_plant_referee.py) and the spec
 * (validation/energyplus/120_plant_spec.json). The cooled room's west and east rooms get one radiator each, rated at the
 * spec's flow, return and room, exponent 1, all convective, on one heating system at that flow and return whose
 * capacity_kw is the spec's plant_w. Gate (fixed before any run): per room and case, annual heating within ±3 %; unmet
 * hours within ±10 % or ±10 h, whichever is larger. Each room's share of the plant in the plant's short hours is
 * reported, not gated. Writes docs/audit/120/02_referee.json.
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
const SPEC_PATH = 'validation/energyplus/120_plant_spec.json'
const SPEC = JSON.parse(read(SPEC_PATH).toString())
const EP = JSON.parse(read('docs/audit/120/02_energyplus.json').toString())
if (EP.spec_sha256 !== sha(read(SPEC_PATH))) throw new Error('EnergyPlus results are of another plant spec')
const W = readMos(readFileSync(MOS))
if (EP.weather_mos_sha256 && EP.weather_mos_sha256 !== W.sha256) throw new Error('EnergyPlus ran on other weather')
const G = SPEC.gate
const pct = (a: number, b: number) => +((a / b - 1) * 100).toFixed(1)
const r3 = (v: number) => +v.toFixed(3)
const out: Record<string, unknown> = {}
let pass = true
for (const [name, c] of Object.entries<any>(SPEC.cases)) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  const caps: Record<string, number> = c.radiators
  d.system_groups = [{ id: 'lthw', service: 'heating', zones: Object.keys(caps), enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, capacity_kw: c.plant_w / 1000, design_flow_c: SPEC.flow_c, design_return_c: SPEC.return_c }]
  for (const z of d.zones) if (caps[z.id]) z.emitters = [{ id: `${z.id}_rad`, kind: 'radiator', count: 1, rated_output_w: caps[z.id], radiant_fraction: SPEC.radiant_fraction, system_group_id: 'lthw', rated_flow_c: SPEC.flow_c, rated_return_c: SPEC.return_c, rated_room_c: SPEC.rated_room_c, exponent_n: SPEC.exponent_n }]
  const r = runModel(ModelDocument.parse(d), W, lib, REFEREE_OPTIONS)
  const plant = r.plants.find((p) => p.id === 'lthw')!
  const zs = Object.keys(caps).map((zid) => r.zones.find((x) => x.zone_id === zid)!)
  // The plant's short hours, read from the zones' own hourly heating: what they took sums to the capacity.
  const H = zs[0].hourly.heating_w.length
  let shortH = 0
  const took: Record<string, number> = Object.fromEntries(zs.map((z) => [z.zone_id, 0]))
  for (let h = 0; h < H; h++) {
    const sum = zs.reduce((s, z) => s + z.hourly.heating_w[h], 0)
    if (sum >= c.plant_w - 1) { shortH++; for (const z of zs) took[z.zone_id] += z.hourly.heating_w[h] }
  }
  const tookAll = Object.values(took).reduce((a, b) => a + b, 0)
  const rooms: Record<string, unknown> = {}
  for (const z of zs) {
    const p = EP.runs[name].rooms[z.zone_id]
    const e = { heat_mwh: z.annual.heating_kwh / 1000, unmet_hours: z.annual.unmet_heating_hours ?? 0, min_c: z.annual.min_control_c }
    const heatPct = pct(e.heat_mwh, p.heat_mwh)
    const unmetDiff = e.unmet_hours - p.unmet_hours
    const unmetTol = Math.max(G.unmet_hours_floor_h, (G.unmet_hours_pct / 100) * p.unmet_hours)
    const ok = Math.abs(heatPct) <= G.annual_heating_pct && Math.abs(unmetDiff) <= unmetTol
    pass &&= ok
    rooms[z.zone_id] = {
      energyplus: { heat_mwh: r3(p.heat_mwh), unmet_hours: p.unmet_hours, min_c: r3(p.min_c), share_in_short: p.share_of_plant_in_short_steps == null ? null : r3(p.share_of_plant_in_short_steps) },
      engine2: { heat_mwh: r3(e.heat_mwh), unmet_hours: e.unmet_hours, min_c: r3(e.min_c), share_in_short: tookAll > 0 ? r3(took[z.zone_id] / tookAll) : null, closure_max_wh: z.closure.max_wh },
      heating_pct: heatPct, unmet_diff_h: unmetDiff, unmet_tolerance_h: +unmetTol.toFixed(1), min_diff_k: +(e.min_c - p.min_c).toFixed(2), passes: ok,
    }
  }
  out[name] = {
    plant_w: c.plant_w, radiators_w: caps,
    plant: {
      energyplus: { heat_mwh: r3(EP.runs[name].plant.heat_mwh), short_hours: EP.runs[name].plant.short_hours, min_flow_c: r3(EP.runs[name].plant.min_flow_c) },
      engine2: { delivered_mwh: r3(plant.delivered_kwh / 1000), ask_mwh: r3(plant.ask_kwh / 1000), short_hours: +plant.hours_short.toFixed(1), short_hours_read_from_zones: shortH, peak_ask_w: +plant.peak_ask_w.toFixed(1), short_kwh: +plant.short_kwh.toFixed(1) },
    },
    rooms,
  }
}
const res = { source: 'scripts/120_referee.mts', spec_sha256: sha(read(SPEC_PATH)), gate: G, passes: pass, cases: out }
writeFileSync(path.join(root, 'docs/audit/120/02_referee.json'), JSON.stringify(res, null, 1) + '\n')
console.log(JSON.stringify(res, null, 1))
