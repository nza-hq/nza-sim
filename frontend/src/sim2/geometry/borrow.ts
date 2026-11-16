/**
 * "Used for": a space type borrows what today's NZA Sim already knows about a kind of room, in one go.
 *
 *   profiles (the daily shapes)  — NZA Sim's library (snapshot.json), by its building and zone type
 *   lighting and equipment W/m², how they follow occupancy, daylight and standby
 *                                — today's Internal Gains templates (frontend/src/data/loadTypeLibrary.js), read
 *                                  from that file, not copied
 *   comfort temperatures         — the occupied value of the library's heating and cooling setpoint profiles
 *
 * Everything borrowed lands as visible values on the space type and can be changed. Nothing here is a hidden default:
 * a value the sources do not give (people per m², for one) is left as it was.
 */
// @ts-expect-error today's JS data module has no types; the shape used is Tpl below
import { EQUIPMENT_LOAD_TYPES, LIGHTING_LOAD_TYPES } from '../../data/loadTypeLibrary.js'
import { LIBRARY } from '../library/library'
import type { SpaceType } from './plan'

type Tpl = { id: string; magnitude?: { value: number }; active?: { value: number }; baseload?: { value: number }; relationship_to_occupancy?: string; daylight_factor?: number; standby_factor?: number }
const tpl = (list: Record<string, Tpl[]>, type: string, id: string) => (list[type] ?? []).find((x) => x.id === id) ?? null

export type Borrow = { key: string; name: string; use: string; type: string; occupancy: string | null; lighting: string | null; equipment: string | null; light: string | null; equip: string | null }

/** The kinds of room the library has profiles for, each with today's templates that match it. */
export const BORROWS: Borrow[] = [
  { key: 'hotel_bedroom', name: 'Hotel bedroom', use: 'bedroom', type: 'hotel', occupancy: 'hotel_bedroom_occupancy', lighting: 'hotel_bedroom_lighting', equipment: 'hotel_bedroom_equipment', light: 'hotel_bedroom_lighting', equip: 'hotel_guest_equipment' },
  { key: 'hotel_corridor', name: 'Hotel corridor', use: 'public', type: 'hotel', occupancy: 'hotel_corridor_occupancy', lighting: 'hotel_corridor_lighting', equipment: null, light: 'hotel_corridor_lighting', equip: null },
  { key: 'hotel_reception', name: 'Hotel reception', use: 'public', type: 'hotel', occupancy: 'hotel_reception_occupancy', lighting: null, equipment: null, light: null, equip: null },
  { key: 'office', name: 'Office, open plan', use: 'office', type: 'office', occupancy: 'office_occupancy', lighting: 'office_lighting', equipment: null, light: 'office_workstation_lighting', equip: 'office_workstation_equipment' },
  { key: 'retail', name: 'Shop floor', use: 'retail', type: 'retail', occupancy: 'retail_occupancy', lighting: null, equipment: null, light: 'retail_sales_floor', equip: 'retail_sales_equipment' },
].filter((b) => b.occupancy == null || LIBRARY.profiles.some((p) => p.key === b.occupancy))

/** The occupied value of a setpoint profile: the highest heating or lowest cooling hour on a weekday. */
const occupiedSetpoint = (type: string, which: 'heating' | 'cooling') => {
  const p = LIBRARY.profiles.find((x) => x.schedule_type === `${which}_setpoint` && x.building_type === type)
  const d = p?.day_types?.weekday
  if (!d?.length) return null
  return which === 'heating' ? Math.max(...d) : Math.min(...d)
}

/** What a space type takes from a "Used for" choice. Only what the sources give; the rest is left alone. */
export function borrow(b: Borrow): Partial<SpaceType> {
  const L = b.light ? tpl(LIGHTING_LOAD_TYPES as Record<string, Tpl[]>, b.type, b.light) : null
  const E = b.equip ? tpl(EQUIPMENT_LOAD_TYPES as Record<string, Tpl[]>, b.type, b.equip) : null
  const heat = occupiedSetpoint(b.type, 'heating')
  const cool = occupiedSetpoint(b.type, 'cooling')
  return {
    borrowed: b.key,
    use: b.use,
    occupancy: b.occupancy,
    lighting: b.lighting,
    equipment: b.equipment,
    ...(L ? { lighting_w_per_m2: L.magnitude?.value ?? null, light_relationship: L.relationship_to_occupancy ?? null, ...(L.daylight_factor != null ? { daylight_factor: L.daylight_factor } : {}) } : {}),
    ...(E ? { equipment_w_per_m2: E.active?.value ?? null, equipment_baseload_w_per_m2: E.baseload?.value ?? null, equip_relationship: E.relationship_to_occupancy ?? null, ...(E.standby_factor != null ? { standby_factor: E.standby_factor } : {}) } : {}),
    ...(heat != null ? { heat_c: heat } : {}),
    ...(cool != null ? { cool_c: cool } : {}),
  }
}

/** One line on where the borrowed values came from, for the panel. */
export function borrowedFrom(b: Borrow): string {
  const bits = [b.occupancy && 'occupancy', (b.lighting || b.light) && 'lighting', (b.equipment || b.equip) && 'equipment'].filter(Boolean)
  return `Took ${bits.join(', ')} and comfort temperatures from NZA Sim's ${b.name.toLowerCase()} profiles.`
}
