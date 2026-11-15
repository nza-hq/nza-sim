/**
 * Overhang and fin shading factor per glazing surface (Brief 103 Part 4).
 *
 * Provenance: ported from frontend/src/utils/instantCalc.js computeShadingFactors (lines 284–332 at 63b7383), with
 * its constants WINDOW_HEIGHT_DEFAULT, ORIENT_OVERHANG_EFF and ORIENT_FIN_EFF. Diverged: takes one surface's
 * shading and facade label instead of the whole building. Physics unchanged (Rule 14: the same correlation).
 */
const WINDOW_HEIGHT_DEFAULT = 1.5
const ORIENT_OVERHANG_EFF = { north: 0.30, south: 0.85, east: 0.55, west: 0.55 } as const
const ORIENT_FIN_EFF = { north: 0.20, south: 0.30, east: 0.65, west: 0.65 } as const
const FIN_WIDTH = 6

export interface ShadingInput {
  overhang?: { depth_m: number; offset_m: number }
  fins?: { left_depth_m: number; right_depth_m: number }
}

/** Fraction of incident solar that reaches the glazing, 0.15 to 1. */
export function shadingFactor(facade: 'north' | 'east' | 'south' | 'west', s: ShadingInput | undefined): number {
  const depth = Math.max(0, s?.overhang?.depth_m ?? 0)
  const offset = Math.max(0, s?.overhang?.offset_m ?? 0)
  const finL = Math.max(0, s?.fins?.left_depth_m ?? 0)
  const finR = Math.max(0, s?.fins?.right_depth_m ?? 0)
  const pfOverhang = depth / Math.max(WINDOW_HEIGHT_DEFAULT + offset, 0.1)
  const reductionOverhang = ORIENT_OVERHANG_EFF[facade] * Math.min(0.65, (pfOverhang * 0.5) / (1 + pfOverhang * 0.3))
  const pfFin = (finL + finR) / Math.max(FIN_WIDTH, 0.1)
  const reductionFin = ORIENT_FIN_EFF[facade] * Math.min(0.45, pfFin * 0.4)
  return Math.max(0.15, 1.0 - reductionOverhang - reductionFin)
}
