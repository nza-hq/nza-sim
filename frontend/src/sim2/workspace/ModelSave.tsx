/**
 * Save and reopen the drawn model (Brief 110 P4). A save is a model version of the project's drawn-model building
 * (0008_editor_plan.sql: the document, and the Plan beside it with its own hash; the model hash is the document's).
 * Opening the workspace loads that building's newest version with a Plan. The bar says whether what is on screen is
 * saved or changed since.
 *
 * Only when signed in to NZA Sim with an organisation (useAuth() is null when sign-in is not set up: then the bar
 * says saving is not available here, and the workspace still works).
 */
import { useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthGate'
// @ts-expect-error plain JS context
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { canonicalJSON } from '../../thermal/schema/canonical'
import type { ModelDocument } from '../../thermal/schema/model'
import { ensureModelBuilding, loadLatestVersion, saveModelVersion } from '../../thermal/store/versions'

export type EditorApi = { getPlan: () => unknown; getDocument: () => unknown; loadPlan: (p: unknown) => void }

const textOf = (plan: unknown) => canonicalJSON(JSON.parse(JSON.stringify(plan)))
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function ModelSave({ api, plan }: { api: React.RefObject<EditorApi | null>; plan: unknown }) {
  const auth = useAuth()
  const { currentProjectId, params } = useContext(ProjectContext) as { currentProjectId: string | null; params: { name?: string } | null }
  const [saved, setSaved] = useState<{ text: string; id: string; at: string; created: boolean } | null>(null)
  const [busy, setBusy] = useState<'loading' | 'saving' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadedFor = useRef<string | null>(null)

  // Open the newest saved version for this project, once per project.
  useEffect(() => {
    if (!auth || !currentProjectId || loadedFor.current === `${auth.org.id}/${currentProjectId}`) return
    loadedFor.current = `${auth.org.id}/${currentProjectId}`
    setBusy('loading'); setError(null)
    ;(async () => {
      const b = await auth.supabase.from('buildings').select('id').eq('local_ref', `${currentProjectId}:model`).limit(1)
      if (b.error) throw new Error(b.error.message)
      const id = b.data?.[0]?.id as string | undefined
      if (!id) return
      const v = await loadLatestVersion(auth.supabase, id)
      if (!v) return
      api.current?.loadPlan(v.plan)
      setSaved({ text: textOf(v.plan), id: v.id, at: v.created_at, created: false })
    })().catch((e) => setError(`Could not open the saved model: ${(e as Error).message}`)).finally(() => setBusy(null))
  }, [auth?.org.id, currentProjectId])

  if (!auth) return <LocalSave api={api} plan={plan} projectId={currentProjectId} />
  if (!currentProjectId) return <div className="mw-save"><span className="mw-save-state" title="Open or make a project on Projects to save this model">Not saved: no project open</span></div>

  const now = plan == null ? null : textOf(plan)
  const changed = !saved || now !== saved.text
  const canEdit = auth.org.role === 'admin' || auth.org.role === 'editor'

  const save = async () => {
    const ed = api.current
    if (!ed) return
    setBusy('saving'); setError(null)
    try {
      const name = (params?.name ?? '').trim() || 'Untitled building'
      const buildingId = await ensureModelBuilding(auth.supabase, auth.org.id, currentProjectId, name)
      const p = ed.getPlan()
      // The document names the building it belongs to (create_model_version checks it).
      const doc = JSON.parse(JSON.stringify(ed.getDocument())) as ModelDocument
      ;(doc as { building: { id: string } }).building.id = buildingId
      const v = await saveModelVersion(auth.supabase, buildingId, doc, null, p)
      setSaved({ text: textOf(p), id: v.id, at: new Date().toISOString(), created: v.created })
    } catch (e) { setError(`Not saved: ${(e as Error).message}`) }
    setBusy(null)
  }

  return (
    <div className="mw-save">
      <span className={`mw-save-state${changed ? ' changed' : ''}`} role="status">
        {busy === 'loading' ? 'Opening the saved model…'
          : busy === 'saving' ? 'Saving…'
          : !saved ? 'Not saved yet'
          : changed ? 'Changed since saved'
          : `Saved ${when(saved.at)} · version ${saved.id.slice(0, 8)}`}
      </span>
      {canEdit && <button type="button" className="mw-save-btn" onClick={save} disabled={!!busy || !changed}>Save</button>}
      {!canEdit && <span className="mw-save-state">View only</span>}
      {error && <p className="mw-save-err" role="alert">{error}</p>}
    </div>
  )
}

/**
 * 19 Nov 2026 (Linzie: the clubhouse should be a real, saved project): without NZA Sim sign-in the model is saved on
 * this computer with its project (PUT /api/projects/{id}/model, one saved model per project, replaced on each save),
 * and opening the project opens it again.
 */
export function LocalSave({ api, plan, projectId }: { api: React.RefObject<EditorApi | null>; plan: unknown; projectId: string | null }) {
  const [saved, setSaved] = useState<{ text: string; at: string } | null>(null)
  const [busy, setBusy] = useState<'loading' | 'saving' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!projectId || loadedFor.current === projectId) return
    loadedFor.current = projectId
    setSaved(null); setBusy('loading'); setError(null)
    loadLocalPlan(projectId)
      .then((v) => { if (v && loadedFor.current === projectId) { api.current?.loadPlan(v.plan); setSaved({ text: textOf(v.plan), at: v.saved_at }) } })
      .catch((e) => setError(`Could not open the saved model: ${(e as Error).message}`))
      .finally(() => setBusy(null))
  }, [projectId])
  if (!projectId) return <div className="mw-save"><span className="mw-save-state" title="Open or make a project on Projects to save this model">Not saved: no project open</span></div>
  const now = plan == null ? null : textOf(plan)
  const changed = !saved || now !== saved.text
  const save = async () => {
    const p = api.current?.getPlan()
    if (!p) return
    setBusy('saving'); setError(null)
    try {
      const r = await fetch(`/api/projects/${projectId}/model`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: p }) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { saved_at: string }
      setSaved({ text: textOf(p), at: j.saved_at })
    } catch (e) { setError(`Not saved: ${(e as Error).message}`) }
    setBusy(null)
  }
  return (
    <div className="mw-save">
      <span className={`mw-save-state${changed ? ' changed' : ''}`} role="status">
        {busy === 'loading' ? 'Opening the saved model…' : busy === 'saving' ? 'Saving…' : !saved ? 'Not saved yet' : changed ? 'Changed since saved' : `Saved ${when(saved.at.replace(' ', 'T') + 'Z')}`}
      </span>
      <button type="button" className="mw-save-btn" onClick={save} disabled={!!busy || !changed || plan == null}>Save</button>
      {error && <p className="mw-save-err" role="alert">{error}</p>}
    </div>
  )
}

/** The model saved on this computer for a project, or null. */
export async function loadLocalPlan(projectId: string): Promise<{ plan: unknown; saved_at: string } | null> {
  const r = await fetch(`/api/projects/${projectId}/model`)
  if (!r.ok) return null
  const j = (await r.json()) as { plan: unknown; saved_at: string | null }
  return j.plan ? { plan: j.plan, saved_at: j.saved_at ?? '' } : null
}
