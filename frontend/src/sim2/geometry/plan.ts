/**
 * Sim2 geometry prototype: the plan as the editor holds it, and the sums on it (no screen, no React).
 *
 * A plan is one floor: one or more blocks (each a separate outline, drawn with decodED's drawing core; blocks that
 * touch are joined into one), filled with rooms (decodED's room editor and zone cut), and window sets on the blocks'
 * outside walls. Rooms always cover the floor exactly, wall to wall, with no
 * gaps and no overlaps (partitions have no thickness here). Each room sits in one zone; a zone is what the model
 * document calls a zone, and carries what is assigned to it (its use, its heating and its cooling system).
 * Everything is in local metres, x east, y north, north up (orientation 0).
 *
 * A "wall run" is one side of a block; runs are numbered through the blocks in order (block 0's sides, then block 1's). Windows belong to a run and are
 * placed along it by distance from its start, so cutting the floor into rooms never moves or loses a window; when the
 * model document is written, each zone's stretch of the run takes the windows whose middles fall on it.
 */
import { area, ccw, type XY } from './ported/zones'
import { type Profile, profile as libProfile, profilesFor as libProfilesFor } from '../library/library'

export type { XY }

/** A room: drawn, always inside a block, in exactly one zone. */
export type PlanRoom = {
  id: string
  name: string
  ring: XY[]
  zone: string
  /** Fabric step: this room's roof and ground floor types (absent: the element's first type). */
  roof?: string
  floor?: string
  /** Spaces step: the room's space type (archetype); absent = not given one yet. */
  space?: string
  /** Systems step: the room's system per service (a PlanSystem id); absent = none given yet. */
  systems?: Partial<Record<Service, string>>
  /** Systems step: the room's emitters, how many of each emitter type. */
  emitters?: Array<{ type: string; count: number }>
}
/** A zone: a group of rooms that the model treats as one air volume, with what is assigned to it. Null is unset. */
export type PlanZone = { id: string; name: string; use: string | null; heating: string | null; cooling: string | null }
/** The services the Systems step gives rooms. */
export type Service = 'heating' | 'cooling' | 'ventilation' | 'dhw' | 'lighting'
export const SERVICES: ReadonlyArray<{ key: Service; name: string; one: string }> = [
  { key: 'heating', name: 'Heating', one: 'Heating' },
  { key: 'cooling', name: 'Cooling', one: 'Cooling' },
  { key: 'ventilation', name: 'Ventilation', one: 'Ventilation' },
  { key: 'dhw', name: 'Hot water', one: 'Hot water' },
  // Brief 112: the luminaires (their efficacy); the light a space needs (lux) is on its space type.
  { key: 'lighting', name: 'Lighting', one: 'Lighting' },
]
/** The services space types carried before systems were their own step (upgradePlan); never lighting, whose key on
 * a space type is its lighting profile. */
const OLD_SERVICES = SERVICES.filter((s) => s.key !== 'lighting')
/** A system the user has made for a service: a library system template (its fuel and efficiency come from there),
 * and for ventilation the flow and when it runs, typed. Rooms are given one per service. Null: not set. */
export type PlanSystem = {
  id: string
  service: Service
  name: string
  template: string | null
  /** Ventilation flow, typed: l/s per m² of floor for mechanical, air changes per hour for natural. */
  flow?: number | null
  /** When the ventilation runs: 'always_on', or a library ventilation profile's key. */
  schedule?: string | null
  /** Heating: the design flow and return temperatures, °C, its emitters are re-rated at (schema 2.4). */
  design_flow_c?: number | null
  design_return_c?: number | null
  /** Brief 120: heating and cooling, its output, kW (limits the rooms it serves); hot water, the water heater's output. */
  capacity_kw?: number | null
  /** Brief 120: hot water, the store the heater refills, litres (needs the heater's kW). */
  storage_litres?: number | null
  /** Brief 120: heating, a hot water system (PlanSystem id) it heats first. */
  dhw_first?: string | null
  /** Lighting (Brief 112): the luminaires' efficacy, W/m² for each 100 lux. Runs on electricity; no library template. */
  efficacy?: number | null
  /** Brief 114: heating, cooling and hot water, the system's pumps (null or absent: none stated). */
  pumps?: PlanPumps | null
  /** Brief 114: ventilation, how the fans are told to run, and with demand the least share of the flow. */
  runs?: 'continuous' | 'schedule' | 'demand' | null
  demand_min?: number | null
}
/** Brief 114: a system's pumps as typed; each null is not stated. `default_from`: the source "Use defaults" filled them
 * from, cleared on any edit. `schedule`: a profile key, with runs 'schedule' only. */
