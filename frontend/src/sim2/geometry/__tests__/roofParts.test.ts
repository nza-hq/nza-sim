import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { area } from '../ported/zones'
import { partsFit, roofPieces, splitAtCorner } from '../roof'
import { buildDocument } from '../toDocument'
import { upgradePlan, type Plan } from '../plan'

const L: [number, number][] = [[0, 0], [64, 0], [64, 40], [40, 40], [40, 10], [0, 10]]

describe('roof parts (17 Nov 2026, example school): a roof for each part of one block', () => {
  it('an L splits at its inner corner into two rectangles that cover it', () => {
    for (const way of [0, 1] as const) {
      const s = splitAtCorner(L, way)!
      expect(s).not.toBeNull()
      expect(area(s[0]) + area(s[1])).toBeCloseTo(area(L), 6)
      expect(partsFit(L, s.map((ring) => ({ ring })))).toBe(true)
    }
    expect(partsFit(L, [{ ring: [[0, 0], [64, 0], [64, 10], [0, 10]] }])).toBe(false)
  })
  it('without parts the block has one roof (the plan\'s); stale parts fall back to it', () => {
    expect(roofPieces({ blocks: [L], roof: null })).toHaveLength(1)
    expect(roofPieces({ blocks: [L], roof: null, roof_parts: [{ id: 'a', name: 'a', ring: [[0, 0], [5, 0], [5, 5], [0, 5]], recipe: { style: 'flat' } as never }] })).toHaveLength(1)
  })
  it('the example school: a loft over the old wing only, a mono-pitch over the extension, floor area unchanged', () => {
    const file = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../../docs/examples/extended_school.plan.json'), 'utf8'))
    const plan = upgradePlan(file.plan) as Plan
    expect(roofPieces(plan)).toHaveLength(2)
    const b = buildDocument(plan)
    expect(b.ok).toBe(true)
    const doc = b.doc as any
    const lofts = doc.zones.filter((z: any) => z.conditioning === 'unconditioned')
    expect(lofts).toHaveLength(1)
    // The loft's ceilings are the old wing's footprint (64 × 10 m, less the extension's share of the corner).
    const ceil = doc.surfaces.filter((s: any) => s.kind === 'ceiling').reduce((t: number, s: any) => t + s.area_m2, 0)
    expect(ceil).toBeCloseTo(640, 0)
    expect(b.totals.floor_m2).toBeCloseTo(1360, 1)
  })
})
