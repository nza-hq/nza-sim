/**
 * "Open an example" (17 Nov 2026, Linzie 21:28: "an example building that I can just open"): loads one of the worked
 * examples in docs/examples into the editor, as if drawn. Each is example input chosen for the demonstration, not a
 * real building, and says so. It replaces what is on screen, so it asks first when something is drawn.
 */
import { useState } from 'react'
import type { EditorApi } from './ModelSave'

const EXAMPLES = [
  { id: 'school', name: 'Extended primary school (L-shaped, 1965 wing + 2012 extension)', load: () => import('../../../../docs/examples/extended_school.plan.json') },
  { id: 'community', name: 'Community centre (one block, eight rooms)', load: () => import('../../../../docs/examples/community_centre.plan.json') },
] as const

const drawn = (plan: unknown) => ((plan as { blocks?: unknown[] } | null)?.blocks?.length ?? 0) > 0

export default function ModelExamples({ api, plan }: { api: React.RefObject<EditorApi | null>; plan: unknown }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const open = async (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id)
    if (!ex || !api.current) return
    if (drawn(plan) && !window.confirm(`Open the example "${ex.name}"? It replaces the building on screen (save it first if you want to keep it).`)) return
    setBusy(true); setError(null)
    try {
      const m = (await ex.load()) as { default?: { plan: unknown }; plan?: unknown }
      const file = (m.default ?? m) as { plan: unknown }
      api.current.loadPlan(JSON.parse(JSON.stringify(file.plan)))
    } catch (e) { setError(`The example could not be opened: ${(e as Error).message}`) }
    setBusy(false)
  }
  return (
    <div className="mw-examples">
      <label>
        <span>Open an example</span>
        <select value="" disabled={busy} onChange={(e) => { void open(e.target.value) }} aria-label="Open an example building">
          <option value="">{busy ? 'Opening…' : 'Choose…'}</option>
          {EXAMPLES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
      {error && <p className="mw-save-err" role="alert">{error}</p>}
    </div>
  )
}
