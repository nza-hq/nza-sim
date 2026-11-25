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
// @ts-expect-error untyped JS component from today's app (17 Nov 2026: today's Systems Sankey, reused, not redrawn)
import { SystemSankeyChart } from '../../components/modules/systems/SystemSankey.jsx'
import { energyFlow, fuelSplit } from './energyFlow'
import { LoadProfiles } from './LoadProfiles'
import { Explore } from './Explore'
import { createPortal } from '../workspace/portal'
import { DesignHeatLoss } from './DesignHeatLoss'
import { EmitterSizing } from './EmitterSizing'
import { MonthlyDemand, MonthlyEstimate } from './MonthlyDemand'
import { balanceLines } from './balanceLines'
import { LevelSwitch, ResultsBody, ResultsStrip, WeatherPick, useRun } from './ResultsPanel'
import type { StepId } from '../workspace/steps'
import type { Level } from './seam'
import type { Summary } from './seam'
import './run.css'

/** Brief 111 P4: each step opens at its natural level; the person can change it at any time. */
/** Brief 122: the steps where each edit gives the monthly estimate (static) at once and the hourly year waits for Run. */
// 19 Nov 2026: Profiles, Check and Interventions show no results, so nothing runs the year there either (Profiles was
// slow to open because arriving on it started a full-year run).
const HELD: ReadonlySet<StepId> = new Set(['site', 'shape', 'fabric', 'profiles', 'check', 'interventions'])
/** The steps with the results bar (workspace/layout.ts STEP_TABS), and the ones whose level is fixed to the step's own. */
const STRIP: ReadonlySet<StepId> = new Set(['fabric', 'spaces', 'systems', 'controls', 'results'])
const NATURAL: Record<StepId, Level> = { site: 'fabric', shape: 'fabric', fabric: 'fabric', profiles: 'spaces', spaces: 'spaces', systems: 'systems', controls: 'systems', results: 'systems', check: 'systems', interventions: 'systems' }

