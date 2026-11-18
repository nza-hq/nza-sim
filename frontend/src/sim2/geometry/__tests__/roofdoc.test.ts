import { describe, expect, it } from 'vitest'
import fixture from '../__fixtures__/two_zones.plan.json'
import { buildDocument } from '../toDocument'
import { defaultRoof } from '../roof'
import type { Plan } from '../plan'

const base = (fixture as unknown as { plan: Plan }).plan
const roofType = base.fabric_types.find((t) => t.element === 'roof')!.id

describe('Brief 123: a pitched roof in the document', () => {
  it('cold gable: an unconditioned loft, ceilings to it, slopes and gable walls on it', () => {
    const plan: Plan = { ...base, roof: { ...defaultRoof('gable'), loft_slope_type: roofType } }
    const b = buildDocument(plan)
    expect(b.issues).toEqual([])
    expect(b.ok).toBe(true)
    const doc = b.doc as any
    const loft = doc.zones.find((z: any) => z.id === 'loft')
    expect(loft.conditioning).toBe('unconditioned')
    expect(loft.setpoints.heat_c).toBeNull()
    expect(loft.infiltration_ach).toBe(3)
    const ceil = doc.surfaces.filter((s: any) => s.kind === 'ceiling')
    expect(ceil.reduce((t: number, s: any) => t + s.area_m2, 0)).toBeCloseTo(200, 2)
    const slopes = doc.surfaces.filter((s: any) => s.zone_a === 'loft' && s.kind === 'roof')
    expect(slopes.reduce((t: number, s: any) => t + s.area_m2, 0)).toBeCloseTo(200 / Math.cos((35 * Math.PI) / 180), 2)
    expect(doc.surfaces.filter((s: any) => s.zone_a === 'loft' && s.kind === 'wall')).toHaveLength(2)
    expect(doc.surfaces.some((s: any) => s.kind === 'roof' && s.zone_a !== 'loft')).toBe(false)
    expect(b.totals.floor_m2).toBeCloseTo(200, 3)
  })
  it('cold gable with no slope construction: the document says what to set', () => {
    const b = buildDocument({ ...base, roof: defaultRoof('gable') })
    expect(b.notes.some((n) => /loft's roof slopes/.test(n))).toBe(true)
  })
  it('warm mono-pitch: slopes on the rooms, rooms taller by the roof space, no loft', () => {
    const b = buildDocument({ ...base, roof: defaultRoof('mono') })
    expect(b.ok).toBe(true)
    const doc = b.doc as any
    expect(doc.zones.some((z: any) => z.id === 'loft')).toBe(false)
    const slopes = doc.surfaces.filter((s: any) => s.kind === 'roof')
    expect(slopes.reduce((t: number, s: any) => t + s.area_m2, 0)).toBeCloseTo(200 / Math.cos((10 * Math.PI) / 180), 1)
    const vol = doc.zones.reduce((t: number, z: any) => t + z.area_m2 * z.height_m, 0)
    expect(vol).toBeCloseTo(200 * base.storey_height_m + 200 * 10 * Math.tan((10 * Math.PI) / 180) / 2, 0)
  })
  it('flat: unchanged', () => {
    expect(JSON.stringify(buildDocument({ ...base, roof: defaultRoof('flat') }).doc)).toBe(JSON.stringify(buildDocument(base).doc))
  })
})
