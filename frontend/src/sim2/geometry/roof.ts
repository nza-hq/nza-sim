/**
 * Brief 123: the roof's shape. The recipe types are copied from decodED (nza-decoded @ e5174c5,
 * src/twin/contract/schema.ts, "Roof recipe", itself from nza-estate @ 7678a5e) on 2026-11-17. Diverged: yes. Only the
 * four styles Brief 123 offers first (flat, mono, gable, hip) are copied, and flat has no parapet here.
 *
 * The faces are worked out here, in the browser, for rectangular blocks only, exactly. decodED builds faces for other
 * outlines in a CGAL service (GPL, server side). CGAL never reaches a browser, so a block that is not a rectangle keeps
 * a flat roof and says why (`refused`), and nothing guesses at a straight skeleton.
 *
 * Plan x east, y north, z up from the eaves (the top of the walls). Facing (azimuth) is the compass bearing a slope
 * faces downhill, degrees from north clockwise. Tilt is from horizontal (0 flat, 90 a wall).
 */
import { area, type XY } from './ported/zones'

export type RidgeAxisChoice = 'longest' | 'shortest'
export type RoofFlat = { style: 'flat' }
export type RoofMono = { style: 'mono'; pitch_deg: number; /** Cardinal direction of the high edge, or degrees from north. */ high_side: 'N' | 'E' | 'S' | 'W' | number }
export type RoofGable = { style: 'gable'; pitch_deg: number; ridge_axis: RidgeAxisChoice }
export type RoofHip = { style: 'hip'; pitch_deg: number }
export type RoofRecipe = (RoofFlat | RoofMono | RoofGable | RoofHip) & {
  /** Where the insulation is: at the ceiling with a cold loft above, or in the slope (the room open to the roof). */
  insulation?: 'ceiling' | 'slope'
  /** Cold roof: the fabric type (a roof type) the loft's slopes are made of; null: not chosen yet. */
  loft_slope_type?: string | null
  /** Cold roof: the loft's air changes an hour; null: LOFT_ACH. */
  loft_ach?: number | null
}

/** A ventilated loft's air changes an hour: ISO 13789 clause 9.4's conventional rate (the engine thread's P4.2 records
 * what could and could not be verified about it). Shown and editable on Shape, Roof. */
export const LOFT_ACH = 3
export type RoofStyle = RoofRecipe['style']
export const ROOF_STYLES: ReadonlyArray<{ key: RoofStyle; name: string }> = [
  { key: 'flat', name: 'Flat' },
  { key: 'mono', name: 'Mono-pitch' },
  { key: 'gable', name: 'Gable' },
  { key: 'hip', name: 'Hip' },
]

/** Brief 123 defaults: typical pitches, so choosing a style is the only input. Gable and hip have a cold loft;
 * a mono-pitch is insulated in the slope. */
export function defaultRoof(style: RoofStyle): RoofRecipe {
  if (style === 'gable') return { style, pitch_deg: 35, ridge_axis: 'longest', insulation: 'ceiling' }
  if (style === 'hip') return { style, pitch_deg: 35, insulation: 'ceiling' }
  if (style === 'mono') return { style, pitch_deg: 10, high_side: 'N', insulation: 'slope' }
  return { style: 'flat' }
}

export type XYZ = [number, number, number]
export type RoofFace = {
  /** slope: a pitched (or flat) roof face. wall: a vertical gable end or the raised wall of a mono-pitch. */
  kind: 'slope' | 'wall'
  pts: XYZ[]
  tilt_deg: number
  /** Downhill (slopes) or outward (walls) compass bearing, degrees from north; null for a flat face. */
  azimuth_deg: number | null
  area_m2: number
  /** A wall: which side of the block's outline it stands on (index into the ring), for its wall type. */
  edge?: number
}
export type BlockRoof = {
  style: RoofStyle
  faces: RoofFace[]
  /** The ridge and hip lines, for drawing on the plan. */
  lines: Array<[XYZ, XYZ]>
  /** Height of the ridge (or the high edge) above the eaves, m. */
  rise_m: number
  /** Volume between the eaves' level and the roof, m³ (the loft under a cold roof). */
  void_m3: number
  /** Why a pitched style was not built (the block keeps a flat roof). */
  refused?: string
}

const deg = (r: number) => (r * 180) / Math.PI
const rad = (d: number) => (d * Math.PI) / 180
const bearing = (dx: number, dy: number) => (deg(Math.atan2(dx, dy)) + 360) % 360
const CARDINAL = { N: 0, E: 90, S: 180, W: 270 } as const

