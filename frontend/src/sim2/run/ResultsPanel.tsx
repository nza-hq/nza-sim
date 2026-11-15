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
import { RunClient, type RunAnswer, type WeatherAnswer } from './client'
import { BUCKET, listOrganisationWeather, saveToOrganisation } from './weather'
import type { Summary, WhatIf } from './seam'
import { EmitterSizing } from './EmitterSizing'
import './run.css'

const TERMS: Record<string, string> = {
  heating: 'Heating', cooling: 'Cooling', conduction: 'Fabric (conduction)', opaque_solar_absorbed: 'Sun on walls and roof',
  sky_longwave: 'Radiation to the sky', bridging: 'Thermal bridges', infiltration: 'Air leakage', permanent_vents: 'Permanent vents',
  solar_transmitted: 'Sun through windows', solar_lost_through_glazing: 'Sun lost back out through windows',
  glazing_solar_absorbed: 'Sun absorbed in the glass', other_gains: 'Other gains', storage: 'Heat stored in the building',
  occupancy_gains: 'People', lighting_gains: 'Lighting', equipment_gains: 'Equipment', auxiliary_gains: 'Other equipment',
  mechanical_ventilation: 'Ventilation', interzone: 'From other zones',
}
const FUEL_WORDS: Record<string, string> = { electricity: 'Electricity', gas: 'Gas', oil: 'Oil', biomass: 'Biomass', district_heating: 'District heat', district_cooling: 'District cooling' }
const END_USE_WORDS: Record<string, string> = {
  heating: 'Heating', cooling: 'Cooling', dhw: 'Hot water', dhw_circulation: 'Hot water pump', fans: 'Fans', lighting: 'Lighting',
  small_power: 'Small power', auxiliary: 'Other electrical',
}
const mwh = (kwh: number) => (kwh / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const signed = (kwh: number) => `${kwh >= 0 ? '+' : '−'}${mwh(Math.abs(kwh))}`
const FABRIC = ['conduction', 'opaque_solar_absorbed', 'sky_longwave']
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
export function useRun(doc: unknown) {
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
  // Brief 108 P5: a second flow and return pair, run on the same rooms beside the first.
  const [whatIf, setWhatIf] = useState<WhatIf | null>(null)
  const latestWhatIf = useRef(whatIf)
  latestWhatIf.current = whatIf

  useEffect(() => {
    let c: RunClient
    const failed = (why: string) => setState({ kind: 'error', message: `Results cannot run in this view (${why}).` })
    try {
      c = new RunClient(
      (a: RunAnswer) => {
        const r = a.result
        if (r.ok) setState({ kind: 'done', summary: r.summary, ms: a.ms })
        else if ('missing' in r) setState({ kind: 'missing', items: r.missing })
        else setState({ kind: 'error', message: r.error })
      },
      (w: WeatherAnswer) => {
        if (w.ok) { setWeather({ file_name: w.file_name, station: w.station }); setWeatherError(null) }
        else { setWeather(null); setWeatherError(w.error) }
        setState({ kind: 'running' })
        c.run(latestDoc.current, 0, { what_if: latestWhatIf.current })
      },
      failed,
      )
    } catch (e) {
      failed((e as Error).message || 'the browser blocked the background worker')
      return
    }
    client.current = c
    return () => c.dispose()
  }, [])

  useEffect(() => {
    if (!client.current) return
    setState((s) => (s.kind === 'done' ? s : { kind: 'running' }))
    client.current.run(doc, 250, { what_if: whatIf })
  }, [doc, whatIf])

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
    client.current.setWeather(bytes.slice(), f.name, 'local')
    e.target.value = ''
  }
  const onOrg = async (name: string) => {
    if (!auth || !client.current || !name) return
    const { data, error } = await auth.supabase.storage.from(BUCKET).download(`${auth.org.id}/${name}`)
    if (error || !data) { setWeatherError(error?.message ?? 'The weather file could not be downloaded.'); return }
    localFile.current = null
    setSaveNote(null)
    client.current.setWeather(new Uint8Array(await data.arrayBuffer()), name, 'organisation')
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

  return { auth, state, whatIf, setWhatIf, weather, weatherError, orgFiles, saveNote, onLocal, onOrg, canSave, onSave, hasLocalFile: () => !!localFile.current }
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
export function ResultsStrip({ run, onOpen }: { run: Run; onOpen?: () => void }) {
  const { state, weather } = run
  const s = state.kind === 'done' ? state.summary : null
  const last = useRef<Summary | null>(null)
  if (s) last.current = s
  const shown = s ?? (state.kind === 'running' ? last.current : null)
  return (
    <div className={`rp-strip${state.kind === 'running' ? ' rp-stale' : ''}`} role="status" aria-label="Results">
      {shown ? (
        <>
          <button type="button" className="rp-strip-fig" onClick={onOpen} title="Open the heat flow">
            <span className="rp-label">Heating <i>estimate</i></span>
            <span><b>{mwh(shown.building.heating_kwh)}</b> MWh <small>{perM2(shown.building.heating_kwh, shown.building.floor_m2)} kWh/m²</small></span>
          </button>
          <button type="button" className="rp-strip-fig" onClick={onOpen} title="Open the heat flow">
            <span className="rp-label">Cooling <i>estimate</i></span>
            <span><b>{mwh(shown.building.cooling_kwh)}</b> MWh <small>{perM2(shown.building.cooling_kwh, shown.building.floor_m2)} kWh/m²</small></span>
          </button>
          <button type="button" className="rp-strip-fig" onClick={onOpen} title="Open the heat flow">
            <span className="rp-label">Energy used <i>estimate</i></span>
            {shown.energy?.ok ? <span><b>{Math.round(shown.energy.eui_kwh_per_m2).toLocaleString('en-GB')}</b> kWh/m² <small>{mwh(shown.energy.total_kwh)} MWh</small></span> : <small className="rp-none">{shown.energy === null ? 'shown when results include systems' : 'systems not complete'}</small>}
          </button>
        </>
      ) : state.kind === 'missing' ? (
        <button type="button" className="rp-strip-msg" onClick={onOpen}>No results yet: {state.items.length} {state.items.length === 1 ? 'input' : 'inputs'} to set. See them on Heat flow.</button>
      ) : state.kind === 'error' ? (
        <span className="rp-strip-msg rp-error">The run failed: {state.message}</span>
      ) : !weather ? (
        <span className="rp-strip-msg">No results yet: choose a weather file (Site).</span>
      ) : (
        <span className="rp-strip-msg">Working it out…</span>
      )}
      {weather && <span className="rp-strip-wx" title={weather.station}>{weather.file_name}</span>}
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

      {s && (
        <div className={state.kind === 'running' ? 'rp-stale' : undefined}>
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
              ])}
            </tbody>
          </table>

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
