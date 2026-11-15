/**
 * Fixed physical constants of Engine 1, each with its source. These are the only numbers the engine holds itself;
 * everything about a building comes from the model document (Brief 103 principle: inputs fail loudly, defaults live
 * in the document). `ENGINE_CONSTANTS` is copied into every result so a reader sees what was assumed.
 */
export const ENGINE_CONSTANTS = {
  /** ISO 52016-1:2017 Table 25: external convective surface coefficient, W/m²K. */
  h_ce: 20,
  /** ISO 52016-1 Table 25 gives h_re = 4.14 W/m²K for emissivity 0.9; scaled linearly with the surface's emissivity. */
  h_re_per_emissivity: 4.14 / 0.9,
  /** ISO 52016-1 Table 25: internal radiative coefficient, W/m²K (inside emissivity 0.9). */
  h_ri: 5.13,
  /** ISO 52016-1 Table 25: internal convective coefficients, W/m²K, by direction of heat flow from the zone air. */
  h_ci_horizontal: 2.5,
  h_ci_upward: 5.0,
  h_ci_downward: 0.7,
  /**
   * Walton's natural-convection correlations (EnergyPlus Engineering Reference, "TARP" inside convection; Walton 1983),
   * the 'tarp' inside convection option (Brief 105 Part 6): unstable h = 9.482·|ΔT|^⅓ / (7.238 − |cos Σ|), stable
   * h = 1.810·|ΔT|^⅓ / (1.382 + |cos Σ|), W/m²K; and EnergyPlus's floor on any convection coefficient, 0.1 W/m²K.
   */
  tarp_unstable_a: 9.482,
  tarp_unstable_b: 7.238,
  tarp_stable_a: 1.81,
  tarp_stable_b: 1.382,
  h_ci_tarp_min: 0.1,
  /** ISO 6946:2017 Annex C, h_c = 4 + 4·v (v the wind speed, m/s): the wind-driven outside convection option. */
  h_ce_wind_a: 4,
  h_ce_wind_b: 4,
  /** Mean difference between outdoor air and apparent sky temperature, K (ISO 13790:2008 11.3.5; ISO 52016-1 Annex B default). */
  delta_theta_sky_k: 11,
  /** Convective share of transmitted solar released to the air node (ISO 52016-1 Annex B default f_sol,c). */
  solar_convective_fraction: 0.1,
  /**
   * Correction from the normal-incidence g-value to the hour-average for non-normal incidence, F_W (ISO 13790:2008
   * 11.4.2; ISO 52016-1 Annex B default). Today's engine applies none.
   */
  glazing_angle_factor: 0.9,
  /** ISO 6946:2017 Table 7 surface resistances, m²K/W, used only to turn a stated U into a layer resistance. */
  R_se: 0.04,
  R_si_horizontal: 0.13,
  R_si_upward: 0.10,
  R_si_downward: 0.17,
  /**
   * Air volumetric heat capacity, J/m³K: 0.33 Wh/m³K, today's AIR_HEAT_CAPACITY (instantCalc.js 168), which today's
   * infiltration and vent conductances use. Today's air-node capacity uses 1.2 × 1005 = 1206 (1.5 % higher); Engine 1
   * uses one value for both, and the air's own capacity is under 2 % of the anchor zone's.
   */
  rho_c_air: 0.33 * 3600,
  /** Largest massive sub-layer thickness, m: thicker layers are split so each node stands for at most this much. */
  max_sublayer_m: 0.05,
} as const

export type HeatFlowDirection = 'horizontal' | 'upward' | 'downward'

/**
 * Direction of heat flow from the zone into a surface, from the surface's tilt (ISO 6946 6.8: within ±30° of
 * horizontal flow counts as horizontal). A roof (tilt < 60°) takes heat upward; a ground floor (tilt > 120°) downward.
 */
export function heatFlowDirection(tiltDeg: number): HeatFlowDirection {
  if (tiltDeg < 60) return 'upward'
  if (tiltDeg > 120) return 'downward'
  return 'horizontal'
}