export type PlanPumps = {
  basis: 'w' | 'w_per_kw_capacity' | 'w_per_m2' | null
  value: number | null
  speed: 'fixed' | 'variable' | null
  runs: 'continuous' | 'with_demand' | 'schedule' | null
  schedule: string | null
  default_from: string | null
  /** Continuous pumps only: the months of the season, 1–12 (Controls). Null or absent: the months with load. */
  season_months?: number[] | null
}
/** Months as words: a run of months (wrapping the year) as "Oct–Apr", otherwise listed. */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function monthsText(ms: number[]): string {
  const set = new Set(ms)
  if (set.size === 12) return 'all year'
  if (set.size === 1) return MONTHS[ms[0]! - 1]!
  const start = [...set].find((m) => !set.has(m === 1 ? 12 : m - 1))
  if (start != null) {
    let n = 0, m = start
    while (set.has(m)) { n++; m = m === 12 ? 1 : m + 1 }
    if (n === set.size) return `${MONTHS[start - 1]}–${MONTHS[(start + n - 2) % 12]}`
  }
  return [...set].sort((a, b) => a - b).map((m) => MONTHS[m - 1]).join(', ')
}
export const noPumps = (): PlanPumps => ({ basis: null, value: null, speed: null, runs: null, schedule: null, default_from: null })
/** Brief 114: a building load outside the rooms (a lift, external lighting): its power and when it runs. */
/** Brief 114: who or what controls a system, its fans or its lighting. Recorded, not yet used in the calculation. */
export const CONTROLLERS = [
  { key: 'central_bms', name: 'Central BMS' },
  { key: 'local', name: 'Local controls' },
  { key: 'time_clock', name: 'Time clock' },
  { key: 'manual', name: 'By hand' },
  { key: 'photocell', name: 'Photocell' },
] as const
export type Controller = (typeof CONTROLLERS)[number]['key']
/** A control entry on the plan: `ref` is the plan system's id (ventilation and lighting systems included). */
export type PlanControl = { kind: 'system' | 'ventilation' | 'lighting'; ref: string; controller: Controller | null; note: string | null }
export type OtherLoadInput = { id: string; kind: 'lift' | 'external_lighting' | 'other'; name: string; power_w: number | null; runs: 'continuous' | 'schedule' | 'dusk_to_dawn' | null; schedule: string | null }

/** Emitter kinds (schema 2.4). Wet kinds are fed by the room's heating system and rated (EN 442); VRF indoor units and
 * electric heaters have a fixed output. */
export const EMITTER_KINDS = [
  { key: 'radiator', name: 'Radiator', wet: true },
  { key: 'underfloor', name: 'Underfloor heating', wet: true },
  { key: 'fan_coil', name: 'Fan coil', wet: true },
  { key: 'vrf_indoor', name: 'VRF indoor unit', wet: false },
  { key: 'electric', name: 'Electric heater', wet: false },
  { key: 'other', name: 'Other', wet: true },
] as const
export type EmitterKind = (typeof EMITTER_KINDS)[number]['key']
/** An emitter type the user has made: one unit's rated output and rating, given to rooms with a count. Null: not set. */
export type EmitterType = {
  id: string
  name: string
  kind: EmitterKind
  rated_output_w: number | null
  radiant_fraction: number | null
  rated_flow_c: number | null
  rated_return_c: number | null
  rated_room_c: number | null
  exponent_n: number | null
  /** Schema 2.7 (Brief 119): false only for a unit that cools and does not heat. Left out: it heats. */
  heats?: boolean
  /** One unit's sensible cooling, W (fan coils, VRF indoor units, other); null or left out: it does not cool. */
  cooling_output_w?: number | null
  /** The catalogue item its rated figures were taken from (thermal/catalogue); the run checks them against it. */
  catalogue?: { catalogue: string; item: string } | null
}
/** Brief 119: the kinds that can cool a room. */
export const coolingKind = (k: EmitterKind) => k === 'fan_coil' || k === 'vrf_indoor' || k === 'other'
export const isWet = (k: EmitterKind) => EMITTER_KINDS.find((x) => x.key === k)!.wet

/** Uses a zone can be given: the zone types today's schedule editor offers (UnifiedScheduleEditor.jsx). */
/** An occupancy choice that is not a library profile: people present every hour ("2 people, all the time"). */
export const ALWAYS = 'always_on'

export const USES: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'bedroom', name: 'Bedroom' },
  { key: 'office', name: 'Office' },
  { key: 'public', name: 'Public' },
  { key: 'retail', name: 'Retail' },
  { key: 'industrial', name: 'Industrial' },
  { key: 'other', name: 'Other' },
]

/** One window: on wall run `wall`, its left edge `t_m` along the run (run a→b, seen from outside). Which room and which
 * wall piece it belongs to is not stored: it is the piece its middle is on. */
