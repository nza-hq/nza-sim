/**
 * Brief 115: the community centre's open-plan office as a referee room (validation/energyplus/115_office_spec.json), one
 * document per case, built from the same inputs as the EnergyPlus model (115_office_referee.py): the air box of
 * airBox.ts at the office's size, plus office hours with a setback, one gain, cooling only in hours, and the window rule
 * per case (shut: open fraction 0; always: timetable, every hour; temperature_in_hours: open above 22 °C in office hours).
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ModelDocument } from '../../schema/model'
import { airBoxDocument } from './airBox'

const repo = (p: string) => fileURLToPath(new URL(`../../../../../${p}`, import.meta.url))
export const OFFICE_SPEC = JSON.parse(fs.readFileSync(repo('validation/energyplus/115_office_spec.json'), 'utf8'))

export function officeDocument(caseName: string) {
  const S = OFFICE_SPEC, c = S.cases[caseName]
  const { doc: base, lib } = airBoxDocument(caseName, S)
  const d: any = structuredClone(base)
  const w = S.weather
  d.building.id = `office-${caseName}`
  d.building.name = `Community centre office ${caseName}`
  d.building.site = { ...d.building.site, lat: w.lat, lon: w.lon, name: 'London Gatwick' }
  d.weather_ref = { kind: 'epw', station_id: w.station_id, file_name: w.file, file_hash: w.sha256 }
  d.profiles.push(
    { id: 'office_hours', kind: 'schedule', label: 'Office hours', day_types: S.hours },
    {
      id: 'office_gain', kind: 'equipment', schedule: S.gain.schedule, relationship_to_occupancy: 'independent', area_share: 1, gain_fraction: 1,
      active: { value: S.gain.w_per_m2, unit: 'w_per_m2' }, baseload: { value: 0, unit: 'w_per_m2' }, radiant_fraction: S.gain.radiant_fraction,
    },
  )
  const z = d.zones[0]
  z.profile_refs.equipment = ['office_gain']
  z.setpoints = { heat_c: S.heat_c, cool_c: c.cool ? S.cool_c : null, setback_c: S.setback_c, hours_ref: 'office_hours', control_strategy: 'active_setpoint' }
  const ctl = d.controls[0]
  if (c.control === 'shut') Object.assign(ctl, { rule: 'temperature', open_fraction: 0, open_above_c: S.rule.open_above_c, modulation: null })
  else if (c.control === 'always') Object.assign(ctl, { rule: 'timetable', open_fraction: 1, open_above_c: null, modulation: null })
  else if (c.control === 'temperature_in_hours') Object.assign(ctl, { rule: 'temperature', open_fraction: 1, open_above_c: S.rule.open_above_c, modulation: null, hours_ref: 'office_hours' })
  else throw new Error(`unknown control ${c.control}`)
  return { doc: ModelDocument.parse(d), lib }
}
