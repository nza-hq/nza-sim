/**
 * Brief 110b row 2: Pop Out for the Model workspace. Today's TopBar opens this window when the person is on /model,
 * so a second screen shows the Model's results, not today's engine's. It shows the last run the workspace sent, in
 * the top bar's Per m² / Total, and nothing until one arrives (CLAUDE.md rule 2).
 */
import { useEffect, useMemo, useState } from 'react'
// @ts-expect-error untyped JS component from today's app (reused, not redrawn)
import HeatBalance from '../../components/modules/balance/HeatBalance.jsx'
// @ts-expect-error untyped JS from today's app
import LiveResultsStrip from '../../components/shared/LiveResultsStrip.jsx'
// @ts-expect-error untyped JS from today's app
import { useUISettings } from '../../context/UISettingsContext.jsx'
import { balanceLines } from './balanceLines'
import { hearModel, type ModelShare } from './modelChannel'
import { LEVEL_NAMES, stripItems } from './ResultsPanel'
import './run.css'

export default function ModelPopout() {
  const [share, setShare] = useState<ModelShare | null>(null)
  const { unit } = useUISettings() as { unit: 'kwh' | 'kwh_per_m2' }
  useEffect(() => hearModel(setShare), [])
  useEffect(() => { document.title = 'Model results · NZA Sim' }, [])
  const s = share?.summary ?? null
  const lines = useMemo(() => (s ? balanceLines(s.breakdown, s.building.floor_m2) : null), [s])
  const per = (kwh: number, a: number) => (unit === 'kwh_per_m2' ? `${a > 0 ? Math.round(kwh / a).toLocaleString('en-GB') : '–'} kWh/m²` : `${(kwh / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MWh`)
  return (
    <div className="rp-pop">
      <header>
        <h1>Model results</h1>
        {share && <span>{LEVEL_NAMES[share.level]}{share.level === 'fabric' && share.fabric_heat_c != null ? `: every room heated to ${share.fabric_heat_c} °C` : ''} · <i>Estimates</i>{share.weather ? `, weather ${share.weather}` : ''}</span>}
      </header>
      {!s ? (
        <p className="rp-pop-empty">No results yet. Open a model on the Model page with a weather file chosen; its results appear here as it runs.</p>
      ) : (
        <>
          <LiveResultsStrip items={stripItems(s, unit)} />
          <div className="rp-pop-grid">
            <section className="rp-hb">
              <p className="rp-hb-for">Whole building <i>estimate</i></p>
              {lines && <HeatBalance lines={lines} />}
            </section>
            <section>
              <h2>By zone</h2>
              <table className="rp-pop-zones">
                <thead><tr><th>Zone</th><th>Floor</th><th>Heating</th><th>Cooling</th></tr></thead>
                <tbody>
                  {s.zones.map((z) => (
                    <tr key={z.id}><td>{z.name || z.id}</td><td>{z.floor_m2.toLocaleString('en-GB', { maximumFractionDigits: 1 })} m²</td><td>{per(z.heating_kwh, z.floor_m2)}</td><td>{per(z.cooling_kwh, z.floor_m2)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
