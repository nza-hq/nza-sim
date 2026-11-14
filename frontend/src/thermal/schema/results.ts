/**
 * The Simulate v2 results document (Brief 102 Part 1): what an engine run returns and what `runs.results` stores.
 * Shape from the design note's "Outputs": per hour per zone, per hour per system group, annual by end use × fuel,
 * per zone, per system, building total, and every term of the balance as a breakdown line (CLAUDE.md rule 9).
 *
 * Hourly arrays are 8,760 long (8,784 allowed for a leap-year weather file). Energy in kWh, temperatures in °C.
 * Nothing here is computed; the engine (Engine 1 to 4) fills it. Today's instant engine does not produce this
 * shape: Part 5 stores its result as a `summary` only, with `engine_version 'instant-1'`.
 */
import { z } from 'zod'
import { SERVICES } from './model'

const finite = z.number().finite()
const hourly = z.array(finite).refine((a) => a.length === 8760 || a.length === 8784, {
  message: 'an hourly series has 8,760 values (8,784 in a leap year)',
})
const sha = z.string().regex(/^[0-9a-f]{64}$/)

export const END_USES = ['heating', 'cooling', 'dhw', 'lighting', 'equipment', 'auxiliary', 'ventilation_fans', 'pumps'] as const
export const EndUse = z.enum(END_USES)
export const FUELS = ['electricity', 'gas', 'oil', 'lpg', 'biomass', 'district_heat', 'other'] as const
export const Fuel = z.enum(FUELS)

/** kWh by end use and fuel: { heating: { gas: 123, electricity: 4 }, … }. */
export const EndUseByFuel = z.record(EndUse, z.record(Fuel, finite))

export const ZoneHourly = z
  .object({
    zone_id: z.string().min(1),
    air_temperature_c: hourly,
    operative_temperature_c: hourly.optional(),
    heating_demand_kwh: hourly,
    cooling_demand_kwh: hourly,
  })
  .strict()

export const SystemGroupHourly = z
  .object({
    system_group_id: z.string().min(1),
    service: z.enum(SERVICES),
    delivered_kwh: hourly,
    fuel: Fuel,
    fuel_kwh: hourly,
  })
  .strict()

/** One term of the energy balance. The sum of the lines of a `balance` must equal its total (rule 9). */
export const BreakdownLine = z
  .object({
    balance: z.enum(['heating_demand', 'cooling_demand', 'delivered', 'fuel']),
    term: z.string().min(1),
    zone_id: z.string().nullable(),
    system_group_id: z.string().nullable(),
    kwh: finite,
  })
  .strict()

export const Results = z
  .object({
    schema_version: z.literal('2.0'),
    meta: z
      .object({
        model_hash: sha,
        engine_version: z.string().min(1),
        library_hash: sha,
        weather_hash: sha,
        engine_ms: finite.nonnegative(),
      })
      .strict(),
    hourly: z
      .object({
        zones: z.array(ZoneHourly),
        system_groups: z.array(SystemGroupHourly),
        electricity_kwh: hourly,
      })
      .strict(),
    annual: z
      .object({
        building: EndUseByFuel,
        by_zone: z.record(z.string(), EndUseByFuel),
        by_system_group: z.record(z.string(), EndUseByFuel),
        floor_area_m2: finite.positive(),
        eui_kwh_m2: finite,
      })
      .strict(),
    breakdown: z.array(BreakdownLine),
  })
  .strict()
export type Results = z.infer<typeof Results>

/**
 * What `runs.summary` holds. For `instant-1` (today's engine) this is all a run records: the EUI copied from the one
 * canonical read path (engineReads.readModelledEui, CLAUDE.md rule 11) and the annual figures as that engine
 * reports them, with `source` naming the read path.
 */
export const RunSummary = z
  .object({
    eui_kwh_m2: finite,
    annual_by_end_use: z.record(z.string(), finite),
    annual_by_fuel: z.record(z.string(), finite),
  })
  .strict()
export type RunSummary = z.infer<typeof RunSummary>
