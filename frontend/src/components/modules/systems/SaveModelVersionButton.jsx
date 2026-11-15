/**
 * Brief 102 Part 5: "Save as model version" on the Systems page.
 *
 * Shown only when signed in to NZA Sim with an organisation (useAuth() is null when sign-in is not configured, so
 * today's tool renders nothing here). On click: converts the live inputs with fromBuildingConfig, stores the version
 * (or finds the identical one), and records the instant engine's result for it. The result is the one the Systems
 * page already computed, through calculateInstant's existing entry point and options; the EUI is read only through
 * readModelledEui. Viewers get the database's refusal as a message.
 *
 * Brief 102a: the weather is pinned by the sha256 of the EPW the result was computed from (the backend reports it with
 * the hourly arrays), and the run's engine version carries the engine's content hash (versions.ts).
 */
import { useContext, useState } from 'react'
import { ProjectContext } from '../../../context/ProjectContext.jsx'
import { WeatherContext } from '../../../context/WeatherContext.jsx'
import { useAuth } from '../../../auth/AuthGate.tsx'
import { fromBuildingConfig } from '../../../thermal/schema/fromBuildingConfig'
import {
  ensureLocalBuilding, INSTANT_ENGINE_VERSION, INSTANT_SOURCE, instantSummary, recordRun, saveModelVersion,
} from '../../../thermal/store/versions'

export default function SaveModelVersionButton({ result, libraryConstructions }) {
  const auth = useAuth()
  const { params, constructions, comfortBand, currentProjectId } = useContext(ProjectContext)
  // The weather the Systems page's result was computed from (Brief 102a: its own bytes are pinned, never its name).
  const { weatherData } = useContext(WeatherContext)
  const [state, setState] = useState({ busy: false, done: null, error: null })
  if (!auth) return null

  const ready = !!(result && params && libraryConstructions && weatherData && currentProjectId)
  const save = async () => {
    setState({ busy: true, done: null, error: null })
    try {
      if (!/^[0-9a-f]{64}$/.test(weatherData?.file_sha256 ?? '') || !weatherData?.file_name) {
        throw new Error('the weather data has no file hash: restart the backend so /api/weather/…/hourly reports it')
      }
      const sb = auth.supabase
      const name = (params.name ?? '').trim() || 'Untitled building'
      // Brief 103 P1 (QA M4): matched by the local project's id, so a rename keeps the history and two projects
      // with the same name stay apart.
      const buildingId = await ensureLocalBuilding(sb, auth.org.id, currentProjectId, name)
      const { document } = await fromBuildingConfig({
        building_config: params,
        construction_choices: constructions ?? {},
        comfort_band: comfortBand,
        library_constructions: libraryConstructions,
        building_id: buildingId,
        weather: { file_name: weatherData.file_name, file_hash: weatherData.file_sha256 },
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
