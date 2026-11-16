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
import { COOLING_KINDS, FIXED_OUTPUT_KINDS, type ModelDocument } from '../schema/model'

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
  /** Heating's share given as radiation: the radiant fractions of the emitters that heat the room directly, weighted by output. */
  radiant_fraction: number
  /** Each emitter entry's total output (count × one unit) at the design temperatures, W. */
  emitters: { id: string; kind: string; output_w: number; rated_w: number; exponent_n: number | null }[]
  /**
   * Review F1 (Linzie, 15 Nov): the emitters' output with the room at `room_c`, W. A wet emitter keeps its design water
   * flow and its system's flow temperature; the return falls as the room cools, and the output is EN 442's at that
   * flow, return and room. Fixed-output units give their stated output. A room above its setpoint is taken at the
   * setpoint (it is not being heated), so at the setpoint and above this is `cap_w`.
   */
  at: (room_c: number) => number
  /**
   * Brief 120 P2b: the output of the zone's wet emitters fed by system `group_id` when the water reaches them at
   * `flow_c` (a plant that cannot hold its flow temperature), with the room at `room_c`, W. Each keeps its design water
   * flow, as in `at`; at or below the room's temperature they give nothing. Null: the zone has no wet emitter on that
   * system (fixed-output units are not fed by water).
   */
  at_flow: (room_c: number, flow_c: number, group_id: string) => number | null
  /**
   * Brief 109: underfloor heating in a floor. Its heat enters the floor at the inside face of `layer_index` (the floor
   * carries it to the room, and down); `share` is its part of the zone's heating, its design output over `cap_w`, held
   * for the year. Null: every emitter heats the room directly. `radiant_fraction` is then the other emitters'.
   */
  slab: { surface_id: string; layer_index: number; share: number } | null
}

/** A heating emitter's own fields: left empty on a unit that does not heat (Brief 119). */
const HEATING_FIELDS = ['rated_output_w', 'radiant_fraction', 'system_group_id', 'rated_flow_c', 'rated_return_c', 'rated_room_c', 'exponent_n', 'source_surface_id', 'source_layer_index'] as const

