// Brief 124 P4: every room has a floor finish and a ceiling, typical for its space until chosen, written on the document.
import { describe, expect, it } from 'vitest'
import { finishesOf } from '../plan'

describe('finishesOf (Brief 124 D4)', () => {
  it('offices, meeting rooms, classrooms and hotel bedrooms: carpet and a suspended ceiling', () => {
    for (const name of ['Office', 'Meeting room', 'Classroom', 'Bedroom']) {
      expect(finishesOf({ name, use: 'other', borrowed: null } as never)).toMatchObject({ floor: 'carpet', ceiling: 'suspended', floor_typical: true })
    }
    expect(finishesOf({ name: 'Rooms', use: 'other', borrowed: 'hotel_bedroom' } as never).floor).toBe('carpet')
  })
  it('halls, kitchens, WCs, plant, stores and anything else: hard floor and exposed soffit', () => {
    for (const name of ['Main hall', 'Kitchen', 'WC', 'Plant room', 'Store', 'Foyer']) {
      expect(finishesOf({ name, use: 'public', borrowed: null } as never)).toMatchObject({ floor: 'hard', ceiling: 'exposed' })
    }
    expect(finishesOf(undefined)).toMatchObject({ floor: 'hard', ceiling: 'exposed' })
  })
  it('a chosen finish wins and is no longer typical', () => {
    const f = finishesOf({ name: 'Main hall', use: 'public', borrowed: null, floor_finish: 'carpet', ceiling: 'suspended' } as never)
    expect(f).toEqual({ floor: 'carpet', ceiling: 'suspended', floor_typical: false, ceiling_typical: false })
  })
})

import fixture from '../__fixtures__/two_zones.plan.json'
import { buildDocument } from '../toDocument'
import { defaultRoof } from '../roof'
import type { Plan } from '../plan'
import { ModelDocument } from '../../../thermal/schema/model'

const base = (fixture as unknown as { plan: Plan }).plan
const fin = (doc: any, zone: string, kind: string) => doc.surfaces.filter((s: any) => s.zone_a === zone && s.kind === kind).map((s: any) => s.inside_finish ?? null)

// The library's ground floors already have carpet in them; a floor type without carpet shows the finish being added.
const bare: Plan = { ...base, fabric_types: base.fabric_types.map((t) => (t.element === 'floor' ? { ...t, construction: 'flat_roof_standard' } : t)) }

describe('finishes on the document (Brief 124 P4)', () => {
  it('flat roof: carpet and ceiling tiles in the office, none in the store, pinned and valid', () => {
    const b = buildDocument(bare)
    expect(b.ok).toBe(true)
    const doc = b.doc as any
    expect(fin(doc, 'z1', 'ground')).toEqual([{ key: 'finish_carpet' }])
    expect(fin(doc, 'z1', 'roof')).toEqual([{ key: 'finish_suspended_ceiling' }])
    expect(fin(doc, 'z2', 'ground')).toEqual([null])
    expect(fin(doc, 'z2', 'roof')).toEqual([null])
    const pinned = JSON.stringify(doc.library_refs)
    expect(pinned).toContain('finish_carpet')
    expect(pinned).toContain('finish_suspended_ceiling')
    expect(() => ModelDocument.parse(doc)).not.toThrow()
  })
  it('cold roof: the suspended ceiling goes on the loft ceiling; a chosen finish wins', () => {
    const roofType = base.fabric_types.find((t) => t.element === 'roof')!.id
    const plan: Plan = { ...bare, roof: { ...defaultRoof('gable'), loft_slope_type: roofType }, spaces: base.spaces.map((s) => (s.id === 's2' ? { ...s, floor_finish: 'carpet' } : s)) }
    const doc = buildDocument(plan).doc as any
    expect(fin(doc, 'z1', 'ceiling')).toEqual([{ key: 'finish_suspended_ceiling' }])
    expect(fin(doc, 'z2', 'ground')).toEqual([{ key: 'finish_carpet' }])
    expect(fin(doc, 'loft', 'roof').every((f: unknown) => f === null)).toBe(true)
  })
  it('a floor construction with carpet in it takes no carpet on top; a hard floor chosen on it is noted', () => {
    const b = buildDocument(base)
    expect(fin(b.doc, 'z1', 'ground')).toEqual([null])
    expect(b.notes.join(' ')).not.toContain('already has carpet')
    const c = buildDocument({ ...base, spaces: base.spaces.map((s) => (s.id === 's1' ? { ...s, floor_finish: 'hard' } : s)) })
    expect(c.notes.join(' ')).toContain('Office: hard floor chosen, but its ground floor construction already has carpet in it')
  })
})
