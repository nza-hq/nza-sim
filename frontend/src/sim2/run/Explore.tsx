/**
 * Brief 127 P2 (Linzie 19 Nov 2026: "check and layer lots of different data points to see their outcome"): the results
 * explorer. Pick what (any hourly dataset the run holds: weather, building, systems, rooms), then how to draw it:
 *
 *   Lines           the datasets over a day, week, month or the year; one panel per unit, all on one time axis
 *                   (temperature and kW are never two scales on one chart)
 *   Carpet          one dataset, day of the year across, hour of the day down
 *   Typical day     each dataset's average hour by hour, for a month and a day type (weekday, Saturday, Sunday)
 *   Against outdoor each dataset against the outdoor temperature, by the day or by the hour
 *   Monthly         kWh a month for loads and energy; the monthly mean for temperatures
 *   Duration        the year's hours sorted from highest to lowest
 *
 * Every number is the run's own (series.ts gathers the engine's arrays; Rule 11). Here they are only averaged or summed
 * over the period drawn, and each view says which.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Series, SeriesSet, SeriesUnit } from './series'

type View = 'lines' | 'carpet' | 'typical' | 'outdoor' | 'monthly' | 'duration'
type Period = 'day' | 'week' | 'month' | 'year'
const VIEWS: [View, string][] = [['lines', 'Lines'], ['carpet', 'Carpet'], ['typical', 'Typical day'], ['outdoor', 'Against outdoor'], ['monthly', 'Monthly'], ['duration', 'Duration']]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTH_START = MONTH_DAYS.reduce<number[]>((a, n, i) => (a.push(i ? a[i - 1]! + MONTH_DAYS[i - 1]! : 0), a), [])
/** Eight categorical colours in a fixed order, checked for colour-blind separation as adjacent pairs (dataviz palette). */
const SLOTS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const MAX = SLOTS.length
const OUTDOOR = 'weather.dry_bulb'
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? (Math.abs(v) < 1e-9 ? 0 : v).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: d }) : '–')
const dayLabel = (set: SeriesSet, d: number) => { const h = d * 24; return `${DOW[set.day_of_week[h]!]} ${set.day_of_month[h]} ${MONTHS[set.month[h]! - 1]}` }
const UNIT_WORDS: Record<SeriesUnit, string> = { kW: 'kW', kWh: 'kWh', '°C': '°C', 'W/m²': 'W/m²', 'm/s': 'm/s', '%': '%', 'kg/h': 'kg/h', 'in use': 'in use (100 = yes)' }

