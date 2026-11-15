/**
 * Sim2 geometry prototype (route /sim2/geometry). Dressed and driven like decodED's room editor (inside/RoomEditor.tsx):
 * a plan on paper with a grid, a floating box on the left, a card on the right for the thing in hand, the tool bar
 * along the bottom with one line above it saying what the tool does, and a note at the pointer when something can't be
 * done (never refused in silence). Geometry only: systems are assigned on their own page, later.
 *
 * Two steps, shown at the top of the left box.
 *
 * 1. Outline: the building's shape, as one or more blocks.
 *   - Rectangle / Triangle: press and drag, corners on a 0.5 m grid, square to it (Shift: 0.1 m). A shape drawn
 *     touching a block joins it (an L, a T, a wing); one drawn apart is a new block.
 *   - Shape: tap corners (decodED's drawing core: near-square sides snap square, diagonals stay put; Shift: any angle).
 *   - Cut out: drag a box over the building to take that piece away.
 *   - Select: tap a block to choose it (Shift: more); drag it to move it (dropped against another, it joins on); drag a
 *     wall to push it straight out or in; drag a corner; the orange handle turns it (15° steps, Shift: free);
 *     double-click a corner to take it away. Tap a wall for its windows. Ctrl+C / Ctrl+V (or Copy on the card) copies
 *     a block; Delete removes it.
 *   - Add corner: only when chosen. Press on a wall to put a corner there and drag it.
 *
 * 2. Rooms: the floor cut into rooms, which always fill it wall to wall.
 *   - Wall: tap a point on one wall, then on another; a wall goes between them (decodED's zone cut).
 *   - Room: drag a box; it takes its space from the rooms under it. Halve: tap a room. Join: tap two rooms that touch.
 *   - Select: tap a room (Shift: more); drag a wall between rooms to move it. The card puts rooms in a zone.
 *
 * Nothing is saved, and nothing in today's tool reads this page.
 */
