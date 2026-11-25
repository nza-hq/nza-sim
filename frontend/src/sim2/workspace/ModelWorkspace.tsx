/**
 * The Model workspace (Brief 110): Simulate v2's steps inside NZA Sim, laid out the way today's Building page is.
 *
 *   nav     the steps are NZA Sim's left navigation (components/layout/Sidebar.jsx; Linzie, 18 Nov 15:11: "get rid of
 *           the old stuff and layer this new stuff in the left navigation"). They were tabs across the top before.
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
import { LEFT, MODEL_CENTRE_TABS, RIGHT, STEP_HAS_RESULTS, STEP_TABS, clamp, loadLayout, saveLayout, tabFor, type CentreTab, type Layout } from './layout'
import { BUILDING_VIEWS, DEFAULT_STEP, STEPS, isBuildingView, isStep, rememberBuildingView, type StepId } from './steps'
import './workspace.css'

export type Slots = { left: HTMLElement; centre: HTMLElement; right: HTMLElement; strip: HTMLElement }

/** Steps 6 and 7 come later: say what they will hold and where today's tool does it. No numbers (CLAUDE.md rule 2). */
const LATER: Partial<Record<StepId, { title: string; text: string; to: string; page: string }>> = {
  check: { title: 'Check against the meters', text: "Compare this model's hourly use with the building's meter data and record any calibration. It comes in a later brief.", to: '/consumption', page: 'Consumption' },
  interventions: { title: 'Interventions', text: 'Stack changes to the model and see what each one saves, in order. It comes in a later brief.', to: '/interventions', page: 'Interventions' },
}

