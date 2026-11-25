/**
 * Hot water by zone, hour by hour: the one calculation (Rule 11), read by Systems for its energy (Brief 107, 112) and
 * by the run for a plant that heats hot water first (Brief 120). Use is the spaces' (each occupancy profile's `dhw`,
 * Brief 112); the store, tap and cold temperatures and the load shape are the building's (`services.dhw`). The boiler
 * heats only the hot fraction of the tap water: (tap − cold) ÷ (store − cold).
 */
import type { ModelDocument } from '../schema/model'
import type { ZoneGains } from './gains'
import type { Weather } from './types'
import { ScheduleError, scheduleFractions } from './pumps'

/** kWh to warm one litre of water by one kelvin. */
export const WATER_KWH_PER_L_K = 4.18 / 3600

export interface HotWaterIssue { path: string; message: string }
export interface HotWater {
  hot_fraction: number
  /** Per zone: its hot water heat, W per hour, and kWh a year; null where the zone uses none. */
  zones: ({ w: Float64Array; kwh: number } | null)[]
}

/** The zone's stated use, from its occupancy profile (Brief 112), or null. */
export function hotWaterUse(doc: ModelDocument, zi: number) {
  const ref = doc.zones[zi].profile_refs.occupancy
  const pi = ref == null ? -1 : doc.profiles.findIndex((p) => p.id === ref)
  const p = pi < 0 ? null : doc.profiles[pi]
  return p && p.kind === 'occupancy' && p.dhw ? { ...p.dhw, path: `profiles[${pi}].dhw` } : null
}

/**
 * Each zone's hot water heat. Issues name what is missing (temperatures, load shape, occupancy to follow); nothing is
 * filled. `ok` with hw null: no space states any use.
 */
export function zoneHotWater(doc: ModelDocument, gains: readonly (ZoneGains | null)[], H: number, hours?: Weather['hours']): { ok: true; hw: HotWater | null } | { ok: false; issues: HotWaterIssue[] } {
  if (!doc.zones.some((_, zi) => hotWaterUse(doc, zi) != null)) return { ok: true, hw: null }
  const issues: HotWaterIssue[] = []
  const miss = (path: string, message: string) => { if (!issues.some((m) => m.path === path)) issues.push({ path, message }) }
  const d = doc.services.dhw
  const need = (v: number | string | null, k: string) => { if (v == null) miss(`services.dhw.${k}`, 'required: a hot water system is installed'); return v }
  const store = need(d.storage_setpoint_c, 'storage_setpoint_c') as number | null
  const tap = need(d.tap_outlet_temp_c, 'tap_outlet_temp_c') as number | null
  const cold = need(d.cold_supply_temp_c, 'cold_supply_temp_c') as number | null
  const shape = need(d.load_shape, 'load_shape') as string | null
  // Brief 129 (Linzie, 25 Nov 2026: every profile type must work in the model): the shape may also name a schedule
  // profile (a hot water profile): the year's hot water is shared out by its hourly fractions.
  let byProfile: Float64Array | null = null
  if (shape != null && shape !== 'flat' && shape !== 'follow_occupancy') {
    if (!doc.profiles.some((p) => p.id === shape && p.kind === 'schedule')) miss('services.dhw.load_shape', `unknown shape "${shape}" (flat, follow_occupancy, or a schedule profile's id)`)
    else if (!hours) miss('services.dhw.load_shape', 'a hot water profile needs the weather year')
    else {
      try { byProfile = scheduleFractions(doc, shape, hours, 'services.dhw.load_shape') } catch (e) { if (e instanceof ScheduleError) miss(e.path, e.message); else throw e }
      if (byProfile && !(byProfile.reduce((a, b) => a + b, 0) > 0)) miss('services.dhw.load_shape', `hot water profile "${shape}" is zero all year`)
    }
  }
  if (store != null && cold != null && !(store > cold)) miss('services.dhw.storage_setpoint_c', 'must be above the cold supply temperature')
  if (store != null && cold != null && tap != null && !(tap >= cold && tap <= store)) miss('services.dhw.tap_outlet_temp_c', 'must be between the cold supply and the store temperatures')
  if (issues.length || store == null || cold == null || tap == null || shape == null) return { ok: false, issues }
  const hot = (tap - cold) / (store - cold)
  const zones = doc.zones.map((zone, zi) => {
    const use = hotWaterUse(doc, zi)
    if (!use) return null
    const occ = gains[zi]?.occupancy ?? null
    let tapLitres: number
    if (use.basis === 'per_person') {
      if (!occ) { miss(`zones[${zi}].profile_refs.occupancy`, `hot water per person needs ${zone.name || zone.id}'s occupancy`); return null }
      tapLitres = occ.people * use.litres_per_day
    } else tapLitres = use.litres_per_day * zone.area_m2
    const kwh = tapLitres * hot * (store - cold) * WATER_KWH_PER_L_K * 365  // a year of days, as today
    if (!(kwh > 0)) return null
    const w = new Float64Array(H)
    if (shape === 'follow_occupancy') {
      if (!occ) { miss(`zones[${zi}].profile_refs.occupancy`, `hot water following occupancy needs ${zone.name || zone.id}'s occupancy`); return null }
      let ps = 0
      for (let h = 0; h < H; h++) ps += occ.presence[h]
      if (!(ps > 0)) { miss('services.dhw.load_shape', `${zone.name || zone.id} is never occupied, so its hot water cannot follow occupancy`); return null }
      for (let h = 0; h < H; h++) w[h] = (kwh * 1000 * occ.presence[h]) / ps
    } else if (byProfile) {
      let ps = 0
      for (let h = 0; h < H; h++) ps += byProfile[h]
      for (let h = 0; h < H; h++) w[h] = (kwh * 1000 * byProfile[h]) / ps
    } else w.fill((kwh * 1000) / H)
    return { w, kwh }
  })
  return issues.length ? { ok: false, issues } : { ok: true, hw: { hot_fraction: hot, zones } }
}