export type Win = {
  id: string
  wall: number
  t_m: number
  width_m: number
  height_m: number
  sill_m: number
  /** Shading round the window (frame of fins, overhang and sill), metres out from the wall; 0 = none. */
  shading_m: number
  /** A door (opaque, from the floor) rather than a window. */
  door?: boolean
  /** Only while blocks are being rebuilt: the wall's ends, to find it again. */
  at?: { a: XY; b: XY }
}

/** The fabric elements the Fabric step gives types to. */
export type FabricElement = 'wall' | 'glazing' | 'door' | 'roof' | 'floor' | 'partition'
/** A fabric type: a library construction (by key) and, optionally, a U-value the user typed over it (W/m²K). Both
 * null: not set yet, and the model document says so (`unassigned:…`). */
export type FabricType = {
  id: string; element: FabricElement; name: string; construction: string | null; u: number | null
  /** Brief 118: the construction set it came from, until changed by hand. */ template?: string | null
  /** Brief 115 (windows only): how the window opens. Null or left out: it does not open. Every figure typed; null not set. */
  opening?: WindowOpening | null
  /** Brief 115 (windows only): a trickle vent in each window's frame. Null or left out: none. */
  trickle?: TrickleVent | null
}
export const WINDOW_STYLES = [
  { key: 'side_hung', name: 'Side-hung', angle: true },
  { key: 'top_hung', name: 'Top-hung', angle: true },
  { key: 'bottom_hung', name: 'Bottom-hung', angle: true },
  { key: 'centre_pivot', name: 'Centre-pivot', angle: true },
  { key: 'sliding', name: 'Sliding', angle: false },
  { key: 'louvre', name: 'Louvre', angle: false },
] as const
export type WindowStyle = (typeof WINDOW_STYLES)[number]['key']
/** The opening part of a window type: its style, the share of the glass that opens, its widest angle (hung and pivot
 * windows) and its discharge coefficient. */
export type WindowOpening = { style: WindowStyle | null; openable_fraction: number | null; opening_angle_deg: number | null; cd: number | null }
/** A trickle vent in every window of the type: its equivalent area (mm², as the maker states it), discharge
 * coefficient, and, for today's fixed air method only, whether air crosses the room or stays on one side. */
export type TrickleVent = { area_mm2: number | null; cd: number | null; flow_mode: 'single_sided' | 'cross' | null }
/** Brief 115: when a space type's windows open (Controls step). One rule for every room of the space type. */
export type WindowRule = {
  rule: 'temperature' | 'timetable' | null
  /** A temperature rule opens above this, °C, when warmer than outside. */
  open_above_c: number | null
  /** How far they open, 0 to 1 of their widest. */
  open_fraction: number | null
  /** The hours they may open (a schedule profile key), or null: any hour. */
  hours: string | null
  /** Who opens them: by hand (manual), local controls or the BMS. */
  controller: Controller | null
}
export const AIR_TERRAINS = [
  { key: 'open', name: 'Open country (flat, few obstructions)' },
  { key: 'suburban', name: 'Suburban (low buildings, trees)' },
  { key: 'urban', name: 'Urban (town centre)' },
  { key: 'city', name: 'City (tall buildings around)' },
] as const
/** A stretch [t0, t1] of run `wall` given fabric type `type` for an element on walls (walls, windows, doors; absent
 * element = wall). Later stretches win where they overlap. */
export type TypeSpan = { wall: number; t0: number; t1: number; type: string; element?: 'wall' | 'glazing' | 'door'; at?: { a: XY; b: XY } }
export const FABRIC_ELEMENTS: ReadonlyArray<{ key: FabricElement; name: string; one: string }> = [
  { key: 'wall', name: 'External walls', one: 'External wall' },
  { key: 'glazing', name: 'Windows', one: 'Windows' },
  { key: 'door', name: 'Doors', one: 'Doors' },
  { key: 'roof', name: 'Roof', one: 'Roof' },
  { key: 'floor', name: 'Ground floor', one: 'Ground floor' },
  { key: 'partition', name: 'Walls between zones', one: 'Wall between zones' },
]
/** One type per element to start with, nothing chosen. */
export const defaultFabric = (): FabricType[] => FABRIC_ELEMENTS.map((e) => ({ id: `f_${e.key}`, element: e.key, name: e.one, construction: null, u: null }))

/** A space type (archetype): what a kind of room is used for, and its comfort band. Rooms are given one; every value
 * is a library key, a typed number, or null (not set). Its systems are given separately (Systems step). */
