/**
 * Thermal bridging, ISO 14683 junctions (Brief 103 Part 4).
 *
 * Provenance: ported from frontend/src/utils/thermalBridges.js (computeThermalBridges, autoComputeJunctionLengths) and
 * frontend/src/data/thermalBridgesLibrary.js (ISO14683_DEFAULT_PSI) at 63b7383. Diverged: reads the model document's
 * zone (polygon perimeter, storeys, storey height, glazing surfaces) instead of building_config; external corners are
 * counted from the polygon's vertices (4 for today's rectangle, so equal); the total is not rounded to 0.01 W/K.
 * Physics and ψ values unchanged.
 */
export const ISO14683_DEFAULT_PSI = {
  wall_to_roof: 0.08,
  wall_to_intermediate_floor: 0.08,
  wall_to_ground_floor: 0.16,
  external_corner: 0.05,
  window_perimeter: 0.05,
  door_perimeter: 0.10,
} as const
export type JunctionType = keyof typeof ISO14683_DEFAULT_PSI

export interface Junction { type: JunctionType; psi_w_per_mk: number; length_m: number; h_w_per_k: number }
export interface Bridging { mode: 'iso14683_auto' | 'absent' | 'legacy_alpha'; multiplier: number; total_w_per_k: number; junctions: Junction[] }

export class BridgingError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'BridgingError' }
}

export function computeBridging(args: {
  tb: { mode: string | null; multiplier: number | null; alpha_pct: number | null }
  polygon: [number, number][]
  storeys: number
  storey_height_m: number
  glazing_areas_m2: number[]
  /** Σ U·A of the envelope, for the legacy α mode only. */
  area_ua_w_per_k: number
  /**
   * One zone of several (Brief 104 Part 3): which of the building's junctions are this zone's. Absent: the zone is the
   * whole building (Engine 1). The roof junction goes to a zone with a roof, the ground junction to a zone with
   * ground; the intermediate-floor junction is the perimeter at each slab the zone spans inside itself (storeys − 1)
   * plus half the perimeter at each slab it shares with another zone (the other half is that zone's). Corners follow
   * the zone's own storeys and height. The window junction is given (`window_perimeter_m`): the caller shares the
   * building's window perimeter out, since 4√A per surface would grow by √N when a facade's glazing is cut into N
   * storeys. Over the zones of a per-storey building every length sums to the single zone's.
   */
  zone_share?: { has_roof: boolean; has_ground: boolean; shared_slabs: number; window_perimeter_m: number }
}): Bridging {
  const { tb } = args
  if (tb.mode === 'iso14683_auto') {
    const m = tb.multiplier
    if (m == null) throw new BridgingError('required in iso14683_auto mode (the document states it; today reads none as 1)', 'building.thermal_bridging.multiplier')
    if (!(m > 0)) throw new BridgingError('multiplier must be > 0', 'building.thermal_bridging.multiplier')
    const p = args.polygon
    let perimeter = 0
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]
      perimeter += Math.hypot(x1 - x0, y1 - y0)
    }
    const zs = args.zone_share
    if (zs && !(Number.isInteger(zs.shared_slabs) && zs.shared_slabs >= 0)) throw new BridgingError('shared_slabs must be a whole number ≥ 0', 'zone_share.shared_slabs')
    if (zs && !(zs.window_perimeter_m >= 0)) throw new BridgingError('window_perimeter_m must be ≥ 0', 'zone_share.window_perimeter_m')
    const lengths: Record<JunctionType, number> = {
      wall_to_roof: zs && !zs.has_roof ? 0 : perimeter,
      wall_to_intermediate_floor: perimeter * Math.max(0, args.storeys - 1) + (zs ? 0.5 * perimeter * zs.shared_slabs : 0),
      wall_to_ground_floor: zs && !zs.has_ground ? 0 : perimeter,
      external_corner: p.length * args.storeys * args.storey_height_m,
      window_perimeter: zs ? zs.window_perimeter_m : args.glazing_areas_m2.reduce((s, a) => s + (a > 0 ? 4 * Math.sqrt(a) : 0), 0),
      door_perimeter: 0,  // doors are operable openings, not in Engine 1's document scope
    }
    const junctions = (Object.keys(ISO14683_DEFAULT_PSI) as JunctionType[]).map((type) => ({
      type, psi_w_per_mk: ISO14683_DEFAULT_PSI[type], length_m: lengths[type], h_w_per_k: lengths[type] * ISO14683_DEFAULT_PSI[type] * m,
    }))
    return { mode: 'iso14683_auto', multiplier: m, junctions, total_w_per_k: junctions.reduce((s, j) => s + j.h_w_per_k, 0) }
  }
  if (tb.mode === 'manual_h_tb') {
    throw new BridgingError('manual H_TB is not carried by the model document yet (schema gap, recorded)', 'building.thermal_bridging.mode')
  }
  if (tb.mode === 'absent' || tb.mode == null) {
    if (tb.mode == null && tb.alpha_pct != null && tb.alpha_pct > 0) {
      return { mode: 'legacy_alpha', multiplier: 1, junctions: [], total_w_per_k: (tb.alpha_pct / 100) * args.area_ua_w_per_k }
    }
    return { mode: 'absent', multiplier: 1, junctions: [], total_w_per_k: 0 }
  }
  throw new BridgingError(`unknown mode "${tb.mode}"`, 'building.thermal_bridging.mode')
}
