/**
 * Brief 114 Part 2: the pumps of a heating, cooling or hot water system, and the building's other loads (lifts,
 * external lighting), hour by hour. Electricity, at "+ Systems" (Rule 8). Pump heat into the water is not counted.
 *
 * Pumps (`system_groups[].pumps`, schema 2.10):
 *   rated W     power.w; or power.w_per_kw_capacity × the system's capacity_kw (with none, a heating system's design
 *               heat loss when the building states design conditions; otherwise refused, review F4);
 *               or power.w_per_m2 × the floor it serves (each zone's area × the system's share)
 *   running r   'continuous': 1 in every hour of its season: the stated months, or with none the months in which
 *               the system has any load (Linzie 16 Nov 23:11: the season, not all year)
 *               'with_demand': 1 in the hours its load is above zero, else 0
 *               'schedule': the schedule profile's fraction of the hour
 *   fixed       P = rated × r
 *   variable    P = rated × r × curve(x), x = the hour's load ÷ its design load (its capacity_kw, or with none its
 *               design heat loss, or with neither its busiest hour, shown as such), held to 0..1
 *
 * The part-load curve is EnergyPlus's Pump:VariableSpeed with its default coefficients (Input Output Reference,
 * Pump:VariableSpeed, "Coefficient 1–4 of the Part Load Performance Curve": 0, 1, 0, 0), so the fraction of full
 * power is the fraction of full load, and an hour with nothing to do draws nothing. EnergyPlus takes x as the flow
 * fraction; here it is the load fraction (the brief's choice). The referee (docs/audit/114/02_referee.md) measures
 * what that difference is worth.
 */
import type { ModelDocument } from '../schema/model'
import { calendar } from './gains'
import type { Weather } from './types'

/** Fraction of full power = c[0] + c[1]·x + c[2]·x² + c[3]·x³ (EnergyPlus Pump:VariableSpeed defaults). */
export const PUMP_CURVE = {
  coefficients: [0, 1, 0, 0] as const,
  source: 'EnergyPlus Pump:VariableSpeed default part-load coefficients (Input Output Reference)',
  /**
   * Brief 114 review F3: what the panel shows beside a variable-speed pump. An ideal pump: its saving (about 60 % on
   * the referee and Bridgewater) is larger than NCM Table 14's variable-speed rows imply (17–50 % below constant speed).
   */
  note: 'ideal: power in proportion to load, no minimum speed (EnergyPlus default); NCM Table 14 implies a 17–50 % saving',
}

export const pumpCurve = (x: number) => {
  const v = Math.min(1, Math.max(0, x))
  const [a, b, c, d] = PUMP_CURVE.coefficients
  return a + b * v + c * v * v + d * v * v * v
}

export class ScheduleError extends Error {
  constructor(message: string, readonly path: string) { super(`${path}: ${message}`); this.name = 'ScheduleError' }
}

/** A schedule profile's fraction of each hour (1 January a Monday, as gains and ventilation read it). */
export function scheduleFractions(doc: ModelDocument, ref: string, hours: Weather['hours'], path: string): Float64Array {
  const i = doc.profiles.findIndex((p) => p.id === ref && p.kind === 'schedule')
  if (i < 0) throw new ScheduleError(`schedule profile "${ref}" does not exist`, path)
  const p = doc.profiles[i] as Extract<ModelDocument['profiles'][number], { kind: 'schedule' }>
  const c = calendar(hours)
  const out = new Float64Array(hours.count)
  for (let h = 0; h < hours.count; h++) {
    const f = p.day_types[c.day[h]][c.hourOfDay[h]]
    if (!(f >= 0 && f <= 1)) throw new ScheduleError(`hour ${c.hourOfDay[h]} of ${c.day[h]} must be 0 to 1`, `profiles[${i}].day_types`)
    out[h] = f
  }
  return out
}

export interface PumpRun {
  /** Electricity each hour, W. */
  w: Float64Array
  /** Hours the pumps ran (the sum of the running fraction). */
  hours_run: number
}

/**
 * One system's pumps over the year. `load_w` is the heat the system gave each hour (W); `design_w` its design load
 * (capacity, or its busiest hour); `month` the weather's month of each hour (1–12); `sched` the schedule's fractions.
 */
export function runPumps(rated_w: number, speed: 'fixed' | 'variable', runs: 'continuous' | 'with_demand' | 'schedule',
  load_w: Float64Array, design_w: number, month: ArrayLike<number>, sched: Float64Array | null,
  seasonMonths: readonly number[] | null = null): PumpRun {
  const H = load_w.length
  const season = new Set<number>(seasonMonths ?? [])
  if (runs === 'continuous' && seasonMonths == null) for (let h = 0; h < H; h++) if (load_w[h] > 0) season.add(month[h])
  const w = new Float64Array(H)
  let hours_run = 0
  for (let h = 0; h < H; h++) {
    const r = runs === 'continuous' ? (season.has(month[h]) ? 1 : 0) : runs === 'with_demand' ? (load_w[h] > 0 ? 1 : 0) : sched![h]
    if (!(r > 0)) continue
    hours_run += r
    w[h] = speed === 'fixed' ? rated_w * r : rated_w * r * pumpCurve(design_w > 0 ? load_w[h] / design_w : 0)
  }
  return { w, hours_run }
}

/** External lighting on a photocell is on in the hours the weather file gives no daylight (global horizontal 0 Wh/m²). */
export const isDark = (hours: Weather['hours'], h: number) => !(hours.global_horizontal[h] > 0)
