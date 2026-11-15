/**
 * Brief 105 Part 6 (brief deliverable 5): the cooled-room twin with internal gains.
 *
 * Brief 104's cooled room (three rooms in a row at Denver: the outer two heated at 20 °C, the middle one cooled at
 * 24 °C) with one gain per room from validation/energyplus/105_cooled_room_gains_spec.json: W/m² × an hourly
 * schedule with weekday / Saturday / Sunday days, each with its own radiant fraction. Engine 2 reads it through
 * gains.ts as an equipment profile (independent, its own schedule); EnergyPlus as ElectricEquipment on a
 * Schedule:Compact (validation/energyplus/105_cooled_room_gains.py, results committed in
 * docs/audit/105/06_cooled_room_gains_energyplus.json), so each side expands the schedule itself.
 *
 * Gate: per room, annual demand within ±10 % of EnergyPlus with the same surface coefficients (iso_conv), as Brief
 * 104's (e). The gain energy itself must agree to 0.1 %.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REFEREE_OPTIONS, runModel } from '../model'
import { ModelDocument } from '../../schema/model'
import { cooledRoomDocument, SPEC } from './cooledRoom'
import { MOS, readMos } from './denver'

const repo = (p: string) => path.resolve(__dirname, '../../../../..', p)
const GAINS = JSON.parse(fs.readFileSync(repo('validation/energyplus/105_cooled_room_gains_spec.json'), 'utf8'))
const EP = JSON.parse(fs.readFileSync(repo('docs/audit/105/06_cooled_room_gains_energyplus.json'), 'utf8'))
const sha = (p: string) => createHash('sha256').update(fs.readFileSync(repo(p))).digest('hex')

export const COOLED_GAINS_RESULTS: Record<string, unknown> = {}

describe('the cooled room with internal gains, against EnergyPlus from the same inputs', () => {
  it('gains as EnergyPlus counts them; per room, annual demand within ±10 % of EnergyPlus with the same surface coefficients', () => {
    // The committed EnergyPlus results must be of these spec files.
    expect(EP.spec_sha256).toBe(sha('validation/energyplus/104_cooled_room_spec.json'))
    expect(EP.gains_spec_sha256).toBe(sha('validation/energyplus/105_cooled_room_gains_spec.json'))
    const weather = readMos(fs.readFileSync(MOS))
    const { doc: base, lib } = cooledRoomDocument()
    const d: any = structuredClone(base)
    for (const g of GAINS.gains) {
      const id = `${g.room}_gain`
      d.profiles.push({
        id, kind: 'equipment', schedule: g.schedule, relationship_to_occupancy: 'independent', area_share: 1, gain_fraction: 1,
        active: { value: g.w_per_m2, unit: 'w_per_m2' }, baseload: { value: 0, unit: 'w_per_m2' }, radiant_fraction: g.radiant_fraction,
      })
      d.zones.find((z: any) => z.id === g.room).profile_refs.equipment = [id]
    }
    const doc = ModelDocument.parse(d)
    const r = runModel(doc, weather, lib, { ...REFEREE_OPTIONS, internal_gains: 'profiles' })
    // Reported, not gated: with TARP inside convection (Part 6), against EnergyPlus's own (TARP) run.
    const t = runModel(doc, weather, lib, { ...REFEREE_OPTIONS, internal_gains: 'profiles', surface_physics: { ...REFEREE_OPTIONS.surface_physics!, inside_convection: 'tarp' } })
    const rows: Record<string, unknown> = {}
    r.zones.forEach((z, zi) => {
      const room = SPEC.rooms.find((x: any) => x.id === z.zone_id)
      const which = room.heat_c != null ? 'heat_mwh' : 'cool_mwh'
      const e2 = (room.heat_c != null ? z.annual.heating_kwh : z.annual.cooling_kwh) / 1000
      const tz = t.zones[zi], e2t = (room.heat_c != null ? tz.annual.heating_kwh : tz.annual.cooling_kwh) / 1000
      const iso = EP.runs.iso_conv.zones[z.zone_id], b = EP.runs.base.zones[z.zone_id]
      const gain = z.breakdown.filter((l) => l.term === 'equipment_gains').reduce((s, l) => s + l.kwh, 0) / 1000
      rows[z.zone_id] = {
        demand: which, engine2: +e2.toFixed(3), ep_iso_conv: +iso[which].toFixed(3), ep_base: +b[which].toFixed(3),
        vs_iso: +((e2 / iso[which] - 1) * 100).toFixed(1), vs_base: +((e2 / b[which] - 1) * 100).toFixed(1),
        gains_mwh: +gain.toFixed(4), ep_gains_mwh: +iso.gains_mwh.toFixed(4),
        engine2_tarp: +e2t.toFixed(3), tarp_vs_base: +((e2t / b[which] - 1) * 100).toFixed(1),
      }
      expect(gain / iso.gains_mwh - 1).toBeCloseTo(0, 3)
      expect(z.closure.max_wh).toBeLessThanOrEqual(1)
      expect(Math.abs(e2 / iso[which] - 1)).toBeLessThanOrEqual(0.10)
      expect(tz.closure.max_wh).toBeLessThanOrEqual(1)
    })
    COOLED_GAINS_RESULTS.rows = rows
    console.log('cooled room with gains', JSON.stringify(rows))
  })
})
