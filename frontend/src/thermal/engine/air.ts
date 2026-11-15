/**
 * Infiltration and permanent vents (Brief 103 Part 4). Building-module scope: leakage through the q50-rated envelope
 * and always-open passive openings. No mechanical ventilation, no operable openings.
 *
 * Provenance: ported from frontend/src/utils/instantCalc.js deriveOperationalACH (386–401) and the permanent-vent
 * hour loop (1013–1026, 1228–1252) at 63b7383. Physics unchanged (Rule 14):
 *   n = q50 · A_env / V / 20                          (the n50/20 rule of thumb today's engine uses)
 *   cross         Q = cd · A · √C_w · v               (CIBSE Guide A §4.6)
 *   single_sided  Q = 0.025 · min(1, cd/0.6) · A · v  (BS EN 16798-7 §6.4 with today's restriction factor)
 *   C_w = 0.05 sheltered, 0.10 normal, 0.20 exposed.
 * Diverged: every input is required from the document (today falls back to 0.5 ach, cd 0.25, single-sided and normal
 * exposure); the stack term stays absent, as today (Issue #4).
 */
import { ENGINE_CONSTANTS as K } from './constants'

export class AirError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'AirError' }
}

const CW = { sheltered: 0.05, normal: 0.10, exposed: 0.20 } as const

export interface Infiltration { source: 'q50' | 'ach'; ach: number; h_w_per_k: number }

export function infiltration(args: { q50: number | null; ach: number | null; envelope_area_m2: number; volume_m3: number; path: string }): Infiltration {
  const { q50, ach, envelope_area_m2: A, volume_m3: V, path } = args
  if (!(V > 0)) throw new AirError('zone volume must be > 0', `${path}.area_m2`)
  let n: number, source: Infiltration['source']
  if (q50 != null && q50 > 0) { n = (q50 * A) / V / 20; source = 'q50' }
  else if (ach != null && ach >= 0) { n = ach; source = 'ach' }
  else throw new AirError('needs infiltration_q50 or infiltration_ach', `${path}.infiltration_q50`)
  return { source, ach: n, h_w_per_k: (K.rho_c_air * n * V) / 3600 }
}

export interface Vent { surface_id: string; area_m2: number; cd: number; flow_mode: 'cross' | 'single_sided' }

/** The vent's flow per unit wind speed, m³/s per m/s. */
export function ventCoefficient(v: Vent, exposure: string | null, path: string): number {
  if (v.flow_mode === 'single_sided') return 0.025 * Math.min(1, v.cd / 0.6) * v.area_m2
  if (v.flow_mode === 'cross') {
    if (exposure == null || !(exposure in CW)) throw new AirError('a cross-flow vent needs site exposure sheltered, normal or exposed', 'building.site.exposure')
    return v.cd * v.area_m2 * Math.sqrt(CW[exposure as keyof typeof CW])
  }
  throw new AirError(`flow_mode must be cross or single_sided (got ${JSON.stringify(v.flow_mode)})`, `${path}.flow_mode`)
}

/** Hourly vent conductance, W/K, from the wind speed. */
export function ventConductance(coefficients: number[], wind: ArrayLike<number>, hours: number): Float64Array {
  const c = coefficients.reduce((s, x) => s + x, 0)
  const out = new Float64Array(hours)
  for (let h = 0; h < hours; h++) out[h] = K.rho_c_air * c * wind[h]
  return out
}
