/**
 * Sim2 geometry prototype (route /sim2/geometry): draw a footprint, cut it into zones, click a wall and put N equal
 * windows on it; the page writes the Simulate v2 model document and checks it against the schema as you go.
 *
 * Drawing is decodED's (ported/drawCore.ts, ported/zones.ts): tap corners; from the third corner a side lands square
 * to the first side when it is close to square, otherwise it stays where you put it, so diagonals are as easy as right
 * angles; Shift = any angle, no snapping; tap the first corner (or Enter) to finish; Backspace takes back a corner; a
 * tap that would cross a side is refused and says so at the pointer. While drawing, type a length and press Enter to
 * place the next corner that far along the pointer's direction.
 *
 * Nothing is saved and nothing in today's tool reads this page.
 */
import { type PointerEvent as RPointerEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { CLICK_SLOP_PX, CLOSE_PX, SNAP_PX, type Square, createDrawCore, rectFrom, snapToTargets, squareTo } from './ported/drawCore'
import { type Hit, ccw, cutZones, labelAt, nearestEdge, squareCut, zoneAt, zoneTint } from './ported/zones'
import { type Plan, type WindowSet, type XY, allWindows, along, compass16, dist, emptyPlan, layoutSet, wallRuns, zoneArea } from './plan'
import { buildDocument } from './toDocument'

type Tool = 'draw' | 'rect' | 'cut' | 'select'
type Sel = { kind: 'wall'; index: number } | { kind: 'zone'; id: string } | null
type View = { cx: number; cy: number; s: number }

const NAVY = '#2B2A4C'
const MAGENTA = '#E84393'
const TEAL = '#00AEEF'
const GLASS = '#4FC3F7'
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
const f2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

const EXAMPLE: XY[] = [[0, 0], [24, 0], [24, 8], [16, 16], [8, 16], [8, 8], [0, 8]]

const HINT: Record<Tool, string> = {
  draw: 'Tap corners. Diagonals stay where you put them; near-square sides snap square. Shift: any angle. Type a length + Enter for an exact side. Tap the first corner or press Enter to finish.',
  rect: 'Tap the two ends of one side (any angle), then tap how deep it goes.',
  cut: 'Tap a point on a wall, then another, to cut a zone in two. "Square off a wall" cuts at 90° from the first tap.',
  select: 'Click a wall to add windows. Click inside a zone to rename it. Drag to pan, wheel to zoom.',
}

export default function GeometryLab() {
  // ─── plan + history ──────────────────────────────────────────────────────────
  const [plan, setPlan] = useState<Plan>(emptyPlan)
  const past = useRef<Plan[]>([])
  const future = useRef<Plan[]>([])
  const [, bump] = useState(0)
  const commit = useCallback((next: Plan) => {
    setPlan((cur) => {
      past.current.push(cur)
      future.current = []
      return next
    })
  }, [])
  const undo = () => {
    const p = past.current.pop()
    if (!p) return
    future.current.push(plan)
    setPlan(p)
    bump((n) => n + 1)
  }
  const redo = () => {
    const n = future.current.pop()
    if (!n) return
    past.current.push(plan)
    setPlan(n)
    bump((x) => x + 1)
  }

  const [tool, setTool] = useState<Tool>('draw')
  const [square, setSquare] = useState<Square>('soft')
  const [cutWay, setCutWay] = useState<'free' | 'square'>('free')
  const [sel, setSel] = useState<Sel>(null)
  const [view, setView] = useState<View>({ cx: 12, cy: 8, s: 22 })
  const [size, setSize] = useState({ w: 900, h: 640 })
  const [pointer, setPointer] = useState<XY | null>(null)
  const [shift, setShift] = useState(false)
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState<{ text: string; at: XY } | null>(null)
  const [rectPts, setRectPts] = useState<XY[]>([])
  const [cutFrom, setCutFrom] = useState<Hit | null>(null)
  const [showJson, setShowJson] = useState(false)

  // ─── the drawing core (decodED's) ───────────────────────────────────────────
  const core = useMemo(() => createDrawCore({ kind: 'area', square, strictRing: true }), [square])
  const cs = useSyncExternalStore(core.subscribe, core.state)

  // ─── view ────────────────────────────────────────────────────────────────────
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const toPx = (p: XY): [number, number] => [size.w / 2 + (p[0] - view.cx) * view.s, size.h / 2 - (p[1] - view.cy) * view.s]
  const toM = (x: number, y: number): XY => [(x - size.w / 2) / view.s + view.cx, -(y - size.h / 2) / view.s + view.cy]
  const mPerPx = 1 / view.s

  const runs = useMemo(() => wallRuns(plan.footprint), [plan.footprint])
  const built = useMemo(() => buildDocument(plan), [plan])
  const placed = useMemo(() => allWindows(plan).windows, [plan])
  const rings = plan.zones.map((z) => z.ring)

  const flash = (text: string, at: XY) => {
    setNote({ text, at })
    window.setTimeout(() => setNote((n) => (n && n.text === text ? null : n)), 2600)
  }

  // ─── where the next corner would land (the core's own rules, without placing it) ───
  const preview = useMemo((): { at: XY; snap: string; closing: boolean } | null => {
    if (!pointer) return null
    if (tool === 'draw') {
      const c = cs.corners
      const n = c.length
      if (n && dist(c[0] as XY, pointer) <= CLOSE_PX * mPerPx && n >= 3) return { at: c[0] as XY, snap: 'close', closing: true }
      if (shift) return { at: pointer, snap: 'free', closing: false }
      const t = snapToTargets(pointer, { corners: c.slice(1, -1) as XY[] }, SNAP_PX * mPerPx)
      if (t) return { at: t.at, snap: t.snap, closing: false }
      if (n >= 2) {
        const sq = squareTo(c, pointer, square)
        if (sq && dist(sq, c[n - 1] as XY) >= mPerPx * 0.5) return { at: sq, snap: 'square', closing: false }
      }
      return { at: pointer, snap: 'free', closing: false }
    }
    return { at: pointer, snap: 'free', closing: false }
  }, [pointer, tool, cs.corners, shift, square, mPerPx])

  /** The typed length, applied along the preview's direction. */
  const typedAt = (): XY | null => {
    const len = Number(typed)
    const c = cs.corners
    if (!typed || !(len > 0) || !c.length || !preview) return null
    const last = c[c.length - 1] as XY
    const d = dist(last, preview.at)
    if (d < 1e-9) return null
    return [last[0] + ((preview.at[0] - last[0]) / d) * len, last[1] + ((preview.at[1] - last[1]) / d) * len]
  }

  // ─── actions ─────────────────────────────────────────────────────────────────
  const setFootprint = (shape: XY[]) => {
    const fp = ccw(shape)
    commit({ ...emptyPlan(), storey_height_m: plan.storey_height_m, footprint: fp, zones: [{ id: 'z1', name: 'Zone 1', ring: fp }], zone_next: 2 })
    core.reset()
    setRectPts([])
    setTool('select')
    setSel(null)
    setTyped('')
  }

  const drawTap = (at: XY, free: boolean) => {
    if (plan.footprint) return flash('There is already a footprint. Clear all to draw a new one.', at)
    const o = core.tap(at, { mPerPx, shift: free })
    if (o.kind === 'refused') flash(o.message, o.at)
    else if (o.kind === 'finished') setFootprint(o.shape)
    setTyped('')
  }

  const finishDraw = () => {
    const o = core.finish(mPerPx)
    if (o.kind === 'refused') flash(o.message, o.at)
    else if (o.kind === 'finished') setFootprint(o.shape)
  }

  const cutHit = (p: XY) => nearestEdge(rings, p, SNAP_PX * 1.5 * mPerPx, SNAP_PX * mPerPx)

  const doCut = (a: XY, b: XY) => {
    const r = cutZones(rings, a, b)
    if ('why' in r) return flash(r.why, b)
    const old = plan.zones[r.at]!
    const parts = [r.zones[r.at]!, r.zones[r.at + 1]!].sort((x, y) => Math.abs(zoneArea({ ...old, ring: y })) - Math.abs(zoneArea({ ...old, ring: x })))
    const n = plan.zone_next
    const zones = [...plan.zones]
    zones.splice(r.at, 1, { ...old, ring: parts[0]! }, { id: `z${n}`, name: `Zone ${n}`, ring: parts[1]! })
    commit({ ...plan, zones, zone_next: n + 1 })
    setCutFrom(null)
  }

  const click = (at: XY, e: { shiftKey: boolean }) => {
    if (tool === 'draw') return drawTap(at, e.shiftKey)
    if (tool === 'rect') {
      if (plan.footprint) return flash('There is already a footprint. Clear all to draw a new one.', at)
      const pts = [...rectPts, at]
      if (pts.length < 3) return setRectPts(pts)
      const r = rectFrom(pts[0]!, pts[1]!, pts[2]!)
      if (!r) {
        setRectPts([])
        return flash('Tap further from the first side', at)
      }
      return setFootprint(r)
    }
    if (tool === 'cut') {
      if (!plan.zones.length) return flash('Draw a footprint first', at)
      const h = cutHit(at)
      if (!h) return flash('Tap on a wall or a zone line', at)
      if (!cutFrom) {
        if (cutWay === 'square') {
          const end = squareCut(rings, h, null)
          if (!end) return flash('No straight line across from there', at)
          return doCut(h.p, end)
        }
        return setCutFrom(h)
      }
      return doCut(cutFrom.p, h.p)
    }
    // select
    const wall = nearestWall(at)
    if (wall != null) return setSel({ kind: 'wall', index: wall })
    const zi = zoneAt(rings, at)
    setSel(zi >= 0 ? { kind: 'zone', id: plan.zones[zi]!.id } : null)
  }

  const nearestWall = (p: XY): number | null => {
    let best: number | null = null
    let bd = 10 * mPerPx
    for (const r of runs) {
      const dx = r.b[0] - r.a[0]
      const dy = r.b[1] - r.a[1]
      const L2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((p[0] - r.a[0]) * dx + (p[1] - r.a[1]) * dy) / L2))
      const d = dist(p, [r.a[0] + dx * t, r.a[1] + dy * t])
      if (d < bd) {
        bd = d
        best = r.index
      }
    }
    return best
  }

  // ─── pointer ─────────────────────────────────────────────────────────────────
  const down = useRef<{ x: number; y: number; view: View; pan: boolean } | null>(null)
  const local = (e: RPointerEvent) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    const { x, y } = local(e)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    down.current = { x, y, view, pan: tool === 'select' || e.button === 1 }
  }
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const { x, y } = local(e)
    setShift(e.shiftKey)
    setPointer(toM(x, y))
    const d = down.current
    if (d && d.pan && Math.hypot(x - d.x, y - d.y) > CLICK_SLOP_PX) {
      setView({ ...d.view, cx: d.view.cx - (x - d.x) / d.view.s, cy: d.view.cy + (y - d.y) / d.view.s })
    }
  }
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    const { x, y } = local(e)
    const d = down.current
    down.current = null
    if (!d || Math.hypot(x - d.x, y - d.y) > CLICK_SLOP_PX) return
    const at = toM(x, y)
    click(tool === 'draw' && preview ? at : at, e)
  }
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const before = toM(x, y)
    const s = Math.max(3, Math.min(200, view.s * Math.exp(-e.deltaY * 0.0015)))
    setView({ s, cx: before[0] - (x - size.w / 2) / s, cy: before[1] + (y - size.h / 2) / s })
  }

  // ─── keys ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
      setShift(e.shiftKey)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (tool === 'draw' && cs.corners.length) core.undo()
        else e.shiftKey ? redo() : undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') return void (e.preventDefault(), redo())
      if (tool === 'draw' && /^[0-9.]$/.test(e.key) && cs.corners.length) return setTyped((t) => (t + e.key).slice(0, 7))
      if (e.key === 'Backspace' && typed) return setTyped((t) => t.slice(0, -1))
      if (e.key === 'Enter' && tool === 'draw') {
        const t = typedAt()
        if (t) return drawTap(t, true)
        return finishDraw()
      }
      if (e.key === 'Backspace' && tool === 'draw') return void core.back()
      if (e.key === 'Escape') {
        core.clear()
        setRectPts([])
        setCutFrom(null)
        setTyped('')
        setSel(null)
      }
    }
    const onUpKey = (e: KeyboardEvent) => setShift(e.shiftKey)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUpKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUpKey)
    }
  })

  // ─── window form ─────────────────────────────────────────────────────────────
  const selWall = sel?.kind === 'wall' ? runs[sel.index] : undefined
  const selSet = selWall ? plan.windows.find((w) => w.wall === selWall.index) : undefined
  const [form, setForm] = useState({ count: '3', area: '1', height: '1.2', sill: '0.9' })
  useEffect(() => {
    if (selSet) setForm({ count: String(selSet.count), area: f2(selSet.width_m * selSet.height_m), height: f2(selSet.height_m), sill: f2(selSet.sill_m) })
  }, [selSet?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const draft: WindowSet | null = selWall
    ? { id: selSet?.id ?? `w${selWall.index + 1}`, wall: selWall.index, count: Number(form.count), height_m: Number(form.height), width_m: Number(form.area) / Number(form.height), sill_m: Number(form.sill) }
    : null
  const draftLayout = selWall && draft ? layoutSet(selWall, draft, plan.storey_height_m) : null
  const applyWindows = () => {
    if (!draft || !draftLayout || 'why' in draftLayout) return
    commit({ ...plan, windows: [...plan.windows.filter((w) => w.wall !== draft.wall), draft] })
  }
  const removeWindows = () => selWall && commit({ ...plan, windows: plan.windows.filter((w) => w.wall !== selWall.index) })

  const selZone = sel?.kind === 'zone' ? plan.zones.find((z) => z.id === sel.id) : undefined

  // ─── paint ───────────────────────────────────────────────────────────────────
  const pts = (r: readonly XY[]) => r.map((p) => toPx(p).join(',')).join(' ')
  const grid = useMemo(() => {
    const lines: JSX.Element[] = []
    const step = view.s >= 14 ? 1 : 5
    const [x0, y1] = toM(0, 0)
    const [x1, y0] = toM(size.w, size.h)
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const [px] = toPx([x, 0])
      lines.push(<line key={`x${x}`} x1={px} x2={px} y1={0} y2={size.h} stroke={x % 5 === 0 ? '#D9DCE1' : '#EEF0F2'} />)
    }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
      const [, py] = toPx([0, y])
      lines.push(<line key={`y${y}`} y1={py} y2={py} x1={0} x2={size.w} stroke={y % 5 === 0 ? '#D9DCE1' : '#EEF0F2'} />)
    }
    return lines
  }, [view, size]) // eslint-disable-line react-hooks/exhaustive-deps

  const hoverWall = tool === 'select' && pointer ? nearestWall(pointer) : null
  const label = (a: XY, b: XY, text: string, key: string, out = 14, color = NAVY) => {
    const [ax, ay] = toPx(a)
    const [bx, by] = toPx(b)
    const L = Math.hypot(bx - ax, by - ay) || 1
    // outside of an anticlockwise ring is to the right in metres = to the left on screen (y flipped)
    const nx = (by - ay) / L
    const ny = -(bx - ax) / L
    return (
      <text key={key} x={(ax + bx) / 2 - nx * out} y={(ay + by) / 2 - ny * out + 4} textAnchor="middle" fontSize={11} fill={color} style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}>
        {text}
      </text>
    )
  }

  const typedPt = tool === 'draw' ? typedAt() : null
  const ghost = typedPt ?? preview?.at ?? null

  return (
    <div className="flex h-screen w-screen bg-off-white text-navy" style={{ fontFamily: 'Stolzl, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      {/* ─── canvas ─── */}
      <div className="relative flex-1" ref={box}>
        <svg
          width={size.w}
          height={size.h}
          className="block select-none bg-white"
          style={{ cursor: tool === 'select' ? (hoverWall != null ? 'pointer' : 'grab') : 'crosshair', touchAction: 'none' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => setPointer(null)}
          onWheel={onWheel}
        >
          {grid}
          {/* zones */}
          {plan.zones.map((z, i) => {
            const t = zoneTint(i)
            const on = sel?.kind === 'zone' && sel.id === z.id
            const [lx, ly] = toPx(labelAt(z.ring))
            return (
              <g key={z.id}>
                <polygon points={pts(z.ring)} fill={t.fill} stroke={on ? MAGENTA : t.line} strokeWidth={on ? 2.5 : 1} strokeDasharray={on ? undefined : '5 3'} />
                <text x={lx} y={ly} textAnchor="middle" fontSize={12} fontWeight={600} fill={NAVY}>{z.name}</text>
                <text x={lx} y={ly + 14} textAnchor="middle" fontSize={10} fill="#4B5563">{f1(zoneArea(z))} m²</text>
              </g>
            )
          })}
          {/* footprint walls */}
          {runs.map((r) => {
            const on = sel?.kind === 'wall' && sel.index === r.index
            const hv = hoverWall === r.index
            const [ax, ay] = toPx(r.a)
            const [bx, by] = toPx(r.b)
            return <line key={`w${r.index}`} x1={ax} y1={ay} x2={bx} y2={by} stroke={on ? MAGENTA : hv ? TEAL : NAVY} strokeWidth={on || hv ? 6 : 3} strokeLinecap="round" />
          })}
          {runs.map((r) => label(r.a, r.b, `${f1(r.length_m)} m`, `l${r.index}`, 16, '#4B5563'))}
          {/* windows */}
          {placed.map((w, i) => {
            const r = runs[w.wall]
            if (!r) return null
            const [ax, ay] = toPx(along(r, w.offset_m))
            const [bx, by] = toPx(along(r, w.offset_m + w.width_m))
            return (
              <g key={`g${i}`}>
                <line x1={ax} y1={ay} x2={bx} y2={by} stroke={NAVY} strokeWidth={8} strokeLinecap="butt" />
                <line x1={ax} y1={ay} x2={bx} y2={by} stroke={GLASS} strokeWidth={5} strokeLinecap="butt" />
              </g>
            )
          })}
          {/* drawing in progress */}
          {tool === 'draw' && cs.corners.length > 0 && (
            <g>
              <polyline points={pts(cs.corners)} fill="none" stroke={MAGENTA} strokeWidth={2.5} />
              {cs.corners.slice(1).map((c, i) => label(cs.corners[i] as XY, c as XY, `${f1(dist(cs.corners[i] as XY, c as XY))} m`, `dl${i}`))}
              {ghost && (
                <>
                  <line x1={toPx(cs.corners[cs.corners.length - 1] as XY)[0]} y1={toPx(cs.corners[cs.corners.length - 1] as XY)[1]} x2={toPx(ghost)[0]} y2={toPx(ghost)[1]} stroke={MAGENTA} strokeWidth={2} strokeDasharray="6 4" />
                  {label(cs.corners[cs.corners.length - 1] as XY, ghost, typed ? `${typed} m ↵` : `${f1(dist(cs.corners[cs.corners.length - 1] as XY, ghost))} m${preview?.snap === 'square' ? ' ⟂' : ''}`, 'gl', 14, MAGENTA)}
                </>
              )}
              {cs.refused?.sides.map((i) => {
                const a = cs.corners[i] as XY
                const b = cs.corners[(i + 1) % cs.corners.length] as XY
                return <line key={`bad${i}`} x1={toPx(a)[0]} y1={toPx(a)[1]} x2={toPx(b)[0]} y2={toPx(b)[1]} stroke="#DC2626" strokeWidth={4} />
              })}
              {cs.corners.map((c, i) => (
                <circle key={`c${i}`} cx={toPx(c as XY)[0]} cy={toPx(c as XY)[1]} r={i === 0 ? (preview?.closing ? 9 : 7) : 4.5} fill={i === 0 ? (preview?.closing ? MAGENTA : 'white') : MAGENTA} stroke={MAGENTA} strokeWidth={2} />
              ))}
            </g>
          )}
          {tool === 'rect' && rectPts.length > 0 && pointer && (() => {
            const r = rectPts.length === 2 ? rectFrom(rectPts[0]!, rectPts[1]!, pointer) : null
            return (
              <g>
                {r ? <polygon points={pts(r)} fill="rgba(232,67,147,0.08)" stroke={MAGENTA} strokeWidth={2} strokeDasharray="6 4" /> : <line x1={toPx(rectPts[0]!)[0]} y1={toPx(rectPts[0]!)[1]} x2={toPx(pointer)[0]} y2={toPx(pointer)[1]} stroke={MAGENTA} strokeWidth={2} strokeDasharray="6 4" />}
                {!r && label(rectPts[0]!, pointer, `${f1(dist(rectPts[0]!, pointer))} m`, 'rl', 14, MAGENTA)}
                {r && label(r[1]!, r[2]!, `${f1(dist(r[1]!, r[2]!))} m`, 'rd', 14, MAGENTA)}
                {rectPts.map((p, i) => <circle key={i} cx={toPx(p)[0]} cy={toPx(p)[1]} r={4.5} fill={MAGENTA} />)}
              </g>
            )
          })()}
          {tool === 'cut' && pointer && (() => {
            const h = cutHit(pointer)
            const sq = !cutFrom && cutWay === 'square' && h ? squareCut(rings, h, null) : null
            return (
              <g>
                {cutFrom && <line x1={toPx(cutFrom.p)[0]} y1={toPx(cutFrom.p)[1]} x2={toPx(h?.p ?? pointer)[0]} y2={toPx(h?.p ?? pointer)[1]} stroke={MAGENTA} strokeWidth={2} strokeDasharray="6 4" />}
                {sq && h && <line x1={toPx(h.p)[0]} y1={toPx(h.p)[1]} x2={toPx(sq)[0]} y2={toPx(sq)[1]} stroke={MAGENTA} strokeWidth={2} strokeDasharray="6 4" />}
                {cutFrom && <circle cx={toPx(cutFrom.p)[0]} cy={toPx(cutFrom.p)[1]} r={5} fill={MAGENTA} />}
                {h && <circle cx={toPx(h.p)[0]} cy={toPx(h.p)[1]} r={h.corner ? 7 : 5} fill="white" stroke={MAGENTA} strokeWidth={2} />}
              </g>
            )
          })()}
          {/* pointer note (a refusal says why, where it happened) */}
          {note && (
            <g>
              <rect x={toPx(note.at)[0] + 10} y={toPx(note.at)[1] - 30} width={note.text.length * 6.4 + 16} height={22} rx={4} fill="#DC2626" />
              <text x={toPx(note.at)[0] + 18} y={toPx(note.at)[1] - 15} fontSize={11.5} fill="white">{note.text}</text>
            </g>
          )}
          {/* north + scale */}
          <g transform={`translate(${size.w - 36},40)`}>
            <polygon points="0,-18 7,6 0,1 -7,6" fill={NAVY} />
            <text y={22} textAnchor="middle" fontSize={11} fontWeight={600} fill={NAVY}>N</text>
          </g>
          <g transform={`translate(16,${size.h - 20})`}>
            <line x1={0} x2={5 * view.s} y1={0} y2={0} stroke={NAVY} strokeWidth={2} />
            <line x1={0} x2={0} y1={-4} y2={4} stroke={NAVY} strokeWidth={2} />
            <line x1={5 * view.s} x2={5 * view.s} y1={-4} y2={4} stroke={NAVY} strokeWidth={2} />
            <text x={5 * view.s + 6} y={4} fontSize={11} fill={NAVY}>5 m</text>
          </g>
        </svg>

        {/* toolbar */}
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-white p-1 shadow-lg" style={{ border: '1px solid #E6E6E6' }}>
          {(['draw', 'rect', 'cut', 'select'] as Tool[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTool(t)
                setRectPts([])
                setCutFrom(null)
                setTyped('')
              }}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium"
              style={{ background: tool === t ? NAVY : 'transparent', color: tool === t ? 'white' : NAVY }}
            >
              {{ draw: 'Shape', rect: 'Rectangle', cut: 'Split / cut', select: 'Select' }[t]}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-light-grey" />
          <button type="button" className="rounded-md px-3 py-1.5 text-[12px]" onClick={() => (tool === 'draw' && cs.corners.length ? core.undo() : undo())}>Undo</button>
          <button type="button" className="rounded-md px-3 py-1.5 text-[12px]" onClick={() => (tool === 'draw' && cs.canRedo ? core.redo() : redo())}>Redo</button>
          {tool === 'draw' && cs.corners.length >= 3 && (
            <button type="button" className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: MAGENTA }} onClick={finishDraw}>Finish shape</button>
          )}
        </div>
        <div className="pointer-events-none absolute left-4 top-4 max-w-[460px] rounded-md bg-white/95 px-3 py-2 text-[12px] leading-snug shadow" style={{ border: '1px solid #E6E6E6' }}>
          {HINT[tool]}
          {tool === 'cut' && cutFrom && <div className="mt-1 font-medium" style={{ color: MAGENTA }}>Now tap the other end. Esc to cancel.</div>}
        </div>
      </div>

      {/* ─── side panel ─── */}
      <aside className="flex w-[380px] flex-col overflow-y-auto bg-white p-4 text-[12px]" style={{ borderLeft: '1px solid #E6E6E6' }}>
        <div className="text-[16px] font-semibold">Geometry and zoning</div>
        <div className="mb-3 text-[11px] text-mid-grey">Simulate v2 prototype. Nothing here is saved, and today's tool is unchanged.</div>

        <Section title="Building">
          <Row label="Storey height">
            <NumIn value={String(plan.storey_height_m)} onCommit={(v) => v > 0 && commit({ ...plan, storey_height_m: v })} unit="m" />
          </Row>
          {tool === 'draw' && (
            <Row label="Square corners">
              <select className="rounded border px-1 py-0.5" style={{ borderColor: '#E6E6E6' }} value={square} onChange={(e) => setSquare(e.target.value as Square)}>
                <option value="soft">When nearly square</option>
                <option value="strict">Always</option>
                <option value="off">Never</option>
              </select>
            </Row>
          )}
          {tool === 'cut' && (
            <Row label="Cut">
              <select className="rounded border px-1 py-0.5" style={{ borderColor: '#E6E6E6' }} value={cutWay} onChange={(e) => setCutWay(e.target.value as 'free' | 'square')}>
                <option value="free">Free line (two taps)</option>
                <option value="square">Square off a wall (one tap)</option>
              </select>
            </Row>
          )}
          <div className="mt-2 flex gap-2">
            {!plan.footprint && (
              <button type="button" className="rounded border px-2 py-1" style={{ borderColor: '#E6E6E6' }} onClick={() => setFootprint(EXAMPLE)}>
                Start from an example
              </button>
            )}
            {plan.footprint && (
              <button type="button" className="rounded border px-2 py-1" style={{ borderColor: '#E6E6E6' }} onClick={() => { commit({ ...emptyPlan(), storey_height_m: plan.storey_height_m }); core.reset(); setSel(null); setTool('draw') }}>
                Clear all
              </button>
            )}
          </div>
        </Section>

        {selWall && (
          <Section title={`Wall ${selWall.index + 1}`} accent>
            <div className="mb-2 text-dark-grey">
              {f2(selWall.length_m)} m long, faces {compass16(selWall.azimuth_deg)} ({Math.round(selWall.azimuth_deg)}°), {f1(selWall.length_m * plan.storey_height_m)} m² gross
            </div>
            <Row label="Number of windows"><NumIn value={form.count} onCommit={(v) => setForm({ ...form, count: String(v) })} live={(s) => setForm({ ...form, count: s })} /></Row>
            <Row label="Area of each"><NumIn value={form.area} onCommit={(v) => setForm({ ...form, area: String(v) })} live={(s) => setForm({ ...form, area: s })} unit="m²" /></Row>
            <Row label="Height"><NumIn value={form.height} onCommit={(v) => setForm({ ...form, height: String(v) })} live={(s) => setForm({ ...form, height: s })} unit="m" /></Row>
            <Row label="Sill height"><NumIn value={form.sill} onCommit={(v) => setForm({ ...form, sill: String(v) })} live={(s) => setForm({ ...form, sill: s })} unit="m" /></Row>
            <Row label="Spacing"><span>Equal</span></Row>
            {draft && draftLayout && !('why' in draftLayout) && (
              <div className="mt-1 text-dark-grey">
                Each {f2(draft.width_m)} × {f2(draft.height_m)} m, gaps of {f2(draftLayout.gap_m)} m. Glazing {f2(draft.count * draft.width_m * draft.height_m)} m² ({Math.round((100 * draft.count * draft.width_m * draft.height_m) / (selWall.length_m * plan.storey_height_m))}% of this wall).
              </div>
            )}
            {draftLayout && 'why' in draftLayout && <div className="mt-1 font-medium" style={{ color: '#DC2626' }}>{draftLayout.why}</div>}
            {selWall && draftLayout && !('why' in draftLayout) && <Elevation length={selWall.length_m} height={plan.storey_height_m} windows={draftLayout.windows} />}
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={!draftLayout || 'why' in draftLayout} onClick={applyWindows} className="rounded px-3 py-1.5 font-medium text-white disabled:opacity-40" style={{ background: MAGENTA }}>
                {selSet ? 'Update windows' : 'Add windows'}
              </button>
              {selSet && <button type="button" onClick={removeWindows} className="rounded border px-3 py-1.5" style={{ borderColor: '#E6E6E6' }}>Remove</button>}
            </div>
          </Section>
        )}

        {selZone && (
          <Section title="Zone" accent>
            <Row label="Name">
              <input className="w-40 rounded border px-1 py-0.5" style={{ borderColor: '#E6E6E6' }} defaultValue={selZone.name} key={selZone.id}
                onBlur={(e) => e.target.value.trim() && e.target.value !== selZone.name && commit({ ...plan, zones: plan.zones.map((z) => (z.id === selZone.id ? { ...z, name: e.target.value.trim() } : z)) })} />
            </Row>
            <Row label="Floor area"><span>{f1(zoneArea(selZone))} m²</span></Row>
            <div className="mt-1 text-[11px] text-mid-grey">Next: assign use, systems and profiles here (and to several zones at once).</div>
          </Section>
        )}

        <Section title="Model document">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: !plan.zones.length ? '#6B7280' : built.ok ? '#16A34A' : '#DC2626' }}>
              {!plan.zones.length ? 'Nothing drawn yet' : built.ok ? `Valid (schema ${(built.doc as { schema_version: string }).schema_version})` : 'Not valid'}
            </span>
          </div>
          {plan.zones.length > 0 && (
            <table className="w-full text-[11.5px]">
              <tbody>
                <TRow k="Zones" v={`${built.totals.zones} · ${f1(built.totals.floor_m2)} m² floor`} />
                <TRow k="External walls" v={`${built.totals.walls} · ${f1(built.totals.wall_net_m2)} m² net`} />
                <TRow k="Glazing" v={`${built.totals.windows} windows · ${f2(built.totals.glazing_m2)} m²`} />
                <TRow k="Partitions" v={String(built.totals.partitions)} />
              </tbody>
            </table>
          )}
          {built.notes.map((n, i) => <div key={i} className="mt-1 text-[11px]" style={{ color: '#B45309' }}>{n}</div>)}
          {plan.zones.length > 0 && built.issues.map((x, i) => <div key={i} className="mt-1 text-[11px]" style={{ color: '#DC2626' }}>{x.path}: {x.message}</div>)}
          {plan.zones.length > 0 && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="rounded border px-2 py-1" style={{ borderColor: '#E6E6E6' }} onClick={() => setShowJson((s) => !s)}>{showJson ? 'Hide' : 'Show'} JSON</button>
              <button type="button" className="rounded border px-2 py-1" style={{ borderColor: '#E6E6E6' }} onClick={() => download(built.doc, plan)}>Download</button>
            </div>
          )}
          {showJson && <pre className="mt-2 max-h-[360px] overflow-auto rounded bg-off-white p-2 text-[10px] leading-tight">{JSON.stringify(built.doc, null, 1)}</pre>}
          <div className="mt-2 text-[10.5px] leading-snug text-mid-grey">
            Constructions, profiles, systems and weather are left unassigned on purpose. Window positions travel with the plan (the schema has no place for them yet).
          </div>
        </Section>
      </aside>
    </div>
  )
}

