/**
 * Brief 104 Part 6: the 50-zone performance document (decision 6, "a 10 × 5 grid of rooms over five floors").
 *
 * Read as ten rooms per floor over five floors: Bridgewater's per-storey document with each storey cut into a 5 × 2
 * grid of rooms (five along the long facades, two across). Each room keeps its share of the storey's walls and glazing
 * on the facades it touches; neighbouring rooms share a block partition (`perf_partition`, added to the library here:
 * 12.5 mm plasterboard, 100 mm dense block, 12.5 mm plasterboard); rooms above one another share the storey's slab.
 * The document exists to time the solver on 50 coupled zones. It is not a model of the hotel.
 */
import type { ModelDocument } from '../frontend/src/thermal/schema/model'

export const PERF_PARTITION = {
  name: 'perf_partition', display_name: 'Perf: plasterboard, 100 mm dense block, plasterboard', type: 'interior',
  layers: [
    { name: 'Pb', kind: 'Material', thickness: 0.0125, conductivity: 0.21, density: 700, specific_heat: 1000 },
    { name: 'Block', kind: 'Material', thickness: 0.1, conductivity: 1.13, density: 2000, specific_heat: 1000 },
    { name: 'Pb', kind: 'Material', thickness: 0.0125, conductivity: 0.21, density: 700, specific_heat: 1000 },
  ],
}

const NX = 5, NY = 2

export function grid50(fiveZones: ModelDocument): ModelDocument {
  const src: any = structuredClone(fiveZones)
  const byId = new Map<string, any>(src.surfaces.map((s: any) => [s.id, s]))
  const [x0, y0] = [0, 0]
  const poly = src.zones[0].polygon as [number, number][]
  const Lx = Math.max(...poly.map((p) => p[0])) - x0, Ly = Math.max(...poly.map((p) => p[1])) - y0
  const dx = Lx / NX, dy = Ly / NY
  const zones: any[] = [], surfaces: any[] = []
  const rid = (f: number, i: number, j: number) => `r${f + 1}_${i + 1}_${j + 1}`
  const facadeShare: Record<string, (i: number, j: number) => number> = {
    // north and south run along x (length Lx), east and west along y (length Ly); which side each lies on is
    // immaterial to the timing, so north is j = 0, south j = NY - 1, west i = 0, east i = NX - 1.
    north: (i, j) => (j === 0 ? 1 / NX : 0), south: (i, j) => (j === NY - 1 ? 1 / NX : 0),
    west: (i, j) => (i === 0 ? 1 / NY : 0), east: (i, j) => (i === NX - 1 ? 1 / NY : 0),
  }
  const nf = src.zones.length
  for (let f = 0; f < nf; f++) {
    const storey = src.zones[f]
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      const id = rid(f, i, j)
      const list: string[] = []
      for (const sid of storey.surfaces) {
        const s = byId.get(sid)
        if (s.zone_b !== 'outside' && s.zone_b !== 'ground') continue  // slabs are rebuilt below
        let share = 1 / (NX * NY)
        if (s.facade) share = facadeShare[s.facade](i, j)
        if (share === 0) continue
        const c = { ...structuredClone(s), id: `${s.id}_${i + 1}_${j + 1}`, zone_a: id, area_m2: s.area_m2 * share }
        if (c.window_count != null) c.window_count = Math.max(1, Math.round(c.window_count * share))
        c.openings = c.openings.map((o: any) => ({ ...o, area_m2: o.area_m2 * share }))
        surfaces.push(c); list.push(c.id)
      }
      zones.push({
        ...structuredClone(storey), id, name: `Floor ${f + 1} room ${i + 1}.${j + 1}`, rooms: null, ventilation: [],
        polygon: [[i * dx, j * dy], [(i + 1) * dx, j * dy], [(i + 1) * dx, (j + 1) * dy], [i * dx, (j + 1) * dy]],
        area_m2: dx * dy, surfaces: list,
      })
    }
  }
  const zone = new Map(zones.map((z) => [z.id, z]))
  const inner = (id: string, kind: string, a: string, b: string, area: number, key: string, tilt: number) => {
    surfaces.push({
      id, kind, zone_a: a, zone_b: b, facade: null, area_m2: area, azimuth_deg: null, tilt_deg: tilt, construction_ref: { key },
      g_value: null, openings: [], solar_absorptance: null, thermal_emissivity: null, frame_fraction: null,
      inside_solar_absorptance: 0.7, inside_solar_absorptance_b: 0.7, faces_up: null,
    })
    zone.get(a).surfaces.push(id); zone.get(b).surfaces.push(id)
  }
  const h = src.zones[0].height_m
  const slab = src.surfaces.find((s: any) => s.kind === 'ceiling')
  for (let f = 0; f < nf; f++) for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    if (i + 1 < NX) inner(`part_x_${rid(f, i, j)}`, 'partition', rid(f, i, j), rid(f, i + 1, j), dy * h, PERF_PARTITION.name, 90)
    if (j + 1 < NY) inner(`part_y_${rid(f, i, j)}`, 'partition', rid(f, i, j), rid(f, i, j + 1), dx * h, PERF_PARTITION.name, 90)
    if (f + 1 < nf) inner(`slab_${rid(f, i, j)}`, 'ceiling', rid(f, i, j), rid(f + 1, i, j), dx * dy, slab.construction_ref.key, 0)
  }
  src.zones = zones
  src.surfaces = surfaces
  src.system_groups = src.system_groups.map((g: any) => ({ ...g, zones: zones.map((z) => z.id) }))
  return src
}
