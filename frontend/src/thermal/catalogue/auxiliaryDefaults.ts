/**
 * Brief 114 Part 1: the stated defaults behind "Use defaults" for pumps and back-of-house fans.
 *
 * Source: the UK National Calculation Methodology, "NCM Modelling Guide for non-domestic buildings in England",
 * 2021 edition (15 Dec 2021), https://www.uk-ncm.org.uk/filelibrary/NCM_Modelling_Guide_2021_Edition_England_15Dec2021.pdf
 * Read 16 Nov 2026 through a text extraction (the container's proxy blocks the file, so no sha256 yet; to check on
 * IT15 against the page, as the Stelrad catalogue was in Brief 119).
 *
 * - Table 14 (p. 32), pump power density by pump configuration, W/m² of floor, "LTHW only" and "Both LTHW and CHW".
 *   For the Actual building NCM multiplies it by the heating system's hours (para 103: the hours when the heating
 *   setpoint is above the setback; para 62 is the same rule for the Notional building). Review F2: the W/m² is only
 *   NCM's figure when paired with those hours, so "Use defaults" pairs them (see `defaultPumps`).
 * - Paras 66–67 (p. 23): the **Notional building's** specific fan powers (0.90 W per l/s for ventilation that provides
 *   no heating or cooling, supply and extract; 0.40 / 0.60 W per l/s for local exhaust in the zone / remote). They are
 *   a reference building's values, not measured or typical ones; shown as such.
 * - Para 58(d): the Notional building's secondary hot water circulation pump (not filled here; see below).
 *
 * How they are used here (each one is filled as a stated value, shown as "default, from <source>" until edited):
 * - A pump's rated power is Table 14's **constant speed** row, as `power: { w_per_m2 }`. A variable-speed pump keeps
 *   the same rated power; its saving comes from the part-load curve (thermal/engine/pumps.ts). Table 14's
 *   variable-speed rows are lower densities that already include that saving, so using them as well would count it
 *   twice; they are listed for comparison only.
 * - A cooling system's own pumps (chilled water) are Table 14's "Both" less "LTHW only": the table gives no CHW-only
 *   column, so this is a stated subtraction, not a printed figure, and running it over the cooling hours is this
 *   tool's own pairing (NCM counts the whole "Both" figure over the heating hours). Review F2.
 * - Nothing is filled at run time; the engine refuses a missing value by name.
 */
export const NCM_SOURCE = 'NCM Modelling Guide 2021 (England), Table 14 (p. 32), para 103; Notional SFPs paras 66–67'

export const NCM_PUMP_W_PER_M2 = {
  /** Table 14, LTHW only / Both LTHW and CHW, W/m². */
  constant_speed: { lthw: 0.6, both: 1.8 },
  variable_differential_across_pump: { lthw: 0.5, both: 1.5 },
  variable_differential_in_system: { lthw: 0.4, both: 1.1 },
  variable_multiple_sensors: { lthw: 0.3, both: 0.9 },
} as const

/**
 * The rated pump power a "Use defaults" fills, W/m² of the floor the system serves (constant-speed row; see above).
 * Null for hot water: Table 14 is for space heating and cooling circuits. A hot water system's `pumps` are its primary
 * pumps; the secondary circulation pump is `services.dhw.circulation_pump_w` (NCM gives only the Notional building's,
 * para 58(d)), so there is no published default to fill and the user states it.
 */
export function defaultPumpWPerM2(service: 'heating' | 'cooling' | 'dhw'): number | null {
  const c = NCM_PUMP_W_PER_M2.constant_speed
  if (service === 'cooling') return +(c.both - c.lthw).toFixed(6)  // 1.2: stated subtraction, no CHW-only column
  if (service === 'heating') return c.lthw
  return null
}

/** Paras 66–67, W per l/s: the Notional building's SFPs (a reference building's, not typical or measured). */
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

type DefaultsDoc = Parameters<typeof hasWaterCircuit>[0] & { zones: { id: string; setpoints?: { hours_ref: string | null } }[] }

/**
 * What "Use defaults" fills for a system's pumps, or null (no water circuit known, or no published figure).
 *
 * Review F2, the hours: NCM's W/m² goes with the heating hours (para 103). When every room the system serves has the
 * same heating hours (`setpoints.hours_ref`, Brief 109), the pumps run to that schedule. When they do not, there is no
 * one set of hours to pair, so they run with demand, and `default_from` says so (the user can change it).
 */
export function defaultPumps(doc: DefaultsDoc, groupId: string) {
  const g = doc.system_groups.find((x) => x.id === groupId)
  if (!g || (g.service !== 'heating' && g.service !== 'cooling')) return null
  const w = defaultPumpWPerM2(g.service)
  if (w == null || hasWaterCircuit(doc, groupId) !== true) return null
  const refs = new Set(doc.zones.filter((z) => g.zones.includes(z.id)).map((z) => z.setpoints?.hours_ref ?? null))
  const shared = refs.size === 1 ? [...refs][0] : null
  const cooling = g.service === 'cooling' ? '; chilled water = Both − LTHW only over the cooling hours (this tool\'s pairing, not NCM\'s)' : ''
  if (shared != null) return { power: { w_per_m2: w }, speed: 'fixed' as const, runs: 'schedule' as const, schedule_ref: shared, default_from: `${NCM_SOURCE}; hours: the rooms' ${g.service} hours${cooling}` }
  return { power: { w_per_m2: w }, speed: 'fixed' as const, runs: 'with_demand' as const, schedule_ref: null,
    default_from: `${NCM_SOURCE}; hours: with demand, as the rooms served have no one set of ${g.service} hours (NCM pairs the W/m² with the heating hours)${cooling}` }
}
