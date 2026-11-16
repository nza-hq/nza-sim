/**
 * Sim2 geometry prototype: changes to the rooms on the floor, without a screen. Each one hands back a new plan, or a
 * reason in plain words (decodED's rule, Brief 101 D7: never refuse in silence).
 *
 * Adapted from decodED's room editor sums (nza-hq/nza-decoded @ e5174c5, src/twin/app/inside/edit.ts: rectRoom,
 * splitRoom, mergeRooms, dragWall, sideAt). The one difference: here rooms always cover the floor wall to wall, with
 * partitions of no thickness (the model document has no partition thickness), so a new room takes its space from the
 * rooms it is drawn over, and a moved wall must leave the floor still covered.
 *
 *   - fitRooms: after the outline changes, rooms are clipped to it and any new floor becomes new rooms.
 *   - boxRoom: a box drawn over the floor becomes a room; the rooms under it give up that space.
 *   - halveRoom: a room halves across its long side, square to the building (decodED's Split).
 *   - divideRoom: a room cut along a line between two points on its sides (decodED's zone cut).
 *   - joinRooms: rooms that touch become one; the first one picked stays.
 *   - moveWall: a wall between rooms moves; every room side on it moves with it (decodED's dragWall).
 */
import pc from 'polygon-clipping'
import { area, axisOf, ccw, cutZones, inside, labelAt, type XY } from './ported/zones'
import { blankZone, type Plan, type PlanRoom, wallRuns } from './plan'
import { cleanRing } from './outline'

export type RoomsChanged = { plan: Plan; said?: string } | { why: string }

/** The smallest room a change may make, m² (decodED MIN_ROOM_M2). */
export const MIN_ROOM_M2 = 1
/** Floor left over after a change that is smaller than this is given to the room beside it, not made a room. */
const CRUMB_M2 = 0.5

type PcRing = [number, number][]
const closed = (r: readonly XY[]): PcRing => [...r.map((p) => [p[0], p[1]] as [number, number]), [r[0]![0], r[0]![1]]]
const outerRings = (mp: pc.MultiPolygon): XY[][] => mp.map((poly) => cleanRing(poly[0] as XY[])).filter((r) => r.length >= 3)
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

/** The next free "Room 4" style number. */
function roomNamer(plan: Plan) {
  let n = plan.next.room
  const made = () => {
    const id = `r${n}`
    const name = `Room ${n}`
    n++
    return { id, name }
  }
  return { made, next: () => n }
}

const multi = (blocks: readonly (readonly XY[])[]): pc.MultiPolygon => blocks.map((b) => [closed(b)])

/** Do the rooms cover the blocks exactly, with no overlaps? */
export function covers(blocks: readonly (readonly XY[])[], rooms: readonly PlanRoom[]): boolean {
  const A = sum(blocks.map((b) => area(b)))
  const parts = sum(rooms.map((r) => area(r.ring)))
  if (Math.abs(parts - A) > 0.01 + 1e-4 * A) return false
  const u = pc.union(...(rooms.map((r) => [closed(r.ring)]) as [PcRing[], ...PcRing[][]]))
  const ua = sum(u.map((poly) => area(poly[0] as XY[]) - sum(poly.slice(1).map((h) => area(h as XY[])))))
  return Math.abs(ua - A) <= 0.01 + 1e-4 * A
}

/** Rooms after the outline became `blocks`: each clipped to them (and clear of the rooms before it), new floor made
 *  into rooms, crumbs given to a neighbour. */
