/**
 * Brief 108 Part 4: sizing. A run with the emitters unlimited gives each zone's peak with its emitters' radiant share;
 * the standard rating (EN 442, 75/65/20 °C) that covers it is peak ÷ (ΔT_design / ΔT_standard)^n; stating that rating
 * leaves no unmet hours. Mixed systems or exponents give no one number, and say why.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EN442_STANDARD, logMeanDeltaT, zoneEmitters, zoneSizing } from '../emitters'
import { REFEREE_OPTIONS, runModel } from '../model'
import { ModelDocument } from '../../schema/model'
import { cooledRoomDocument } from './cooledRoom'
import { MOS, readMos } from './denver'

const W = readMos(fs.readFileSync(MOS))
const N = 1.3
/** The cooled room (west and east heated) with one radiator entry per heated room, rated at 75/65/20 °C. */
function rooms(ratedPerRoomW: number, opts: { flow?: number; ret?: number; radiant?: number; over?: (d: any) => void } = {}) {
  const { doc, lib } = cooledRoomDocument()
  const d: any = structuredClone(doc)
  d.system_groups = [{ id: 'hp', service: 'heating', zones: ['west', 'east'], enabled: true, share_pct: 100, source: 'ashp', efficiency_metric: 3, design_flow_c: opts.flow ?? 50, design_return_c: opts.ret ?? 40 }]
  for (const z of d.zones) if (z.setpoints.heat_c != null) {
    z.emitters = [{ id: `${z.id}_rad`, kind: 'radiator', count: 1, rated_output_w: ratedPerRoomW, radiant_fraction: opts.radiant ?? 0.3, system_group_id: 'hp', rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: N }]
  }
  opts.over?.(d)
  return { doc: ModelDocument.parse(d), lib }
}
const factor = (flow: number, ret: number, room: number) => Math.pow(logMeanDeltaT(flow, ret, room) / logMeanDeltaT(75, 65, 20), N)

describe('the unlimited run', () => {
  it('keeps the radiant share: value for value the same as emitters far above the peak', () => {
    const a = rooms(1000), free = runModel(a.doc, W, a.lib, { ...REFEREE_OPTIONS, emitter_limit: 'none' })
    const b = rooms(1e9), big = runModel(b.doc, W, b.lib, REFEREE_OPTIONS)
    for (const zi of [0, 2]) {
      expect(Array.from(free.zones[zi].hourly.heating_w)).toEqual(Array.from(big.zones[zi].hourly.heating_w))
      expect(free.zones[zi].annual.unmet_heating_hours).toBe(0)
    }
  })
})

describe('sizing by hand', () => {
  const a = rooms(1000)
  const capped = runModel(a.doc, W, a.lib, REFEREE_OPTIONS)
  const free = runModel(a.doc, W, a.lib, { ...REFEREE_OPTIONS, emitter_limit: 'none' })
  const sp = a.doc.zones[0].setpoints.heat_c!
  const s = zoneSizing(a.doc, 0, capped.zones[0].emitters!, free.zones[0].annual.peak_heating_w)
  it('output at 50/40 in the room, shortfall, rating needed at 75/65/20', () => {
    expect(s.cap_w).toBeCloseTo(1000 * factor(50, 40, sp), 9)
    expect(s.peak_w).toBe(free.zones[0].annual.peak_heating_w)
    expect(s.shortfall_w).toBeCloseTo(s.peak_w - s.cap_w, 9)
    expect(s.shortfall_w).toBeGreaterThan(0)
    expect(s.rated_now_w).toBeCloseTo(1000, 9)
    expect(s.needed_rated_w!).toBeCloseTo(s.peak_w / factor(50, 40, sp), 9)
    expect(s.design).toEqual({ flow_c: 50, return_c: 40, room_c: sp })
    expect(s.note).toBeNull()
    expect(capped.zones[0].annual.unmet_heating_hours!).toBeGreaterThan(0)
  })
  it('the needed rating, stated, leaves no unmet hours (and the shortfall at it is nil)', () => {
    const need = Math.max(...[0, 2].map((zi) => zoneSizing(a.doc, zi, capped.zones[zi].emitters!, free.zones[zi].annual.peak_heating_w).needed_rated_w!))
    const b = rooms(need * (1 + 1e-9)), r = runModel(b.doc, W, b.lib, REFEREE_OPTIONS)
    for (const zi of [0, 2]) {
      expect(r.zones[zi].annual.unmet_heating_hours).toBe(0)
      expect(r.zones[zi].emitters!.cap_w).toBeGreaterThanOrEqual(free.zones[zi].annual.peak_heating_w)
    }
    // 10 % less and the peak hours go short.
    const c = rooms(need * 0.9), rc = runModel(c.doc, W, c.lib, REFEREE_OPTIONS)
    expect(rc.zones[0].annual.unmet_heating_hours! + rc.zones[2].annual.unmet_heating_hours!).toBeGreaterThan(0)
  })
  it('the same rooms at 70/60 need a smaller rating, in the ratio of the two factors', () => {
    const b = rooms(1000, { flow: 70, ret: 60 })
    const s70 = zoneSizing(b.doc, 0, zoneEmitters(b.doc)[0]!, s.peak_w)
    expect(s70.needed_rated_w! / s.needed_rated_w!).toBeCloseTo(factor(50, 40, sp) / factor(70, 60, sp), 12)
    expect(s70.cap_w).toBeGreaterThan(s.cap_w)
  })
})

