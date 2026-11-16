/**
 * Results in the Model workspace (Brief 110 P3): one run of the editor's document, shown in three places.
 *
 *   strip      always visible above the centre tabs (heating, cooling, energy used, or what the run waits for)
 *   Heat flow  the centre tab: totals, energy used, by zone and the building's balance (every term, Rule 9),
 *              opened at the zone the person has chosen on the left
 *   Site       the weather file the run uses, chosen on step 1
 *
 * Numbers come only from the run (CLAUDE.md rules 2 and 3).
 */
import { useEffect, useMemo, useRef } from 'react'
import { shareModel, type ModelShare } from './modelChannel'
// @ts-expect-error untyped JS component from today's app (Brief 110b: reused, not redrawn)
import HeatBalance from '../../components/modules/balance/HeatBalance.jsx'
import { createPortal } from '../workspace/portal'
import { balanceLines } from './balanceLines'
import { LevelSwitch, ResultsBody, ResultsStrip, WeatherPick, useRun } from './ResultsPanel'
import type { StepId } from '../workspace/steps'
import type { Level } from './seam'
import type { Summary } from './seam'
import './run.css'

/** Brief 111 P4: each step opens at its natural level; the person can change it at any time. */
const NATURAL: Record<StepId, Level> = { site: 'fabric', shape: 'fabric', fabric: 'fabric', profiles: 'spaces', spaces: 'spaces', systems: 'systems', check: 'systems', interventions: 'systems' }

export default function EmbeddedResults({ step, doc, previewDoc = null, onFigures, strip, centre, showBody, focusZone, weatherEl, onOpen }: {
  /** The workspace step: sets the natural level when it changes. */
  step?: StepId
  doc: unknown
  /** The document with the previewed change made (preview, then apply); null when nothing is previewed. */
  previewDoc?: unknown
  /** Hears the run's summary now and the previewed one, for the apply card. */
  onFigures?: (now: Summary | null, preview: Summary | null) => void
  strip: HTMLElement
  centre: HTMLElement
  showBody: boolean
  focusZone: string | null
  weatherEl: HTMLElement | null
  onOpen: () => void
}) {
  const run = useRun(doc, previewDoc)
  const s = run.state.kind === 'done' ? run.state.summary : null
  const ps = run.previewState.kind === 'done' ? run.previewState.summary : null
  useEffect(() => { onFigures?.(s, ps) }, [s, ps])
  useEffect(() => { if (step) run.setLevel(NATURAL[step]) }, [step])
  // Brief 110b row 2: the Pop Out window shows this run.
  const latest = useRef<ModelShare | null>(null)
  latest.current = s ? { summary: s, level: run.level, fabric_heat_c: run.level === 'fabric' ? run.fabricC : null, weather: run.weather?.file_name ?? null } : null
  const channel = useRef<ReturnType<typeof shareModel> | null>(null)
  useEffect(() => { channel.current = shareModel(() => latest.current); return () => channel.current?.close() }, [])
  useEffect(() => { channel.current?.post() }, [s])
  // The chosen zone's balance (heat from other zones included), or the building's.
  const zone = s && focusZone ? s.zones.find((z) => z.id === focusZone) ?? null : null
  const lines = useMemo(() => (s ? (zone ? balanceLines(zone.breakdown, zone.floor_m2) : balanceLines(s.breakdown, s.building.floor_m2)) : null), [s, zone])
  return (
    <>
      {createPortal(<><LevelSwitch run={run} /><ResultsStrip run={run} onOpen={onOpen} /></>, strip)}
      {showBody && createPortal(
        <div className="rp-flow" role="tabpanel" aria-label="Heat flow">
          <div className="rp-flow-in">
            <h2>Heating and cooling demand{focusZone ? '' : ', whole building'}</h2>
            <WeatherPick run={run} />
            {lines && (
              <div className="rp-hb">
                <p className="rp-hb-for">{zone ? `${zone.name || zone.id}, heat from the other zones included` : 'Whole building'} <i>estimate</i></p>
                <HeatBalance lines={lines} />
              </div>
            )}
            <ResultsBody run={run} focusZone={focusZone} />
          </div>
        </div>,
        centre,
      )}
      {weatherEl && createPortal(<WeatherPick run={run} />, weatherEl)}
    </>
  )
}
