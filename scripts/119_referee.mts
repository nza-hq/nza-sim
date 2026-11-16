/**
 * Brief 119 Part 2: cooling limited to the room's units, Engines 1/2 against EnergyPlus's ideal loads at LimitCapacity.
 *
 * Run from frontend/:  npx vite-node ../scripts/119_referee.mts
 * Reads the committed EnergyPlus results (docs/audit/119/02_energyplus.json, from validation/energyplus/119_cooling_referee.py)
 * and the caps (validation/energyplus/119_cooling_spec.json); needs the anchor EPW for Bridgewater (checked by sha).
 * Writes docs/audit/119/02_referee.json.
 *
 * The caps are a cooling-only VRF indoor unit (heats: false), all convective, as EnergyPlus's ideal loads are.
 * Gate (in the spec, fixed before any run): annual cooling ±10 %, hours above the setpoint ±20 % or ±50 h, highest
 * temperature ±1 K, each limited zone against EnergyPlus.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import { parseEpw, REFEREE_OPTIONS, runModel, type ModelResults } from '../frontend/src/thermal/engine/index'
import { RUN_OPTIONS } from '../frontend/src/sim2/run/seam'
import { cooledRoomDocument } from '../frontend/src/thermal/engine/__tests__/cooledRoom'
import { MOS, readMos } from '../frontend/src/thermal/engine/__tests__/denver'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const SPEC = JSON.parse(read('validation/energyplus/119_cooling_spec.json').toString())
const EP = JSON.parse(read('docs/audit/119/02_energyplus.json').toString())
if (EP.spec_sha256 !== sha(read('validation/energyplus/119_cooling_spec.json'))) throw new Error('EnergyPlus results are of another caps file')
if (EP.cooled_spec_sha256 !== sha(read('validation/energyplus/104_cooled_room_spec.json'))) throw new Error('cooled-room EnergyPlus results are of another spec')

const unit = (id: string, w: number) => ({ id, kind: 'vrf_indoor', count: 1, heats: false, cooling_output_w: w, rated_output_w: null, radiant_fraction: null, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null })
const pct = (a: number, b: number) => +((a / b - 1) * 100).toFixed(1)
type Row = { cool: number; unmet: number; max: number }
const gate = (e: Row, p: Row) => {
  const dc = pct(e.cool, p.cool), du = e.unmet - p.unmet, dm = +(e.max - p.max).toFixed(2)
  const unmetOk = Math.abs(du) <= 50 || (p.unmet > 0 && Math.abs(du / p.unmet) <= 0.2)
  return { cooling_pct: dc, unmet_diff_h: du, max_diff_k: dm, pass: Math.abs(dc) <= 10 && unmetOk && Math.abs(dm) <= 1 }
}
const row = (r: ModelResults, zid: string) => {
  const z = r.zones.find((x) => x.zone_id === zid)!
  return { cool: z.annual.cooling_kwh / 1000, unmet: z.annual.unmet_cooling_hours ?? 0, max: z.annual.max_control_c, peak_w: z.annual.peak_cooling_w, hours_at_cap: z.cooling_units?.hours_at_cap ?? 0 }
}
const epRow = (p: any) => ({ cool: p.cool_mwh, unmet: p.unmet_hours, max: p.max_c })
const r3 = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(3)]))

// ── The cooled room ────────────────────────────────────────────────────────────────────────────────────────────
const W = readMos(readFileSync(MOS))
const cooled: Record<string, unknown> = {}
for (const [name, caps] of Object.entries<Record<string, number> | null>({ unlimited: null, ...SPEC.cases })) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  if (caps) for (const z of d.zones) if (caps[z.id]) z.emitters = [unit(`${z.id}_u`, caps[z.id])]
  const r = runModel(ModelDocument.parse(d), W, lib, REFEREE_OPTIONS)
  const e = row(r, 'middle'), p = EP.cooled_room[name].zones.middle
  cooled[name] = { caps, middle: { engine2: r3(e), energyplus: r3({ ...epRow(p), ep_not_met: p.ep_not_met_hours, peak_w: p.peak_cooling_w, latent: p.latent_mwh }), ...gate(e, epRow(p)) } }
}

// ── Bridgewater, five storeys, storey 3 limited ────────────────────────────────────────────────────────────────
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(read('validation/fixtures/bridgewater_anchor_v2.yaml').toString())
const weather = await parseEpw(new Uint8Array(read(path.join('data/weather/current', fx.building_config.weather_file))))
if (weather.sha256 !== EPW_SHA || EP.epw_sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const five = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA }, building_id: 'bridgewater-anchor',
}, { zoning: 'per_storey' })).document as any
const lib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((x: any) => [x.name, x.config_json]))
const bw: Record<string, unknown> = {}
for (const name of ['unlimited', 'limited']) {
  const d = structuredClone(five)
  if (name === 'limited') for (const [ez, w] of Object.entries<number>(SPEC.bridgewater.caps)) d.zones.find((z: any) => z.id === SPEC.bridgewater.engine_zone[ez]).emitters = [unit(`${ez}_u`, w)]
  const r = runModel(ModelDocument.parse(d), weather, lib, RUN_OPTIONS)
  const storeys: Record<string, unknown> = {}
  r.zones.forEach((z, i) => {
    const ez = `Floor_${i + 1}`, p = EP.bridgewater[name].zones[ez], e = row(r, z.zone_id)
    storeys[ez] = { engine2: r3(e), energyplus: r3({ ...epRow(p), ep_not_met: p.ep_not_met_hours, peak_w: p.peak_cooling_w, latent: p.latent_mwh }), ...gate(e, epRow(p)) }
  })
  bw[name] = { caps: name === 'limited' ? SPEC.bridgewater.caps : null, storeys, run_ms: +r.run_ms.toFixed(0) }
}
// Review F2: the brief's own gate (annual cooling ±5 %, hours above ±50 h), shown beside the spec's, and the limit's own
// effect (limited − unlimited annual cooling), engine against EnergyPlus: what this brief changed.
const briefGate = (g: any) => Math.abs(g.cooling_pct) <= 5 && Math.abs(g.unmet_diff_h) <= 50
const effect = (lim: any, unl: any) => ({ engine_mwh: +(lim.engine2.cool - unl.engine2.cool).toFixed(3), energyplus_mwh: +(lim.energyplus.cool - unl.energyplus.cool).toFixed(3) })
for (const [name, c] of Object.entries<any>(cooled)) { c.middle.pass_brief_gate = briefGate(c.middle); if (name !== 'unlimited') c.middle.limit_effect = effect(c.middle, (cooled as any).unlimited.middle) }
for (const [ez, st] of Object.entries<any>((bw as any).limited.storeys)) { st.pass_brief_gate = briefGate(st); if (ez in SPEC.bridgewater.caps) st.limit_effect = effect(st, (bw as any).unlimited.storeys[ez]) }
for (const st of Object.values<any>((bw as any).unlimited.storeys)) st.pass_brief_gate = briefGate(st)
const out = { source: 'scripts/119_referee.mts', spec_sha256: EP.spec_sha256, gate: SPEC.gate, brief_gate: 'annual cooling ±5 %, hours above ±50 h (brief Part 2 as first written)', cooled_room: cooled, bridgewater_five_storeys: bw }
writeFileSync(path.join(root, 'docs/audit/119/02_referee.json'), JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
