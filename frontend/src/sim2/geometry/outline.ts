/**
 * Sim2 geometry prototype: changes to the building's outline, without a screen. Each one hands back a new plan, or a
 * reason in plain words (decodED's rule, Brief 101 D7: never refuse in silence).
 *
 * The outline is one or more blocks (separate shapes). Blocks never touch: a shape drawn touching a block, or a block
 * moved or pasted against another, is joined into it.
 *
 *   - addShape: a drawn box, triangle or shape joins the blocks it touches, or is a new block on its own.
 *   - cutShape: a drawn box is taken out of the blocks under it; it must not leave a hole.
 *   - setBlock: one block after a corner was dragged, added or taken away; it must not cross itself.
 *   - pushWall: one side of a block moved straight out (or in), square to itself.
 *   - moveBlocks / turnBlocks: chosen blocks (with their rooms and windows) move or turn.
 *   - copyBlock: a copy of a block (its rooms too) beside the building.
 *   - removeBlock: a block and its rooms go.
 *
 * When an outline changes, rooms are clipped to it and new floor becomes new rooms (rooms.ts fitRooms); window sets
 * stay on any wall that is still there, exactly as it was; the rest are dropped, and the reply says so.
 */
import pc from 'polygon-clipping'
import { ringCrossings } from './ported/drawCore'
import { area, ccw, inside, labelAt, type XY } from './ported/zones'
import { type Plan, type PlanRoom, type WallRun, wallRuns } from './plan'
import { fitRooms } from './rooms'

export type Changed = { plan: Plan; said?: string } | { why: string }

/** Snap to a grid of `step` metres. */
export const snapXY = (p: XY, step: number): XY => [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step]

/** A box square to the grid, from two opposite corners. */
export function boxRing(a: XY, b: XY): XY[] | null {
  if (Math.abs(b[0] - a[0]) < 0.25 || Math.abs(b[1] - a[1]) < 0.25) return null
  return ccw([a, [b[0], a[1]], b, [a[0], b[1]]])
}
/** A right-angled triangle in the box from `a` to `b`, the right angle at `a` (where the drag started). */
export function triRing(a: XY, b: XY): XY[] | null {
  if (Math.abs(b[0] - a[0]) < 0.25 || Math.abs(b[1] - a[1]) < 0.25) return null
  return ccw([a, [b[0], a[1]], [a[0], b[1]]])
}

/** Drop repeated and in-line corners (what a union leaves behind). */
export function cleanRing(r: readonly XY[]): XY[] {
  let pts = r.map((p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6] as XY)
  if (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts = pts.slice(0, -1)
  let changed = true
  while (changed && pts.length > 3) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]!
      const b = pts[i]!
      const c = pts[(i + 1) % pts.length]!
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      const same = Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6
      if (same || Math.abs(cr) < 1e-6 * (1 + Math.hypot(c[0] - a[0], c[1] - a[1]))) {
        pts.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return ccw(pts)
}

const closed = (r: readonly XY[]): [number, number][][] => [[...r.map((p) => [p[0], p[1]] as [number, number]), [r[0]![0], r[0]![1]]]]
const touches = (a: readonly XY[], b: readonly XY[]) => pc.union(closed(a), closed(b)).length === 1

/** Blocks that touch or overlap, joined; refused when a join would leave a courtyard. */
function settle(blocks: XY[][]): XY[][] | { why: string } {
  const out = blocks.map((b) => [...b])
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (!touches(out[i]!, out[j]!)) continue
      const u = pc.union(closed(out[i]!), closed(out[j]!))
      if (u[0]!.length > 1) return { why: 'That would leave a courtyard (a hole). Not yet supported.' }
      out[i] = cleanRing(u[0]![0] as XY[])
      out.splice(j, 1)
      j = i
    }
  }
  return out
}

type OnWall = { wall: number; at?: { a: XY; b: XY } }
/** Things on walls (windows, wall-type stretches) moved to the same wall in a new set of runs, found by its ends; those
 * whose wall changed are dropped and counted. */
function keepOnWalls<T extends OnWall>(list: readonly T[], before: WallRun[], after: WallRun[]): { kept: T[]; lost: number } {
  const same = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6
  let lost = 0
  const kept = list.flatMap((w) => {
    const old = w.at ?? (before[w.wall] ? { a: before[w.wall]!.a, b: before[w.wall]!.b } : undefined)
    const now = old && after.find((r) => same(r.a, old.a) && same(r.b, old.b))
    if (!now) {
      lost++
      return []
    }
    const { at: _at, ...rest } = w
    return [{ ...rest, wall: now.index } as T]
  })
  return { kept, lost }
}

