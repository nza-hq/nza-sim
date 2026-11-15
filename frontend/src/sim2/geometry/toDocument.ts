/**
 * Sim2 geometry prototype: the plan → a Simulate v2 model document (frontend/src/thermal/schema), checked by the
 * schema itself. The editor never writes the document by hand anywhere else (CLAUDE.md rule 4: the schema is the
 * contract).
 *
 * What the plan says, the document says: one zone per drawn zone, its floor polygon and area; per zone, a wall for
 * each stretch of footprint it sits on (true azimuth, area = length × storey height, net of its windows), the glazing
 * on that wall (window count and area), partitions on shared stretches, a roof and a ground floor of its own area.
 *
 * What the plan does not say yet is left visibly unset, never invented (CLAUDE.md rule 2 and 3): constructions are
 * `unassigned:<element>` keys, no profiles, no systems, no weather, use type "unassigned". The four optical numbers
 * schema 2.1 requires (absorptance 0.6 walls / 0.7 roofs, emissivity 0.9, frame fraction 0.20) and the internal heat
 * capacity (250,000 J/K·m²) are today's engine's own hard-coded values, named in the schema's comments.
 *
 * Window positions are not in schema 2.x (a glazing surface is an area and a count). They travel alongside the
 * document as `layout` (the plan itself) until the Engine thread agrees where they belong; see PROPOSAL in the
 * branch notes.
 */
import { ModelDocument, SCHEMA_VERSION } from '../../thermal/schema/model'
import { allWindows, facade4, type Plan, zoneArea, zoneEdges } from './plan'

const r3 = (n: number) => Math.round(n * 1000) / 1000
const is21 = (SCHEMA_VERSION as string) !== '2.0'

export type Built = {
  doc: unknown
  ok: boolean
  issues: Array<{ path: string; message: string }>
  /** Plain-words problems from the plan itself (a window set that no longer fits, a gap between zones). */
  notes: string[]
  totals: { zones: number; floor_m2: number; walls: number; wall_net_m2: number; glazing: number; glazing_m2: number; windows: number; partitions: number }
}