/** Each zone's heating emitters, or null for a zone that states none. Throws EmitterError for a missing or impossible value. */
export function zoneEmitters(doc: ModelDocument): (ZoneEmitters | null)[] {
  return doc.zones.map((zone, zi) => {
    // Brief 119: a unit that cools and does not heat is not a heating emitter; its heating fields must be empty.
    zone.emitters.forEach((e, j) => {
      if (e.heats) return
      const p = `zones[${zi}].emitters[${j}]`
      for (const k of HEATING_FIELDS) if (e[k] != null) throw new EmitterError('leave empty: this unit does not heat', `${p}.${k}`)
    })
    if (!zone.emitters.some((e) => e.heats)) return null
    const zp = `zones[${zi}]`
    const room = zone.setpoints.heat_c
    if (room == null) throw new EmitterError('a zone with emitters needs a heating setpoint to rate them at', `${zp}.setpoints.heat_c`)
    const out: ZoneEmitters['emitters'] = []
    const wet: { group: string; units: number; unit_w: number; n: number; rated: { flow_c: number; return_c: number; room_c: number }; flow_c: number; return_c: number }[] = []
    let cap = 0, rad = 0, fixed = 0, direct = 0, slabW = 0
    let slab: { surface_id: string; layer_index: number } | null = null
    zone.emitters.forEach((e, j) => {
      if (!e.heats) return
      const p = `${zp}.emitters[${j}]`
      const need = (v: number | null, k: string) => { if (v == null) throw new EmitterError('required', `${p}.${k}`); return v }
      const count = need(e.count, 'count'), unit = need(e.rated_output_w, 'rated_output_w')
      // Brief 109: underfloor heating states the floor and layer its pipes are in; nothing else has a source.
      const inSlab = e.kind === 'underfloor'
      let rf = 0
      if (inSlab) {
        const sid = need(e.source_surface_id, 'source_surface_id'), li = need(e.source_layer_index, 'source_layer_index')
        if (e.radiant_fraction != null) throw new EmitterError('leave empty: underfloor heating gives its heat through the floor it is in', `${p}.radiant_fraction`)
        const si = doc.surfaces.findIndex((x) => x.id === sid)
        const sf = doc.surfaces[si]
        if (!sf) throw new EmitterError(`names surface "${sid}", which the building does not have`, `${p}.source_surface_id`)
        if (!zone.surfaces.includes(sid)) throw new EmitterError(`names surface "${sid}", which is not one of ${zone.name || zone.id}'s`, `${p}.source_surface_id`)
        const ownFloor = sf.zone_a === zone.id ? sf.kind === 'floor' || sf.kind === 'ground' : sf.kind === 'ceiling'
        if (!ownFloor) throw new EmitterError(`names surface "${sid}", which is not ${zone.name || zone.id}'s floor`, `${p}.source_surface_id`)
        if (slab && (slab.surface_id !== sid || slab.layer_index !== li)) throw new EmitterError('underfloor heating in one zone must be in one floor and layer', `${p}.source_surface_id`)
        slab = { surface_id: sid, layer_index: li }
      } else {
        if (e.source_surface_id != null) throw new EmitterError('only underfloor heating is in a floor; leave empty', `${p}.source_surface_id`)
        if (e.source_layer_index != null) throw new EmitterError('only underfloor heating is in a floor; leave empty', `${p}.source_layer_index`)
        rf = need(e.radiant_fraction, 'radiant_fraction')
        if (!(rf >= 0 && rf <= 1)) throw new EmitterError('must be 0 to 1', `${p}.radiant_fraction`)
      }
      let w: number
      let n: number | null = null
      if (FIXED_OUTPUT_KINDS.includes(e.kind)) { w = count * unit; fixed += w }
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
        wet.push({ group: gid, units: count, unit_w: unit, n, rated, flow_c: flow, return_c: ret })
      }
      out.push({ id: e.id, kind: e.kind, output_w: w, rated_w: count * unit, exponent_n: n })
      cap += w
      if (inSlab) slabW += w; else { direct += w; rad += w * rf }
    })
    // Review F1: the water flow through each wet emitter is the one that carries its design output at the design flow
    // and return; at the cap the valve is open and that flow holds. In a colder room the emitter gives more, so the
    // water comes back cooler: the return is where the water's heat, flow × (T_flow − T_return), equals the emitter's
    // EN 442 output at that flow, return and room (one root between room and flow, found by bisection).
    // Brief 120 P2b: the same at any flow temperature `f` reaching the emitter (the design flow in `at`).
    const wetOut = (x: (typeof wet)[number], r: number, f: number) => {
      const out = (ret: number) => x.units * ratedOutputAt(x.unit_w, x.n, x.rated, { flow_c: f, return_c: ret, room_c: r })
      if (f === x.flow_c && (x.flow_c === x.return_c || r === room)) return out(x.return_c)
      if (!(f > r)) return 0
      const mcp = x.units * ratedOutputAt(x.unit_w, x.n, x.rated, { flow_c: x.flow_c, return_c: x.return_c, room_c: room }) / (x.flow_c - x.return_c)  // W/K
      if (!Number.isFinite(mcp)) return out(f)  // flow = return at design: no temperature drop across the emitter
      let lo = r + 1e-9, hi = f
      for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); if (mcp * (f - m) > out(m)) lo = m; else hi = m }
      return mcp * (f - 0.5 * (lo + hi))
    }
    const at = (room_c: number) => {
      const r = Math.min(room_c, room)
      let q = fixed
      for (const x of wet) q += wetOut(x, r, x.flow_c)
      return q
    }
    // The same, fast, for a plant's flow search (Brief 120 P2b; it is asked many times a short step). The water's heat
    // and the emitter's output meet at one return: with x = (return − room) ÷ (flow − room), EN 442 at exponent 1 gives
    // x = exp(−C ÷ mcp), C the emitter's output per kelvin of log-mean difference, so the output is
    // mcp·(flow − room)·(1 − x), in closed form; at other exponents the return is found by regula falsi (Illinois).
    const fast = wet.map((x) => {
      const mcp = x.flow_c === x.return_c ? Infinity : x.units * ratedOutputAt(x.unit_w, x.n, x.rated, { flow_c: x.flow_c, return_c: x.return_c, room_c: room }) / (x.flow_c - x.return_c)
      const C = (x.units * x.unit_w) / Math.pow(logMeanDeltaT(x.rated.flow_c, x.rated.return_c, x.rated.room_c), x.n)
      return { x, mcp, C, k1: x.n === 1 && Number.isFinite(mcp) ? 1 - Math.exp(-C / mcp) : NaN }
    })
    const wetOutFast = (e: (typeof fast)[number], r: number, f: number) => {
      const d = f - r
      if (!(d > 0)) return 0
      if (!Number.isFinite(e.mcp)) return e.C * Math.pow(d, e.x.n)
      if (e.x.n === 1) return e.mcp * d * e.k1
      // g(y) = mcp·(d − y) − C·LMTD^n over y = return − room in (0, d]: positive at 0, negative at d.
      const g = (y: number) => e.mcp * (d - y) - e.C * Math.pow(y >= d ? d : (d - y) / Math.log(d / y), e.x.n)
      let a = d * 1e-12, b = d, ga = g(a), gb = g(b), side = 0
      for (let i = 0; i < 60 && b - a > 1e-9 * d; i++) {
        const c = (a * gb - b * ga) / (gb - ga), gc = g(c)
        if (gc > 0) { a = c; ga = gc; if (side === 1) gb /= 2; side = 1 } else { b = c; gb = gc; if (side === -1) ga /= 2; side = -1 }
        if (gc === 0) { a = b = c; break }
      }
      return e.mcp * (d - 0.5 * (a + b))
    }
    const at_flow = (room_c: number, flow_c: number, group_id: string) => {
      const r = Math.min(room_c, room)
      let q: number | null = null
      for (const e of fast) if (e.x.group === group_id) q = (q ?? 0) + wetOutFast(e, r, Math.min(flow_c, e.x.flow_c))
      return q
    }
    const sl = slab as { surface_id: string; layer_index: number } | null
    return {
      cap_w: cap, radiant_fraction: direct > 0 ? rad / direct : 0, emitters: out, at, at_flow,
      slab: sl ? { ...sl, share: cap > 0 ? slabW / cap : 1 } : null,
    }
  })
}

