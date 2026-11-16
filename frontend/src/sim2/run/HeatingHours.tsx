/**
 * Brief 109 Part 4: each zone heated to hours, from the run's summary (`summary.zones[i].hours`).
 *
 * Shown inside the results panel when any zone is heated to hours; the editor places it with one line,
 * `<HeatingHours summary={summary} />`. It owns nothing of the editor's.
 *
 * Per zone: hours below the setpoint while in use and the lowest temperature then; the morning peak (bringing the room
 * back from its setback) and the steady peak, each with when it happened; and how long a cold morning takes to get
 * back to the setpoint. Every figure is the engine's (Rule 1); the basis is behind ⓘ.
 */
import { useState } from 'react'
import type { Summary, ZoneHours } from './seam'
import './emitters.css'

const kw = (w: number) => (w / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const deg = (c: number) => c.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
/** An hour of the year as "Mon 22 Jan, 07:00", in the engine's calendar (gains.ts: 1 January is a Monday, no leap day). */
export function when(hour: number): string {
  const d = Math.floor(hour / 24), h = hour % 24
  let m = 0, day = d
  while (m < 11 && day >= MONTH_DAYS[m]) { day -= MONTH_DAYS[m]; m++ }
  return `${DAY[d % 7]} ${day + 1} ${MONTH[m]}, ${String(h).padStart(2, '0')}:00`
}
const hoursWord = (n: number) => (n === 1 ? '1 hour' : `${n.toLocaleString('en-GB', { maximumFractionDigits: 1 })} hours`)

function recovery(r: NonNullable<ZoneHours['recovery']>, sp: number): string {
  const back = r.median_h == null ? `does not get back to ${deg(sp)} °C that day`
    : r.median_h === 0 ? `is back within 0.5 °C of ${deg(sp)} °C in the first hour`
      : `takes ${hoursWord(r.median_h)} to get back within 0.5 °C of ${deg(sp)} °C`
  const miss = r.not_reached > 0 && r.median_h != null ? ` On ${r.not_reached} of those ${r.mornings} mornings it does not get back that day.` : ''
  return `On a cold morning it ${back}.${miss}`
}

export function HeatingHours({ summary }: { summary: Summary }) {
  const [info, setInfo] = useState(false)
  const zones = summary.zones.filter((z) => z.hours)
  if (zones.length === 0) return null
  return (
    <section className="es" aria-label="Heating hours">
      <h3>
        Heating hours <i>estimate</i>
        <button type="button" className="rp-info" aria-expanded={info} onClick={() => setInfo((v) => !v)} aria-label="About the heating hours figures">ⓘ</button>
      </h3>
      {info && (
        <p className="rp-note">
          Each zone is heated to its setpoint in its hours and to its setback outside them. Hours below count the hours in
          use more than 0.5 °C below the setpoint. The morning peak is the largest hour of heating at the start of the
          hours, bringing the room back from its setback; the steady peak is the largest at any other hour in use. A cold
          morning is one of the coldest quarter of days, by mean outdoor temperature, whose hours start with the room below
          its setpoint; the time back is the middle value over those mornings, counted in whole hours. When heating is at
          its limit, many hours share the same peak, and the first of them is shown. Underfloor heating
          in a floor warms the floor first, so it brings a room back more slowly than radiators of the same output.
        </p>
      )}
      <ul className="es-zones">
        {zones.map((z) => {
          const h = z.hours!
          return (
            <li key={z.id} className={h.unmet_in_use_hours ? 'es-zone es-short' : 'es-zone'}>
              <div className="es-zone-head">
                <strong>{z.name}</strong>
                <span>{h.unmet_in_use_hours ? `${h.unmet_in_use_hours} h below` : 'holds its setpoint'}</span>
              </div>
              <p className="es-line">
                In use {h.in_use_hours.toLocaleString('en-GB')} hours a year
                {h.unmet_in_use_hours ? `; ${h.unmet_in_use_hours} of them more than 0.5 °C below the setpoint` : ''}
                {h.min_in_use_c != null ? `; lowest in use ${deg(h.min_in_use_c)} °C` : ''}.
              </p>
              {h.morning_peak && (
                <p className="es-line">
                  Morning peak {kw(h.morning_peak.w)} kW ({when(h.morning_peak.hour)})
                  {h.steady_peak ? `; steady peak ${kw(h.steady_peak.w)} kW (${when(h.steady_peak.hour)})` : ''}.
                </p>
              )}
              {h.recovery && <p className="es-line es-need">{recovery(h.recovery, h.setpoint_c)}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
