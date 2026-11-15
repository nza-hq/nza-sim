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

/**
 * The building for a local project, found by the local project's id (its uuid in the local SQLite store), never by
 * its name (Brief 103 P1, QA M4). One database call, race-safe (unique (org_id, local_ref) and (project_id, local_ref)).
 * The project and building take the local name and follow a rename. A project saved before 0005 with the same name
 * and no local id is adopted once, so its history continues.
 */
export async function ensureLocalBuilding(sb: SupabaseClient, orgId: string, localRef: string, name: string): Promise<string> {
  if (!localRef || typeof localRef !== 'string') throw new Error('no local project id: open a saved project first')
  const { data, error } = await sb.rpc('ensure_local_building', { p_org: orgId, p_local_ref: localRef, p_name: name })
  if (error) fail('finding the building for this project', error)
  return data as string
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

/** Records a run of this version; a second call with the same engine, library and weather returns the first run's id (record_run dedupes within the version, Brief 102a). */
export async function recordRun(sb: SupabaseClient, versionId: string, results: unknown, summary: RunSummary, engineVersion: string, source: string): Promise<string> {
  RunSummary.parse(summary)
  const { data, error } = await sb.rpc('record_run', {
    p_version: versionId, p_engine_version: engineVersion, p_results: results, p_summary: summary, p_source: source,
  })
  if (error) fail('recording the run', error)
  return data as string
}

/** MWh → kWh to the Wh. A figure the engine must give and did not, or gave as a non-number, fails loudly (QA M7). */
function kwh(mwh: unknown, path: string): number {
  if (typeof mwh !== 'number' || !Number.isFinite(mwh)) throw new Error(`the engine result has no number at ${path} (got ${String(mwh)})`)
  return Math.round(mwh * 1000 * 1000) / 1000
}

/**
 * The instant engine's annual figures, copied (MWh → kWh, nothing recomputed). The EUI comes only from
 * readModelledEui. End uses are the engine's own per-service fuel figures, plus auxiliary from the engine's own
 * figure (heat_balance.annual.gains.internal.auxiliary.electricity_kwh, QA M7). District heat counts as heating.
 * Anything the engine totals but no line names stays visible as `not_itemised`, so the lines always sum to the
 * total (rule 9); on today's engine it is zero to rounding.
 */
export function instantSummary(result: any): RunSummary {
  const eui = readModelledEui(result)
  if (eui == null) throw new Error('the engine returned no EUI (consumption.total.kwh_per_m2_yr)')
  const c = result?.consumption
  if (!c) throw new Error('the engine result has no consumption block')
  const district = kwh(c.total?.district_heat_mwh, 'consumption.total.district_heat_mwh')
  const byFuel: Record<string, number> = {
    electricity: kwh(c.total?.electricity_mwh, 'consumption.total.electricity_mwh'),
    gas: kwh(c.total?.gas_mwh, 'consumption.total.gas_mwh'),
  }
  if (district) byFuel.district_heat = district
  if (!Array.isArray(c.ventilation)) throw new Error('the engine result has no number at consumption.ventilation (got not a list)')
  const fans = c.ventilation.reduce((s: number, v: any, i: number) => s + kwh(v?.fan_electricity_mwh, `consumption.ventilation[${i}].fan_electricity_mwh`), 0)
  const auxKwh = result?.heat_balance?.annual?.gains?.internal?.auxiliary?.electricity_kwh
  const auxiliary = kwh(typeof auxKwh === 'number' ? auxKwh / 1000 : auxKwh, 'heat_balance.annual.gains.internal.auxiliary.electricity_kwh')
  const byEndUse: Record<string, number> = {
    heating: kwh(c.space_heating?.electricity_mwh, 'consumption.space_heating.electricity_mwh')
      + kwh(c.space_heating?.gas_mwh, 'consumption.space_heating.gas_mwh') + district,
    cooling: kwh(c.space_cooling?.electricity_mwh, 'consumption.space_cooling.electricity_mwh'),
    dhw: kwh(c.dhw?.electricity_mwh, 'consumption.dhw.electricity_mwh') + kwh(c.dhw?.gas_mwh, 'consumption.dhw.gas_mwh'),
    ventilation_fans: Math.round(fans * 1000) / 1000,
    lighting: kwh(c.lighting?.electricity_mwh, 'consumption.lighting.electricity_mwh'),
    equipment: kwh(c.small_power?.electricity_mwh, 'consumption.small_power.electricity_mwh'),
    auxiliary,
  }
  for (const k of Object.keys(byEndUse)) byEndUse[k] = Math.round(byEndUse[k] * 1000) / 1000
  const total = Object.values(byFuel).reduce((a, b) => a + b, 0)
  const listed = Object.values(byEndUse).reduce((a, b) => a + b, 0)
  byEndUse.not_itemised = Math.round((total - listed) * 1000) / 1000
  return { eui_kwh_m2: eui, annual_by_end_use: byEndUse, annual_by_fuel: byFuel }
}
