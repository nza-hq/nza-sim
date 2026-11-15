/**
 * Sim2 geometry prototype: one outside wall drawn flat, seen from outside or from inside a room. The wall's room pieces
 * are marked (dashed lines where rooms meet, the room's name under each), the chosen piece or the whole wall is
 * outlined, and every window can be dragged along the wall (0.1 m steps; Shift for 0.01 m). A window that crosses into
 * the next room is drawn in red until it is moved clear.
 */
import { type PointerEvent as RPointerEvent, useState } from 'react'
import type { WallPiece } from './facade'
import type { Plan, Span, WallRun, Win } from './plan'

type Props = {
  plan: Plan
  run: WallRun
  pieces: WallPiece[]
  span: Span
  whole: boolean
  crossers: Set<string>
  from: 'out' | 'in'
  setFrom: (f: 'out' | 'in') => void
  width: number
  height: number
  roomName: (id: string) => string
  typeName: (span: Span) => string
  typeColour: (span: Span) => string | null
  onPick: (p: WallPiece | null) => void
  onMoved: (id: string, t: number) => void
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

export default function FacadeView({ plan, run, pieces, span, whole, crossers, from, setFrom, width, height, roomName, typeName, typeColour, onPick, onMoved }: Props) {
  const L = run.length_m
  const H = plan.storey_height_m
  const s = Math.max(4, Math.min((width - 120) / L, (height - 300) / H))
  const x0 = (width - L * s) / 2
  // The wall sits a little above the middle, clear of the heading.
  const base = Math.max(150 + H * s, (height + H * s) / 2 - 40)
  const X = (t: number) => (from === 'out' ? x0 + t * s : x0 + (L - t) * s)
  const Y = (z: number) => base - z * s
  const [drag, setDrag] = useState<{ id: string; t0: number; px: number; t: number } | null>(null)

  const wins: Win[] = plan.windows.filter((w) => w.wall === run.index).map((w) => (drag && w.id === drag.id ? { ...w, t_m: drag.t } : w))
  const down = (e: RPointerEvent, w: Win) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setDrag({ id: w.id, t0: w.t_m, px: e.clientX, t: w.t_m })
  }
  const move = (e: RPointerEvent) => {
    if (!drag) return
    const w = plan.windows.find((x) => x.id === drag.id)
    if (!w) return
    const st = e.shiftKey ? 0.01 : 0.1
    const d = ((e.clientX - drag.px) / s) * (from === 'out' ? 1 : -1)
    const t = Math.max(0, Math.min(L - w.width_m, Math.round((drag.t0 + d) / st) * st))
    setDrag({ ...drag, t })
  }
  const up = () => {
    if (!drag) return
    if (Math.abs(drag.t - drag.t0) > 1e-9) onMoved(drag.id, drag.t)
    setDrag(null)
  }
  const inRoom = !whole ? pieces.find((p) => Math.abs(p.t0 - span.t0) < 1e-6 && Math.abs(p.t1 - span.t1) < 1e-6) : undefined
  const dragged = drag ? wins.find((w) => w.id === drag.id) : undefined
  const dragPiece = dragged ? pieces.find((p) => dragged.t_m + dragged.width_m / 2 >= p.t0 && dragged.t_m + dragged.width_m / 2 <= p.t1) : undefined
  const lo = (a: number, b: number) => Math.min(X(a), X(b))

  return (
    <div className="gl-elevview">
      <div className="gl-elev-head">
        <b>Wall {run.index + 1}</b>
        <span>{from === 'out' ? 'seen from outside' : `seen from inside${inRoom ? ` ${roomName(inRoom.room)}` : ''}`}</span>
        <div className="gl-chips small" role="group" aria-label="Look from">
          <button type="button" aria-pressed={from === 'out'} onClick={() => setFrom('out')}>Outside</button>
          <button type="button" aria-pressed={from === 'in'} onClick={() => setFrom('in')}>Inside</button>
        </div>
      </div>
      <svg width={width} height={height} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <line x1={x0 - 40} x2={x0 + L * s + 40} y1={base} y2={base} className="gl-ev-ground" />
        {pieces.map((p, i) => {
          const on = whole || (Math.abs(p.t0 - span.t0) < 1e-6 && Math.abs(p.t1 - span.t1) < 1e-6)
          const col = typeColour(p)
          return (
            <g key={i} onPointerDown={() => onPick(p)} style={{ cursor: 'pointer' }}>
              <rect x={lo(p.t0, p.t1)} y={Y(H)} width={(p.t1 - p.t0) * s} height={H * s} className={`gl-ev-piece${on ? ' on' : ''}`} />
              {col && <rect x={lo(p.t0, p.t1)} y={base - 7} width={(p.t1 - p.t0) * s} height={7} fill={col} />}
              <text x={(X(p.t0) + X(p.t1)) / 2} y={base + 20} textAnchor="middle" className="gl-ev-room">{roomName(p.room)}</text>
              <text x={(X(p.t0) + X(p.t1)) / 2} y={base + 36} textAnchor="middle" className="gl-ev-sub">{f2(p.t1 - p.t0)} m · {typeName(p)}</text>
            </g>
          )
        })}
        {pieces.slice(1).map((p, i) => (
          <line key={`b${i}`} x1={X(p.t0)} x2={X(p.t0)} y1={Y(H) - 10} y2={base + 6} className="gl-ev-line" />
        ))}
        <rect x={lo(span.t0, span.t1)} y={Y(H)} width={(span.t1 - span.t0) * s} height={H * s} className="gl-ev-chosen" />
        {wins.map((w) => {
          const bad = crossers.has(w.id) || (dragged?.id === w.id && dragPiece && (w.t_m < dragPiece.t0 - 1e-3 || w.t_m + w.width_m > dragPiece.t1 + 1e-3))
          return (
            <g key={w.id} onPointerDown={(e) => down(e, w)} style={{ cursor: drag?.id === w.id ? 'grabbing' : 'grab' }}>
              {w.shading_m > 0 && <rect x={lo(w.t_m, w.t_m + w.width_m) - 4} y={Y(w.sill_m + w.height_m) - 4} width={w.width_m * s + 8} height={w.height_m * s + 8} className="gl-ev-shade" />}
              <rect x={lo(w.t_m, w.t_m + w.width_m)} y={Y(w.sill_m + w.height_m)} width={w.width_m * s} height={w.height_m * s} className={`gl-ev-win${bad ? ' bad' : ''}${drag?.id === w.id ? ' live' : ''}`} />
            </g>
          )
        })}
        {dragged && dragPiece && (() => {
          // How far the dragged window is from its room's ends.
          const a = dragged.t_m - dragPiece.t0
          const b = dragPiece.t1 - (dragged.t_m + dragged.width_m)
          const y = Y(dragged.sill_m + dragged.height_m) - 16
          const lab = (t0: number, t1: number, v: number) => (Math.abs(t1 - t0) > 1e-6 ? (
            <g>
              <line x1={X(t0)} x2={X(t1)} y1={y} y2={y} className="gl-ev-dim" />
              <text x={(X(t0) + X(t1)) / 2} y={y - 5} textAnchor="middle" className="gl-ev-dimtext">{f2(v)} m</text>
            </g>
          ) : null)
          return (
            <>
              {lab(dragPiece.t0, dragged.t_m, a)}
              {lab(dragged.t_m + dragged.width_m, dragPiece.t1, b)}
            </>
          )
        })()}
        <text x={x0 - 12} y={(Y(H) + base) / 2} textAnchor="end" className="gl-ev-sub">{f2(H)} m</text>
        <text x={(x0 + x0 + L * s) / 2} y={base + 62} textAnchor="middle" className="gl-ev-sub">{f2(L)} m long · {from === 'out' ? 'as seen from outside' : 'mirrored, as seen from inside'}</text>
      </svg>
    </div>
  )
}
