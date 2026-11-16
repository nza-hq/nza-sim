/**
 * Brief 119 Part 3: the catalogue is the catalogue's own figures, an emitter that names an item is checked against it,
 * and a suggestion is the smallest item that covers the rating still needed.
 */
import { describe, expect, it } from 'vitest'
import { CATALOGUES, catalogueItem, checkCatalogueRefs, STELRAD_VITA_COMPACT as C, suggestItem } from '../index'
import { cooledRoomDocument } from '../../engine/__tests__/cooledRoom'

describe('Stelrad Vita Compact as printed', () => {
  it('26 items, codes that name their height, type and length, and a source', () => {
    expect(C.items).toHaveLength(26)
    expect(new Set(C.items.map((x) => x.id)).size).toBe(26)
    for (const x of C.items) {
      // 76 + height in cm (45, 60) + type (22) + length in dm (04 … 20): 7645 22 04 is 450 mm, Type 22, 400 mm.
      expect(x.id).toBe(`76${x.height_mm / 10}22${String(x.length_mm / 100).padStart(2, '0')}`)
      expect(x.exponent_n).toBe(1.33)
    }
    expect(C.rating).toEqual({ flow_c: 75, return_c: 65, room_c: 20 })
    expect(C.source_url).toMatch(/^https:\/\/www\.stelrad\.com\//)
    expect(CATALOGUES[C.id]).toBe(C)
  })
  it('the 1,000 mm rows equal the per-metre outputs printed in the piping table; longer is more', () => {
    expect(catalogueItem(C.id, '76452210')!.item.output_w).toBe(1371)
    expect(catalogueItem(C.id, '76602210')!.item.output_w).toBe(1732)
    for (const h of [450, 600]) {
      const at = C.items.filter((x) => x.height_mm === h)
      for (let i = 1; i < at.length; i++) { expect(at[i].length_mm).toBeGreaterThan(at[i - 1].length_mm); expect(at[i].output_w).toBeGreaterThan(at[i - 1].output_w) }
    }
    expect(catalogueItem(C.id, 'nope')).toBeNull()
  })
})

describe('an emitter that names an item states its figures', () => {
  const rad = (over: Record<string, unknown> = {}) => ({
    id: 'r', kind: 'radiator', count: 2, rated_output_w: 1732, radiant_fraction: 0.3, system_group_id: 'b', rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.33,
    source_surface_id: null, source_layer_index: null, heats: true, cooling_output_w: null, catalogue_ref: { catalogue: C.id, item: '76602210' }, ...over,
  })
  const docWith = (e: Record<string, unknown>) => { const d: any = structuredClone(cooledRoomDocument().doc); d.zones[0].emitters = [e]; return d }
  it('agreeing: nothing', () => expect(checkCatalogueRefs(docWith(rad()))).toEqual([]))
  it('every difference named, nothing filled', () => {
    const m = checkCatalogueRefs(docWith(rad({ rated_output_w: 1800, exponent_n: 1.3, rated_room_c: 21 })))
    expect(m.map((x) => x.path)).toEqual(['zones[0].emitters[0].rated_output_w', 'zones[0].emitters[0].rated_room_c', 'zones[0].emitters[0].exponent_n'])
    expect(m[0].what).toBe('states 1800, but the output of Stelrad Vita Compact 76602210 is 1732')
    expect(checkCatalogueRefs(docWith(rad({ catalogue_ref: { catalogue: 'acme', item: 'x' } })))[0].what).toContain('not one NZA Sim has')
    expect(checkCatalogueRefs(docWith(rad({ catalogue_ref: { catalogue: C.id, item: 'x' } })))[0].what).toContain('not in Stelrad Vita Compact')
    expect(checkCatalogueRefs(docWith(rad({ kind: 'fan_coil' })))[0].what).toContain('is a fan_coil')
  })
})

describe('suggestions', () => {
  it('the smallest item at the height that adds the rating; else the fewest of the largest', () => {
    expect(suggestItem(C, 600, 1000)).toEqual({ item: catalogueItem(C.id, '76602206')!.item, count: 1 })  // 1,039 W
    expect(suggestItem(C, 600, 1039)!.item.id).toBe('76602206')
    expect(suggestItem(C, 450, 3000)).toEqual({ item: catalogueItem(C.id, '76452220')!.item, count: 2 })  // 2 × 2,743 W
    expect(suggestItem(C, 700, 1000)).toBeNull()  // no 700 mm items listed
    expect(suggestItem(C, 600, 0)).toBeNull()
  })
})
