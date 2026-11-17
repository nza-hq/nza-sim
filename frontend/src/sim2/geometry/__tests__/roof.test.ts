import { describe, expect, it } from 'vitest'
import { asRectangle, blockRoof, defaultRoof, planRoof } from '../roof'
import type { XY } from '../ported/zones'

// 20 m east–west by 10 m north–south, anticlockwise.
const RECT: XY[] = [[0, 0], [20, 0], [20, 10], [0, 10]]
const L: XY[] = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]]
const tan35 = Math.tan((35 * Math.PI) / 180)
const cos35 = Math.cos((35 * Math.PI) / 180)
const slopes = (r: ReturnType<typeof blockRoof>) => r.faces.filter((f) => f.kind === 'slope')
const walls = (r: ReturnType<typeof blockRoof>) => r.faces.filter((f) => f.kind === 'wall')
const sum = (fs: { area_m2: number }[]) => fs.reduce((t, f) => t + f.area_m2, 0)

describe('Brief 123 roof faces', () => {
  it('finds rectangles, and not an L', () => {
    expect(asRectangle(RECT)).not.toBeNull()
    expect(asRectangle([[0, 0], [10, 0], [20, 0], [20, 10], [0, 10]])).not.toBeNull() // a collinear corner dropped
    expect(asRectangle(L)).toBeNull()
  })

  it('flat: one face, the footprint', () => {
    const r = blockRoof(RECT, defaultRoof('flat'))
    expect(r.faces).toHaveLength(1)
    expect(r.faces[0]!.area_m2).toBeCloseTo(200, 6)
    expect(r.void_m3).toBe(0)
  })

  it('gable 10 × 20 m at 35°: slope 244.1 m², gable walls 2 × 17.5 m², ridge east–west', () => {
    const r = blockRoof(RECT, defaultRoof('gable'))
    expect(sum(slopes(r))).toBeCloseTo(200 / cos35, 6)
    expect(sum(slopes(r))).toBeCloseTo(244.15, 1)
    expect(walls(r).map((f) => f.area_m2)).toEqual([expect.closeTo(0.5 * 10 * 5 * tan35, 6), expect.closeTo(0.5 * 10 * 5 * tan35, 6)])
    expect(walls(r)[0]!.area_m2).toBeCloseTo(17.5, 1)
    expect(r.rise_m).toBeCloseTo(5 * tan35, 9)
    expect(r.void_m3).toBeCloseTo(200 * r.rise_m / 2, 6)
    expect(slopes(r).map((f) => f.azimuth_deg).sort()).toEqual([0, 180]) // slopes face north and south
    expect(walls(r).map((f) => f.azimuth_deg).sort()).toEqual([270, 90]) // gable ends face east and west
  })

  it('gable on the shortest axis turns the ridge', () => {
    const r = blockRoof(RECT, { style: 'gable', pitch_deg: 35, ridge_axis: 'shortest' })
    expect(sum(slopes(r))).toBeCloseTo(200 / cos35, 6)
    expect(r.rise_m).toBeCloseTo(10 * tan35, 9)
    expect(slopes(r).map((f) => f.azimuth_deg).sort((a, b) => a! - b!)).toEqual([90, 270])
  })

  it('hip: four slopes at the one pitch, area footprint ÷ cos, no walls; a square is a pyramid', () => {
    const r = blockRoof(RECT, defaultRoof('hip'))
    expect(slopes(r)).toHaveLength(4)
    expect(walls(r)).toHaveLength(0)
    expect(sum(slopes(r))).toBeCloseTo(200 / cos35, 6)
    const h = 5 * tan35
    expect(r.void_m3).toBeCloseTo(h * 10 * (3 * 20 - 10) / 6, 6)
    const sq = blockRoof([[0, 0], [10, 0], [10, 10], [0, 10]], defaultRoof('hip'))
    expect(sq.void_m3).toBeCloseTo((100 * 5 * tan35) / 3, 6) // pyramid: base × height ÷ 3
    expect(sum(slopes(sq))).toBeCloseTo(100 / cos35, 6)
  })

  it('mono-pitch high on the north: slope faces south, raised wall faces north', () => {
    const r = blockRoof(RECT, defaultRoof('mono'))
    const t10 = Math.tan((10 * Math.PI) / 180)
    expect(r.rise_m).toBeCloseTo(10 * t10, 9)
    expect(slopes(r)[0]!.azimuth_deg).toBeCloseTo(180, 9)
    expect(slopes(r)[0]!.area_m2).toBeCloseTo(200 / Math.cos((10 * Math.PI) / 180), 6)
    const [hi, s1, s2] = walls(r)
    expect(hi!.azimuth_deg).toBeCloseTo(0, 9)
    expect(hi!.area_m2).toBeCloseTo(20 * r.rise_m, 6)
    expect(s1!.area_m2 + s2!.area_m2).toBeCloseTo(10 * r.rise_m, 6)
    expect(r.void_m3).toBeCloseTo(200 * r.rise_m / 2, 6)
  })

  it('an L keeps a flat roof and says why; nothing is guessed', () => {
    const r = blockRoof(L, defaultRoof('gable'))
    expect(r.style).toBe('flat')
    expect(r.refused).toMatch(/rectangular/)
    expect(r.faces[0]!.area_m2).toBeCloseTo(300, 6)
  })

  it('totals: ceiling equals the footprint under a pitched roof', () => {
    const t = planRoof([RECT], defaultRoof('gable'))
    expect(t.ceiling_m2).toBeCloseTo(200, 6)
    expect(t.slope_m2).toBeCloseTo(200 / cos35, 6)
    expect(planRoof([RECT], null).ceiling_m2).toBe(0)
  })
})
