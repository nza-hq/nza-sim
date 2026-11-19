/**
 * Brief 105 Part 5: results in the editor. Heating and cooling demand for the drawn building, from the run seam in a
 * worker, rerun about a quarter of a second after each edit.
 *
 * Mounted in the editor by one line (`<ResultsPanel doc={built.doc} />`); it positions itself and owns nothing of the
 * editor's. Shows the building total first, then each zone, then the building's breakdown. A figure carries the one
 * word "estimate"; the basis is behind ⓘ (brief decision 7). Where an input is missing it lists what, and shows no
 * number (CLAUDE.md rules 2 and 3). The weather file is always named, with its station (decision 4).
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useAuth } from '../../auth/AuthGate'
import { RunClient, type InstantAnswer, type RunAnswer, type WeatherAnswer } from './client'
import { BUCKET, listOrganisationWeather, saveToOrganisation } from './weather'
import type { InstantEstimate, Level, Missing, Summary, WhatIf } from './seam'
import { EmitterSizing } from './EmitterSizing'
import { EnergyPlusButton, EnergyPlusCompare, useEnergyPlus } from './EnergyPlusCompare'
// @ts-expect-error untyped JS from today's app (Brief 110b: reused, not redrawn)
import LiveResultsStrip from '../../components/shared/LiveResultsStrip.jsx'
// @ts-expect-error untyped JS from today's app
import { COOLING_COLOUR, HEATING_COLOUR, SYSTEMS_ACCENT } from '../../data/balanceColours.js'
import './run.css'

export const TERMS: Record<string, string> = {
  heating: 'Heating', cooling: 'Cooling', conduction: 'Fabric (conduction)', opaque_solar_absorbed: 'Sun on walls and roof',
  sky_longwave: 'Radiation to the sky', bridging: 'Thermal bridges', infiltration: 'Air leakage', permanent_vents: 'Permanent vents',
  solar_transmitted: 'Sun through windows', solar_lost_through_glazing: 'Sun lost back out through windows',
  glazing_solar_absorbed: 'Sun absorbed in the glass', other_gains: 'Other gains', storage: 'Heat stored in the building',
  occupancy_gains: 'People', lighting_gains: 'Lighting', equipment_gains: 'Equipment', auxiliary_gains: 'Other equipment',
  mechanical_ventilation: 'Ventilation', interzone: 'From other zones',
  window_ventilation: 'Open windows', single_sided_turbulence: 'Open windows (gusts, one side)',
  gains_not_used: 'Gains not used (room above setpoint)',
  intermittent_heating: 'Heat not lost while heating is off or set back',
}
const FUEL_WORDS: Record<string, string> = { electricity: 'Electricity', gas: 'Gas', oil: 'Oil', biomass: 'Biomass', district_heating: 'District heat', district_cooling: 'District cooling' }
const END_USE_WORDS: Record<string, string> = {
  heating: 'Heating', cooling: 'Cooling', dhw: 'Hot water', dhw_circulation: 'Hot water pump', pumps: 'Pumps', fans: 'Fans', lighting: 'Lighting',
  small_power: 'Small power', auxiliary: 'Other electrical',
}
const mwh = (kwh: number) => (kwh / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const signed = (kwh: number) => `${kwh >= 0 ? '+' : '−'}${mwh(Math.abs(kwh))}`
export const FABRIC = ['conduction', 'opaque_solar_absorbed', 'sky_longwave']
interface Row { key: string; label: string; kwh: number; parts?: Row[] }
const perM2 = (kwh: number, m2: number) => (m2 > 0 ? Math.round(kwh / m2).toLocaleString('en-GB') : '–')

/**
 * A balance as rows, largest in first (Rule 9: every term). The outside faces' three terms (sun on them, radiation to
 * the sky, conduction) are large and mostly cancel, so they show as one net line for walls, roof and floor, opened to
 * see the three.
 */
function balanceRows(lines: { term: string; kwh: number }[]): Row[] {
  const parts = lines.filter((l) => FABRIC.includes(l.term))
  const rows: Row[] = lines.filter((l) => !FABRIC.includes(l.term)).map((l) => ({ key: l.term, label: TERMS[l.term] ?? l.term, kwh: l.kwh }))
  if (parts.length) rows.push({ key: 'fabric', label: 'Walls, roof and floor', kwh: parts.reduce((a, l) => a + l.kwh, 0), parts: [...parts].sort((a, b) => b.kwh - a.kwh).map((l) => ({ key: l.term, label: TERMS[l.term] ?? l.term, kwh: l.kwh })) })
  return rows.sort((a, b) => b.kwh - a.kwh)
}

