/**
 * Brief 122 P3: the seam's instant estimate on a drawn plan at Fabric only. Its own result (Rule 11), labelled
 * (Rule 7), lines closing (Rule 9), and in the same neighbourhood as the hourly run's Fabric only.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyPlan, type Plan, type XY } from '../../geometry/plan'
import { setOpeningsIn } from '../../geometry/facade'
import { fitRooms } from '../../geometry/rooms'
import { applySet } from '../../geometry/applySet'
import { CONSTRUCTION_SETS } from '../../library/sets'
import { buildDocument } from '../../geometry/toDocument'
import { instantEstimate, levelDocument, simulate } from '../seam'
import { ModelDocument } from '../../../thermal/schema/model'
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

describe('instant estimate (Brief 122 P3)', () => {
  it('Fabric only: labelled, closes, months sum to the year, and near the hourly run', () => {
    const doc = ModelDocument.parse(buildDocument(box()).doc)
    const fab = levelDocument(doc, 'fabric', 20)
    const r = instantEstimate(fab, { weather: WEATHER })
    if (!r.ok) throw new Error(JSON.stringify(r.missing))
    const e = r.estimate
    expect(e.label).toBe('Monthly estimate (static)')
    expect(e.building.cooling_kwh).toBe(0)
    expect(Math.abs(e.breakdown.reduce((s, l) => s + l.kwh, 0))).toBeLessThan(1e-6)
    expect(e.monthly.heating_kwh.reduce((s, x) => s + x, 0)).toBeCloseTo(e.building.heating_kwh, 6)
    expect(e.notes.join(' ')).toMatch(/Not the hourly run/)
    const h = simulate(doc, { weather: WEATHER, level: 'fabric', fabric_heat_c: 20 }) as any
    expect(h.ok).toBe(true)
    const ratio = e.building.heating_kwh / h.summary.building.heating_kwh
    // Reported here, gated in the referee (docs/audit/122): a sanity bound only.
    expect(ratio).toBeGreaterThan(0.7); expect(ratio).toBeLessThan(1.3)
    console.log(`instant ${e.building.heating_kwh.toFixed(0)} kWh vs hourly ${h.summary.building.heating_kwh.toFixed(0)} kWh (${e.run_ms.toFixed(2)} ms)`)
  })

  it('missing inputs come back as the hourly run\'s would', () => {
    const r = instantEstimate(levelDocument(ModelDocument.parse(buildDocument(box()).doc), 'fabric', 20), { weather: null })
    expect(r.ok).toBe(false)
  })
})
