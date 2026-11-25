/** Brief 129: hot water may follow a hot water profile (a schedule profile named as the load shape). */
import { describe, expect, it } from 'vitest'
import { zoneHotWater } from '../hotWater'

const H = 24 * 7
const hours = { count: H, month: new Int8Array(H).fill(1), day: Int8Array.from({ length: H }, (_, h) => 1 + Math.floor(h / 24)), hour: Int8Array.from({ length: H }, (_, h) => (h % 24) + 1) } as any
const morning = Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 9 ? 1 : 0))
const doc = (shape: string) => ({
  zones: [{ id: 'z', name: 'Z', area_m2: 100, profile_refs: { occupancy: 'occ' } }],
  profiles: [
    { id: 'occ', kind: 'occupancy', dhw: { basis: 'per_m2', litres_per_day: 1 } },
    { id: 'hw', kind: 'schedule', purpose: null, day_types: { weekday: morning, saturday: morning, sunday: morning } },
  ],
  services: { dhw: { storage_setpoint_c: 60, tap_outlet_temp_c: 43, cold_supply_temp_c: 10, load_shape: shape, circulation_pump_w: 0 } },
}) as any

describe('hot water profile', () => {
  it('draws only in the profile\'s hours, with the same yearly total as flat', () => {
    const a = zoneHotWater(doc('hw'), [null], H, hours)
    const f = zoneHotWater(doc('flat'), [null], H, hours)
    if (!a.ok || !f.ok) throw new Error('not ok')
    const w = a.hw!.zones[0]!.w
    expect(w[3]).toBe(0)
    expect(w[7]).toBeGreaterThan(0)
    const sum = (x: Float64Array) => x.reduce((s, v) => s + v, 0)
    expect(sum(w)).toBeCloseTo(sum(f.hw!.zones[0]!.w), 6)
  })
  it('an unknown profile is named, not dropped', () => {
    const r = zoneHotWater(doc('nope'), [null], H, hours)
    expect(r.ok).toBe(false)
  })
})