export type SpaceType = {
  id: string
  name: string
  /** The zone use written to the model (USES). */
  use: string | null
  occupancy: string | null
  /** People per m² of floor, typed: the library's occupancy profiles are shapes only, with no density. */
  people_per_m2?: number | null
  /** How people are counted: per m² of floor (people_per_m2, the default) or per room (people_per_room). */
  people_basis?: 'per_m2' | 'per_room' | null
  people_per_room?: number | null
  /** The "Used for" choice the values were borrowed from (borrow.ts), shown; changing a value afterwards is fine. */
  borrowed?: string | null
  /** Typed gains (W): the library has none. Null or absent: not stated, and the document says nothing. */
  occupancy_rate?: number | null
  sensible_w_per_person?: number | null
  /** Brief 112: the light the space needs, lux (demand). Its W/m² comes from the lighting system's efficacy. */
  lux?: number | null
  /** A lighting W/m² stated directly, used only while no lux is stated ("stated, not from lux"). */
  lighting_w_per_m2?: number | null
  /** Brief 112: hot water used, litres a day per person or per m² of floor (demand); the heater is on Systems. */
  hot_water_basis?: 'per_person' | 'per_m2' | null
  hot_water_litres?: number | null
  equipment_w_per_m2?: number | null
  equipment_baseload_w_per_m2?: number | null
  /** Comfort band the systems hold, °C, typed. */
  heat_c?: number | null
  cool_c?: number | null
  /** Brief 114 (edited on Controls): the heating hours (a schedule profile's key, or today's heating setpoint profile
   * read as its hours at its highest temperature; null or 'always_on': every hour) and
   * the temperature outside them, °C (null: off outside them). */
  heat_hours?: string | null
  setback_c?: number | null
  /** Brief 121 (edited on Controls): the heating / cooling setpoint follows this temperature profile (°C each hour)
   * instead of one figure. heat_c / cool_c are then written as its highest / lowest value; the profile carries any
   * setback, so setback_c is not used. Null or left out: one figure. */
  heat_profile?: string | null
  cool_profile?: string | null
  /** Brief 115 (edited on Controls): when this space type's opening windows open. Null or left out: not stated. */
  windows?: WindowRule | null
  /** How the gains enter the zone (schema 2.3 profile fields), visible and editable on the space type. A new space
   * type starts from today's engine values (TODAY in thermal/schema/upgrade.ts). */
  radiant_fraction?: number | null
  light_area_share?: number | null
  light_gain_fraction?: number | null
  light_relationship?: string | null
  daylight_factor?: number | null
  equip_area_share?: number | null
  equip_gain_fraction?: number | null
  equip_relationship?: string | null
  standby_factor?: number | null
  lighting: string | null
  equipment: string | null
}

/** Air leakage (q50, m³/h·m² at 50 Pa, every zone), thermal bridging (ISO 14683 default junctions × multiplier) and
 * site exposure. */
export type BuildingInputs = {
  q50: number | null; tb_multiplier: number | null; exposure: 'sheltered' | 'normal' | 'exposed' | null
  /** Brief 117/120: the design heat loss's outdoor temperature: stated °C, or the weather file's coldest 0.4 % / 1 %. */
  design_outdoor?: number | 'heating_99_6' | 'heating_99' | null
  /** Brief 117: warm-up allowance after a setback, W/m² (null: none), and the wind for permanent vents, m/s. */
  warm_up_w_per_m2?: number | null
  vent_wind_m_s?: number | null
  /** Brief 115: how air leakage and openings are worked out. Left out: 'today' (a plan saved before 115). */
  air_method?: 'today' | 'weather_driven'
  /** Weather-driven only: the cracks' flow exponent n, and whether single-sided rooms take EN 16798-7's wind term. */
  air_exponent?: number | null
  single_sided_turbulence?: boolean | null
  /** Weather-driven only: the terrain around the site (the wind's profile with height). */
  terrain?: 'open' | 'suburban' | 'urban' | 'city' | null
}
/** Hot water, for the whole building (the schema's service-level fields): stored, tap and cold-supply temperatures,
 * daily demand per person or per m² of floor, a circulation pump, and when it is used (shown as 'flat' until changed). Typed; null is not stated. */
export type DhwInputs = { storage_c: number | null; tap_c: number | null; cold_c: number | null; basis: 'per_person' | 'per_m2' | null; litres: number | null; pump_w: number | null; shape?: 'flat' | 'follow_occupancy' | null }
export const noDhw = (): DhwInputs => ({ storage_c: null, tap_c: null, cold_c: null, basis: null, litres: null, pump_w: null, shape: 'flat' })
export const noBuildingInputs = (): BuildingInputs => ({ q50: null, tb_multiplier: null, exposure: null })

/** Brief 118 P5: a project's own profile, made by editing one (Profiles step, today's schedule editor). A library
 * profile is never changed: editing one makes this copy, and the project's space types and systems move to it.
 * Same shape as a library profile's (hourly fractions by day type, monthly multipliers). */
