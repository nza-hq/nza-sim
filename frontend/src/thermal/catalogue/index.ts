/**
 * Brief 119 Part 3: published emitter catalogues, as data. Every figure is the catalogue's own, as printed: nothing is
 * computed, interpolated or filled (CLAUDE.md Rules 2 and 3). A document's emitter names an item through
 * `catalogue_ref`; the run checks the emitter's own figures against it and refuses a difference by name. It never
 * fills an emitter from the catalogue: the document states its figures, the reference says where they came from.
 *
 * Linzie, 16 Nov 2026 14:49: Stelrad Vita Compact first; other makes later.
 */
import type { ModelDocument } from '../schema/model'

export interface CatalogueItem {
  /** The maker's product code, as printed. */
  id: string
  kind: 'radiator'
  /** The panel type, as the maker names it, and its common name. */
  type: string
  height_mm: number
  length_mm: number
  /** One unit's output at the catalogue's rating, W, as printed. */
  output_w: number
  /** EN 442 exponent n for this type and height, as printed. */
  exponent_n: number
}

export interface Catalogue {
  id: string
  title: string
  maker: string
  source_url: string
  /** When the source was read, and how. */
  retrieved: string
  /** The edition or date printed on the source; null when none is printed. */
  edition: string | null
  /** sha256 of the source file; null when the file could not be fetched whole (said in `retrieved`). */
  source_sha256: string | null
  /** The rating every output is given at (EN 442's ΔT 50: 75/65/20 °C). */
  rating: { flow_c: number; return_c: number; room_c: number }
  basis: string
  items: CatalogueItem[]
}

const K2 = 'K2 (Type 22, double panel double convector)'
/** [length mm, product code, W] at 450 mm and 600 mm, from the catalogue's heat output table. */
const K2_450: [number, string, number][] = [
  [400, '76452204', 548], [500, '76452205', 686], [600, '76452206', 823], [700, '76452207', 960], [800, '76452208', 1097],
  [900, '76452209', 1234], [1000, '76452210', 1371], [1100, '76452211', 1508], [1200, '76452212', 1645], [1400, '76452214', 1920],
  [1600, '76452216', 2195], [1800, '76452218', 2469], [2000, '76452220', 2743],
]
const K2_600: [number, string, number][] = [
  [400, '76602204', 693], [500, '76602205', 866], [600, '76602206', 1039], [700, '76602207', 1212], [800, '76602208', 1386],
  [900, '76602209', 1559], [1000, '76602210', 1732], [1100, '76602211', 1906], [1200, '76602212', 2078], [1400, '76602214', 2426],
  [1600, '76602216', 2772], [1800, '76602218', 3119], [2000, '76602220', 3465],
]
const item = (height_mm: number) => ([length_mm, id, output_w]: [number, string, number]): CatalogueItem =>
  ({ id, kind: 'radiator', type: K2, height_mm, length_mm, output_w, exponent_n: 1.33 })

export const STELRAD_VITA_COMPACT: Catalogue = {
  id: 'stelrad-vita-compact',
  title: 'Stelrad Vita Compact',
  maker: 'Stelrad',
  source_url: 'https://www.stelrad.com/wp-content/uploads/2021/11/26979_Vita-Compact_Web.pdf',
  retrieved: '16 Nov 2026, as text extracted from the PDF (the download itself is blocked here, so no file hash). The type of each column is read from the product codes (7645 22 04: 450 mm, Type 22, 400 mm) and agrees with the per-metre outputs printed in the piping table (K2: 1,371 W/m at 450 mm, 1,732 W/m at 600 mm). No date is printed; the URL path\'s 2021/11 is the only one. All 26 rows were matched again against a second, independent read of the PDF by the Brief 119 review.',
  edition: null,
  source_sha256: null,
  rating: { flow_c: 75, return_c: 65, room_c: 20 },
  basis: 'Heat output at ΔT 50 (75/65/20 °C), "EN 442 certification data, CETIAT tested in accordance with BS EN 442"; n-coefficient for K2 1.33 at 450 and 600 mm, as printed.',
  items: [...K2_450.map(item(450)), ...K2_600.map(item(600))],
}

export const CATALOGUES: Record<string, Catalogue> = { [STELRAD_VITA_COMPACT.id]: STELRAD_VITA_COMPACT }

export function catalogueItem(catalogue: string, id: string): { catalogue: Catalogue; item: CatalogueItem } | null {
  const c = CATALOGUES[catalogue]
  const it = c?.items.find((x) => x.id === id)
  return c && it ? { catalogue: c, item: it } : null
}

/** One difference between an emitter and the catalogue item it names. */
export interface CatalogueMismatch { path: string; what: string }

/**
 * Each emitter that names a catalogue item, checked against it: the item exists, is the same kind, and the emitter
 * states the item's output, rating and exponent exactly. Returns every difference (empty: all agree).
 */
export function checkCatalogueRefs(doc: ModelDocument): CatalogueMismatch[] {
  const out: CatalogueMismatch[] = []
  doc.zones.forEach((z, zi) => z.emitters.forEach((e, j) => {
    const ref = e.catalogue_ref
    if (!ref) return
    const p = `zones[${zi}].emitters[${j}]`
    const c = CATALOGUES[ref.catalogue]
    if (!c) { out.push({ path: `${p}.catalogue_ref`, what: `names catalogue "${ref.catalogue}", which is not one NZA Sim has` }); return }
    const it = c.items.find((x) => x.id === ref.item)
    if (!it) { out.push({ path: `${p}.catalogue_ref`, what: `names item "${ref.item}", which is not in ${c.title}` }); return }
    if (e.kind !== it.kind) out.push({ path: `${p}.kind`, what: `is a ${e.kind}, but ${c.title} ${it.id} is a ${it.kind}` })
    const same: [keyof typeof e, number, string][] = [
      ['rated_output_w', it.output_w, 'output'], ['rated_flow_c', c.rating.flow_c, 'rated flow'], ['rated_return_c', c.rating.return_c, 'rated return'],
      ['rated_room_c', c.rating.room_c, 'rated room temperature'], ['exponent_n', it.exponent_n, 'exponent n'],
    ]
    for (const [k, v, name] of same) if (e[k] !== v) out.push({ path: `${p}.${String(k)}`, what: `states ${String(e[k])}, but the ${name} of ${c.title} ${it.id} is ${v}` })
  }))
  return out
}

/**
 * Brief 119: the smallest item that adds `extra_rated_w` of rating (at the catalogue's own rating) at the given height,
 * or, when no one item does, the fewest of the largest. Null when the catalogue has no item at that height.
 */
export function suggestItem(c: Catalogue, height_mm: number, extra_rated_w: number): { item: CatalogueItem; count: number } | null {
  const at = c.items.filter((x) => x.height_mm === height_mm).sort((a, b) => a.output_w - b.output_w)
  if (at.length === 0 || !(extra_rated_w > 0)) return null
  const one = at.find((x) => x.output_w >= extra_rated_w)
  if (one) return { item: one, count: 1 }
  const big = at[at.length - 1]
  return { item: big, count: Math.ceil(extra_rated_w / big.output_w) }
}
