/**
 * Brief 112 Part 1: the demand/energy split in the document (schema 2.8).
 * - Lighting: lux on the space's lighting profile, efficacy on the lighting system; W/m² = lux ÷ 100 × efficacy.
 * - Hot water: litres a day on the space's occupancy profile; the heater's temperatures stay on services.dhw.
 * - The 2.7 upgrade moves the building's hot water litres onto every occupancy profile and guesses no lux.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ModelDocument, SCHEMA_VERSION } from '../../schema/model'
import { upgradeDocument } from '../../schema/upgrade'
import { GainsError, zoneGains } from '../gains'
import { lightingWm2, zoneEfficacy } from '../lighting'
import { cooledRoomDocument } from './cooledRoom'
import { MOS, readMos } from './denver'

const W = readMos(fs.readFileSync(MOS))
const always = { weekday: Array(24).fill(1), saturday: Array(24).fill(1), sunday: Array(24).fill(1) }

function withLighting(light: object, groups: object[] = []) {
  const d: any = structuredClone(cooledRoomDocument().doc)
  d.profiles.push({ id: 'light', kind: 'lighting', relationship_to_occupancy: 'always_on', area_share: 1, gain_fraction: 1, radiant_fraction: 0.3, schedule: always, ...light })
  for (const z of d.zones) z.profile_refs.lighting = ['light']
  d.system_groups = groups
  return d
}
const lights = (id: string, zones: string[], eff: number | null, share = 100) =>
  ({ id, service: 'lighting', zones, enabled: true, share_pct: share, source: 'electricity', efficiency_metric: null, efficacy_w_m2_per_100lux: eff })
const allZones = (d: any) => d.zones.map((z: any) => z.id)

describe('Brief 112 P1: lighting from lux and efficacy', () => {
  it('lightingWm2 is lux ÷ 100 × efficacy', () => {
    expect(lightingWm2(300, 2.5)).toBe(7.5)
    expect(lightingWm2(0, 3)).toBe(0)
  })

  it('a zone lit to 300 lux at 2.5 W/m² per 100 lux gains what a stated 7.5 W/m² gains, hour for hour', () => {
    const base = withLighting({ magnitude: { value: 7.5, unit: 'w_per_m2' } })
    const lux = withLighting({ lux: 300 })
    lux.system_groups = [lights('l', allZones(lux), 2.5)]
    const a = zoneGains(ModelDocument.parse(base), W.hours), b = zoneGains(ModelDocument.parse(lux), W.hours)
    a.forEach((g, zi) => {
      const x = g!.gains.find((q) => q.kind === 'lighting')!, y = b[zi]!.gains.find((q) => q.kind === 'lighting')!
      expect(Array.from(y.w)).toEqual(Array.from(x.w))
      expect(Array.from(y.electric_w!)).toEqual(Array.from(x.electric_w!))
    })
  })

  it('lux with no lighting system, or one without its efficacy, is refused by name', () => {
    const none = ModelDocument.parse(withLighting({ lux: 300 }))
    expect(() => zoneGains(none, W.hours)).toThrow(GainsError)
    expect(zoneEfficacy(none, 0)).toMatchObject({ ok: false, path: 'zones[0].profile_refs.lighting' })
    const d = withLighting({ lux: 300 })
    d.system_groups = [lights('l', allZones(d), null)]
    expect(zoneEfficacy(ModelDocument.parse(d), 0)).toMatchObject({ ok: false, path: 'system_groups[0].efficacy_w_m2_per_100lux' })
  })

  it('two lighting systems with different efficacies in one lux zone are refused; the same efficacy is fine', () => {
    const d = withLighting({ lux: 300 })
    d.system_groups = [lights('a', allZones(d), 2.5, 50), lights('b', allZones(d), 3, 50)]
    expect(zoneEfficacy(ModelDocument.parse(d), 0)).toMatchObject({ ok: false, path: 'system_groups[1].efficacy_w_m2_per_100lux' })
    d.system_groups[1].efficacy_w_m2_per_100lux = 2.5
    expect(zoneEfficacy(ModelDocument.parse(d), 0)).toMatchObject({ ok: true, efficacy: 2.5, group_ids: ['a', 'b'] })
  })

  it('a lighting profile with both lux and a W/m², or efficacy on another service, is refused by the schema', () => {
    const both = withLighting({ lux: 300, magnitude: { value: 7.5, unit: 'w_per_m2' } })
    expect(ModelDocument.safeParse(both).error?.issues[0].message).toBe('lighting "light" states both lux and a W/m²: keep one')
    const heat = withLighting({ lux: 300 })
    heat.system_groups = [{ ...lights('h', allZones(heat), 2.5), service: 'heating' }]
    expect(ModelDocument.safeParse(heat).error?.issues[0].message).toBe('a heating system has no luminaire efficacy; leave empty')
  })

  it('a lighting profile with neither is named, asking for lux or a stated W/m²', () => {
    const d = ModelDocument.parse(withLighting({}))
    expect(() => zoneGains(d, W.hours)).toThrow(/the lux needed .* or a W\/m² stated directly/)
  })
})

describe('Brief 112 P1: hot water use on the space; the 2.7 upgrade', () => {
  const v27 = (dhw: object, occ = true) => {
    const d: any = structuredClone(cooledRoomDocument().doc)
    d.schema_version = '2.7'
    for (const p of d.profiles) { if (p.kind === 'occupancy') delete p.dhw; if (p.kind === 'lighting') delete p.lux }
    for (const g of d.system_groups) delete g.efficacy_w_m2_per_100lux
    if (occ) {
      d.profiles.push({ id: 'occ', kind: 'occupancy', density: { value: 0.1, basis: 'per_m2' }, occupancy_rate: 1, sensible_w_per_person: 75, radiant_fraction: 0.3, schedule: always })
      for (const z of d.zones) z.profile_refs.occupancy = 'occ'
    }
    d.services.dhw = { storage_setpoint_c: 60, tap_outlet_temp_c: 43, cold_supply_temp_c: 10, load_shape: 'flat', circulation_pump_w: 0, ...dhw }
    return d
  }

  it('moves the building litres onto every occupancy profile and drops them from services.dhw', () => {
    const up = upgradeDocument(v27({ demand_basis: 'per_person', litres_per_person_per_day: 55, litres_per_m2_per_day: 1.1 }))
    expect(up.schema_version).toBe(SCHEMA_VERSION)
    expect(up.profiles.find((p) => p.id === 'occ')).toMatchObject({ dhw: { basis: 'per_person', litres_per_day: 55 } })
    expect(up.services.dhw).toEqual({ storage_setpoint_c: 60, tap_outlet_temp_c: 43, cold_supply_temp_c: 10, load_shape: 'flat', circulation_pump_w: 0 })
  })

  it('with no hot water stated, no profile gets any; nothing is guessed for lighting', () => {
    const up = upgradeDocument(v27({ demand_basis: null, litres_per_person_per_day: null, litres_per_m2_per_day: null }))
    expect(up.profiles.find((p) => p.id === 'occ')).toMatchObject({ dhw: null })
    for (const g of up.system_groups) expect(g.efficacy_w_m2_per_100lux).toBeNull()
  })

  it('per m² with a zone that has no occupancy is refused, naming the zone, not dropped', () => {
    expect(() => upgradeDocument(v27({ demand_basis: 'per_m2', litres_per_person_per_day: null, litres_per_m2_per_day: 2 }, false))).toThrow(/has no occupancy to carry it/)
  })

  it('hot water per m² on a space: the same litres per m² as before', () => {
    const up = upgradeDocument(v27({ demand_basis: 'per_m2', litres_per_person_per_day: null, litres_per_m2_per_day: 2 }))
    expect(up.profiles.find((p) => p.id === 'occ')).toMatchObject({ dhw: { basis: 'per_m2', litres_per_day: 2 } })
  })
})