export function buildDocument(plan: Plan): Built {
  const notes: string[] = []
  const h = plan.storey_height_m
  const { walls, shares, open } = zoneEdges(plan)
  const { windows, problems } = allWindows(plan)
  problems.forEach((p) => notes.push(`Window set ${p.set}: ${p.why}`))
  for (const o of open) notes.push(`Zone ${plan.zones.find((z) => z.id === o.zone)?.name ?? o.zone} has ${r3(o.length_m)} m of side that is neither outside wall nor shared with another zone`)

  const ext = (s: Record<string, unknown>, kind: 'wall' | 'roof' | 'glazing' | 'other') =>
    is21
      ? {
          ...s,
          solar_absorptance: kind === 'wall' ? 0.6 : kind === 'roof' ? 0.7 : null,
          thermal_emissivity: kind === 'other' ? null : 0.9,
          frame_fraction: kind === 'glazing' ? 0.2 : null,
        }
      : s

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
    for (const x of mine) if (x.offset_m < w.t0 - 1e-6 || x.offset_m + x.width_m > w.t1 + 1e-6) notes.push(`A window on wall ${w.run + 1} straddles a zone line; it is counted in the zone its middle is in`)
    windowsPlaced += mine.length
    const gross = w.length_m * h
    const glz = mine.reduce((s, x) => s + x.width_m * x.height_m, 0)
    const wallId = uid(`${w.zone}_wall_${w.run + 1}`)
    add(w.zone, ext({
      id: wallId, kind: 'wall', zone_a: w.zone, zone_b: 'outside', facade: facade4(w.azimuth_deg),
      area_m2: r3(gross - glz), azimuth_deg: w.azimuth_deg, tilt_deg: 90,
      construction_ref: { key: 'unassigned:external_wall' }, g_value: null, openings: [],
    }, 'wall'))
    if (mine.length) {
      add(w.zone, ext({
        id: uid(`${w.zone}_glazing_${w.run + 1}`), kind: 'glazing', zone_a: w.zone, zone_b: 'outside', facade: facade4(w.azimuth_deg),
        area_m2: r3(glz), azimuth_deg: w.azimuth_deg, tilt_deg: 90,
        construction_ref: { key: 'unassigned:glazing' }, g_value: null,
        wwr: r3(glz / gross), window_count: mine.length, openings: [],
      }, 'glazing'))
    }
  }
  if (windowsPlaced < windows.length) notes.push(`${windows.length - windowsPlaced} window(s) are on no zone's wall`)

  for (const s of shares) {
    const id = uid(`partition_${s.a}_${s.b}`)
    const surf = ext({
      id, kind: 'partition', zone_a: s.a, zone_b: s.b, facade: null, area_m2: r3(s.length_m * h),
      azimuth_deg: null, tilt_deg: 90, construction_ref: { key: 'unassigned:partition' }, g_value: null, openings: [],
    }, 'other')
    surfaces.push(surf)
    byZone.set(s.a, [...(byZone.get(s.a) ?? []), id])
    byZone.set(s.b, [...(byZone.get(s.b) ?? []), id])
  }
  for (const z of plan.zones) {
    const a = r3(zoneArea(z))
    add(z.id, ext({ id: uid(`${z.id}_roof`), kind: 'roof', zone_a: z.id, zone_b: 'outside', facade: null, area_m2: a, azimuth_deg: null, tilt_deg: 0, construction_ref: { key: 'unassigned:roof' }, g_value: null, openings: [] }, 'roof'))
    add(z.id, ext({ id: uid(`${z.id}_ground`), kind: 'ground', zone_a: z.id, zone_b: 'ground', facade: null, area_m2: a, azimuth_deg: null, tilt_deg: 180, construction_ref: { key: 'unassigned:ground_floor' }, g_value: null, openings: [] }, 'other'))
  }

  const zones = plan.zones.map((z) => ({
    id: z.id,
    name: z.name,
    floor: 0,
    storeys: 1,
    polygon: z.ring.map(([x, y]) => [r3(x), r3(y)]),
    area_m2: r3(zoneArea(z)),
    height_m: h,
    use_type: 'unassigned',
    rooms: null,
    profile_refs: { occupancy: null, lighting: [], equipment: [], auxiliary: [] },
    setpoints: { heat_c: null, cool_c: null, setback_c: null, hours_ref: null, control_strategy: null },
    ventilation: [],
    infiltration_q50: null,
    infiltration_ach: null,
    ...(is21 ? { internal_heat_capacity_j_per_k_m2: 250000 } : {}),
    surfaces: byZone.get(z.id) ?? [],
  }))

  const doc = {
    schema_version: SCHEMA_VERSION,
    building: {
      id: 'building_1',
      name: 'Geometry prototype',
      decoded_building_key: null,
      site: { lat: null, lon: null, name: null, exposure: null, ...(is21 ? { ground: { method: 'annual_mean_outdoor' } } : {}) },
      orientation_deg: 0,
      reported_floor_area_m2: null,
      thermal_bridging: { mode: null, multiplier: null, alpha_pct: null },
      thermal_mass: { mode: null, category: null },
      opening_defaults: {},
    },
    zones,
    surfaces,
    system_groups: [],
    services: {
      heating: { setpoint_mode: 'follow_comfort', setpoint_c: null },
      cooling: { setpoint_mode: 'follow_comfort', setpoint_c: null },
      dhw: { storage_setpoint_c: null, tap_outlet_temp_c: null, cold_supply_temp_c: null, demand_basis: null, litres_per_person_per_day: null, litres_per_m2_per_day: null, load_shape: null, circulation_pump_w: null },
    },
    profiles: [],
    weather_ref: { kind: 'legacy', id: 'unassigned' },
    library_refs: [],
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
      floor_m2: r3(zones.reduce((s, z) => s + z.area_m2, 0)),
      walls: sum('wall').length,
      wall_net_m2: r3(sum('wall').reduce((s, x) => s + (x.area_m2 as number), 0)),
      glazing: sum('glazing').length,
      glazing_m2: r3(sum('glazing').reduce((s, x) => s + (x.area_m2 as number), 0)),
      windows: windowsPlaced,
      partitions: sum('partition').length,
    },
  }
}