function BalanceRows({ lines, indent = false }: { lines: { term: string; kwh: number }[]; indent?: boolean }) {
  const [fabricOpen, setFabricOpen] = useState(false)
  const rows = useMemo(() => balanceRows(lines), [lines])
  const cls = indent ? 'rp-zone-line' : undefined
  return <>{rows.flatMap((l) => [
    <tr key={l.key} className={cls}>
      <td>{l.parts
        ? <button type="button" className="rp-expand" aria-expanded={fabricOpen} onClick={() => setFabricOpen(!fabricOpen)}>{fabricOpen ? '▾' : '▸'} {l.label}</button>
        : l.label}</td>
      <td className={l.kwh >= 0 ? 'in' : 'out'} colSpan={indent ? 2 : undefined}>{signed(l.kwh)}</td>
    </tr>,
    ...(l.parts && fabricOpen ? l.parts.map((q) => (
      <tr key={q.key} className={indent ? 'rp-part rp-zone-line' : 'rp-part'}><td>{q.label}</td><td className={q.kwh >= 0 ? 'in' : 'out'} colSpan={indent ? 2 : undefined}>{signed(q.kwh)}</td></tr>
    )) : []),
  ])}</>
}

type State =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'missing'; items: { path: string; what: string }[] }
  | { kind: 'error'; message: string }
  | { kind: 'done'; summary: Summary; ms: number }

/**
 * The run for one document: a worker, rerun about a quarter of a second after each change, plus the weather it runs
 * on. One per editor; the floating panel, the workspace's strip, Heat flow tab and Site weather all read the same one.
 */
/** Engine refusals the run's own wording does not cover yet, said in the workspace's words (Brief 118 test on Bridgewater:
 * a hotel space type's lighting follows occupancy, and its people per m² is still unset, so the zone has no occupancy). */
function plainMissing(items: { path: string; what: string }[], doc: unknown) {
  return items.map((m) => {
    const zl = m.path.match(/^zones\[(\d+)\]\.profile_refs\.lighting$/)
    if (zl) {
      const zone = (doc as { zones?: { name?: string }[] } | null)?.zones?.[Number(zl[1])]
      return { ...m, what: `Give "${zone?.name || `zone ${Number(zl[1]) + 1}`}" a lighting system with its efficacy (Systems, Lighting): its space type states the light needed in lux.` }
    }
    const z = m.path.match(/^zones\[(\d+)\]\.profile_refs\.occupancy$/)
    if (!z) return m
    const zone = (doc as { zones?: { name?: string }[] } | null)?.zones?.[Number(z[1])]
    return { ...m, what: `Say how many people use "${zone?.name || `zone ${Number(z[1]) + 1}`}": people per m² or per room on its space type (Spaces). Its lighting or equipment follows them.` }
  })
}

/** Brief 122: the monthly estimate (static), worked out at once on every edit. */
export type InstantState =
  | { kind: 'idle' }
  | { kind: 'missing'; items: Missing[] }
  | { kind: 'error'; message: string }
  | { kind: 'done'; estimate: InstantEstimate; ms: number }

/**
 * `hold` (Brief 122, Linzie 17 Nov 08:20: "instantaneous calculations and the ability to run"): on Site, Shape and
 * Fabric each edit works out the monthly estimate (static) at once, and the hourly year waits for Run. Elsewhere the
 * hourly year reruns after each edit, as before.
 */