/** A face's true area from its 3D points (Newell). */
export function faceArea(pts: readonly XYZ[]): number {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1, z1] = pts[i]!
    const [x2, y2, z2] = pts[(i + 1) % pts.length]!
    nx += (y1 - y2) * (z1 + z2)
    ny += (z1 - z2) * (x1 + x2)
    nz += (x1 - x2) * (y1 + y2)
  }
  return Math.hypot(nx, ny, nz) / 2
}

/** The ring as a rectangle (four corners, square to 0.5°), or null. Collinear points are dropped first. */
export function asRectangle(ring: readonly XY[]): XY[] | null {
  const pts = ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length]!
    const b = ring[(i + 1) % ring.length]!
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-6
  })
  if (pts.length !== 4) return null
  for (let i = 0; i < 4; i++) {
    const a = pts[i]!, b = pts[(i + 1) % 4]!, c = pts[(i + 2) % 4]!
    const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]]
    const cos = (u[0]! * v[0]! + u[1]! * v[1]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(v[0]!, v[1]!))
    if (Math.abs(cos) > Math.sin(rad(0.5))) return null
  }
  return pts
}

const flatRoof = (ring: readonly XY[], refused?: string): BlockRoof => ({
  style: 'flat',
  faces: [{ kind: 'slope', pts: ring.map(([x, y]) => [x, y, 0] as XYZ), tilt_deg: 0, azimuth_deg: null, area_m2: Math.abs(area(ring as XY[])) }],
  lines: [],
  rise_m: 0,
  void_m3: 0,
  ...(refused ? { refused } : {}),
})

const face = (kind: RoofFace['kind'], pts: XYZ[], tilt: number, azimuth: number | null): RoofFace => ({ kind, pts, tilt_deg: tilt, azimuth_deg: azimuth, area_m2: faceArea(pts) })

/** The roof over one block. Pitched styles need a rectangular block; any other outline stays flat with a reason. */
export function blockRoof(ring: readonly XY[], recipe: RoofRecipe | null | undefined): BlockRoof {
  if (!recipe || recipe.style === 'flat') return flatRoof(ring)
  const rect = asRectangle(ring)
  if (!rect) return flatRoof(ring, 'This roof shape needs a rectangular block for now, so this block keeps a flat roof.')
  if (!(recipe.pitch_deg > 0 && recipe.pitch_deg < 90)) return flatRoof(ring, 'The pitch must be between 0° and 90°.')
  const t = Math.tan(rad(recipe.pitch_deg))
  const [p0, p1, p2, p3] = rect as [XY, XY, XY, XY]
  const e0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
  const e1 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])

  if (recipe.style === 'mono') {
    // The high edge is the side whose outward normal is nearest the stated bearing.
    const want = typeof recipe.high_side === 'number' ? recipe.high_side : CARDINAL[recipe.high_side]
    const sides = [0, 1, 2, 3].map((i) => {
      const a = rect[i]!, b = rect[(i + 1) % 4]!
      const out = bearing(b[1] - a[1], -(b[0] - a[0])) // right of a→b is outside for an anticlockwise ring
      return { i, out, off: Math.abs(((out - want + 540) % 360) - 180) }
    })
    const hi = sides.reduce((m, s) => (s.off < m.off ? s : m))
    const a = rect[hi.i]!, b = rect[(hi.i + 1) % 4]!, c = rect[(hi.i + 2) % 4]!, d = rect[(hi.i + 3) % 4]!
    const span = Math.hypot(c[0] - b[0], c[1] - b[1])
    const rise = span * t
    const A: XYZ = [a[0], a[1], rise], B: XYZ = [b[0], b[1], rise], Cc: XYZ = [c[0], c[1], 0], D: XYZ = [d[0], d[1], 0]
    return {
      style: 'mono',
      faces: [
        face('slope', [D, Cc, B, A], recipe.pitch_deg, (hi.out + 180) % 360),
        face('wall', [[a[0], a[1], 0], [b[0], b[1], 0], B, A], 90, hi.out),
        face('wall', [[b[0], b[1], 0], Cc, B], 90, bearing(c[1] - b[1], -(c[0] - b[0]))),
        face('wall', [D, [a[0], a[1], 0], A], 90, bearing(a[1] - d[1], -(a[0] - d[0]))),
      ],
      lines: [[A, B]],
      rise_m: rise,
      void_m3: (e0 * e1 * rise) / 2,
    }
  }

  // Gable: the ridge runs along the longest side unless asked otherwise. Hip: always along the longest (every face at
  // the one pitch fixes it).
  const axis = recipe.style === 'gable' ? recipe.ridge_axis : 'longest'
  const alongFirst = axis === 'longest' ? e0 >= e1 : e0 < e1
  // Start at a corner so that q0→q1 runs along the ridge.
  const [q0, q1, q2, q3] = (alongFirst ? [p0, p1, p2, p3] : [p1, p2, p3, p0]) as [XY, XY, XY, XY]
  const L = Math.hypot(q1[0] - q0[0], q1[1] - q0[1])
  const B = Math.hypot(q2[0] - q1[0], q2[1] - q1[1])
  const w = B / 2
  const rise = w * t
  const mid = (p: XY, q: XY): XY => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  const m0 = mid(q0, q3), m1 = mid(q1, q2) // the ridge's ends at the gables
  const out01 = bearing(q1[1] - q0[1], -(q1[0] - q0[0]))
  const out12 = bearing(q2[1] - q1[1], -(q2[0] - q1[0]))
  const out23 = (out01 + 180) % 360
  const out30 = (out12 + 180) % 360
  const z0 = (p: XY): XYZ => [p[0], p[1], 0]
  if (recipe.style === 'gable') {
    const R0: XYZ = [m0[0], m0[1], rise], R1: XYZ = [m1[0], m1[1], rise]
    return {
      style: 'gable',
      faces: [
        face('slope', [z0(q0), z0(q1), R1, R0], recipe.pitch_deg, out01),
        face('slope', [z0(q2), z0(q3), R0, R1], recipe.pitch_deg, out23),
        face('wall', [z0(q1), z0(q2), R1], 90, out12),
        face('wall', [z0(q3), z0(q0), R0], 90, out30),
      ],
      lines: [[R0, R1]],
      rise_m: rise,
      void_m3: L * B * rise / 2,
    }
  }
  // Hip: every face at the same pitch; the ridge is shorter than the block by the span (a pyramid when square).
  const ux = (q1[0] - q0[0]) / L, uy = (q1[1] - q0[1]) / L
  const k = Math.min(w, L / 2)
  const H0: XYZ = [m0[0] + ux * k, m0[1] + uy * k, rise]
  const H1: XYZ = [m1[0] - ux * k, m1[1] - uy * k, rise]
  return {
    style: 'hip',
    faces: [
      face('slope', [z0(q0), z0(q1), H1, H0], recipe.pitch_deg, out01),
      face('slope', [z0(q1), z0(q2), H1], recipe.pitch_deg, out12),
      face('slope', [z0(q2), z0(q3), H0, H1], recipe.pitch_deg, out23),
      face('slope', [z0(q3), z0(q0), H0], recipe.pitch_deg, out30),
    ],
    lines: [[H0, H1], [z0(q0), H0], [z0(q3), H0], [z0(q1), H1], [z0(q2), H1]],
    rise_m: rise,
    // A prism over the ridge plus a pyramid at the two ends together.
    void_m3: (rise * B * (3 * L - B)) / 6,
  }
}