describe('review F7: a system with no emitters listed in the room is named', () => {
  it('an electric system serving the room with no heater listed; a fixed unit listed clears it', () => {
    const extra = (withHeater: boolean) => (d: any) => {
      d.system_groups.push({ id: 'el', label: 'Panel heaters', service: 'heating', zones: ['west'], enabled: true, share_pct: 0, source: 'electricity', efficiency_metric: 1 })
      if (withHeater) d.zones[0].emitters.push({ id: 'ph', kind: 'electric', count: 1, rated_output_w: 500, radiant_fraction: 0.4, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null })
    }
    const a = rooms(1000, { over: extra(false) })
    expect(zoneSizing(a.doc, 0, zoneEmitters(a.doc)[0]!, 3000).unlisted_systems).toEqual(['Panel heaters'])
    expect(zoneSizing(a.doc, 2, zoneEmitters(a.doc)[2]!, 3000).unlisted_systems).toEqual([])
    const b = rooms(1000, { over: extra(true) })
    expect(zoneSizing(b.doc, 0, zoneEmitters(b.doc)[0]!, 3000).unlisted_systems).toEqual([])
  })
})

describe('no one number, said why', () => {
  const sizeOf = (over: (d: any) => void) => {
    const a = rooms(1000, { over })
    return zoneSizing(a.doc, 0, zoneEmitters(a.doc)[0]!, 5000)
  }
  it('fixed-output units only', () => {
    const s = sizeOf((d) => { d.zones[0].emitters = [{ id: 'e', kind: 'electric', count: 2, rated_output_w: 1500, radiant_fraction: 0.5, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }] })
    expect(s.cap_w).toBe(3000); expect(s.shortfall_w).toBe(2000)
    expect(s.needed_rated_w).toBeNull(); expect(s.note).toMatch(/fixed-output/)
  })
  it('a fixed unit beside the radiators is taken off the peak first', () => {
    const a = rooms(1000, { over: (d) => d.zones[0].emitters.push({ id: 'e', kind: 'electric', count: 1, rated_output_w: 800, radiant_fraction: 0.5, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }) })
    const s = zoneSizing(a.doc, 0, zoneEmitters(a.doc)[0]!, 5000)
    expect(s.needed_rated_w!).toBeCloseTo((5000 - 800) / factor(50, 40, a.doc.zones[0].setpoints.heat_c!), 9)
  })
  it('two exponents', () => {
    const s = sizeOf((d) => d.zones[0].emitters.push({ ...d.zones[0].emitters[0], id: 'ufh', kind: 'underfloor', exponent_n: 1.1 }))
    expect(s.needed_rated_w).toBeNull(); expect(s.note).toMatch(/different exponents/)
  })
  it('two heating systems', () => {
    const s = sizeOf((d) => {
      d.system_groups.push({ ...d.system_groups[0], id: 'boiler', source: 'gas', efficiency_metric: 0.9, design_flow_c: 75, design_return_c: 65, share_pct: 0 })
      d.zones[0].emitters.push({ ...d.zones[0].emitters[0], id: 'r2', system_group_id: 'boiler' })
    })
    expect(s.needed_rated_w).toBeNull(); expect(s.design).toBeNull(); expect(s.note).toMatch(/more than one heating system/)
  })
})
