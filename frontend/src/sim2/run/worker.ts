/**
 * Brief 105 Part 4: the run seam in a web worker (brief decision 5). The worker holds the parsed weather, so an edit
 * sends only the model document; it answers with the summary (or what is missing), never the hourly arrays.
 *
 * Messages in:  { type: 'weather', bytes, file_name, source } | { type: 'clear_weather' } | { type: 'run', id, doc, level?, fabric_heat_c?, what_if? }
 * Messages out: { type: 'weather', ok, file_name?, station?, error? } | { type: 'result', id, result, ms }
 */
/// <reference lib="webworker" />
import { simulate, type Level, type Missing, type Summary, type WhatIf } from './seam'
import { weatherFromBytes, type WeatherChoice } from './weather'

export type WorkerIn =
  | { type: 'weather'; bytes: Uint8Array; file_name: string; source: WeatherChoice['source'] }
  | { type: 'clear_weather' }
  | { type: 'run'; id: number; doc: unknown; level?: Level; fabric_heat_c?: number | null; what_if?: WhatIf | null }
export type WorkerOut =
  | { type: 'weather'; ok: true; file_name: string; station: string; sha256: string; source: WeatherChoice['source'] }
  | { type: 'weather'; ok: false; error: string }
  | { type: 'result'; id: number; ms: number; result: { ok: true; summary: Summary } | { ok: false; missing: Missing[] } | { ok: false; error: string } }

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
      const r = simulate(m.doc, { weather, level: m.level, fabric_heat_c: m.fabric_heat_c, what_if: m.what_if ?? undefined })
      post({ type: 'result', id: m.id, ms: performance.now() - t0, result: r.ok ? { ok: true, summary: r.summary } : { ok: false, missing: r.missing } })
    } catch (e) {
      post({ type: 'result', id: m.id, ms: performance.now() - t0, result: { ok: false, error: (e as Error).message } })
    }
  }
}