export function fitRooms(plan: Plan, blocks: XY[][]): { plan: Plan; said?: string } {
  const shell = multi(blocks)
  const names = roomNamer(plan)
  let zones = plan.zones
  if (!zones.length) zones = [blankZone(plan.next.zone)]
  const zoneNext = plan.zones.length ? plan.next.zone : plan.next.zone + 1
  if (!blocks.length) return { plan: { ...plan, blocks, rooms: [] } }
  // A room that was a whole block (its floor not cut up yet) grows with its block instead of new floor becoming a room.
  const whole = new Set(plan.rooms.filter((r) => plan.blocks.some((b) => Math.abs(area(b) - area(r.ring)) < 0.01 && inside(b, labelAt(r.ring)))).map((r) => r.id))
  const out: PlanRoom[] = []
  let lost = 0
  for (const r of plan.rooms) {
    const clear = out.length ? pc.difference(pc.intersection([closed(r.ring)], shell), ...out.map((o) => [closed(o.ring)])) : pc.intersection([closed(r.ring)], shell)
    const pieces = outerRings(clear).sort((a, b) => area(b) - area(a))
    const keep = pieces.filter((p) => area(p) >= CRUMB_M2)
    if (!keep.length) {
      lost++
      continue
    }
    keep.forEach((p, i) => out.push(i === 0 ? { ...r, ring: p } : { ...names.made(), ring: p, zone: r.zone }))
  }
  let made = 0
  const gaps = out.length ? outerRings(pc.difference(shell, ...out.map((r) => [closed(r.ring)]))) : blocks.map((b) => ccw(b))
  for (const g of gaps.sort((a, b) => area(b) - area(a))) {
    if (area(g) < 1e-3) continue
    // A crumb joins the first room it touches (the union stays one piece); a real gap becomes a room in the zone of
    // the room it touches, or the first zone.
    const touch = out.findIndex((r) => pc.union([closed(r.ring)], [closed(g)]).length === 1)
    if (area(g) < CRUMB_M2 && touch >= 0) {
      const u = pc.union([closed(out[touch]!.ring)], [closed(g)])
      if (u[0]!.length === 1) out[touch] = { ...out[touch]!, ring: cleanRing(u[0]![0] as XY[]) }
      continue
    }
    if (area(g) < CRUMB_M2) continue
    if (touch >= 0 && whole.has(out[touch]!.id)) {
      const u = pc.union([closed(out[touch]!.ring)], [closed(g)])
      if (u.length === 1 && u[0]!.length === 1) {
        out[touch] = { ...out[touch]!, ring: cleanRing(u[0]![0] as XY[]) }
        continue
      }
    }
    out.push({ ...names.made(), ring: g, zone: touch >= 0 ? out[touch]!.zone : zones[0]!.id })
    made++
  }
  // Uncut blocks that were joined: their whole-block rooms (same zone) join too, so a joined block is one room again.
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!
      const b = out[j]!
      if (!whole.has(a.id) || !whole.has(b.id) || a.zone !== b.zone) continue
      const u = pc.union([closed(a.ring)], [closed(b.ring)])
      if (u.length !== 1 || u[0]!.length !== 1) continue
      out[i] = { ...a, ring: cleanRing(u[0]![0] as XY[]) }
      out.splice(j, 1)
      j = i
    }
  }
  const said = [made && plan.rooms.length ? `${made} new room${made > 1 ? 's' : ''} for the new floor` : '', lost ? `${lost} room${lost > 1 ? 's' : ''} removed (outside the building now)` : ''].filter(Boolean).join('; ')
  return { plan: { ...plan, blocks, zones, rooms: out, next: { ...plan.next, room: names.next(), zone: zoneNext } }, said: said || undefined }
}

/** A box drawn over the floor becomes a room; the rooms under it give that space up (and may fall into parts). */
export function boxRoom(plan: Plan, box: XY[]): RoomsChanged {
  if (!plan.blocks.length) return { why: 'Draw the building first.' }
  const within = outerRings(pc.intersection([closed(box)], multi(plan.blocks)))
  if (!within.length) return { why: 'Draw the room inside the building.' }
  if (within.length > 1) return { why: 'That box crosses outside the building. Draw it inside one part.' }
  const ring = within[0]!
  if (area(ring) < MIN_ROOM_M2) return { why: 'Drag a bigger box.' }
  const names = roomNamer(plan)
  const out: PlanRoom[] = []
  let biggestLoss = 0
  let zone = plan.rooms[0]?.zone ?? plan.zones[0]?.id
  let gone = 0
  for (const r of plan.rooms) {
    const left = outerRings(pc.difference([closed(r.ring)], [closed(ring)])).filter((p) => area(p) >= 1e-3).sort((a, b) => area(b) - area(a))
    const loss = area(r.ring) - sum(left.map(area))
    if (loss > biggestLoss) {
      biggestLoss = loss
      zone = r.zone
    }
    if (!left.length) {
      gone++
      continue
    }
    left.forEach((p, i) => out.push(i === 0 ? { ...r, ring: p } : { ...names.made(), ring: p, zone: r.zone }))
  }
  if (biggestLoss < 1e-3) return { why: 'That box is not over the floor.' }
  const small = out.find((r) => area(r.ring) < MIN_ROOM_M2)
  if (small) return { why: `That would leave a sliver of ${small.name}. Snap the box to its wall.` }
  const made = { ...names.made(), ring, zone: zone! }
  out.push(made)
  const next = { ...plan, rooms: out, next: { ...plan.next, room: names.next() } }
  if (!covers(plan.blocks, out)) return { why: 'That box does not fit the rooms here. Try it a little smaller.' }
  return { plan: next, said: gone ? `${made.name} replaces ${gone} room${gone > 1 ? 's' : ''}` : undefined }
}