/** Brief 119: the most sensible cooling a zone's units give, W, and each unit entry's share of it. */
export interface ZoneCooling {
  cap_w: number
  units: { id: string; kind: string; output_w: number }[]
}

/**
 * Brief 119: each zone's cooling units, or null for a zone none of whose units cool (its cooling is not limited, ideal
 * loads, as before; Rule 8). A unit's cooling is its stated output × count, held fixed: EnergyPlus's LimitCapacity on
 * sensible cooling takes it the same way. Throws EmitterError for a missing or impossible value.
 */
export function zoneCooling(doc: ModelDocument): (ZoneCooling | null)[] {
  return doc.zones.map((zone, zi) => {
    const units: ZoneCooling['units'] = []
    zone.emitters.forEach((e, j) => {
      const p = `zones[${zi}].emitters[${j}]`
      if (!COOLING_KINDS.includes(e.kind)) return
      if (e.cooling_output_w == null) {
        if (!e.heats) throw new EmitterError('required: a unit that does not heat must state its cooling', `${p}.cooling_output_w`)
        return
      }
      if (e.count == null) throw new EmitterError('required', `${p}.count`)
      units.push({ id: e.id, kind: e.kind, output_w: e.count * e.cooling_output_w })
    })
    if (units.length === 0) return null
    if (zone.setpoints.cool_c == null) throw new EmitterError('a zone with cooling units needs a cooling setpoint', `zones[${zi}].setpoints.cool_c`)
    return { cap_w: units.reduce((s, u) => s + u.output_w, 0), units }
  })
}

/** EN 442-2's standard rating: flow 75 °C, return 65 °C, room 20 °C (the "ΔT 50" a catalogue lists). */
export const EN442_STANDARD = { flow_c: 75, return_c: 65, room_c: 20 } as const