/** The kinds a profile can be (Linzie, 17 Nov 00:31: setpoints and window opening are profiles too, IES-style).
 * 'ventilation' is shown as Availability: on/off hours for ventilation, pumps and windows. Setpoints are °C. */
export const PROFILE_TYPES = ['occupancy', 'lighting', 'equipment', 'dhw', 'heating_setpoint', 'cooling_setpoint', 'window_opening', 'ventilation'] as const
export type ProfileType = (typeof PROFILE_TYPES)[number]
export const isTemperature = (t: string | null | undefined) => t === 'heating_setpoint' || t === 'cooling_setpoint'
/** A temperature profile's in-use and lowest values, °C, over every hour of every day type. */
export const tempRange = (d: { weekday: number[]; saturday: number[]; sunday: number[] }) => {
  const all = [...d.weekday, ...d.saturday, ...d.sunday]
  return { hi: Math.max(...all), lo: Math.min(...all) }
}
/** A new profile of the project's own: every hour at one value the person states (a fraction, or °C). */
export function newOwnProfile(plan: Pick<Plan, 'own_profiles' | 'profiles'>, t: ProfileType, name: string, value: number): { key: string; own: OwnProfile } {
  const owns = plan.own_profiles ?? []
  let n = owns.length + 1
  while (owns.some((x) => x.key === `own_${n}`)) n++
  const day = () => Array(24).fill(value) as number[]
  return { key: `own_${n}`, own: { key: `own_${n}`, name, schedule_type: t, from: null, day_types: { weekday: day(), saturday: day(), sunday: day() }, monthly_multipliers: null } }
}
export type OwnProfile = {
  key: string
  name: string
  schedule_type: ProfileType
  /** The library profile it was copied from, or null. */
  from: string | null
  day_types: { weekday: number[]; saturday: number[]; sunday: number[] }
  monthly_multipliers: number[] | null
}
/** A profile by key: the project's own first, then the library's. Own profiles carry no body hash (not library items). */
export function profileOf(plan: Pick<Plan, 'own_profiles'>, key: string | null | undefined): (Omit<Profile, 'body_hash'> & { body_hash?: string; own?: true }) | undefined {
  if (!key) return undefined
  const o = plan.own_profiles?.find((x) => x.key === key)
  return o ? { key: o.key, name: o.name, schedule_type: o.schedule_type, building_type: null, zone_type: null, day_types: o.day_types, monthly_multipliers: o.monthly_multipliers, own: true } : libProfile(key)
}
/** A kind's profiles: the project's own, then the library's. */
export const profilesOfKind = (plan: Pick<Plan, 'own_profiles'>, t: OwnProfile['schedule_type']) => [...(plan.own_profiles ?? []).filter((x) => x.schedule_type === t).map((x) => profileOf(plan, x.key)!), ...libProfilesFor(t)]

export type Plan = {
  /** Separate outlines, each anticlockwise. Blocks never touch or overlap (touching ones are joined). */
  blocks: XY[][]
  rooms: PlanRoom[]
  zones: PlanZone[]
  systems: PlanSystem[]
  storey_height_m: number
  windows: Win[]
  fabric_types: FabricType[]
  /** Brief 118: the construction set last given to the whole building (shown on the left). */
  fabric_set?: string | null
  /** Brief 118: the building use last given to the whole building (Hotel, Office, Shop). */
  building_use?: string | null
  wall_spans: TypeSpan[]
  spaces: SpaceType[]
  /** The project's profiles (Brief 110b, Profiles step): library profile keys chosen for this project. Profiles a
   * space type or system points at are the project's too, listed or not. Not part of the document: only a profile
   * something uses reaches the engine. */
  profiles?: string[]
  /** Brief 114: lifts, external lighting and other loads outside the rooms (Systems, Other loads). */
  other_loads?: OtherLoadInput[]
  /** Brief 114: the Controls step's record of who controls each system (recorded, not yet used in the calculation). */
  controls?: PlanControl[]
  /** The project's own profiles (edited copies; see OwnProfile). */
  own_profiles?: OwnProfile[]
  /** Whole-building fabric inputs, typed (null: not stated). */
  building?: BuildingInputs
  /** Emitter types (Systems step), given to rooms with a count. */
  emitter_types?: EmitterType[]
  /** Hot water for the whole building, typed (Systems step). */
  dhw?: DhwInputs
  /** Next numbers, so names and ids are never reused within a plan. */
  next: { room: number; zone: number; system: number }
}

/** A plan saved before systems were their own step (15 Nov 2026) kept them on its space types: each space type's
 * systems become system types, given to the rooms of that space type. Anything else passes through. */
