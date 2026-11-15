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
import { createPortal } from '../workspace/portal'
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
  return (
    <>
      {createPortal(<ResultsStrip run={run} onOpen={onOpen} />, strip)}
      {showBody && createPortal(
        <div className="rp-flow" role="tabpanel" aria-label="Heat flow">
          <div className="rp-flow-in">
            <h2>Heating and cooling demand{focusZone ? '' : ', whole building'}</h2>
            <WeatherPick run={run} />
            <ResultsBody run={run} focusZone={focusZone} />
          </div>
        </div>,
        centre,
      )}
      {weatherEl && createPortal(<WeatherPick run={run} />, weatherEl)}
    </>
  )
}
