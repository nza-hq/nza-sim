/**
 * Brief 109 Part 3: Engine 2 with underfloor heating in the cooled room's heated floors (heat into the floor at the
 * insulation's inside face, layer 0), office hours and a 15 °C setback, against EnergyPlus's electric low-temperature
 * radiant system in the same layer (validation/energyplus/109_ufh_referee.py). Each case's limit is the underfloor
 * emitter's output, rated with the room at its setpoint (emitter_rating 'setpoint': a fixed limit, as EnergyPlus's
 * heating design capacity). The control differs (decision 5): the engine holds the setpoint while it can, EnergyPlus
 * ramps over a 0.5 K throttling range centred on it. Same summaries and gate as Part 2.
 *
 * Run from frontend/:  npx vite-node ../scripts/109_ufh.mts        Writes docs/audit/109/03_ufh.json.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import { REFEREE_OPTIONS, runModel, zoneSetpointHours } from '../frontend/src/thermal/engine/model'
import { cooledRoomDocument } from '../frontend/src/thermal/engine/__tests__/cooledRoom'
import { MOS, readMos } from '../frontend/src/thermal/engine/__tests__/denver'
import { gate, summarise } from './109_gate.mts'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const SB = JSON.parse(read('validation/energyplus/109_setback_spec.json').toString())
const EP = JSON.parse(read('docs/audit/109/03_ufh_energyplus.json').toString())
if (EP.setback_spec_sha256 !== sha(read('validation/energyplus/109_setback_spec.json'))) throw new Error('EnergyPlus results are of another setback spec')
if (EP.source_after_layer !== 1) throw new Error('EnergyPlus source layer is not the engine\'s layer 0')
const W = readMos(readFileSync(MOS))
const r3 = (o: Record<string, any>): Record<string, any> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => +x.toFixed(2)) : v && typeof v === 'object' ? r3(v) : v == null ? v : +(+v).toFixed(3)]))

function doc(caps: Record<string, number>, how: 'floor' | 'radiator') {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  d.profiles.push({ id: 'hours', kind: 'schedule', day_types: SB.hours })
  d.system_groups = [{ id: 'heat', service: 'heating', zones: ['west', 'east'], enabled: true, share_pct: 100, source: 'electric', efficiency_metric: 1, design_flow_c: 45, design_return_c: 35 }]
  for (const z of d.zones) {
    if (z.setpoints.heat_c == null) continue
    z.setpoints.hours_ref = 'hours'; z.setpoints.setback_c = SB.cooled_room.setback_c
    z.emitters = [{
      id: `${z.id}_e`, kind: how === 'floor' ? 'underfloor' : 'radiator', count: 1, rated_output_w: caps[z.id], radiant_fraction: how === 'floor' ? null : 0,
      system_group_id: 'heat', rated_flow_c: 45, rated_return_c: 35, rated_room_c: z.setpoints.heat_c, exponent_n: 1.1,
      source_surface_id: how === 'floor' ? `${z.id}_floor` : null, source_layer_index: how === 'floor' ? 0 : null,
    }]
  }
  return { doc: ModelDocument.parse(d), lib }
}

const out: Record<string, unknown> = {}
for (const steps of [1, 4]) for (const [name, caps] of Object.entries<Record<string, number> | null>(SB.cooled_room.cases)) {
  if (!caps || !EP.runs[name]) continue
  const opts = { ...REFEREE_OPTIONS, emitter_rating: 'setpoint' as const, ...(steps > 1 ? { time_step: { steps_per_hour: steps, theta_e_between: 'linear' as const } } : {}) }
  const f = doc(caps, 'floor'), rad = doc(caps, 'radiator')
  const r = runModel(f.doc, W, f.lib, opts), rr = runModel(rad.doc, W, rad.lib, opts)
  // The product's rating (Brief 108 F1, 'room'): the limit re-rated each step at the room's temperature. For a floor the
  // water heats the screed, not the air, so this is an approximation; EnergyPlus's electric system has a fixed limit,
  // so it is measured beside the referee, not refereed.
  const rRoom = runModel(f.doc, W, f.lib, { ...opts, emitter_rating: 'room' })
  const sh = zoneSetpointHours(f.doc, W.hours)
  const rooms: Record<string, unknown> = {}
  r.zones.forEach((z, zi) => {
    if (z.zone_id === 'middle') return
    const e = summarise(z.hourly.heating_w, z.hourly.theta_air_c, sh[zi]!.hourly.heat_c, sh[zi]!.in_use, (d) => d % 7 < 5, SB.unmet_tolerance_k)
    const er = summarise(rr.zones[zi].hourly.heating_w, rr.zones[zi].hourly.theta_air_c, sh[zi]!.hourly.heat_c, sh[zi]!.in_use, (d) => d % 7 < 5, SB.unmet_tolerance_k)
    if (e.unmet_hours_in_use !== z.annual.unmet_heating_hours_in_use) throw new Error(`${z.zone_id}: counts differ from the engine's`)
    const p = EP.runs[name].zones[z.zone_id]
    const wd = Array.from({ length: 365 }, (_, d) => d).filter((d) => d % 7 < 5)
    const meanAir = Array.from({ length: 24 }, (_, i) => wd.reduce((s, d) => s + z.hourly.theta_air_c[d * 24 + i], 0) / wd.length)
    rooms[z.zone_id] = {
      engine2: r3({ ...e, weekday_mean_air_c: meanAir }), energyplus: r3(p), gate: gate(e, p), closure_max_wh: z.closure.max_wh,
      room_rating: r3({ heat_mwh: rRoom.zones[zi].annual.heating_kwh / 1000, unmet_hours_in_use: rRoom.zones[zi].annual.unmet_heating_hours_in_use, min_in_use_c: rRoom.zones[zi].annual.min_control_in_use_c }),
      same_limit_as_radiators: r3({ heat_mwh: er.heat_mwh, unmet_hours_in_use: er.unmet_hours_in_use, min_in_use_c: er.min_in_use_c }),
    }
  })
  out[`${name}, ${steps} step${steps > 1 ? 's' : ''} an hour`] = { caps, steps_per_hour: steps, rooms }
}
writeFileSync(path.join(root, 'docs/audit/109/03_ufh.json'), JSON.stringify({ source: 'scripts/109_ufh.mts', gate: SB.gate, throttling_range_k: EP.throttling_range_k, cases: out }, null, 1) + '\n')
for (const [n, c] of Object.entries<any>(out)) for (const [z, v] of Object.entries<any>(c.rooms)) {
  const { pass, ...lines } = v.gate
  console.log(n, z, JSON.stringify(lines), 'E', v.engine2.heat_mwh, v.engine2.unmet_hours_in_use, 'EP', v.energyplus.heat_mwh, v.energyplus.unmet_hours_in_use, 'rad', v.same_limit_as_radiators.unmet_hours_in_use, 'room-rated', v.room_rating.heat_mwh, v.room_rating.unmet_hours_in_use)
}
