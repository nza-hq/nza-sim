/**
 * The Model workspace (Brief 110): Simulate v2's steps inside NZA Sim, laid out the way today's Building page is.
 *
 *   top     the steps as tabs across the top, in build order, with the shelf at the right end (Linzie, 16 Nov 00:22:
 *           "happy for the modules to be across the top if that frees up our space on the left")
 *   left    what you are choosing (whole building, zones, rooms)
 *   centre  what you see: the results strip, then the centre tabs (Drawing, Heat flow). The main window.
 *   right   what you give: kinds, the project's types, the detail, Apply
 *
 * Panes resize with today's handle and are remembered (layout.ts). The step is in the address (?step=fabric), so a
 * link opens the right step. The steps render into the three panes through slots and stay mounted on every step, so
 * nothing drawn is lost by visiting steps 6 and 7. This file draws no numbers.
 */
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ResizeHandle from './ResizeHandle'
import { LEFT, MODEL_CENTRE_TABS, RIGHT, clamp, loadLayout, saveLayout, type CentreTab, type Layout } from './layout'
import { SHELF, STEPS, isStep, type StepId } from './steps'
// @ts-expect-error untyped JS from today's app
import { MODULE_THEMES } from '../../data/moduleThemes.js'
import './workspace.css'

/** Brief 110b row 1: each step wears the accent of today's module it stands for. */
const ACCENT: Record<StepId, string> = {
  site: MODULE_THEMES.weather.accent, shape: MODULE_THEMES.building.accent, fabric: MODULE_THEMES.building.accent,
  profiles: MODULE_THEMES.profiles.accent, spaces: MODULE_THEMES.gains.accent, systems: MODULE_THEMES.systems.accent, controls: MODULE_THEMES.systems.accent, check: MODULE_THEMES.consumption.accent,
  interventions: MODULE_THEMES.interventions.accent,
}

export type Slots = { left: HTMLElement; centre: HTMLElement; right: HTMLElement; strip: HTMLElement }

/** Steps 6 and 7 come later: say what they will hold and where today's tool does it. No numbers (CLAUDE.md rule 2). */
const LATER: Partial<Record<StepId, { title: string; text: string; to: string; page: string }>> = {
  check: { title: 'Check against the meters', text: "Compare this model's hourly use with the building's meter data and record any calibration. It comes in a later brief.", to: '/consumption', page: 'Consumption' },
  interventions: { title: 'Interventions', text: 'Stack changes to the model and see what each one saves, in order. It comes in a later brief.', to: '/interventions', page: 'Interventions' },
}

export function StepRail({ step, onStep }: { step: StepId; onStep: (s: StepId) => void }) {
  return (
    <nav className="mw-rail" aria-label="Model steps">
      <ol>
        {STEPS.map((s) => (
          <li key={s.id}>
            <button type="button" aria-current={s.id === step ? 'step' : undefined} onClick={() => onStep(s.id)} title={s.line} style={{ '--acc': ACCENT[s.id] } as React.CSSProperties}>
              <span className="mw-n">{s.n}</span>
              <span className="mw-name">{s.name}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="mw-shelf" aria-label="Shelf">
        {SHELF.map((x) => <Link key={x.to} to={x.to} title={x.line}>{x.name}</Link>)}
      </div>
    </nav>
  )
}

export default function ModelWorkspace({ render, header }: { header?: React.ReactNode; render?: (a: { step: StepId; slots: Slots; centre: CentreTab; setCentre: (c: CentreTab) => void }) => React.ReactNode }) {
  const [params, setParams] = useSearchParams()
  const q = params.get('step')
  const step: StepId = isStep(q) ? q : 'shape'
  const onStep = (s: StepId) => setParams((p) => { p.set('step', s); return p }, { replace: true })

  const [layout, setLayout] = useState<Layout>(loadLayout)
  useEffect(() => saveLayout(layout), [layout])
  const setLeft = (dx: number) => setLayout((l) => ({ ...l, left: clamp(l.left + dx, LEFT.min, LEFT.max) }))
  const setRight = (dx: number) => setLayout((l) => ({ ...l, right: clamp(l.right - dx, RIGHT.min, RIGHT.max) }))
  const setCentre = (c: CentreTab) => setLayout((l) => ({ ...l, centre: c }))

  // The panes the steps render into (callback refs, so the steps mount once the boxes exist).
  const [left, setLeftEl] = useState<HTMLElement | null>(null)
  const [centre, setCentreEl] = useState<HTMLElement | null>(null)
  const [right, setRightEl] = useState<HTMLElement | null>(null)
  const [strip, setStripEl] = useState<HTMLElement | null>(null)
  const later = LATER[step]

  return (
    <div className="mw-root flex flex-col h-[calc(100vh-3rem)]">
     <StepRail step={step} onStep={onStep} />
     <div className="flex flex-1 min-h-0 relative">
      <aside className="mw-left flex-shrink-0 bg-white border-r border-light-grey flex flex-col min-h-0" style={{ width: layout.left }}>
        {header}
        <div className="mw-slot flex-1 min-h-0 overflow-auto" ref={setLeftEl} />
      </aside>
      <ResizeHandle onResize={setLeft} />
      <section className="flex-1 min-w-0 flex flex-col bg-off-white">
        <div className="mw-strip flex-shrink-0" ref={setStripEl} />
        <div className="flex-shrink-0 flex items-center border-b border-light-grey bg-white px-2 pt-2" role="tablist" aria-label="View">
          {MODEL_CENTRE_TABS.map((t) => {
            const on = t.id === layout.centre
            return (
              <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setCentre(t.id)}
                className={`px-3 py-1.5 text-caption transition-colors border-b-2 -mb-px ${on ? 'border-navy text-navy font-medium' : 'border-transparent text-mid-grey hover:text-navy'}`}>
                {t.label}
              </button>
            )
          })}
        </div>
        <div className="mw-centre flex-1 min-h-0 relative overflow-hidden" ref={setCentreEl}>
          {later && layout.centre === 'drawing' && (
            <div className="mw-empty-over"><div className="mw-empty">
              <h2>{later.title}</h2>
              <p>{later.text}</p>
              <p>Today's tool does this on the <Link to={later.to}>{later.page}</Link> page.</p>
            </div></div>
          )}
        </div>
      </section>
      <ResizeHandle onResize={setRight} />
      <aside className="mw-right flex-shrink-0 bg-white border-l border-light-grey min-h-0 overflow-hidden" style={{ width: layout.right }} ref={setRightEl} />
      {left && centre && right && strip && render?.({ step, slots: { left, centre, right, strip }, centre: layout.centre, setCentre })}
     </div>
    </div>
  )
}
