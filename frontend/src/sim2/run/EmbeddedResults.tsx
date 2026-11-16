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
import { useMemo } from 'react'
// @ts-expect-error untyped JS component from today's app (Brief 110b: reused, not redrawn)
import HeatBalance from '../../components/modules/balance/HeatBalance.jsx'
import { createPortal } from '../workspace/portal'
import { balanceLines } from './balanceLines'
import { ResultsBody, ResultsStrip, WeatherPick, useRun } from './ResultsPanel'
import './run.css'

export default function EmbeddedResults({ doc, strip, centre, showBody, focusZone, weatherEl, onOpen }: {
  doc: unknown
  strip: HTMLElement
  centre: HTMLElement
  showBody: boolean
  focusZone: string | null
  weatherEl: HTMLElement | null
  onOpen: () => void
}) {
  const run = useRun(doc)
  const s = run.state.kind === 'done' ? run.state.summary : null
  // The chosen zone's balance (heat from other zones included), or the building's.
  const zone = s && focusZone ? s.zones.find((z) => z.id === focusZone) ?? null : null
  const lines = useMemo(() => (s ? (zone ? balanceLines(zone.breakdown, zone.floor_m2) : balanceLines(s.breakdown, s.building.floor_m2)) : null), [s, zone])
  return (
    <>
      {createPortal(<ResultsStrip run={run} onOpen={onOpen} />, strip)}
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