export function upgradePlan(p: Plan): Plan {
  type Old = SpaceType & Partial<Record<Service, string | null>> & { vent_flow?: number | null; vent_schedule?: string | null }
  const olds = p.spaces as Old[]
  const plan: Plan = { ...emptyPlan(), ...p, systems: (p.systems ?? []).filter((x) => 'template' in x) }
  if (!olds.some((sp) => OLD_SERVICES.some((s) => s.key in sp))) return hotWaterOnSpaces(plan)
  const systems = [...plan.systems]
  const made = new Map<string, string>()
  for (const sp of olds) {
    for (const s of OLD_SERVICES) {
      const t = sp[s.key as Exclude<Service, 'lighting'>]
      if (!t) continue
      const flow = s.key === 'ventilation' ? sp.vent_flow ?? null : undefined
      const schedule = s.key === 'ventilation' ? sp.vent_schedule ?? null : undefined
      const sig = `${s.key}|${t}|${flow}|${schedule}`
      if (made.has(`${sp.id}|${s.key}`)) continue
      let id = [...made.entries()].find(([k]) => k.startsWith('sig:') && k.slice(4) === sig)?.[1]
      if (!id) {
        id = `y${systems.length + 1}`
        systems.push({ id, service: s.key, name: `${s.one} · ${sp.name}`, template: t, ...(s.key === 'ventilation' ? { flow, schedule } : {}) })
        made.set(`sig:${sig}`, id)
      }
      made.set(`${sp.id}|${s.key}`, id)
    }
  }
  const spaces = olds.map(({ heating: _h, cooling: _c, ventilation: _v, dhw: _d, vent_flow: _f, vent_schedule: _s, ...rest }) => rest as SpaceType)
  const rooms = plan.rooms.map((r) => {
    if (!r.space) return r
    const sys: Partial<Record<Service, string>> = { ...r.systems }
    for (const s of OLD_SERVICES) {
      const id = made.get(`${r.space}|${s.key}`)
      if (id && !sys[s.key]) sys[s.key] = id
    }
    return Object.keys(sys).length ? { ...r, systems: sys } : r
  })
  return hotWaterOnSpaces({ ...plan, spaces, rooms, systems })
}

/** Brief 112: a plan saved with one building-wide daily hot water use gives it to every space type that states none,
 * and the building keeps only the heater's temperatures, pump and load shape. */
export function hotWaterOnSpaces(plan: Plan): Plan {
  const hw = plan.dhw
  if (!hw || (hw.basis == null && hw.litres == null)) return plan
  const spaces = plan.spaces.map((sp) => (sp.hot_water_basis != null || sp.hot_water_litres != null ? sp : { ...sp, hot_water_basis: hw.basis, hot_water_litres: hw.litres }))
  return { ...plan, spaces, dhw: { ...hw, basis: null, litres: null } }
}

/** A new model in the workspace: empty, with weather-driven air (Linzie, 16 Nov 08:34: new models default to it; a
 * plan saved before keeps today's). Its exponent (0.67) and the one-sided wind term (on) are the method's usual
 * values, shown and editable on Fabric, Air leakage; the terrain stays unset. */
export const newPlan = (): Plan => ({ ...emptyPlan(), building: { ...noBuildingInputs(), air_method: 'weather_driven', air_exponent: 0.67, single_sided_turbulence: true } })
export const emptyPlan = (): Plan => ({ blocks: [], rooms: [], zones: [], systems: [], storey_height_m: 3, windows: [], fabric_types: defaultFabric(), wall_spans: [], spaces: [], building: noBuildingInputs(), next: { room: 1, zone: 1, system: 1 } })

/** A new zone with nothing assigned. */
export const blankZone = (n: number): PlanZone => ({ id: `z${n}`, name: `Zone ${n}`, use: null, heating: null, cooling: null })

export const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1])
const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp

/** A block side: its block, its two ends, length, and the true azimuth of its outward normal (degrees clockwise from
 *  north). `index` runs through every block; `side` is the side within its block. */
export type WallRun = { index: number; block: number; side: number; a: XY; b: XY; length_m: number; azimuth_deg: number }

/** Outward normal azimuth of side a→b of an anticlockwise ring (outside is on the right). */
export function azimuthOf(a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  // Right-hand normal (dy, -dx); azimuth from north (y) clockwise towards east (x).
  const deg = (Math.atan2(dy, -dx) * 180) / Math.PI
  return round(((deg % 360) + 360) % 360, 6) % 360
}

export function wallRuns(blocks: readonly (readonly XY[])[]): WallRun[] {
  const out: WallRun[] = []
  blocks.forEach((ring, bi) => {
    if (ring.length < 3) return
    const r = ccw(ring)
    r.forEach((a, i) => {
      const b = r[(i + 1) % r.length] as XY
      out.push({ index: out.length, block: bi, side: i, a, b, length_m: dist(a, b), azimuth_deg: azimuthOf(a, b) })
    })
  })
  return out
}

