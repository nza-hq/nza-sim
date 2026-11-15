/**
 * Brief 108 Part 3: capped heating, Engines 1/2 against EnergyPlus's ideal loads at LimitCapacity.
 *
 * Run from frontend/:  npx vite-node ../scripts/108_referee.mts
 * Reads the committed EnergyPlus results (docs/audit/108/03_*_energyplus.json, from validation/energyplus/108_*.py)
 * and the caps (validation/energyplus/108_capped_spec.json); needs the anchor EPW for Bridgewater (checked by sha).
 * Writes docs/audit/108/03_referee.json.
 *
 * The caps are given as an all-convective fixed-output emitter (radiant_fraction 0), as EnergyPlus's ideal loads are.
 * Gate (proposed in the brief, fixed before the runs): annual heating ±10 %, unmet hours ±20 % or ±50 h, lowest
 * temperature ±1 K, each capped room against EnergyPlus.
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
const CAPS = JSON.parse(read('validation/energyplus/108_capped_spec.json').toString())
const EPC = JSON.parse(read('docs/audit/108/03_cooled_room_capped_energyplus.json').toString())
const EPB = JSON.parse(read('docs/audit/108/03_bridgewater_capped_energyplus.json').toString())
const capsSha = sha(read('validation/energyplus/108_capped_spec.json'))
if (EPC.caps_sha256 !== capsSha) throw new Error('cooled-room EnergyPlus results are of another caps file')
if (EPC.spec_sha256 !== sha(read('validation/energyplus/104_cooled_room_spec.json'))) throw new Error('cooled-room EnergyPlus results are of another spec')

const electric = (id: string, w: number) => ({ id, kind: 'electric', count: 1, rated_output_w: w, radiant_fraction: 0, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null })
const pct = (a: number, b: number) => +((a / b - 1) * 100).toFixed(1)
const gate = (e: { heat: number; unmet: number; min: number }, p: { heat: number; unmet: number; min: number }) => {
  const dh = pct(e.heat, p.heat), du = e.unmet - p.unmet, dm = +(e.min - p.min).toFixed(2)
  const unmetOk = Math.abs(du) <= 50 || (p.unmet > 0 && Math.abs(du / p.unmet) <= 0.2)
  return { heating_pct: dh, unmet_diff_h: du, min_diff_k: dm, pass: Math.abs(dh) <= 10 && unmetOk && Math.abs(dm) <= 1 }
}
const row = (r: ModelResults, zid: string) => {
  const z = r.zones.find((x) => x.zone_id === zid)!
  return { heat: z.annual.heating_kwh / 1000, unmet: z.annual.unmet_heating_hours ?? 0, min: z.annual.min_control_c, peak_w: z.annual.peak_heating_w, hours_at_cap: z.emitters?.hours_at_cap ?? 0 }
}
const r3 = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(3)]))

// ── The cooled room ────────────────────────────────────────────────────────────────────────────────────────────
const W = readMos(readFileSync(MOS))
const cooled: Record<string, unknown> = {}
for (const [name, caps] of Object.entries<Record<string, number> | null>({ uncapped: null, ...CAPS.cases })) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  if (caps) for (const z of d.zones) if (caps[z.id]) z.emitters = [electric(`${z.id}_e`, caps[z.id])]
  const r = runModel(ModelDocument.parse(d), W, lib, REFEREE_OPTIONS)
  const rooms: Record<string, unknown> = {}
  for (const zid of ['west', 'east']) {
    const e = row(r, zid), p = EPC.runs[name].zones[zid]
    rooms[zid] = { engine2: r3(e), energyplus: r3({ heat: p.heat_mwh, unmet: p.unmet_hours, ep_not_met: p.ep_not_met_hours, min: p.min_c, peak_w: p.peak_heating_w }), ...gate(e, { heat: p.heat_mwh, unmet: p.unmet_hours, min: p.min_c }) }
  }
  cooled[name] = { caps, rooms }
}

// ── Bridgewater, five storeys, the top storey capped ───────────────────────────────────────────────────────────
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(read('validation/fixtures/bridgewater_anchor_v2.yaml').toString())
const weather = await parseEpw(new Uint8Array(read(path.join('data/weather/current', fx.building_config.weather_file))))
if (weather.sha256 !== EPW_SHA || EPB.epw_sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
if (EPB.caps_sha256 !== capsSha) throw new Error('Bridgewater EnergyPlus results are of another caps file')
const five = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA }, building_id: 'bridgewater-anchor',
}, { zoning: 'per_storey' })).document as any
const lib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((x: any) => [x.name, x.config_json]))
const bw: Record<string, unknown> = {}
for (const name of ['uncapped', 'capped']) {
  const d = structuredClone(five)
  if (name === 'capped') for (const [ez, w] of Object.entries<number>(CAPS.bridgewater.caps)) d.zones.find((z: any) => z.id === CAPS.bridgewater.engine_zone[ez]).emitters = [electric(`${ez}_e`, w)]
  const r = runModel(ModelDocument.parse(d), weather, lib, RUN_OPTIONS)
  const storeys: Record<string, unknown> = {}
  r.zones.forEach((z, i) => {
    const ez = `Floor_${i + 1}`, p = EPB.runs[name].zones[ez], e = row(r, z.zone_id)
    storeys[ez] = { engine2: r3(e), energyplus: r3({ heat: p.heating_mwh, unmet: p.unmet_hours, ep_not_met: p.ep_not_met_hours, min: p.min_c, peak_w: p.peak_heating_w }), ...gate(e, { heat: p.heating_mwh, unmet: p.unmet_hours, min: p.min_c }) }
  })
  bw[name] = { caps: name === 'capped' ? CAPS.bridgewater.caps : null, storeys, run_ms: +r.run_ms.toFixed(0) }
}
const out = { source: 'scripts/108_referee.mts', caps_sha256: capsSha, gate: 'heating ±10 %, unmet hours ±20 % or ±50 h, lowest temperature ±1 K', cooled_room: cooled, bridgewater_five_storeys: bw }
writeFileSync(path.join(root, 'docs/audit/108/03_referee.json'), JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
