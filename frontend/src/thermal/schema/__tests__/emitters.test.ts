/**
 * Brief 108 Part 1: schema 2.4 emitters. What a document must say about each zone's emitters, and what it may leave out.
 */
import { describe, expect, it } from 'vitest'
import { cooledRoomDocument } from '../../engine/__tests__/cooledRoom'
import { ModelDocument } from '../model'

function setup() {
  const d: any = structuredClone(cooledRoomDocument().doc)
  d.system_groups = [
    { id: 'boiler', service: 'heating', zones: ['west', 'east'], enabled: true, share_pct: 100, source: 'gas', efficiency_metric: 0.9, design_flow_c: 70, design_return_c: 60 },
    { id: 'chiller', service: 'cooling', zones: ['middle'], enabled: true, share_pct: 100, source: 'electricity', efficiency_metric: 2.5 },
  ]
  const rad = (id: string) => ({ id, kind: 'radiator', count: 2, rated_output_w: 500, radiant_fraction: 0.3, system_group_id: 'boiler', rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.3 })
  d.zones.find((z: any) => z.id === 'west').emitters = [rad('w1')]
  d.zones.find((z: any) => z.id === 'east').emitters = [rad('e1'), { id: 'e2', kind: 'electric', count: 1, rated_output_w: 2000, radiant_fraction: 0.1, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
  return d
}
const issues = (d: any) => {
  const r = ModelDocument.safeParse(d)
  return r.success ? [] : r.error.issues.map((i) => i.message)
}

describe('schema 2.4: emitters per zone', () => {
  it('two radiators on a wet system and an electric heater with a fixed output are a valid document', () => {
    expect(issues(setup())).toEqual([])
  })
  it('a zone may state no emitters (its heating is not limited)', () => {
    const d = setup()
    expect(d.zones.find((z: any) => z.id === 'middle').emitters).toEqual([])
    expect(issues(d)).toEqual([])
  })
  it('an emitter id used twice is refused', () => {
    const d = setup()
    d.zones[2].emitters[0].id = 'w1'
    expect(issues(d)).toContain('emitter id "w1" is used twice')
  })
  it('a wet emitter must name a heating system that exists and serves its zone', () => {
    const a = setup(); a.zones[0].emitters[0].system_group_id = 'nope'
    expect(issues(a).join()).toContain('which does not exist')
    const b = setup(); b.zones[0].emitters[0].system_group_id = 'chiller'
    expect(issues(b).join()).toContain('a cooling system, not heating')
    const c = setup(); c.system_groups[0].zones = ['east']
    expect(issues(c).join()).toContain('which its system "boiler" does not serve')
  })
  it('an electric heater or VRF indoor unit names no wet system', () => {
    const d = setup()
    d.zones[2].emitters[1].system_group_id = 'boiler'
    expect(issues(d).length).toBeGreaterThan(0)
  })
  it('nothing is defaulted: a missing field is a schema error, an unknown kind is refused', () => {
    const a = setup(); delete a.zones[0].emitters[0].radiant_fraction
    expect(issues(a).length).toBeGreaterThan(0)
    const b = setup(); b.zones[0].emitters[0].kind = 'stove'
    expect(issues(b).length).toBeGreaterThan(0)
  })
})
