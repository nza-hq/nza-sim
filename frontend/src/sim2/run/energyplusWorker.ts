/**
 * Brief 123: "Run in EnergyPlus" in its own worker, so the editor never waits for it. It runs the hourly year on the
 * document (the input is built from that run, and its column is shown beside EnergyPlus's), builds the EnergyPlus
 * input, sends it to the runner, and reads the answer back.
 *
 * In:  { type: 'run', id, doc, level, fabric_heat_c, weather: { bytes, file_name, source } }
 * Out: { type: 'progress', id, stage, elapsed_s } | { type: 'done', id, ours, ep } | { type: 'missing', id, missing } | { type: 'error', id, message }
 */
/// <reference lib="webworker" />
import { simulate, type Level, type Missing, type Summary } from './seam'
import { weatherFromBytes, type WeatherChoice } from './weather'
import { energyPlusInput, energyPlusSummary, runInEnergyPlus, type EnergyPlusSummary } from './energyplus'

export type EpWorkerIn = { type: 'run'; id: number; doc: unknown; level: Level; fabric_heat_c: number | null; weather: { bytes: Uint8Array; file_name: string; source: WeatherChoice['source'] } }
export type EpWorkerOut =
  | { type: 'progress'; id: number; stage: 'preparing' | 'running'; elapsed_s: number }
  | { type: 'done'; id: number; ours: Summary; ep: EnergyPlusSummary }
  | { type: 'missing'; id: number; missing: Missing[] }
  | { type: 'error'; id: number; message: string }

const post = (m: EpWorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m)

self.onmessage = async (ev: MessageEvent<EpWorkerIn>) => {
  const m = ev.data
  if (m.type !== 'run') return
  const id = m.id
  try {
    post({ type: 'progress', id, stage: 'preparing', elapsed_s: 0 })
    const weather = await weatherFromBytes(m.weather.bytes, m.weather.file_name, m.weather.source)
    const ours = simulate(m.doc, { weather, level: m.level, fabric_heat_c: m.fabric_heat_c })
    if (!ours.ok) { post({ type: 'missing', id, missing: ours.missing }); return }
    const prep = energyPlusInput(m.doc, ours.results, { weather, level: m.level, fabric_heat_c: m.fabric_heat_c })
    if (!prep.ok) { post({ type: 'missing', id, missing: prep.missing }); return }
    const epw = new TextDecoder('latin1').decode(m.weather.bytes)
    const out = await runInEnergyPlus(prep.input, epw, { onProgress: (p) => post({ type: 'progress', id, stage: 'running', elapsed_s: p.elapsed_s }) })
    post({ type: 'done', id, ours: ours.summary, ep: energyPlusSummary(prep.doc, ours.results, prep.input, out, weather, m.level) })
  } catch (e) {
    post({ type: 'error', id, message: (e as Error).message })
  }
}