function niceStep(span: number) { const p = 10 ** Math.floor(Math.log10(span / 4 || 1)); for (const m of [1, 2, 2.5, 5, 10]) if (span / (m * p) <= 5) return m * p; return 10 * p }
function extent(arrs: ArrayLike<number>[], zero: boolean): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const a of arrs) for (let i = 0; i < a.length; i++) { const v = a[i]!; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v } }
  if (!Number.isFinite(lo)) return [0, 1]
  if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi) }
  if (hi - lo < 1e-6) { hi = lo + 1 }
  const st = niceStep(hi - lo)
  return [Math.floor(lo / st) * st, Math.ceil(hi / st) * st]
}
const isLoad = (s: Series) => s.agg === 'energy'

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(700)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((e) => setW(Math.max(320, Math.floor(e[0]!.contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Default picks: the chosen room's heating, cooling and operative temperature, or the building's fuels; outdoor first. */
function defaults(set: SeriesSet, zone: string | null): string[] {
  const has = (id: string) => set.series.some((s) => s.id === id)
  const ids = [OUTDOOR]
  if (zone && has(`room.${zone}.heating`)) ids.push(`room.${zone}.operative`, `room.${zone}.heating`, `room.${zone}.cooling`)
  else { ids.push(...set.series.filter((s) => s.id.startsWith('building.fuel.')).map((s) => s.id)); if (ids.length === 1) ids.push('building.heating', 'building.cooling') }
  return ids.filter(has)
}

export function Explore({ set, focusZone }: { set: SeriesSet; focusZone: string | null }) {
  const byId = useMemo(() => new Map(set.series.map((s) => [s.id, s])), [set])
  const [picked, setPicked] = useState<string[]>(() => defaults(set, focusZone))
  const [view, setView] = useState<View>('lines')
  const [period, setPeriod] = useState<Period>('week')
  const [startDay, setStartDay] = useState(14)
  const [carpetId, setCarpetId] = useState<string | null>(null)
  const [month, setMonth] = useState(0)
  const [dayType, setDayType] = useState<'weekday' | 'saturday' | 'sunday'>('weekday')
  const [daily, setDaily] = useState(true)
  const [room, setRoom] = useState<string | null>(focusZone)
  // The chosen room on the left drives the defaults; the person's own picks are kept while they are still in the run.
  useEffect(() => { setRoom(focusZone); setPicked(defaults(set, focusZone)) }, [focusZone])
  useEffect(() => { setPicked((p) => { const k = p.filter((id) => byId.has(id)); return k.length ? k : defaults(set, focusZone) }) }, [byId])
  const sel = picked.map((id) => byId.get(id)).filter((s): s is Series => !!s)
  const colour = (id: string) => SLOTS[picked.indexOf(id) % MAX]!
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id]))
  const rooms = useMemo(() => { const m = new Map<string, string>(); for (const s of set.series) if (s.scope === 'room' && s.owner) m.set(s.owner, s.owner_name ?? s.owner); return [...m] }, [set])
  const systems = useMemo(() => { const m = new Map<string, string>(); for (const s of set.series) if (s.scope === 'system' && s.owner) m.set(s.owner, s.owner_name ?? s.owner); return [...m] }, [set])
  const groups: [string, Series[]][] = [
    ['Weather', set.series.filter((s) => s.scope === 'weather')],
    ['Whole building', set.series.filter((s) => s.scope === 'building')],
    ...systems.map(([id, name]): [string, Series[]] => [name, set.series.filter((s) => s.scope === 'system' && s.owner === id)]),
  ]
  const roomSeries = room ? set.series.filter((s) => s.scope === 'room' && s.owner === room) : []
  const outdoor = byId.get(OUTDOOR) ?? null
  const carpet = sel.find((s) => s.id === carpetId) ?? sel.find((s) => s.id !== OUTDOOR) ?? sel[0] ?? null

  const pick = (s: Series) => (
    <label key={s.id} className="ex-pick" title={s.from}>
      <input type="checkbox" checked={picked.includes(s.id)} disabled={!picked.includes(s.id) && picked.length >= MAX} onChange={() => toggle(s.id)} />
      <i style={{ background: picked.includes(s.id) ? colour(s.id) : 'transparent' }} />
      <span>{s.label} <small>{s.unit}</small></span>
    </label>
  )
  return (
    <div className="ex">
      <aside className="ex-side" aria-label="Datasets">
        <p className="ex-side-h">Room</p>
        <select className="ex-room" value={room ?? ''} onChange={(e) => setRoom(e.target.value || null)} aria-label="Room">
          <option value="">Choose a room…</option>
          {rooms.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        {roomSeries.map(pick)}
        {groups.map(([name, ss]) => ss.length > 0 && (
          <div key={name} className="ex-group"><p className="ex-side-h">{name}</p>{ss.map(pick)}</div>
        ))}
        <p className="ex-note">Up to {MAX} at once. Hover a name for where its numbers come from.</p>
      </aside>
      <div className="ex-main">
        <div className="lp-fuels" role="group" aria-label="View">
          {VIEWS.map(([v, l]) => <button key={v} type="button" className={`lp-chip${view === v ? ' on' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>{l}</button>)}
        </div>
        <div className="ex-legend">{sel.map((s) => (
          <button key={s.id} type="button" className="ex-tag" onClick={() => toggle(s.id)} title={`Remove · ${s.from}`}>
            <i style={{ background: colour(s.id) }} />{s.owner_name ? `${s.owner_name}: ` : ''}{s.label} <small>{s.unit}</small> ×
          </button>
        ))}</div>
        {sel.length === 0 ? <p className="gl-hint">Choose datasets on the left.</p>
          : view === 'lines' ? <Lines set={set} sel={sel} colour={colour} period={period} setPeriod={setPeriod} startDay={startDay} setStartDay={setStartDay} />
          : view === 'carpet' ? <Carpet set={set} sel={sel} s={carpet} colour={colour} onPick={setCarpetId} />
          : view === 'typical' ? <Typical set={set} sel={sel} colour={colour} month={month} setMonth={setMonth} dayType={dayType} setDayType={setDayType} />
          : view === 'outdoor' ? (outdoor ? <Outdoor set={set} sel={sel.filter((s) => s.id !== OUTDOOR)} outdoor={outdoor} colour={colour} daily={daily} setDaily={setDaily} /> : <p className="gl-hint">The run has no outdoor temperature.</p>)
          : view === 'monthly' ? <Monthly set={set} sel={sel} colour={colour} />
          : <Duration set={set} sel={sel} colour={colour} />}
      </div>
    </div>
  )
}

type Pane = { unit: SeriesUnit; series: Series[] }
const panes = (sel: Series[]): Pane[] => { const m = new Map<SeriesUnit, Series[]>(); for (const s of sel) m.set(s.unit, [...(m.get(s.unit) ?? []), s]); return [...m].map(([unit, series]) => ({ unit, series })) }

/** Stacked panels, one per unit, sharing x. `values(s)` gives what to draw for each series (already over the period). */
function Panels({ sel, colour, n, xLabel, xTicks, values, tip, bars = false, zeroFor = (u) => u === 'kW' }: {
  sel: Series[]; colour: (id: string) => string; n: number; xLabel?: string
  xTicks: { i: number; label: string }[]; values: (s: Series) => ArrayLike<number>
  tip: (i: number) => string; bars?: boolean; zeroFor?: (u: SeriesUnit) => boolean
}) {
  const [ref, W] = useWidth()
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const ps = panes(sel)
  const L = 52, R = 12, T = 8, gap = 22, B = xLabel ? 42 : 26, ph = Math.max(110, Math.min(220, 520 / ps.length))
  const Hh = T + ps.length * ph + (ps.length - 1) * gap + B, pw = W - L - R
  const X = (i: number) => (bars ? L + (i + 0.5) / n * pw : L + (n <= 1 ? 0 : i / (n - 1)) * pw)
  const vals = new Map(sel.map((s) => [s.id, values(s)]))
  return (
    <div ref={ref} className="ex-plot">
      <svg width={W} height={Hh} role="img" aria-label="Datasets"
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(), x = e.clientX - r.left; if (x < L || x > W - R) return setHover(null); const i = bars ? Math.floor((x - L) / pw * n) : Math.round((x - L) / pw * (n - 1)); setHover({ i: Math.max(0, Math.min(n - 1, i)), x: e.clientX - r.left, y: e.clientY - r.top }) }}
        onMouseLeave={() => setHover(null)}>
        {ps.map((p, pi) => {
          const y0 = T + pi * (ph + gap)
          const [lo, hi] = extent(p.series.map((s) => vals.get(s.id)!), zeroFor(p.unit) || bars)
          const Y = (v: number) => y0 + ph - (v - lo) / (hi - lo) * ph
          const st = niceStep(hi - lo), ticks: number[] = []
          for (let v = lo; v <= hi + st / 2; v += st) ticks.push(v)
          const k = p.series.length, bw = Math.max(1, pw / n / (k + 0.6))
          return (
            <g key={p.unit}>
              {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#ECE9E2" /><text x={L - 6} y={Y(v) + 4} textAnchor="end" className="ex-tick">{fmt(v, st < 1 ? 1 : 0)}</text></g>)}
              <text x={L + 4} y={y0 + 12} className="ex-unit">{UNIT_WORDS[p.unit]}</text>
              {lo < 0 && hi > 0 && <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke="#9CA3AF" />}
              {p.series.map((s, si) => {
                const v = vals.get(s.id)!
                if (bars) return <g key={s.id}>{Array.from({ length: n }, (_, i) => { const y = Y(Math.max(0, v[i]!)), y1 = Y(Math.min(0, v[i]!)); return Number.isFinite(v[i]!) ? <rect key={i} x={L + i / n * pw + (pw / n - bw * k) / 2 + si * bw} y={Math.min(y, y1)} width={Math.max(1, bw - 1)} height={Math.max(0.5, Math.abs(y1 - y))} rx={Math.min(2, bw / 3)} fill={colour(s.id)} /> : null })}</g>
                let d = '', pen = false
                for (let i = 0; i < n; i++) { const y = v[i]!; if (!Number.isFinite(y)) { pen = false; continue } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(y).toFixed(1)}`; pen = true }
                return <path key={s.id} d={d} fill="none" stroke={colour(s.id)} strokeWidth={n > 2000 ? 1 : 1.75} strokeLinejoin="round" />
              })}
            </g>
          )
        })}
        {xTicks.map((t) => <text key={t.i} x={X(t.i)} y={Hh - (xLabel ? 24 : 8)} textAnchor="middle" className="ex-tick">{t.label}</text>)}
        {xLabel && <text x={L + pw / 2} y={Hh - 6} textAnchor="middle" className="ex-tick">{xLabel}</text>}
        {hover && <line x1={X(hover.i)} x2={X(hover.i)} y1={T} y2={Hh - B} stroke="#6B7280" strokeDasharray="3 3" pointerEvents="none" />}
      </svg>
      {hover && (
        <div className="ex-tip" style={{ left: Math.min(hover.x + 14, W - 250), top: hover.y + 14 }}>
          <b>{tip(hover.i)}</b>
          {sel.map((s) => <span key={s.id}><i style={{ background: colour(s.id) }} />{s.owner_name ? `${s.owner_name}: ` : ''}{s.label} <b>{fmt(vals.get(s.id)![hover.i]!, 2)}</b> {s.unit === 'in use' ? '' : s.unit}</span>)}
        </div>
      )}
    </div>
  )
}

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`

function Lines({ set, sel, colour, period, setPeriod, startDay, setStartDay }: { set: SeriesSet; sel: Series[]; colour: (id: string) => string; period: Period; setPeriod: (p: Period) => void; startDay: number; setStartDay: (d: number) => void }) {
  const days = set.hours / 24
  const len = period === 'day' ? 1 : period === 'week' ? 7 : period === 'month' ? MONTH_DAYS[monthOf(startDay)]! : days
  const d0 = period === 'year' ? 0 : period === 'month' ? MONTH_START[monthOf(startDay)]! : Math.min(startDay, days - len)
  const a = d0 * 24, n = len * 24
  const ticks = period === 'year' ? MONTH_START.map((d, i) => ({ i: d * 24, label: MONTHS[i]! }))
    : period === 'day' ? [0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({ i: h, label: hourLabel(h) }))
    : Array.from({ length: len }, (_, k) => k).filter((k) => period === 'week' || k % 3 === 0).map((k) => ({ i: k * 24 + (period === 'week' ? 12 : 0), label: period === 'week' ? dayLabel(set, d0 + k) : String(set.day_of_month[(d0 + k) * 24]) }))
  const step = period === 'day' ? 1 : period === 'week' ? 7 : 30
  return (
    <>
      <div className="ex-bar">
        <div className="lp-fuels" role="group" aria-label="Period">
          {(['day', 'week', 'month', 'year'] as Period[]).map((p) => <button key={p} type="button" className={`lp-chip${period === p ? ' on' : ''}`} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p[0]!.toUpperCase() + p.slice(1)}</button>)}
        </div>
        {period !== 'year' && <>
          <button type="button" className="lp-chip" onClick={() => setStartDay(Math.max(0, startDay - step))} aria-label="Earlier">‹</button>
          <input type="range" min={0} max={days - 1} value={startDay} onChange={(e) => setStartDay(+e.target.value)} aria-label="Start day" className="ex-range" />
          <button type="button" className="lp-chip" onClick={() => setStartDay(Math.min(days - 1, startDay + step))} aria-label="Later">›</button>
          <span className="ex-when">{period === 'month' ? `${MONTHS[monthOf(startDay)]}` : period === 'day' ? dayLabel(set, d0) : `${dayLabel(set, d0)} to ${dayLabel(set, d0 + len - 1)}`}</span>
        </>}
      </div>
      <Panels sel={sel} colour={colour} n={n} xTicks={ticks.map((t) => ({ ...t, i: t.i }))} values={(s) => s.values.subarray(a, a + n)}
        tip={(i) => `${dayLabel(set, d0 + Math.floor(i / 24))}, ${hourLabel(i % 24)}`} />
      <p className="rp-none">Each hour's value from the 15-minute run{period === 'year' ? ' (8,760 hours: zoom to a month or week to read single hours)' : ''}.</p>
    </>
  )
}
const monthOf = (day: number) => { let m = 0; while (m < 11 && day >= MONTH_START[m + 1]!) m++; return m }

function Carpet({ set, sel, s, colour, onPick }: { set: SeriesSet; sel: Series[]; s: Series | null; colour: (id: string) => string; onPick: (id: string) => void }) {
  const [ref, W] = useWidth()
  const cv = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ d: number; h: number; x: number; y: number } | null>(null)
  const days = set.hours / 24, L = 48, T = 6, B = 24, ch = 11, pw = W - L - 8, cw = pw / days, Hh = T + 24 * ch + B
  const temp = s ? s.unit === '°C' : false
  const [lo, hi] = s ? extent([s.values], !temp && s.agg === 'energy') : [0, 1]
  useEffect(() => {
    const c = cv.current; if (!c || !s) return
    const dpr = window.devicePixelRatio || 1
    c.width = W * dpr; c.height = Hh * dpr; c.style.width = `${W}px`; c.style.height = `${Hh}px`
    const g = c.getContext('2d')!; g.scale(dpr, dpr); g.clearRect(0, 0, W, Hh)
    const col = colourScale(s, lo, hi, colour(s.id))
    for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) { g.fillStyle = col(s.values[d * 24 + h]!); g.fillRect(L + d * cw, T + h * ch, Math.ceil(cw), ch) }
    g.fillStyle = '#6B7280'; g.font = '11px Inter, system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle'
    for (const h of [0, 6, 12, 18, 23]) g.fillText(hourLabel(h), L - 6, T + (h + 0.5) * ch)
    g.textAlign = 'left'; g.textBaseline = 'top'
    MONTH_START.forEach((d, i) => { g.fillStyle = '#FFFFFF'; g.fillRect(L + d * cw, T, 1, 24 * ch); g.fillStyle = '#6B7280'; g.fillText(MONTHS[i]!, L + d * cw + 3, T + 24 * ch + 6) })
  }, [s, W, lo, hi, colour])
  if (!s) return null
  const col = colourScale(s, lo, hi, colour(s.id))
  return (
    <>
      {sel.length > 1 && <div className="lp-fuels" role="group" aria-label="Dataset">{sel.map((x) => <button key={x.id} type="button" className={`lp-chip${x.id === s.id ? ' on' : ''}`} onClick={() => onPick(x.id)}>{x.owner_name ? `${x.owner_name}: ` : ''}{x.label}</button>)}</div>}
      <div ref={ref} className="ex-plot">
        <canvas ref={cv} aria-label={`Carpet plot: ${s.label}`}
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left - L, y = e.clientY - r.top - T; if (x < 0 || y < 0 || x >= pw || y >= 24 * ch) return setHover(null); setHover({ d: Math.floor(x / cw), h: Math.floor(y / ch), x: e.clientX - r.left, y: e.clientY - r.top }) }}
          onMouseLeave={() => setHover(null)} />
        {hover && <div className="ex-tip" style={{ left: Math.min(hover.x + 14, W - 230), top: hover.y + 14 }}><b>{dayLabel(set, hover.d)}, {hourLabel(hover.h)}</b><span>{s.label} <b>{fmt(s.values[hover.d * 24 + hover.h]!, 2)}</b> {s.unit}</span></div>}
      </div>
      <div className="ex-ramp"><span>{fmt(lo, 1)}</span><span className="ex-ramp-bar" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => col(lo + (hi - lo) * t)).join(',')})` }} /><span>{fmt(hi, 1)} {s.unit}</span><span className="ex-ramp-l">{s.owner_name ? `${s.owner_name}: ` : ''}{s.label}</span></div>
      <p className="rp-none">One cell per hour of the year: weekends, holidays, warm-ups, setbacks and anything odd show as patterns.{temp ? ' Temperatures run blue (low) through grey to orange (high).' : ''}</p>
    </>
  )
}
function hex(c: string) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) }
function mix(a: number[], b: number[], t: number) { const k = Math.max(0, Math.min(1, t)); return `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * k)).join(',')})` }
function colourScale(s: Series, lo: number, hi: number, c: string) {
  const zero = hex('#F3F1EC')
  if (s.unit === '°C') { const cold = hex('#2a78d6'), warm = hex('#eb6834'), mid = (lo + hi) / 2; return (v: number) => (!Number.isFinite(v) ? '#FFFFFF' : v <= mid ? mix(cold, zero, (v - lo) / (mid - lo)) : mix(zero, warm, (v - mid) / (hi - mid))) }
  const base = hex(c), dark = base.map((v) => Math.round(v * 0.45))
  return (v: number) => { if (!Number.isFinite(v)) return '#FFFFFF'; const t = (v - lo) / (hi - lo || 1); if (Math.abs(v) < 1e-6 && lo >= 0) return mix(zero, zero, 0); return t < 0.65 ? mix(zero, base, 0.12 + t / 0.65 * 0.88) : mix(base, dark, (t - 0.65) / 0.35) }
}

