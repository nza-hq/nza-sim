/**
 * Brief 111 Part 1: "Results include". Each level runs a copy of the document with objects removed (Rule 8), and
 * each level's breakdown closes against its own demand (Rule 9, integrand against display).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { fromBuildingConfig } from '../../../thermal/schema/fromBuildingConfig'
import { ModelDocument } from '../../../thermal/schema/model'
import { MOS, readMos } from '../../../thermal/engine/__tests__/denver'
import { CONSTRUCTIONS } from '../library'
import { levelDocument, simulate } from '../seam'
import type { WeatherChoice } from '../weather'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
const FIXTURE = parseYaml(readFileSync(repo('validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const W = readMos(readFileSync(MOS))
const WEATHER: WeatherChoice = { weather: W, file_name: 'denver.mos', station: 'Denver', sha256: W.sha256, source: 'local' }

async function doc(): Promise<ModelDocument> {
  const d = (await fromBuildingConfig({
    building_config: structuredClone(FIXTURE.building_config), construction_choices: FIXTURE.construction_choices, comfort_band: FIXTURE.comfort_band,
    library_constructions: FIXTURE.library_constructions, weather: { file_name: 'x', file_hash: null }, building_id: 'b',
  }, { zoning: 'per_storey' })).document
  for (const r of d.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash
  // An emitter on the top storey, so the copies' removal of emitters is exercised.
  d.zones[4].emitters = [{ id: 'z5_heaters', kind: 'electric', count: 10, rated_output_w: 1000, radiant_fraction: 0.2, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
  return ModelDocument.parse(d)
}
const closes = (lines: { kwh: number }[]) => {
  const sum = lines.reduce((s, l) => s + l.kwh, 0), gross = lines.reduce((s, l) => s + Math.abs(l.kwh), 0)
  expect(Math.abs(sum)).toBeLessThan(1e-6 * gross)
}

describe('run copies (Rule 8: removed, not muted)', () => {
  it('fabric: no gain profile or reference, no ventilation entry, no emitter, no system; every zone heated to the stated temperature, no cooling', async () => {
    const d = await doc()
    expect(d.profiles.some((p) => p.kind !== 'schedule')).toBe(true)
    expect(d.zones.some((z) => z.ventilation.length > 0)).toBe(true)
    const f = levelDocument(d, 'fabric', 21)
    expect(f.profiles.every((p) => p.kind === 'schedule')).toBe(true)
    expect(f.system_groups).toEqual([])
    for (const z of f.zones) {
      expect(z.ventilation).toEqual([])
      expect(z.emitters).toEqual([])
      expect(z.profile_refs).toEqual({ occupancy: null, lighting: [], equipment: [], auxiliary: [] })
      expect(z.setpoints).toEqual({ heat_c: 21, cool_c: null, setback_c: null, hours_ref: null, heat_ref: null, cool_ref: null, control_strategy: 'active_setpoint' })
    }
    // The envelope stays: surfaces, infiltration, bridging, capacity.
    expect(f.surfaces).toEqual(d.surfaces)
    expect(f.zones.map((z) => [z.infiltration_q50, z.infiltration_ach, z.internal_heat_capacity_j_per_k_m2])).toEqual(d.zones.map((z) => [z.infiltration_q50, z.infiltration_ach, z.internal_heat_capacity_j_per_k_m2]))
    expect(f.building).toEqual(d.building)
    // The document itself is not changed.
    expect(d.zones[4].emitters.length).toBe(1)
  })
  it('spaces: no mechanical ventilation, emitter, system or lighting; the zones\' own setpoints, people and equipment stay', async () => {
    const d = await doc()
    expect(d.profiles.some((p) => p.kind === 'lighting')).toBe(true)
    const s = levelDocument(d, 'spaces')
    expect(s.system_groups).toEqual([])
    // Brief 112 P3: lighting arrives with the luminaires, at + Systems; everything else the spaces state stays.
    expect(s.profiles).toEqual(d.profiles.filter((p) => p.kind !== 'lighting'))
    for (const [i, z] of s.zones.entries()) {
      expect(z.ventilation.every((v) => v.kind === 'natural')).toBe(true)
      expect(z.emitters).toEqual([])
      expect(z.setpoints).toEqual(d.zones[i].setpoints)
      expect(z.profile_refs).toEqual({ ...d.zones[i].profile_refs, lighting: [] })
    }
  })
  it('systems: the document as it is', async () => {
    const d = await doc()
    expect(levelDocument(d, 'systems')).toBe(d)
  })
})

describe('simulate at each level', () => {
  it('systems is today\'s run, value for value', async () => {
    const d = await doc()
    const a = simulate(d, { weather: WEATHER }), b = simulate(d, { weather: WEATHER, level: 'systems' })
    if (!a.ok || !b.ok) throw new Error('run failed')
    expect({ ...b.summary, run_ms: 0 }).toEqual({ ...a.summary, run_ms: 0 })
    expect(a.summary.level).toBe('systems')
    expect(a.summary.energy?.ok).toBe(true)
  })
  it('each level\'s building and zone breakdowns close against its own demand; fabric has no gains, no ventilation and no cooling', async () => {
    const d = await doc()
    const runs = {
      fabric: simulate(d, { weather: WEATHER, level: 'fabric', fabric_heat_c: 21 }),
      spaces: simulate(d, { weather: WEATHER, level: 'spaces' }),
      systems: simulate(d, { weather: WEATHER, level: 'systems' }),
    }
    for (const [name, r] of Object.entries(runs)) {
      if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.missing)}`)
      closes(r.summary.breakdown)
      for (const z of r.summary.zones) {
        closes(z.breakdown)
        expect(z.breakdown.find((l) => l.term === 'heating')?.kwh ?? 0).toBeCloseTo(z.heating_kwh, 6)
      }
      expect(r.summary.level).toBe(name)
      if (name !== 'systems') expect(r.summary.energy).toBeNull()
    }
    const f = runs.fabric as Extract<typeof runs.fabric, { ok: true }>
    const terms = f.summary.breakdown.map((l) => l.term)
    expect(terms.some((t) => t.endsWith('_gains'))).toBe(false)
    expect(terms).not.toContain('mechanical_ventilation')
    expect(f.summary.building.cooling_kwh).toBe(0)
    expect(f.summary.fabric_heat_c).toBe(21)
    expect(f.summary.zones.every((z) => z.heated && !z.cooled)).toBe(true)
    // Without gains the fabric needs more heat than the spaces with theirs.
    const sp = runs.spaces as Extract<typeof runs.spaces, { ok: true }>
    expect(f.summary.building.heating_kwh).toBeGreaterThan(sp.summary.building.heating_kwh)
    expect(sp.summary.breakdown.map((l) => l.term)).not.toContain('mechanical_ventilation')
  })
  it('fabric without a stated temperature is named, not defaulted', async () => {
    const r = simulate(await doc(), { weather: WEATHER, level: 'fabric' })
    expect(r).toEqual({ ok: false, missing: [{ path: 'fabric_heat_c', what: 'Fabric only needs the temperature every room is heated to.' }] })
  })
})

describe('Brief 114 review F4: pumps sized on the design heat loss through the seam', () => {
  it('a heating system with no capacity, W per kW: rated on its rooms\' design heat loss when design conditions are stated, refused when not', async () => {
    const d: any = structuredClone(await doc())
    const g = d.system_groups.find((x: any) => x.service === 'heating' && x.enabled)
    delete g.capacity_kw
    g.capacity_kw = null
    g.pumps = { power: { w_per_kw_capacity: 10 }, speed: 'variable', runs: 'with_demand', schedule_ref: null, default_from: null }
    const without = simulate(d, { weather: WEATHER })
    expect(without.ok).toBe(true)
    if (!without.ok) return
    expect(without.summary.energy.ok).toBe(false)
    if (without.summary.energy.ok) return
    expect(without.summary.energy.missing.map((m: any) => m.what).join(' ')).toMatch(/design conditions/)
    d.building.design = { outdoor: { stated_c: -5 }, warm_up_w_per_m2: null, vent_wind_m_s: 4 }
    for (const z of d.zones) z.design_internal_c = 'follow_heat_c'
    const r = simulate(d, { weather: WEATHER })
    if (!r.ok || !r.summary.energy.ok || !r.summary.design_heat_loss?.ok) throw new Error(JSON.stringify(r.ok ? [r.summary.energy, r.summary.design_heat_loss] : r).slice(0, 2000))
    const p = r.summary.energy.pumps.find((x) => x.id === g.id)!
    const dz = r.summary.design_heat_loss.zones
    const rooms = g.zones.reduce((a: number, zid: string) => { const z = dz.find((q) => q.id === zid)!; return a + (z.heated ? (g.share_pct / 100) * z.total_w : 0) }, 0)
    expect(p).toMatchObject({ design_from: 'design_heat_loss', rated_from: 'design_heat_loss' })
    expect(p.design_w).toBeCloseTo(rooms, 6)
    expect(p.rated_w).toBeCloseTo(rooms / 100, 6)
    expect(p.kwh).toBeGreaterThan(0)
  })
})
