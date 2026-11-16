/**
 * Sim2 geometry prototype: outside walls in pieces. Where rooms meet an outside wall, the wall is split into one piece
 * per room: each piece is its own thermal element, with its own windows and its own wall type (an extension's walls
 * can differ from the original's). Pieces are worked out from the rooms, never stored, so they follow every edit.
 *
 * Windows are single items on a wall run (left edge `t_m`); a window belongs to the piece its middle is on. Wall types
 * are stretches of a run; a piece's type is the one at its middle (the default type where none is set).
 */
import { type FabricElement, type Plan, type Span, type Win, edgesOf, layoutIn, wallRuns } from './plan'

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
export type DoorSpec = { count: number; width_m: number; height_m: number }
/** A door's usual size to start from (900 mm × 2.1 m). */
export const DOOR = { width_m: 0.9, height_m: 2.1 }

let made = 0
const newId = () => `w${Date.now().toString(36)}${(made++).toString(36)}`

/** Where the doors go among N windows + M doors: spread out, the first in the middle when there is one
 * (4 windows and a door: window, window, door, window, window). */
export const doorSlots = (n: number, m: number) => Array.from({ length: m }, (_, j) => Math.floor(((j + 0.5) * (n + m)) / m))

/** Replace the windows and doors on a span with these, all spaced equally together (gap = (L − Σ widths) / (items + 1)).
 * `null` or a count of 0 leaves none of that kind. */
export function setOpeningsIn(plan: Plan, s: Span, win: WindowSpec | null, door: DoorSpec | null = null): { plan: Plan } | { why: string } {
  const keep = plan.windows.filter((w) => !inSpan(w, s))
  const n = win && win.count > 0 ? win.count : 0
  const m = door && door.count > 0 ? door.count : 0
  if (!n && !m) return { plan: { ...plan, windows: keep } }
  if (n) {
    // The window checks (size, sill, storey height) on their own first.
    const l = layoutIn({ ...s, t1: s.t0 + 1e9 }, win!, plan.storey_height_m)
    if ('why' in l) return l
  }
  if (m) {
    if (!Number.isInteger(m)) return { why: 'Number of doors must be a whole number' }
    if (!(door!.width_m > 0) || !(door!.height_m > 0)) return { why: 'Door size must be more than zero' }
    if (door!.height_m > plan.storey_height_m + 1e-9) return { why: `A ${door!.height_m} m door is taller than the storey (${plan.storey_height_m} m)` }
  }
  const slots = new Set(doorSlots(n, m))
  const items = Array.from({ length: n + m }, (_, i) => slots.has(i))
  const total = n * (win?.width_m ?? 0) + m * (door?.width_m ?? 0)
  const L = s.t1 - s.t0
  if (total > L + 1e-9) return { why: `These need ${Math.round(total * 100) / 100} m of wall; this stretch is ${Math.round(L * 100) / 100} m` }
  const gap = (L - total) / (n + m + 1)
  let t = s.t0 + gap
  const added: Win[] = items.map((isDoor) => {
    const w: Win = isDoor
      ? { id: newId(), wall: s.run, t_m: t, width_m: door!.width_m, height_m: door!.height_m, sill_m: 0, shading_m: 0, door: true }
      : { id: newId(), wall: s.run, t_m: t, width_m: win!.width_m, height_m: win!.height_m, sill_m: win!.sill_m, shading_m: win!.shading_m }
    t += w.width_m + gap
    return w
  })
  return { plan: { ...plan, windows: [...keep, ...added] } }
}

/** Replace the windows (and doors) on a span with `spec.count` equally spaced windows. */
export const setWindowsIn = (plan: Plan, s: Span, spec: WindowSpec | null) => setOpeningsIn(plan, s, spec, null)

/** Change one window or door: move it (left edge `t_m`, and sill for a window), or turn it into a door or a window of
 * the given size, about its middle. Kept on the wall and within the storey. */