/** All the blocks' floor area. */
export const floorArea = (blocks: readonly (readonly XY[])[]) => blocks.reduce((t, b) => t + area(b), 0)

/** Compass label for an azimuth: 16 points for the screen. */
export function compass16(az: number): string {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return pts[Math.round(az / 22.5) % 16] as string
}
/** The schema's four-way facade label (nearest of north, east, south, west). */
export function facade4(az: number): 'north' | 'east' | 'south' | 'west' {
  return (['north', 'east', 'south', 'west'] as const)[Math.round(az / 90) % 4]!
}

// ─── Windows ──────────────────────────────────────────────────────────────────────────────────────

/** One window, checked against its wall: `offset_m` is its left edge along the run. */
export type PlacedWindow = { set: string; wall: number; offset_m: number; width_m: number; height_m: number; sill_m: number; shading_m: number; door: boolean }

/** A stretch of a run: a wall piece, or a whole wall. */
export type Span = { run: number; t0: number; t1: number }

export type Layout = { windows: PlacedWindow[]; gap_m: number } | { why: string }

/** N windows of one size spaced equally over a span: gap = (L − N·w) / (N + 1). Refuses, in words, when they do not fit. */
export function layoutIn(span: Span, s: { count: number; width_m: number; height_m: number; sill_m: number; shading_m?: number }, storeyHeight: number, id = 'w'): Layout {
  const L = span.t1 - span.t0
  if (!(s.count >= 1) || !Number.isInteger(s.count)) return { why: 'Number of windows must be a whole number, 1 or more' }
  if (!(s.width_m > 0) || !(s.height_m > 0)) return { why: 'Window size must be more than zero' }
  if (s.sill_m < 0) return { why: 'Sill height cannot be below the floor' }
  if ((s.shading_m ?? 0) < 0) return { why: 'Shading depth cannot be less than zero' }
  if (s.sill_m + s.height_m > storeyHeight + 1e-9) return { why: `Sill + window height (${round(s.sill_m + s.height_m, 2)} m) is taller than the storey (${storeyHeight} m)` }
  const total = s.count * s.width_m
  if (total > L + 1e-9) return { why: `${s.count} windows ${round(s.width_m, 2)} m wide need ${round(total, 2)} m; this stretch is ${round(L, 2)} m` }
  const gap = (L - total) / (s.count + 1)
  const windows: PlacedWindow[] = []
  for (let i = 0; i < s.count; i++) {
    windows.push({ set: `${id}${i + 1}`, wall: span.run, offset_m: span.t0 + gap + i * (s.width_m + gap), width_m: s.width_m, height_m: s.height_m, sill_m: s.sill_m, shading_m: s.shading_m ?? 0, door: false })
  }
  return { windows, gap_m: gap }
}

/** Every window, checked: on a wall that exists, inside its length, within the storey. */
export function allWindows(plan: Plan): { windows: PlacedWindow[]; problems: Array<{ set: string; why: string }> } {
  const runs = wallRuns(plan.blocks)
  const windows: PlacedWindow[] = []
  const problems: Array<{ set: string; why: string }> = []
  for (const w of plan.windows) {
    const run = runs[w.wall]
    if (!run) problems.push({ set: w.id, why: 'Its wall is gone' })
    else if (w.t_m < -1e-6 || w.t_m + w.width_m > run.length_m + 1e-6) problems.push({ set: w.id, why: 'It runs off the end of its wall' })
    else if (w.sill_m + w.height_m > plan.storey_height_m + 1e-9) problems.push({ set: w.id, why: 'It is taller than the storey' })
    else windows.push({ set: w.id, wall: w.wall, offset_m: w.t_m, width_m: w.width_m, height_m: w.height_m, sill_m: w.sill_m, shading_m: w.shading_m, door: !!w.door })
  }
  return { windows, problems }
}

/** A point `t` metres along a run. */
export const along = (run: WallRun, t: number): XY => {
  const f = run.length_m ? t / run.length_m : 0
  return [run.a[0] + (run.b[0] - run.a[0]) * f, run.a[1] + (run.b[1] - run.a[1]) * f]
}

// ─── Rooms (or any pieces of the floor) against the blocks' outside walls ──────────────────────────────────────────────────────────────────

const EPS = 0.05

/** Where `p` sits on a run: distance along it, or null if it is not on the run. */
export function onRun(run: WallRun, p: XY): number | null {
  const dx = run.b[0] - run.a[0]
  const dy = run.b[1] - run.a[1]
  const L = run.length_m
  if (L < 1e-9) return null
  const t = ((p[0] - run.a[0]) * dx + (p[1] - run.a[1]) * dy) / L
  const off = Math.abs((p[0] - run.a[0]) * dy - (p[1] - run.a[1]) * dx) / L
  if (off > EPS || t < -EPS || t > L + EPS) return null
  return Math.max(0, Math.min(L, t))
}

