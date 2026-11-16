/**
 * Brief 110b row 2: the Model workspace's results, shared with the Pop Out window on a second screen.
 *
 * The workspace posts each finished run's summary; the pop-out asks for the latest when it opens. Its own channel
 * name, so today's pop-out (`utils/broadcastChannel.js`, which re-runs today's engine) is untouched. Nothing is
 * worked out in the pop-out: it shows the run it is sent (CLAUDE.md rule 7).
 */
import type { Level, Summary } from './seam'

export type ModelShare = { summary: Summary; level: Level; fabric_heat_c: number | null; weather: string | null }
type Msg = { type: 'model'; share: ModelShare } | { type: 'ask' }

const NAME = 'nza-sim-model-results'
const open = () => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NAME))

/** The workspace's side: post `latest()` now and whenever the pop-out asks. Returns a function that posts again. */
export function shareModel(latest: () => ModelShare | null): { post: () => void; close: () => void } {
  const ch = open()
  const post = () => { const s = latest(); if (s && ch) ch.postMessage({ type: 'model', share: s } satisfies Msg) }
  if (ch) ch.onmessage = (ev: MessageEvent<Msg>) => { if (ev.data?.type === 'ask') post() }
  return { post, close: () => ch?.close() }
}

/** The pop-out's side: hear each run, and ask for the latest on opening. */
export function hearModel(on: (s: ModelShare) => void): () => void {
  const ch = open()
  if (!ch) return () => {}
  ch.onmessage = (ev: MessageEvent<Msg>) => { if (ev.data?.type === 'model') on(ev.data.share) }
  ch.postMessage({ type: 'ask' } satisfies Msg)
  return () => ch.close()
}