/** The building's own frame (decodED edit.ts frameOf): u along its longest wall, v across. */
function frameOf(shell: readonly XY[]) {
  const ax = axisOf(shell)
  const [c, s] = ax
  return { ax, toUV: (p: XY): XY => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c], fromUV: (u: number, v: number): XY => [u * c - v * s, u * s + v * c] }
}

/** Halve a room across its long side, square to the building. The bigger half keeps the room. */
export function halveRoom(plan: Plan, id: string): RoomsChanged {
  const i = plan.rooms.findIndex((r) => r.id === id)
  const r = plan.rooms[i]
  if (!r || !plan.blocks.length) return { why: 'Tap a room to halve it.' }
  const f = frameOf(plan.blocks.find((b) => inside(b, labelAt(r.ring))) ?? plan.blocks[0]!)
  const uv = r.ring.map(f.toUV)
  const u0 = Math.min(...uv.map((p) => p[0]))
  const u1 = Math.max(...uv.map((p) => p[0]))
  const v0 = Math.min(...uv.map((p) => p[1]))
  const v1 = Math.max(...uv.map((p) => p[1]))
  const alongU = u1 - u0 >= v1 - v0
  const mid = alongU ? (u0 + u1) / 2 : (v0 + v1) / 2
  const box = (a: number, b: number, c: number, d: number) => closed([f.fromUV(a, c), f.fromUV(b, c), f.fromUV(b, d), f.fromUV(a, d)])
  const halves = (alongU ? [box(u0 - 1, mid, v0 - 1, v1 + 1), box(mid, u1 + 1, v0 - 1, v1 + 1)] : [box(u0 - 1, u1 + 1, v0 - 1, mid), box(u0 - 1, u1 + 1, mid, v1 + 1)]).map((b) =>
    outerRings(pc.intersection([closed(r.ring)], [b])),
  )
  if (halves.some((h) => h.length !== 1)) return { why: `${r.name} is an odd shape to halve. Use Divide and draw the line.` }
  const [A, B] = [halves[0]![0]!, halves[1]![0]!]
  if (area(A) < MIN_ROOM_M2 || area(B) < MIN_ROOM_M2) return { why: `${r.name} is too small to halve.` }
  const [big, small] = area(A) >= area(B) ? [A, B] : [B, A]
  const names = roomNamer(plan)
  const rooms = [...plan.rooms]
  rooms.splice(i, 1, { ...r, ring: big }, { ...names.made(), ring: small, zone: r.zone })
  return { plan: { ...plan, rooms, next: { ...plan.next, room: names.next() } } }
}

/** Cut a room along the line a→b (both on its sides): decodED's zone cut, on rooms. */
export function divideRoom(plan: Plan, a: XY, b: XY): RoomsChanged {
  const r = cutZones(plan.rooms.map((x) => x.ring), a, b)
  if ('why' in r) return { why: r.why }
  const old = plan.rooms[r.at]!
  const [big, small] = [r.zones[r.at]!, r.zones[r.at + 1]!].sort((p, q) => area(q) - area(p))
  const names = roomNamer(plan)
  const rooms = [...plan.rooms]
  rooms.splice(r.at, 1, { ...old, ring: ccw(big!) }, { ...names.made(), ring: ccw(small!), zone: old.zone })
  return { plan: { ...plan, rooms, next: { ...plan.next, room: names.next() } } }
}

/** Rooms that touch become one. The first id keeps its name and zone. */
export function joinRooms(plan: Plan, ids: readonly string[]): RoomsChanged {
  const picked = ids.map((id) => plan.rooms.find((r) => r.id === id)).filter((r): r is PlanRoom => !!r)
  if (picked.length < 2) return { why: 'Pick two or more rooms to join.' }
  const u = pc.union(...(picked.map((r) => [closed(r.ring)]) as [PcRing[], ...PcRing[][]]))
  if (u.length !== 1) return { why: 'Those rooms do not all touch.' }
  if (u[0]!.length > 1) return { why: 'That would make a room round a hole. Join them in a different order.' }
  const keep = picked[0]!
  const ring = cleanRing(u[0]![0] as XY[])
  const drop = new Set(picked.slice(1).map((r) => r.id))
  return { plan: { ...plan, rooms: plan.rooms.filter((r) => !drop.has(r.id)).map((r) => (r.id === keep.id ? { ...r, ring } : r)) }, said: `Joined into ${keep.name}` }
}

// ─── Walls between rooms (decodED edit.ts sideAt / wallOf / dragWall, partitions of no thickness) ─────────────────────

export type Side = { room: number; side: number }
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]
const len = (a: XY) => Math.hypot(a[0], a[1])
const TOL = 0.05