/** Windows and wall-type stretches pinned to their walls' ends (before blocks are rebuilt). */
export const pinToWalls = (plan: Plan) => {
  const runs = wallRuns(plan.blocks)
  const pin = <T extends OnWall>(w: T): T => (runs[w.wall] ? { ...w, at: { a: runs[w.wall]!.a, b: runs[w.wall]!.b } } : w)
  return { ...plan, windows: plan.windows.map(pin), wall_spans: plan.wall_spans.map(pin) }
}

/** The plan with new blocks: rooms fitted to them, windows and wall types kept on walls that did not change. */
export function withBlocks(plan: Plan, blocks: XY[][], what: string): { plan: Plan; said?: string } {
  const before = wallRuns(plan.blocks)
  const after = wallRuns(blocks)
  const w = keepOnWalls(plan.windows, before, after)
  const t = keepOnWalls(plan.wall_spans, before, after)
  const fitted = fitRooms(plan, blocks)
  const notes = [fitted.said ?? '', w.lost ? `${w.lost} window${w.lost > 1 ? 's' : ''} removed (the wall changed)` : ''].filter(Boolean)
  return { plan: { ...fitted.plan, windows: w.kept, wall_spans: t.kept }, said: notes.length ? `${what}: ${notes.join('; ')}` : undefined }
}

function settled(plan: Plan, blocks: XY[][], what: string): Changed {
  const s = settle(blocks)
  if ('why' in s) return s
  const r = withBlocks(plan, s, what)
  const joined = blocks.length - s.length
  return joined > 0 ? { plan: r.plan, said: [r.said, `joined to the block it touches`].filter(Boolean).join('; ') } : r
}

export function addShape(plan: Plan, shape: XY[]): Changed {
  if (area(shape) < 1) return { why: 'Too small. Drag a bigger shape.' }
  const ring = cleanRing(shape)
  if (plan.blocks.some((b) => Math.abs(area(pc.union(closed(b), closed(ring))[0]![0] as XY[]) - area(b)) < 0.01 && touches(b, ring))) return { why: 'That is already inside the building.' }
  return settled(plan, [...plan.blocks, ring], 'Added')
}

export function cutShape(plan: Plan, shape: XY[]): Changed {
  if (!plan.blocks.length) return { why: 'Draw the building first, then cut a piece out of it.' }
  const out: XY[][] = []
  let changed = false
  for (const b of plan.blocks) {
    const d = pc.difference(closed(b), closed(shape))
    if (d.some((poly) => poly.length > 1)) return { why: 'That would make a hole in the middle. Cut from an edge.' }
    const pieces = d.map((poly) => cleanRing(poly[0] as XY[])).filter((r) => area(r) >= 0.5)
    if (Math.abs(pieces.reduce((t, r) => t + area(r), 0) - area(b)) > 0.01) changed = true
    out.push(...pieces)
  }
  if (!changed) return { why: 'That box does not overlap the building.' }
  if (!out.length) return { why: 'That would cut away the whole building.' }
  return withBlocks(plan, out, 'Cut')
}

/** One block's new outline (a corner dragged, added or taken away). */
export function setBlock(plan: Plan, i: number, ring: XY[]): Changed {
  if (ring.length < 3) return { why: 'A building needs at least 3 corners.' }
  if (ringCrossings(ring, true).length) return { why: 'Those walls cross. Move the corner.' }
  if (area(ring) < 1) return { why: 'Too small.' }
  const blocks = plan.blocks.map((b, j) => (j === i ? ccw(ring) : b))
  return settled(plan, blocks, 'Reshaped')
}

/** Push side `side` of block `i` out by `by` metres (in, when negative), square to the side. */
export function pushWall(plan: Plan, i: number, side: number, by: number): Changed {
  const b = plan.blocks[i]
  if (!b) return { why: 'That wall is gone.' }
  const a = b[side]!
  const c = b[(side + 1) % b.length]!
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1
  // Outward is on the right of an anticlockwise ring.
  const n: XY = [(c[1] - a[1]) / L, -(c[0] - a[0]) / L]
  const shift = (p: XY): XY => [p[0] + n[0] * by, p[1] + n[1] * by]
  const ring = b.map((p, k) => (k === side || k === (side + 1) % b.length ? shift(p) : p))
  // The pushed wall keeps its windows and wall types: they are pinned to where its ends move to.
  const pinned = pinToWalls(plan)
  const near = (p: XY, q: XY) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6
  const follow = <T extends { at?: { a: XY; b: XY } }>(w: T): T => (w.at && near(w.at.a, a) && near(w.at.b, c) ? { ...w, at: { a: shift(a), b: shift(c) } } : w)
  return setBlock({ ...pinned, windows: pinned.windows.map(follow), wall_spans: pinned.wall_spans.map(follow) }, i, ring)
}

