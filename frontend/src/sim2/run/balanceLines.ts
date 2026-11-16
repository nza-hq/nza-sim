/**
 * Brief 110b P1: a run's balance as lines for today's `HeatBalance` (its `lines` prop), so the Model workspace draws the
 * same Rows / Stacked / Sankey chart as today's modules instead of a chart of its own.
 *
 * Every term of the balance is drawn (Rule 9): positive is heat in (gains side), negative heat out (losses side), so the
 * two sides' totals are equal when the balance closes. Through walls, roof and floor the engine has three terms that
 * largely cancel (conduction, sun absorbed on the outside, radiation to the sky); as in the results table, they are
 * drawn as one net line, "Walls, roof and floor", and the table under the chart lists the three. Colours come from
 * today's `data/balanceColours.js`; words from the results panel's `TERMS`.
 */
// @ts-expect-error untyped JS module from today's app
import { COOLING_COLOUR, FABRIC_COLOURS, HEATING_COLOUR, INTERNAL_COLOURS, SOLAR_COLOURS } from '../../data/balanceColours.js'
import { FABRIC, TERMS } from './ResultsPanel'

export type BalanceLine = { key: string; label: string; kwh: number; kwh_per_m2: number; colour: string }
export type BalanceLines = { gia_m2: number; gains: BalanceLine[]; losses: BalanceLine[] }

const COLOUR: Record<string, string> = {
  heating: HEATING_COLOUR,
  cooling: COOLING_COLOUR,
  conduction: FABRIC_COLOURS.external_wall,
  walls_roof_floor: FABRIC_COLOURS.external_wall,
  bridging: FABRIC_COLOURS.thermal_bridging,
  infiltration: FABRIC_COLOURS.infiltration,
  permanent_vents: FABRIC_COLOURS.permanent_vents,
  mechanical_ventilation: FABRIC_COLOURS.ventilation,
  solar_transmitted: SOLAR_COLOURS.south,
  glazing_solar_absorbed: SOLAR_COLOURS.west,
  opaque_solar_absorbed: SOLAR_COLOURS.east,
  solar_lost_through_glazing: FABRIC_COLOURS.glazing,
  sky_longwave: '#64748B',
  occupancy_gains: INTERNAL_COLOURS.people,
  lighting_gains: INTERNAL_COLOURS.lighting,
  equipment_gains: INTERNAL_COLOURS.equipment,
  auxiliary_gains: INTERNAL_COLOURS.auxiliary,
  interzone: '#0EA5E9',
  storage: '#9CA3AF',
  other_gains: '#9CA3AF',
}

export function balanceLines(breakdown: { term: string; kwh: number }[], floor_m2: number): BalanceLines {
  const line = (term: string, kwh: number): BalanceLine => ({
    key: term, label: term === 'walls_roof_floor' ? 'Walls, roof and floor' : TERMS[term] ?? term, kwh, kwh_per_m2: floor_m2 > 0 ? kwh / floor_m2 : 0, colour: COLOUR[term] ?? '#9CA3AF',
  })
  const fabric = breakdown.filter((l) => FABRIC.includes(l.term))
  const rest = breakdown.filter((l) => !FABRIC.includes(l.term))
  const all = fabric.length ? [...rest, { term: 'walls_roof_floor', kwh: fabric.reduce((a, l) => a + l.kwh, 0) }] : rest
  const gains = all.filter((l) => l.kwh > 0).map((l) => line(l.term, l.kwh)).sort((a, b) => b.kwh - a.kwh)
  const losses = all.filter((l) => l.kwh < 0).map((l) => line(l.term, -l.kwh)).sort((a, b) => b.kwh - a.kwh)
  return { gia_m2: floor_m2, gains, losses }
}
