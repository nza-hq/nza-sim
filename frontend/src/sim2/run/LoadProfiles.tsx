/**
 * Load profiles (17 Nov 2026; Linzie's end goal is hourly load profiles per system and fuel, to compare with meters):
 * the run's energy hour by hour, by end use and fuel, drawn with today's full-year chart (`FullYearChart`, the Results
 * module's load profile: daily totals, drag to zoom, hourly under two weeks). Numbers are the run's own
 * (`energy.hourly`, Rule 11); nothing is worked out here but kWh per hour from W per hour, and peaks.
 */
import { useMemo, useState } from 'react'
// @ts-expect-error untyped JS component from today's app (reused, not redrawn)
import { FullYearChart } from '../../components/modules/results/FullYearView.jsx'
import type { Summary } from './seam'

type Energy = Extract<NonNullable<Summary['energy']>, { ok: true }>

/** Today's load-profile colours where an end use matches (FullYearView ALL_SERIES), the rest from the Sankey's. */
const COLOUR: Record<string, string> = {
  heating: '#DC2626', cooling: '#00AEEF', lighting: '#ECB01F', small_power: '#8B5CF6', dhw: '#EC4899', fans: '#7C3AED',
  pumps: '#14B8A6', dhw_circulation: '#F472B6', auxiliary: '#4B5563',
}
/** An end use met by two fuels (a heat pump beside a boiler): the electric line in a second shade, so the two read apart. */
const SECOND: Record<string, string> = { heating: '#F97316', cooling: '#2563EB', dhw: '#BE185D' }
const WORDS: Record<string, string> = {
  heating: 'Heating', cooling: 'Cooling', dhw: 'Hot water', dhw_circulation: 'Hot water pump', pumps: 'Pumps', fans: 'Fans',
  lighting: 'Lighting', small_power: 'Small power', auxiliary: 'Other electrical',
}
const FUEL_WORDS: Record<string, string> = { electricity: 'electricity', gas: 'gas', oil: 'oil', biomass: 'biomass', district_heating: 'district heat', district_cooling: 'district cooling' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function when(h: number): string {
  let d = Math.floor(h / 24), m = 0
  while (m < 11 && d >= DAYS[m]!) { d -= DAYS[m]!; m++ }
  return `${d + 1} ${MONTHS[m]} ${String(h % 24).padStart(2, '0')}:00`
}

export function LoadProfiles({ energy }: { energy: Energy }) {
  const fuels = useMemo(() => [...new Set(energy.hourly.map((l) => l.fuel))], [energy])
  const [fuel, setFuel] = useState<string>('all')
  const { raw, series } = useMemo(() => {
    const raw: Record<string, number[]> = {}
    const series = energy.hourly.map((l) => {
      const key = `${l.end_use}_${l.fuel}`
      raw[key] = Array.from(l.w, (w) => w / 1000)
      const twoFuels = energy.hourly.filter((x) => x.end_use === l.end_use).length > 1
      return { key, label: `${WORDS[l.end_use] ?? l.end_use}${twoFuels ? ` (${FUEL_WORDS[l.fuel] ?? l.fuel})` : ''}`, color: (twoFuels && l.fuel === 'electricity' ? SECOND[l.end_use] : undefined) ?? COLOUR[l.end_use] ?? '#9CA3AF', fuel: l.fuel }
    })
    return { raw, series }
  }, [energy])
  // Each fuel's peak hour, kW: the sum of its end uses in that hour.
  const peaks = useMemo(() => fuels.map((f) => {
    const ls = energy.hourly.filter((l) => l.fuel === f)
    const H = ls[0]?.w.length ?? 0
    let peak = 0, at = 0, total = 0
    for (let h = 0; h < H; h++) { let s = 0; for (const l of ls) s += l.w[h]!; total += s; if (s > peak) { peak = s; at = h } }
    return { fuel: f, peak_kw: peak / 1000, at, mwh: total / 1e6, load_factor: peak > 0 ? total / (peak * H) : 0 }
  }), [energy, fuels])
  return (
    <div className="lp">
      <div className="lp-peaks">
        {peaks.map((p) => (
          <div key={p.fuel} className="lp-peak">
            <span className="rp-label">Peak {FUEL_WORDS[p.fuel] ?? p.fuel}</span>
            <span className="rp-metric">{p.peak_kw.toLocaleString('en-GB', { maximumFractionDigits: 1 })} <small>kW</small></span>
            <span className="rp-sub">{when(p.at)} · {p.mwh.toLocaleString('en-GB', { maximumFractionDigits: 1 })} MWh a year · load factor {Math.round(p.load_factor * 100)}%</span>
          </div>
        ))}
      </div>
      <div className="lp-fuels" role="group" aria-label="Fuel">
        {['all', ...fuels].map((f) => (
          <button key={f} type="button" className={`lp-chip${fuel === f ? ' on' : ''}`} aria-pressed={fuel === f} onClick={() => setFuel(f)}>
            {f === 'all' ? 'All energy' : (FUEL_WORDS[f] ?? f).replace(/^./, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>
      <FullYearChart rawData={raw} series={series} fuelFilter={fuel} />
      <p className="rp-none">Energy as the meters would see it (fuel drawn, after each system's efficiency), from the 15-minute run, summed to each hour. Each line adds up to its row in Energy used.</p>
    </div>
  )
}
