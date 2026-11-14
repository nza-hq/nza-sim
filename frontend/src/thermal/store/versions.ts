/**
 * Model versions and runs in NZA Sim's own Supabase project (Brief 102 Part 5).
 *
 * Every write goes through the security-definer functions of supabase/migrations/0002_model_store.sql; reads go
 * through RLS. Nothing here computes a number: the run's summary is copied from the instant engine's result through
 * the one canonical EUI read (engineReads.readModelledEui, CLAUDE.md rule 11).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalJSON, sha256Hex } from '../schema/canonical'
import { libraryHash, weatherHash } from '../schema/hash'
import type { ModelDocument } from '../schema/model'
import { RunSummary } from '../schema/results'
// @ts-expect-error: plain JS module
import { readModelledEui } from '../../utils/engineReads.js'

import { ENGINE_SHA } from 'virtual:engine-fingerprint'

/**
 * The run key's engine version: the instant engine's label plus a content hash of its whole source import closure,
 * the built-in system templates included (frontend/plugins/engineFingerprint.js). An engine edit is a new key, so a
 * stored run is never served for numbers a different engine would give (Brief 102a, QA H1).
 */
export const INSTANT_ENGINE_VERSION = engineVersionFor(ENGINE_SHA)

export function engineVersionFor(sha: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha ?? '')) throw new Error('no engine fingerprint: run through Vite (dev server, build or vite-node)')
  return `instant-1+${sha.slice(0, 24)}`
}
export const INSTANT_SOURCE = 'engineReads.readModelledEui'

function fail(what: string, err: { code?: string; message?: string }): never {
  throw Object.assign(new Error(`${what}: ${err.message ?? 'failed'}`), { code: err.code })
}

/** The organisation's project with this name, created if it does not exist. */
export async function ensureProject(sb: SupabaseClient, orgId: string, name: string): Promise<string> {
  const { data, error } = await sb.from('projects').select('id').eq('org_id', orgId).eq('name', name).order('created_at').limit(1)
  if (error) fail('reading projects', error)
  if (data && data.length) return data[0].id
  const { data: id, error: e2 } = await sb.rpc('create_project', { p_org: orgId, p_name: name })
  if (e2) fail('creating the project', e2)
  return id as string
}

/** The project's building with this name, created if it does not exist. */
export async function ensureBuilding(sb: SupabaseClient, projectId: string, name: string): Promise<string> {
  const { data, error } = await sb.from('buildings').select('id').eq('project_id', projectId).eq('name', name).order('created_at').limit(1)
  if (error) fail('reading buildings', error)
  if (data && data.length) return data[0].id
  const { data: id, error: e2 } = await sb.rpc('create_building', { p_project: projectId, p_name: name })
  if (e2) fail('creating the building', e2)
  return id as string
}

export interface SavedVersion {
  id: string
  model_hash: string
  library_hash: string
  weather_hash: string
  /** False when an existing version of this building already had this exact document (nothing new saved). */
  created: boolean
}

/**
 * Saves the document as the building's next version, unless a version with the same model hash exists for that
 * building already (then that one is returned). Versions are immutable; the newest becomes the parent.
 */
export async function saveModelVersion(sb: SupabaseClient, buildingId: string, doc: ModelDocument, note: string | null): Promise<SavedVersion> {
  // The exact text that is hashed is what the database stores and checks (Brief 102a, QA M1): SQL never re-serialises
  // it, so float noise such as -2.8e-17 or a value of 1e21 hashes the same on both sides.
  const canonical = canonicalJSON(doc)
  const [mh, lh, wh] = await Promise.all([sha256Hex(canonical), libraryHash(doc.library_refs), weatherHash(doc.weather_ref)])
  const same = await sb.from('model_versions').select('id').eq('building_id', buildingId).eq('model_hash', mh).limit(1)
  if (same.error) fail('reading model versions', same.error)
  if (same.data && same.data.length) return { id: same.data[0].id, model_hash: mh, library_hash: lh, weather_hash: wh, created: false }
  const latest = await sb.from('model_versions').select('id').eq('building_id', buildingId).order('created_at', { ascending: false }).limit(1)
  if (latest.error) fail('reading model versions', latest.error)
  const { data: id, error } = await sb.rpc('create_model_version', {
    p_building: buildingId, p_schema_version: doc.schema_version, p_canonical: canonical,
    p_model_hash: mh, p_library_hash: lh, p_weather_hash: wh,
    p_parent: latest.data?.[0]?.id ?? null, p_note: note,
  })
  if (error) fail('saving the model version', error)
  return { id: id as string, model_hash: mh, library_hash: lh, weather_hash: wh, created: true }
}

/** Records a run; a second call with the same four hashes returns the first run's id (record_run dedupes). */
export async function recordRun(sb: SupabaseClient, versionId: string, results: unknown, summary: RunSummary, engineVersion: string, source: string): Promise<string> {
  RunSummary.parse(summary)
  const { data, error } = await sb.rpc('record_run', {
    p_version: versionId, p_engine_version: engineVersion, p_results: results, p_summary: summary, p_source: source,
  })
  if (error) fail('recording the run', error)
  return data as string
}

const kwh = (mwh: unknown) => (typeof mwh === 'number' && Number.isFinite(mwh) ? Math.round(mwh * 1000 * 1000) / 1000 : 0)

/**
 * The instant engine's annual figures, copied (MWh → kWh, nothing recomputed). The EUI comes only from
 * readModelledEui. End uses are the engine's own per-service fuel figures; whatever the engine counts in its total
 * but does not itemise at the top level (auxiliary loads today) is its own line, so the lines always sum to the
 * total (rule 9).
 */
export function instantSummary(result: any): RunSummary {
  const eui = readModelledEui(result)
  if (eui == null) throw new Error('the engine returned no EUI (consumption.total.kwh_per_m2_yr)')
  const c = result.consumption
  const byFuel: Record<string, number> = { electricity: kwh(c.total?.electricity_mwh), gas: kwh(c.total?.gas_mwh) }
  if (kwh(c.total?.district_heat_mwh)) byFuel.district_heat = kwh(c.total.district_heat_mwh)
  const fans = (c.ventilation ?? []).reduce((s: number, v: any) => s + (v?.fan_electricity_mwh ?? 0), 0)
  const byEndUse: Record<string, number> = {
    heating: kwh((c.space_heating?.electricity_mwh ?? 0) + (c.space_heating?.gas_mwh ?? 0)),
    cooling: kwh(c.space_cooling?.electricity_mwh ?? 0),
    dhw: kwh((c.dhw?.electricity_mwh ?? 0) + (c.dhw?.gas_mwh ?? 0)),
    ventilation_fans: kwh(fans),
    lighting: kwh(c.lighting?.electricity_mwh),
    equipment: kwh(c.small_power?.electricity_mwh),
  }
  const total = Object.values(byFuel).reduce((a, b) => a + b, 0)
  const listed = Object.values(byEndUse).reduce((a, b) => a + b, 0)
  byEndUse.not_itemised = Math.round((total - listed) * 1000) / 1000
  return { eui_kwh_m2: eui, annual_by_end_use: byEndUse, annual_by_fuel: byFuel }
}
