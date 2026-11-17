/**
 * Brief 115 P6 (editor): the workspace's air inputs reach the document. Weather-driven air states its terrain,
 * exponent and single-sided choice; a window type's opening and trickle vent become the glazing surface's openings; a
 * space type's window rule becomes one window entry per zone; a plan saved before 115 keeps today's method.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyPlan, type Plan, type XY } from '../plan'
import { setOpeningsIn } from '../facade'
import { fitRooms } from '../rooms'
import { applySet } from '../applySet'
import { CONSTRUCTION_SETS } from '../../library/sets'
import { buildDocument } from '../toDocument'
import { simulate } from '../../run/seam'
import { MOS, readMos } from '../../../thermal/engine/__tests__/denver'

const W = readMos(readFileSync(MOS))
const WEATHER = { weather: W, file_name: 'denver.mos', station: 'Denver', sha256: W.sha256, source: 'local' as const }

function box(): Plan {
  const fp: XY[] = [[0, 0], [10, 0], [10, 6], [0, 6]]
  let p = fitRooms(emptyPlan(), [fp]).plan
  const r = setOpeningsIn(p, { run: 0, t0: 0, t1: 10 }, { count: 3, width_m: 1.2, height_m: 1.4, sill_m: 0.9, shading_m: 0 }, null)
  if ('why' in r) throw new Error(r.why)
  p = applySet(r.plan, CONSTRUCTION_SETS[0]!, p.rooms.map((x) => x.id))
  return {
    ...p,
    building: { ...p.building, q50: 5, tb_multiplier: 1, exposure: 'normal' },
    spaces: [{ id: 's1', name: 'Office', use: 'office', occupancy: null, lighting: null, equipment: null, people_per_m2: null, heat_c: 20, cool_c: null } as any],
    rooms: p.rooms.map((x) => ({ ...x, space: 's1' })),
  }
}
const glazingType = (p: Plan) => p.wall_spans.find((x) => x.element === 'glazing')!.type
const withWindows = (p: Plan, q: Partial<Plan['fabric_types'][number]>): Plan => ({ ...p, fabric_types: p.fabric_types.map((t) => (t.id === glazingType(p) ? { ...t, ...q } : t)) })

describe('air in the workspace (Brief 115 P6)', () => {
  it('a plan saved before 115 keeps today\'s method; a trickle vent states its flow mode there', () => {
    const p = withWindows(box(), { trickle: { area_mm2: 2500, cd: 0.6, flow_mode: 'single_sided' }, opening: { style: 'side_hung', openable_fraction: 0.5, opening_angle_deg: 30, cd: 0.6 } })
    const b = buildDocument(p)
    const d = b.doc as any
    expect(d.building.air).toEqual({ method: 'today', exponent: null, single_sided_turbulence: null })
    const g = d.surfaces.find((s: any) => s.kind === 'glazing')
    expect(g.openings).toEqual([{ kind: 'permanent_vent', area_m2: 0.0075, cd: 0.6, flow_mode: 'single_sided' }])
    expect(b.notes.join(' ')).toContain('opening windows count only with weather-driven air')
    const r = simulate(d, { weather: WEATHER }) as any
    expect(r.ok).toBe(true)
    expect(r.summary.zones[0].air).toBeNull()
  })

  it('weather-driven: terrain, exponent, openings at their heights, and the window rule as the zone\'s entry; the run opens them', () => {
    let p = withWindows(box(), { trickle: { area_mm2: 2500, cd: 0.6, flow_mode: null }, opening: { style: 'side_hung', openable_fraction: 0.5, opening_angle_deg: 30, cd: 0.6 } })
    p = { ...p, building: { ...p.building, air_method: 'weather_driven', air_exponent: 0.67, single_sided_turbulence: true, terrain: 'suburban' } }
    // No window rule yet: the run asks for one by name, nothing filled.
    const d0 = buildDocument(p).doc as any
    expect(d0.building.air).toEqual({ method: 'weather_driven', exponent: 0.67, single_sided_turbulence: true })
    expect(d0.building.site.terrain).toBe('suburban')
    const g = d0.surfaces.find((s: any) => s.kind === 'glazing')
    expect(g.openings).toEqual([
      { kind: 'operable', openable_fraction: 0.5, cd: 0.6, style: 'side_hung', opening_angle_deg: 30, sill_m: 0.9, head_m: 2.3 },
      { kind: 'permanent_vent', area_m2: 0.0075, cd: 0.6, height_m: 2.3 },
    ])
    const r0 = simulate(d0, { weather: WEATHER }) as any
    expect(r0.ok).toBe(false)
    expect(JSON.stringify(r0.missing)).toContain("window rule")
    // With the space type's rule: one entry for the zone.
    p = { ...p, spaces: p.spaces.map((s) => ({ ...s, windows: { rule: 'temperature', open_above_c: 24, open_fraction: 1, hours: null, controller: 'manual' } })) }
    const d = buildDocument(p).doc as any
    expect(d.controls).toEqual([expect.objectContaining({ id: `ctl_window_${d.zones[0].id}`, target: { kind: 'window', ref: d.zones[0].id }, controller: 'manual', rule: 'temperature', open_above_c: 24, open_fraction: 1, operation: 'by_hand', hours_ref: null })])
    const r = simulate(d, { weather: WEATHER }) as any
    expect(r.ok).toBe(true)
    const terms = r.summary.breakdown.map((x: any) => x.term)
    expect(terms).toContain('window_ventilation')
    expect(r.summary.breakdown.find((x: any) => x.term === 'window_ventilation').kwh).toBeLessThan(0)
    // Review F4: the run carries each zone's air (Rule 11), so the editor reads it rather than working it out again.
    expect(r.summary.zones[0].air.leakage).toBe('weather')
    expect(r.summary.zones[0].air.hours_windows_open).toBeGreaterThan(0)
  })

  it('a window rule that opens below the heating temperature is refused by name', () => {
    let p = withWindows(box(), { opening: { style: 'sliding', openable_fraction: 0.5, opening_angle_deg: null, cd: 0.6 } })
    p = { ...p, building: { ...p.building, air_method: 'weather_driven', air_exponent: 0.67, single_sided_turbulence: false, terrain: 'urban' } }
    p = { ...p, spaces: p.spaces.map((s) => ({ ...s, windows: { rule: 'temperature', open_above_c: 18, open_fraction: 1, hours: null, controller: 'local' } })) }
    const d = buildDocument(p).doc as any
    expect(d.surfaces.find((s: any) => s.kind === 'glazing').openings[0]).toMatchObject({ style: 'sliding', opening_angle_deg: null })
    const r = simulate(d, { weather: WEATHER }) as any
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r.missing)).toContain('open_above_c')
  })
})