/** The whole roof built in the browser (rectangles only): each block's, with totals. */
export const planRoof = (blocks: readonly (readonly XY[])[], recipe: RoofRecipe | null | undefined) => roofTotals(blocks.map((b) => blockRoof(b, recipe)))

// ─── Brief 123: faces from the roof service (decodED's, copied to services/roof) ───────────────────────────────────

/** A face as the roof service returns it (decodED's RoofFace): a ring in metres, z up from the eave_m sent. */
export type ServedFace = { id: string; role: string; geometry: number[][]; tilt_deg: number; azimuth_deg: number }
export type ServedResult = { faces: ServedFace[]; flags: string[]; fell_back_to_flat?: boolean }

/** The recipe as the service reads it (decodED's field names; flat with no parapet). */
export function serviceRecipe(r: RoofRecipe): Record<string, unknown> {
  const { insulation: _i, loft_slope_type: _t, loft_ach: _a, ...rest } = r
  return r.style === 'flat' ? { style: 'flat', parapet_height_m: 0 } : rest
}

/** The plane through a face: z at (x, y). Faces are planar (the service builds them so). */
function planeOf(pts: readonly XYZ[]): (x: number, y: number) => number {
  let nx = 0, ny = 0, nz = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1, z1] = pts[i]!, [x2, y2, z2] = pts[(i + 1) % pts.length]!
    nx += (y1 - y2) * (z1 + z2); ny += (z1 - z2) * (x1 + x2); nz += (x1 - x2) * (y1 + y2)
  }
  const [x0, y0, z0] = pts[0]!
  return Math.abs(nz) < 1e-12 ? () => z0 : (x, y) => z0 - (nx * (x - x0) + ny * (y - y0)) / nz
}

/** Volume between the eaves' level (z 0) and a face: its plan area × its height at the plan centroid (exact for a plane). */
function volumeUnder(pts: readonly XYZ[]): number {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!
    const c = x1 * y2 - x2 * y1
    a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c
  }
  if (Math.abs(a) < 1e-12) return 0
  return Math.abs(a / 2) * planeOf(pts)(cx / (3 * a), cy / (3 * a))
}

