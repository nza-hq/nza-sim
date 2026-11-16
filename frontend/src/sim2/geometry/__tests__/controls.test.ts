import { describe, expect, it } from 'vitest'
import { emptyPlan, type Plan, type XY } from '../plan'
import { fitRooms } from '../rooms'
import { buildDocument } from '../toDocument'
import { controlMap } from '../controls'

const day = (from: number, to: number) => Array.from({ length: 24 }, (_, h) => (h >= from && h < to ? 1 : 0))

describe('the Controls step (Brief 114 P4b)', () => {
  const fp: XY[] = [[0, 0], [10, 0], [10, 8], [0, 8]]
  const base = (): Plan => {
    const p = fitRooms(emptyPlan(), [fp]).plan
    return {
      ...p,
      spaces: [{ id: 's1', name: 'Office', use: 'office', occupancy: 'office_occupancy', lighting: null, equipment: null, people_per_m2: 0.1, heat_c: 21, cool_c: null, heat_hours: 'hotel_heating_setpoint', setback_c: 18 } as any],
      systems: [{ id: 'y1', service: 'heating', name: 'Boiler', template: 'gas_boiler_heating' }, { id: 'v1', service: 'ventilation', name: 'Supply fans', template: null, runs: 'continuous', schedule: 'always_on' } as any],
      rooms: p.rooms.map((r) => ({ ...r, space: 's1', systems: { heating: 'y1' } })),
      controls: [{ kind: 'system', ref: 'y1', controller: 'central_bms', note: ' optimiser ' }, { kind: 'system', ref: 'nope', controller: 'local', note: null }],
    }
  }

  it('writes the heating hours, the setback and the control entries that reach the document', () => {
    const doc = buildDocument(base()).doc as any
    const sp = doc.zones[0].setpoints
    expect(sp).toMatchObject({ heat_c: 21, setback_c: 18, hours_ref: 'hotel_heating_setpoint_hours' })
    const hours = doc.profiles.find((p: any) => p.id === 'hotel_heating_setpoint_hours')
    expect(hours.kind).toBe('schedule')
    expect(hours.day_types.weekday).toEqual(day(7, 23))
    // The entry for a system that is not in the document is left out; the note is trimmed.
    expect(doc.controls).toEqual([{ id: 'ctl_system_y1', target: { kind: 'system', ref: 'heating_y1' }, controller: 'central_bms', hours_ref: null, note: 'optimiser' }])
  })

  it('a setback without heating hours is dropped, with a note', () => {
    const p = base()
    const b = buildDocument({ ...p, spaces: [{ ...p.spaces[0]!, heat_hours: null }] })
    expect((b.doc as any).zones[0].setpoints).toMatchObject({ setback_c: null, hours_ref: null })
    expect(b.notes.join(' ')).toContain('Office: a setback needs heating hours to apply outside (Controls)')
  })

  it('the map reads the document hour for hour and says in words where runs and occupancy differ', () => {
    const p = base()
    const doc = buildDocument(p).doc as any
    // An office occupied 9 to 5 on weekdays only (stated here, so the test does not depend on a library shape).
    const occId = doc.zones[0].profile_refs.occupancy
    const occ = doc.profiles.find((x: any) => x.id === occId)
    const office = { weekday: day(9, 17), saturday: day(0, 0), sunday: day(0, 0) }
    if (occ.schedule) occ.schedule = office
    if (occ.day_types) occ.day_types = office
    const m = controlMap(p, doc)
    expect(m.occupied!.slice(0, 24)).toEqual(day(9, 17))
    const heat = m.rows.find((r) => r.key === 'system:y1')!
    expect(heat).toMatchObject({ controller: 'Central BMS', setTo: '21 °C, 18 °C outside its hours' })
    expect(heat.week!.slice(0, 24)).toEqual(day(7, 23))
    expect(m.flags).toContain('Boiler: heating comes on 2 h before anyone arrives')
    expect(m.flags).toContain('Boiler: heating stays on 6 h after everyone leaves')
    expect(m.flags).toContain('Boiler: heating runs at the weekend; nobody is in')
  })
})
