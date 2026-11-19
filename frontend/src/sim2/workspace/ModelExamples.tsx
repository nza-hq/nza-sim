/**
 * "Open an example" (17 Nov 2026, Linzie 21:28: "an example building that I can just open"): loads one of the worked
 * examples in docs/examples into the editor, as if drawn. The school and the community centre are example input chosen
 * for the demonstration, not real buildings, and say so; the RWGC clubhouse (18 Nov 2026) is a real building, its
 * assumptions listed beside it. It replaces what is on screen, so it asks first when something is drawn.
 */
import { useContext, useState } from 'react'
// @ts-expect-error plain JS context
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { loadLocalPlan, type EditorApi } from './ModelSave'
import { useAuth } from '../../auth/AuthGate'

type Projects = { projects: Array<{ id: string; name: string }>; currentProjectId: string | null; createProject: (n: string) => Promise<{ id: string }>; loadProject: (id: string) => Promise<void> } | null

const EXAMPLES = [
  { id: 'school', project: 'Example: extended primary school', name: 'Extended primary school (L-shaped, 1965 wing + 2012 extension)', load: () => import('../../../../docs/examples/extended_school.plan.json') },
  { id: 'community', project: 'Example: community centre', name: 'Community centre (one block, eight rooms)', load: () => import('../../../../docs/examples/community_centre.plan.json') },
  // 18 Nov 2026: a real building (Linzie), three floors from the measured survey; its assumptions are listed beside it.
  // A real building, so its project carries its own name rather than "Example:" (Linzie, 19 Nov: a real, saved project).
  { id: 'rwgc', project: 'Royal Wimbledon Golf Club clubhouse', name: 'Royal Wimbledon Golf Club clubhouse (three floors, real building)', load: () => import('../../../../docs/examples/rwgc_clubhouse.plan.json') },
] as const

const drawn = (plan: unknown) => ((plan as { blocks?: unknown[] } | null)?.blocks?.length ?? 0) > 0

export default function ModelExamples({ api, plan }: { api: React.RefObject<EditorApi | null>; plan: unknown }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ctx = useContext(ProjectContext) as Projects
  const auth = useAuth()
  const open = async (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id)
    if (!ex || !api.current) return
    if (drawn(plan) && !window.confirm(ctx?.createProject
      ? `Open "${ex.project}" in its own project?\n\nWhat is on screen now stays in its project only if it was saved.`
      : `Open the example "${ex.name}"? It replaces the building on screen.`)) return
    setBusy(true); setError(null)
    try {
      // 19 Nov 2026: an example opens in a project of its own ("Example: …", made the first time), so it never lands
      // in, or is saved over, the project that was open (it used to open inside whichever project was loaded, often
      // the test project). Without the project list (no backend), it opens on screen as before.
      if (ctx?.createProject) {
        const have = ctx.projects.find((p) => p.name === ex.project)
        if (have && have.id !== ctx.currentProjectId) await ctx.loadProject(have.id)
        else if (!have) await ctx.createProject(ex.project)
        // Its project already has a saved model (saved on this computer): that opens, not the example as first built.
        if (have && !auth) {
          const saved = await loadLocalPlan(have.id).catch(() => null)
          if (saved) { api.current.loadPlan(saved.plan); setBusy(false); return }
        }
      }
      const m = (await ex.load()) as { default?: { plan: unknown }; plan?: unknown }
      const file = (m.default ?? m) as { plan: unknown }
      api.current.loadPlan(JSON.parse(JSON.stringify(file.plan)))
    } catch (e) { setError(`The example could not be opened: ${(e as Error).message}`) }
    setBusy(false)
  }
  return (
    <div className="mw-examples">
      {/* Phase 1 (Linzie, 19 Nov 2026): the one way to open an example, a small menu beside Save. */}
      <select value="" disabled={busy} onChange={(e) => { void open(e.target.value) }} aria-label="Open an example building" title="Open an example building in its own project">
        <option value="">{busy ? 'Opening…' : 'Examples'}</option>
        {EXAMPLES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      {error && <p className="mw-save-err" role="alert">{error}</p>}
    </div>
  )
}
