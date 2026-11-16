/**
 * Brief 109 Part 4: each zone heated to hours, from the run's summary (`summary.zones[i].hours`).
 *
 * Shown inside the results panel when any zone is heated to hours; the editor places it with one line,
 * `<HeatingHours summary={summary} />`. It owns nothing of the editor's.
 *
 * Per zone: hours below the setpoint while in use and the lowest temperature then; the morning peak (bringing the room
 * back from its setback) and the later peak, each with when it happened; and how long a cold morning takes to get
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
        <div className="rp-note">
          <p>
            Each zone is heated to its setpoint in its hours, and outside them to its setback, or not at all if it has no
            setback. Hours below count the hours in use more than 0.5 °C below the setpoint. When a zone's heating is
            limited, the year is run in quarter hours and each hour's temperature is the mean of its four, so that a slow
            morning is counted as it happens.
          </p>
          <p>
            The morning peak is the largest hour of heating at the start of the hours, bringing the room back from its
            setback; the later peak is the largest at any other hour in use. When heating is at its limit, many hours share
            the same peak, and the first of them is shown. Where heating is not limited, the room is brought back within
            the first hour, which puts back in one hour the heat its fabric and contents gave up overnight; most of that
            first-hour figure is the room's contents, taken as 250 kJ/K for each m² of floor, so a real system would take
            longer and need less. Emitter sizing is on the year without the setback.
          </p>
          <p>
            Cold mornings are the coldest quarter, by mean outdoor temperature, of the days whose hours start with the room
            below its setpoint; the time back is the middle value over those mornings, in whole hours. Underfloor heating
            warms the floor first, so it brings a room back more slowly than radiators of the same output. Its output is
            estimated at the room's temperature, so its hours below may be understated by up to about a tenth.
          </p>
        </div>
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
                  {h.limited ? 'Morning peak' : 'Heat to recover in the first hour'} {kw(h.morning_peak.w)} kW ({when(h.morning_peak.hour)})
                  {h.later_peak ? `; later peak ${kw(h.later_peak.w)} kW (${when(h.later_peak.hour)})` : ''}.
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
