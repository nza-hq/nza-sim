/**
 * Brief 105 Part 4: the run seam in a web worker (brief decision 5). The worker holds the parsed weather, so an edit
 * sends only the model document; it answers with the summary (or what is missing); the building's hourly heating and cooling only when the run asks.
 *
 * Messages in:  { type: 'weather', bytes, file_name, source } | { type: 'clear_weather' } | { type: 'run', id, doc, level?, fabric_heat_c?, what_if? }
 * Messages out: { type: 'weather', ok, file_name?, station?, error? } | { type: 'result', id, result, ms }
 */
/// <reference lib="webworker" />
import { explain, instantEstimate, levelDocument, simulate, type InstantResult, type Level, type Missing, type Summary, type WhatIf } from './seam'
import { ModelDocument } from '../../thermal/schema/model'
import { weatherFromBytes, type WeatherChoice } from './weather'

export type WorkerIn =
  | { type: 'weather'; bytes: Uint8Array; file_name: string; source: WeatherChoice['source'] }
  | { type: 'clear_weather' }
  | { type: 'run'; id: number; doc: unknown; level?: Level; fabric_heat_c?: number | null; what_if?: WhatIf | null; hourly?: boolean; series?: boolean }
  /** Brief 122: the monthly estimate (static), at the level shown. */
  | { type: 'instant'; id: number; doc: unknown; level: Level; fabric_heat_c: number | null }
export type WorkerOut =
  | { type: 'weather'; ok: true; file_name: string; station: string; sha256: string; source: WeatherChoice['source'] }
  | { type: 'weather'; ok: false; error: string }
  | { type: 'result'; id: number; ms: number; result: { ok: true; summary: Summary } | { ok: false; missing: Missing[] } | { ok: false; error: string } }
  | { type: 'instant'; id: number; ms: number; result: InstantResult | { ok: false; error: string } }

let weather: WeatherChoice | null = null
const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data
  if (m.type === 'weather') {
    try {
      weather = await weatherFromBytes(m.bytes, m.file_name, m.source)
      post({ type: 'weather', ok: true, file_name: weather.file_name, station: weather.station, sha256: weather.sha256, source: weather.source })
    } catch (e) {
      weather = null
      post({ type: 'weather', ok: false, error: (e as Error).message })
    }
  } else if (m.type === 'clear_weather') {
    weather = null
  } else if (m.type === 'run') {
    const t0 = performance.now()
    try {
      const r = simulate(m.doc, { weather, level: m.level, fabric_heat_c: m.fabric_heat_c, what_if: m.what_if ?? undefined, hourly: m.hourly ?? false, series: m.series ?? false })
      post({ type: 'result', id: m.id, ms: performance.now() - t0, result: r.ok ? { ok: true, summary: r.summary } : { ok: false, missing: r.missing } })
    } catch (e) {
      post({ type: 'result', id: m.id, ms: performance.now() - t0, result: { ok: false, error: (e as Error).message } })
    }
  } else if (m.type === 'instant') {
    const t0 = performance.now()
    try {
      // The editor writes the current version; anything else is said, as the hourly run says it.
      const parsed = ModelDocument.safeParse(m.doc)
      const result: InstantResult = !parsed.success
        ? { ok: false, missing: parsed.error.issues.slice(0, 12).map((i) => explain(i.path.join('.'), i.message, null)) }
        : m.level === 'fabric' && (m.fabric_heat_c == null || !Number.isFinite(m.fabric_heat_c))
          ? { ok: false, missing: [{ path: 'fabric_heat_c', what: 'Fabric only needs the temperature every room is heated to.' }] }
          : instantEstimate(levelDocument(parsed.data, m.level, m.level === 'fabric' ? m.fabric_heat_c : null), { weather })
      post({ type: 'instant', id: m.id, ms: performance.now() - t0, result })
    } catch (e) {
      post({ type: 'instant', id: m.id, ms: performance.now() - t0, result: { ok: false, error: (e as Error).message } })
    }
  }
}
