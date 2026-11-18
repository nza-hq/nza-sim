/**
 * Sim2 geometry prototype: the plan → a Simulate v2 model document (frontend/src/thermal/schema), checked by the
 * schema itself. The editor never writes the document by hand anywhere else (CLAUDE.md rule 4: the schema is the
 * contract).
 *
 * What the plan says, the document says: one zone per zone that has rooms, its floor outline (its rooms joined), its
 * area and its number of rooms; per zone, a wall for each room piece of the outside wall (pieces side by side in one
 * zone with one wall type are joined; true azimuth, area = length × storey height, net of its windows), the glazing on
 * that wall (window count and area), partitions
 * where its rooms meet another zone's (walls between rooms of the same zone are inside the zone, not surfaces), a roof
 * and a ground floor of its own area. The use given to a zone is its use_type; each named heating or cooling system
 * is a system group serving the zones it was given to, at 100% of their demand (one system per service per zone here).
 *
 * What the plan does not say yet is left visibly unset, never invented (CLAUDE.md rule 2 and 3): constructions are
 * `unassigned:<element>` keys (a wall type other than the first adds its id, and carries the U-value the user typed
 * as u_value_override when there is one), no profiles, a system's fuel and efficiency are null, no weather, a zone with no use is
 * "unassigned". The four optical numbers
 * schema 2.1 requires (absorptance 0.6 walls / 0.7 roofs, emissivity 0.9, frame fraction 0.20) and the internal heat
 * capacity (250,000 J/K·m²) are today's engine's own hard-coded values, named in the schema's comments.
 *
 * Window positions and room outlines are not in schema 2.x (a glazing surface is an area and a count; a zone has a
 * room count). They stay in the editor's plan; the Engine 1 thread holds window positions for schema 2.2.
 */
import pc from 'polygon-clipping'
import { ModelDocument, SCHEMA_VERSION } from '../../thermal/schema/model'
import { TODAY } from '../../thermal/schema/upgrade'
import { ALWAYS, FINISH_KEY, finishesOf, floorsOf, type PlanFloor, WINDOW_STYLES, allWindows, edgesOf, facade4, type FabricElement, hotWaterOnSpaces, isWet, coolingKind, profileOf, isTemperature, tempRange, noDhw, type Plan, type PlanSystem, SERVICES, type Service, type SpaceType, ringArea, wallRuns, noBuildingInputs } from './plan'
import { crossing, firstType, roomType, typeAt, typeOfSpan, wallPieces } from './facade'
import { construction, efficiencyFor, system } from '../library/library'
import { cleanRing } from './outline'
import type { XY } from './ported/zones'
import { type BlockRoof, LOFT_ACH, areaInside, blockRoof, roofPieces } from './roof'

const r3 = (n: number) => Math.round(n * 1000) / 1000
const is21 = (SCHEMA_VERSION as string) !== '2.0'
const is22 = is21 && (SCHEMA_VERSION as string) !== '2.1'
const is23 = is22 && (SCHEMA_VERSION as string) !== '2.2'
const is24 = is23 && (SCHEMA_VERSION as string) !== '2.3'
/** Brief 124: a library construction whose layers already include carpet (named so in the library). */
export const carpetIn = (key: string | null | undefined) => { const n = construction(key)?.name ?? ''; return /carpet/i.test(n) && !/\b(no|without) carpet/i.test(n) }
const is212 = Number((SCHEMA_VERSION as string).split('.')[1]) >= 12

export type Built = {
  doc: unknown
  ok: boolean
  issues: Array<{ path: string; message: string }>
  /** Plain-words problems from the plan itself (a window set that no longer fits, a gap between zones). */
  notes: string[]
  totals: { zones: number; rooms: number; floor_m2: number; walls: number; wall_net_m2: number; glazing: number; glazing_m2: number; windows: number; doors: number; door_m2: number; partitions: number; systems: number }
}

/**
 * Brief 123: a pitched roof. `roofs` are the blocks' roofs as Shape has them (from the roof service, or the browser
 * for rectangles); absent, rectangles are worked out here and any other outline keeps a flat roof (with a note).
 * - Insulated at the ceiling: each pitched block gets an unheated loft zone (no setpoint, no system of any kind; its
 *   own air at the loft's air changes), each room's roof becomes a ceiling to it, and the slopes and gable walls are
 *   the loft's, to outside.
 * - Insulated at the slope: the slopes and gable walls go on the rooms beneath, by floor area, and each room's
 *   height grows by its share of the roof space.
 */
export function buildDocument(plan0: Plan, roofsIn?: readonly BlockRoof[]): Built {
  const floors = floorsOf(plan0)
  return floors.length > 1 ? buildStacked(plan0, floors) : buildFloor(plan0, roofsIn)
}

/**
 * 18 Nov 2026 (RWGC clubhouse, Linzie: "add stacked floors"): a building of more than one floor. Each floor is built
 * as one floor is (walls, windows, partitions, a roof and a ground floor for every zone), its zones put on their floor,
 * and then the floors are joined where they stand on each other: where a zone's rooms lie over another zone's on the
 * floor below, that much of the lower zone's roof and the upper zone's ground floor become one floor between them
 * (ceiling from below, the 'intermediate' fabric type); an upper zone's floor over no room below is an exposed floor
 * to outside air. Floors are one storey height apart. A pitched roof is not stacked yet: every floor's roof is flat
 * (a note says so when one was chosen). Systems, profiles and controls are the building's, gathered from the floors.
 */
