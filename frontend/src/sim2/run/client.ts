/**
 * Brief 105 Part 4: the editor's handle on the run worker. One worker per page; a run is debounced on edit and only
 * the latest one's answer is kept (an older run that finishes late is dropped).
 */
import type { WorkerIn, WorkerOut } from './worker'

export type RunAnswer = Extract<WorkerOut, { type: 'result' }>
export type WeatherAnswer = Extract<WorkerOut, { type: 'weather' }>

export class RunClient {
  private worker: Worker
  private seq = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Throws when the page cannot start a worker (a page opened from a file); `onFailed` hears a worker that stops. */
  constructor(private onResult: (a: RunAnswer) => void, private onWeather: (a: WeatherAnswer) => void, onFailed?: (message: string) => void) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onerror = (ev) => { ev.preventDefault(); onFailed?.(ev.message || 'the background worker stopped') }
    this.worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data
      if (m.type === 'result') { if (m.id === this.seq) this.onResult(m) } else this.onWeather(m)
    }
  }
  setWeather(bytes: Uint8Array, file_name: string, source: 'local' | 'organisation') {
    this.send({ type: 'weather', bytes, file_name, source })
  }
  clearWeather() { this.send({ type: 'clear_weather' }) }
  /** Runs `doc` after `delayMs` with no newer call; returns the run's number. */
  run(doc: unknown, delayMs = 250): number {
    const id = ++this.seq
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; this.send({ type: 'run', id, doc }) }, delayMs)
    return id
  }
  dispose() { if (this.timer) clearTimeout(this.timer); this.worker.terminate() }
  private send(m: WorkerIn) { this.worker.postMessage(m) }
}