function Typical({ set, sel, colour, month, setMonth, dayType, setDayType }: { set: SeriesSet; sel: Series[]; colour: (id: string) => string; month: number; setMonth: (m: number) => void; dayType: 'weekday' | 'saturday' | 'sunday'; setDayType: (d: 'weekday' | 'saturday' | 'sunday') => void }) {
  const days = useMemo(() => { const out: number[] = []; for (let d = 0; d < set.hours / 24; d++) { const h = d * 24, w = set.day_of_week[h]!; if (set.month[h]! - 1 === month && (dayType === 'weekday' ? w < 5 : dayType === 'saturday' ? w === 5 : w === 6)) out.push(d) } return out }, [set, month, dayType])
  const avg = (s: Series) => { const a = new Float64Array(24); for (let h = 0; h < 24; h++) { let t = 0, k = 0; for (const d of days) { const v = s.values[d * 24 + h]!; if (Number.isFinite(v)) { t += v; k++ } } a[h] = k ? t / k : NaN } return a }
  return (
    <>
      <div className="ex-bar">
        <div className="lp-fuels" role="group" aria-label="Day type">{(['weekday', 'saturday', 'sunday'] as const).map((d) => <button key={d} type="button" className={`lp-chip${dayType === d ? ' on' : ''}`} aria-pressed={dayType === d} onClick={() => setDayType(d)}>{d[0]!.toUpperCase() + d.slice(1)}</button>)}</div>
        <div className="lp-fuels" role="group" aria-label="Month">{MONTHS.map((m, i) => <button key={m} type="button" className={`lp-chip${month === i ? ' on' : ''}`} aria-pressed={month === i} onClick={() => setMonth(i)}>{m}</button>)}</div>
      </div>
      <Panels sel={sel} colour={colour} n={24} xTicks={[0, 3, 6, 9, 12, 15, 18, 21, 23].map((h) => ({ i: h, label: hourLabel(h) }))} values={avg} tip={(i) => `${hourLabel(i)}, average ${dayType} in ${MONTHS[month]}`} />
      <p className="rp-none">Each hour averaged over the {days.length} {dayType === 'weekday' ? 'weekdays' : `${dayType}s`} in {MONTHS[month]}.</p>
    </>
  )
}