function download(doc: unknown, plan: Plan) {
  const blob = new Blob([JSON.stringify({ document: doc, layout: plan }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'sim2-geometry.json'
  a.click()
  URL.revokeObjectURL(a.href)
}

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className="mb-3 rounded-md p-3" style={{ border: `1px solid ${accent ? MAGENTA : '#E6E6E6'}` }}>
      <div className="mb-2 text-[13px] font-semibold">{title}</div>
      {children}
    </div>
  )
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="text-dark-grey">{label}</span>
      {children}
    </div>
  )
}
function TRow({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td className="py-0.5 text-dark-grey">{k}</td>
      <td className="py-0.5 text-right font-medium">{v}</td>
    </tr>
  )
}
function NumIn({ value, onCommit, live, unit }: { value: string; onCommit: (v: number) => void; live?: (s: string) => void; unit?: string }) {
  const [s, setS] = useState(value)
  useEffect(() => setS(value), [value])
  return (
    <span className="flex items-center gap-1">
      <input
        className="w-20 rounded border px-1 py-0.5 text-right"
        style={{ borderColor: '#E6E6E6' }}
        inputMode="decimal"
        value={s}
        onChange={(e) => {
          setS(e.target.value)
          live?.(e.target.value)
        }}
        onBlur={() => Number.isFinite(Number(s)) && onCommit(Number(s))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {unit && <span className="w-5 text-mid-grey">{unit}</span>}
    </span>
  )
}

/** The wall seen from outside: its length × storey height, the windows on it, the gaps between them. */
function Elevation({ length, height, windows }: { length: number; height: number; windows: Array<{ offset_m: number; width_m: number; height_m: number; sill_m: number }> }) {
  const W = 320
  const s = Math.min(W / length, 90 / height)
  const w = length * s
  const h = height * s
  return (
    <svg viewBox={`0 0 ${W} ${h + 22}`} className="mt-2 block w-full">
      <rect x={(W - w) / 2} y={2} width={w} height={h} fill="#EFE9E6" stroke="#A1887F" />
      {windows.map((x, i) => (
        <rect key={i} x={(W - w) / 2 + x.offset_m * s} y={2 + h - (x.sill_m + x.height_m) * s} width={x.width_m * s} height={x.height_m * s} fill={GLASS} stroke={NAVY} strokeWidth={1} />
      ))}
      <text x={W / 2} y={h + 17} textAnchor="middle" fontSize={10} fill="#4B5563">Seen from outside · {f2(length)} m × {f2(height)} m</text>
    </svg>
  )
}
