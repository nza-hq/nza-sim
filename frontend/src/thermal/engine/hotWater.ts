/**
 * Hot water by zone, hour by hour: the one calculation (Rule 11), read by Systems for its energy (Brief 107, 112) and
 * by the run for a plant that heats hot water first (Brief 120). Use is the spaces' (each occupancy profile's `dhw`,
 * Brief 112); the store, tap and cold temperatures and the load shape are the building's (`services.dhw`). The boiler
 * heats only the hot fraction of the tap water: (tap − cold) ÷ (store − cold).
 */
import type { ModelDocument } from '../schema/model'
import type { ZoneGains } from './gains'

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
export function zoneHotWater(doc: ModelDocument, gains: readonly (ZoneGains | null)[], H: number): { ok: true; hw: HotWater | null } | { ok: false; issues: HotWaterIssue[] } {
  if (!doc.zones.some((_, zi) => hotWaterUse(doc, zi) != null)) return { ok: true, hw: null }
  const issues: HotWaterIssue[] = []
  const miss = (path: string, message: string) => { if (!issues.some((m) => m.path === path)) issues.push({ path, message }) }
  const d = doc.services.dhw
  const need = (v: number | string | null, k: string) => { if (v == null) miss(`services.dhw.${k}`, 'required: a hot water system is installed'); return v }
  const store = need(d.storage_setpoint_c, 'storage_setpoint_c') as number | null
  const tap = need(d.tap_outlet_temp_c, 'tap_outlet_temp_c') as number | null
  const cold = need(d.cold_supply_temp_c, 'cold_supply_temp_c') as number | null
  const shape = need(d.load_shape, 'load_shape') as string | null
  if (shape != null && shape !== 'flat' && shape !== 'follow_occupancy') miss('services.dhw.load_shape', `unknown shape "${shape}" (flat or follow_occupancy)`)
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
    } else w.fill((kwh * 1000) / H)
    return { w, kwh }
  })
  return issues.length ? { ok: false, issues } : { ok: true, hw: { hot_fraction: hot, zones } }
}
