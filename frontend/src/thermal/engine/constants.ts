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
  /**
   * Brief 125 (Linzie 17 Nov 23:50, "Follow EnergyPlus's method"): EnergyPlus's DOE-2 outside convection (its default
   * SurfaceConvectionAlgorithm:Outside; EnergyPlus Engineering Reference, "DOE-2 Model"): h = h_n + R_f·(√(h_n² + h_f²) − h_n),
   * h_f = a·V_z^b with MoWITT's forced terms (windward 3.26, 0.89; leeward 3.55, 0.617), leeward beyond 90° off the
   * face's azimuth, a face within 0.98 of horizontal always windward; R_f by the outside layer's roughness. Checked
   * against EnergyPlus 25.2's own coefficients (docs/briefs/active/125_outside-film.md Part 1).
   */
  doe2_windward_a: 3.26,
  doe2_windward_b: 0.89,
  doe2_leeward_a: 3.55,
  doe2_leeward_b: 0.617,
  doe2_leeward_beyond_deg: 90,
  doe2_horizontal_cos: 0.98,
  /** Roughness multipliers R_f: MediumRough (every opaque outside layer the EnergyPlus translator writes) and VerySmooth (glazing). */
  doe2_roughness_opaque: 1.52,
  doe2_roughness_glazing: 1.0,
  /** EnergyPlus's low limit on a convection coefficient, W/m²K. */
  h_ce_min: 0.1,
  /**
   * EnergyPlus's wet outside surface: while it rains, a wind-exposed face's convection is 1,000 W/m²K to the outdoor wet
   * bulb. Raining: the weather code read between hours ≥ 0.5, or the liquid precipitation depth read between hours ≥ 0.8 mm.
   */
  h_ce_rain: 1000,
  /**
   * Brief 125, speed: the dry outside-film factorisations the network keeps (h_ce, 2·h_ce, 4·h_ce = 20, 40, 80 W/m²K);
   * a step uses the lowest at or above every face's own film, the difference entering from the step before. A step
   * above them all is rebuilt exactly. Changes no physics in steady conditions (network.ts).
   */
  film_rungs: 3,
  rain_code_at_least: 0.5,
  rain_precipitation_mm: 0.8,
  /**
   * Brief 126 (Linzie 18 Nov 10:57, "Please fix": the inside film, the sky and the window, as EnergyPlus). EnergyPlus's
   * outside long-wave (Engineering Reference, "Exterior Longwave Radiation"): a face exchanges with the ground (view
   * (1 − cos Σ)/2, at the outdoor air), the sky (view (1 + cos Σ)/2 × β, β = √((1 + cos Σ)/2)) and the air (the rest of
   * the sky view), each by h = ε·σ·(T_s² + T_x²)(T_s + T_x) at the face's temperature the step before. The sky
   * temperature is (IR/σ)^¼ from the weather file's horizontal infrared, read between hours; where that is missing,
   * Clark and Allen's sky emissivity from the dew point and opaque cover, as EnergyPlus. Checked against EnergyPlus
   * 25.2's own coefficients to 0.0001 W/m²K (docs/briefs/active/126_inside-sky-window.md Part 1).
   */
  sigma: 5.6697e-8,
  clark_allen_a: 0.787,
  clark_allen_b: 0.764,
  clark_allen_n1: 0.0224,
  clark_allen_n2: -0.0035,
  clark_allen_n3: 0.00028,
  /**
   * EnergyPlus's Simple Window Model (WindowMaterial:SimpleGlazingSystem, the glazing the translator writes): the glass
   * takes emissivity 0.84 on both faces, and its layer resistance is the stated U less EnergyPlus's own rating films,
   * R_i = 1/(0.359073·ln U + 6.949915) for U ≤ 5.85, 1/(1.788041·U − 2.886625) above, and R_o = 1/(0.025342·U + 29.163853).
   */
  simple_glazing_emissivity: 0.84,
  simple_glazing_ri_ln_a: 0.359073,
  simple_glazing_ri_ln_b: 6.949915,
  simple_glazing_ri_u_split: 5.85,
  simple_glazing_ri_lin_a: 1.788041,
  simple_glazing_ri_lin_b: 2.886625,
  simple_glazing_ro_a: 0.025342,
  simple_glazing_ro_b: 29.163853,
  /**
   * A window's inside convection in EnergyPlus's TARP: ISO 15099 (EnergyPlus CalcISO15099WindowIntConvCoeff), from the
   * glass's height and its difference with the room air, air properties at the film temperature T_a + ¼(T_s − T_a):
   * λ = 2.873e-3 + 7.76e-5·T, μ = 3.723e-6 + 4.94e-8·T, c_p = 1002.737 + 1.2324e-2·T (T in K); Nusselt by tilt
   * (eq. 135 to 139), Ra_cv = 2.5e5·e^(0.72·θ)/sin θ. Checked against EnergyPlus's own window coefficients to 0.01 W/m²K.
   */
  iso15099_lambda_a: 2.873e-3,
  iso15099_lambda_b: 7.76e-5,
  iso15099_mu_a: 3.723e-6,
  iso15099_mu_b: 4.94e-8,
  iso15099_cp_a: 1002.737,
  iso15099_cp_b: 1.2324e-2,
  gravity: 9.81,
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