export function useRun(doc: unknown, previewDoc: unknown = null, hold = false) {
  const auth = useAuth()
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [weather, setWeather] = useState<{ file_name: string; station: string } | null>(null)
  const [weatherError, setWeatherError] = useState<string | null>(null)
  const [orgFiles, setOrgFiles] = useState<string[] | null>(null)
  const localFile = useRef<{ bytes: Uint8Array; name: string } | null>(null)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const client = useRef<RunClient | null>(null)
  const latestDoc = useRef(doc)
  latestDoc.current = doc
  const latestHold = useRef(hold)
  latestHold.current = hold
  const instClient = useRef<RunClient | null>(null)
  const [instant, setInstant] = useState<InstantState>({ kind: 'idle' })
  /** The document the shown hourly result is of; on a held step, a newer edit makes that result out of date. */
  const ranDoc = useRef<unknown>(null)
  const [ranFor, setRanFor] = useState<unknown>(null)
  // Brief 108 P5: a second flow and return pair, run on the same rooms beside the first.
  const [whatIf, setWhatIf] = useState<WhatIf | null>(null)
  const latestWhatIf = useRef(whatIf)
  latestWhatIf.current = whatIf
  // Brief 111 P4: what the results include. Fabric only heats every room to a temperature the person states (shown and
  // editable beside the switch, never hidden); + Spaces and + Systems run the document's own setpoints.
  const [level, setLevel] = useState<Level>('systems')
  // 18 Nov 2026 (end-to-end test): a run asked for after an edit, a level switch or a step change keeps the last
  // figures on screen until its answer comes (no flicker), but they are no longer the answer to what is on screen, so
  // they are shown as out of date (dimmed) until it arrives. Without this, "+ Spaces" showed + Systems' energy used.
  const [busy, setBusy] = useState(false)
  const [fabricC, setFabricC] = useState<number>(21)
  const opts = () => ({ level: latestLevel.current.level, fabric_heat_c: latestLevel.current.level === 'fabric' ? latestLevel.current.c : null, what_if: latestWhatIf.current })
  const latestLevel = useRef({ level, c: fabricC })
  latestLevel.current = { level, c: fabricC }
  function askInstant() {
    const l = latestLevel.current
    instClient.current?.instant(latestDoc.current, l.level, l.level === 'fabric' ? l.c : null)
  }

  useEffect(() => {
    let c: RunClient
    const failed = (why: string) => setState({ kind: 'error', message: `Results cannot run in this view (${why}).` })
    try {
      c = new RunClient(
      (a: RunAnswer) => {
        const r = a.result
        if (r.ok) setState({ kind: 'done', summary: r.summary, ms: a.ms })
        else if ('missing' in r) setState({ kind: 'missing', items: plainMissing(r.missing, latestDoc.current) })
        else setState({ kind: 'error', message: r.error })
        setBusy(false)
        setRanFor(ranDoc.current)
      },
      (w: WeatherAnswer) => {
        if (w.ok) { setWeather({ file_name: w.file_name, station: w.station }); setWeatherError(null) }
        else { setWeather(null); setWeatherError(w.error) }
        if (latestHold.current) { askInstant(); return }
        setState({ kind: 'running' })
        ranDoc.current = latestDoc.current
        c.run(latestDoc.current, 0, opts())
      },
      failed,
      )
    } catch (e) {
      failed((e as Error).message || 'the browser blocked the background worker')
      return
    }
    client.current = c
    // Brief 122: its own worker, so the estimate never waits behind an hourly year.
    try {
      instClient.current = new RunClient(() => {}, () => askInstant(), () => {}, (a: InstantAnswer) => {
        const r = a.result
        if (r.ok) setInstant({ kind: 'done', estimate: r.estimate, ms: a.ms })
        else if ('missing' in r) setInstant({ kind: 'missing', items: plainMissing(r.missing, latestDoc.current) })
        else setInstant({ kind: 'error', message: r.error })
      })
    } catch (e) { instClient.current = null; setInstant({ kind: 'error', message: `it cannot run in this view (${(e as Error).message || 'the browser blocked the background worker'})` }) }
    // Preview, then apply (Linzie, 16 Nov 00:22): a second worker runs the change being previewed, on the same weather,
    // so the strip can show where the numbers stand now and where they would go. It is not started until asked for.
    return () => { c.dispose(); preview.current?.dispose(); preview.current = null; instClient.current?.dispose(); instClient.current = null }
  }, [])

  const preview = useRef<RunClient | null>(null)
  const [previewState, setPreviewState] = useState<State>({ kind: 'idle' })
  const latestPreview = useRef(previewDoc)
  latestPreview.current = previewDoc
  const weatherBytes = useRef<{ bytes: Uint8Array; name: string; source: 'local' | 'organisation' } | null>(null)
  const previewClient = () => {
    if (preview.current) return preview.current
    try {
      const p = new RunClient(
        (a: RunAnswer) => {
          const r = a.result
          if (r.ok) setPreviewState({ kind: 'done', summary: r.summary, ms: a.ms })
          else if ('missing' in r) setPreviewState({ kind: 'missing', items: plainMissing(r.missing, latestPreview.current) })
          else setPreviewState({ kind: 'error', message: r.error })
        },
        (w: WeatherAnswer) => { if (w.ok && latestPreview.current) p.run(latestPreview.current, 0, opts()) },
        (why) => setPreviewState({ kind: 'error', message: why }),
      )
      preview.current = p
      const wb = weatherBytes.current
      if (wb) p.setWeather(wb.bytes.slice(), wb.name, wb.source)
      return p
    } catch (e) {
      setPreviewState({ kind: 'error', message: (e as Error).message || 'the browser blocked the background worker' })
      return null
    }
  }
  const sendWeather = (bytes: Uint8Array, name: string, source: 'local' | 'organisation') => {
    weatherBytes.current = { bytes, name, source }
    client.current?.setWeather(bytes.slice(), name, source)
    preview.current?.setWeather(bytes.slice(), name, source)
    instClient.current?.setWeather(bytes.slice(), name, source)
  }
  useEffect(() => {
    if (!previewDoc) { setPreviewState({ kind: 'idle' }); return }
    const p = previewClient()
    if (!p) return
    setPreviewState({ kind: 'running' })
    if (weatherBytes.current) p.run(previewDoc, 0, opts())
  }, [previewDoc, whatIf, level, fabricC])

  useEffect(() => {
    if (!client.current) return
    if (hold) { askInstant(); return }
    setState((s) => (s.kind === 'done' ? s : { kind: 'running' }))
    setBusy(true)
    ranDoc.current = doc
    client.current.run(doc, 250, opts())
  }, [doc, whatIf, level, fabricC, hold])
  /** Brief 122: the hourly year, on Run (held steps). */
  const runHourly = () => {
    if (!client.current) return
    setState((s) => (s.kind === 'done' ? s : { kind: 'running' }))
    ranDoc.current = latestDoc.current
    client.current.run(latestDoc.current, 0, opts())
  }

  // The organisation's weather files, when signed in.
  useEffect(() => {
    if (!auth) return
    listOrganisationWeather(auth.supabase, auth.org.id).then(setOrgFiles, () => setOrgFiles([]))
  }, [auth?.org.id])

  const onLocal = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f || !client.current) return
    const bytes = new Uint8Array(await f.arrayBuffer())
    localFile.current = { bytes, name: f.name }
    setSaveNote(null)
    sendWeather(bytes, f.name, 'local')
    e.target.value = ''
  }
  const onOrg = async (name: string) => {
    if (!auth || !client.current || !name) return
    const { data, error } = await auth.supabase.storage.from(BUCKET).download(`${auth.org.id}/${name}`)
    if (error || !data) { setWeatherError(error?.message ?? 'The weather file could not be downloaded.'); return }
    localFile.current = null
    setSaveNote(null)
    sendWeather(new Uint8Array(await data.arrayBuffer()), name, 'organisation')
  }
  const canSave = !!auth && (auth.org.role === 'admin' || auth.org.role === 'editor')
  const onSave = async () => {
    const f = localFile.current
    if (!auth || !f) return
    setSaveNote('Saving…')
    try {
      const saved = await saveToOrganisation(auth.supabase, auth.org.id, f.bytes, f.name)
      setSaveNote(`Saved to ${auth.org.name} as ${saved}.`)
      localFile.current = null
      listOrganisationWeather(auth.supabase, auth.org.id).then(setOrgFiles, () => {})
    } catch (e) { setSaveNote(`Not saved: ${(e as Error).message}.`) }
  }

  // On a held step, an hourly result of an older document is out of date until Run.
  const hourlyStale = hold && state.kind === 'done' && ranFor !== doc
  // Brief 123: the third tier, EnergyPlus, on the document and weather as they stand.
  const energyPlus = useEnergyPlus(() => {
    const l = latestLevel.current
    return { doc: latestDoc.current, level: l.level, fabric_heat_c: l.level === 'fabric' ? l.c : null, weather: weatherBytes.current }
  })
  return { auth, doc, energyPlus, state, busy, previewState, instant, hold, hourlyStale, runHourly, level, setLevel, fabricC, setFabricC, whatIf, setWhatIf, weather, weatherError, orgFiles, saveNote, onLocal, onOrg, canSave, onSave, hasLocalFile: () => !!localFile.current }
}
export type Run = ReturnType<typeof useRun>