export interface ZoneSizing {
  /** The emitters' output at the design temperatures, W. */
  cap_w: number
  /** The most heat the zone needs in an hour with its emitters unlimited, W. */
  peak_w: number
  /** How far the emitters fall short of that peak, W (0 when they cover it). */
  shortfall_w: number
  /** The wet emitters' design temperatures, or null when the zone has none. */
  design: { flow_c: number; return_c: number; room_c: number } | null
  /** The wet emitters' total rating at EN 442's standard 75/65/20 °C today, W, or null when not one rating (see `note`). */
  rated_now_w: number | null
  /**
   * The rating at 75/65/20 °C the zone's wet emitters would need, together, so that with any fixed-output emitters
   * they cover the peak at the design temperatures: (peak − fixed) ÷ (ΔT_design / ΔT_standard)^n. Null when it cannot
   * be one number (see `note`).
   */
  needed_rated_w: number | null
  /** Why `needed_rated_w` is null, in words. */
  note: string | null
  /**
   * Review F7: heating systems that serve the zone but have none of its listed emitters (a wet system no emitter here
   * names; or a system without design temperatures where the zone lists no fixed-output unit). The zone's heat is
   * still limited to the emitters that are listed, so this is said beside the figures.
   */
  unlisted_systems: string[]
}

/**
 * Brief 108 Part 4: per zone, the emitters' output against the peak they would need to give, and the standard rating
 * that would cover it. `peak_w` comes from a run whose emitters are not limited (`emitter_limit: 'none'`). The wet
 * emitters must share one heating system and one exponent for the needed rating to be one number; otherwise it is
 * null and `note` says why. Nothing is defaulted.
 */
export function zoneSizing(doc: ModelDocument, zi: number, em: Pick<ZoneEmitters, 'cap_w' | 'emitters'>, peak_w: number): ZoneSizing {
  const zone = doc.zones[zi]
  const room = zone.setpoints.heat_c!
  let fixed = 0
  const groups = new Set<string>(), ns = new Set<number>()
  let ratedNow = 0
  // Brief 119: the heating emitters only (em.emitters lists them in the same order); a cooling-only unit is not one.
  const heating = zone.emitters.filter((e) => e.heats)
  heating.forEach((e, j) => {
    if (FIXED_OUTPUT_KINDS.includes(e.kind)) { fixed += em.emitters[j].output_w; return }
    groups.add(e.system_group_id!); ns.add(e.exponent_n!)
    ratedNow += e.count! * ratedOutputAt(e.rated_output_w!, e.exponent_n!, { flow_c: e.rated_flow_c!, return_c: e.rated_return_c!, room_c: e.rated_room_c! }, EN442_STANDARD)
  })
  const hasFixed = heating.some((e) => FIXED_OUTPUT_KINDS.includes(e.kind))
  const unlisted = doc.system_groups
    .filter((g) => g.service === 'heating' && g.enabled && g.zones.includes(zone.id))
    .filter((g) => !(heating.some((e) => e.system_group_id === g.id) || (g.design_flow_c == null && hasFixed)))
    .map((g) => g.label || g.id)
  const base = { cap_w: em.cap_w, peak_w, shortfall_w: Math.max(0, peak_w - em.cap_w), unlisted_systems: unlisted }
  if (groups.size === 0) return { ...base, design: null, rated_now_w: null, needed_rated_w: null, note: 'Only fixed-output emitters (VRF indoor units or electric heaters): a larger unit is chosen by its stated output.' }
  const g = doc.system_groups.find((x) => x.id === [...groups][0])!
  const design = { flow_c: g.design_flow_c!, return_c: g.design_return_c!, room_c: room }
  if (groups.size > 1) return { ...base, design: null, rated_now_w: ratedNow, needed_rated_w: null, note: 'Its wet emitters are fed by more than one heating system, at different temperatures.' }
  if (ns.size > 1) return { ...base, design, rated_now_w: ratedNow, needed_rated_w: null, note: 'Its wet emitters have different exponents (n), so no one rating covers them.' }
  const n = [...ns][0]
  const factor = ratedOutputAt(1, n, EN442_STANDARD, design)
  return { ...base, design, rated_now_w: ratedNow, needed_rated_w: Math.max(0, peak_w - fixed) / factor, note: null }
}