function buildStacked(plan0: Plan, floors: PlanFloor[]): Built {
  const notes: string[] = []
  const rooms = floors.flatMap((f) => f.rooms)
  const zoneFloor = new Map<string, number>()
  floors.forEach((f, k) => f.rooms.forEach((r) => {
    const was = zoneFloor.get(r.zone)
    if (was != null && was !== k) notes.push(`${plan0.zones.find((z) => z.id === r.zone)?.name ?? r.zone} has rooms on more than one floor; a zone is on one floor, so its rooms on ${floors[k]!.name.toLowerCase()} are left out`)
    else zoneFloor.set(r.zone, k)
  }))
  const subs = floors.map((f, k) => {
    const mine = f.rooms.filter((r) => zoneFloor.get(r.zone) === k)
    // Every room of the building, so space types, systems and emitters see the whole building; the floor's own rooms
    // for its geometry (buildFloor reads geometry from blocks, windows and the rooms of its zones).
    // Its roof: the floor's own parts, each over the rooms under it, and the rest flat (roofPieces, partial). A whole
    // block's pitched roof (no parts) is drawn only on the top floor's blocks; below one it would stand on the floor above.
    const top = k === floors.length - 1
    const roof = f.roof && f.roof.style !== 'flat' && !top && !f.roof_parts?.length ? { style: 'flat' as const } : f.roof ?? { style: 'flat' as const }
    if (roof !== f.roof && f.roof) notes.push(`${f.name}: its pitched roof covers whole blocks, which the floor above stands on; give it roof parts instead (each a rectangle), so it is flat for now`)
    const sub: Plan = { ...plan0, floors: undefined, active_floor: undefined, blocks: f.blocks, rooms: mine, windows: f.windows, wall_spans: f.wall_spans, roof, roof_parts: f.roof_parts }
    return buildFloor(sub, undefined, { loftPrefix: `f${k}_`, partialRoof: true })
  })
  // Gather: zones (on their floor), surfaces, system groups (their zones joined), profiles, controls, library refs.
  const docs = subs.map((s) => s.doc as Record<string, unknown> & { zones: Array<Record<string, unknown>>; surfaces: Array<Record<string, unknown>>; system_groups: Array<Record<string, unknown>>; profiles: Array<Record<string, unknown>>; controls?: Array<Record<string, unknown>>; library_refs: Array<Record<string, unknown>>; other_loads?: unknown[] })
  const zones = docs.flatMap((d, k) => d.zones.map((z) => ({ ...z, floor: z.use_type === 'loft' ? k + 1 : k })))
  const surfaces = docs.flatMap((d) => d.surfaces.map((s) => ({ ...s })))
  const groups = new Map<string, Record<string, unknown>>()
  for (const d of docs) for (const g of d.system_groups) {
    const was = groups.get(g.id as string)
    groups.set(g.id as string, was ? { ...g, ...was, zones: [...(was.zones as string[]), ...(g.zones as string[])] } : { ...g })
  }
  const byId = <T extends Record<string, unknown>>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()]
  const profiles = byId(docs.flatMap((d) => d.profiles), (p) => p.id as string)
  const controls = byId(docs.flatMap((d) => d.controls ?? []), (c) => c.id as string)
  // The floors between storeys' construction is pinned too (the floors' own documents never had it).
  const mid = construction(plan0.fabric_types.find((t) => t.element === 'intermediate')?.construction)
  const midPin = mid?.body_hash ? [{ kind: 'construction', key: mid.key, version: null, body_hash: mid.body_hash }] : []
  const library_refs = byId([...docs.flatMap((d) => d.library_refs), ...midPin], (r) => `${r.kind}:${r.key}`).sort((a, b) => (`${a.kind}${a.key}` < `${b.kind}${b.key}` ? -1 : 1))

  // Join the floors. Footprints: each zone's rooms, as polygon-clipping multipolygons.
  const foot = (zid: string): pc.MultiPolygon => {
    const rs = rooms.filter((r) => r.zone === zid).map((r) => [[...r.ring.map((p) => [p[0], p[1]] as [number, number]), [r.ring[0]![0], r.ring[0]![1]] as [number, number]]] as pc.Polygon)
    return rs.length ? pc.union(...(rs as [pc.Polygon, ...pc.Polygon[]])) : []
  }
  const mpArea = (mp: pc.MultiPolygon) => mp.reduce((t, poly) => t + poly.reduce((u, ring, i) => u + (i === 0 ? 1 : -1) * Math.abs(ringArea(ring.slice(0, -1) as XY[])), 0), 0)
  const zonesOn = (k: number) => [...zoneFloor.entries()].filter(([, f]) => f === k).map(([z]) => z)
  const it = plan0.fabric_types.find((t) => t.element === 'intermediate')
  const midRef = it ? (it.u != null ? { key: it.construction ?? 'unassigned:interior_floor', u_value_override: it.u } : { key: it.construction ?? 'unassigned:interior_floor' }) : { key: 'unassigned:interior_floor' }
  if (!it?.construction) notes.push('The floors between storeys have no construction yet (Fabric, Floor between storeys)')
  const take = (zid: string, kind: 'roof' | 'ground', a: number) => {
    // Take a m² off the zone's roofs (or ground floors), in proportion to their areas.
    // The flat roofs first (the floor above stands on them); a pitched roof's slopes only if they are not enough.
    const own = surfaces.filter((s) => s.zone_a === zid && s.kind === kind).sort((p, q) => (p.tilt_deg as number) - (q.tilt_deg as number))
    let left = a
    for (const s of own) {
      if (left <= 0) break
      const cut = Math.min(left, s.area_m2 as number)
      s.area_m2 = r3((s.area_m2 as number) - cut)
      left -= cut
    }
  }
  const added: Array<{ zone: string; id: string }> = []
  const zoneFoot = new Map([...zoneFloor.keys()].map((z) => [z, foot(z)]))
  for (let k = 1; k < floors.length; k++) {
    for (const up of zonesOn(k)) {
      let over = 0
      for (const lo of zonesOn(k - 1)) {
        const a = r3(mpArea(pc.intersection(zoneFoot.get(up)!, zoneFoot.get(lo)!)))
        if (a < 0.01) continue
        over += a
        take(lo, 'roof', a)
        const id = `${lo}_ceiling_${up}`
        surfaces.push({
          id, kind: 'ceiling', zone_a: lo, zone_b: up, facade: null, area_m2: a, azimuth_deg: null, tilt_deg: 0, construction_ref: midRef, g_value: null, openings: [],
          ...(is21 ? { solar_absorptance: null, thermal_emissivity: null, frame_fraction: null } : {}),
          ...(is22 ? { inside_solar_absorptance: TODAY.inside_solar_absorptance, inside_solar_absorptance_b: TODAY.inside_solar_absorptance, faces_up: null } : {}),
        })
        added.push({ zone: lo, id }, { zone: up, id })
      }
      // The upper zone's ground floor: over a room below it is the floor just made; the rest is open to outside air.
      const own = surfaces.filter((s) => s.zone_a === up && s.kind === 'ground')
      const tot = own.reduce((t, s) => t + (s.area_m2 as number), 0)
      const open = r3(Math.max(0, tot - over))
      for (const s of own) {
        s.area_m2 = r3(tot > 0 ? ((s.area_m2 as number) / tot) * open : 0)
        Object.assign(s, { kind: 'floor', zone_b: 'outside', ...(is21 ? { solar_absorptance: TODAY.roof_solar_absorptance, thermal_emissivity: TODAY.outside_emissivity } : {}), inside_finish: s.inside_finish ?? null })
      }
      if (open > 0.5) notes.push(`${plan0.zones.find((z) => z.id === up)?.name ?? up}: ${r3(open)} m² of its floor is over no room below, taken as a floor open to outside air`)
    }
  }
  // Drop what was taken to nothing, and give each zone its new surfaces.
  const gone = new Set(surfaces.filter((s) => (s.area_m2 as number) < 0.01 && (s.kind === 'roof' || s.kind === 'floor')).map((s) => s.id as string))
  const kept = surfaces.filter((s) => !gone.has(s.id as string))
  for (const z of zones) {
    z.surfaces = [...(z.surfaces as string[]).filter((sid) => !gone.has(sid)), ...added.filter((x) => x.zone === z.id).map((x) => x.id)]
  }
  const d0 = docs[0]!
  const doc = { ...d0, zones, surfaces: kept, system_groups: [...groups.values()], profiles, ...(controls.length ? { controls } : {}), library_refs }
  const res = ModelDocument.safeParse(doc)
  const sum = (k: string) => kept.filter((s) => s.kind === k)
  const t = subs.map((s) => s.totals)
  const add = (key: keyof Built['totals']) => t.reduce((s, x) => s + x[key], 0)
  return {
    doc,
    ok: res.success,
    issues: res.success ? [] : res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    notes: [...new Set([...notes, ...subs.flatMap((s, k) => s.notes.map((n) => (/^(A window|\d+ window)|separate parts|m of side/.test(n) ? `${floors[k]!.name}: ${n}` : n)))])],
    totals: {
      zones: zones.filter((z) => z.use_type !== 'loft').length, rooms: rooms.length, floor_m2: r3(add('floor_m2')),
      walls: add('walls'), wall_net_m2: r3(add('wall_net_m2')), glazing: add('glazing'), glazing_m2: r3(add('glazing_m2')), windows: add('windows'),
      doors: add('doors'), door_m2: r3(add('door_m2')), partitions: sum('partition').length, systems: groups.size,
    },
  }
}