/**
 * A block's roof from the service's faces: the slopes as given, the walls under them that the service does not
 * return (a gable end, a mono-pitch's raised wall) worked out from where the slopes rise above an outside wall, the
 * ridge, hip and valley lines for the plan, the loft volume and the rise.
 */
export function fromServed(ring: readonly XY[], style: RoofStyle, served: ServedResult): BlockRoof {
  if (served.fell_back_to_flat || !served.faces.length) return flatRoof(ring, `The roof service could not build this roof (${served.flags.join('; ') || 'no faces'}), so this block keeps a flat roof.`)
  const slopes: RoofFace[] = served.faces.map((f) => {
    const pts = f.geometry.map(([x, y, z]) => [x!, y!, z ?? 0] as XYZ)
    return { kind: 'slope', pts, tilt_deg: f.tilt_deg, azimuth_deg: f.tilt_deg < 1 ? null : f.azimuth_deg, area_m2: faceArea(pts) }
  })
  const ON = 1e-4
  const walls: RoofFace[] = []
  const onBoundary = (p: XYZ) => ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length]!
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (L * L)
    return t > -ON && t < 1 + ON && Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L < ON
  })
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L
    const up = new Map<string, XYZ>()
    for (const f of slopes) for (const p of f.pts) {
      if (p[2] < ON) continue
      const t = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy
      if (t < -ON || t > L + ON || Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) > ON) continue
      up.set(`${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`, p)
    }
    if (!up.size) return
    const top = [...up.values()].sort((p, q) => ((q[0] - a[0]) * ux + (q[1] - a[1]) * uy) - ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy))
    const pts: XYZ[] = [[a[0], a[1], 0], [b[0], b[1], 0], ...top]
    const area = faceArea(pts)
    if (area > 1e-6) walls.push({ kind: 'wall', pts, tilt_deg: 90, azimuth_deg: bearing(uy, -ux), area_m2: area, edge: i })
  })
  // Lines: face edges off the outline (ridges, hips, valleys), each once.
  const seen = new Set<string>()
  const lines: Array<[XYZ, XYZ]> = []
  const k = (p: XYZ) => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`
  for (const f of slopes) f.pts.forEach((p, i) => {
    const q = f.pts[(i + 1) % f.pts.length]!
    if (onBoundary(p) && onBoundary(q) && p[2] < ON && q[2] < ON) return
    if (p[2] < ON && q[2] < ON) return
    const id = [k(p), k(q)].sort().join('|')
    if (seen.has(id)) return
    seen.add(id)
    lines.push([p, q])
  })
  return {
    style,
    faces: [...slopes, ...walls],
    lines,
    rise_m: Math.max(0, ...slopes.flatMap((f) => f.pts.map((p) => p[2]))),
    void_m3: slopes.reduce((t, f) => t + volumeUnder(f.pts), 0),
  }
}

/** Totals over the blocks' roofs, however they were built. */
export function roofTotals(per: readonly BlockRoof[]) {
  const sum = (f: (r: BlockRoof) => number) => per.reduce((t, r) => t + f(r), 0)
  return {
    blocks: per,
    slope_m2: sum((r) => r.faces.filter((f) => f.kind === 'slope').reduce((t, f) => t + f.area_m2, 0)),
    wall_m2: sum((r) => r.faces.filter((f) => f.kind === 'wall').reduce((t, f) => t + f.area_m2, 0)),
    ceiling_m2: sum((r) => (r.style === 'flat' ? 0 : r.faces.filter((f) => f.kind === 'slope').reduce((t, f) => t + f.area_m2 * Math.cos(rad(f.tilt_deg)), 0))),
    void_m3: sum((r) => r.void_m3),
  }
}

/** Ask NZA Sim's backend for the blocks' roofs (it asks the roof service). Null when the service is not answering. */
export async function fetchServedRoofs(blocks: readonly (readonly XY[])[], recipe: RoofRecipe, signal?: AbortSignal): Promise<{ ok: true; blocks: BlockRoof[] } | { ok: false; reason: string }> {
  try {
    const r = await fetch('/api/roof/construct-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ buildings: blocks.map((b, i) => ({ id: `b${i}`, footprint: b, roof: serviceRecipe(recipe), eave_m: 0 })) }),
      signal,
    })
    if (!r.ok) return { ok: false, reason: `the roof service is not running (${r.status})` }
    const body = (await r.json()) as { results: Record<string, ServedResult> }
    return { ok: true, blocks: blocks.map((b, i) => fromServed(b, recipe.style, body.results[`b${i}`] ?? { faces: [], flags: ['no answer for this block'] })) }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    return { ok: false, reason: 'the roof service is not reachable' }
  }
}
