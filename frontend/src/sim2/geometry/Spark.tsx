/** A profile's day at a glance: weekday as a filled line, Saturday and Sunday dashed, 0 to 1 (or its own range for
 * temperatures). Drawn from the profile's own 24 values, nothing smoothed. */
export default function Spark({ days, label }: { days: { weekday: number[]; saturday?: number[]; sunday?: number[] } | null; label: string }) {
  if (!days) return null
  const W = 228, H = 44, P = 2
  const all = [days.weekday, days.saturday, days.sunday].filter((d): d is number[] => !!d && d.length === 24)
  const lo = Math.min(0, ...all.flat()), hi = Math.max(1, ...all.flat())
  const x = (h: number) => P + (h / 24) * (W - 2 * P)
  const y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P)
  // Step line: each hour holds its value for the hour.
  const path = (d: number[]) => d.map((v, h) => `${h ? 'L' : 'M'}${x(h).toFixed(1)},${y(v).toFixed(1)}H${x(h + 1).toFixed(1)}`).join('')
  return (
    <figure className="ap-spark" aria-label={`${label}: the day's profile`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img">
        <path d={`${path(days.weekday)}V${H - P}H${P}Z`} className="wk-fill" />
        <path d={path(days.weekday)} className="wk" />
        {days.saturday && <path d={path(days.saturday)} className="we" />}
        {days.sunday && <path d={path(days.sunday)} className="we sun" />}
      </svg>
      <figcaption><span>0h</span><span><i className="k wk" />weekday <i className="k we" />weekend</span><span>24h</span></figcaption>
    </figure>
  )
}
