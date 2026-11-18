/**
 * Brief 121 P4 (the workspace): setpoints and window opening as the project's own profiles (Linzie, 17 Nov 00:31).
 * A space type whose heating follows a temperature profile writes heat_ref, heat_c as the profile's highest value and
 * no setback; cooling writes cool_ref and cool_c as its lowest. A window's hours can be a window-opening profile.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyPlan, newOwnProfile, type Plan, type XY } from '../plan'
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
/** An office day: 21 °C from 7 to 19, 16 °C otherwise (set as the editor's "in use from … to … at …, otherwise …"). */
const office = (on: number, off: number) => Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 19 ? on : off))

describe('setpoint profiles in the workspace (Brief 121 P4)', () => {
  it('heating follows a temperature profile: heat_ref, heat_c its highest, no setback; the run takes it', () => {
    let p = box()
    const n = newOwnProfile(p, 'heating_setpoint', 'Office heating', 16)
    n.own.day_types = { weekday: office(21, 16), saturday: Array(24).fill(16), sunday: Array(24).fill(16) }
    p = { ...p, own_profiles: [n.own], profiles: [n.key], spaces: p.spaces.map((sp) => ({ ...sp, heat_profile: n.key, heat_c: 99, setback_c: 12 })) }
    const b = buildDocument(p)
    const d = b.doc as any
    const z = d.zones[0]
    expect(z.setpoints.heat_ref).toBe(n.key)
    expect(z.setpoints.heat_c).toBe(21) // from the profile, not the stale 99 on the space type
    expect(z.setpoints.setback_c).toBe(null)
    const pr = d.profiles.find((x: any) => x.id === n.key)
    expect(pr).toMatchObject({ kind: 'temperature', purpose: 'heating_setpoint' })
    expect(b.issues).toEqual([])
    const r = simulate(d, { weather: WEATHER }) as any
    expect(r.ok).toBe(true)
    // Against one figure at 21 °C every hour, the profile's 16 °C nights and weekends heat less.
    const flat = buildDocument({ ...p, spaces: p.spaces.map((sp) => ({ ...sp, heat_profile: null, heat_c: 21, setback_c: null })) }).doc as any
    const r1 = simulate(flat, { weather: WEATHER }) as any
    expect(r1.ok).toBe(true)
    expect(r.summary.building.heating_kwh).toBeLessThan(r1.summary.building.heating_kwh)
  })

  it('a profile of 20 °C in use and 15 °C outside matches one figure with hours and a setback (Brief 109)', () => {
    let p = box()
    const n = newOwnProfile(p, 'heating_setpoint', 'Hours', 15)
    const day = Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 22 ? 20 : 15))
    n.own.day_types = { weekday: day, saturday: day, sunday: day }
    const hrs = newOwnProfile({ ...p, own_profiles: [n.own] }, 'ventilation', 'In use', 0)
    hrs.own.day_types = { weekday: day.map((v) => (v === 20 ? 1 : 0)), saturday: day.map((v) => (v === 20 ? 1 : 0)), sunday: day.map((v) => (v === 20 ? 1 : 0)) }
    p = { ...p, own_profiles: [n.own, hrs.own], profiles: [n.key, hrs.key] }
    const viaProfile = buildDocument({ ...p, spaces: p.spaces.map((sp) => ({ ...sp, heat_profile: n.key })) }).doc as any
    const viaHours = buildDocument({ ...p, spaces: p.spaces.map((sp) => ({ ...sp, heat_c: 20, heat_hours: hrs.key, setback_c: 15 })) }).doc as any
    const a = simulate(viaProfile, { weather: WEATHER }) as any
    const b = simulate(viaHours, { weather: WEATHER }) as any
    expect(a.ok && b.ok).toBe(true)
    expect(a.summary.building.heating_kwh).toBeCloseTo(b.summary.building.heating_kwh, 3)
    expect(a.summary.building.peak_heating_w).toBeCloseTo(b.summary.building.peak_heating_w, 3)
  })

  it('cooling follows a temperature profile: cool_ref and cool_c its lowest', () => {
    let p = box()
    const n = newOwnProfile(p, 'cooling_setpoint', 'Office cooling', 28)
    n.own.day_types = { weekday: office(24, 28), saturday: Array(24).fill(28), sunday: Array(24).fill(28) }
    p = { ...p, own_profiles: [n.own], profiles: [n.key], spaces: p.spaces.map((sp) => ({ ...sp, cool_profile: n.key })) }
    const d = buildDocument(p).doc as any
    expect(d.zones[0].setpoints.cool_ref).toBe(n.key)
    expect(d.zones[0].setpoints.cool_c).toBe(24)
    expect(d.profiles.find((x: any) => x.id === n.key)).toMatchObject({ kind: 'temperature', purpose: 'cooling_setpoint' })
  })

  it('a window-opening profile is written as a schedule with its purpose', () => {
    let p = box()
    const n = newOwnProfile(p, 'window_opening', 'Office windows', 0)
    n.own.day_types = { weekday: office(0.5, 0), saturday: Array(24).fill(0), sunday: Array(24).fill(0) }
    p = withOpening({ ...p, own_profiles: [n.own], profiles: [n.key] })
    p = { ...p, spaces: p.spaces.map((sp) => ({ ...sp, windows: { rule: 'timetable', open_fraction: 1, open_above_c: null, hours: n.key, controller: 'manual' } })) }
    const d = buildDocument(p).doc as any
    const c = d.controls.find((x: any) => x.target.kind === 'window')
    expect(c.hours_ref).toBe(n.key)
    expect(d.profiles.find((x: any) => x.id === n.key)).toMatchObject({ kind: 'schedule', purpose: 'window_opening' })
  })
})

function withOpening(p: Plan): Plan {
  const g = p.wall_spans.find((x) => x.element === 'glazing')!.type
  return {
    ...p,
    building: { ...p.building, air_method: 'weather_driven', air_exponent: 0.67, single_sided_turbulence: true, terrain: 'suburban' },
    fabric_types: p.fabric_types.map((t) => (t.id === g ? { ...t, opening: { style: 'side_hung', openable_fraction: 0.5, opening_angle_deg: 30, cd: 0.6 } } : t)),
  }
}