export function changeWindow(plan: Plan, id: string, to: Partial<Pick<Win, 't_m' | 'sill_m' | 'door' | 'width_m' | 'height_m'>>): Plan {
  const runs = wallRuns(plan.blocks)
  return {
    ...plan,
    windows: plan.windows.map((w) => {
      if (w.id !== id) return w
      const L = runs[w.wall]?.length_m ?? w.t_m + w.width_m
      const H = plan.storey_height_m
      const width = to.width_m ?? w.width_m
      const height = Math.min(H, to.height_m ?? w.height_m)
      const door = to.door ?? !!w.door
      const t = to.t_m ?? w.t_m + (w.width_m - width) / 2
      const sill = door ? 0 : Math.max(0, Math.min(H - height, to.sill_m ?? (w.door ? 0.9 : w.sill_m)))
      const next: Win = { ...w, width_m: width, height_m: height, sill_m: sill, t_m: Math.max(0, Math.min(L - width, t)), shading_m: door ? 0 : w.shading_m }
      if (door) next.door = true
      else delete next.door
      return next
    }),
  }
}

export const removeWindow = (plan: Plan, id: string): Plan => ({ ...plan, windows: plan.windows.filter((w) => w.id !== id) })

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

// ─── Wall types ───────────────────────────────────────────────────────────────────────────────────

type WallElement = 'wall' | 'glazing' | 'door'
/** The first (default) type of an element. */
export const firstType = (plan: Plan, e: FabricElement) => plan.fabric_types.find((t) => t.element === e)?.id ?? `f_${e}`

export const typeAt = (plan: Plan, run: number, t: number, e: WallElement = 'wall'): string => {
  for (let i = plan.wall_spans.length - 1; i >= 0; i--) {
    const s = plan.wall_spans[i]!
    if (s.wall === run && (s.element ?? 'wall') === e && t >= s.t0 - EPS && t <= s.t1 + EPS) return s.type
  }
  return firstType(plan, e)
}
export const typeOfSpan = (plan: Plan, s: Span, e: WallElement = 'wall') => typeAt(plan, s.run, (s.t0 + s.t1) / 2, e)

/** Give spans `ss` fabric type `type` (of its element; stretches it now hides are dropped). */
export function setTypeOn(plan: Plan, ss: readonly Span[], type: string): Plan {
  const e = (plan.fabric_types.find((t) => t.id === type)?.element ?? 'wall') as FabricElement
  if (e === 'roof' || e === 'floor') return plan
  const same = (x: { element?: string }) => (x.element ?? 'wall') === e
  const hidden = (x: { wall: number; t0: number; t1: number; element?: string }) => same(x) && ss.some((s) => s.run === x.wall && x.t0 >= s.t0 - EPS && x.t1 <= s.t1 + EPS)
  return { ...plan, wall_spans: [...plan.wall_spans.filter((x) => !hidden(x)), ...ss.map((s) => ({ wall: s.run, t0: s.t0, t1: s.t1, type, element: e as WallElement }))] }
}

/** A room's roof or ground floor type. */
export const roomType = (plan: Plan, roomId: string, e: 'roof' | 'floor') => plan.rooms.find((r) => r.id === roomId)?.[e] ?? firstType(plan, e)

/** Give rooms a fabric type: their roof or floor, or every outside wall part of theirs (walls, windows, doors). */
export function setTypeOnRooms(plan: Plan, ids: readonly string[], type: string): Plan {
  const e = plan.fabric_types.find((t) => t.id === type)?.element
  if (!e) return plan
  if (e === 'roof' || e === 'floor') return { ...plan, rooms: plan.rooms.map((r) => (ids.includes(r.id) ? { ...r, [e]: type } : r)) }
  return setTypeOn(plan, piecesOfRooms(plan, ids), type)
}

/** The outside wall pieces of some rooms. */
export const piecesOfRooms = (plan: Plan, ids: readonly string[]) => wallPieces(plan).filter((p) => ids.includes(p.room))

/** The colours wall types are drawn in (the first, the default, stays plain). */
export const TYPE_COLOURS = ['#9AA3A0', '#3F7FB0', '#7D5BA6', '#4E9A62', '#B65B73', '#8E7A3F']
/** A type's colour: by its place among its element's types (the first stays plain grey). */
export const typeColour = (plan: Plan, id: string) => {
  const t = plan.fabric_types.find((x) => x.id === id)
  const i = t ? plan.fabric_types.filter((x) => x.element === t.element).indexOf(t) : 0
  return TYPE_COLOURS[Math.max(0, i) % TYPE_COLOURS.length]!
}
