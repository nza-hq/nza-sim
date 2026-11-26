/**
 * Brief 123: the third tier (Linzie 17 Nov 10:27: "Instant, 15 minutes, then Energy+"). "Run in EnergyPlus" sends the
 * model as it stands to EnergyPlus on the computer running NZA Sim, and shows EnergyPlus's results beside NZA Sim's
 * hourly run of the same model, each under its own name (Rule 11: never one figure).
 */
import { useEffect, useRef, useState } from 'react'
import type { Level, Missing, Summary } from './seam'
import { energyPlusStatus, type EnergyPlusStatus, type EnergyPlusSummary } from './energyplus'
import type { EpWorkerIn, EpWorkerOut } from './energyplusWorker'

export type EnergyPlusState =
  | { kind: 'idle' }
  | { kind: 'running'; stage: 'preparing' | 'running'; elapsed_s: number }
  | { kind: 'missing'; items: Missing[] }
  | { kind: 'error'; message: string }
  | { kind: 'done'; ours: Summary; ep: EnergyPlusSummary; ran_for: unknown }

export interface EnergyPlusRequest {
  doc: unknown; level: Level; fabric_heat_c: number | null
  weather: { bytes: Uint8Array; name: string; source: 'local' | 'organisation' } | null
}

/** Held by useRun, so the strip's button and the results' panel share one run. */
export function useEnergyPlus(request: () => EnergyPlusRequest) {
  const [state, setState] = useState<EnergyPlusState>({ kind: 'idle' })
  const [status, setStatus] = useState<EnergyPlusStatus | null>(null)
  const worker = useRef<Worker | null>(null)
  const seq = useRef(0)
  const ranFor = useRef<unknown>(null)
  useEffect(() => {
    energyPlusStatus().then(setStatus)
    return () => { worker.current?.terminate(); worker.current = null }
  }, [])
  const run = () => {
    const r = request()
    if (!r.weather) { setState({ kind: 'error', message: 'Choose a weather file first (Project).' }); return }
    if (!worker.current) {
      try {
        const w = new Worker(new URL('./energyplusWorker.ts', import.meta.url), { type: 'module' })
        w.onerror = (ev) => { ev.preventDefault(); setState({ kind: 'error', message: ev.message || 'the background worker stopped' }) }
        w.onmessage = (ev: MessageEvent<EpWorkerOut>) => {
          const m = ev.data
          if (m.id !== seq.current) return
          if (m.type === 'progress') setState({ kind: 'running', stage: m.stage, elapsed_s: m.elapsed_s })
          else if (m.type === 'done') setState({ kind: 'done', ours: m.ours, ep: m.ep, ran_for: ranFor.current })
          else if (m.type === 'missing') setState({ kind: 'missing', items: m.missing })
          else setState({ kind: 'error', message: m.message })
        }
        worker.current = w
      } catch (e) { setState({ kind: 'error', message: (e as Error).message || 'the browser blocked the background worker' }); return }
    }
    const id = ++seq.current
    ranFor.current = r.doc
    setState({ kind: 'running', stage: 'preparing', elapsed_s: 0 })
    const msg: EpWorkerIn = { type: 'run', id, doc: r.doc, level: r.level, fabric_heat_c: r.fabric_heat_c, weather: { bytes: r.weather.bytes.slice(), file_name: r.weather.name, source: r.weather.source } }
    worker.current.postMessage(msg)
  }
  return { state, status, run }
}
export type EnergyPlusRun = ReturnType<typeof useEnergyPlus>

const mwh = (kwh: number) => (kwh / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const kw = (w: number) => (w / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })
const pct = (a: number, b: number) => (b === 0 ? '–' : `${a >= b ? '+' : '−'}${Math.abs((a / b - 1) * 100).toFixed(0)} %`)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The button, beside Run; disabled with the reason when this NZA Sim cannot run EnergyPlus. */
export function EnergyPlusButton({ ep, disabled, onRan }: { ep: EnergyPlusRun; disabled?: boolean; onRan?: () => void }) {
  const unavailable = ep.status && !ep.status.available
  const running = ep.state.kind === 'running'
  return (
    <button type="button" className="rp-btn rp-ep" disabled={disabled || running || !!unavailable}
      title={unavailable ? ep.status!.message ?? undefined : 'Run this model in EnergyPlus and compare it with NZA Sim'}
      onClick={() => { ep.run(); onRan?.() }}>
      {running ? `EnergyPlus… ${Math.round(ep.state.kind === 'running' ? ep.state.elapsed_s : 0)} s` : ep.state.kind === 'done' ? 'Run in EnergyPlus again' : 'Run in EnergyPlus'}
    </button>
  )
}