/** A piece's side lying on the footprint: which run, and the stretch [t0, t1] of it (t0 < t1). */
export type PieceWall = { piece: string; side: number; run: number; t0: number; t1: number; length_m: number; azimuth_deg: number }
/** A stretch two pieces share. */
export type PieceShare = { a: string; b: string; length_m: number }
export type Piece = { id: string; ring: XY[] }

export function edgesOf(blocks: readonly (readonly XY[])[], pieces: readonly Piece[]): { walls: PieceWall[]; shares: PieceShare[]; open: Array<{ piece: string; side: number; length_m: number }>; inner: Array<{ zone: string; a: XY; b: XY }> } {
  const runs = wallRuns(blocks)
  const walls: PieceWall[] = []
  const open: Array<{ piece: string; side: number; length_m: number }> = []
  const inner: Array<{ zone: string; a: XY; b: XY }> = []
  for (const z of pieces) {
    const r = ccw(z.ring)
    r.forEach((a, i) => {
      const b = r[(i + 1) % r.length] as XY
      const L = dist(a, b)
      if (L < 1e-6) return
      // The stretches of this side that lie on the outside wall are walls; what is left of it is inside (a side can
      // be both, when a corner in line with it was tidied away).
      const u: XY = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
      const at = (s: number): XY => [a[0] + u[0] * s, a[1] + u[1] * s]
      const onLine = (p: XY) => Math.abs((p[0] - a[0]) * u[1] - (p[1] - a[1]) * u[0]) < EPS
      const covered: Array<[number, number]> = []
      for (const run of runs) {
        if (!onLine(run.a) || !onLine(run.b)) continue
        const sa = (run.a[0] - a[0]) * u[0] + (run.a[1] - a[1]) * u[1]
        const sb = (run.b[0] - a[0]) * u[0] + (run.b[1] - a[1]) * u[1]
        const s0 = Math.max(0, Math.min(sa, sb))
        const s1 = Math.min(L, Math.max(sa, sb))
        if (s1 - s0 <= EPS) continue
        const ta = onRun(run, at(s0))!
        const tb = onRun(run, at(s1))!
        walls.push({ piece: z.id, side: i, run: run.index, t0: Math.min(ta, tb), t1: Math.max(ta, tb), length_m: s1 - s0, azimuth_deg: run.azimuth_deg })
        covered.push([s0, s1])
      }
      covered.sort((x, y) => x[0] - y[0])
      let s = 0
      for (const [c0, c1] of covered) {
        if (c0 - s > EPS) inner.push({ zone: z.id, a: at(s), b: at(c0) })
        s = Math.max(s, c1)
      }
      if (L - s > EPS) inner.push({ zone: z.id, a: at(s), b })
    })
  }
  // Shared stretches between zones: collinear overlap of their inner sides (a cut line, or part of one).
  const shares = new Map<string, PieceShare>()
  const covered = new Map<number, number>()
  for (let i = 0; i < inner.length; i++) {
    for (let j = i + 1; j < inner.length; j++) {
      const p = inner[i]!
      const q = inner[j]!
      if (p.zone === q.zone) continue
      const L = dist(p.a, p.b)
      const u: XY = [(p.b[0] - p.a[0]) / L, (p.b[1] - p.a[1]) / L]
      const offA = Math.abs((q.a[0] - p.a[0]) * u[1] - (q.a[1] - p.a[1]) * u[0])
      const offB = Math.abs((q.b[0] - p.a[0]) * u[1] - (q.b[1] - p.a[1]) * u[0])
      if (offA > EPS || offB > EPS) continue
      const s0 = (q.a[0] - p.a[0]) * u[0] + (q.a[1] - p.a[1]) * u[1]
      const s1 = (q.b[0] - p.a[0]) * u[0] + (q.b[1] - p.a[1]) * u[1]
      const ov = Math.min(L, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1))
      if (ov <= EPS) continue
      const [x, y] = p.zone < q.zone ? [p.zone, q.zone] : [q.zone, p.zone]
      const k = `${x}|${y}`
      const s = shares.get(k) ?? { a: x, b: y, length_m: 0 }
      s.length_m += ov
      shares.set(k, s)
      covered.set(i, (covered.get(i) ?? 0) + ov)
      covered.set(j, (covered.get(j) ?? 0) + ov)
    }
  }
  inner.forEach((s, i) => {
    const L = dist(s.a, s.b)
    const left = L - (covered.get(i) ?? 0)
    if (left > EPS) open.push({ piece: s.zone, side: i, length_m: left })
  })
  return { walls, shares: [...shares.values()], open, inner }
}

export const ringArea = (r: readonly XY[]) => area(r)