function Outdoor({ set, sel, outdoor, colour, daily, setDaily }: { set: SeriesSet; sel: Series[]; outdoor: Series; colour: (id: string) => string; daily: boolean; setDaily: (d: boolean) => void }) {
  const [ref, W] = useWidth()
  const cv = useRef<HTMLCanvasElement>(null)
  const ps = panes(sel), L = 56, R = 12, T = 8, gap = 26, B = 40, ph = 200, Hh = T + ps.length * (ph + gap) - gap + B, pw = W - L - R
  const pts = useMemo(() => {
    const D = set.hours / 24
    const x = daily ? Float64Array.from({ length: D }, (_, d) => { let t = 0; for (let h = 0; h < 24; h++) t += outdoor.values[d * 24 + h]!; return t / 24 }) : Float64Array.from(outdoor.values)
    const ys = new Map(sel.map((s) => [s.id, daily ? Float64Array.from({ length: D }, (_, d) => { let t = 0, k = 0; for (let h = 0; h < 24; h++) { const v = s.values[d * 24 + h]!; if (Number.isFinite(v)) { t += v; k++ } } return isLoad(s) ? t : k ? t / k : NaN }) : Float64Array.from(s.values)]))
    return { x, ys }
  }, [set, sel, outdoor, daily])
  const [xlo, xhi] = extent([pts.x], false)
  useEffect(() => {
    const c = cv.current; if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = W * dpr; c.height = Hh * dpr; c.style.width = `${W}px`; c.style.height = `${Hh}px`
    const g = c.getContext('2d')!; g.scale(dpr, dpr); g.clearRect(0, 0, W, Hh)
    g.font = '11px Inter, system-ui, sans-serif'
    const X = (v: number) => L + (v - xlo) / (xhi - xlo) * pw
    ps.forEach((p, pi) => {
      const y0 = T + pi * (ph + gap)
      const [lo, hi] = extent(p.series.map((s) => pts.ys.get(s.id)!), p.unit === 'kW')
      const Y = (v: number) => y0 + ph - (v - lo) / (hi - lo) * ph, st = niceStep(hi - lo)
      g.strokeStyle = '#ECE9E2'; g.fillStyle = '#6B7280'; g.textAlign = 'right'; g.textBaseline = 'middle'
      for (let v = lo; v <= hi + st / 2; v += st) { g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.fillText(fmt(v, st < 1 ? 1 : 0), L - 6, Y(v)) }
      g.textAlign = 'left'; g.fillStyle = '#1F2937'; g.fillText(daily && p.unit === 'kW' ? 'kWh a day' : `${UNIT_WORDS[p.unit]}${daily ? ', daily mean' : ''}`, L + 4, y0 + 8)
      const r = daily ? 3 : 1.4
      for (const s of p.series) { g.fillStyle = colour(s.id); g.globalAlpha = daily ? 0.75 : 0.35; const y = pts.ys.get(s.id)!; for (let i = 0; i < y.length; i++) if (Number.isFinite(y[i]!)) { g.beginPath(); g.arc(X(pts.x[i]!), Y(y[i]!), r, 0, 7); g.fill() } g.globalAlpha = 1 }
    })
    g.fillStyle = '#6B7280'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'
    for (let v = xlo; v <= xhi; v += niceStep(xhi - xlo)) g.fillText(fmt(v, 0), X(v), Hh - 22)
    g.fillText(`Outdoor air temperature, °C${daily ? ' (daily mean)' : ''}`, L + pw / 2, Hh - 6)
  }, [pts, W, Hh, colour])
  return (
    <>
      <div className="lp-fuels" role="group" aria-label="Points">{[[true, 'One dot a day'], [false, 'One dot an hour']].map(([v, l]) => <button key={String(v)} type="button" className={`lp-chip${daily === v ? ' on' : ''}`} aria-pressed={daily === v} onClick={() => setDaily(v as boolean)}>{l as string}</button>)}</div>
      {sel.length === 0 ? <p className="gl-hint">Choose a dataset besides the outdoor temperature.</p> : <div ref={ref} className="ex-plot"><canvas ref={cv} aria-label="Against outdoor temperature" /></div>}
      <p className="rp-none">{daily ? 'Loads and energy as kWh each day; temperatures and other readings as the day\'s mean.' : 'Each hour of the year.'} Heating should rise as it gets colder and level off above a balance point: a day far from its line is worth a look.</p>
    </>
  )
}

