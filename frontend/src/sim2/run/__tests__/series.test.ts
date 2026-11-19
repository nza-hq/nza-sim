/**
 * Brief 127 P1: the explorer's catalogue is the run's own hourly arrays (Rule 11), never a second calculation. Each
 * series sums or matches back to the figure the summary already shows.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildDocument } from '../../geometry/toDocument'
import { upgradePlan } from '../../geometry/plan'
import { MOS, readMos } from '../../../thermal/engine/__tests__/denver'
import { simulate } from '../seam'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const W = readMos(readFileSync(MOS))
const WEATHER = { weather: W, file_name: 'denver.mos', station: 'Denver', sha256: W.sha256, source: 'local' as const }
const plan = JSON.parse(readFileSync(repo('docs/examples/community_centre.plan.json'), 'utf8'))
const built = buildDocument(upgradePlan(plan.plan))
if (!built.ok) throw new Error(JSON.stringify(built.issues))
const sum = (a: ArrayLike<number>) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]!; return t }

describe('series catalogue (Brief 127)', () => {
  const r = simulate(structuredClone(built.doc), { weather: WEATHER, series: true })
  if (!r.ok) throw new Error(JSON.stringify(r.missing))
  const s = r.summary, set = s.series!
  const get = (id: string) => { const x = set.series.find((q) => q.id === id); if (!x) throw new Error(`no ${id}`); return x }

  it('only when asked for', () => {
    const plain = simulate(structuredClone(built.doc), { weather: WEATHER })
    if (!plain.ok) throw new Error('run')
    expect(plain.summary.series).toBeNull()
    expect(set.hours).toBe(8760)
    expect(new Set(set.series.map((x) => x.id)).size).toBe(set.series.length)
    for (const x of set.series) expect(x.values).toHaveLength(8760)
  })
  it('rooms: heating and cooling sum to each zone\'s annual figure; temperatures are the run\'s own', () => {
    s.zones.forEach((z, i) => {
      expect(sum(get(`room.${z.id}.heating`).values)).toBeCloseTo(z.heating_kwh, 0)
      expect(sum(get(`room.${z.id}.cooling`).values)).toBeCloseTo(z.cooling_kwh, 0)
      const air = get(`room.${z.id}.air`).values, res = r.results.zones[i]!.hourly.theta_air_c
      for (let h = 0; h < 8760; h += 97) expect(air[h]).toBeCloseTo(res[h]!, 3)
    })
    expect(sum(get('building.heating').values)).toBeCloseTo(s.building.heating_kwh, 0)
  })
  it('energy: each fuel and end use sums to Energy used; each system to its own fuel kWh', () => {
    if (!s.energy?.ok) throw new Error('no energy')
    for (const f of s.energy.by_fuel) expect(sum(get(`building.fuel.${f.fuel}`).values)).toBeCloseTo(f.kwh, 0)
    for (const l of s.energy.end_uses) expect(sum(get(`building.end_use.${l.end_use}.${l.fuel}`).values)).toBeCloseTo(l.kwh, 0)
    for (const g of s.energy.systems) if (g.fuel_kwh > 0) expect(sum(get(`system.${g.id}.fuel`).values)).toBeCloseTo(g.fuel_kwh, 0)
    for (const p of s.plants) expect(sum(get(`system.${p.id}.given`).values)).toBeCloseTo(p.delivered_kwh, 0)
  })
  it('weather is the file the run used; the calendar starts on a Monday as the engine counts', () => {
    const t = get('weather.dry_bulb').values
    for (let h = 0; h < 8760; h += 113) expect(t[h]).toBeCloseTo(W.hours.dry_bulb[h]!, 4)
    expect(set.day_of_week[0]).toBe(0)
    expect(set.day_of_week[24 * 5]).toBe(5)
    expect(set.hour[25]).toBe(1)
  })
})
