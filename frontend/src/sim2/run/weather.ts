/**
 * Brief 105 Part 4: the weather the seam runs on. Never a silent default (brief decision 4): the person chooses a
 * file, and the panel shows which file and which station.
 *
 * Two sources:
 * - **A local EPW**, read in the browser and never uploaded (`weatherFromBytes`).
 * - **The organisation's own files** in NZA Sim (dev)'s private `weather` bucket, `<org id>/<name>.epw`
 *   (supabase/migrations/0006_weather_bucket.sql: readable by the organisation's members only).
 *
 * No EPW is committed to the repo: Climate.OneBuilding states no open licence (docs/audit/105/00_reconnaissance.md).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseEpw } from '../../thermal/engine/epw'
import type { Weather } from '../../thermal/engine/types'

export interface WeatherChoice {
  weather: Weather
  /** The file's name, as the person sees it. */
  file_name: string
  /** The station, from the EPW's own header. */
  station: string
  sha256: string
  source: 'local' | 'organisation'
}

export const BUCKET = 'weather'

/** Reads an EPW's bytes; throws the parser's own message (EpwError) when the file is not an hourly EPW. */
export async function weatherFromBytes(bytes: Uint8Array, file_name: string, source: WeatherChoice['source']): Promise<WeatherChoice> {
  const weather = await parseEpw(bytes)
  const h = weather.header
  const station = [h.city, h.region, h.country].filter((s) => s && s !== '-').join(', ') + (h.wmo ? ` (WMO ${h.wmo})` : '')
  return { weather, file_name, station, sha256: weather.sha256, source }
}

/** The EPW files in the organisation's folder. */
export async function listOrganisationWeather(supabase: SupabaseClient, orgId: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(BUCKET).list(orgId, { limit: 100, sortBy: { column: 'name', order: 'asc' } })
  if (error) throw new Error(error.message)
  return (data ?? []).map((f) => f.name).filter((n) => n.toLowerCase().endsWith('.epw'))
}

/** One of the organisation's EPW files, downloaded and read. */
export async function weatherFromOrganisation(supabase: SupabaseClient, orgId: string, name: string): Promise<WeatherChoice> {
  const { data, error } = await supabase.storage.from(BUCKET).download(`${orgId}/${name}`)
  if (error || !data) throw new Error(error?.message ?? 'The weather file could not be downloaded.')
  return weatherFromBytes(new Uint8Array(await data.arrayBuffer()), name, 'organisation')
}