function Monthly({ set, sel, colour }: { set: SeriesSet; sel: Series[]; colour: (id: string) => string }) {
  const by = (s: Series) => { const t = new Float64Array(12), k = new Float64Array(12); for (let h = 0; h < set.hours; h++) { const v = s.values[h]!; if (Number.isFinite(v)) { t[set.month[h]! - 1] += v; k[set.month[h]! - 1]++ } } return Float64Array.from(t, (x, m) => (isLoad(s) ? x : k[m] ? x / k[m]! : NaN)) }
  const asKwh = sel.map((s) => ({ ...s, unit: (isLoad(s) ? 'kWh' : s.unit) as SeriesUnit }))
  return (
    <>
      <Panels sel={asKwh} colour={colour} n={12} bars xTicks={MONTHS.map((m, i) => ({ i, label: m }))} values={(s) => by(sel.find((x) => x.id === s.id)!)} tip={(i) => MONTHS[i]!} zeroFor={() => true} />
      <p className="rp-none">Loads and energy as kWh each month (each hour's kW summed); temperatures and other readings as the month's mean.</p>
    </>
  )
}

function Duration({ set, sel, colour }: { set: SeriesSet; sel: Series[]; colour: (id: string) => string }) {
  const sorted = (s: Series) => Float32Array.from(s.values).filter((v) => Number.isFinite(v)).sort().reverse()
  return (
    <>
      <Panels sel={sel} colour={colour} n={set.hours} xTicks={[0, 2000, 4000, 6000, 8000].map((i) => ({ i, label: i.toLocaleString('en-GB') }))} xLabel="Hours of the year, highest first" values={sorted} tip={(i) => `The busiest ${(i + 1).toLocaleString('en-GB')} hours are at least`} />
      <p className="rp-none">Every hour of the year sorted from highest to lowest: how many hours a plant runs, and how close it comes to its size.</p>
    </>
  )
}
