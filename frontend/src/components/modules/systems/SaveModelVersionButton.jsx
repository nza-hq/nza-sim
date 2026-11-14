/**
 * Brief 102 Part 5: "Save as model version" on the Systems page.
 *
 * Shown only when signed in to NZA Sim with an organisation (useAuth() is null when sign-in is not configured, so
 * today's tool renders nothing here). On click: converts the live inputs with fromBuildingConfig, stores the version
 * (or finds the identical one), and records the instant engine's result for it. The result is the one the Systems
 * page already computed, through calculateInstant's existing entry point and options; the EUI is read only through
 * readModelledEui. Viewers get the database's refusal as a message.
 */
import { useContext, useState } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { useAuth } from '../../../auth/AuthGate.tsx'
import { fromBuildingConfig } from '../../../thermal/schema/fromBuildingConfig'
import {
  ensureBuilding, ensureProject, INSTANT_ENGINE_VERSION, INSTANT_SOURCE, instantSummary, recordRun, saveModelVersion,
} from '../../../thermal/store/versions'

export default function SaveModelVersionButton({ result, libraryConstructions }) {
  const auth = useAuth()
  const { params, constructions, comfortBand } = useContext(ProjectContext)
  const [state, setState] = useState({ busy: false, done: null, error: null })
  if (!auth) return null

  const ready = !!(result && params && libraryConstructions)
  const save = async () => {
    setState({ busy: true, done: null, error: null })
    try {
      const sb = auth.supabase
      const name = (params.name ?? '').trim() || 'Untitled building'
      const projectId = await ensureProject(sb, auth.org.id, name)
      const buildingId = await ensureBuilding(sb, projectId, name)
      const { document } = await fromBuildingConfig({
        building_config: params,
        construction_choices: constructions ?? {},
        comfort_band: comfortBand,
        library_constructions: libraryConstructions,
        building_id: buildingId,
      })
      const version = await saveModelVersion(sb, buildingId, document, null)
      const summary = instantSummary(result)
      const runId = await recordRun(sb, version.id, {}, summary, INSTANT_ENGINE_VERSION, INSTANT_SOURCE)
      setState({ busy: false, error: null, done: { version, runId, eui: summary.eui_kwh_m2 } })
    } catch (e) {
      setState({ busy: false, done: null, error: e?.message ?? String(e) })
    }
  }

  return (
    <div className="mt-2 flex items-center gap-3 text-xxs">
      <button
        onClick={save}
        disabled={!ready || state.busy}
        className="px-2 py-1 rounded border border-light-grey bg-white text-navy hover:border-navy disabled:opacity-50"
      >
        {state.busy ? 'Saving…' : 'Save as model version'}
      </button>
      {state.done && (
        <span className="text-mid-grey" data-testid="model-version-saved">
          {state.done.version.created ? 'Saved' : 'Unchanged, already saved'} · version{' '}
          <span className="text-navy font-mono">{state.done.version.id.slice(0, 8)}</span> · hash{' '}
          <span className="text-navy font-mono" title={state.done.version.model_hash}>{state.done.version.model_hash.slice(0, 12)}</span> ·{' '}
          {state.done.eui.toFixed(1)} kWh/m²·yr recorded
        </span>
      )}
      {state.error && <span role="alert" className="text-coral">{state.error}</span>}
    </div>
  )
}