/** The weather file the run uses, named with its station (decision 4), and how to choose one. */
export function WeatherPick({ run }: { run: Run }) {
  const { auth, weather, orgFiles, canSave, saveNote, weatherError, onLocal, onOrg, onSave } = run
  return (
    <div className="rp-weather">
      <span className="rp-label">Weather</span>
      {weather ? <span><b>{weather.file_name}</b> · {weather.station}</span> : <span className="rp-none">No weather file</span>}
      <div className="rp-weather-pick">
        <label className="rp-btn">
          Choose a file…
          <input type="file" accept=".epw" onChange={onLocal} hidden />
        </label>
        {auth && orgFiles && orgFiles.length > 0 && (
          <select defaultValue="" onChange={(e) => onOrg(e.target.value)} aria-label="Your organisation's weather files">
            <option value="" disabled>Your organisation's files</option>
            {orgFiles.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
      </div>
      {canSave && weather && run.hasLocalFile() && (
        <button type="button" className="rp-btn rp-save" onClick={onSave}>Save to {auth!.org.name}</button>
      )}
      {saveNote && <p className="rp-note">{saveNote}</p>}
      {weatherError && <p className="rp-error">That file could not be read: {weatherError}</p>}
    </div>
  )
}

/**
 * The workspace's strip (Brief 110 P3): always visible above the centre tabs, the building's heating, cooling and
 * energy from the same run as the Heat flow tab, or what the run is waiting for. Numbers only from a run.
 */
export function stripItems(s: Summary, unit: 'kwh' | 'kwh_per_m2') {
  const a = s.building.floor_m2
  const pair = (kwh: number) => (unit === 'kwh_per_m2'
    ? { value: perM2(kwh, a), unit: 'kWh/m²', sub: `${mwh(kwh)} MWh a year` }
    : { value: mwh(kwh), unit: 'MWh', sub: `${perM2(kwh, a)} kWh/m² a year` })
  const e = s.energy
  return [
    { label: 'Heating', ...pair(s.building.heating_kwh), accent: HEATING_COLOUR },
    { label: 'Cooling', ...pair(s.building.cooling_kwh), accent: COOLING_COLOUR },
    { label: 'Peak heating', value: Math.round(s.building.peak_heating_w / 1000).toLocaleString('en-GB'), unit: 'kW', sub: `cooling ${Math.round(s.building.peak_cooling_w / 1000).toLocaleString('en-GB')} kW` },
    e?.ok
      ? { label: 'Energy used', ...pair(e.total_kwh), accent: SYSTEMS_ACCENT }
      : { label: 'Energy used', value: '', unit: '', sub: e === null ? 'shown when results include systems' : 'systems not complete', accent: SYSTEMS_ACCENT },
  ]
}

/** One decimal, so a small change still shows. */
const one = (x: number) => x.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** The previewed change: each figure now → if applied, and by how much (Linzie, 16 Nov 00:22: "show what's happening"). */
export function previewItems(a: Summary, b: Summary, unit: 'kwh' | 'kwh_per_m2') {
  const per = (s: Summary, kwh: number) => (unit === 'kwh_per_m2' ? (s.building.floor_m2 > 0 ? kwh / s.building.floor_m2 : NaN) : kwh / 1000)
  const u = unit === 'kwh_per_m2' ? 'kWh/m²' : 'MWh'
  const move = (label: string, x: number, y: number, accent: string) => {
    const d = Math.round((y - x) * 10) / 10
    return { label, value: `${one(x)} → ${one(y)}`, unit: u, sub: d === 0 ? 'no change' : `${d > 0 ? '+' : '−'}${one(Math.abs(d))} ${u}`, accent }
  }
  const items = [
    move('Heating', per(a, a.building.heating_kwh), per(b, b.building.heating_kwh), HEATING_COLOUR),
    move('Cooling', per(a, a.building.cooling_kwh), per(b, b.building.cooling_kwh), COOLING_COLOUR),
  ]
  if (a.energy?.ok && b.energy?.ok) items.push(move('Energy used', per(a, a.energy.total_kwh), per(b, b.energy.total_kwh), SYSTEMS_ACCENT))
  return items
}

export const LEVEL_NAMES: Record<Level, string> = { fabric: 'Fabric only', spaces: '+ Spaces', systems: '+ Systems' }
/** Brief 111 P4: the "Results include" switch, and the level said in words. Fabric only's temperature is edited here,
 * inline with the figures it drives (110b row 8, as today's comfort card does). */
export function LevelSwitch({ run, fixed = false }: { run: Run; fixed?: boolean }) {
  const { level, setLevel, fabricC, setFabricC } = run
  const [typed, setTyped] = useState(String(fabricC))
  useEffect(() => setTyped(String(fabricC)), [fabricC])
  const commitC = () => {
    const v = Number(typed)
    if (typed.trim() !== '' && Number.isFinite(v) && v >= 5 && v <= 35) setFabricC(v)
    else setTyped(String(fabricC))
  }
  return (
    <div className="rp-level">
      {/* 19 Nov 2026 (Linzie, "too much going on"): Fabric and Spaces show their own level only, said in words; the
          switch is kept where it compares something, on Systems and Controls. */}
      {!fixed && <><span className="rp-level-label">Results include</span>
      <div className="rp-level-seg" role="radiogroup" aria-label="Results include">
        {(['fabric', 'spaces', 'systems'] as const).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={level === l} onClick={() => setLevel(l)}>{LEVEL_NAMES[l]}</button>
        ))}
      </div></>}
      <span className="rp-level-says">
        {level === 'fabric' ? (
          <>The fabric alone: every room heated to{' '}
            <input className="rp-level-c" aria-label="Every room heated to (°C)" inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value)} onBlur={commitC} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />{' '}°C, no people, no cooling.</>
        ) : level === 'spaces'
          ? (fixed ? 'Each room at its own temperatures, with its people and equipment. No systems yet.' : 'Adds people and equipment from the space types, each at its own temperatures. No systems, so no lighting yet.')
          : 'The whole model, through to energy used.'}
      </span>
    </div>
  )
}