export default function ModelWorkspace({ render, header }: { header?: React.ReactNode; render?: (a: { step: StepId; slots: Slots; centre: CentreTab; setCentre: (c: CentreTab) => void; openRight: () => void }) => React.ReactNode }) {
  const [params, setParams] = useSearchParams()
  const q = params.get('step')
  const step: StepId = isStep(q) ? q : DEFAULT_STEP
  // Brief 128: Building is one area with five views; the sidebar's Building reopens the last one.
  const building = isBuildingView(step)
  useEffect(() => { rememberBuildingView(step) }, [step])
  const toView = (v: StepId) => { const p = new URLSearchParams(params); p.set('step', v); setParams(p) }

  const [layout, setLayout] = useState<Layout>(loadLayout)
  useEffect(() => saveLayout(layout), [layout])
  const setLeft = (dx: number) => setLayout((l) => ({ ...l, left: clamp(l.left + dx, LEFT.min, LEFT.max) }))
  const setRight = (dx: number) => setLayout((l) => ({ ...l, right: clamp(l.right - dx, RIGHT.min, RIGHT.max) }))
  const setCentre = (c: CentreTab) => setLayout((l) => ({ ...l, centre: c }))
  // The right closes (Linzie, 17 Nov 00:31: "Shouldn't the right be able to close?"); choosing something opens it again.
  const setRightOpen = (on: boolean) => setLayout((l) => (l.rightOpen === on ? l : { ...l, rightOpen: on }))
  // Phase 1 (Linzie, 19 Nov 2026 12:44): the details panel is not always there. Choosing something only shows it on the
  // drawing; the ⤢ button beside an item opens its details. Each step opens with it shut, except Shape, whose panel
  // holds the drawing's own settings.
  useEffect(() => { setRightOpen(step === 'shape') }, [step])

  // The panes the steps render into (callback refs, so the steps mount once the boxes exist).
  const [left, setLeftEl] = useState<HTMLElement | null>(null)
  const [centre, setCentreEl] = useState<HTMLElement | null>(null)
  const [right, setRightEl] = useState<HTMLElement | null>(null)
  const [strip, setStripEl] = useState<HTMLElement | null>(null)
  const later = LATER[step]
  // 19 Nov 2026 (Linzie): each step shows only its own tabs, and the steps without results have no results bar.
  const tabs = MODEL_CENTRE_TABS.filter((t) => STEP_TABS[step].includes(t.id))
  const centreTab = tabFor(step, layout.centre)
  const results = STEP_HAS_RESULTS(step)
  // A step that comes later has nothing to give, so its right pane stays shut (18 Nov 2026: it showed an empty column).
  // Site (19 Nov 2026) is one page in the middle, so it has no right pane either; nor has Profiles, whose list is on the
  // left and whose profile fills the middle (it was listed twice, left and right).
  const noRight = !!later || step === 'site' || step === 'profiles' || step === 'results'
  const rightShown = layout.rightOpen && !noRight

  return (
    <div className="mw-root flex flex-col h-[calc(100vh-3rem)]">
     <div className="flex flex-1 min-h-0 relative">
      <aside className="mw-left flex-shrink-0 bg-white border-r border-light-grey flex flex-col min-h-0" style={{ width: layout.left }}>
        {header}
        <div className="mw-slot flex-1 min-h-0 overflow-auto" ref={setLeftEl} />
      </aside>
      <ResizeHandle onResize={setLeft} />
      <section className="flex-1 min-w-0 flex flex-col bg-off-white">
        {/* Brief 128 (Linzie, 25 Nov 2026: "four areas is right"): the Building area's five views, one canvas. */}
        {building && (
          <div className="mw-views flex-shrink-0" role="tablist" aria-label="Building views">
            {BUILDING_VIEWS.map((v) => (
              <button key={v} type="button" role="tab" aria-selected={v === step} className={v === step ? 'on' : ''} onClick={() => toView(v)}
                title={STEPS.find((s) => s.id === v)?.line}>{STEPS.find((s) => s.id === v)?.name}</button>
            ))}
          </div>
        )}
        {/* Phase 1 (Linzie, 19 Nov 2026): one bar above the middle: the results (or one status chip) and what the middle
            shows, as one choice with a sensible default (it was a row of tabs under the results). */}
        <div className="mw-bar flex-shrink-0 flex items-stretch bg-white border-b border-light-grey" hidden={!results && tabs.length <= 1}>
          <div className="mw-strip flex-1 min-w-0" ref={setStripEl} hidden={!results} />
          {tabs.length > 1 && <label className="mw-view">
            <span>View</span>
            <select value={centreTab} onChange={(e) => setCentre(e.target.value as CentreTab)} aria-label="What the middle shows">
              {tabs.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>}
        </div>
        {/* Brief 128: the details lie over the drawing's edge instead of narrowing it. */}
        <div className="flex-1 min-h-0 relative">
          <div className="mw-centre absolute inset-0 overflow-hidden" ref={setCentreEl}>
            {later && (
              <div className="mw-empty-over"><div className="mw-empty">
                <h2>{later.title}</h2>
                <p>{later.text}</p>
                <p>Today's tool does this on the <Link to={later.to}>{later.page}</Link> page.</p>
              </div></div>
            )}
          </div>
          <aside className={`mw-right mw-over bg-white min-h-0${rightShown ? '' : ' mw-shut'}`} style={{ width: rightShown ? layout.right : 0 }} aria-hidden={!rightShown}>
            {rightShown && <div className="mw-over-grip"><ResizeHandle onResize={setRight} /></div>}
            <button type="button" className="mw-close" aria-label="Close the details" title="Close" onClick={() => setRightOpen(false)}>›</button>
            <div className="mw-slot h-full overflow-hidden" ref={setRightEl} />
          </aside>
          {!rightShown && !noRight && <button type="button" className="mw-open" onClick={() => setRightOpen(true)} title="Open the details">‹ Details</button>}
        </div>
      </section>
      {left && centre && right && strip && render?.({ step, slots: { left, centre, right, strip }, centre: centreTab, setCentre, openRight: () => setRightOpen(true) })}
     </div>
    </div>
  )
}
