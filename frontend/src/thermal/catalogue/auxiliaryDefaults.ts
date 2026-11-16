/**
 * Brief 114 Part 1: the stated defaults behind "Use defaults" for pumps and back-of-house fans.
 *
 * Source: the UK National Calculation Methodology, "NCM Modelling Guide for non-domestic buildings in England",
 * 2021 edition (15 Dec 2021), https://www.uk-ncm.org.uk/filelibrary/NCM_Modelling_Guide_2021_Edition_England_15Dec2021.pdf
 * Read 16 Nov 2026 through a text extraction (the container's proxy blocks the file, so no sha256 yet; to check on
 * IT15 against the page, as the Stelrad catalogue was in Brief 119).
 *
 * - Table 14 (p. 31), pump power density by pump configuration, W/m² of floor, "LTHW only" and "Both LTHW and CHW".
 *   NCM multiplies it by the heating system's hours (para 62: hours when the heating setpoint is above setback).
 * - Para 67 (p. 23), local mechanical exhaust: 0.40 W per l/s with the fan in the zone, 0.60 W per l/s remote.
 * - Para 66 (p. 23), ventilation that provides no heating or cooling: 0.90 W per l/s, supply and extract.
 *
 * How they are used here (each one is filled as a stated value, shown as "default, from <source>" until edited):
 * - A pump's rated power is Table 14's **constant speed** row, as `power: { w_per_m2 }`. A variable-speed pump keeps
 *   the same rated power; its saving comes from the part-load curve (thermal/engine/pumps.ts). Table 14's
 *   variable-speed rows are lower densities that already include that saving, so using them as well would count it
 *   twice; they are listed for comparison only.
 * - A cooling system's own pumps (chilled water) are Table 14's "Both" less "LTHW only": the table gives no CHW-only
 *   column, so this is a stated subtraction, not a printed figure.
 * - Nothing is filled at run time; the engine refuses a missing value by name.
 */
export const NCM_SOURCE = 'NCM Modelling Guide 2021 (England), Table 14 / paras 66–67'

export const NCM_PUMP_W_PER_M2 = {
  /** Table 14, LTHW only / Both LTHW and CHW, W/m². */
  constant_speed: { lthw: 0.6, both: 1.8 },
  variable_differential_across_pump: { lthw: 0.5, both: 1.5 },
  variable_differential_in_system: { lthw: 0.4, both: 1.1 },
  variable_multiple_sensors: { lthw: 0.3, both: 0.9 },
} as const

/**
 * The rated pump power a "Use defaults" fills, W/m² of the floor the system serves (constant-speed row; see above).
 * Null for hot water: Table 14 is for space heating and cooling circuits, and the NCM counts a secondary hot water
 * circulation pump separately (para 69; here `services.dhw.circulation_pump_w`), so there is no published default to
 * fill and the user states it.
 */
export function defaultPumpWPerM2(service: 'heating' | 'cooling' | 'dhw'): number | null {
  const c = NCM_PUMP_W_PER_M2.constant_speed
  if (service === 'cooling') return +(c.both - c.lthw).toFixed(6)  // 1.2: stated subtraction, no CHW-only column
  if (service === 'heating') return c.lthw
  return null
}

/** Para 66 and 67, W per l/s. */
export const NCM_SFP_W_PER_L_S = {
  local_exhaust_in_zone: 0.4,
  local_exhaust_remote: 0.6,
  ventilation_only_supply_and_extract: 0.9,
} as const

/**
 * Whether a system has a water circuit to pump (NCM Table 13: split, multi-split and VRF systems have none; wet
 * systems do): a heating system with its design flow temperature stated, or feeding a wet emitter (radiator,
 * underfloor, fan coil); a cooling system with a wet unit (fan coil) in a zone it serves. Otherwise null: not known
 * from the document, so no default is filled and the user says.
 */
export function hasWaterCircuit(doc: { zones: { id: string; emitters: { kind: string; system_group_id: string | null; cooling_output_w?: number | null }[] }[]; system_groups: { id: string; service: string; zones: string[]; design_flow_c?: number | null }[] }, groupId: string): boolean | null {
  const g = doc.system_groups.find((x) => x.id === groupId)
  if (!g) return null
  if (g.service === 'heating') {
    if (g.design_flow_c != null) return true
    if (doc.zones.some((z) => z.emitters.some((e) => e.system_group_id === g.id && ['radiator', 'underfloor', 'fan_coil'].includes(e.kind)))) return true
    return null
  }
  if (g.service === 'cooling') {
    if (doc.zones.some((z) => g.zones.includes(z.id) && z.emitters.some((e) => e.kind === 'fan_coil' && e.cooling_output_w != null))) return true
    return null
  }
  return null
}

/** What "Use defaults" fills for a system's pumps, or null (no water circuit known, or no published figure). */
export function defaultPumps(doc: Parameters<typeof hasWaterCircuit>[0], groupId: string) {
  const g = doc.system_groups.find((x) => x.id === groupId)
  if (!g || (g.service !== 'heating' && g.service !== 'cooling')) return null
  const w = defaultPumpWPerM2(g.service)
  if (w == null || hasWaterCircuit(doc, groupId) !== true) return null
  return { power: { w_per_m2: w }, speed: 'fixed' as const, runs: 'with_demand' as const, schedule_ref: null, default_from: NCM_SOURCE }
}