/** Brief 122: the monthly estimate (static)'s two figures, in the top bar's Per m² / Total. */
export function instantItems(e: InstantEstimate, unit: 'kwh' | 'kwh_per_m2') {
  const a = e.building.floor_m2
  const pair = (kwh: number) => (unit === 'kwh_per_m2'
    ? { value: perM2(kwh, a), unit: 'kWh/m²', sub: `${mwh(kwh)} MWh a year` }
    : { value: mwh(kwh), unit: 'MWh', sub: `${perM2(kwh, a)} kWh/m² a year` })
  return [
    { label: 'Heating', ...pair(e.building.heating_kwh), accent: HEATING_COLOUR },
    { label: 'Cooling', ...pair(e.building.cooling_kwh), accent: COOLING_COLOUR },
  ]
}

/**
 * Brief 122, on Site, Shape and Fabric: the monthly estimate (static) as you edit, and the hourly year on Run. The two
 * are never one figure (Rule 11): the estimate is labelled as the static engine's, the hourly year as the run's.
 */
function HeldStrip({ run, onOpen, unit }: { run: Run; onOpen?: () => void; unit: 'kwh' | 'kwh_per_m2' }) {
  const { instant, state, weather, hourlyStale, runHourly } = run
  const s = state.kind === 'done' ? state.summary : null
  return (
    <div className="rp-strip rp-strip-held" role="status" aria-label="Results">
      <div className="rp-strip-live" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.() }} title="Open the heat flow">
        <span className="rp-strip-tag" title={instant.kind === 'done' ? `Worked out in ${Math.round(instant.ms)} ms` : undefined}>Monthly estimate<br />(static)</span>
        {instant.kind === 'done' ? <LiveResultsStrip items={instantItems(instant.estimate, unit)} />
          : <span className="rp-strip-msg">{instant.kind === 'missing' ? `No estimate yet: ${instant.items.length} ${instant.items.length === 1 ? 'input' : 'inputs'} to set. See them on Heat flow.` : instant.kind === 'error' ? `The estimate failed: ${instant.message}` : !weather ? 'No estimate yet: choose a weather file (Site).' : 'Working it out…'}</span>}
      </div>
      <div className="rp-strip-hourly">
        <span className="rp-strip-tag">Full year<br />(15 min)</span>
        {state.kind === 'running' ? <span className="rp-strip-msg">Running…</span>
          : s ? <span className={`rp-strip-hv${hourlyStale ? ' rp-stale' : ''}`} title={hourlyStale ? 'Out of date: the model has changed since this run' : undefined}>
              heating {unit === 'kwh_per_m2' ? `${perM2(s.building.heating_kwh, s.building.floor_m2)} kWh/m²` : `${mwh(s.building.heating_kwh)} MWh`}{hourlyStale ? ' · out of date' : ''}
            </span>
          : state.kind === 'missing' ? <span className="rp-strip-msg">{state.items.length} {state.items.length === 1 ? 'input' : 'inputs'} to set</span>
          : state.kind === 'error' ? <span className="rp-strip-msg rp-error" title={state.message}>{/cannot run in this view/.test(state.message) ? "can't run in this view" : 'stopped with an error (see Heat flow)'}</span> : null}
        <button type="button" className="rp-btn rp-run" disabled={!weather || state.kind === 'running'} onClick={runHourly}>{s ? 'Run again' : 'Run'}</button>
        <EnergyPlusButton ep={run.energyPlus} disabled={!weather} onRan={onOpen} />
      </div>
    </div>
  )
}

