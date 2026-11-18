/**
 * Sim2 geometry prototype: one outside wall drawn flat, seen from outside or from inside a room. The wall's room pieces
 * are marked (dashed lines where rooms meet, the room's name under each), the chosen piece or the whole wall is
 * outlined. Any window can be dragged left, right, up or down (0.1 m steps; Shift for 0.01 m); a door slides along the
 * floor. Tap one to nudge it with the arrow keys, turn it into a door or a window, or remove it. A window that crosses
 * into the next room is drawn in red until it is moved clear.
 */
import { type PointerEvent as RPointerEvent, useEffect, useRef, useState } from 'react'
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
  onChange: (id: string, to: { t_m?: number; sill_m?: number; door?: boolean; width_m?: number; height_m?: number }) => void
  onRemove: (id: string) => void
  /** The sizes the card holds, used when one is turned into a door or a window. */
  doorSize: { width_m: number; height_m: number }
  windowSize: { width_m: number; height_m: number; sill_m: number }
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

export default function FacadeView({ plan, run, pieces, span, whole, crossers, from, setFrom, width, height, roomName, typeName, typeColour, onPick, onChange, onRemove, doorSize, windowSize }: Props) {
  const L = run.length_m
  const H = plan.storey_height_m
  // Fitted to the pane, then the person's zoom (scroll) and pan (right- or middle-drag) on top (Linzie, 17 Nov 10:03:
  // "the elevation view… I can't zoom in or out").
  const fit = Math.max(4, Math.min((width - 120) / L, (height - 300) / H))
  const [view, setView] = useState({ z: 1, dx: 0, dy: 0 })
  useEffect(() => setView({ z: 1, dx: 0, dy: 0 }), [run.index])
  const s = fit * view.z
  const x0 = (width - L * s) / 2 + view.dx
  // The wall sits a little above the middle, clear of the heading.
  const base = Math.max(150 + H * fit, (height + H * fit) / 2 - 40) + (H * s - H * fit) / 2 + view.dy
  const svgRef = useRef<SVGSVGElement | null>(null)
  const pan = useRef<{ px: number; py: number; dx: number; dy: number } | null>(null)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const cx = e.clientX - r.left, cy = e.clientY - r.top
      setView((v) => {
        const z = Math.max(0.5, Math.min(12, v.z * Math.exp(-e.deltaY * 0.0015)))
        if (z === v.z) return v
        // Keep the point under the cursor where it is.
        const k = z / v.z
        const ox = (width - L * fit * v.z) / 2 + v.dx, oy = Math.max(150 + H * fit, (height + H * fit) / 2 - 40) + (H * fit * v.z - H * fit) / 2 + v.dy
        const nox = cx - (cx - ox) * k, noy = cy - (cy - oy) * k
        return { z, dx: nox - (width - L * fit * z) / 2, dy: noy - Math.max(150 + H * fit, (height + H * fit) / 2 - 40) - (H * fit * z - H * fit) / 2 }
      })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [width, height, L, H, fit])
  const X = (t: number) => (from === 'out' ? x0 + t * s : x0 + (L - t) * s)
  const Y = (z: number) => base - z * s
  const [drag, setDrag] = useState<{ id: string; t0: number; z0: number; px: number; py: number; t: number; z: number; moved: boolean } | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const wins: Win[] = plan.windows.filter((w) => w.wall === run.index).map((w) => (drag && w.id === drag.id ? { ...w, t_m: drag.t, sill_m: drag.z } : w))
  const pick = picked ? plan.windows.find((w) => w.id === picked && w.wall === run.index) : undefined
  const down = (e: RPointerEvent, w: Win) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setDrag({ id: w.id, t0: w.t_m, z0: w.sill_m, px: e.clientX, py: e.clientY, t: w.t_m, z: w.sill_m, moved: false })
  }
  const move = (e: RPointerEvent) => {
    if (pan.current) { const p0 = pan.current; setView((v) => ({ ...v, dx: p0.dx + e.clientX - p0.px, dy: p0.dy + e.clientY - p0.py })); return }
    if (!drag) return
    const w = plan.windows.find((x) => x.id === drag.id)
    if (!w) return
    if (!drag.moved && Math.hypot(e.clientX - drag.px, e.clientY - drag.py) < 4) return
    const st = e.shiftKey ? 0.01 : 0.1
    const snap = (v: number) => Math.round(v / st) * st
    const d = ((e.clientX - drag.px) / s) * (from === 'out' ? 1 : -1)
    const t = Math.max(0, Math.min(L - w.width_m, snap(drag.t0 + d)))
    // Up or down too, for a window (a door stays on the floor).
    const z = w.door ? 0 : Math.max(0, Math.min(H - w.height_m, snap(drag.z0 - (e.clientY - drag.py) / s)))
    setDrag({ ...drag, t, z, moved: true })
  }
  const up = () => {
    if (pan.current) { pan.current = null; return }
    if (!drag) return
    if (!drag.moved) setPicked(drag.id)
    else if (Math.abs(drag.t - drag.t0) > 1e-9 || Math.abs(drag.z - drag.z0) > 1e-9) onChange(drag.id, { t_m: drag.t, sill_m: drag.z })
    setDrag(null)
  }
  // Arrow keys nudge the one tapped (0.1 m; Shift 0.01 m). Esc lets go of it.
  useEffect(() => {
    if (!pick) return
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return
      const st = e.shiftKey ? 0.01 : 0.1
      const along = from === 'out' ? 1 : -1
      if (e.key === 'Escape') {
        e.stopPropagation()
        return setPicked(null)
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        setPicked(null)
        return onRemove(pick.id)
      }
      const by = e.key === 'ArrowLeft' ? [-st * along, 0] : e.key === 'ArrowRight' ? [st * along, 0] : e.key === 'ArrowUp' ? [0, st] : e.key === 'ArrowDown' ? [0, -st] : null
      if (!by) return
      e.preventDefault()
      e.stopPropagation()
      onChange(pick.id, { t_m: Math.round((pick.t_m + by[0]!) * 1000) / 1000, ...(pick.door ? {} : { sill_m: Math.round((pick.sill_m + by[1]!) * 1000) / 1000 }) })
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [pick, from, onChange, onRemove])
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
      <svg ref={svgRef} width={width} height={height} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()}
        onPointerDownCapture={(e) => { if (e.button === 1 || e.button === 2) { e.stopPropagation(); e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); pan.current = { px: e.clientX, py: e.clientY, dx: view.dx, dy: view.dy } } }}>
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
              <rect x={lo(w.t_m, w.t_m + w.width_m)} y={Y(w.sill_m + w.height_m)} width={w.width_m * s} height={w.height_m * s} className={`gl-ev-win${w.door ? ' door' : ''}${bad ? ' bad' : ''}${drag?.id === w.id || pick?.id === w.id ? ' live' : ''}`} />
              {w.door && <circle cx={from === 'out' ? X(w.t_m + w.width_m) - 0.12 * s : X(w.t_m + w.width_m) + 0.12 * s} cy={Y(1.0)} r={Math.max(2, 0.04 * s)} className="gl-ev-handle" />}
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
          const sx = X(dragged.t_m + dragged.width_m / 2)
          return (
            <>
              {lab(dragPiece.t0, dragged.t_m, a)}
              {lab(dragged.t_m + dragged.width_m, dragPiece.t1, b)}
              {!dragged.door && dragged.sill_m > 1e-6 && (
                <g>
                  <line x1={sx} x2={sx} y1={Y(dragged.sill_m)} y2={base} className="gl-ev-dim" />
                  <text x={sx + 6} y={(Y(dragged.sill_m) + base) / 2 + 4} className="gl-ev-dimtext">sill {f2(dragged.sill_m)} m</text>
                </g>
              )}
            </>
          )
        })()}
        <text x={x0 - 12} y={(Y(H) + base) / 2} textAnchor="end" className="gl-ev-sub">{f2(H)} m</text>
        <text x={(x0 + x0 + L * s) / 2} y={base + 62} textAnchor="middle" className="gl-ev-sub">{f2(L)} m long · {from === 'out' ? 'as seen from outside' : 'mirrored, as seen from inside'}</text>
      </svg>
      {(view.z !== 1 || view.dx !== 0 || view.dy !== 0) && <button type="button" className="gl-btn gl-ev-fit" onClick={() => setView({ z: 1, dx: 0, dy: 0 })}>Fit the wall</button>}
      {pick && (() => {
        const px = (X(pick.t_m) + X(pick.t_m + pick.width_m)) / 2
        const py = Y(pick.sill_m + pick.height_m) - 12
        return (
          <div className="gl-ev-pop" style={{ left: px, top: py }} onPointerDown={(e) => e.stopPropagation()}>
            <b>{pick.door ? 'Door' : 'Window'}</b>
            <span>{f2(pick.width_m)} × {f2(pick.height_m)} m{pick.door ? '' : ` · sill ${f2(pick.sill_m)} m`} · {f2(pick.t_m)} m from the wall's start</span>
            <div className="gl-ev-pop-btns">
              {pick.door ? (
                <button type="button" onClick={() => onChange(pick.id, { door: false, ...windowSize })}>Make it a window</button>
              ) : (
                <button type="button" onClick={() => onChange(pick.id, { door: true, ...doorSize })}>Make it a door</button>
              )}
              <button type="button" onClick={() => { setPicked(null); onRemove(pick.id) }}>Remove</button>
              <button type="button" aria-label="Done" onClick={() => setPicked(null)}>Done</button>
            </div>
            <small>Arrow keys nudge it 0.1 m (Shift: 0.01 m)</small>
          </div>
        )
      })()}
    </div>
  )
}
