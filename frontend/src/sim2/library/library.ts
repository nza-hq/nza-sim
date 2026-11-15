/**
 * Sim2 prototype: NZA Sim's library as the Fabric and Spaces steps see it. Read from a committed snapshot of the
 * Brief 102 library export (snapshot.json, made by scripts/sim2_library_snapshot.mjs), so the prototype runs without
 * the backend. Every U-value, g-value, efficiency and profile here is a library row's own value (CLAUDE.md rule 3);
 * when NZA Sim's own Supabase library is wired in, this file is the one seam to change.
 */
import snap from './snapshot.json'

export type Element = 'wall' | 'glazing' | 'door' | 'roof' | 'floor'
export type Construction = { key: string; body_hash: string; element: string; name: string; u: number | null; g: number | null }
export type SystemTemplate = {
  key: string
  body_hash: string
  name: string
  type: string | null
  category: string
  serves: string | null
  fuel: string | null
  scop: number | null
  seer: number | null
  efficiency: number | null
  efficiency_type: string | null
  sfp: number | null
  heat_recovery: number | null
}
export type Profile = {
  key: string
  body_hash: string
  name: string
  schedule_type: string
  building_type: string | null
  zone_type: string | null
  /** The library profile is a shape only: hourly fractions by day type, and monthly multipliers. */
  day_types: { weekday: number[]; saturday: number[]; sunday: number[] } | null
  monthly_multipliers: number[] | null
}

export const LIBRARY = {
  constructions: snap.constructions as Construction[],
  systems: snap.systems as SystemTemplate[],
  profiles: snap.profiles as Profile[],
  exported_at: snap.exported_at as string,
  source_sha256: snap.source_sha256 as string,
}

/** The library has no door constructions yet (its element types are wall, glazing, roof, floor, interior). */
export const constructionsFor = (e: Element) => LIBRARY.constructions.filter((c) => c.element === e)
export const construction = (key: string | null | undefined) => (key ? LIBRARY.constructions.find((c) => c.key === key) : undefined)
export const system = (key: string | null | undefined) => (key ? LIBRARY.systems.find((s) => s.key === key) : undefined)
export const profile = (key: string | null | undefined) => (key ? LIBRARY.profiles.find((p) => p.key === key) : undefined)

export type Service = 'heating' | 'cooling' | 'ventilation' | 'dhw'
/** Templates that can serve a service: a "heating and cooling" VRF counts for both. */
export const systemsFor = (s: Service) =>
  LIBRARY.systems.filter((t) =>
    s === 'heating' ? t.serves === 'heating' || t.serves === 'heating_and_cooling'
    : s === 'cooling' ? t.serves === 'cooling' || t.serves === 'heating_and_cooling'
    : t.serves === s || t.category === s,
  )
export const profilesFor = (type: 'occupancy' | 'lighting' | 'equipment' | 'ventilation') => LIBRARY.profiles.filter((p) => p.schedule_type === type)

/** The efficiency a system group carries for a service, from the template: SCOP (or η) for heating, SEER for
 * cooling, η for DHW. Null when the template gives none for that service. */
export function efficiencyFor(t: SystemTemplate, s: Service): number | null {
  if (s === 'heating') return t.scop ?? t.efficiency
  if (s === 'cooling') return t.seer ?? (t.category === 'cooling' ? t.efficiency : null)
  if (s === 'dhw') return t.efficiency
  return null
}