/** Brief 120: a water heater and its store over the year, hour by hour. */
export interface WaterHeaterRun {
  /** What the heater put into the water each hour (refilling the store), W. */
  heater_w: Float64Array
  /** What the taps did not get each hour, W (0 when the store and heater met the draw). */
  short_w: Float64Array
  /** Heat held in the store at the end of each hour, kWh (0 to `usable_kwh`). */
  stored_kwh: Float64Array
  usable_kwh: number
}

/**
 * Brief 120 (Linzie, 16 Nov 19:19): a dedicated water heater of `cap_w` refilling a store of `litres` at the store
 * temperature. The store holds litres × (store − cold) × 4.18 kJ/(l·K), all of it usable (as if fully stratified: the
 * hot water above the incoming cold is drawn off at the store temperature) and loses nothing standing. Review F5(d): it
 * starts the year as it ended it (one warm-up pass from full), so a shortfall at the year's end is refilled within it. Each hour the taps draw `draw_w`: the heater gives up to its output, the store covers the rest while it
 * has any, and what is left is short. When the draw is below the output the heater refills the store with the
 * difference. The draw is hourly (the load shape's), so a burst inside one hour is not seen.
 */
export function waterHeater(draw_w: ArrayLike<number>, cap_w: number, litres: number, store_c: number, cold_c: number): WaterHeaterRun {
  const H = draw_w.length
  const usable = litres * (store_c - cold_c) * WATER_KWH_PER_L_K
  const heater_w = new Float64Array(H), short_w = new Float64Array(H), stored_kwh = new Float64Array(H)
  let s = usable
  for (let pass = 0; pass < 2; pass++) for (let h = 0; h < H; h++) {
    const d = draw_w[h]
    if (d <= cap_w) {
      const refill = Math.min(cap_w - d, (usable - s) * 1000)
      s += refill / 1000
      heater_w[h] = d + refill
    } else {
      const fromStore = Math.min(d - cap_w, s * 1000)
      s -= fromStore / 1000
      heater_w[h] = cap_w
      short_w[h] = d - cap_w - fromStore
    }
    stored_kwh[h] = s
  }
  return { heater_w, short_w, stored_kwh, usable_kwh: usable }
}
