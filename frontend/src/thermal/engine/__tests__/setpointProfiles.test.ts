/**
 * Brief 121 P1: setpoints as profiles (zones[].setpoints.heat_ref / cool_ref, temperature profiles). The engine path is
 * Brief 109's hourly setpoint array (refereed against EnergyPlus); these tests tie the profile input to it exactly and
 * check every refusal. The Brief 104 cooled room at Denver, in quarter hours as Brief 109's referee.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REFEREE_OPTIONS, runModel, zoneSetpointHours, type RunOptions } from '../model'
import { ModelDocument } from '../../schema/model'
import { steadyDocument } from '../../../sim2/run/seam'
import { cooledRoomDocument } from './cooledRoom'
import { MOS, readMos } from './denver'

const W = readMos(fs.readFileSync(MOS))
const OPTS: RunOptions = { ...REFEREE_OPTIONS, time_step: { steps_per_hour: 4, theta_e_between: 'linear' } }
const { doc: BASE, lib: LIB } = cooledRoomDocument()
const office = Array.from({ length: 24 }, (_, h) => (h >= 7 && h < 18 ? 1 : 0))
const off = Array(24).fill(0)
const HOURS = { id: 'office', kind: 'schedule', day_types: { weekday: office, saturday: off, sunday: off } }
const temp = (id: string, wd: number[], we: number[]) => ({ id, kind: 'temperature', day_types: { weekday: wd, saturday: we, sunday: we } })
const by = (on: number, out: number) => office.map((f) => (f ? on : out))

/** Brief 109's way: heat_c 20 in office hours, setback 15; cooling 24 in office hours. */
function hoursWay() {
  const d: any = structuredClone(BASE)
  d.profiles.push(structuredClone(HOURS))
  for (const z of d.zones) {
    z.setpoints.hours_ref = 'office'
    if (z.setpoints.heat_c != null) z.setpoints.setback_c = 15
  }
  return d
}
/** The same as profiles. */
function profileWay() {
  const d: any = structuredClone(BASE)
  d.profiles.push(structuredClone(HOURS), temp('heat', by(20, 15), Array(24).fill(15)), temp('cool', Array(24).fill(24), Array(24).fill(24)))
  for (const z of d.zones) {
    z.setpoints.hours_ref = 'office'
    if (z.setpoints.heat_c != null) z.setpoints.heat_ref = 'heat'
    if (z.setpoints.cool_c != null) z.setpoints.cool_ref = 'cool'
  }
  return d
}
const run = (d: any) => runModel(ModelDocument.parse(d), W, LIB, OPTS)

describe('Brief 121: setpoints as profiles', () => {
  it('a profile holding heat_c in hours and the setback outside them gives exactly Brief 109\'s run', () => {
    const a = run(hoursWay()), b = run(profileWay())
    a.zones.forEach((z, i) => {
      const y = b.zones[i]
      for (let h = 0; h < 8760; h++) {
        expect(y.hourly.heating_w[h]).toBeCloseTo(z.hourly.heating_w[h], 6)
        expect(y.hourly.cooling_w[h]).toBeCloseTo(z.hourly.cooling_w[h], 6)
      }
      expect(y.annual.heating_kwh).toBeCloseTo(z.annual.heating_kwh, 9)
    })
  })
  it('a shaped profile reads back hour by hour, and heats between the flat cases', () => {
    const shaped = profileWay()
    const wd = by(21, 16).map((v, h) => (h === 7 || h === 8 ? 19 : v))
    shaped.profiles[shaped.profiles.findIndex((p: any) => p.id === 'heat')] = temp('heat', wd, Array(24).fill(16))
    for (const z of shaped.zones) if (z.setpoints.heat_c != null) z.setpoints.heat_c = 21
    const doc = ModelDocument.parse(shaped)
    const sh = zoneSetpointHours(doc, W.hours)[0]!
    expect(Array.from(sh.hourly.heat_c.slice(0, 24))).toEqual(wd)               // 1 January is a Monday
    expect(Array.from(sh.hourly.heat_c.slice(5 * 24, 6 * 24))).toEqual(Array(24).fill(16)) // Saturday
    const flat = (on: number) => { const d = profileWay(); d.profiles[d.profiles.findIndex((p: any) => p.id === 'heat')] = temp('heat', by(on, 16), Array(24).fill(16)); for (const z of d.zones) if (z.setpoints.heat_c != null) z.setpoints.heat_c = on; return run(d).zones[0].annual.heating_kwh }
    const s = run(shaped).zones[0].annual.heating_kwh
    expect(s).toBeGreaterThan(flat(19))
    expect(s).toBeLessThan(flat(21))
  })
  it('profiles with no hours: in use every hour, the profile every hour', () => {
    const d = profileWay(); for (const z of d.zones) z.setpoints.hours_ref = null
    const sh = zoneSetpointHours(ModelDocument.parse(d), W.hours)
    expect(sh[0]!.in_use_hours).toBe(8760)
    expect(sh[1]!.hourly.cool_c.every((v) => v === 24)).toBe(true)
  })
  it('the sizing run drops the profiles and holds heat_c', () => {
    const s = steadyDocument(ModelDocument.parse(profileWay()))
    expect(s.zones.every((z) => z.setpoints.heat_ref == null && z.setpoints.cool_ref == null && z.setpoints.hours_ref == null)).toBe(true)
  })
  it('refuses by name', () => {
    const heated = (d: any) => d.zones.find((z: any) => z.setpoints.heat_c != null)
    const missing = profileWay(); heated(missing).setpoints.heat_ref = 'nope'
    expect(() => ModelDocument.parse(missing)).toThrow(/temperature profile .{0,2}nope/)
    const sched = profileWay(); heated(sched).setpoints.heat_ref = 'office'
    expect(() => ModelDocument.parse(sched)).toThrow(/temperature profile .{0,2}office/)
    const withSetback = profileWay(); heated(withSetback).setpoints.setback_c = 15
    expect(() => run(withSetback)).toThrow('setpoints.setback_c: the heating profile carries the setback')
    const notTop = profileWay(); heated(notTop).setpoints.heat_c = 21
    expect(() => run(notTop)).toThrow("heat_c (21 °C) must be the heating profile's highest value (20 °C)")
    const noHeat = profileWay(); heated(noHeat).setpoints.heat_c = null
    expect(() => run(noHeat)).toThrow('a heating profile needs heat_c')
    const notLow = profileWay(); notLow.zones.find((z: any) => z.setpoints.cool_c != null).setpoints.cool_c = 23
    expect(() => run(notLow)).toThrow("cool_c (23 °C) must be the cooling profile's lowest value (24 °C)")
    const cross = profileWay(); const z = heated(cross); z.setpoints.cool_c = 18; z.setpoints.cool_ref = 'c18'
    cross.profiles.push(temp('c18', Array(24).fill(18), Array(24).fill(18)))
    expect(() => run(cross)).toThrow('reaches the cooling setpoint')
  })
})