function buildFloor(plan0: Plan, roofsIn?: readonly BlockRoof[], opts: { loftPrefix?: string; partialRoof?: boolean } = {}): Built {
  // A plan held from before Brief 112 (one building-wide hot water use) is read as its space types' own.
  const plan = hotWaterOnSpaces(plan0)
  // The project's own profiles first, then the library's (Brief 118 P5).
  const profile = (key: string | null | undefined) => profileOf(plan, key)
  const notes: string[] = []
  const h = plan.storey_height_m
  const { shares: roomShares, open } = edgesOf(plan.blocks, plan.rooms)
  const { windows, problems } = allWindows(plan)
  problems.forEach((p) => notes.push(`A window is left out: ${p.why}`))
  const roomOf = new Map(plan.rooms.map((r) => [r.id, r]))
  for (const o of open) notes.push(`${roomOf.get(o.piece)?.name ?? o.piece} has ${r3(o.length_m)} m of side that is neither outside wall nor next to another room`)
  const zoneOf = (roomId: string) => roomOf.get(roomId)?.zone ?? ''
  const used = plan.zones.filter((z) => plan.rooms.some((r) => r.zone === z.id))

  // Outside walls: one wall per room piece (facade.ts), joined where neighbouring pieces on a run are in the same zone
  // and have the same wall type. A piece with a different wall type is always its own wall.
  const runs = wallRuns(plan.blocks)
  // Walls are also split where the window or door type changes, so each surface has one construction.
  const walls: Array<{ zone: string; run: number; t0: number; t1: number; length_m: number; azimuth_deg: number; type: string; glazing: string; door: string }> = []
  for (const p of wallPieces(plan)) {
    const type = typeOfSpan(plan, p)
    const glazing = typeOfSpan(plan, p, 'glazing')
    const door = typeOfSpan(plan, p, 'door')
    const last = walls[walls.length - 1]
    if (last && last.run === p.run && last.zone === p.zone && last.type === type && last.glazing === glazing && last.door === door && p.t0 <= last.t1 + 1e-3) {
      last.t1 = p.t1
      last.length_m = last.t1 - last.t0
    } else walls.push({ zone: p.zone, run: p.run, t0: p.t0, t1: p.t1, length_m: p.length_m, azimuth_deg: runs[p.run]!.azimuth_deg, type, glazing, door })
  }
  // A fabric type's construction: its library key, or `unassigned:<element>` while none is chosen (a type other than
  // the element's first adds its id, so the types stay apart); a U-value the user typed rides on it as an override.
  const typeOf = new Map(plan.fabric_types.map((t) => [t.id, t]))
  const UNSET: Record<FabricElement, string> = { wall: 'external_wall', glazing: 'glazing', door: 'external_door', roof: 'roof', floor: 'ground_floor', partition: 'internal_wall', intermediate: 'interior_floor' }
  const constructionOf = (type: string) => {
    const t = typeOf.get(type)
    if (!t) return { key: 'unassigned:external_wall' }
    const key = t.construction ?? (t.id === firstType(plan, t.element) ? `unassigned:${UNSET[t.element]}` : `unassigned:${UNSET[t.element]}:${t.id}`)
    return t.u != null ? { key, u_value_override: t.u } : { key }
  }
  const gOf = (type: string) => construction(typeOf.get(type)?.construction)?.g ?? null
  for (const w of crossing(plan)) notes.push(`A window on wall ${w.wall + 1} crosses into the next room; it is counted in the room its middle is in`)
  // Partitions between zones: room-to-room stretches whose rooms are in different zones, summed per pair.
  const pairs = new Map<string, { a: string; b: string; length_m: number }>()
  for (const s of roomShares) {
    const [za, zb] = [zoneOf(s.a), zoneOf(s.b)].sort()
    if (za === zb) continue
    const k = `${za}|${zb}`
    const p = pairs.get(k) ?? { a: za!, b: zb!, length_m: 0 }
    p.length_m += s.length_m
    pairs.set(k, p)
  }
  const shares = [...pairs.values()]

  // Surface optics the editor does not ask for yet: today's engine values (TODAY in thermal/schema/upgrade.ts), the
  // same ones the converter from today's config writes. Inside absorptance is on both faces of a partition.
  const ext = (s: Record<string, unknown>, kind: 'wall' | 'roof' | 'glazing' | 'other') =>
    is21
      ? {
          ...s,
          solar_absorptance: kind === 'wall' ? TODAY.wall_solar_absorptance : kind === 'roof' ? TODAY.roof_solar_absorptance : null,
          thermal_emissivity: kind === 'other' ? null : TODAY.outside_emissivity,
          frame_fraction: kind === 'glazing' ? TODAY.frame_fraction : null,
          ...(is22
            ? {
                inside_solar_absorptance: kind === 'glazing' ? null : TODAY.inside_solar_absorptance,
                inside_solar_absorptance_b: s.kind === 'partition' ? TODAY.inside_solar_absorptance : null,
                faces_up: null,
              }
            : {}),
        }
      : s

  // A zone's floor outline: its rooms joined. A zone in separate parts (rooms that do not touch) has no one outline in
  // schema 2.x; the biggest part's is used and a note says so (its area still counts every part).
  const outlineOf = (zid: string): XY[] => {
    const rings = plan.rooms.filter((r) => r.zone === zid).map((r) => [[...r.ring.map((p) => [p[0], p[1]] as [number, number]), [r.ring[0]![0], r.ring[0]![1]] as [number, number]]])
    const u = pc.union(...(rings as [pc.Polygon, ...pc.Polygon[]]))
    const outer = u.map((poly) => cleanRing(poly[0] as XY[])).sort((a, b) => ringArea(b) - ringArea(a))
    if (u.length > 1) notes.push(`${plan.zones.find((z) => z.id === zid)?.name ?? zid} is in ${u.length} separate parts; the document's outline is its biggest part (the area counts all of them)`)
    return outer[0]!
  }

  const surfaces: Record<string, unknown>[] = []
  const byZone = new Map<string, string[]>()
  const add = (zone: string, s: Record<string, unknown>) => {
    surfaces.push(s)
    byZone.set(zone, [...(byZone.get(zone) ?? []), s.id as string])
  }
  const seen = new Map<string, number>()
  const uid = (base: string) => {
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}_${n}`
  }

  const shade = (ws: Array<{ shading_m: number }>) => {
    const d = ws[0]?.shading_m ?? 0
    if (!(d > 0)) return {}
    if (ws.some((x) => Math.abs(x.shading_m - d) > 1e-9)) {
      notes.push('Windows with different shading depths share one glazing surface; its shading is left out')
      return {}
    }
    return { shading: { overhang: { depth_m: r3(d), offset_m: 0 } } }
  }
  const doorIds = new Set<string>()
  let windowsPlaced = 0
  // Brief 115: a window type's opening and trickle vent become the glazing surface's openings. Opening windows are
  // only in weather-driven air (today's method has none); under today's method a trickle vent states its flow mode.
  const am = (plan.building ?? noBuildingInputs()).air_method ?? 'today'
  const openingsNoted = new Set<string>()
  const openingsOf = (typeId: string | null | undefined, ws: Array<{ sill_m: number; height_m: number }>) => {
    const t = plan.fabric_types.find((x) => x.id === typeId)
    if (!t || !ws.length) return []
    const sill = Math.min(...ws.map((x) => x.sill_m)), head = Math.max(...ws.map((x) => x.sill_m + x.height_m))
    if (ws.some((x) => Math.abs(x.sill_m - sill) > 1e-9 || Math.abs(x.sill_m + x.height_m - head) > 1e-9) && !openingsNoted.has(`h${t.id}`) && (t.opening || t.trickle)) {
      openingsNoted.add(`h${t.id}`); notes.push(`${t.name}: windows of different heights share a wall; their openings run from the lowest sill to the highest head, which overstates the stack flow a little`)
    }
    const out: Record<string, unknown>[] = []
    const o = t.opening
    if (o) {
      if (am !== 'weather_driven') {
        if (!openingsNoted.has(`o${t.id}`)) { openingsNoted.add(`o${t.id}`); notes.push(`${t.name}: opening windows count only with weather-driven air (Fabric, Air leakage)`) }
      } else if (o.openable_fraction == null) {
        if (!openingsNoted.has(`f${t.id}`)) { openingsNoted.add(`f${t.id}`); notes.push(`${t.name}: say how much of each window opens (Fabric, Windows); until then they stay shut`) }
      } else {
        const angled = WINDOW_STYLES.find((x) => x.key === o.style)?.angle ?? true
        out.push({
          kind: 'operable', openable_fraction: o.openable_fraction, ...(o.cd != null ? { cd: o.cd } : {}),
          ...(o.style ? { style: o.style } : {}), opening_angle_deg: angled ? o.opening_angle_deg : null, sill_m: r3(sill), head_m: r3(head),
        })
      }
    }
    const v = t.trickle
    if (v && v.area_mm2 == null) {
      if (!openingsNoted.has(`v${t.id}`)) { openingsNoted.add(`v${t.id}`); notes.push(`${t.name}: give the trickle vent's equivalent area (Fabric, Windows); until then it is left out`) }
    } else if (v) {
      out.push({
        kind: 'permanent_vent', area_m2: Math.round(v.area_mm2! * ws.length) / 1e6, ...(v.cd != null ? { cd: v.cd } : {}),
        ...(am === 'weather_driven' ? { height_m: r3(head) } : v.flow_mode ? { flow_mode: v.flow_mode } : {}),
      })
    }
    return out
  }
  const taken = new Set<number>()
  for (const w of walls) {
    // Windows whose middle falls on this zone's stretch of the run (each window once: a middle exactly on a zone line
    // goes to the first zone that claims it).
    const mine = windows.filter((x, i) => {
      const mid = x.offset_m + x.width_m / 2
      if (taken.has(i) || x.wall !== w.run || mid < w.t0 - 1e-9 || mid > w.t1 + 1e-9) return false
      taken.add(i)
      return true
    })
    windowsPlaced += mine.length
    const doors = mine.filter((x) => x.door)
    const wins = mine.filter((x) => !x.door)
    const gross = w.length_m * h
    const glz = wins.reduce((s, x) => s + x.width_m * x.height_m, 0)
    const doorM2 = doors.reduce((s, x) => s + x.width_m * x.height_m, 0)
    const wallId = uid(`${w.zone}_wall_${w.run + 1}`)
    add(w.zone, ext({
      id: wallId, kind: 'wall', zone_a: w.zone, zone_b: 'outside', facade: facade4(w.azimuth_deg),
      area_m2: r3(gross - glz - doorM2), azimuth_deg: w.azimuth_deg, tilt_deg: 90,
      construction_ref: constructionOf(w.type), g_value: null, openings: [],
    }, 'wall'))
    if (doors.length) {
      // Schema 2.x has no door kind: a door is an opaque wall surface of its own, with its own construction key, so its
      // area is never lost into the wall or the glazing (proposed as a door kind for 2.2).
      const id = uid(`${w.zone}_door_${w.run + 1}`)
      doorIds.add(id)
      add(w.zone, ext({
        id, kind: 'wall', zone_a: w.zone, zone_b: 'outside', facade: facade4(w.azimuth_deg),
        area_m2: r3(doorM2), azimuth_deg: w.azimuth_deg, tilt_deg: 90,
        construction_ref: constructionOf(w.door), g_value: null, openings: [],
      }, 'wall'))
    }
    if (wins.length) {
      add(w.zone, ext({
        id: uid(`${w.zone}_glazing_${w.run + 1}`), kind: 'glazing', zone_a: w.zone, zone_b: 'outside', facade: facade4(w.azimuth_deg),
        area_m2: r3(glz), azimuth_deg: w.azimuth_deg, tilt_deg: 90,
        construction_ref: constructionOf(w.glazing), g_value: gOf(w.glazing),
        wwr: r3(glz / gross), window_count: wins.length, openings: openingsOf(w.glazing, wins),
        // Same mapping as today's tool (building.shading_overhang → overhang, offset 0); one depth per glazing surface,
        // so it is written only when every window on it has the same depth.
        ...(shade(wins)),
      }, 'glazing'))
    }
  }
  if (windowsPlaced < windows.length) notes.push(`${windows.length - windowsPlaced} window(s) are on no zone's wall`)

  // Walls between zones: one building-wide type (a plan from before it existed has none, so it stays unassigned).
  const pt = plan.fabric_types.find((t) => t.element === 'partition')
  const partitionRef = pt ? constructionOf(pt.id) : { key: 'unassigned:internal_wall' }
  for (const s of shares) {
    const id = uid(`partition_${s.a}_${s.b}`)
    const surf = ext({
      id, kind: 'partition', zone_a: s.a, zone_b: s.b, facade: null, area_m2: r3(s.length_m * h),
      azimuth_deg: null, tilt_deg: 90, construction_ref: partitionRef, g_value: null, openings: [],
    }, 'other')
    surfaces.push(surf)
    byZone.set(s.a, [...(byZone.get(s.a) ?? []), id])
    byZone.set(s.b, [...(byZone.get(s.b) ?? []), id])
  }
  const floorOf = new Map(used.map((z) => [z.id, plan.rooms.filter((r) => r.zone === z.id).reduce((t, r) => t + ringArea(r.ring), 0)]))
  // Brief 123: the roof's shape. A block whose roof is pitched (and built) is roofed below; any other stays flat.
  // Roof parts (17 Nov 2026): a block may have parts, each a rectangle with its own recipe; `pieces` are the parts and
  // the blocks without parts (whose recipe is plan.roof). With no parts, piece i is block i, as before.
  const pieces = roofPieces(plan, opts.partialRoof)
  const recOf = (i: number) => { const r = pieces[i]?.recipe; return r && r.style !== 'flat' ? r : null }
  const roofs = pieces.map((p, i) => (recOf(i) ? (p.part ? blockRoof(p.ring, p.recipe) : roofsIn?.[p.block] ?? blockRoof(p.ring, p.recipe)) : null))
  roofs.forEach((r, i) => { if (r?.refused) notes.push(`${pieces[i]!.part ? `The ${pieces[i]!.name.toLowerCase()} roof` : `Block ${pieces[i]!.block + 1}`} keeps a flat roof: ${r.refused}`) })
  const pitched = (i: number) => (roofs[i] && roofs[i]!.style !== 'flat' ? roofs[i]! : null)
  const coldOf = (i: number) => (recOf(i)?.insulation ?? 'ceiling') === 'ceiling'
  const inside = (p: XY, ring: readonly XY[]) => {
    let c = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  }
  const blockOfRoom = (ring: readonly XY[]) => {
    const n = ring.length, c: XY = [ring.reduce((t, p) => t + p[0], 0) / n, ring.reduce((t, p) => t + p[1], 0) / n]
    const i = plan.blocks.findIndex((b) => inside(c, b))
    return i < 0 ? 0 : i
  }
  /** A room's floor under each roof piece: the whole room under its block's one piece, or split across its parts. */
  const piecesOfRoom = (ring: readonly XY[]): Array<{ piece: number; a: number }> => {
    const b = blockOfRoom(ring)
    const mine = pieces.filter((p) => p.block === b)
    if (mine.length === 1) return [{ piece: mine[0]!.index, a: ringArea(ring) }]
    const parts = mine.filter((p) => !p.rest).map((p) => ({ piece: p.index, a: areaInside(ring, p.ring) }))
    // Stacked floors: what no part covers is under the block's flat rest.
    const rest = mine.find((p) => p.rest)
    if (rest) {
      // Parts that overlap share the room's floor between them (never more roof than floor).
      const room = ringArea(ring), under = parts.reduce((t, x) => t + x.a, 0)
      if (under > room) for (const x of parts) x.a *= room / under
      parts.push({ piece: rest.index, a: Math.max(0, room - Math.min(room, under)) })
    }
    return parts.filter((x) => x.a > 1e-6)
  }
  const loftId = (i: number) => `${opts.loftPrefix ?? ''}${pieces.length > 1 ? `loft_${i + 1}` : 'loft'}`
  /** A gable or raised wall takes the wall type of the outside wall it stands on (at the middle of its foot). */
  /** Roof parts: the length of a run lying along the part's own outline (a part's walls are those of its own rooms). */
  const alongPart = (r: (typeof runs)[number], ring: readonly XY[]) => ring.reduce((t, a, k) => {
    const b = ring[(k + 1) % ring.length]!
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L
    const off = (p: XY) => Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux)
    if (off(r.a) > 0.05 || off(r.b) > 0.05) return t
    const s0 = (r.a[0] - a[0]) * ux + (r.a[1] - a[1]) * uy, s1 = (r.b[0] - a[0]) * ux + (r.b[1] - a[1]) * uy
    return t + Math.max(0, Math.min(L, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1)))
  }, 0)
  const wallTypeUnder = (f: BlockRoof['faces'][number], piece = -1) => {
    const part = piece >= 0 && pieces[piece]?.part ? pieces[piece]!.ring : null
    const base = f.pts.filter((p) => Math.abs(p[2]) < 1e-6)
    const m: XY = base.length ? [base.reduce((t, p) => t + p[0], 0) / base.length, base.reduce((t, p) => t + p[1], 0) / base.length] : [f.pts[0]![0], f.pts[0]![1]]
    let best = { d: Infinity, run: -1, t: 0 }
    for (const r of runs) {
      // A part's gable or raised wall standing where it meets another part takes its own wing's walls, not the
      // other wing's (the nearest wall along the part's own outline).
      if (part && alongPart(r, part) < 0.05) continue
      const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) || 1
      const t = Math.max(0, Math.min(L, ((m[0] - r.a[0]) * (r.b[0] - r.a[0]) + (m[1] - r.a[1]) * (r.b[1] - r.a[1])) / L))
      const d = Math.hypot(r.a[0] + ((r.b[0] - r.a[0]) * t) / L - m[0], r.a[1] + ((r.b[1] - r.a[1]) * t) / L - m[1])
      if (d < best.d) best = { d, run: r.index, t }
    }
    return best.run >= 0 ? typeAt(plan, best.run, best.t) : firstType(plan, 'wall')
  }
  const slopeRef = (i: number) => { const t = recOf(i)?.loft_slope_type; return t ? constructionOf(t) : { key: 'unassigned:roof:loft_slopes' } }
  if (pieces.some((_, i) => pitched(i) && coldOf(i) && !recOf(i)!.loft_slope_type)) notes.push('The loft\'s roof slopes have no construction yet: choose what they are made of on Shape, Roof')
  /** Warm roof: the extra height each zone gets from its share of the roof space. */
  const roofSpace = new Map<string, number>()
  const roofFace = (zone: string, i: number, share: number, type: string, f: BlockRoof['faces'][number], n: number, onLoft: boolean) => {
    const wall = f.kind === 'wall'
    const id = uid(`${zone}_${wall ? 'gable' : 'slope'}_${n + 1}`)
    add(zone, ext({
      id, kind: wall ? 'wall' : 'roof', zone_a: zone, zone_b: 'outside', facade: wall ? facade4(f.azimuth_deg ?? 0) : null,
      area_m2: r3(f.area_m2 * share), azimuth_deg: f.azimuth_deg == null ? null : r3(f.azimuth_deg), tilt_deg: r3(f.tilt_deg),
      construction_ref: wall ? constructionOf(wallTypeUnder(f, i)) : onLoft ? slopeRef(i) : constructionOf(type),
      g_value: null, openings: [],
    }, wall ? 'wall' : 'roof'))
  }

  // Roof and ground floor: one of each per zone, or one per type when the zone's rooms have different types.
  for (const z of used) {
    const rs = plan.rooms.filter((r) => r.zone === z.id)
    for (const e of ['roof', 'floor'] as const) {
      const byType = new Map<string, { a: number; block: number }>()
      for (const r of rs) {
        for (const { piece, a: ra } of e === 'roof' ? piecesOfRoom(r.ring) : [{ piece: -1, a: ringArea(r.ring) }]) {
          const block = e === 'roof' && pitched(piece) ? piece : -1
          const k = `${block}|${roomType(plan, r.id, e)}`
          const g = byType.get(k) ?? { a: 0, block }
          g.a += ra
          byType.set(k, g)
        }
      }
      for (const [k, { a, block }] of byType) {
        const type = k.slice(k.indexOf('|') + 1)
        const pr = block >= 0 ? pitched(block) : null
        if (e === 'roof' && pr && coldOf(block)) {
          // The room's roof type is now its ceiling, to the loft (layers run loft side first, as a roof's run outside first).
          const id = uid(`${z.id}_ceiling`)
          const surf = { ...ext({ id, kind: 'ceiling', zone_a: z.id, zone_b: loftId(block), facade: null, area_m2: r3(a), azimuth_deg: null, tilt_deg: 0, construction_ref: constructionOf(type), g_value: null, openings: [] }, 'other'), ...(is22 ? { inside_solar_absorptance_b: TODAY.inside_solar_absorptance } : {}) }
          surfaces.push(surf)
          byZone.set(z.id, [...(byZone.get(z.id) ?? []), id])
          byZone.set(loftId(block), [...(byZone.get(loftId(block)) ?? []), id])
        } else if (e === 'roof' && pr) {
          // Warm roof: the slopes and gable walls over this zone's share of the block, and its share of the roof space.
          const foot = ringArea(pieces[block]!.ring)
          const share = foot > 0 ? a / foot : 0
          pr.faces.forEach((f, n) => roofFace(z.id, block, share, type, f, n, false))
          roofSpace.set(z.id, (roofSpace.get(z.id) ?? 0) + pr.void_m3 * share)
        } else if (e === 'roof') add(z.id, ext({ id: uid(`${z.id}_roof`), kind: 'roof', zone_a: z.id, zone_b: 'outside', facade: null, area_m2: r3(a), azimuth_deg: null, tilt_deg: 0, construction_ref: constructionOf(type), g_value: null, openings: [] }, 'roof'))
        else add(z.id, ext({ id: uid(`${z.id}_ground`), kind: 'ground', zone_a: z.id, zone_b: 'ground', facade: null, area_m2: r3(a), azimuth_deg: null, tilt_deg: 180, construction_ref: constructionOf(type), g_value: null, openings: [] }, 'other'))
      }
    }
  }
  // Cold roof: the loft's own slopes and gable walls, to outside.
  const lofts = pieces.map((p, i) => ({ i, b: p.ring, r: pitched(i) })).filter((x) => x.r && coldOf(x.i) && byZone.has(loftId(x.i)))
  for (const { i, r } of lofts) r!.faces.forEach((f, n) => roofFace(loftId(i), i, 1, '', f, n, true))

  // Space types: a zone takes the space type covering most of its floor (a note says when its rooms differ).
  const spaceOf = new Map<string, SpaceType | undefined>()
  for (const z of used) {
    const rs = plan.rooms.filter((r) => r.zone === z.id)
    const by = new Map<string, number>()
    for (const r of rs) if (r.space) by.set(r.space, (by.get(r.space) ?? 0) + ringArea(r.ring))
    const best = [...by.entries()].sort((a, b) => b[1] - a[1])[0]
    const sp = best ? plan.spaces.find((x) => x.id === best[0]) : undefined
    spaceOf.set(z.id, sp)
    if (by.size > 1 && sp) notes.push(`${z.name} has rooms of ${by.size} space types; the model gives the zone ${sp.name}'s (the most floor)`)
    if (sp && rs.some((r) => !r.space)) notes.push(`${z.name} has rooms with no space type; the zone takes ${sp.name}'s`)
  }
  // Brief 124 P4: each room's floor finish and ceiling, from its zone's space type (typical for the space when not
  // typed). Carpet goes on the ground floor's room face; a suspended ceiling under a flat roof or a loft ceiling.
  if (is212) {
    const hardOnCarpet = new Set<string>()
    for (const sf of surfaces) {
      const z = sf.zone_a as string
      if (!spaceOf.has(z)) continue
      const f = finishesOf(spaceOf.get(z))
      const flat = sf.kind === 'roof' && (sf.tilt_deg as number) === 0
      let key = sf.kind === 'ground' ? FINISH_KEY[f.floor] : flat || sf.kind === 'ceiling' ? FINISH_KEY[f.ceiling] : undefined
      // The library's ground floors are "Carpet, screed, …": their carpet is already a layer, so none is added on top.
      // A hard floor asked of one cannot take the layer out; the document says so.
      if (sf.kind === 'ground' && carpetIn((sf.construction_ref as { key: string } | undefined)?.key)) {
        if (f.floor === 'hard' && !f.floor_typical) hardOnCarpet.add(spaceOf.get(z)?.name ?? z)
        key = null
      }
      if (key !== undefined) sf.inside_finish = key ? { key } : null
    }
    for (const n of hardOnCarpet) notes.push(`${n}: hard floor chosen, but its ground floor construction already has carpet in it; choose a floor construction without carpet`)
  }
  /** 'always_on' as chosen, or a library ventilation profile written as a document schedule profile. */
  const scheduleRef = (key: string | null | undefined) => {
    if (!key) return null
    if (key === 'always_on') return 'always_on'
    const pr = profile(key)
    if (!pr?.day_types) return null
    addProfile({ id: key, kind: 'schedule', label: pr.name, ...(pr.schedule_type === 'window_opening' ? { purpose: 'window_opening' } : {}), day_types: { weekday: pr.day_types.weekday, saturday: pr.day_types.saturday, sunday: pr.day_types.sunday } })
    return key
  }
  // Systems: a zone takes, per service, the system covering most of its floor (a note says when its rooms differ).
  const sysOf = new Map<string, PlanSystem | undefined>()
  for (const z of used) {
    const rs = plan.rooms.filter((r) => r.zone === z.id)
    for (const s of SERVICES) {
      const by = new Map<string, number>()
      for (const r of rs) {
        const id = r.systems?.[s.key]
        if (id && plan.systems.some((x) => x.id === id)) by.set(id, (by.get(id) ?? 0) + ringArea(r.ring))
      }
      const best = [...by.entries()].sort((a, b) => b[1] - a[1])[0]
      const sys = best ? plan.systems.find((x) => x.id === best[0]) : undefined
      sysOf.set(`${z.id}|${s.key}`, sys)
      if (by.size > 1 && sys) notes.push(`${z.name} has rooms with ${by.size} ${s.name.toLowerCase()} systems; the model gives the zone ${sys.name} (the most floor)`)
    }
  }
  const zoneSys = (zid: string, s: Service) => sysOf.get(`${zid}|${s}`)
  const ventOf = (zid: string) => {
    const v = zoneSys(zid, 'ventilation')
    const t = system(v?.template)
    if (!t || !v) return []
    const kind = t.type === 'mvhr' || t.type === 'mev' ? t.type : 'natural'
    return [{
      // Flow as typed on the system: l/s per m² of floor (mechanical) or air changes per hour (natural).
      id: `${v.id}_vent`, label: v.name, kind, enabled: true, share_pct: 100,
      flow_rate: v.flow ?? null, flow_rate_basis: v.flow != null ? (kind === 'natural' ? 'ach' : 'per_m2') : null,
      sfp_w_per_l_s: t.sfp, recovery_sensible_pct: t.heat_recovery != null ? r3(t.heat_recovery * 100) : null, legacy_v25: null,
      // Brief 114: continuous (every hour), on its schedule, or with demand (the people in the zone, never below its
      // least share, inside its hours: review F1). Not stated: the schedule decides, as before.
      ...(() => {
        const runs = v.runs ?? null
        if (runs === 'demand') return { runs, demand_min_fraction: v.demand_min ?? null, control_schedule_ref: scheduleRef(v.schedule) }
        if (runs === 'continuous') return { runs, control_schedule_ref: 'always_on' }
        return { ...(runs ? { runs } : {}), control_schedule_ref: scheduleRef(v.schedule) }
      })(),
    }]
  }

  // Emitters (schema 2.4): per zone, one entry per emitter type in its rooms, the counts added up. A wet one is fed by
  // the zone's heating system (its group id); a fixed-output one names none and carries no rating temperatures.
  const emittersOf = (zid: string) => {
    const by = new Map<string, number>()
    for (const r of plan.rooms.filter((x) => x.zone === zid)) for (const e of r.emitters ?? []) if (e.count > 0) by.set(e.type, (by.get(e.type) ?? 0) + e.count)
    const heat = zoneSys(zid, 'heating')
    const feeds = heat && system(heat.template)?.fuel ? `heating_${heat.id}` : null
    return [...by.entries()].flatMap(([tid, count]) => {
      const t = (plan.emitter_types ?? []).find((x) => x.id === tid)
      if (!t) return []
      const wet = isWet(t.kind)
      // Brief 119 (2.7): a cooling kind may state its cooling; one that does not heat leaves every heating field empty.
      const cools = coolingKind(t.kind)
      const heats = cools ? t.heats !== false : true
      const cooling = { heats, cooling_output_w: cools ? t.cooling_output_w ?? null : null, catalogue_ref: heats && t.catalogue ? t.catalogue : null }
      if (!heats) return [{ id: `${zid}_${t.id}`, label: t.name, kind: t.kind, count, rated_output_w: null, radiant_fraction: null, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null, ...cooling }]
      if (wet && !feeds) notes.push(`${t.name}: fed by a heating system, but its zone has none given`)
      return [{
        id: `${zid}_${t.id}`, label: t.name, kind: t.kind, count, rated_output_w: t.rated_output_w, radiant_fraction: t.radiant_fraction,
        system_group_id: wet ? feeds : null,
        rated_flow_c: wet ? t.rated_flow_c : null, rated_return_c: wet ? t.rated_return_c : null, rated_room_c: wet ? t.rated_room_c : null, exponent_n: wet ? t.exponent_n : null,
        ...cooling,
      }]
    })
  }

  // Profiles: the library's are shapes (hourly fractions by day type); the magnitudes are not in the library, so
  // lighting and equipment carry none yet, and occupancy is written only with the people per m² typed on its space type.
  const profiles: Record<string, unknown>[] = []
  const shapeOf = (key: string) => {
    const pr = profile(key)!
    const d = pr.day_types!
    return { weekday: d.weekday, saturday: d.saturday, sunday: d.sunday, ...(pr.monthly_multipliers ? { monthly_multipliers: pr.monthly_multipliers } : {}) }
  }
  const addProfile = (pr: Record<string, unknown>) => {
    if (!profiles.some((x) => x.id === pr.id)) profiles.push(pr)
  }
  // From schema 2.3 each gain profile carries radiant_fraction, stated on the space type (null until it is).
  const refsOf = (zid: string) => {
    const sp = spaceOf.get(zid)
    if (!sp) return { occupancy: null, lighting: [], equipment: [], auxiliary: [] }
    // Lighting and equipment: one profile per space type, its library shape plus the W/m² typed on the space type.
    const gain = (k: 'lighting' | 'equipment') => {
      const key = sp[k]
      const shape = key && profile(key)?.day_types ? shapeOf(key) : null
      const w = k === 'lighting' ? sp.lighting_w_per_m2 : sp.equipment_w_per_m2
      if (!shape && w == null && (k === 'lighting' ? sp.lux == null : sp.equipment_baseload_w_per_m2 == null)) return []
      const id = `${sp.id}_${k}`
      // Today's engine reads lighting from magnitude and equipment from active + baseload.
      const base = sp.equipment_baseload_w_per_m2
      if (k === 'equipment' && (w != null) !== (base != null)) notes.push(`${sp.name}: equipment needs both "in use" and "always on" W/m² (0 is fine)`)
      // Brief 112: lighting states the lux the space needs (its W/m² comes from the lighting system's efficacy), or,
      // while no lux is stated, a W/m² stated directly.
      const size = k === 'lighting'
        ? (sp.lux != null ? { lux: sp.lux } : w != null ? { magnitude: { value: w, unit: 'w_per_m2' } } : {})
        : w != null && base != null ? { active: { value: w, unit: 'w_per_m2' }, baseload: { value: base, unit: 'w_per_m2' } } : {}
      // Stated detail only: a field left empty on the space type is left out, and the engine names it.
      const L = k === 'lighting'
      const rel = L ? sp.light_relationship : sp.equip_relationship
      // Following occupancy needs no shape of its own; on its own schedule with none chosen, the engine uses occupancy's.
      if (!shape && rel === 'independent') notes.push(`${sp.name}: ${k} runs on its own profile, but none is chosen, so it follows occupancy's`)
      const detail = Object.fromEntries(Object.entries({
        area_share: L ? sp.light_area_share : sp.equip_area_share,
        gain_fraction: L ? sp.light_gain_fraction : sp.equip_gain_fraction,
        relationship_to_occupancy: rel,
        ...(L && rel === 'proportional_with_spill' ? { daylight_factor: sp.daylight_factor } : {}),
        ...(!L && rel !== 'independent' ? { standby_factor: sp.standby_factor } : {}),
      }).filter(([, v]) => v != null))
      addProfile({ id, kind: k, label: `${key ? profile(key)!.name : k} (${sp.name})`, ...(shape ? { schedule: shape } : {}), ...size, ...detail, ...(is23 ? { radiant_fraction: sp.radiant_fraction ?? null } : {}) })
      return [id]
    }
    let occupancy: string | null = null
    // Schema 2.8: hot water use lives on the occupancy profile, stated on the space type (Brief 112).
    const hwUse = sp.hot_water_basis != null && sp.hot_water_litres != null ? { basis: sp.hot_water_basis, litres_per_day: sp.hot_water_litres } : null
    if ((sp.hot_water_basis != null) !== (sp.hot_water_litres != null)) notes.push(`${sp.name}: hot water needs both how it is counted and the litres a day`)
    const perRoom = sp.people_basis === 'per_room'
    const dens = perRoom ? sp.people_per_room : sp.people_per_m2
    const allTime = sp.occupancy === ALWAYS
    if (dens != null && dens > 0) {
      // "In all the time": present every hour, which the person chose and sees; otherwise the library's shape.
      const shape = allTime ? { weekday: Array(24).fill(1), saturday: Array(24).fill(1), sunday: Array(24).fill(1) } : sp.occupancy && profile(sp.occupancy)?.day_types ? shapeOf(sp.occupancy) : null
      if (!shape) notes.push(`${sp.name}: people are counted but no occupancy profile is chosen`)
      occupancy = `${sp.id}_occupancy`
      addProfile({
        id: occupancy, kind: 'occupancy', label: `${allTime ? 'In all the time' : sp.occupancy ? profile(sp.occupancy)!.name : 'Occupancy'} (${sp.name})`,
        ...(shape ? { schedule: shape } : {}), density: { value: dens, basis: perRoom ? 'per_room' : 'per_m2' },
        ...(sp.occupancy_rate != null ? { occupancy_rate: sp.occupancy_rate } : {}),
        ...(sp.sensible_w_per_person != null ? { sensible_w_per_person: sp.sensible_w_per_person } : {}),
        ...(is23 ? { radiant_fraction: sp.radiant_fraction ?? null } : {}),
        ...(hwUse ? { dhw: hwUse } : {}),
      })
    } else {
      // Hot water per m² needs no people (review F8): an occupancy profile with none carries it, with the space's own
      // occupancy shape when one is chosen (the run names it if the load shape follows occupancy and there is none).
      if (hwUse?.basis === 'per_m2') {
        const shape = allTime ? { weekday: Array(24).fill(1), saturday: Array(24).fill(1), sunday: Array(24).fill(1) } : sp.occupancy && profile(sp.occupancy)?.day_types ? shapeOf(sp.occupancy) : null
        occupancy = `${sp.id}_occupancy`
        addProfile({ id: occupancy, kind: 'occupancy', label: `Hot water, no people (${sp.name})`, ...(shape ? { schedule: shape } : {}), density: { value: 0, basis: 'per_m2' }, ...(is23 ? { radiant_fraction: sp.radiant_fraction ?? null } : {}), dhw: hwUse })
        notes.push(`${sp.name}: no people are stated; its hot water (${hwUse.litres_per_day} litres per m² a day) is carried on an occupancy profile with none`)
      }
      if (sp.occupancy) notes.push(`${sp.name}: occupancy needs people per ${perRoom ? 'room' : 'm²'} before it goes in the model`)
    }
    return { occupancy, lighting: gain('lighting'), equipment: gain('equipment'), auxiliary: [] }
  }

  const bi = plan.building ?? noBuildingInputs()
  const hw = plan.dhw ?? noDhw()
  // 17 Nov 2026 (example school): only a room that uses hot water needs a hot water system; a hall or corridor that
  // states none is fine without one (the run never refused it; the note said it would).
  const usesHw = (zid: string) => { const sp = spaceOf.get(zid); return sp?.hot_water_basis != null && sp.hot_water_litres != null && sp.hot_water_litres > 0 }
  const noHw = used.filter((z) => usesHw(z.id) && !system(zoneSys(z.id, 'dhw')?.template)?.fuel)
  const hwStated = used.some((z) => usesHw(z.id))
  if (noHw.length) notes.push(`Hot water use is stated, but ${noHw.map((z) => z.name ?? z.id).join(', ')} ${noHw.length > 1 ? 'have' : 'has'} no hot water system: the run will refuse until one is given, or the daily use is cleared (Systems, Hot water)`)
  if (used.some((z) => system(zoneSys(z.id, 'dhw')?.template)?.fuel) && ([hw.storage_c, hw.tap_c, hw.cold_c].some((v) => v == null) || hw.shape === null)) notes.push('Hot water: a system is given but its temperatures or when it is used are not all stated (Systems, Hot water)')
  if (used.some((z) => system(zoneSys(z.id, 'dhw')?.template)?.fuel) && !hwStated) notes.push('Hot water: a system is given but no space type states how much is used (Spaces, Hot water)')
  const setbackNoted = new Set<string>()
  /** Heating hours: a schedule, or today's heating setpoint profile read as its hours at its highest temperature (on)
   * and the rest (off). The temperatures themselves are typed on Controls (filled from the profile when it is chosen). */
  const hoursRef = (key: string) => {
    const pr = profile(key)
    if (pr?.schedule_type !== 'heating_setpoint' || !pr.day_types) return scheduleRef(key)
    const d = pr.day_types
    const hi = Math.max(...d.weekday, ...d.saturday, ...d.sunday)
    const on = (xs: number[]) => xs.map((v) => (v >= hi ? 1 : 0))
    addProfile({ id: `${key}_hours`, kind: 'schedule', label: `${pr.name}: hours at ${hi} °C`, day_types: { weekday: on(d.weekday), saturday: on(d.saturday), sunday: on(d.sunday) } })
    return `${key}_hours`
  }
  const zones = used.map((z) => ({
    id: z.id,
    name: z.name,
    floor: 0,
    storeys: 1,
    polygon: outlineOf(z.id).map(([x, y]) => [r3(x), r3(y)]),
    area_m2: r3(floorOf.get(z.id)!),
    height_m: h,
    use_type: spaceOf.get(z.id)?.use ?? 'unassigned',
    rooms: plan.rooms.filter((r) => r.zone === z.id).length,
    profile_refs: refsOf(z.id),
    setpoints: (() => {
      const sp = spaceOf.get(z.id)
      // Brief 121: a setpoint may follow a temperature profile. heat_c / cool_c are then its highest / lowest value,
      // worked out here from the profile itself (one figure, so the two cannot drift), and it carries any setback.
      const tempRef = (key: string | null | undefined, purpose: 'heating_setpoint' | 'cooling_setpoint') => {
        const pr = key ? profile(key) : undefined
        if (!key) return null
        if (!pr?.day_types || !isTemperature(pr.schedule_type)) { notes.push(`${sp!.name}: its ${purpose === 'heating_setpoint' ? 'heating' : 'cooling'} setpoint profile is missing or is not in °C`); return null }
        const d = pr.day_types
        addProfile({ id: key, kind: 'temperature', label: pr.name, purpose, day_types: { weekday: d.weekday, saturday: d.saturday, sunday: d.sunday } })
        return { id: key, ...tempRange(d) }
      }
      const hRef = tempRef(sp?.heat_profile, 'heating_setpoint')
      const cRef = tempRef(sp?.cool_profile, 'cooling_setpoint')
      const heat = hRef ? hRef.hi : sp?.heat_c ?? null
      const cool = cRef ? cRef.lo : sp?.cool_c ?? null
      // Brief 114 (Controls): the heating hours and the setback outside them. A setback without hours means nothing.
      const hours = sp?.heat_hours && sp.heat_hours !== 'always_on' && (heat != null || cool != null) ? hoursRef(sp.heat_hours) : null
      const setback = hours && heat != null && !hRef ? sp?.setback_c ?? null : null
      if (sp?.setback_c != null && !hours && !setbackNoted.has(sp.id)) { setbackNoted.add(sp.id); notes.push(`${sp.name}: a setback needs heating hours to apply outside (Controls)`) }
      return { heat_c: heat, cool_c: cool, setback_c: setback, hours_ref: hours, ...(hRef ? { heat_ref: hRef.id } : {}), ...(cRef ? { cool_ref: cRef.id } : {}), control_strategy: heat != null || cool != null ? 'active_setpoint' : null }
    })(),
    ventilation: ventOf(z.id),
    // A heated room is held at its heating temperature for the design heat loss (said on Systems, Heating).
    ...(bi.design_outdoor != null && spaceOf.get(z.id)?.heat_c != null ? { design_internal_c: 'follow_heat_c' } : {}),
    infiltration_q50: bi.q50,
    infiltration_ach: null,
    ...(is21 ? { internal_heat_capacity_j_per_k_m2: TODAY.internal_heat_capacity_j_per_k_m2 } : {}),
    surfaces: byZone.get(z.id) ?? [],
    ...(is24 ? { emitters: emittersOf(z.id) } : {}),
  }))
  // Warm roof: a room open to the slope holds the roof space above it too.
  for (const z of zones) {
    const v = roofSpace.get(z.id as string)
    if (v && (z.area_m2 as number) > 0) z.height_m = r3(h + v / (z.area_m2 as number))
  }
  // Brief 123 P4 (the engine thread's schema): an unheated loft is an unconditioned zone with no setpoint and no
  // system of any kind (Rule 8: absent, not muted); its air is its own air changes (ISO 13789, ventilated loft).
  const loftZones = lofts.map(({ i, b, r }) => {
    const foot = ringArea(b)
    return {
      id: loftId(i), name: pieces[i]!.part ? `Loft (${pieces[i]!.name})` : pieces.length > 1 ? `Loft ${i + 1}` : 'Loft', floor: 1, storeys: 1,
      polygon: b.map(([x, y]) => [r3(x), r3(y)]), area_m2: r3(foot), height_m: r3(foot > 0 ? r!.void_m3 / foot : 0),
      use_type: 'loft', rooms: null, profile_refs: { occupancy: null, lighting: [], equipment: [], auxiliary: [] },
      setpoints: { heat_c: null, cool_c: null, setback_c: null, hours_ref: null, control_strategy: null },
      ventilation: [], infiltration_q50: null, infiltration_ach: recOf(i)?.loft_ach ?? LOFT_ACH,
      ...(is21 ? { internal_heat_capacity_j_per_k_m2: 0 } : {}),
      surfaces: byZone.get(loftId(i)) ?? [],
      ...(is24 ? { emitters: [] } : {}),
      conditioning: 'unconditioned', unconditioned_kind: 'ventilated_loft',
    }
  })

  // Systems: per service, one group per system the user made, serving every zone it is given to, at 100% of that
  // service (one system per service per zone here). A template with no fuel ("No mechanical cooling") is none.
  const system_groups: Record<string, unknown>[] = []
  // Brief 114: a system's pumps, written once every figure is stated (a note says what is missing).
  const pumpsOf = (sys: PlanSystem) => {
    const pu = sys.pumps
    if (!pu || (pu.basis == null && pu.value == null && pu.speed == null && pu.runs == null)) return {}
    const miss = [pu.value == null || pu.basis == null ? 'power' : '', pu.speed == null ? 'fixed or variable speed' : '', pu.runs == null ? 'how they run' : '', pu.runs === 'schedule' && !pu.schedule ? 'their schedule' : ''].filter(Boolean)
    if (miss.length) { notes.push(`${sys.name}: its pumps need ${miss.join(', ')} (Systems)`); return {} }
    return { pumps: { power: { [pu.basis!]: pu.value }, speed: pu.speed, runs: pu.runs, schedule_ref: pu.runs === 'schedule' ? scheduleRef(pu.schedule) : null, ...(pu.runs === 'continuous' && pu.season_months?.length ? { season_months: [...new Set(pu.season_months)].sort((a, b) => a - b) } : {}), default_from: pu.default_from ?? null } }
  }
  const hasGroup = (service: Service, id: string) => used.some((z) => zoneSys(z.id, service)?.id === id && !!system(zoneSys(z.id, service)?.template)?.fuel)
  for (const service of ['heating', 'cooling', 'dhw'] as const) {
    const bySystem = new Map<string, string[]>()
    for (const z of used) {
      const sys = zoneSys(z.id, service)
      if (!sys || !system(sys.template)?.fuel) continue
      bySystem.set(sys.id, [...(bySystem.get(sys.id) ?? []), z.id])
    }
    for (const [id, zs] of bySystem) {
      const sys = plan.systems.find((x) => x.id === id)!
      const t = system(sys.template)!
      system_groups.push({ id: `${service}_${id}`, service, label: sys.name, zones: zs, enabled: true, share_pct: 100, source: t.fuel, efficiency_metric: efficiencyFor(t, service), template_ref: t.key, ...(is24 && service === 'heating' ? { design_flow_c: sys.design_flow_c ?? null, design_return_c: sys.design_return_c ?? null } : {}),
        // Brief 120: what it can give (kW); a water heater's store; the hot water system a boiler heats first.
        capacity_kw: sys.capacity_kw ?? null,
        ...pumpsOf(sys),
        ...(service === 'dhw' ? { storage_litres: sys.storage_litres ?? null } : {}),
        ...(service === 'heating' && sys.dhw_first && hasGroup('dhw', sys.dhw_first) ? { dhw_priority_group_id: `dhw_${sys.dhw_first}` } : {}) })
    }
  }
  // Brief 112: lighting systems are luminaires, stated by their efficacy; they run on electricity and have no library
  // template. Empty efficacy stays empty, and the run names it.
  {
    const bySystem = new Map<string, string[]>()
    for (const z of used) {
      const sys = zoneSys(z.id, 'lighting')
      if (sys) bySystem.set(sys.id, [...(bySystem.get(sys.id) ?? []), z.id])
    }
    for (const [id, zs] of bySystem) {
      const sys = plan.systems.find((x) => x.id === id)!
      system_groups.push({ id: `lighting_${id}`, service: 'lighting', label: sys.name, zones: zs, enabled: true, share_pct: 100, source: 'electricity', efficiency_metric: null, template_ref: null, efficacy_w_m2_per_100lux: sys.efficacy ?? null })
    }
  }

  for (const k of new Set(surfaces.map((sf) => (sf.construction_ref as { key: string }).key))) {
    const c = construction(k)
    if (c?.pending) notes.push(`${c.name}: a draft library item, not yet checked by Chris`)
  }
  // Every library item the document uses, pinned by its body hash (from the snapshot), so a run says what it read.
  function libraryRefs() {
    const refs = new Map<string, { kind: string; key: string; version: null; body_hash: string }>()
    const pin = (kind: string, item: { key: string; body_hash?: string } | undefined) => item?.body_hash && refs.set(`${kind}:${item.key}`, { kind, key: item.key, version: null, body_hash: item.body_hash! })
    for (const sf of surfaces) pin('construction', construction((sf.construction_ref as { key: string }).key))
    for (const sf of surfaces) for (const f of [sf.inside_finish, sf.inside_finish_b] as Array<{ key: string } | null | undefined>) if (f) pin('construction', construction(f.key))
    for (const g of system_groups) pin('system_template', system(g.template_ref as string))
    for (const z of used) {
      for (const sv of SERVICES) pin('system_template', system(zoneSys(z.id, sv.key)?.template))
      const v = zoneSys(z.id, 'ventilation')
      if (v && system(v.template) && v.schedule && v.schedule !== 'always_on') pin('profile', profile(v.schedule))
      const sp = spaceOf.get(z.id)
      if (!sp) continue
      for (const k of ['occupancy', 'lighting', 'equipment'] as const) if (k !== 'occupancy' || ((sp.people_basis === 'per_room' ? sp.people_per_room : sp.people_per_m2) ?? 0) > 0) pin('profile', profile(sp[k]))
    }
    return [...refs.values()].sort((a, b) => (a.kind + a.key < b.kind + b.key ? -1 : 1))
  }

  const doc = {
    schema_version: SCHEMA_VERSION,
    building: {
      id: 'building_1',
      name: 'Geometry prototype',
      decoded_building_key: null,
      site: { lat: null, lon: null, name: null, exposure: bi.exposure, ...(is21 ? { ground: { method: 'annual_mean_outdoor' } } : {}), terrain: am === 'weather_driven' ? bi.terrain ?? null : null },
      orientation_deg: 0,
      reported_floor_area_m2: null,
      thermal_bridging: bi.tb_multiplier != null ? { mode: 'iso14683_auto', multiplier: bi.tb_multiplier, alpha_pct: null } : { mode: null, multiplier: null, alpha_pct: null },
      thermal_mass: { mode: null, category: null },
      opening_defaults: {},
      // Brief 115: the air method chosen on Fabric, Air leakage; a plan saved before it keeps today's.
      air: am === 'weather_driven' ? { method: 'weather_driven', exponent: bi.air_exponent ?? null, single_sided_turbulence: bi.single_sided_turbulence ?? null } : { method: 'today', exponent: null, single_sided_turbulence: null },
      // Brief 117/120: the design heat loss's conditions, only once an outdoor temperature is chosen.
      ...(bi.design_outdoor != null ? { design: { outdoor: typeof bi.design_outdoor === 'number' ? { stated_c: bi.design_outdoor } : { from_weather: bi.design_outdoor }, warm_up_w_per_m2: bi.warm_up_w_per_m2 ?? null, vent_wind_m_s: bi.vent_wind_m_s ?? null } } : {}),
    },
    zones: [...zones, ...loftZones],
    surfaces,
    system_groups,
    services: {
      heating: { setpoint_mode: 'follow_comfort', setpoint_c: null },
      cooling: { setpoint_mode: 'follow_comfort', setpoint_c: null },
      dhw: { storage_setpoint_c: hw.storage_c, tap_outlet_temp_c: hw.tap_c, cold_supply_temp_c: hw.cold_c, load_shape: hw.shape === undefined ? 'flat' : hw.shape, circulation_pump_w: hw.pump_w },
    },
    profiles,
    // Brief 114: loads outside the rooms, written once stated; their heat warms no room.
    ...(() => {
      const loads = (plan.other_loads ?? []).flatMap((l) => {
        const miss = [l.power_w == null ? 'its power' : '', l.runs == null ? 'how it runs' : '', l.runs === 'schedule' && !l.schedule ? 'its schedule' : ''].filter(Boolean)
        if (miss.length) { notes.push(`${l.name}: needs ${miss.join(', ')} (Systems, Other loads)`); return [] }
        return [{ id: l.id, kind: l.kind, label: l.name, power_w: l.power_w, runs: l.runs, schedule_ref: l.runs === 'schedule' || (l.runs === 'dusk_to_dawn' && l.schedule) ? scheduleRef(l.schedule) : null, default_from: null }]
      })
      return loads.length ? { other_loads: loads } : {}
    })(),
    // Brief 114: the control map, one entry per controlled thing that reached the document (recorded, not yet used in
    // the calculation). A system's group id is `${service}_${id}`; a ventilation system's zone entries are `${id}_vent`.
    ...(() => {
      const ventIds = new Set(zones.flatMap((z) => (z.ventilation as Array<{ id: string }>).map((v) => v.id)))
      const ctl = (plan.controls ?? []).flatMap((c) => {
        if (!c.controller) return []
        const sys = plan.systems.find((y) => y.id === c.ref)
        const ref = c.kind === 'ventilation' ? `${c.ref}_vent` : sys ? `${sys.service}_${c.ref}` : null
        const there = ref != null && (c.kind === 'ventilation' ? ventIds.has(ref) : system_groups.some((g) => g.id === ref))
        if (!there) return []
        return [{ id: `ctl_${c.kind}_${c.ref}`, target: { kind: c.kind, ref }, controller: c.controller, hours_ref: null, note: c.note?.trim() || null }]
      })
      // Brief 115: one window entry per zone with opening windows, from its space type's window rule (Controls).
      // Nothing is filled: a zone whose space type states no rule gets no entry, and the run asks for one.
      for (const z of zones) {
        const opens = (z.surfaces as string[]).some((sid) => (surfaces.find((s) => s.id === sid)?.openings as Array<{ kind: string }> | undefined)?.some((o) => o.kind === 'operable'))
        const wr = spaceOf.get(z.id as string)?.windows
        if (!opens || !wr || !wr.controller) continue
        ctl.push({
          id: `ctl_window_${z.id}`, target: { kind: 'window', ref: z.id as string }, controller: wr.controller,
          hours_ref: wr.hours && wr.hours !== 'always_on' ? scheduleRef(wr.hours) : null, note: null,
          rule: wr.rule, open_fraction: wr.open_fraction, open_above_c: wr.rule === 'temperature' ? wr.open_above_c : null,
          operation: wr.controller === 'manual' ? 'by_hand' : 'automated',
        } as never)
      }
      return ctl.length ? { controls: ctl } : {}
    })(),
    weather_ref: { kind: 'legacy', id: 'unassigned' },
    library_refs: libraryRefs(),
  }

  const res = ModelDocument.safeParse(doc)
  const issues = res.success ? [] : res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  const sum = (k: string) => surfaces.filter((s) => s.kind === k)
  return {
    doc,
    ok: res.success,
    issues,
    notes,
    totals: {
      zones: zones.length,
      rooms: plan.rooms.length,
      floor_m2: r3(zones.reduce((s, z) => s + z.area_m2, 0)),
      walls: sum('wall').filter((x) => !doorIds.has(x.id as string)).length,
      wall_net_m2: r3(sum('wall').filter((x) => !doorIds.has(x.id as string)).reduce((s, x) => s + (x.area_m2 as number), 0)),
      doors: windows.filter((x) => x.door).length,
      door_m2: r3(sum('wall').filter((x) => doorIds.has(x.id as string)).reduce((s, x) => s + (x.area_m2 as number), 0)),
      glazing: sum('glazing').length,
      glazing_m2: r3(sum('glazing').reduce((s, x) => s + (x.area_m2 as number), 0)),
      windows: windows.filter((x) => !x.door).length,
      partitions: sum('partition').length,
      systems: system_groups.length,
    },
  }
}