export function ResultsStrip({ run, onOpen }: { run: Run; onOpen?: () => void }) {
  const { state, weather, previewState } = run
  const unit = 'kwh' as 'kwh' | 'kwh_per_m2' // 19 Nov 2026 (Linzie): no Per m² / Total switch; totals, with per m² beside each
  if (run.hold) return <HeldStrip run={run} onOpen={onOpen} unit={unit} />
  const s = state.kind === 'done' ? state.summary : null
  const last = useRef<Summary | null>(null)
  if (s) last.current = s
  const shown = s ?? (state.kind === 'running' ? last.current : null)
  if (previewState.kind !== 'idle' && shown) {
    const p = previewState.kind === 'done' ? previewState.summary : null
    return (
      <div className={`rp-strip rp-strip-pv${p ? '' : ' rp-stale'}`} role="status" aria-label="Preview">
        <div className="rp-strip-live">
          {p ? <LiveResultsStrip items={previewItems(shown, p, unit)} />
            : <span className="rp-strip-msg">{previewState.kind === 'missing' ? 'This change leaves inputs unset: no figures for it yet.' : previewState.kind === 'error' ? `The preview could not run: ${previewState.message}` : 'Working out the change…'}</span>}
        </div>
        <span className="rp-strip-pvtag">Preview · not applied yet</span>
      </div>
    )
  }
  return (
    <div className={`rp-strip${state.kind === 'running' || run.busy ? ' rp-stale' : ''}`} role="status" aria-label="Results" aria-busy={state.kind === 'running' || run.busy} title={run.busy && s ? 'Working out the change: these figures are from before it' : undefined}>
      {shown ? (
        // Brief 110b P1: today's LiveResultsStrip, four figures, in the top bar's Per m² / Total.
        <div className="rp-strip-live" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.() }} title="Open the heat flow">
          <LiveResultsStrip items={stripItems(shown, unit)} />
        </div>
      ) : state.kind === 'missing' ? (
        <button type="button" className="rp-strip-msg" onClick={onOpen}>No results yet: {state.items.length} {state.items.length === 1 ? 'input' : 'inputs'} to set. See them on Heat flow.</button>
      ) : state.kind === 'error' ? (
        <span className="rp-strip-msg rp-error">The run failed: {state.message}</span>
      ) : !weather ? (
        <span className="rp-strip-msg">No results yet: choose a weather file (Site).</span>
      ) : (
        <span className="rp-strip-msg">Working it out…</span>
      )}
      {weather && <span className="rp-strip-wx" title={weather.station}>{shown ? <><i>Estimates</i>, weather </> : null}{weather.file_name}</span>}
    </div>
  )
}

