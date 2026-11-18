/**
 * A temperature profile's editor (Brief 121 P4; Linzie, 17 Nov 00:31: "Aren't temperature set points a profile?").
 * °C for each hour of a weekday, a Saturday and a Sunday, the way IES draws a daily profile: drag across the bars to
 * paint a temperature, type one hour exactly, or set the whole day as "in use from … to … at …, otherwise …".
 *
 * Today's schedule editor draws fractions (0 to 1) and is left as it is; this one draws °C. No monthly layer: the
 * model document has none for temperatures. Nothing here is a default: every value is one the person set or the
 * library profile it was copied from.
 */
import { useRef, useState } from 'react'

type Days = { weekday: number[]; saturday: number[]; sunday: number[] }
type Day = keyof Days
const DAYS: Array<{ key: Day; name: string }> = [
  { key: 'weekday', name: 'Weekday' },
  { key: 'saturday', name: 'Saturday' },
  { key: 'sunday', name: 'Sunday' },
]
const TOP = 30 // °C at the top of the chart
const W = 24 * 26, H = 180, PAD = 22

export default function TempProfileEditor({ days, onChange, title, line, accent }: { days: Days; onChange: (d: Days) => void; title: string; line: string; accent: string }) {
  const [day, setDay] = useState<Day>('weekday')
  const [hour, setHour] = useState<number | null>(null)
  const [quick, setQuick] = useState({ from: '', to: '', on: '', off: '' })
  const drag = useRef<number | null>(null)
  const vals = days[day]
  const all = [...days.weekday, ...days.saturday, ...days.sunday]
  const hi = Math.max(...all), lo = Math.min(...all)
  const set = (d: Day, xs: number[]) => onChange({ ...days, [d]: xs })
  const at = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * (H + PAD)
    const h = Math.max(0, Math.min(23, Math.floor(x / 26)))
    const v = Math.round(Math.max(0, Math.min(TOP, (1 - y / H) * TOP)) * 2) / 2
    return { h, v }
  }
  const paint = (h: number, v: number) => { const xs = [...vals]; xs[h] = v; set(day, xs) }
  const n = (s: string) => (s.trim() === '' ? NaN : Number(s))
  const qf = n(quick.from), qt = n(quick.to), qon = n(quick.on), qoff = n(quick.off)
  const quickOk = Number.isInteger(qf) && Number.isInteger(qt) && qf >= 0 && qt <= 24 && qf < qt && Number.isFinite(qon) && Number.isFinite(qoff)
  return (
    <div className="tp-root" style={{ '--tp-acc': accent } as React.CSSProperties}>
      <div className="tp-head">
        <h3>{title}</h3>
        <p>{line}</p>
        <p className="tp-range">In use {hi} °C · lowest {lo} °C</p>
      </div>
      <div className="tp-tabs" role="tablist" aria-label="Day">
        {DAYS.map((d) => <button key={d.key} type="button" role="tab" aria-selected={day === d.key} onClick={() => setDay(d.key)}>{d.name}</button>)}
      </div>
      <svg className="tp-chart" viewBox={`0 0 ${W} ${H + PAD}`} role="img" aria-label={`${title}, ${day}: °C by hour`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const { h, v } = at(e); drag.current = v; setHour(h); paint(h, v) }}
        onPointerMove={(e) => { if (drag.current == null) return; const { h } = at(e); if (vals[h] !== drag.current) paint(h, drag.current); setHour(h) }}
        onPointerUp={() => { drag.current = null }}>
        {[0, 10, 20, 30].map((t) => <line key={t} x1={0} x2={W} y1={H - (t / TOP) * H} y2={H - (t / TOP) * H} className="tp-grid" />)}
        {vals.map((v, h) => {
          const y = H - (Math.max(0, Math.min(TOP, v)) / TOP) * H
          return (
            <g key={h}>
              <rect x={h * 26 + 2} y={y} width={22} height={H - y} className={`tp-bar${hour === h ? ' on' : ''}`} />
              <text x={h * 26 + 13} y={y - 3} className="tp-val">{v}</text>
              {h % 3 === 0 && <text x={h * 26 + 2} y={H + 15} className="tp-ax">{String(h).padStart(2, '0')}</text>}
            </g>
          )
        })}
        {[10, 20, 30].map((t) => <text key={t} x={W - 2} y={H - (t / TOP) * H + 10} className="tp-ax tp-axr">{t} °C</text>)}
      </svg>
      <div className="tp-row">
        {hour != null && (
          <label>{String(hour).padStart(2, '0')}:00 to {String(hour + 1).padStart(2, '0')}:00
            <input type="number" step={0.5} min={0} max={40} value={vals[hour]} aria-label={`°C at ${hour}:00`} onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) paint(hour, v) }} /> °C
          </label>
        )}
        <span className="tp-hint">Drag across the bars to paint a temperature, or tap one hour and type it.</span>
      </div>
      <div className="tp-quick">
        <span>Set the {DAYS.find((d) => d.key === day)!.name.toLowerCase()}: in use from</span>
        <input type="number" min={0} max={23} placeholder="hour" value={quick.from} aria-label="In use from (hour)" onChange={(e) => setQuick({ ...quick, from: e.target.value })} />
        <span>to</span>
        <input type="number" min={1} max={24} placeholder="hour" value={quick.to} aria-label="In use to (hour)" onChange={(e) => setQuick({ ...quick, to: e.target.value })} />
        <span>at</span>
        <input type="number" step={0.5} placeholder="°C" value={quick.on} aria-label="In use, °C" onChange={(e) => setQuick({ ...quick, on: e.target.value })} />
        <span>°C, otherwise</span>
        <input type="number" step={0.5} placeholder="°C" value={quick.off} aria-label="Otherwise, °C" onChange={(e) => setQuick({ ...quick, off: e.target.value })} />
        <span>°C</span>
        <button type="button" className="gl-btn" disabled={!quickOk} onClick={() => set(day, Array.from({ length: 24 }, (_, h) => (h >= qf && h < qt ? qon : qoff)))}>Set</button>
        <button type="button" className="gl-btn quiet" onClick={() => onChange({ weekday: [...days.weekday], saturday: [...days.weekday], sunday: [...days.weekday] })}>Copy weekday to Saturday and Sunday</button>
      </div>
    </div>
  )
}
