/**
 * Brief 108 Part 2: each zone's emitters, rated at their heating system's design temperatures (EN 442-2).
 *
 * A wet emitter's output at another flow, return and room temperature is Q = Q_rated × (ΔT / ΔT_rated)^n, with ΔT the
 * log-mean water-to-room difference (T_flow − T_return) / ln((T_flow − T_room) / (T_return − T_room)), equal to
 * T_flow − T_room when flow and return are equal. A VRF indoor unit or an electric heater gives its stated output.
 *
 * The room temperature is the zone's heating setpoint, held for the year (a design rating, docs/audit/108 decision 2),
 * so each zone's cap is a fixed number of watts, as EnergyPlus's LimitCapacity takes it. A zone without emitters is not
 * limited (ideal loads, as before). Nothing is defaulted: a missing value is refused, naming it (Rules 2 and 3).
 */
import { FIXED_OUTPUT_KINDS, type ModelDocument } from '../schema/model'

export class EmitterError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'EmitterError' }
}

/** The log-mean water-to-room temperature difference, K; refused when the return is not above the room. */
export function logMeanDeltaT(flow_c: number, return_c: number, room_c: number): number {
  const a = flow_c - room_c, b = return_c - room_c
  if (!(b > 0) || !(a >= b)) return NaN
  return a === b ? a : (a - b) / Math.log(a / b)
}

/** One unit's output at the given temperatures from its rating, W (EN 442-2). */
export function ratedOutputAt(
  rated_w: number, n: number, rated: { flow_c: number; return_c: number; room_c: number }, at: { flow_c: number; return_c: number; room_c: number },
): number {
  return rated_w * Math.pow(logMeanDeltaT(at.flow_c, at.return_c, at.room_c) / logMeanDeltaT(rated.flow_c, rated.return_c, rated.room_c), n)
}

export interface ZoneEmitters {
  /** The most heat the zone's emitters give, W. */
  cap_w: number
  /** Heating's share given as radiation: the emitters' radiant fractions weighted by output. */
  radiant_fraction: number
  /** Each emitter entry's total output (count × one unit) at the design temperatures, W. */
  emitters: { id: string; kind: string; output_w: number; rated_w: number; exponent_n: number | null }[]
}

/** Each zone's emitters, or null for a zone that states none. Throws EmitterError for a missing or impossible value. */
export function zoneEmitters(doc: ModelDocument): (ZoneEmitters | null)[] {
  return doc.zones.map((zone, zi) => {
    if (zone.emitters.length === 0) return null
    const zp = `zones[${zi}]`
    const room = zone.setpoints.heat_c
    if (room == null) throw new EmitterError('a zone with emitters needs a heating setpoint to rate them at', `${zp}.setpoints.heat_c`)
    const out: ZoneEmitters['emitters'] = []
    let cap = 0, rad = 0
    zone.emitters.forEach((e, j) => {
      const p = `${zp}.emitters[${j}]`
      const need = (v: number | null, k: string) => { if (v == null) throw new EmitterError('required', `${p}.${k}`); return v }
      const count = need(e.count, 'count'), unit = need(e.rated_output_w, 'rated_output_w'), rf = need(e.radiant_fraction, 'radiant_fraction')
      if (!(rf >= 0 && rf <= 1)) throw new EmitterError('must be 0 to 1', `${p}.radiant_fraction`)
      let w: number
      let n: number | null = null
      if (FIXED_OUTPUT_KINDS.includes(e.kind)) w = count * unit
      else {
        const gid = e.system_group_id
        if (gid == null) throw new EmitterError('required: the heating system that feeds it', `${p}.system_group_id`)
        const gi = doc.system_groups.findIndex((g) => g.id === gid)
        const g = doc.system_groups[gi]
        if (!g.enabled) throw new EmitterError(`names the system "${g.label || g.id}", which is switched off`, `${p}.system_group_id`)
        const gp = `system_groups[${gi}]`
        const flow = g.design_flow_c ?? null, ret = g.design_return_c ?? null
        if (flow == null) throw new EmitterError('required: the flow temperature its emitters are rated at', `${gp}.design_flow_c`)
        if (ret == null) throw new EmitterError('required: the return temperature its emitters are rated at', `${gp}.design_return_c`)
        const rated = { flow_c: need(e.rated_flow_c, 'rated_flow_c'), return_c: need(e.rated_return_c, 'rated_return_c'), room_c: need(e.rated_room_c, 'rated_room_c') }
        n = need(e.exponent_n, 'exponent_n')
        if (!(n > 0)) throw new EmitterError('must be above 0', `${p}.exponent_n`)
        if (Number.isNaN(logMeanDeltaT(rated.flow_c, rated.return_c, rated.room_c))) throw new EmitterError('the rated return must be above the rated room temperature, and the flow at or above the return', `${p}.rated_return_c`)
        if (Number.isNaN(logMeanDeltaT(flow, ret, room))) throw new EmitterError(`the return (${ret} °C) must be above ${zone.name || zone.id}'s heating setpoint (${room} °C), and the flow at or above the return`, `${gp}.design_return_c`)
        w = count * ratedOutputAt(unit, n, rated, { flow_c: flow, return_c: ret, room_c: room })
      }
      out.push({ id: e.id, kind: e.kind, output_w: w, rated_w: count * unit, exponent_n: n })
      cap += w; rad += w * rf
    })
    return { cap_w: cap, radiant_fraction: cap > 0 ? rad / cap : 0, emitters: out }
  })
}