export default function EmbeddedResults({ step, doc, previewDoc = null, onFigures, strip, centre, showBody, showMonthly = false, showProfiles = false, showExplore = false, focusZone, weatherEl, sizingEl = null, onOpen }: {
  /** The workspace step: sets the natural level when it changes. */
  step?: StepId
  doc: unknown
  /** The document with the previewed change made (preview, then apply); null when nothing is previewed. */
  previewDoc?: unknown
  /** Hears the run's summary now and the previewed one, for the apply card. */
  /** The run's figures and the previewed change's; `why` says why the preview has none (inputs unset, or it failed). */
  onFigures?: (now: Summary | null, preview: Summary | null, why?: string | null) => void
  strip: HTMLElement
  centre: HTMLElement
  showBody: boolean
  /** The Monthly centre tab: today's diverging monthly chart, fed by this run's months. */
  showMonthly?: boolean
  /** The Load profiles centre tab: the run's energy hour by hour, by end use and fuel (today's full-year chart). */
  showProfiles?: boolean
  /** Brief 127: the Explore centre tab: any hourly dataset the run holds, layered, in several views. */
  showExplore?: boolean
  focusZone: string | null
  weatherEl: HTMLElement | null
  /** Brief 118 P4: where a heating system's passport wants its design heat loss and emitter check. */
  sizingEl?: HTMLElement | null
  onOpen: () => void
}) {
  const run = useRun(doc, previewDoc, !!step && HELD.has(step))
  const est = run.instant.kind === 'done' ? run.instant.estimate : null
  const estZone = est && focusZone ? est.zones.find((z) => z.id === focusZone) ?? null : null
  const estLines = useMemo(() => (est ? (estZone ? balanceLines(estZone.breakdown, estZone.floor_m2) : balanceLines(est.breakdown, est.building.floor_m2)) : null), [est, estZone])
  const s = run.state.kind === 'done' ? run.state.summary : null
  const ps = run.previewState.kind === 'done' ? run.previewState.summary : null
  const pwhy = run.previewState.kind === 'missing' ? 'This change leaves inputs unset: no figures for it yet.' : run.previewState.kind === 'error' ? 'The preview could not run.' : null
  useEffect(() => { onFigures?.(s, ps, pwhy) }, [s, ps, pwhy])
  useEffect(() => { if (step) run.setLevel(NATURAL[step]) }, [step])
  // Brief 110b row 2: the Pop Out window shows this run.
  const latest = useRef<ModelShare | null>(null)
  latest.current = s ? { summary: { ...s, series: null }, level: run.level, fabric_heat_c: run.level === 'fabric' ? run.fabricC : null, weather: run.weather?.file_name ?? null } : null
  const channel = useRef<ReturnType<typeof shareModel> | null>(null)
  useEffect(() => { channel.current = shareModel(() => latest.current); return () => channel.current?.close() }, [])
  useEffect(() => { channel.current?.post() }, [s])
  // The chosen zone's balance (heat from other zones included), or the building's.
  const zone = s && focusZone ? s.zones.find((z) => z.id === focusZone) ?? null : null
  const lines = useMemo(() => (s ? (zone ? balanceLines(zone.breakdown, zone.floor_m2) : balanceLines(s.breakdown, s.building.floor_m2)) : null), [s, zone])
  // The building's energy, fuel to system to what it delivers (energy is building-wide, so not per zone).
  const flow = useMemo(() => (s?.energy?.ok ? { flow: energyFlow(s.energy), split: fuelSplit(s.energy) } : null), [s])
  return (
    <>
      {!!step && STRIP.has(step) && createPortal(<><ResultsStrip run={run} onOpen={onOpen} /><LevelSwitch run={run} /></>, strip)}
      {showBody && createPortal(
        <div className="rp-flow" role="tabpanel" aria-label="Heat flow">
          <div className="rp-flow-in">
            <h2>Heating and cooling demand{focusZone ? '' : ', whole building'}</h2>
            <WeatherPick run={run} />
            {run.hold && (
              <div className="rp-hb rp-est">
                <p className="rp-hb-for">{estZone ? `${estZone.name || estZone.id}` : 'Whole building'} · <b>Monthly estimate (static)</b>, as you edit</p>
                {estLines ? <HeatBalance lines={estLines} />
                  : <p className="gl-hint">{run.instant.kind === 'missing' ? `No estimate yet. To set: ${run.instant.items.map((m) => m.what).join(' ')}` : run.instant.kind === 'error' ? `The estimate failed: ${run.instant.message}` : 'No estimate yet: choose a weather file (Project).'}</p>}
                {est && est.notes.length > 0 && <ul className="rp-est-notes">{est.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
                <h3 className="rp-est-h">The full year, every 15 minutes{run.hourlyStale ? ' (out of date: press Run in the bar above)' : run.state.kind === 'idle' ? ' (press Run in the bar above)' : ''}</h3>
              </div>
            )}
            {lines && (
              <div className="rp-hb">
                <p className="rp-hb-for">{zone ? `${zone.name || zone.id}, heat from the other zones included` : 'Whole building'} <i>estimate</i></p>
                <HeatBalance lines={lines} />
                {s && s.method_notes.length > 0 && <ul className="rp-est-notes">{s.method_notes.map((n) => <li key={n}>{n}</li>)}</ul>}
              </div>
            )}
            {flow && !zone && (
              <div className="rp-hb rp-sankey">
                <SystemSankeyChart systemsFlow={flow.flow} fuelSplit={flow.split} title="Energy flow, whole building"
                  subtitle="Each fuel, the systems that use it and what they give · plant losses and heat from outside shown, so each box balances · hover for figures"
                  exportTitle="Energy flow" />
              </div>
            )}
            <ResultsBody run={run} focusZone={focusZone} />
          </div>
        </div>,
        centre,
      )}
      {showMonthly && createPortal(
        <div className="rp-flow" role="tabpanel" aria-label="Monthly">
          <div className={`rp-flow-in${!run.hold && run.busy ? ' rp-stale' : ''}`}>
            <h2>Monthly heating and cooling{zone ? `, ${zone.name || zone.id}` : ', whole building'}</h2>
            {run.hold && est ? <MonthlyEstimate estimate={est} zone={estZone} /> : s ? <MonthlyDemand summary={s} zone={zone} /> : <p className="gl-hint">{run.state.kind === 'missing' ? 'The months need a run: some inputs are still unset (see Heat flow).' : run.state.kind === 'running' ? 'Working it out…' : run.state.kind === 'error' ? 'The run stopped with an error (see Heat flow).' : 'The months need a run: choose a weather file on Project.'}</p>}
          </div>
        </div>,
        centre,
      )}
      {showProfiles && createPortal(
        <div className="rp-flow" role="tabpanel" aria-label="Load profiles">
          <div className={`rp-flow-in${!run.hold && run.busy ? ' rp-stale' : ''}`}>
            <h2>Load profiles, whole building</h2>
            {s?.energy?.ok ? <LoadProfiles energy={s.energy} />
              : <p className="gl-hint">{s && s.energy && !s.energy.ok ? 'Some system inputs are still unset, so there is no energy to show yet. Heat flow lists them.'
                : s ? 'This is energy, so it shows on Systems and Controls.'
                : run.state.kind === 'running' ? 'Working out the year…'
                : run.state.kind === 'missing' ? 'Some inputs are still unset, so the year cannot run yet. Heat flow lists them.'
                : run.state.kind === 'error' ? 'The run stopped with an error (see Heat flow).'
                : 'Choose a weather file on Project, and the year runs.'}</p>}
          </div>
        </div>,
        centre,
      )}
      {showExplore && createPortal(
        <div className="rp-flow" role="tabpanel" aria-label="Explore">
          <div className={`rp-flow-in ex-wide${!run.hold && run.busy ? ' rp-stale' : ''}`}>
            <h2>Explore the results</h2>
            {s?.series ? <Explore set={s.series} focusZone={focusZone} />
              : <p className="gl-hint">{run.state.kind === 'missing' ? 'Exploring needs a run: some inputs are still unset (see Heat flow).' : run.state.kind === 'running' ? 'Working it out…' : run.state.kind === 'error' ? 'The run stopped with an error (see Heat flow).' : 'Exploring needs a full-year run: press Run in the bar above.'}</p>}
          </div>
        </div>,
        centre,
      )}
      {weatherEl && createPortal(<WeatherPick run={run} />, weatherEl)}
      {sizingEl && createPortal(!s ? <p className="gl-hint">{run.state.kind === 'missing' ? 'The emitter check needs a run: some inputs are still unset (see Heat flow).' : run.state.kind === 'running' ? 'Working it out…' : run.state.kind === 'error' ? 'The run stopped with an error (see Heat flow).' : 'The emitter check needs a run: choose a weather file on Project.'}</p> : !s.emitters && !s.design_heat_loss ? <p className="gl-hint">Give the rooms emitters (with their rated output) to see whether they meet each room's need.</p> : <><DesignHeatLoss summary={s} /><EmitterSizing summary={s} whatIf={run.whatIf} onWhatIf={run.setWhatIf} /></>, sizingEl)}
    </>
  )
}
