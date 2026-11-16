/**
 * Brief 108 Part 5: each zone's emitters against the heat it needs, from the run's summary (Brief 108 Part 4).
 *
 * Shown inside the results panel when any zone states emitters; the editor places it with one line,
 * `<EmitterSizing summary={summary} whatIf={whatIf} onWhatIf={setWhatIf} />`, and passes `whatIf` to the run
 * (`client.run(doc, delay, { what_if: whatIf })`). It owns nothing of the editor's.
 *
 * Per zone: what the emitters give at the design temperatures against the peak, the shortfall, the hours below the
 * setpoint and the lowest temperature, and the rating that would cover the peak. A second flow and return pair runs the
 * same rooms again and shows beside the first. Every figure is the engine's (Rule 1); the basis is behind ⓘ.
 *
 * Brief 117 Part 3: when the building states its design conditions, a switch shows the emitters against each room's
 * design heat loss (for sizing, the standard calculation) or against the year-round check above (the coldest hour of
 * the weather file, and how the rooms then run). Without design conditions the year-round check is shown alone, with
 * one line saying what to state.
 *
 * Brief 119: zones whose units cool (fan coils, VRF indoor units) show their cooling against the cooling peak, the
 * hours above the cooling setpoint and the highest temperature, below the heating zones.
 */
import { useState } from 'react'
import type { CoolingZone, DesignZoneSummary, EmitterZone, Summary, WhatIf } from './seam'
import './emitters.css'