/** The results themselves: totals, energy used, by zone (each opens to its own balance) and the building's balance.
 * `focusZone`: the zone the person has chosen in the workspace, opened first. */
export function ResultsBody({ run, focusZone }: { run: Run; focusZone?: string | null }) {
  const { state } = run
  const [info, setInfo] = useState(false)
  const s = state.kind === 'done' ? state.summary : null
  const [zoneOpen, setZoneOpen] = useState<string | null>(focusZone ?? null)
  useEffect(() => { if (focusZone !== undefined) setZoneOpen(focusZone) }, [focusZone])

  return (
    <div className="rp-body">
      {state.kind === 'missing' && (
        <div className="rp-missing" role="status">
          <p>To show results, the building needs:</p>
          <ul>{state.items.map((m) => <li key={m.path + m.what}>{m.what}</li>)}</ul>
        </div>
      )}
      {state.kind === 'error' && <p className="rp-error" role="alert">The run failed: {state.message}</p>}
      {(state.kind === 'idle' || (state.kind === 'running' && !s)) && <p className="rp-wait">Working it out…</p>}
      {/* Brief 123: kept apart from the hourly figures below (Rule 11), each column named. */}
      <EnergyPlusCompare ep={run.energyPlus} current={run.doc} disabled={!run.weather} />

      {s && (
        <div className={state.kind === 'running' || run.busy ? 'rp-stale' : undefined}>
          <div className="rp-totals">
            <div>
              <span className="rp-label">Heating <i>estimate</i></span>
              <span className="rp-metric">{mwh(s.building.heating_kwh)} <small>MWh a year</small></span>
              <span className="rp-sub">{perM2(s.building.heating_kwh, s.building.floor_m2)} kWh/m² · peak {Math.round(s.building.peak_heating_w / 1000)} kW</span>
            </div>
            <div>
              <span className="rp-label">Cooling <i>estimate</i></span>
              <span className="rp-metric">{mwh(s.building.cooling_kwh)} <small>MWh a year</small></span>
              <span className="rp-sub">{perM2(s.building.cooling_kwh, s.building.floor_m2)} kWh/m² · peak {Math.round(s.building.peak_cooling_w / 1000)} kW</span>
            </div>
          </div>
          {/* Brief 112 (Rule 8): lighting heat needs the luminaires' efficacy, a Systems object. */}
          {run.level === 'spaces' && <p className="rp-none">Lighting heat appears at + Systems, because it depends on the luminaires. Window ventilation appears at + Systems too, with its controls.</p>}

          <h3>Energy used <i>estimate</i></h3>
          {s.energy === null ? (
            <p className="rp-none">Energy used is shown when results include systems.</p>
          ) : s.energy.ok ? (
            <>
              <div className="rp-totals">
                <div>
                  <span className="rp-label">EUI</span>
                  <span className="rp-metric">{Math.round(s.energy.eui_kwh_per_m2).toLocaleString('en-GB')} <small>kWh/m² a year</small></span>
                  <span className="rp-sub">{mwh(s.energy.total_kwh)} MWh a year</span>
                </div>
                <div>
                  <span className="rp-label">By fuel</span>
                  {s.energy.by_fuel.map((f) => <span key={f.fuel} className="rp-sub">{FUEL_WORDS[f.fuel] ?? f.fuel} {mwh(f.kwh)} MWh</span>)}
                </div>
              </div>
              <table className="rp-table">
                <thead><tr><th>End use</th><th>Fuel</th><th>MWh</th></tr></thead>
                <tbody>
                  {s.energy.end_uses.map((l) => <tr key={`${l.end_use}|${l.fuel}`}><td>{END_USE_WORDS[l.end_use] ?? l.end_use}</td><td>{FUEL_WORDS[l.fuel] ?? l.fuel}</td><td>{mwh(l.kwh)}</td></tr>)}
                </tbody>
              </table>
              {s.energy.no_hot_water && <p className="rp-none">No hot water system stated: hot water is not included.</p>}
              {s.energy.not_modelled.length > 0 && <p className="rp-none">Stated but not used yet: {s.energy.not_modelled.join('; ')}.</p>}
              {s.energy.systems.length > 0 && (
                <table className="rp-table">
                  <thead><tr><th>System</th><th>Serves MWh</th><th>Uses MWh</th></tr></thead>
                  <tbody>
                    {s.energy.systems.map((g) => <tr key={g.id}><td>{g.label}{g.efficiency != null ? <span className="rp-eff"> · {g.efficiency}</span> : null}</td><td>{mwh(g.served_kwh)}</td><td>{mwh(g.fuel_kwh)}</td></tr>)}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div className="rp-missing" role="status">
              <p>To show energy use, the systems need:</p>
              <ul>{s.energy.missing.map((m) => <li key={m.path + m.what}>{m.what}</li>)}</ul>
            </div>
          )}

          <EmitterSizing summary={s} whatIf={run.whatIf} onWhatIf={run.setWhatIf} />

          <h3>
            By zone <i>estimate</i>
            <button type="button" className="rp-info" aria-expanded={info} onClick={() => setInfo((v) => !v)} aria-label="About these figures">ⓘ</button>
          </h3>
          {info && (
            <p className="rp-note">
              Demand to hold each zone's setpoints, from the multi-room engine. The building total is checked against
              EnergyPlus on a five-storey hotel (heating within 4 %, cooling within 10 %, with the same air density;
              with EnergyPlus's default outdoor air density, −11 % and +10 %). Figures for single zones and
              rooms are not yet validated: storeys differed from EnergyPlus by up to 31 % for cooling. Energy used is
              that demand through each system's share and efficiency, plus hot water, fans, lighting and equipment. On the
              Bridgewater test building, given the same demand, it matches today's tool to the kWh; fans follow their
              schedule here. Lighting and equipment controls act through the gains; a control factor only splits
              electricity between systems sharing a zone. Carbon is not included yet.
            </p>
          )}
          <table className="rp-table">
            <thead><tr><th>Zone</th><th>Heating MWh</th><th>Cooling MWh</th></tr></thead>
            <tbody>
              {s.zones.flatMap((z) => [
                <tr key={z.id}>
                  <td><button type="button" className="rp-expand" aria-expanded={zoneOpen === z.id} onClick={() => setZoneOpen(zoneOpen === z.id ? null : z.id)}>{zoneOpen === z.id ? '▾' : '▸'} {z.name || z.id}</button></td>
                  <td>{z.heated ? mwh(z.heating_kwh) : <span className="rp-none">not heated</span>}</td>
                  <td>{z.cooled ? mwh(z.cooling_kwh) : <span className="rp-none">not cooled</span>}</td>
                </tr>,
                ...(zoneOpen === z.id ? [<BalanceRows key={`${z.id}-balance`} lines={z.breakdown} indent />] : []),
                ...(zoneOpen === z.id && z.air && z.air.hours_windows_open > 0 ? [<tr key={`${z.id}-win`} className="rp-zone-line"><td colSpan={3} className="rp-none">Windows open in {z.air.hours_windows_open.toLocaleString('en-GB')} hours of the year</td></tr>] : []),
              ])}
            </tbody>
          </table>
          {/* Brief 115 review F4: a room with no outside wall keeps today's air leakage under weather-driven air. */}
          {(() => {
            const inner = s.zones.filter((z) => z.air?.leakage === 'q50_over_20')
            return inner.length > 0 && <p className="rp-foot">{inner.map((z) => z.name || z.id).join(', ')} {inner.length === 1 ? 'has' : 'have'} no outside wall, so {inner.length === 1 ? 'its' : 'their'} air leakage stays at q50 ÷ 20 air changes, as in the fixed method; the wind and stack work only on rooms with outside walls.</p>
          })()}

          <h3>Where the heat goes <i>estimate</i></h3>
          <table className="rp-table rp-breakdown">
            <tbody><BalanceRows lines={s.breakdown} /></tbody>
          </table>
          {s.drafts.length > 0 && <p className="rp-draft">Uses a draft construction, awaiting Chris: {s.drafts.join('; ')}.</p>}
          <p className="rp-foot">MWh a year; + into the building, − out. Ran in {Math.round(state.kind === 'done' ? state.ms : 0)} ms.</p>
        </div>
      )}
    </div>
  )
}

/**
 * The standalone editor's panel (`/sim2/geometry`): floats beside the editor's cards, `right` px from its right edge,
 * and starts closed as a tab showing the heating when there is a result.
 */
export default function ResultsPanel({ doc, right = 16 }: { doc: unknown; right?: number }) {
  const run = useRun(doc)
  const [open, setOpen] = useState(false)
  const s = run.state.kind === 'done' ? run.state.summary : null
  if (!open) {
    return <button type="button" className="rp-tab" style={{ right }} onClick={() => setOpen(true)}>Results{s ? ` · ${mwh(s.building.heating_kwh)} MWh heating` : run.state.kind === 'missing' ? ` · ${run.state.items.length} to set` : ''}</button>
  }
  return (
    <section className="rp" style={{ right }} aria-label="Results">
      <header className="rp-head">
        <h2>Heating and cooling demand</h2>
        <button type="button" className="rp-x" onClick={() => setOpen(false)} aria-label="Hide results">–</button>
      </header>
      <WeatherPick run={run} />
      <ResultsBody run={run} />
    </section>
  )
}
