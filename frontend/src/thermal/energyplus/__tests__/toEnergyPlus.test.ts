/**
 * Brief 123: the EnergyPlus input for the worked example community centre. Checks what EnergyPlus would only catch at
 * run time, or not at all: every window lies in its host and faces the same way, the two sides of a wall between rooms
 * face opposite ways, glazing and opaque areas match the document, the schedules file has a value for every hour, and a
 * model EnergyPlus cannot take yet is refused in words.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDocument } from '../../../sim2/geometry/toDocument'
import { upgradePlan } from '../../../sim2/geometry/plan'
import { preflight, simulate } from '../../../sim2/run/seam'
import { CONSTRUCTIONS } from '../../../sim2/run/library'
import { toEnergyPlus } from '../toEnergyPlus'
import { energyPlusInput } from '../../../sim2/run/energyplus'
import { MOS, readMos } from '../../engine/__tests__/denver'

const W = readMos(readFileSync(MOS))
const WEATHER = { weather: W, file_name: 'denver.mos', station: 'Denver', sha256: W.sha256, source: 'local' as const }
const plan = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../../docs/examples/community_centre.plan.json'), 'utf8'))
const built = buildDocument(upgradePlan(plan.plan))
if (!built.ok) throw new Error(JSON.stringify(built.issues))
const doc = built.doc as any

type V = [number, number, number]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V) => Math.hypot(...a)
/** Area-weighted normal (Newell) of a counterclockwise polygon seen from outside: points out, length = area. */
function newell(p: V[]): V {
  let n: V = [0, 0, 0]
  for (let i = 0; i < p.length; i++) { const c = cross(p[i], p[(i + 1) % p.length]); n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]] }
  return [n[0] / 2, n[1] / 2, n[2] / 2]
}
const surfPts = (o: any): V[] => o.vertices.map((v: any) => [v.vertex_x_coordinate, v.vertex_y_coordinate, v.vertex_z_coordinate])
const winPts = (o: any): V[] => [1, 2, 3, 4].map((i) => [o[`vertex_${i}_x_coordinate`], o[`vertex_${i}_y_coordinate`], o[`vertex_${i}_z_coordinate`]])
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function prepare(d: any) {
  const ours = simulate(d, { weather: WEATHER })
  if (!ours.ok) throw new Error(JSON.stringify(ours.missing))
  return energyPlusInput(d, ours.results, { weather: WEATHER })
}

describe('EnergyPlus input (Brief 123)', () => {
  const prep = prepare(doc)
  if (!prep.ok) throw new Error(JSON.stringify(prep.missing))
  const ep = prep.input.epjson as any
  const surfaces = ep['BuildingSurface:Detailed'] as Record<string, any>
  const windows = (ep['FenestrationSurface:Detailed'] ?? {}) as Record<string, any>

  it('has one EnergyPlus zone per zone, each with ideal loads where heated or cooled', () => {
    expect(Object.keys(ep.Zone)).toHaveLength(doc.zones.length)
    const conditioned = prep.input.zones.filter((z) => z.heated || z.cooled).length
    expect(Object.keys(ep['ZoneHVAC:IdealLoadsAirSystem'] ?? {})).toHaveLength(conditioned)
  })

  it('every window lies in its host and faces the same way', () => {
    for (const [name, w] of Object.entries(windows)) {
      const host = surfaces[w.building_surface_name]
      expect(host, name).toBeTruthy()
      const nw = newell(winPts(w)), nh = newell(surfPts(host))
      expect(dot(nw, nh) / len(nw) / len(nh), name).toBeGreaterThan(0.9999)
      // In the host's plane.
      const h0 = surfPts(host)[0]
      for (const p of winPts(w)) expect(Math.abs(dot(sub(p, h0), nh) / len(nh)), name).toBeLessThan(1e-4)
    }
  })

  it('the two sides of a surface between rooms face opposite ways, with the same area', () => {
    const pairs = Object.entries(surfaces).filter(([, s]) => s.outside_boundary_condition === 'Surface')
    expect(pairs.length).toBeGreaterThan(0)
    for (const [name, s] of pairs) {
      const twin = surfaces[s.outside_boundary_condition_object]
      expect(twin.outside_boundary_condition_object).toBe(name)
      const a = newell(surfPts(s)), b = newell(surfPts(twin))
      expect(dot(a, b) / len(a) / len(b)).toBeLessThan(-0.9999)
      expect(len(a)).toBeCloseTo(len(b), 6)
    }
  })

  it('glazing and outside opaque areas match the document', () => {
    const glazing = doc.surfaces.filter((s: any) => s.kind === 'glazing').reduce((t: number, s: any) => t + s.area_m2, 0)
    const epGlazing = Object.values(windows).reduce((t, w) => t + len(newell(winPts(w))), 0)
    expect(epGlazing).toBeCloseTo(glazing, 3)
    const opaque = doc.surfaces.filter((s: any) => (s.kind === 'wall' || s.kind === 'roof') && s.zone_b === 'outside').reduce((t: number, s: any) => t + s.area_m2, 0)
    const epOuter = Object.values(surfaces).filter((s) => s.outside_boundary_condition === 'Outdoors').reduce((t, s) => t + len(newell(surfPts(s))), 0)
    expect(epOuter - epGlazing).toBeCloseTo(opaque, 3)
  })

  it('the schedules file has a header and a value in every column for each of the 8,760 hours', () => {
    const lines = prep.input.schedules_csv.trim().split('\n')
    expect(lines).toHaveLength(8761)
    const cols = lines[0].split(',').length
    for (const l of lines.slice(1)) expect(l.split(',')).toHaveLength(cols)
    for (const s of Object.values(ep['Schedule:File'] ?? {}) as any[]) expect(s.column_number).toBeLessThanOrEqual(cols)
  })

  it('refuses weather-driven air in words', () => {
    const d = structuredClone(prep.doc) as any
    d.building.air = { ...d.building.air, method: 'weather_driven' }
    const ours = simulate(doc, { weather: WEATHER })
    if (!ours.ok) throw new Error('run')
    const lib = preflight(prep.doc, WEATHER, CONSTRUCTIONS).library
    expect(() => toEnergyPlus(d, W, lib, ours.results)).toThrow(/weather-driven air/)
  })
})
