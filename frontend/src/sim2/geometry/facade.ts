/**
 * Sim2 geometry prototype: outside walls in pieces. Where rooms meet an outside wall, the wall is split into one piece
 * per room: each piece is its own thermal element, with its own windows and its own wall type (an extension's walls
 * can differ from the original's). Pieces are worked out from the rooms, never stored, so they follow every edit.
 *
 * Windows are single items on a wall run (left edge `t_m`); a window belongs to the piece its middle is on. Wall types
 * are stretches of a run; a piece's type is the one at its middle (the default type where none is set).
 */
import { DEFAULT_WALL_TYPE, type Plan, type Span, type Win, edgesOf, layoutIn, wallRuns } from './plan'

/** A room's stretch of an outside wall. */
export type WallPiece = Span & { room: string; zone: string; length_m: number }

const EPS = 1e-6

/** Every wall piece, in order along each run. A room's stretches that meet on one run are one piece. */
export function wallPieces(plan: Plan): WallPiece[] {
  const zoneOf = new Map(plan.rooms.map((r) => [r.id, r.zone]))
  const bits = edgesOf(plan.blocks, plan.rooms).walls.map((w) => ({ run: w.run, t0: w.t0, t1: w.t1, room: w.piece })).sort((a, b) => a.run - b.run || a.t0 - b.t0)
  const out: WallPiece[] = []
  for (const b of bits) {
    const last = out[out.length - 1]
    if (last && last.run === b.run && last.room === b.room && b.t0 <= last.t1 + 1e-3) {
      last.t1 = Math.max(last.t1, b.t1)
      last.length_m = last.t1 - last.t0
    } else out.push({ ...b, zone: zoneOf.get(b.room) ?? '', length_m: b.t1 - b.t0 })
  }
  return out
}

/** The whole of run `i` as a span. */
export function wholeWall(plan: Plan, i: number): Span | null {
  const r = wallRuns(plan.blocks)[i]
  return r ? { run: i, t0: 0, t1: r.length_m } : null
}

const mid = (w: Win) => w.t_m + w.width_m / 2
export const inSpan = (w: Win, s: Span) => w.wall === s.run && mid(w) >= s.t0 - EPS && mid(w) <= s.t1 + EPS
export const windowsIn = (plan: Plan, s: Span) => plan.windows.filter((w) => inSpan(w, s)).sort((a, b) => a.t_m - b.t_m)

/** The piece a point `t` along run `run` is on. */
export const pieceAt = (pieces: readonly WallPiece[], run: number, t: number) => pieces.find((p) => p.run === run && t >= p.t0 - EPS && t <= p.t1 + EPS)

/** Windows that cross from one room's piece into the next (or past a corner). */
export function crossing(plan: Plan, pieces = wallPieces(plan)): Win[] {
  return plan.windows.filter((w) => {
    const p = pieceAt(pieces, w.wall, mid(w))
    return !!p && (w.t_m < p.t0 - 1e-3 || w.t_m + w.width_m > p.t1 + 1e-3)
  })
}

export type WindowSpec = { count: number; width_m: number; height_m: number; sill_m: number; shading_m: number }

let made = 0
const newId = () => `w${Date.now().toString(36)}${(made++).toString(36)}`

/** Replace the windows on a span with `spec.count` equally spaced ones (or none, for count 0). */
export function setWindowsIn(plan: Plan, s: Span, spec: WindowSpec | null): { plan: Plan } | { why: string } {
  const keep = plan.windows.filter((w) => !inSpan(w, s))
  if (!spec) return { plan: { ...plan, windows: keep } }
  const l = layoutIn(s, spec, plan.storey_height_m)
  if ('why' in l) return l
  const added: Win[] = l.windows.map((w) => ({ id: newId(), wall: s.run, t_m: w.offset_m, width_m: w.width_m, height_m: w.height_m, sill_m: w.sill_m, shading_m: w.shading_m }))
  return { plan: { ...plan, windows: [...keep, ...added] } }
}

/** Each room's windows on wall `run` spaced equally within that room's piece (same number and sizes). */
export function spaceByRoom(plan: Plan, run: number): Plan {
  let p = plan
  for (const piece of wallPieces(plan).filter((x) => x.run === run)) {
    const ws = windowsIn(plan, piece)
    if (!ws.length) continue
    const fits = ws.reduce((s, w) => s + w.width_m, 0) <= piece.length_m + EPS
    if (!fits) continue
    const gap = (piece.length_m - ws.reduce((s, w) => s + w.width_m, 0)) / (ws.length + 1)
    let t = piece.t0 + gap
    const moved = new Map<string, number>()
    for (const w of ws) {
      moved.set(w.id, t)
      t += w.width_m + gap
    }
    p = { ...p, windows: p.windows.map((w) => (moved.has(w.id) ? { ...w, t_m: moved.get(w.id)! } : w)) }
  }
  return p
}

/** Move one window along its wall to left edge `t` (kept on the wall). */
export function moveWindow(plan: Plan, id: string, t: number): Plan {
  const runs = wallRuns(plan.blocks)
  return {
    ...plan,
    windows: plan.windows.map((w) => {
      if (w.id !== id) return w
      const L = runs[w.wall]?.length_m ?? w.t_m + w.width_m
      return { ...w, t_m: Math.max(0, Math.min(L - w.width_m, t)) }
    }),
  }
}

// ─── Wall types ───────────────────────────────────────────────────────────────────────────────────

export const typeAt = (plan: Plan, run: number, t: number): string => {
  for (let i = plan.wall_spans.length - 1; i >= 0; i--) {
    const s = plan.wall_spans[i]!
    if (s.wall === run && t >= s.t0 - EPS && t <= s.t1 + EPS) return s.type
  }
  return plan.wall_types[0]?.id ?? DEFAULT_WALL_TYPE.id
}
export const typeOfSpan = (plan: Plan, s: Span) => typeAt(plan, s.run, (s.t0 + s.t1) / 2)

/** Give spans `ss` wall type `type` (stretches it now hides are dropped). */
export function setTypeOn(plan: Plan, ss: readonly Span[], type: string): Plan {
  const hidden = (x: { wall: number; t0: number; t1: number }) => ss.some((s) => s.run === x.wall && x.t0 >= s.t0 - EPS && x.t1 <= s.t1 + EPS)
  return { ...plan, wall_spans: [...plan.wall_spans.filter((x) => !hidden(x)), ...ss.map((s) => ({ wall: s.run, t0: s.t0, t1: s.t1, type }))] }
}

/** The outside wall pieces of some rooms. */
export const piecesOfRooms = (plan: Plan, ids: readonly string[]) => wallPieces(plan).filter((p) => ids.includes(p.room))

/** The colours wall types are drawn in (the first, the default, stays plain). */
export const TYPE_COLOURS = ['#9AA3A0', '#3F7FB0', '#7D5BA6', '#4E9A62', '#B65B73', '#8E7A3F']
export const typeColour = (plan: Plan, id: string) => TYPE_COLOURS[Math.max(0, plan.wall_types.findIndex((t) => t.id === id)) % TYPE_COLOURS.length]!
