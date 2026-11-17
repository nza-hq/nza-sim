/**
 * A profile's day at a glance, drawn by today's `MiniProfile` (Brief 110b P2: reused, not redrawn). Weekday first, then
 * the weekend day when it differs. Drawn from the profile's own 24 values, nothing smoothed.
 */
// @ts-expect-error untyped JS from today's app
import MiniProfile from '../../components/modules/gains/MiniProfile.jsx'
// @ts-expect-error untyped JS from today's app
import { INTERNAL_COLOURS } from '../../data/balanceColours.js'

const ACCENT: Record<string, string> = { Occupancy: INTERNAL_COLOURS.people, Lighting: INTERNAL_COLOURS.lighting, Equipment: INTERNAL_COLOURS.equipment }
const same = (a?: number[], b?: number[]) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i])

// MiniProfile reads an all-zero day as "no schedule set"; here such a day is a real one with nothing in it.
function Day({ d, accent, label, onEdit }: { d: number[]; accent: string; label: string; onEdit?: () => void }) {
  if (d.every((v) => v === 0)) return <p className="ap-spark-zero">{label}: none all day{onEdit && <> <button type="button" className="ap-link" onClick={onEdit}>Edit →</button></>}</p>
  return <MiniProfile schedule={{ weekday: d }} accent={accent} label={label} onEdit={onEdit} />
}

/** `onEdit`: opens the profile in today's schedule pop-out (the day charts then say "Edit →"). */
export default function Spark({ days, label, onEdit }: { days: { weekday: number[]; saturday?: number[]; sunday?: number[] } | null; label: string; onEdit?: () => void }) {
  if (!days) return null
  const accent = ACCENT[label] ?? '#EA580C'
  const weekend = [['Saturday', days.saturday], ['Sunday', days.sunday]].filter(([, d]) => d && (d as number[]).length === 24 && !same(d as number[], days.weekday)) as [string, number[]][]
  return (
    <figure className="ap-spark" aria-label={`${label}: the day's profile`}>
      <Day d={days.weekday} accent={accent} label={`${label}, weekday`} onEdit={onEdit} />
      {weekend.length === 2 && same(weekend[0]![1], weekend[1]![1])
        ? <Day d={weekend[0]![1]} accent={accent} label={`${label}, weekend`} onEdit={onEdit} />
        : weekend.map(([n, d]) => <Day key={n} d={d} accent={accent} label={`${label}, ${n}`} onEdit={onEdit} />)}
    </figure>
  )
}
