/**
 * Brief 117 Part 3: each room's design heat loss, for sizing, from the run's summary (`summary.design_heat_loss`).
 *
 * Shown inside the results panel when the building states its design conditions; the editor places it with one line,
 * `<DesignHeatLoss summary={summary} />`. It owns nothing of the editor's. Per room: the design heat loss, W per m² of
 * floor, the room's design temperature, and the terms it is made of (Rule 9: they sum to it). The emitters against it
 * are in the Emitters panel's "Design heat loss" view. Every figure is the engine's (Rule 1); the basis is behind ⓘ.
 */
import { useState } from 'react'
import type { DesignTerm } from '../../thermal/engine/designHeatLoss'
import type { Summary } from './seam'
import './emitters.css'

const kw = (w: number) => (w / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const deg = (c: number) => c.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const whole = (x: number) => Math.round(x).toLocaleString('en-GB')

export const DESIGN_TERM_WORDS: Record<DesignTerm, string> = {
  fabric: 'Walls, roof, floors and windows',
  bridging: 'Thermal bridging',
  ground: 'Floor on the ground',
  to_room: 'To rooms at other temperatures',
  infiltration: 'Air leakage',
  vents: 'Permanent vents',
  mechanical_ventilation: 'Ventilation',
  minimum_air_change: 'Top-up to 0.5 air changes an hour',
  warm_up: 'Warm-up allowance',
}

const OUTDOOR_WORDS = { stated: 'stated', heating_99_6: "the weather file's 99.6 %", heating_99: "the weather file's 99 %" } as const

export function DesignHeatLoss({ summary }: { summary: Summary }) {
  const [info, setInfo] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const d = summary.design_heat_loss
  if (!d) return null
  return (
    <section className="es" aria-label="Design heat loss">
      <h3>
        Design heat loss <i>estimate</i>
        <button type="button" className="rp-info" aria-expanded={info} onClick={() => setInfo((v) => !v)} aria-label="About the design heat loss">ⓘ</button>
      </h3>
      {info && (
        <div className="rp-note">
          <p>
            The heat each room loses, steadily, at the design outdoor temperature with no sun and no one in it: the
            standard calculation for sizing heat emitters (MCS MIS 3005-D). Walls, roofs, floors and windows lose heat by
            their U-values, the bridging by the building's thermal bridging, and a floor on the ground to the ground's
            temperature, the weather file's average over the year. Air leaks at the room's own rate, permanent vents at
            the stated wind speed, and ventilation at its full flow after any heat recovery. A room with an outside wall
            gets at least 0.5 air changes an hour. Heat to a room at a different temperature is counted in both rooms,
            and cancels in the building total. An unheated room is shown, but is not in the total.
          </p>
          <p>
            The U-values take each room's surfaces to be at the room's temperature, as the standard method does. In a room
            heated only by warm air, the surfaces sit colder and less heat crosses them, so this figure is on the safe side
            by up to about a tenth (checked against EnergyPlus). The further ground factors and the reheat table of BS EN
            12831-1 are not used. A warm-up allowance, when stated, is added per m² of floor.
          </p>
        </div>
      )}
      {!d.ok ? (
        <div className="rp-missing"><p>To work out the design heat loss:</p><ul>{d.missing.map((m) => <li key={m.path}>{m.what}</li>)}</ul></div>
      ) : (
        <>
          <p className="es-sum">
            {kw(d.building_w)} kW for the building, at {deg(d.outdoor_c)} °C outside ({OUTDOOR_WORDS[d.outdoor_source]}).
          </p>
          <ul className="es-zones">
            {d.zones.map((z) => (
              <li key={z.id} className="es-zone">
                <div className="es-zone-head">
                  <strong>{z.name}</strong>
                  <span>{kw(z.total_w)} kW</span>
                </div>
                <p className="es-line">
                  {whole(z.w_per_m2)} W/m² at {deg(z.internal_c)} °C{z.heated ? '' : ', not heated: not in the total'}.{' '}
                  <button type="button" className="rp-info" aria-expanded={open === z.id} onClick={() => setOpen(open === z.id ? null : z.id)}>
                    {open === z.id ? 'Hide terms' : 'Terms'}
                  </button>
                </p>
                {open === z.id && (
                  <table className="rp-table es-compare">
                    <tbody>
                      {z.terms.filter((t) => t.w !== 0).map((t) => (
                        <tr key={t.term}><td>{DESIGN_TERM_WORDS[t.term]}</td><td>{kw(t.w)} kW</td></tr>
                      ))}
                      <tr><td><strong>Total</strong></td><td><strong>{kw(z.total_w)} kW</strong></td></tr>
                    </tbody>
                  </table>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