const kw = (w: number) => (w / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** A shortfall: a few watts still counts as short (the zone does dip), so it never reads "0.0 kW". */
const shortKw = (w: number) => (w > 0 && w < 50 ? 'under 0.1' : kw(w))
const mwh = (kwh: number) => (kwh / 1000).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const whole = (w: number) => Math.round(w).toLocaleString('en-GB')
const deg = (c: number) => c.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const pair = (z: EmitterZone) => (z.design ? `${z.design.flow_c}/${z.design.return_c} °C` : 'their stated output')

type Mode = 'design' | 'year'
/** Brief 117: a zone's emitters against its design heat loss, in the shape the zone block reads (no hours: a steady figure). */
const asZone = (z: DesignZoneSummary, s: NonNullable<DesignZoneSummary['emitters']>): EmitterZone =>
  ({ ...s, id: z.id, name: z.name, unmet_hours: null, min_c: z.internal_c, in_use: false, hours_at_cap: 0 })

function ZoneBlock({ z, other, mode }: { z: EmitterZone; other: EmitterZone | null; mode: Mode }) {
  const short = z.shortfall_w > 0
  const need = mode === 'design' ? 'the design heat loss' : 'the peak need'
  const at = mode === 'design' && z.design ? ` with the room at ${deg(z.design.room_c)} °C` : ''
  return (
    <li className={short ? 'es-zone es-short' : 'es-zone'}>
      <div className="es-zone-head">
        <strong>{z.name}</strong>
        <span>{short ? `${shortKw(z.shortfall_w)} kW short` : 'enough'}</span>
      </div>
      <div className="es-bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (z.cap_w / Math.max(z.peak_w, z.cap_w, 1)) * 100)}%` }} />
      </div>
      {/* With a second pair the table says it; the sentences are for one pair. */}
      {!other && <p className="es-line">Emitters give {kw(z.cap_w)} kW at {pair(z)}{at}; {need} is {kw(z.peak_w)} kW.</p>}
      {!other && short && mode === 'year' && (
        <p className="es-line">
          {z.unmet_hours ?? 0} hours {z.in_use ? 'in use' : 'a year'} more than 0.5 °C below the setpoint; lowest {z.in_use ? 'in use ' : ''}{deg(z.min_c)} °C.
        </p>
      )}
      {z.needed_rated_w != null && z.design && (
        <p className="es-line es-need">
          {short ? `Needs ${shortKw(z.shortfall_w)} kW more at ${pair(z)}: ` : 'At these temperatures, '}
          {kw(z.needed_rated_w)} kW rated at ΔT 50 (75/65/20 °C){z.rated_now_w != null ? `, against ${kw(z.rated_now_w)} kW there now` : ''}.
        </p>
      )}
      {z.catalogue && (
        <p className="es-line es-need">
          From {z.catalogue.title}: add {z.catalogue.count} × {z.catalogue.height_mm} × {z.catalogue.length_mm} mm {z.catalogue.type.split(' (')[0]}
          {' '}({whole(z.catalogue.output_w)} W each at ΔT 50) for the {whole(z.catalogue.extra_rated_w)} W still needed.
        </p>
      )}
      {z.note && <p className="es-line es-muted">{z.note}</p>}
      {z.unlisted_systems.length > 0 && (
        <p className="es-line es-muted">
          Also heated by {z.unlisted_systems.map((n) => `"${n}"`).join(' and ')}, with no emitters listed here: the room gets only what the listed emitters give.
        </p>
      )}
      {other && (
        <table className="rp-table es-compare">
          <thead><tr><th /><th>{pair(z)}</th><th>{pair(other)}</th></tr></thead>
          <tbody>
            <tr><td>{mode === 'design' ? 'Design heat loss' : 'Peak need'}</td><td>{kw(z.peak_w)} kW</td><td>{kw(other.peak_w)} kW</td></tr>
            <tr><td>Emitters give</td><td>{kw(z.cap_w)} kW</td><td>{kw(other.cap_w)} kW</td></tr>
            <tr><td>Short</td><td>{shortKw(z.shortfall_w)} kW</td><td>{shortKw(other.shortfall_w)} kW</td></tr>
            {mode === 'year' && <tr><td>{z.in_use ? 'Hours below in use' : 'Hours below'}</td><td>{z.unmet_hours ?? 0}</td><td>{other.unmet_hours ?? 0}</td></tr>}
            {mode === 'year' && <tr><td>{z.in_use ? 'Lowest in use' : 'Lowest'}</td><td>{deg(z.min_c)} °C</td><td>{deg(other.min_c)} °C</td></tr>}
            {z.needed_rated_w != null && other.needed_rated_w != null && (
              <tr><td>Rating needed</td><td>{kw(z.needed_rated_w)} kW</td><td>{kw(other.needed_rated_w)} kW</td></tr>
            )}
          </tbody>
        </table>
      )}
    </li>
  )
}

function CoolingBlock({ z }: { z: CoolingZone }) {
  const short = z.shortfall_w > 0
  return (
    <li className={short ? 'es-zone es-short' : 'es-zone'}>
      <div className="es-zone-head">
        <strong>{z.name}</strong>
        <span>{short ? `${shortKw(z.shortfall_w)} kW short` : 'enough'}</span>
      </div>
      <div className="es-bar es-bar-cool" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (z.cap_w / Math.max(z.peak_w, z.cap_w, 1)) * 100)}%` }} />
      </div>
      <p className="es-line">Units give {kw(z.cap_w)} kW of cooling; the peak need is {kw(z.peak_w)} kW.</p>
      {(short || z.unmet_hours > 0) && (
        <p className="es-line">
          {z.unmet_hours} hours {z.in_use ? 'in use' : 'a year'} more than 0.5 °C above the setpoint; highest {deg(z.max_c)} °C.
        </p>
      )}
    </li>
  )
}

export function EmitterSizing({ summary, whatIf, onWhatIf }: { summary: Summary; whatIf: WhatIf | null; onWhatIf: (w: WhatIf | null) => void }) {
  const [info, setInfo] = useState(false)
  const [flow, setFlow] = useState(String(whatIf?.design_flow_c ?? 70))
  const [ret, setRet] = useState(String(whatIf?.design_return_c ?? 60))
  const em = summary.emitters
  const dh = summary.design_heat_loss
  const [mode, setMode] = useState<Mode>(dh?.ok ? 'design' : 'year')
  if (!em) return null
  const wi = em.what_if
  const cooling = em.cooling
  const coolShort = cooling.filter((z) => z.shortfall_w > 0).length
  // Brief 117: in the design view the zones are the design heat loss's, with the same what-if pair rated alongside.
  const design = dh?.ok ? dh.zones.filter((z) => z.emitters) : null
  const showDesign = mode === 'design' && design != null
  const zones = showDesign ? design!.map((z) => asZone(z, z.emitters!)) : em.zones
  const others = showDesign
    ? (wi?.ok && design!.every((z) => z.what_if_emitters) ? design!.map((z) => asZone(z, z.what_if_emitters!)) : null)
    : (wi?.ok ? wi.zones : null)
  const shortCount = zones.filter((z) => z.shortfall_w > 0).length
  const f = Number(flow), r = Number(ret)
  const valid = flow.trim() !== '' && ret.trim() !== '' && Number.isFinite(f) && Number.isFinite(r) && f >= r
  // Review F6: one heading only when every zone's emitters run at one pair; otherwise "as designed".
  const pairs = new Set(zones.filter((z) => z.design).map((z) => `${z.design!.flow_c}/${z.design!.return_c} °C`))
  const baseHead = pairs.size === 1 ? [...pairs][0] : 'As designed'
  const unmetAt = (zs: EmitterZone[]) => zs.reduce((a, z) => a + (z.unmet_hours ?? 0), 0)

  return (
    <section className="es" aria-label="Emitters">
      <h3>
        Emitters <i>estimate</i>
        <button type="button" className="rp-info" aria-expanded={info} onClick={() => setInfo((v) => !v)} aria-label="About the emitter figures">ⓘ</button>
      </h3>
      {info && showDesign && (
        <p className="rp-note">
          Each zone's emitters are rated to EN 442 at their heating system's flow and return temperatures, with the room at
          its design temperature, against the room's design heat loss: the standard steady calculation for sizing, at the
          design outdoor temperature with no sun and no one in it (see Design heat loss). The rating needed is what would
          cover it at those temperatures, given at 75/65/20 °C as catalogues list it. The year-round check shows how the
          rooms run over the weather file's year with the emitters as they are.
        </p>
      )}
      {info && !showDesign && (
        <p className="rp-note">
          Each zone's emitters are rated to EN 442 at their heating system's flow and return temperatures, in the room at
          its heating setpoint. The peak need is the zone's highest hourly heat with its emitters unlimited, heated to its
          setpoint at every hour: a night setback is left out, so the emitters are not sized for warming up from it (the
          heating hours show how long that takes with the emitters as they are). Where the
          emitters give less, the zone runs colder and the hours more than 0.5 °C below the setpoint are counted (for a
          zone heated to hours, the hours in use). The
          rating needed is what would cover the peak at those temperatures, given at 75/65/20 °C as catalogues list it.
          Each hour, wet emitters are re-rated at how warm the room is, at their design water flow: a colder room draws
          more from the same radiators. That is checked against EnergyPlus's hot-water radiator (the coldest hour within
          0.2 K, and the same rise over a fixed output). The peak is the coldest hour of the chosen weather file, not a design-day
          calculation (BS EN 12831). The emitters' radiant share changes the heat needed: its annual heat is checked against
          EnergyPlus (within 4 %), its hours below are not yet. A heat pump's efficiency does not yet change with the flow temperature.
        </p>
      )}
      {info && zones.some((z) => z.catalogue) && (
        <p className="rp-note">
          Where a room's radiators were picked from a catalogue, the suggestion is that catalogue's smallest radiator at the
          same height that adds the rating still needed (or the fewest of its largest), with the outputs as the catalogue
          prints them at ΔT 50. Stelrad Vita Compact: the maker's published table, EN 442 tested.
        </p>
      )}
      {info && cooling.length > 0 && (
        <p className="rp-note">
          Cooling units (fan coils, VRF indoor units) give their stated sensible cooling, held the same in every hour; moisture
          removal is not counted. The peak need is the zone's highest hourly cooling with its units unlimited. Where the units
          give less, the zone runs warmer and the hours more than 0.5 °C above the cooling setpoint are counted. Checked
          against EnergyPlus: its cooling need is about 5 % above EnergyPlus's (a gap not yet explained), so with units well
          below the need (about 55 %) it counts about a quarter more of those hours (379 against 299), and nearer the need
          about 20 more a year (51 against 33 at 78 %). The highest temperature reads up to about 0.9 °C above EnergyPlus's.
          For a zone cooled to hours, the hours and the highest temperature are of the hours in use.
        </p>
      )}
      {zones.length > 0 && (design != null ? (
        <div className="es-mode" role="group" aria-label="Size against">
          <button type="button" className="rp-btn" aria-pressed={showDesign} onClick={() => setMode('design')}>Design heat loss</button>
          <button type="button" className="rp-btn" aria-pressed={!showDesign} onClick={() => setMode('year')}>Year-round check</button>
        </div>
      ) : (
        <p className="es-line es-muted">
          {dh && !dh.ok ? 'For the design heat loss, see what it still needs above.' : 'To size against a design heat loss, state the design outdoor temperature.'}
        </p>
      ))}
      {zones.length > 0 && <p className="es-sum">
        {shortCount === 0 ? `All ${zones.length} zones with emitters have enough output${showDesign ? ' for their design heat loss' : ''}.` : `${shortCount} of ${zones.length} zones with emitters are short of output${showDesign ? ' for their design heat loss' : ''}.`}
      </p>}

      {zones.length > 0 && <form className="es-whatif" onSubmit={(e) => { e.preventDefault(); if (valid) onWhatIf({ design_flow_c: f, design_return_c: r }) }}>
        <span className="rp-label">Compare at another flow / return</span>
        <span className="es-hint">Every heating system with flow and return temperatures moves to this pair; the systems and their efficiency stay as they are.</span>
        <label>Flow <input type="number" inputMode="decimal" value={flow} onChange={(e) => setFlow(e.target.value)} aria-label="Flow temperature, °C" /> °C</label>
        <label>Return <input type="number" inputMode="decimal" value={ret} onChange={(e) => setRet(e.target.value)} aria-label="Return temperature, °C" /> °C</label>
        <button type="submit" className="rp-btn" disabled={!valid}>Compare</button>
        {whatIf && <button type="button" className="rp-btn" onClick={() => onWhatIf(null)}>Clear</button>}
      </form>}
      {wi && !wi.ok && (
        <div className="rp-missing"><p>{wi.flow_c}/{wi.return_c} °C cannot be compared:</p><ul>{wi.missing.map((m) => <li key={m.path}>{m.what}</li>)}</ul></div>
      )}
      {wi?.ok && !showDesign && (
        <table className="rp-table es-compare es-building">
          <thead><tr><th>Building</th><th>{baseHead}</th><th>{wi.flow_c}/{wi.return_c} °C</th></tr></thead>
          <tbody>
            <tr><td>Zones short</td><td>{shortCount}</td><td>{wi.zones.filter((z) => z.shortfall_w > 0).length}</td></tr>
            <tr><td>Heating delivered</td><td>{mwh(summary.building.heating_kwh)} MWh</td><td>{mwh(wi.heating_kwh)} MWh</td></tr>
            {summary.energy?.ok && wi.energy?.ok && (
              <tr><td>Energy used</td><td>{mwh(summary.energy.total_kwh)} MWh</td><td>{mwh(wi.energy.total_kwh)} MWh</td></tr>
            )}
          </tbody>
        </table>
      )}
      {/* Review F3: less energy at a pair where rooms run cold is heat not delivered, never a saving. */}
      {wi?.ok && !showDesign && (unmetAt(em.zones) > 0 || unmetAt(wi.zones) > 0) && (
        <p className="es-line es-warn">
          {[unmetAt(em.zones) > 0 ? baseHead : null, unmetAt(wi.zones) > 0 ? `${wi.flow_c}/${wi.return_c} °C` : null].filter(Boolean).join(' and ')}: less heat
          is delivered because rooms run colder. Lower energy there is not a saving.
        </p>
      )}

      <ul className="es-zones">
        {zones.map((z, i) => <ZoneBlock key={z.id} z={z} other={others ? others[i] : null} mode={showDesign ? 'design' : 'year'} />)}
      </ul>
      {em.cooling_unstated.length > 0 && (
        <p className="es-line es-muted">
          {em.cooling_unstated.map((z) => z.name).join(', ')}: {em.cooling_unstated.length === 1 ? 'its units state' : 'their units state'} no
          cooling output, so {em.cooling_unstated.length === 1 ? 'its' : 'their'} cooling is not limited. State the cooling per unit to check it.
        </p>
      )}
      {cooling.length > 0 && (
        <>
          <h4 className="es-sub">Cooling</h4>
          <p className="es-sum">
            {coolShort === 0 ? `All ${cooling.length} zones with cooling units have enough cooling.` : `${coolShort} of ${cooling.length} zones with cooling units are short of cooling.`}
          </p>
          <ul className="es-zones">{cooling.map((z) => <CoolingBlock key={z.id} z={z} />)}</ul>
        </>
      )}
    </section>
  )
}
