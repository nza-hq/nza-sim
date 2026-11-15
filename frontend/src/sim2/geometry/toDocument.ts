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
import { allWindows, edgesOf, facade4, type FabricElement, type Plan, type PlanSystem, SERVICES, type Service, type SpaceType, ringArea, wallRuns, noBuildingInputs } from './plan'
import { crossing, firstType, roomType, typeOfSpan, wallPieces } from './facade'
import { construction, efficiencyFor, profile, system } from '../library/library'
import { cleanRing } from './outline'
import type { XY } from './ported/zones'

const r3 = (n: number) => Math.round(n * 1000) / 1000
const is21 = (SCHEMA_VERSION as string) !== '2.0'
const is22 = is21 && (SCHEMA_VERSION as string) !== '2.1'
const is23 = is22 && (SCHEMA_VERSION as string) !== '2.2'

export type Built = {
  doc: unknown
  ok: boolean
  issues: Array<{ path: string; message: string }>
  /** Plain-words problems from the plan itself (a window set that no longer fits, a gap between zones). */
  notes: string[]
  totals: { zones: number; rooms: number; floor_m2: number; walls: number; wall_net_m2: number; glazing: number; glazing_m2: number; windows: number; doors: number; door_m2: number; partitions: number; systems: number }
}

export function buildDocument(plan: Plan): Built {
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
  const UNSET: Record<FabricElement, string> = { wall: 'external_wall', glazing: 'glazing', door: 'external_door', roof: 'roof', floor: 'ground_floor', partition: 'internal_wall' }
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
        wwr: r3(glz / gross), window_count: wins.length, openings: [],
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
  // Roof and ground floor: one of each per zone, or one per type when the zone's rooms have different types.
  for (const z of used) {
    const rs = plan.rooms.filter((r) => r.zone === z.id)
    for (const e of ['roof', 'floor'] as const) {
      const byType = new Map<string, number>()
      for (const r of rs) byType.set(roomType(plan, r.id, e), (byType.get(roomType(plan, r.id, e)) ?? 0) + ringArea(r.ring))
      for (const [type, a] of byType) {
        if (e === 'roof') add(z.id, ext({ id: uid(`${z.id}_roof`), kind: 'roof', zone_a: z.id, zone_b: 'outside', facade: null, area_m2: r3(a), azimuth_deg: null, tilt_deg: 0, construction_ref: constructionOf(type), g_value: null, openings: [] }, 'roof'))
        else add(z.id, ext({ id: uid(`${z.id}_ground`), kind: 'ground', zone_a: z.id, zone_b: 'ground', facade: null, area_m2: r3(a), azimuth_deg: null, tilt_deg: 180, construction_ref: constructionOf(type), g_value: null, openings: [] }, 'other'))
      }
    }
  }

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
  /** 'always_on' as chosen, or a library ventilation profile written as a document schedule profile. */
  const scheduleRef = (key: string | null | undefined) => {
    if (!key) return null
    if (key === 'always_on') return 'always_on'
    const pr = profile(key)
    if (!pr?.day_types) return null
    addProfile({ id: key, kind: 'schedule', label: pr.name, day_types: { weekday: pr.day_types.weekday, saturday: pr.day_types.saturday, sunday: pr.day_types.sunday } })
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
      control_schedule_ref: scheduleRef(v.schedule),
    }]
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
      if (!shape && w == null && (k === 'lighting' || sp.equipment_baseload_w_per_m2 == null)) return []
      if (!shape) notes.push(`${sp.name}: ${k} has W/m² but no profile shape`)
      const id = `${sp.id}_${k}`
      // Today's engine reads lighting from magnitude and equipment from active + baseload.
      const base = sp.equipment_baseload_w_per_m2
      if (k === 'equipment' && (w != null) !== (base != null)) notes.push(`${sp.name}: equipment needs both "in use" and "always on" W/m² (0 is fine)`)
      const size = k === 'lighting'
        ? (w != null ? { magnitude: { value: w, unit: 'w_per_m2' } } : {})
        : w != null && base != null ? { active: { value: w, unit: 'w_per_m2' }, baseload: { value: base, unit: 'w_per_m2' } } : {}
      // Stated detail only: a field left empty on the space type is left out, and the engine names it.
      const L = k === 'lighting'
      const rel = L ? sp.light_relationship : sp.equip_relationship
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
    if (sp.people_per_m2 != null && sp.people_per_m2 > 0) {
      const shape = sp.occupancy && profile(sp.occupancy)?.day_types ? shapeOf(sp.occupancy) : null
      if (!shape) notes.push(`${sp.name}: people per m² but no occupancy profile shape`)
      occupancy = `${sp.id}_occupancy`
      addProfile({
        id: occupancy, kind: 'occupancy', label: `${sp.occupancy ? profile(sp.occupancy)!.name : 'Occupancy'} (${sp.name})`,
        ...(shape ? { schedule: shape } : {}), density: { value: sp.people_per_m2, basis: 'per_m2' },
        ...(sp.occupancy_rate != null ? { occupancy_rate: sp.occupancy_rate } : {}),
        ...(sp.sensible_w_per_person != null ? { sensible_w_per_person: sp.sensible_w_per_person } : {}),
        ...(is23 ? { radiant_fraction: sp.radiant_fraction ?? null } : {}),
      })
    } else if (sp.occupancy) notes.push(`${sp.name}: occupancy needs people per m² before it goes in the model`)
    return { occupancy, lighting: gain('lighting'), equipment: gain('equipment'), auxiliary: [] }
  }

  const bi = plan.building ?? noBuildingInputs()
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
      const heat = sp?.heat_c ?? null
      const cool = sp?.cool_c ?? null
      return { heat_c: heat, cool_c: cool, setback_c: null, hours_ref: null, control_strategy: heat != null || cool != null ? 'active_setpoint' : null }
    })(),
    ventilation: ventOf(z.id),
    infiltration_q50: bi.q50,
    infiltration_ach: null,
    ...(is21 ? { internal_heat_capacity_j_per_k_m2: TODAY.internal_heat_capacity_j_per_k_m2 } : {}),
    surfaces: byZone.get(z.id) ?? [],
  }))

  // Systems: per service, one group per system the user made, serving every zone it is given to, at 100% of that
  // service (one system per service per zone here). A template with no fuel ("No mechanical cooling") is none.
  const system_groups: Record<string, unknown>[] = []
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
      system_groups.push({ id: `${service}_${id}`, service, label: sys.name, zones: zs, enabled: true, share_pct: 100, source: t.fuel, efficiency_metric: efficiencyFor(t, service), template_ref: t.key })
    }
  }

  for (const k of new Set(surfaces.map((sf) => (sf.construction_ref as { key: string }).key))) {
    const c = construction(k)
    if (c?.pending) notes.push(`${c.name}: a draft library item, not yet checked by Chris`)
  }
  // Every library item the document uses, pinned by its body hash (from the snapshot), so a run says what it read.
  function libraryRefs() {
    const refs = new Map<string, { kind: string; key: string; version: null; body_hash: string }>()
    const pin = (kind: string, item: { key: string; body_hash: string } | undefined) => item && refs.set(`${kind}:${item.key}`, { kind, key: item.key, version: null, body_hash: item.body_hash })
    for (const sf of surfaces) pin('construction', construction((sf.construction_ref as { key: string }).key))
    for (const g of system_groups) pin('system_template', system(g.template_ref as string))
    for (const z of used) {
      for (const sv of SERVICES) pin('system_template', system(zoneSys(z.id, sv.key)?.template))
      const v = zoneSys(z.id, 'ventilation')
      if (v && system(v.template) && v.schedule && v.schedule !== 'always_on') pin('profile', profile(v.schedule))
      const sp = spaceOf.get(z.id)
      if (!sp) continue
      for (const k of ['occupancy', 'lighting', 'equipment'] as const) if (k !== 'occupancy' || (sp.people_per_m2 ?? 0) > 0) pin('profile', profile(sp[k]))
    }
    return [...refs.values()].sort((a, b) => (a.kind + a.key < b.kind + b.key ? -1 : 1))
  }

  const doc = {
    schema_version: SCHEMA_VERSION,
    building: {
      id: 'building_1',
      name: 'Geometry prototype',
      decoded_building_key: null,
      site: { lat: null, lon: null, name: null, exposure: bi.exposure, ...(is21 ? { ground: { method: 'annual_mean_outdoor' } } : {}) },
      orientation_deg: 0,
      reported_floor_area_m2: null,
      thermal_bridging: bi.tb_multiplier != null ? { mode: 'iso14683_auto', multiplier: bi.tb_multiplier, alpha_pct: null } : { mode: null, multiplier: null, alpha_pct: null },
      thermal_mass: { mode: null, category: null },
      opening_defaults: {},
    },
    zones,
    surfaces,
    system_groups,
    services: {
      heating: { setpoint_mode: 'follow_comfort', setpoint_c: null },
      cooling: { setpoint_mode: 'follow_comfort', setpoint_c: null },
      dhw: { storage_setpoint_c: null, tap_outlet_temp_c: null, cold_supply_temp_c: null, demand_basis: null, litres_per_person_per_day: null, litres_per_m2_per_day: null, load_shape: null, circulation_pump_w: null },
    },
    profiles,
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