/** NZA Sim's hourly year and EnergyPlus's, side by side. `current`: the document shown now (older results say so). */
export function EnergyPlusCompare({ ep, current, disabled }: { ep: EnergyPlusRun; current: unknown; disabled?: boolean }) {
  const [more, setMore] = useState(false)
  const s = ep.state
  const unavailable = ep.status && !ep.status.available
  return (
    <section className="rp-epc" aria-label="EnergyPlus comparison">
      <h3>EnergyPlus <EnergyPlusButton ep={ep} disabled={disabled} /></h3>
      {unavailable && <p className="rp-none">{ep.status!.message} EnergyPlus runs need NZA Sim running on a computer with EnergyPlus 25.2 or later installed.</p>}
      {s.kind === 'idle' && !unavailable && <p className="rp-none">Runs this model in EnergyPlus {ep.status?.version ?? ''}, the industry's recognised engine, at 15-minute steps, and shows its results beside NZA Sim's. It takes a few seconds to a minute.</p>}
      {s.kind === 'running' && <p className="rp-wait">{s.stage === 'preparing' ? 'Preparing the EnergyPlus model…' : `EnergyPlus is running (${Math.round(s.elapsed_s)} s)…`}</p>}
      {s.kind === 'missing' && (
        <div className="rp-missing" role="status"><p>EnergyPlus cannot run this model yet:</p><ul>{s.items.map((m) => <li key={m.path + m.what}>{m.what}</li>)}</ul></div>
      )}
      {s.kind === 'error' && <p className="rp-error" role="alert" style={{ whiteSpace: 'pre-wrap' }}>EnergyPlus did not finish: {s.message}</p>}
      {s.kind === 'done' && (() => {
        const o = s.ours, e = s.ep
        const stale = s.ran_for !== current
        const oursLabel = `NZA Sim (${o.steps_per_hour === 4 ? '15-minute' : 'hourly'} steps)`
        const epLabel = `EnergyPlus ${e.version} (15-minute steps)`
        const rows: [string, string, string, string][] = [
          ['Heating, MWh a year', mwh(o.building.heating_kwh), mwh(e.building.heating_kwh), pct(o.building.heating_kwh, e.building.heating_kwh)],
          ['Cooling, MWh a year', mwh(o.building.cooling_kwh), mwh(e.building.cooling_kwh), pct(o.building.cooling_kwh, e.building.cooling_kwh)],
          ['Peak heating, kW', kw(o.building.peak_heating_w), kw(e.building.peak_heating_w), pct(o.building.peak_heating_w, e.building.peak_heating_w)],
          ['Peak cooling, kW', kw(o.building.peak_cooling_w), kw(e.building.peak_cooling_w), pct(o.building.peak_cooling_w, e.building.peak_cooling_w)],
        ]
        if (o.energy?.ok && e.energy?.ok) {
          rows.push(['Energy used, MWh a year', mwh(o.energy.total_kwh), mwh(e.energy.total_kwh), pct(o.energy.total_kwh, e.energy.total_kwh)])
          rows.push(['EUI, kWh/m² a year', Math.round(o.energy.eui_kwh_per_m2).toLocaleString('en-GB'), Math.round(e.energy.eui_kwh_per_m2).toLocaleString('en-GB'), pct(o.energy.eui_kwh_per_m2, e.energy.eui_kwh_per_m2)])
        }
        return (
          <div className={stale ? 'rp-stale' : undefined}>
            {stale && <p className="rp-note">The model has changed since this EnergyPlus run. Run it again to compare the model as it is now.</p>}
            <table className="rp-table">
              <thead><tr><th></th><th>{oursLabel}</th><th>{epLabel}</th><th>NZA Sim vs EnergyPlus</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody>
            </table>
            {e.energy?.ok && <p className="rp-foot">Energy used in the EnergyPlus column is EnergyPlus's heating and cooling through the same system efficiencies, fans, pumps, lighting and hot water as NZA Sim's; only the heating and cooling come from EnergyPlus.</p>}
            <table className="rp-table">
              <thead><tr><th>Zone</th><th>Heating MWh<br />NZA Sim · EnergyPlus</th><th>Cooling MWh<br />NZA Sim · EnergyPlus</th><th>Hours below setpoint in use<br />EnergyPlus</th></tr></thead>
              <tbody>
                {e.zones.map((z, i) => {
                  const oz = o.zones[i]
                  return (
                    <tr key={z.id}>
                      <td>{z.name || z.id}</td>
                      <td>{oz?.heated ? `${mwh(oz.heating_kwh)} · ${mwh(z.heating_kwh)}` : <span className="rp-none">not heated</span>}</td>
                      <td>{oz?.cooled ? `${mwh(oz.cooling_kwh)} · ${mwh(z.cooling_kwh)}` : <span className="rp-none">not cooled</span>}</td>
                      <td>{z.unmet_heating_hours_in_use == null ? '–' : z.unmet_heating_hours_in_use.toLocaleString('en-GB')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <button type="button" className="rp-expand" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? '▾' : '▸'} By month, and how the model was carried into EnergyPlus</button>
            {more && (
              <>
                <table className="rp-table">
                  <thead><tr><th>Month</th><th>Heating MWh<br />NZA Sim · EnergyPlus</th><th>Cooling MWh<br />NZA Sim · EnergyPlus</th></tr></thead>
                  <tbody>{MONTHS.map((m, k) => <tr key={m}><td>{m}</td><td>{mwh(o.building.monthly.heating_kwh[k])} · {mwh(e.building.monthly.heating_kwh[k])}</td><td>{mwh(o.building.monthly.cooling_kwh[k])} · {mwh(e.building.monthly.cooling_kwh[k])}</td></tr>)}</tbody>
                </table>
                <ul className="rp-epnotes">{e.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </>
            )}
            <p className="rp-foot">EnergyPlus {e.version} ran in {e.run_s.toFixed(1)} s with {e.warnings.toLocaleString('en-GB')} warnings and {e.severe} severe errors.{e.severe > 0 ? ` ${e.severe_text.join(' ')}` : ''}</p>
          </div>
        )
      })()}
    </section>
  )
}