/** Is the side a→b along the outside wall? */
function onShell(plan: Plan, a: XY, b: XY): boolean {
  const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return wallRuns(plan.blocks).some((r) => {
    const d = sub(r.b, r.a)
    const L = len(d) || 1
    const off = Math.abs((m[0] - r.a[0]) * d[1] - (m[1] - r.a[1]) * d[0]) / L
    const t = dot(sub(m, r.a), d) / L
    return off < TOL && t > -TOL && t < L + TOL
  })
}

/** The nearest inside wall (a room side not on the outside wall) to `p`, within `reach` metres. */
export function innerSideAt(plan: Plan, p: XY, reach: number): Side | null {
  let best: Side | null = null
  let bestD = reach
  plan.rooms.forEach((r, ri) => {
    r.ring.forEach((a, i) => {
      const b = r.ring[(i + 1) % r.ring.length]!
      const ab = sub(b, a)
      const L = len(ab)
      if (L < 1e-6) return
      const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (L * L)))
      const d = len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]))
      if (d < bestD && !onShell(plan, a, b)) {
        bestD = d
        best = { room: ri, side: i }
      }
    })
  })
  return best
}

/** The two ends of a side. */
export function sideEnds(plan: Plan, s: Side): [XY, XY] {
  const r = plan.rooms[s.room]!
  return [r.ring[s.side]!, r.ring[(s.side + 1) % r.ring.length]!]
}

/** Every room side lying along the picked one (parallel, on the same line, overlapping it). */
function wallOf(plan: Plan, pick: Side): Side[] {
  const [a, b] = sideEnds(plan, pick)
  const d = sub(b, a)
  const L = len(d)
  const dir: XY = [d[0] / L, d[1] / L]
  const n: XY = [-dir[1], dir[0]]
  const out: Side[] = []
  plan.rooms.forEach((q, qi) => {
    q.ring.forEach((p0, i) => {
      const p1 = q.ring[(i + 1) % q.ring.length]!
      const e = sub(p1, p0)
      const el = len(e)
      if (el < 1e-6) return
      if (Math.abs(e[0] * dir[1] - e[1] * dir[0]) / el > 0.02) return
      if (Math.abs(dot(sub(p0, a), n)) > TOL) return
      const s0 = dot(sub(p0, a), dir)
      const s1 = dot(sub(p1, a), dir)
      if (Math.min(s0, s1) >= L - TOL || Math.max(s0, s1) <= TOL) return
      out.push({ room: qi, side: i })
    })
  })
  return out
}

/** The way a positive move goes: the picked side's normal. */
export function sideNormal(plan: Plan, pick: Side): XY {
  const [a, b] = sideEnds(plan, pick)
  const d = sub(b, a)
  const L = len(d) || 1
  return [-d[1] / L, d[0] / L]
}

/** Move the wall under `pick` by `by` metres along its normal: every room side on it moves together. */
export function moveWall(plan: Plan, pick: Side, by: number): RoomsChanged {
  if (!plan.blocks.length) return { why: 'Draw the building first.' }
  if (Math.abs(by) < 1e-6) return { plan }
  const n = sideNormal(plan, pick)
  const move: XY = [n[0] * by, n[1] * by]
  const corners = new Map<number, Set<number>>()
  for (const s of wallOf(plan, pick)) {
    const set = corners.get(s.room) ?? new Set<number>()
    set.add(s.side)
    set.add((s.side + 1) % plan.rooms[s.room]!.ring.length)
    corners.set(s.room, set)
  }
  const rooms = plan.rooms.map((r, ri) => {
    const set = corners.get(ri)
    return set ? { ...r, ring: r.ring.map((p, i) => (set.has(i) ? ([p[0] + move[0], p[1] + move[1]] as XY) : p)) } : r
  })
  for (const [ri] of corners) {
    const r = rooms[ri]!
    const was = signed(plan.rooms[ri]!.ring)
    const now = signed(r.ring)
    if (Math.sign(was) !== Math.sign(now) || Math.abs(now) < MIN_ROOM_M2) return { why: `${r.name} would be too small.` }
  }
  if (!covers(plan.blocks, rooms)) return { why: 'That wall meets another one partway along. Move it from the other side, or join rooms first.' }
  return { plan: { ...plan, rooms: rooms.map((r, ri) => (corners.has(ri) ? { ...r, ring: cleanRing(r.ring) } : r)) } }
}
const signed = (r: readonly XY[]) => r.reduce((t, p, i) => { const q = r[(i + 1) % r.length]!; return t + p[0] * q[1] - q[0] * p[1] }, 0) / 2

/** Put rooms in a zone. Zones left with no rooms stay in the list (their settings are kept) until removed. */
export function assignZone(plan: Plan, ids: readonly string[], zone: string): Plan {
  const set = new Set(ids)
  return { ...plan, rooms: plan.rooms.map((r) => (set.has(r.id) ? { ...r, zone } : r)) }
}