/** Which block a point is in (-1 for none). */
export const blockAt = (plan: Plan, p: XY) => plan.blocks.findIndex((b) => inside(b, p))
/** The rooms in block `i`. */
export const roomsOfBlock = (plan: Plan, i: number): PlanRoom[] => plan.rooms.filter((r) => inside(plan.blocks[i] ?? [], labelAt(r.ring)))

const mapBlocks = (plan: Plan, idx: readonly number[], f: (p: XY) => XY): Plan => {
  const moving = new Set(idx.flatMap((i) => roomsOfBlock(plan, i).map((r) => r.id)))
  return {
    ...plan,
    blocks: plan.blocks.map((b, i) => (idx.includes(i) ? b.map(f) : b)),
    rooms: plan.rooms.map((r) => (moving.has(r.id) ? { ...r, ring: r.ring.map(f) } : r)),
  }
}

/** Move blocks while dragging (no joining yet). Wall numbers do not change. */
export const moveBlocks = (plan: Plan, idx: readonly number[], d: XY): Plan => mapBlocks(plan, idx, (p) => [p[0] + d[0], p[1] + d[1]])

export function centreOf(ring: readonly XY[]): XY {
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** Turn blocks by `rad` (anticlockwise) round `c` while dragging. */
export function turnBlocks(plan: Plan, idx: readonly number[], rad: number, c: XY): Plan {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return mapBlocks(plan, idx, (p) => {
    const d: XY = [p[0] - c[0], p[1] - c[1]]
    return [c[0] + d[0] * cos - d[1] * sin, c[1] + d[0] * sin + d[1] * cos]
  })
}

/** After a move or turn is let go: blocks now touching are joined (their rooms and windows kept). */
export function dropBlocks(moved: Plan, what: string): Changed {
  const s = settle(moved.blocks)
  if ('why' in s) return s
  if (s.length === moved.blocks.length) return { plan: moved }
  // The windows' walls are found by their ends, as they were after the move.
  const r = withBlocks(pinToWalls(moved), s, what)
  return { plan: r.plan, said: [`${what}: joined to the block it touches`, r.said?.replace(`${what}: `, '')].filter(Boolean).join('; ') }
}

/** A copy of block `i`, with its rooms (in the same zones) and windows, placed clear to its right. */
export function copyBlock(plan: Plan, i: number): Changed {
  const b = plan.blocks[i]
  if (!b) return { why: 'Choose a block to copy.' }
  const xs = plan.blocks.flat().map((p) => p[0])
  const bx = b.map((p) => p[0])
  const dx = Math.max(...xs) - Math.min(...bx) + 5
  const f = (p: XY): XY => [p[0] + dx, p[1]]
  let n = plan.next.room
  const rooms = roomsOfBlock(plan, i).map((r) => ({ ...r, id: `r${n}`, name: `Room ${n++}`, ring: r.ring.map(f) }))
  const runs = wallRuns(plan.blocks)
  const ring = b.map(f)
  const newRuns = wallRuns([...plan.blocks, ring]).filter((r) => r.block === plan.blocks.length)
  const copy = <T extends { wall: number }>(w: T): T[] => {
    const r = runs[w.wall]
    if (!r || r.block !== i) return []
    const to = newRuns.find((q) => q.side === r.side)
    return to ? [{ ...w, wall: to.index }] : []
  }
  const windows = plan.windows.flatMap(copy).map((w) => ({ ...w, id: `${w.id}c${n}` }))
  const spans = plan.wall_spans.flatMap(copy)
  return {
    plan: { ...plan, blocks: [...plan.blocks, ring], rooms: [...plan.rooms, ...rooms], windows: [...plan.windows, ...windows], wall_spans: [...plan.wall_spans, ...spans], next: { ...plan.next, room: n } },
    said: 'Copied. Drag it against the building to join it on.',
  }
}

/** Take block `i` away, with its rooms and windows. */
export function removeBlock(plan: Plan, i: number): Plan {
  const gone = new Set(roomsOfBlock(plan, i).map((r) => r.id))
  const runs = wallRuns(plan.blocks)
  const keep = plan.blocks.filter((_, j) => j !== i)
  const after = wallRuns(keep)
  const move = <T extends { wall: number }>(w: T): T[] => {
    const r = runs[w.wall]
    if (!r || r.block === i) return []
    const to = after.find((q) => q.block === (r.block > i ? r.block - 1 : r.block) && q.side === r.side)
    return to ? [{ ...w, wall: to.index }] : []
  }
  return { ...plan, blocks: keep, rooms: plan.rooms.filter((r) => !gone.has(r.id)), windows: plan.windows.flatMap(move), wall_spans: plan.wall_spans.flatMap(move) }
}
