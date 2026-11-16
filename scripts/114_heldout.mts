/**
 * Owed from Brief 120 (review F11): Engine 2's plant capacity on a held-out wet case, against EnergyPlus.
 *
 * Run from frontend/:  npx vite-node ../scripts/114_heldout.mts
 * scripts/120_referee.mts unchanged except for its inputs: the held-out spec (validation/energyplus/114_heldout_spec.json:
 * 70/50, radiators 1,500/700 W, plant 1,300 W, chosen before any run) and its EnergyPlus run
 * (docs/audit/114/05_heldout_energyplus.json, from validation/energyplus/114_heldout_referee.py). Same gate as 120.
 * Writes docs/audit/114/05_heldout.json.
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
const SPEC_PATH = 'validation/energyplus/114_heldout_spec.json'
const SPEC = JSON.parse(read(SPEC_PATH).toString())
const EP = JSON.parse(read('docs/audit/114/05_heldout_energyplus.json').toString())
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
  // The plant's short hours, read from what it gave (review F9: counted as EnergyPlus counts them, given >= 99.9 % of capacity).
  const H = zs[0].hourly.heating_w.length
  let shortH = 0
  const took: Record<string, number> = Object.fromEntries(zs.map((z) => [z.zone_id, 0]))
  for (let h = 0; h < H; h++) {
    const sum = plant.zones.reduce((s, z) => s + z.given_w[h], 0)
    if (sum >= c.plant_w * 0.999) { shortH++; for (const z of zs) took[z.zone_id] += z.hourly.heating_w[h] }
  }
  const tookAll = Object.values(took).reduce((a, b) => a + b, 0)
  const rooms: Record<string, unknown> = {}
  for (const z of zs) {
    const p = EP.runs[name].rooms[z.zone_id]
    const e = { heat_mwh: z.annual.heating_kwh / 1000, unmet_hours: z.annual.unmet_heating_hours ?? 0, min_c: z.annual.min_control_c }
    const heatPct = pct(e.heat_mwh, p.heat_mwh)
    const unmetDiff = e.unmet_hours - p.unmet_hours
    const unmetTol = Math.max(G.unmet_hours_floor_h, (G.unmet_hours_pct / 100) * p.unmet_hours)
    const heatOk = Math.abs(heatPct) <= G.annual_heating_pct, unmetOk = Math.abs(unmetDiff) <= unmetTol
    const ok = heatOk && unmetOk
    pass &&= ok
    rooms[z.zone_id] = {
      energyplus: { heat_mwh: r3(p.heat_mwh), unmet_hours: p.unmet_hours, min_c: r3(p.min_c), share_in_short: p.share_of_plant_in_short_steps == null ? null : r3(p.share_of_plant_in_short_steps) },
      engine2: { heat_mwh: r3(e.heat_mwh), unmet_hours: e.unmet_hours, min_c: r3(e.min_c), share_in_short: tookAll > 0 ? r3(took[z.zone_id] / tookAll) : null, closure_max_wh: z.closure.max_wh },
      heating_pct: heatPct, unmet_diff_h: unmetDiff, unmet_tolerance_h: +unmetTol.toFixed(1), min_diff_k: +(e.min_c - p.min_c).toFixed(2), heating_passes: heatOk, unmet_passes: unmetOk, passes: ok,
    }
  }
  out[name] = {
    plant_w: c.plant_w, radiators_w: caps,
    plant: {
      energyplus: { heat_mwh: r3(EP.runs[name].plant.heat_mwh), short_hours: EP.runs[name].plant.short_hours, min_flow_c: r3(EP.runs[name].plant.min_flow_c), min_flow_c_short_steps: EP.runs[name].plant.min_flow_c_short_steps == null ? null : r3(EP.runs[name].plant.min_flow_c_short_steps) },
      engine2: { delivered_mwh: r3(plant.delivered_kwh / 1000), ask_mwh: r3(plant.ask_kwh / 1000), short_hours: +plant.hours_short.toFixed(1), short_hours_read_from_zones: shortH, peak_ask_w: +plant.peak_ask_w.toFixed(1), asked_not_given_step_sum_kwh: +plant.asked_not_given_step_sum_kwh.toFixed(1), min_flow_c: plant.min_flow_c == null ? null : r3(plant.min_flow_c) },
    },
    rooms,
  }
}
const res = { source: 'scripts/114_heldout.mts', spec_sha256: sha(read(SPEC_PATH)), gate: G, passes: pass, cases: out }
writeFileSync(path.join(root, 'docs/audit/114/05_heldout.json'), JSON.stringify(res, null, 1) + '\n')
console.log(JSON.stringify(res, null, 1))