import { type PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import './lab.css'
import { CLOSE_PX, SNAP_PX, createDrawCore } from './ported/drawCore'
import { type Hit, ccw, labelAt, nearestEdge, zoneAt, zoneTint } from './ported/zones'
import { type Plan, type WindowSet, type XY, allWindows, along, blankZone, compass16, dist, emptyPlan, floorArea, layoutSet, ringArea, wallRuns } from './plan'
import { type Changed, addShape, blockAt, boxRing, centreOf, copyBlock, cutShape, dropBlocks, moveBlocks, pushWall, removeBlock, setBlock, snapXY, triRing, turnBlocks } from './outline'
import { type Side, assignZone, boxRoom, divideRoom, halveRoom, innerSideAt, joinRooms, moveWall, sideEnds, sideNormal } from './rooms'
import { buildDocument } from './toDocument'

type Mode = 'outline' | 'rooms'
type Tool = 'select' | 'rect' | 'tri' | 'shape' | 'cut' | 'corner' | 'pick' | 'room' | 'halve' | 'divide' | 'join'
type Sel = { kind: 'wall'; index: number } | { kind: 'blocks'; idx: number[] } | { kind: 'rooms'; ids: string[] } | null
type View = { cx: number; cy: number; k: number }
type Drag =
  | { kind: 'pan'; x: number; y: number; v: View; moved: boolean }
  | { kind: 'box'; a: XY; b: XY }
  | { kind: 'move'; idx: number[]; start: XY; base: Plan; d: XY; moved: boolean; tapped: number; sh: boolean }
  | { kind: 'corner'; block: number; i: number; base: Plan; ring: XY[] }
  | { kind: 'turn'; idx: number[]; start: XY; c: XY; base: Plan; rad: number }
  | { kind: 'push'; block: number; side: number; run: number; start: XY; n: XY; base: Plan; by: number }
  | { kind: 'wall'; side: Side; start: XY; n: XY; base: Plan; by: number }

const TOOLS: Record<Mode, Array<{ key: Tool; name: string; glyph: string; line: string }>> = {
  outline: [
    { key: 'select', name: 'Select', glyph: '➚', line: 'Tap a block to choose it. Drag it to move, drag a wall to push it out, drag a corner. Tap a wall for windows.' },
    { key: 'rect', name: 'Rectangle', glyph: '▭', line: 'Press and drag a box on the 0.5 m grid. Touching the building, it joins on; apart, it is a new block.' },
    { key: 'tri', name: 'Triangle', glyph: '◺', line: 'Press and drag. The square corner is where you start.' },
    { key: 'shape', name: 'Shape', glyph: '⬠', line: 'Tap each corner. Tap the first corner to finish. Shift: any angle.' },
    { key: 'cut', name: 'Cut out', glyph: '⊟', line: 'Drag a box over the building to take that piece away.' },
    { key: 'corner', name: 'Add corner', glyph: '⌖', line: 'Press on a wall to add a corner there, and drag it.' },
  ],
  rooms: [
    { key: 'divide', name: 'Wall', glyph: '╱', line: 'Tap a point on one wall, then on another. A new wall goes between them and makes two rooms.' },
    { key: 'room', name: 'Room', glyph: '▭', line: 'Drag a box. It becomes a room, taking the space from the rooms under it.' },
    { key: 'halve', name: 'Halve', glyph: '◫', line: 'Tap a room to halve it across its long side.' },
    { key: 'join', name: 'Join', glyph: '⧉', line: 'Tap two rooms that touch to make them one.' },
    { key: 'pick', name: 'Select', glyph: '➚', line: 'Tap a room (Shift: more than one) to put it in a zone. Drag a wall between rooms to move it.' },
  ],
}
const FIRST: Record<Mode, Tool> = { outline: 'select', rooms: 'divide' }
const LEFT = 328
const GRID = 0.5
const FINE = 0.1
const GRAB = 9
const TURN_PX = 46
const EXAMPLE: XY[] = [[0, 0], [30, 0], [30, 10], [20, 10], [20, 24], [10, 24], [10, 10], [0, 10]]

const f1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const f2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function GeometryLab() {
  // ─── the plan, with Undo ───────────────────────────────────────────────────
  const [plan, setPlan] = useState<Plan>(emptyPlan)
  const [past, setPast] = useState<Plan[]>([])
  const [future, setFuture] = useState<Plan[]>([])
  const commit = (next: Plan) => {
    setPast((p) => [...p.slice(-100), plan])
    setFuture([])
    setPlan(next)
  }
  const undo = () => {
    const prev = past[past.length - 1]
    if (!prev) return
    setFuture((f) => [...f, plan])
    setPast((p) => p.slice(0, -1))
    setPlan(prev)
    setSel(null)
  }
  const redo = () => {
    const next = future[future.length - 1]
    if (!next) return
    setPast((p) => [...p, plan])
    setFuture((f) => f.slice(0, -1))
    setPlan(next)
    setSel(null)
  }

  const [mode, setMode] = useState<Mode>('outline')
  const [tool, setTool] = useState<Tool>('rect')
  const [joinFrom, setJoinFrom] = useState<string | null>(null)
  const [sel, setSel] = useState<Sel>(null)
  const [clip, setClip] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pointer, setPointer] = useState<XY | null>(null)
  const [shift, setShift] = useState(false)
  const [say, setSay] = useState<{ x: number; y: number; text: string; bad?: boolean } | null>(null)
  const [cutFrom, setCutFrom] = useState<Hit | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [size, setSize] = useState<[number, number]>([1400, 900])
  const [view, setView] = useState<View>({ cx: 15, cy: 10, k: 22 })
  const host = useRef<HTMLDivElement>(null)
  const core = useMemo(() => createDrawCore({ kind: 'area', square: 'soft', strictRing: true }), [])
  const cs = useSyncExternalStore(core.subscribe, core.state)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize([el.clientWidth || 1400, el.clientHeight || 900]))
    ro.observe(el)
    setSize([el.clientWidth || 1400, el.clientHeight || 900])
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!say) return
    const t = setTimeout(() => setSay(null), say.bad ? 2600 : 2200)
    return () => clearTimeout(t)
  }, [say])

  const narrow = size[0] < 760
  const mid: [number, number] = narrow ? [size[0] / 2, size[1] * 0.3] : [LEFT + (size[0] - LEFT) / 2, size[1] / 2 - 30]
  const toPx = (p: XY): [number, number] => [mid[0] + (p[0] - view.cx) * view.k, mid[1] - (p[1] - view.cy) * view.k]
  const toM = (x: number, y: number): XY => [(x - mid[0]) / view.k + view.cx, -(y - mid[1]) / view.k + view.cy]
  const mPerPx = 1 / view.k
  const step = shift ? FINE : GRID
  const tell = (at: XY, text: string, bad = false) => {
    const [x, y] = toPx(at)
    setSay({ x: x + 14, y: y - 34, text, bad })
  }

  const fitTo = (pts: readonly XY[]) => {
    if (!pts.length) return
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const w = Math.max(...xs) - Math.min(...xs) || 1
    const h = Math.max(...ys) - Math.min(...ys) || 1
    const room = narrow ? [size[0] - 60, size[1] * 0.45] : [size[0] - LEFT - 380, size[1] - 260]
    setView({ cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, k: Math.max(4, Math.min(60, room[0]! / w, room[1]! / h)) })
  }

  const runs = useMemo(() => wallRuns(plan.blocks), [plan.blocks])
  const built = useMemo(() => buildDocument(plan), [plan])
  const placed = useMemo(() => allWindows(plan).windows, [plan])
  const rings = plan.rooms.map((z) => z.ring)
  const has = plan.blocks.length > 0
  const inRooms = mode === 'rooms'
  const selBlocks = sel?.kind === 'blocks' ? sel.idx.filter((i) => i < plan.blocks.length) : []

  // What is on screen while a drag is live (the plan itself changes only when the pointer comes up: one Undo step).
  const preview = (): Plan => {
    if (!drag) return plan
    const or = (r: Changed, base: Plan) => ('why' in r ? base : r.plan)
    try {
      if (drag.kind === 'move') return moveBlocks(drag.base, drag.idx, drag.d)
      if (drag.kind === 'turn') return turnBlocks(drag.base, drag.idx, drag.rad, drag.c)
      if (drag.kind === 'corner') return or(setBlock(drag.base, drag.block, drag.ring), { ...drag.base, blocks: drag.base.blocks.map((b, i) => (i === drag.block ? drag.ring : b)) })
      if (drag.kind === 'push') return or(pushWall(drag.base, drag.block, drag.side, drag.by), drag.base)
      if (drag.kind === 'wall') return or(moveWall(drag.base, drag.side, drag.by), drag.base)
    } catch {
      return 'base' in drag ? drag.base : plan
    }
    return plan
  }
  const shown = useMemo(preview, [plan, drag]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownRuns = drag ? wallRuns(shown.blocks) : runs

  /** Choose the block under a point after a change (blocks renumber when they join). */
  const chooseAt = (p: Plan, at: XY) => {
    const i = blockAt(p, at)
    setSel(i >= 0 ? { kind: 'blocks', idx: [i] } : null)
  }
  const apply = (r: Changed, at: XY, choose?: XY) => {
    if ('why' in r) return tell(at, r.why, true)
    commit(r.plan)
    if (r.said) tell(at, r.said)
    if (mode === 'outline' && choose) chooseAt(r.plan, choose)
  }

  // ─── hit tests (screen pixels) ─────────────────────────────────────────────
  const handleBlocks = mode === 'outline' && (tool === 'select' || tool === 'corner') ? (selBlocks.length ? selBlocks : shown.blocks.length === 1 ? [0] : []) : []
  const turnHandle = (): { at: [number, number]; c: XY } | null => {
    if (tool !== 'select' || !handleBlocks.length) return null
    const pts = handleBlocks.flatMap((i) => shown.blocks[i] ?? [])
    if (!pts.length) return null
    const px = pts.map(toPx)
    const top = Math.min(...px.map((p) => p[1]))
    const cx = (Math.min(...px.map((p) => p[0])) + Math.max(...px.map((p) => p[0]))) / 2
    return { at: [cx, top - TURN_PX], c: centreOf(pts) }
  }
  const cornerAt = (x: number, y: number): { block: number; i: number } | null => {
    for (const b of handleBlocks) {
      const i = (plan.blocks[b] ?? []).findIndex((p) => Math.hypot(toPx(p)[0] - x, toPx(p)[1] - y) <= GRAB)
      if (i >= 0) return { block: b, i }
    }
    return null
  }
  const wallAt = (x: number, y: number): number | null => {
    let best: number | null = null
    let bd = 7
    for (const r of shownRuns) {
      const [ax, ay] = toPx(r.a)
      const [bx, by] = toPx(r.b)
      const dx = bx - ax
      const dy = by - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
      if (d < bd) {
        bd = d
        best = r.index
      }
    }
    return best
  }
  /** Where on wall run `w` the point `m` falls, snapped along it to the grid step. */
  const onWall = (w: number, m: XY, st: number): XY => {
    const r = runs[w]!
    const t = Math.max(0, Math.min(r.length_m, Math.round((((m[0] - r.a[0]) * (r.b[0] - r.a[0]) + (m[1] - r.a[1]) * (r.b[1] - r.a[1])) / (r.length_m || 1)) / st) * st))
    return along(r, t)
  }

  // ─── pointer ───────────────────────────────────────────────────────────────
  const local = (e: RPointerEvent) => {
    const r = (e.currentTarget as Element).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as [number, number]
  }
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return
    const [x, y] = local(e)
    const m = toM(x, y)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setShift(e.shiftKey)
    const st = e.shiftKey ? FINE : GRID
    if (e.button === 1) return setDrag({ kind: 'pan', x, y, v: view, moved: false })
    if (tool === 'rect' || tool === 'tri' || tool === 'cut' || tool === 'room') {
      const a = snapXY(m, st)
      return setDrag({ kind: 'box', a, b: a })
    }
    if (tool === 'corner' && has) {
      const w = wallAt(x, y)
      if (w == null) return tell(m, 'Press on a wall to add a corner there.', true)
      const r = runs[w]!
      const ring = plan.blocks[r.block]!.map((p) => [p[0], p[1]] as XY)
      ring.splice(r.side + 1, 0, onWall(w, m, st))
      return setDrag({ kind: 'corner', block: r.block, i: r.side + 1, base: plan, ring })
    }
    if (tool === 'select' && has) {
      const th = turnHandle()
      if (th && Math.hypot(th.at[0] - x, th.at[1] - y) <= GRAB + 3) return setDrag({ kind: 'turn', idx: handleBlocks, start: m, c: th.c, base: plan, rad: 0 })
      const c = cornerAt(x, y)
      if (c) return setDrag({ kind: 'corner', block: c.block, i: c.i, base: plan, ring: plan.blocks[c.block]!.map((p) => [p[0], p[1]] as XY) })
      const w = wallAt(x, y)
      if (w != null) {
        const r = runs[w]!
        const L = r.length_m || 1
        return setDrag({ kind: 'push', block: r.block, side: r.side, run: w, start: m, n: [(r.b[1] - r.a[1]) / L, -(r.b[0] - r.a[0]) / L], base: plan, by: 0 })
      }
      const bi = blockAt(plan, m)
      if (bi >= 0) {
        const idx = e.shiftKey ? [...new Set([...selBlocks, bi])] : selBlocks.includes(bi) ? selBlocks : [bi]
        return setDrag({ kind: 'move', idx, start: m, base: plan, d: [0, 0], moved: false, tapped: bi, sh: e.shiftKey })
      }
    }
    if (tool === 'pick' && has && wallAt(x, y) == null) {
      const side = innerSideAt(plan, m, GRAB * mPerPx)
      if (side) return setDrag({ kind: 'wall', side, start: m, n: sideNormal(plan, side), base: plan, by: 0 })
    }
    setDrag({ kind: 'pan', x, y, v: view, moved: false })
  }
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const [x, y] = local(e)
    const m = toM(x, y)
    setShift(e.shiftKey)
    setPointer(m)
    if (!drag) return
    const st = e.shiftKey ? FINE : GRID
    if (drag.kind === 'pan') {
      if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 4) return
      setView({ ...drag.v, cx: drag.v.cx - (x - drag.x) / drag.v.k, cy: drag.v.cy + (y - drag.y) / drag.v.k })
      setDrag({ ...drag, moved: true })
    } else if (drag.kind === 'box') setDrag({ ...drag, b: snapXY(m, st) })
    else if (drag.kind === 'move') {
      const d = snapXY([m[0] - drag.start[0], m[1] - drag.start[1]], st)
      setDrag({ ...drag, d, moved: drag.moved || Math.hypot(d[0], d[1]) > 0 })
    } else if (drag.kind === 'corner') {
      setDrag({ ...drag, ring: drag.ring.map((p, i) => (i === drag.i ? snapXY(m, st) : p)) })
    } else if (drag.kind === 'push' || drag.kind === 'wall') {
      const raw = (m[0] - drag.start[0]) * drag.n[0] + (m[1] - drag.start[1]) * drag.n[1]
      setDrag({ ...drag, by: Math.round(raw / st) * st })
    } else if (drag.kind === 'turn') {
      let rad = Math.atan2(m[1] - drag.c[1], m[0] - drag.c[0]) - Math.atan2(drag.start[1] - drag.c[1], drag.start[0] - drag.c[0])
      if (!e.shiftKey) rad = Math.round(rad / (Math.PI / 12)) * (Math.PI / 12)
      setDrag({ ...drag, rad })
    }
  }
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    const [x, y] = local(e)
    const m = toM(x, y)
    const d = drag
    setDrag(null)
    if (!d) return
    if (d.kind === 'box') {
      const ring = tool === 'tri' ? triRing(d.a, d.b) : boxRing(d.a, d.b)
      if (!ring) {
        if (tool === 'room' && d.a[0] === d.b[0] && d.a[1] === d.b[1]) return click(m, x, y, e.shiftKey)
        return tell(m, tool === 'cut' ? 'Drag a box over the building.' : 'Press and drag to draw.', !(d.a[0] === d.b[0] && d.a[1] === d.b[1]))
      }
      if (tool === 'room') {
        const r = boxRoom(plan, ring)
        if ('why' in r) return tell(d.b, r.why, true)
        commit(r.plan)
        if (r.said) tell(d.b, r.said)
        return setSel({ kind: 'rooms', ids: [r.plan.rooms[r.plan.rooms.length - 1]!.id] })
      }
      const mid2: XY = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2]
      if (tool === 'cut') return apply(cutShape(plan, ring), d.b)
      return apply(addShape(plan, ring), d.b, mid2)
    }
    if (d.kind === 'move') {
      if (!d.moved) {
        // A tap: choose the block (Shift: add or take away).
        if (d.sh) {
          const idx = selBlocks.includes(d.tapped) ? selBlocks.filter((i) => i !== d.tapped) : [...selBlocks, d.tapped]
          return setSel(idx.length ? { kind: 'blocks', idx } : null)
        }
        return setSel({ kind: 'blocks', idx: [d.tapped] })
      }
      const at = labelAt(moveBlocks(d.base, d.idx, d.d).blocks[d.tapped]!)
      const r = dropBlocks(moveBlocks(d.base, d.idx, d.d), 'Moved')
      if ('why' in r) return tell(m, r.why, true)
      commit(r.plan)
      if (r.said) tell(m, r.said)
      return r.plan.blocks.length !== d.base.blocks.length ? chooseAt(r.plan, at) : setSel({ kind: 'blocks', idx: d.idx })
    }
    if (d.kind === 'turn') {
      if (Math.abs(d.rad) < 1e-9) return
      const r = dropBlocks(turnBlocks(d.base, d.idx, d.rad, d.c), 'Turned')
      if ('why' in r) return tell(m, r.why, true)
      commit(r.plan)
      if (r.said) tell(m, r.said)
      return
    }
    if (d.kind === 'push') {
      if (Math.abs(d.by) < 1e-9) return setSel({ kind: 'wall', index: d.run })
      return apply(pushWall(d.base, d.block, d.side, d.by), m)
    }
    if (d.kind === 'wall') {
      if (Math.abs(d.by) < 1e-9) return click(m, x, y, e.shiftKey)
      const r = moveWall(d.base, d.side, d.by)
      if ('why' in r) return tell(m, r.why, true)
      return commit(r.plan)
    }
    if (d.kind === 'corner') {
      const before = d.base.blocks[d.block]!
      if (d.ring.length === before.length && d.ring.every((p, i) => dist(p, before[i]!) < 1e-9)) return
      return apply(setBlock(d.base, d.block, d.ring), m, labelAt(d.ring))
    }
    if (d.kind === 'pan' && !d.moved) click(m, x, y, e.shiftKey)
  }
  const onDouble = (e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== 'select' || !has) return
    const r = (e.currentTarget as Element).getBoundingClientRect()
    const c = cornerAt(e.clientX - r.left, e.clientY - r.top)
    if (!c) return
    const b = plan.blocks[c.block]!
    apply(setBlock(plan, c.block, b.filter((_, j) => j !== c.i)), b[c.i]!)
  }
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const r = (e.currentTarget as Element).getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const before = toM(x, y)
    const k = Math.max(3, Math.min(200, view.k * Math.exp(-e.deltaY * 0.0015)))
    setView({ k, cx: before[0] - (x - mid[0]) / k, cy: before[1] + (y - mid[1]) / k })
  }

  const click = (m: XY, x: number, y: number, sh = false) => {
    if (tool === 'shape') {
      const at = sh ? m : snapXY(m, GRID)
      const o = core.tap(at, { mPerPx, shift: sh })
      if (o.kind === 'refused') return tell(o.at, o.message, true)
      if (o.kind === 'finished') {
        core.reset()
        return apply(addShape(plan, ccw(o.shape)), at, labelAt(o.shape))
      }
      return
    }
    if (tool === 'select') return setSel(null)
    if (tool === 'divide') {
      if (!plan.rooms.length) return tell(m, 'Draw the building first.', true)
      const h = nearestEdge(rings, m, SNAP_PX * 1.5 * mPerPx, SNAP_PX * mPerPx)
      if (!h) return tell(m, 'Tap on a wall.', true)
      if (!cutFrom) return setCutFrom(h)
      const r = divideRoom(plan, cutFrom.p, h.p)
      setCutFrom(null)
      if ('why' in r) return tell(h.p, r.why, true)
      return commit(r.plan)
    }
    const ri = zoneAt(rings, m)
    const room = ri >= 0 ? plan.rooms[ri]! : null
    if (tool === 'halve') {
      if (!room) return tell(m, 'Tap a room.', true)
      const r = halveRoom(plan, room.id)
      if ('why' in r) return tell(m, r.why, true)
      return commit(r.plan)
    }
    if (tool === 'join') {
      if (!room) return tell(m, 'Tap a room.', true)
      if (!joinFrom || joinFrom === room.id) return setJoinFrom(room.id)
      const r = joinRooms(plan, [joinFrom, room.id])
      setJoinFrom(null)
      if ('why' in r) return tell(m, r.why, true)
      commit(r.plan)
      return setSel({ kind: 'rooms', ids: [joinFrom] })
    }
    if (tool === 'pick' || tool === 'room') {
      const w = wallAt(x, y)
      if (w != null && tool === 'pick') return setSel({ kind: 'wall', index: w })
      if (!room) return setSel(null)
      if (sh && sel?.kind === 'rooms') {
        const ids = sel.ids.includes(room.id) ? sel.ids.filter((i) => i !== room.id) : [...sel.ids, room.id]
        return setSel(ids.length ? { kind: 'rooms', ids } : null)
      }
      return setSel({ kind: 'rooms', ids: [room.id] })
    }
  }

  const copy = (i: number) => {
    const r = copyBlock(plan, i)
    if ('why' in r) return
    commit(r.plan)
    setSel({ kind: 'blocks', idx: [r.plan.blocks.length - 1] })
    fitTo(r.plan.blocks.flat())
    setSay({ x: size[0] / 2, y: 90, text: r.said ?? 'Copied' })
  }
  const remove = (idx: number[]) => {
    let p = plan
    for (const i of [...idx].sort((a, b) => b - a)) p = removeBlock(p, i)
    commit(p)
    setSel(null)
  }

  // ─── keys ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setShift(e.shiftKey)
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
      const ctl = e.ctrlKey || e.metaKey
      if (ctl && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (tool === 'shape' && cs.corners.length) return void core.undo()
        return e.shiftKey ? redo() : undo()
      }
      if (ctl && e.key.toLowerCase() === 'y') return void (e.preventDefault(), redo())
      if (ctl && e.key.toLowerCase() === 'c' && selBlocks.length) return void (e.preventDefault(), setClip(selBlocks[0]!))
      if (ctl && e.key.toLowerCase() === 'v' && clip != null && plan.blocks[clip]) return void (e.preventDefault(), copy(clip))
      if (ctl && e.key.toLowerCase() === 'd' && selBlocks.length) return void (e.preventDefault(), copy(selBlocks[0]!))
      if ((e.key === 'Delete' || (e.key === 'Backspace' && tool !== 'shape')) && selBlocks.length && mode === 'outline') return void (e.preventDefault(), remove(selBlocks))
      if (e.key === 'Enter' && tool === 'shape') {
        const o = core.finish(mPerPx)
        if (o.kind === 'refused') return tell(o.at, o.message, true)
        if (o.kind === 'finished') {
          core.reset()
          return apply(addShape(plan, ccw(o.shape)), o.shape[0]!, labelAt(o.shape))
        }
      }
      if (e.key === 'Backspace' && tool === 'shape') return void core.back()
      if (e.key === 'Escape') {
        core.clear()
        setCutFrom(null)
        setJoinFrom(null)
        setDrag(null)
        setSel(null)
      }
      const t = TOOLS[mode][Number(e.key) - 1]
      if (t && !ctl && !e.altKey) pick(t.key)
    }
    const onKeyUp = (e: KeyboardEvent) => setShift(e.shiftKey)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  })

  const pick = (t: Tool) => {
    setTool(t)
    setCutFrom(null)
    setJoinFrom(null)
    core.reset()
    if (sel?.kind === 'rooms' && t !== 'pick' && t !== 'room') setSel(null)
    if (sel?.kind === 'wall' && t !== 'select' && t !== 'pick') setSel(null)
  }
  const toMode = (m: Mode) => {
    setMode(m)
    setSel(null)
    setTool(FIRST[m])
    setCutFrom(null)
    setJoinFrom(null)
    core.reset()
  }

  // ─── the wall card's form ──────────────────────────────────────────────────
  const selWall = sel?.kind === 'wall' ? runs[sel.index] : undefined
  const selSet = selWall ? plan.windows.find((w) => w.wall === selWall.index) : undefined
  const [form, setForm] = useState({ count: '3', area: '1', height: '1.2', sill: '0.9' })
  useEffect(() => {
    if (selSet) setForm({ count: String(selSet.count), area: String(Math.round(selSet.width_m * selSet.height_m * 100) / 100), height: String(selSet.height_m), sill: String(selSet.sill_m) })
  }, [selSet?.id, sel]) // eslint-disable-line react-hooks/exhaustive-deps
  const draft: WindowSet | null = selWall
    ? { id: selSet?.id ?? `w${Date.now().toString(36)}`, wall: selWall.index, count: Number(form.count), height_m: Number(form.height), width_m: Number(form.area) / Number(form.height), sill_m: Number(form.sill) }
    : null
  const lay = selWall && draft ? layoutSet(selWall, draft, plan.storey_height_m) : null

  // ─── rooms and zones ───────────────────────────────────────────────────────
  const selRooms = sel?.kind === 'rooms' ? plan.rooms.filter((r) => sel.ids.includes(r.id)) : []
  const roomsIn = (zid: string) => plan.rooms.filter((r) => r.zone === zid)
  const setZoneOf = (v: string) => {
    if (v === '__mixed' || !selRooms.length) return
    let p = plan
    let zid = v
    if (v === '__new') {
      const z = blankZone(plan.next.zone)
      p = { ...plan, zones: [...plan.zones, z], next: { ...plan.next, zone: plan.next.zone + 1 } }
      zid = z.id
    }
    commit(assignZone(p, selRooms.map((r) => r.id), zid))
  }
  const tintOf = (zid: string) => zoneTint(Math.max(0, plan.zones.findIndex((z) => z.id === zid)))

  // ─── paint ─────────────────────────────────────────────────────────────────
  const P = (r: readonly XY[]) => r.map((p) => toPx(p).map((n) => n.toFixed(1)).join(',')).join(' ')
  const grid = (() => {
    const out: JSX.Element[] = []
    const g = view.k >= 16 ? 1 : 5
    const [x0, y1] = toM(0, 0)
    const [x1, y0] = toM(size[0], size[1])
    for (let x = Math.floor(x0 / g) * g; x <= x1; x += g) {
      const px = toPx([x, 0])[0]
      out.push(<line key={`x${x}`} className={`gl-gridline${Math.round(x) % 5 === 0 ? ' five' : ''}`} x1={px} x2={px} y1={0} y2={size[1]} />)
    }
    for (let y = Math.floor(y0 / g) * g; y <= y1; y += g) {
      const py = toPx([0, y])[1]
      out.push(<line key={`y${y}`} className={`gl-gridline${Math.round(y) % 5 === 0 ? ' five' : ''}`} y1={py} y2={py} x1={0} x2={size[0]} />)
    }
    return out
  })()
  const lenLabel = (a: XY, b: XY, key: string, live = false) => {
    const [ax, ay] = toPx(a)
    const [bx, by] = toPx(b)
    const L = Math.hypot(bx - ax, by - ay)
    if (L < 26) return null
    const nx = -(by - ay) / L
    const ny = (bx - ax) / L
    return (
      <text key={key} className={`gl-len${live ? ' live' : ''}`} x={(ax + bx) / 2 + nx * (15 + Math.abs(nx) * 16)} y={(ay + by) / 2 + ny * 15 + 4} textAnchor="middle">
        {f1(dist(a, b))} m
      </text>
    )
  }
  const hoverWall = (tool === 'select' || tool === 'pick' || tool === 'corner') && !drag && pointer ? wallAt(...toPx(pointer)) : null
  const hoverInner = tool === 'pick' && !drag && pointer && hoverWall == null ? innerSideAt(plan, pointer, GRAB * mPerPx) : null
  const liveInner = drag?.kind === 'wall' ? (() => { const r = moveWall(drag.base, drag.side, drag.by); return 'why' in r ? null : sideEnds(r.plan, drag.side) })() : hoverInner ? sideEnds(plan, hoverInner) : null
  const pushed = drag?.kind === 'push' ? shownRuns.find((r) => r.block === drag.block && r.side === drag.side) : undefined
  const th = turnHandle()
  const boxGhost = drag?.kind === 'box' ? (tool === 'tri' ? triRing(drag.a, drag.b) : boxRing(drag.a, drag.b)) : null
  const shapeGhost = tool === 'shape' && pointer && cs.corners.length ? (shift ? pointer : snapXY(pointer, GRID)) : null
  const closing = tool === 'shape' && shapeGhost && cs.corners.length >= 3 && Math.hypot(toPx(cs.corners[0] as XY)[0] - toPx(shapeGhost)[0], toPx(cs.corners[0] as XY)[1] - toPx(shapeGhost)[1]) <= CLOSE_PX
  const splitHit = tool === 'divide' && pointer ? nearestEdge(rings, pointer, SNAP_PX * 1.5 * mPerPx, SNAP_PX * mPerPx) : null
  const cornerGhost = tool === 'corner' && hoverWall != null && pointer ? onWall(hoverWall, pointer, step) : null
  const scaleM = [1, 2, 5, 10, 20, 50].find((s) => s * view.k >= 60) ?? 50
  const overBlock = pointer && mode === 'outline' ? blockAt(plan, pointer) >= 0 : false
  const cursor =
    drag?.kind === 'pan' && drag.moved ? 'grabbing'
    : drag?.kind === 'move' || drag?.kind === 'turn' ? 'grabbing'
    : drag?.kind === 'wall' || drag?.kind === 'push' || hoverInner || (tool === 'select' && hoverWall != null) ? 'col-resize'
    : tool === 'select' ? (overBlock ? 'move' : 'default')
    : tool === 'pick' ? 'pointer'
    : tool === 'corner' ? (hoverWall != null ? 'copy' : 'default')
    : 'crosshair'
  const tipLine =
    tool === 'divide' && cutFrom ? 'Now tap the other end. Esc to cancel.'
    : tool === 'join' && joinFrom ? 'Now tap the room beside it.'
    : drag?.kind === 'wall' || drag?.kind === 'push' ? `${drag.by >= 0 ? 'Out' : 'In'} ${f1(Math.abs(drag.by))} m${shift ? '' : ' (0.5 m steps; Shift: 0.1 m)'}`
    : drag?.kind === 'turn' ? `Turned ${Math.round((drag.rad * 180) / Math.PI)}°${shift ? '' : ' (15° steps; Shift: free)'}`
    : TOOLS[mode].find((t) => t.key === tool)?.line ?? ''
  const chosen = new Set(sel?.kind === 'rooms' ? sel.ids : joinFrom ? [joinFrom] : [])
  const chosenBlocks = new Set(drag?.kind === 'move' || drag?.kind === 'turn' ? drag.idx : selBlocks)

  return (
    <div className="gl-root" ref={host}>
      <svg className="gl-svg" width={size[0]} height={size[1]} style={{ cursor }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setPointer(null)} onDoubleClick={onDouble} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}>
        {grid}
        {shown.blocks.map((b, i) => <polygon key={`f${i}`} className="gl-floor" points={P(b)} />)}
        {inRooms &&
          shown.rooms.map((r) => <polygon key={r.id} className={`gl-room${chosen.has(r.id) ? ' on' : ''}`} points={P(r.ring)} fill={tintOf(r.zone).fill} />)}
        {liveInner && <line className="gl-wall-hover" x1={toPx(liveInner[0])[0]} y1={toPx(liveInner[0])[1]} x2={toPx(liveInner[1])[0]} y2={toPx(liveInner[1])[1]} />}
        {shown.blocks.map((b, i) => <polygon key={`s${i}`} className={`gl-shell${chosenBlocks.has(i) || (drag && drag.kind === 'corner' && drag.block === i) ? ' chosen' : ''}`} points={P(b)} />)}
        {hoverWall != null && sel?.kind !== 'wall' && (() => {
          const r = runs[hoverWall]!
          return <line className="gl-wall-hover" x1={toPx(r.a)[0]} y1={toPx(r.a)[1]} x2={toPx(r.b)[0]} y2={toPx(r.b)[1]} />
        })()}
        {pushed && <line className="gl-wall-on" x1={toPx(pushed.a)[0]} y1={toPx(pushed.a)[1]} x2={toPx(pushed.b)[0]} y2={toPx(pushed.b)[1]} />}
        {selWall && !drag && <line className="gl-wall-on" x1={toPx(selWall.a)[0]} y1={toPx(selWall.a)[1]} x2={toPx(selWall.b)[0]} y2={toPx(selWall.b)[1]} />}
        {!drag &&
          placed.map((w, i) => {
            const r = runs[w.wall]
            if (!r) return null
            const [ax, ay] = toPx(along(r, w.offset_m))
            const [bx, by] = toPx(along(r, w.offset_m + w.width_m))
            return (
              <g key={`w${i}`}>
                <line className="gl-win" x1={ax} y1={ay} x2={bx} y2={by} />
                <line className="gl-win-glass" x1={ax} y1={ay} x2={bx} y2={by} />
              </g>
            )
          })}
        {shownRuns.map((r) => lenLabel(r.a, r.b, `l${r.index}`, (drag?.kind === 'corner' && drag.block === r.block) || (drag?.kind === 'push' && drag.block === r.block)))}
        {inRooms
          ? shown.rooms.map((r) => {
              const on = chosen.has(r.id)
              const [lx, ly] = toPx(labelAt(r.ring))
              const xs = r.ring.map((p) => toPx(p)[0])
              const wide = Math.max(...xs) - Math.min(...xs)
              if (wide < 34) return null
              return (
                <g key={`rl${r.id}`}>
                  <text className={`gl-zname${on ? ' on' : ''}`} x={lx} y={ly}>{r.name}</text>
                  {wide > 56 && <text className={`gl-zarea${on ? ' on' : ''}`} x={lx} y={ly + 15}>{f1(ringArea(r.ring))} m²</text>}
                </g>
              )
            })
          : shown.blocks.map((b, i) => {
              const [lx, ly] = toPx(labelAt(b))
              return <text key={`bl${i}`} className="gl-zarea" x={lx} y={ly + 4}>{f1(ringArea(b))} m²</text>
            })}

        {/* select: the chosen block's corners and turn handle */}
        {handleBlocks.length > 0 && !(drag && (drag.kind === 'move' || drag.kind === 'turn' || drag.kind === 'push')) && (
          <g>{handleBlocks.flatMap((bi) => (shown.blocks[bi] ?? []).map((p, i) => <circle key={`c${bi}-${i}`} className="gl-handle" cx={toPx(p)[0]} cy={toPx(p)[1]} r={tool === 'corner' ? 4.5 : 6} />))}</g>
        )}
        {th && !(drag && (drag.kind === 'corner' || drag.kind === 'push')) && (
          <g>
            <line className="gl-stalk" x1={th.at[0]} y1={th.at[1] + 10} x2={th.at[0]} y2={th.at[1] + 20} />
            <circle className="gl-turn" cx={th.at[0]} cy={th.at[1]} r={10} />
            <path className="gl-turn-glyph" d={`M${th.at[0] + 4.5} ${th.at[1] - 2} A5 5 0 1 0 ${th.at[0] + 4} ${th.at[1] + 3.2}`} />
            <path className="gl-turn-glyph" d={`M${th.at[0] + 4.8} ${th.at[1] - 5.5} L${th.at[0] + 4.6} ${th.at[1] - 1.8} L${th.at[0] + 1.2} ${th.at[1] - 2.4}`} />
          </g>
        )}
        {cornerGhost && !drag && <circle className="gl-corner first" cx={toPx(cornerGhost)[0]} cy={toPx(cornerGhost)[1]} r={6} />}

        {/* drawing ghosts */}
        {boxGhost && (
          <g>
            <polygon className={`gl-ghost${tool === 'cut' ? ' cut' : ''}${tool === 'room' ? ' room' : ''}`} points={P(boxGhost)} />
            {boxGhost.map((a, i) => (i < 2 ? lenLabel(a, boxGhost[(i + 1) % boxGhost.length]!, `bg${i}`, true) : null))}
          </g>
        )}
        {tool === 'shape' && cs.corners.length > 0 && (
          <g>
            <polyline className="gl-draw-line" points={P(cs.corners as XY[])} />
            {(cs.corners as XY[]).slice(1).map((c, i) => lenLabel(cs.corners[i] as XY, c, `dl${i}`))}
            {shapeGhost && (
              <>
                <line className="gl-ghost-line" x1={toPx(cs.corners[cs.corners.length - 1] as XY)[0]} y1={toPx(cs.corners[cs.corners.length - 1] as XY)[1]} x2={toPx(shapeGhost)[0]} y2={toPx(shapeGhost)[1]} />
                {lenLabel(cs.corners[cs.corners.length - 1] as XY, shapeGhost, 'gl', true)}
              </>
            )}
            {cs.refused?.sides.map((i) => {
              const a = cs.corners[i] as XY
              const b = cs.corners[(i + 1) % cs.corners.length] as XY
              return <line key={`bad${i}`} className="gl-bad-line" x1={toPx(a)[0]} y1={toPx(a)[1]} x2={toPx(b)[0]} y2={toPx(b)[1]} />
            })}
            {(cs.corners as XY[]).map((c, i) => <circle key={`sc${i}`} className={`gl-corner${i === 0 ? ' first' : ''}`} cx={toPx(c)[0]} cy={toPx(c)[1]} r={i === 0 ? (closing ? 9 : 7) : 4.5} />)}
          </g>
        )}
        {tool === 'divide' && (
          <g>
            {cutFrom && <line className="gl-ghost-line" x1={toPx(cutFrom.p)[0]} y1={toPx(cutFrom.p)[1]} x2={toPx(splitHit?.p ?? pointer ?? cutFrom.p)[0]} y2={toPx(splitHit?.p ?? pointer ?? cutFrom.p)[1]} />}
            {cutFrom && <circle className="gl-corner first" cx={toPx(cutFrom.p)[0]} cy={toPx(cutFrom.p)[1]} r={5} />}
            {splitHit && <circle className="gl-corner" cx={toPx(splitHit.p)[0]} cy={toPx(splitHit.p)[1]} r={splitHit.corner ? 7 : 5} />}
          </g>
        )}
        {(tool === 'rect' || tool === 'tri' || tool === 'cut' || tool === 'room') && pointer && !drag && (() => {
          const s = snapXY(pointer, step)
          return <circle className="gl-corner" cx={toPx(s)[0]} cy={toPx(s)[1]} r={4} />
        })()}
      </svg>

      {say && <div className={`gl-pill${say.bad ? ' bad' : ''}`} style={{ left: say.x, top: say.y }}>{say.text}</div>}

      {/* ─── left: the steps and the building ─── */}
      <aside className="gl-panel gl-left">
        <div className="gl-head">
          <h2>Building geometry</h2>
          <p>Simulate v2 prototype. Nothing here is saved.</p>
        </div>
        <div className="gl-steps" role="tablist" aria-label="Steps">
          <button type="button" role="tab" aria-selected={mode === 'outline'} onClick={() => toMode('outline')}>
            <i>1</i>
            <span>Outline<small>The building's shape</small></span>
          </button>
          <button type="button" role="tab" aria-selected={mode === 'rooms'} disabled={!has} onClick={() => toMode('rooms')}>
            <i>2</i>
            <span>Rooms<small>Walls inside, and zones</small></span>
          </button>
        </div>
        <div className="gl-body">
          {!has && (
            <div className="gl-sec">
              <p className="gl-say">Press and drag a rectangle for the building. Add more rectangles or triangles to make an L or a T, or tap corners with Shape.</p>
              <button type="button" className="gl-btn quiet" onClick={() => { const r = addShape(plan, EXAMPLE); if (!('why' in r)) { commit(r.plan); fitTo(EXAMPLE); pick('select'); setSel({ kind: 'blocks', idx: [0] }) } }}>
                Start from an example
              </button>
            </div>
          )}
          {has && (
            <>
              <div className="gl-sec">
                <h3>Building <small>{f1(floorArea(plan.blocks))} m² · {runs.length} walls{plan.blocks.length > 1 ? ` · ${plan.blocks.length} blocks` : ''}</small></h3>
                <div className="gl-row">
                  <span>Storey height</span>
                  <Num value={plan.storey_height_m} unit="m" onCommit={(v) => v > 0 && commit({ ...plan, storey_height_m: v })} />
                </div>
                <div className="gl-btns">
                  <button type="button" className="gl-btn quiet" onClick={() => fitTo(plan.blocks.flat())}>Fit to screen</button>
                  <button type="button" className="gl-btn quiet" onClick={() => { commit({ ...emptyPlan(), storey_height_m: plan.storey_height_m }); setSel(null); toMode('outline'); setTool('rect') }}>Clear all</button>
                </div>
              </div>
              {mode === 'outline' && (
                <div className="gl-sec">
                  <p className="gl-say">When the outline is right, cut it into rooms by drawing walls across it.</p>
                  <button type="button" className="gl-btn" onClick={() => toMode('rooms')}>Next: rooms →</button>
                </div>
              )}
              {mode === 'rooms' && (
                <div className="gl-sec">
                  <h3>Zones <small>{plan.zones.length}</small></h3>
                  <div className="gl-zones">
                    {plan.zones.map((z, i) => {
                      const rs = roomsIn(z.id)
                      const allOn = rs.length > 0 && rs.every((r) => chosen.has(r.id))
                      return (
                        <div key={z.id} className="gl-zonerow" aria-selected={allOn} onClick={() => { if (rs.length) { setSel({ kind: 'rooms', ids: rs.map((r) => r.id) }); setTool('pick') } }}>
                          <span className="gl-sw" style={{ background: zoneTint(i).fill, borderColor: zoneTint(i).line }} />
                          <input aria-label="Zone name" defaultValue={z.name} key={`${z.id}-${z.name}`} onClick={(e) => e.stopPropagation()} onBlur={(e) => e.target.value.trim() && e.target.value !== z.name && commit({ ...plan, zones: plan.zones.map((q) => (q.id === z.id ? { ...q, name: e.target.value.trim() } : q)) })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                          {rs.length ? <small>{rs.length} room{rs.length === 1 ? '' : 's'} · {f1(rs.reduce((t, r) => t + ringArea(r.ring), 0))} m²</small> : (
                            <button type="button" className="gl-x small" title="Remove this empty zone" onClick={(e) => { e.stopPropagation(); commit({ ...plan, zones: plan.zones.filter((q) => q.id !== z.id) }) }}>×</button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p className="gl-hint">Every room starts in Zone 1. Choose rooms (Select, Shift for more) to put them in another zone. Tap a zone to choose all its rooms.</p>
                </div>
              )}
              <div className="gl-sec">
                <h3>Model document</h3>
                <span className={`gl-chip ${built.ok ? 'ok' : 'no'}`}>{built.ok ? `✓ Valid · schema ${(built.doc as { schema_version: string }).schema_version}` : 'Not valid'}</span>
                <table className="gl-facts">
                  <tbody>
                    <tr><td>Zones · rooms</td><td className="n">{built.totals.zones} · {built.totals.rooms}</td></tr>
                    <tr><td>Floor area</td><td className="n">{f1(built.totals.floor_m2)} m²</td></tr>
                    <tr><td>External wall (net)</td><td className="n">{f1(built.totals.wall_net_m2)} m²</td></tr>
                    <tr><td>Windows</td><td className="n">{built.totals.windows} · {f2(built.totals.glazing_m2)} m²</td></tr>
                    <tr><td>Partitions between zones</td><td className="n">{built.totals.partitions}</td></tr>
                  </tbody>
                </table>
                {built.notes.map((n, i) => <p key={i} className="gl-warn">{n}</p>)}
                {built.issues.map((x, i) => <p key={i} className="gl-err">{x.path}: {x.message}</p>)}
                <button type="button" className="gl-btn quiet" onClick={() => setShowJson((s) => !s)}>{showJson ? 'Hide' : 'Show'} the JSON</button>
                {showJson && <pre className="gl-json">{JSON.stringify(built.doc, null, 1)}</pre>}
                <p className="gl-hint">Constructions, systems, profiles and weather are assigned on their own pages, so they stay unset here.</p>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* ─── right: the thing in hand ─── */}
      {selWall && (
        <aside className="gl-panel gl-right">
          <div className="gl-card-head">
            <div>
              <b>Wall {selWall.index + 1}</b>
              <small>{f2(selWall.length_m)} m · faces {compass16(selWall.azimuth_deg)} ({Math.round(selWall.azimuth_deg)}°)</small>
            </div>
            <button type="button" className="gl-x" aria-label="Close" onClick={() => setSel(null)}>×</button>
          </div>
          <div className="gl-body">
            <div className="gl-sec">
              <h3>Windows <small>spaced equally</small></h3>
              <div className="gl-row"><span>How many</span><Num value={form.count} onChange={(s) => setForm({ ...form, count: s })} /></div>
              <div className="gl-row"><span>Area of each</span><Num value={form.area} unit="m²" onChange={(s) => setForm({ ...form, area: s })} /></div>
              <div className="gl-row"><span>Height</span><Num value={form.height} unit="m" onChange={(s) => setForm({ ...form, height: s })} /></div>
              <div className="gl-row"><span>Sill height</span><Num value={form.sill} unit="m" onChange={(s) => setForm({ ...form, sill: s })} /></div>
              {lay && 'why' in lay && <p className="gl-err">{lay.why}</p>}
              {draft && lay && !('why' in lay) && (
                <>
                  <p className="gl-hint">
                    Each {f2(draft.width_m)} m wide, {f2(lay.gap_m)} m apart. {f2(draft.count * draft.width_m * draft.height_m)} m² of glass, {Math.round((100 * draft.count * draft.width_m * draft.height_m) / (selWall.length_m * plan.storey_height_m))}% of this wall.
                  </p>
                  <Elevation length={selWall.length_m} height={plan.storey_height_m} windows={lay.windows} />
                </>
              )}
              <div className="gl-btns">
                <button type="button" className="gl-btn orange" disabled={!lay || 'why' in lay} onClick={() => draft && lay && !('why' in lay) && commit({ ...plan, windows: [...plan.windows.filter((w) => w.wall !== draft.wall), draft] })}>
                  {selSet ? 'Update windows' : 'Add windows'}
                </button>
                {selSet && <button type="button" className="gl-btn quiet" onClick={() => commit({ ...plan, windows: plan.windows.filter((w) => w.wall !== selWall.index) })}>Remove</button>}
              </div>
              {mode === 'outline' && <p className="gl-hint">Drag a wall to push it straight out or in.</p>}
            </div>
          </div>
        </aside>
      )}
      {mode === 'outline' && selBlocks.length > 0 && !drag && (
        <aside className="gl-panel gl-right">
          <div className="gl-card-head">
            <div>
              <b>{selBlocks.length === 1 ? (plan.blocks.length > 1 ? `Block ${selBlocks[0]! + 1}` : 'The building') : `${selBlocks.length} blocks`}</b>
              <small>{f1(selBlocks.reduce((t, i) => t + ringArea(plan.blocks[i]!), 0))} m² · {selBlocks.reduce((t, i) => t + plan.blocks[i]!.length, 0)} walls</small>
            </div>
            <button type="button" className="gl-x" aria-label="Close" onClick={() => setSel(null)}>×</button>
          </div>
          <div className="gl-body">
            <div className="gl-sec">
              <div className="gl-btns">
                <button type="button" className="gl-btn quiet" onClick={() => copy(selBlocks[0]!)}>Copy</button>
                <button type="button" className="gl-btn quiet" onClick={() => remove(selBlocks)}>Delete</button>
              </div>
              <p className="gl-hint">Drag it to move it; dropped against another block, they join. Drag a wall to push it out, a corner to reshape, the orange handle to turn. Ctrl+C, Ctrl+V and Delete work too.</p>
            </div>
          </div>
        </aside>
      )}
      {selRooms.length > 0 && (() => {
        const one = selRooms.length === 1 ? selRooms[0]! : null
        const zones = [...new Set(selRooms.map((r) => r.zone))]
        const zv = zones.length === 1 ? zones[0]! : '__mixed'
        return (
          <aside className="gl-panel gl-right">
            <div className="gl-card-head">
              <div>
                {one ? (
                  <input className="gl-title-in" aria-label="Room name" defaultValue={one.name} key={`${one.id}-${one.name}`} onBlur={(e) => e.target.value.trim() && e.target.value !== one.name && commit({ ...plan, rooms: plan.rooms.map((r) => (r.id === one.id ? { ...r, name: e.target.value.trim() } : r)) })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                ) : (
                  <b>{selRooms.length} rooms</b>
                )}
                <small>{f1(selRooms.reduce((t, r) => t + ringArea(r.ring), 0))} m² · ground floor</small>
              </div>
              <button type="button" className="gl-x" aria-label="Close" onClick={() => setSel(null)}>×</button>
            </div>
            <div className="gl-body">
              <div className="gl-sec">
                <div className="gl-row">
                  <span>{one ? 'Zone' : 'Put them in'}</span>
                  <select className="gl-sel" value={zv} onChange={(e) => setZoneOf(e.target.value)}>
                    {zv === '__mixed' && <option value="__mixed">Several</option>}
                    {plan.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                    <option value="__new">New zone…</option>
                  </select>
                </div>
                <p className="gl-hint">A zone is a group of rooms the model treats as one space. Systems and profiles are given to zones on their own pages.</p>
              </div>
              <div className="gl-sec">
                <div className="gl-btns">
                  {selRooms.length > 1 && (
                    <button type="button" className="gl-btn quiet" onClick={() => { const r = joinRooms(plan, selRooms.map((x) => x.id)); if ('why' in r) return setSay({ x: size[0] - 320, y: 120, text: r.why, bad: true }); commit(r.plan); setSel({ kind: 'rooms', ids: [selRooms[0]!.id] }) }}>Join these rooms</button>
                  )}
                  {one && <button type="button" className="gl-btn quiet" onClick={() => { const r = halveRoom(plan, one.id); if ('why' in r) return setSay({ x: size[0] - 320, y: 120, text: r.why, bad: true }); commit(r.plan) }}>Halve</button>}
                  <button type="button" className="gl-btn quiet" onClick={() => setSel({ kind: 'rooms', ids: plan.rooms.map((r) => r.id) })}>Choose all rooms</button>
                </div>
              </div>
            </div>
          </aside>
        )
      })()}

      {/* ─── bottom: tools ─── */}
      <p className="gl-tip">{tipLine}</p>
      <div className="gl-bar" role="toolbar" aria-label={mode === 'outline' ? 'Outline tools' : 'Room tools'}>
        <span className="gl-step-tag">{mode === 'outline' ? '1 Outline' : '2 Rooms'}</span>
        {TOOLS[mode].map((t, i) => (
          <button key={t.key} type="button" className={`gl-tool${t.key === 'corner' ? ' optional' : ''}`} aria-pressed={tool === t.key} title={`${t.name} (${i + 1})`} onClick={() => pick(t.key)} disabled={(t.key === 'cut' || t.key === 'select' || t.key === 'corner') && !has}>
            <span>{t.glyph}</span>
            {t.name}
          </button>
        ))}
        <span className="gl-sep" />
        <button type="button" className="gl-tool" onClick={undo} disabled={!past.length}><span>↶</span>Undo</button>
        <button type="button" className="gl-tool" onClick={redo} disabled={!future.length}><span>↷</span>Redo</button>
      </div>
      <div className="gl-compass">
        <svg width="34" height="40" viewBox="-17 -20 34 40" aria-label="North is up">
          <circle r="15" fill="#fff" stroke="#DCE2DF" />
          <path d="M0 -11 L5 2 L0 -1 L-5 2 Z" fill="#235546" />
          <path d="M0 11 L5 2 L0 -1 L-5 2 Z" fill="#C3CBC7" />
          <text y="-22" textAnchor="middle" style={{ font: '700 11px var(--gl-detail)', fill: '#235546' }}>N</text>
        </svg>
        <div className="gl-scale" style={{ width: scaleM * view.k }}>
          <i />
          {scaleM} m
        </div>
      </div>
    </div>
  )
}

function Num({ value, unit, onCommit, onChange }: { value: number | string; unit?: string; onCommit?: (v: number) => void; onChange?: (s: string) => void }) {
  const [s, setS] = useState(String(value))
  useEffect(() => setS(String(value)), [value])
  return (
    <span className="gl-num">
      <input
        inputMode="decimal"
        value={s}
        onChange={(e) => {
          setS(e.target.value)
          onChange?.(e.target.value)
        }}
        onBlur={() => onCommit && Number.isFinite(Number(s)) && onCommit(Number(s))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {unit && <small>{unit}</small>}
    </span>
  )
}

/** The wall seen from outside: length × storey height, its windows, equally spaced. */
function Elevation({ length, height, windows }: { length: number; height: number; windows: Array<{ offset_m: number; width_m: number; height_m: number; sill_m: number }> }) {
  const W = 258
  const s = Math.min(W / length, 80 / height)
  const w = length * s
  const h = height * s
  const x0 = (W - w) / 2
  return (
    <svg className="gl-elev" viewBox={`0 0 ${W} ${h + 20}`}>
      <rect x={x0} y={2} width={w} height={h} fill="#F2EEE9" stroke="#B7AEA5" />
      {windows.map((x, i) => (
        <rect key={i} x={x0 + x.offset_m * s} y={2 + h - (x.sill_m + x.height_m) * s} width={x.width_m * s} height={x.height_m * s} fill="#BFDDEC" stroke="#1F2D27" strokeWidth={1} />
      ))}
      <text x={W / 2} y={h + 16} textAnchor="middle" style={{ font: '500 11px var(--gl-detail)', fill: '#5E6B65' }}>Seen from outside · {f2(length)} × {f2(height)} m</text>
    </svg>
  )
}
