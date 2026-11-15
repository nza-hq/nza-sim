/**
 * The Simulate v2 model document (Brief 102 Part 1): the one thing that crosses between any UI, the engine and
 * storage (CLAUDE.md rule 4, restated for v2).
 *
 * Shapes follow the design note's "Engine data contract" (Notion 418d645e-05cc-811e-ad6b-fa8846f12148, Rev A):
 * zones, surfaces, system groups, profiles, weather. Where today's single-zone engine reads a field the note's shape
 * does not name, the field is added to the nearest concept the note already has, and listed in
 * docs/audit/102/01_model_document.md "Fields added to the note's shapes", so the review can rule on each one.
 *
 * Strictness: every object is `.strict()` (an unknown key is an error, never silently stored and hashed). Numbers
 * must be finite. Enumerations are closed only where the engine's own vocabulary is closed and known; elsewhere a
 * string is accepted and the engine stays the judge, so a valid project is never refused by the schema.
 */
import { z } from 'zod'

const finite = z.number().finite()
const nonNeg = finite.nonnegative()
const id = z.string().min(1)

export const FACADES = ['north', 'east', 'south', 'west'] as const
export const Facade = z.enum(FACADES)

/** 24 hourly fractions. */
const Day24 = z.array(finite).length(24)

/** The nza-sim schedule shape (daily by day type, monthly, exceptions). */
export const Schedule = z
  .object({
    weekday: Day24,
    saturday: Day24,
    sunday: Day24,
    monthly_multipliers: z.array(finite).length(12).optional(),
    exceptions: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .strict()

/** A magnitude with its unit, as gains profiles carry them (`{ value, unit }`). */
const Magnitude = z.object({ value: finite, unit: z.string().min(1) }).strict()

// ─── Profiles ───────────────────────────────────────────────────────────────────────────────────

const ProfileBase = {
  id,
  label: z.string().optional(),
  schedule: Schedule.optional(),
}

export const OccupancyProfile = z
  .object({
    ...ProfileBase,
    kind: z.literal('occupancy'),
    occupancy_rate: finite.optional(),
    density: z.object({ value: finite, basis: z.string().min(1) }).strict(),
    sensible_w_per_person: finite.optional(),
    latent_w_per_person: finite.optional(),
  })
  .strict()

const GainProfileFields = {
  ...ProfileBase,
  area_share: finite.optional(),
  gain_fraction: finite.optional(),
  relationship_to_occupancy: z.string().optional(),
  /** Minutes lighting stays on after occupants leave. Set in the UI; today's engine does not read it (carried, not lost). */
  spill_minutes: nonNeg.optional(),
  magnitude: Magnitude.optional(),
  active: Magnitude.optional(),
  baseload: Magnitude.optional(),
  standby_factor: finite.optional(),
  daylight_factor: finite.optional(),
}
export const LightingProfile = z.object({ ...GainProfileFields, kind: z.literal('lighting') }).strict()
export const EquipmentProfile = z.object({ ...GainProfileFields, kind: z.literal('equipment') }).strict()
export const AuxiliaryProfile = z.object({ ...GainProfileFields, kind: z.literal('auxiliary') }).strict()

/** A named on/off (or fractional) schedule that systems and openings refer to by id (`control_schedule_ref`). */
export const ScheduleProfile = z
  .object({
    id,
    kind: z.literal('schedule'),
    label: z.string().optional(),
    day_types: z.object({ weekday: Day24, saturday: Day24, sunday: Day24 }).strict(),
  })
  .strict()

export const Profile = z.discriminatedUnion('kind', [
  OccupancyProfile,
  LightingProfile,
  EquipmentProfile,
  AuxiliaryProfile,
  ScheduleProfile,
])
export type Profile = z.infer<typeof Profile>

// ─── Library references ─────────────────────────────────────────────────────────────────────────

export const LibraryKind = z.enum(['construction', 'profile', 'system_template', 'age_band_default', 'weather'])

/**
 * A pinned library item. `version` is the sim.library_items version once the library lives in Postgres (Part 3);
 * null for an item read from today's SQLite library, which has no versions. `body_hash` is the sha256 of the
 * canonical JSON of the item as the engine received it, so the pin holds either way.
 */
export const LibraryRef = z
  .object({
    kind: LibraryKind,
    key: id,
    version: z.number().int().positive().nullable(),
    body_hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
export type LibraryRef = z.infer<typeof LibraryRef>

/** A surface's construction: a library key, plus the per-project overrides today's construction_choices carry. */
export const ConstructionRef = z
  .object({
    key: id,
    u_value_override: finite.nullable().optional(),
    g_value_override: finite.nullable().optional(),
  })
  .strict()

// ─── Surfaces ───────────────────────────────────────────────────────────────────────────────────

/** An opening in a wall surface: a permanent vent (always open) or an operable opening (controlled). */
export const Opening = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('permanent_vent'),
      area_m2: nonNeg,
      cd: finite.optional(),
      flow_mode: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('operable'),
      openable_fraction: nonNeg,
      cd: finite.optional(),
      flow_mode: z.string().optional(),
      control_ref: z.string().nullable().optional(),
    })
    .strict(),
])

export const Shading = z
  .object({
    overhang: z.object({ depth_m: nonNeg, offset_m: finite }).strict().optional(),
    fins: z.object({ left_depth_m: nonNeg, right_depth_m: nonNeg }).strict().optional(),
  })
  .strict()

export const SurfaceKind = z.enum(['wall', 'roof', 'ground', 'partition', 'floor', 'ceiling', 'glazing', 'internal_mass'])

/** Kinds that may join two zones (Brief 104 decision 2). */
export const INTERZONE_KINDS = ['partition', 'floor', 'ceiling'] as const
const isZoneId = (b: string) => b !== 'outside' && b !== 'ground'

/**
 * A surface. Its construction's layers run from the zone_b side (first, "outside") to the zone_a side (last, "inside").
 *
 * Schema 2.2 (Brief 104 decisions 2 and 3):
 * - **Interzone.** A `partition`, `floor` or `ceiling` whose zone_b is another zone is one surface with two inside
 *   faces: its last layer faces zone_a and its first faces zone_b. It is listed by both zones, and only by them.
 *   `kind` and `tilt_deg` are from zone_a's side. A `floor` is zone_a's floor and zone_b's ceiling (tilt 180). A
 *   `ceiling` is zone_a's ceiling and zone_b's floor (tilt 0).
 * - **Internal mass.** `internal_mass` has zone_b equal to zone_a, so both faces are in that zone. Its area is one
 *   face's area. `faces_up` says whether it lies flat with its zone_a face up, taking the sun's beam like a floor
 *   (tilt 180, its other face down), or stands upright (tilt 90).
 */
export const Surface = z
  .object({
    id,
    kind: SurfaceKind,
    zone_a: id,
    /** Another zone's id (interzone; zone_a itself for internal mass), or the outside, or the ground. */
    zone_b: z.union([z.literal('outside'), z.literal('ground'), id]),
    /** The compass label today's engine works by (north/east/south/west before orientation); null for roof and ground. */
    facade: Facade.nullable(),
    area_m2: nonNeg,
    /** True azimuth of the outward normal, degrees clockwise from north (facade base + building orientation). */
    azimuth_deg: finite.min(0).lt(360).nullable(),
    tilt_deg: finite.min(0).max(180),
    construction_ref: ConstructionRef,
    g_value: finite.nullable(),
    /** Glazing only: the window-to-wall ratio of its host wall (the note's "WWR per edge"). */
    wwr: finite.min(0).max(1).optional(),
    /** Glazing only: how many windows the WWR is split into across the facade, on each storey (as the 3D viewer draws them). */
    window_count: z.number().int().nonnegative().optional(),
    /** Glazing only. */
    shading: Shading.optional(),
    /** Walls carry the vents and openings in them. */
    openings: z.array(Opening),
    /**
     * Schema 2.1 (Brief 103 Part 2): outside-face short-wave absorptance, 0 to 1. Required on walls and roofs facing
     * outside; null on glazing, ground and internal surfaces. Today's engine hard-codes 0.6 (walls) and 0.7 (roofs).
     */
    solar_absorptance: finite.min(0).max(1).nullable(),
    /** Schema 2.1: outside-face long-wave emissivity, 0 to 1, on outside walls, roofs and glazing (ISO 52016-1 sky exchange); null otherwise. */
    thermal_emissivity: finite.min(0).max(1).nullable(),
    /** Schema 2.1: glazing only, the frame's share of the opening area, 0 to <1 (today's engine: 0.20); null otherwise. */
    frame_fraction: finite.min(0).lt(1).nullable(),
    /**
     * Schema 2.2 (Brief 104 Part 1b): inside-face short-wave absorptance, above 0 and at most 1, on every opaque
     * surface; null on glazing. Solar inside a zone goes to each face in proportion to area × this value; the rest is
     * reflected and spread again, and some leaves through the windows. Today's EnergyPlus path states none, so
     * EnergyPlus's default 0.7 applies; today's instant engine has no inside distribution (every face takes all).
     */
    inside_solar_absorptance: finite.gt(0).max(1).nullable(),
    /**
     * Schema 2.2: the other inside face's short-wave absorptance (zone_b's face of an interzone surface, the first-layer
     * face of internal mass); null on every other surface.
     */
    inside_solar_absorptance_b: finite.gt(0).max(1).nullable(),
    /** Schema 2.2: internal mass only. True: flat, zone_a face up (takes the beam). False: upright. Null otherwise. */
    faces_up: z.boolean().nullable(),
  })
  .strict()
export type Surface = z.infer<typeof Surface>

// ─── Zones ──────────────────────────────────────────────────────────────────────────────────────

/** Mechanical ventilation serving a zone. `legacy_v25` keeps the fields today's engine still falls back to. */
export const Ventilation = z
  .object({
    id,
    label: z.string().optional(),
    kind: z.enum(['mvhr', 'mev', 'natural', 'none']),
    enabled: z.boolean(),
    share_pct: finite.nullable().optional(),
    flow_rate: finite.nullable().optional(),
    flow_rate_basis: z.string().nullable().optional(),
    sfp_w_per_l_s: finite.nullable().optional(),
    recovery_sensible_pct: finite.nullable().optional(),
    recovery_latent_pct: finite.nullable().optional(),
    summer_bypass: z.boolean().nullable().optional(),
    defrost_penalty_kwh: finite.nullable().optional(),
    control_mechanism: z.string().nullable().optional(),
    control_schedule_ref: z.string().nullable().optional(),
    legacy_v25: z
      .object({
        name: z.string().optional(),
        library_id: z.string().optional(),
        enabled: z.boolean().optional(),
        hre_enabled: z.boolean().optional(),
        flow_l_s: finite.optional(),
        sfp_w_per_l_s: finite.optional(),
        hre: finite.optional(),
        hours: finite.optional(),
        schedule_ref: z.string().optional(),
        summer_bypass: z.boolean().optional(),
      })
      .strict()
      .nullable(),
  })
  .strict()

export const Zone = z
  .object({
    id,
    name: z.string(),
    /** Lowest storey the zone occupies (0 = ground). */
    floor: z.number().int(),
    /** How many storeys the zone spans: 1 for a drawn room group; the whole box for today's single-zone model. */
    storeys: z.number().int().positive(),
    /** Floor polygon in local metres, x east-ish along the north facade, y across; closed implicitly. */
    polygon: z.array(z.tuple([finite, finite])).min(3),
    /** Floor area over all storeys the zone spans. */
    area_m2: nonNeg,
    /** Storey height. */
    height_m: finite.positive(),
    use_type: z.string().min(1),
    /** Rooms in the zone (hotel bedrooms), for per-room occupancy. */
    rooms: z.number().int().nonnegative().nullable(),
    profile_refs: z
      .object({
        occupancy: id.nullable(),
        lighting: z.array(id),
        equipment: z.array(id),
        auxiliary: z.array(id),
      })
      .strict(),
    setpoints: z
      .object({
        heat_c: finite.nullable(),
        cool_c: finite.nullable(),
        setback_c: finite.nullable(),
        hours_ref: z.string().nullable(),
        /** Today's `control_strategy` ('active_setpoint' or free running). */
        control_strategy: z.string().nullable(),
      })
      .strict(),
    ventilation: z.array(Ventilation),
    infiltration_q50: finite.nullable(),
    /** The legacy direct air-change rate the engine still reads when q50 is absent. */
    infiltration_ach: finite.nullable(),
    /**
     * Schema 2.1 (Brief 103 Part 2): heat capacity of the zone's internal mass (furniture, partitions, contents) per
     * m² of floor, J/K·m². Today's engine hard-codes 250,000 (instantCalc.js internal_mass_J_per_K_per_m2).
     */
    internal_heat_capacity_j_per_k_m2: nonNeg,
    surfaces: z.array(id).min(1, 'a zone must have at least one surface'),
  })
  .strict()
export type Zone = z.infer<typeof Zone>

// ─── Systems ────────────────────────────────────────────────────────────────────────────────────

export const SERVICES = ['heating', 'cooling', 'dhw', 'lighting', 'small_power', 'auxiliary'] as const

/** One installed system serving a service over a set of zones, with its share of that service's demand. */
export const SystemGroup = z
  .object({
    id,
    service: z.enum(SERVICES),
    label: z.string().optional(),
    zones: z.array(id).min(1),
    enabled: z.boolean(),
    share_pct: finite,
    /** Fuel / energy source: gas, electricity, ambient_air, … */
    source: z.string().nullable(),
    /** SCOP / SEER / η as a number (heating, cooling, dhw); null for lighting, small power, auxiliary. */
    efficiency_metric: finite.nullable(),
    control_mechanism: z.string().nullable().optional(),
    control_schedule_ref: z.string().nullable().optional(),
    control_factor: finite.nullable().optional(),
    capacity_kw: finite.nullable().optional(),
    /** A library system template, when the system was chosen from one. */
    template_ref: z.string().nullable().optional(),
  })
  .strict()
export type SystemGroup = z.infer<typeof SystemGroup>

const SetpointService = z
  .object({ setpoint_mode: z.enum(['follow_comfort', 'custom']), setpoint_c: finite.nullable() })
  .strict()

/** Service-level fields (CLAUDE.md "Service-level vs system-level fields", Brief 42): one value per building. */
export const Services = z
  .object({
    heating: SetpointService,
    cooling: SetpointService,
    dhw: z
      .object({
        storage_setpoint_c: finite.nullable(),
        tap_outlet_temp_c: finite.nullable(),
        cold_supply_temp_c: finite.nullable(),
        demand_basis: z.string().nullable(),
        litres_per_person_per_day: finite.nullable(),
        litres_per_m2_per_day: finite.nullable(),
        load_shape: z.string().nullable(),
        /** DHW secondary-circulation pump, W. Moves the anchor (+2.2 EUI at 1,200 W); see the audit doc. */
        circulation_pump_w: finite.nullable(),
      })
      .strict(),
  })
  .strict()

// ─── Building, weather, document ────────────────────────────────────────────────────────────────

export const WeatherRef = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('epw'),
      station_id: z.string().nullable(),
      file_name: z.string().min(1),
      file_hash: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict(),
  z.object({ kind: z.literal('legacy'), id: z.string().min(1) }).strict(),
])
export type WeatherRef = z.infer<typeof WeatherRef>

export const Building = z
  .object({
    id,
    name: z.string(),
    decoded_building_key: z.string().nullable(),
    site: z
      .object({
        lat: finite.min(-90).max(90).nullable(),
        lon: finite.min(-180).max(180).nullable(),
        name: z.string().nullable(),
        exposure: z.string().nullable(),
        /**
         * Schema 2.1 (Brief 103 Part 2): the ground's boundary temperature. 'annual_mean_outdoor' is today's engine
         * (a constant equal to the EPW's annual mean dry bulb); ISO 13370 methods are later options.
         */
        ground: z.object({ method: z.literal('annual_mean_outdoor') }).strict(),
      })
      .strict(),
    /** The box's orientation: degrees the north facade is turned clockwise from true north. */
    orientation_deg: finite,
    /** A reported gross internal area that replaces the geometric one as the EUI denominator. */
    reported_floor_area_m2: finite.positive().nullable(),
    thermal_bridging: z
      .object({
        mode: z.string().nullable(),
        multiplier: finite.nullable(),
        alpha_pct: finite.nullable(),
      })
      .strict(),
    thermal_mass: z.object({ mode: z.string().nullable(), category: z.string().nullable() }).strict(),
    /** Building-wide opening defaults the engine still reads as fallbacks (retired by Brief 42; usually absent). */
    opening_defaults: z
      .object({ cd: finite.optional(), flow_mode: z.string().optional(), schedule: z.unknown().optional() })
      .strict(),
  })
  .strict()

export const SCHEMA_VERSION = '2.2' as const

export const ModelDocument = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    building: Building,
    zones: z.array(Zone).min(1),
    surfaces: z.array(Surface),
    system_groups: z.array(SystemGroup),
    services: Services,
    profiles: z.array(Profile),
    weather_ref: WeatherRef,
    library_refs: z.array(LibraryRef),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const zoneIds = new Set<string>()
    doc.zones.forEach((z0, i) => {
      if (zoneIds.has(z0.id)) ctx.addIssue({ code: 'custom', path: ['zones', i, 'id'], message: `zone id "${z0.id}" is used twice` })
      zoneIds.add(z0.id)
    })
    const surfaceIds = new Set<string>()
    doc.surfaces.forEach((s, i) => {
      if (surfaceIds.has(s.id)) ctx.addIssue({ code: 'custom', path: ['surfaces', i, 'id'], message: `surface id "${s.id}" is used twice` })
      surfaceIds.add(s.id)
      if (!zoneIds.has(s.zone_a)) {
        ctx.addIssue({ code: 'custom', path: ['surfaces', i, 'zone_a'], message: `surface "${s.id}" names zone "${s.zone_a}", which does not exist` })
      }
      const exteriorOpaque = (s.kind === 'wall' || s.kind === 'roof' || s.kind === 'floor') && s.zone_b === 'outside'
      if (exteriorOpaque && (s.solar_absorptance == null || s.thermal_emissivity == null)) {
        ctx.addIssue({ code: 'custom', path: ['surfaces', i], message: `surface "${s.id}" faces outside and needs solar_absorptance and thermal_emissivity` })
      }
      if (s.kind !== 'glazing' && s.inside_solar_absorptance == null) {
        ctx.addIssue({ code: 'custom', path: ['surfaces', i, 'inside_solar_absorptance'], message: `opaque surface "${s.id}" needs inside_solar_absorptance` })
      }
      if (s.kind === 'glazing' && s.inside_solar_absorptance != null) {
        ctx.addIssue({ code: 'custom', path: ['surfaces', i, 'inside_solar_absorptance'], message: `glazing "${s.id}" takes its inside optics from its U and g, not inside_solar_absorptance` })
      }
      if (s.kind === 'glazing' && (s.frame_fraction == null || s.thermal_emissivity == null)) {
        ctx.addIssue({ code: 'custom', path: ['surfaces', i], message: `glazing "${s.id}" needs frame_fraction and thermal_emissivity` })
      }
      s.openings.forEach((o, j) => {
        if (o.kind === 'permanent_vent' && (o.cd == null || o.flow_mode == null)) {
          ctx.addIssue({ code: 'custom', path: ['surfaces', i, 'openings', j], message: `permanent vent on "${s.id}" needs cd and flow_mode` })
        }
      })
      if (isZoneId(s.zone_b) && !zoneIds.has(s.zone_b)) {
        ctx.addIssue({ code: 'custom', path: ['surfaces', i, 'zone_b'], message: `surface "${s.id}" names zone "${s.zone_b}", which does not exist` })
      }
      // Schema 2.2: interzone surfaces and internal mass.
      const issue = (message: string, at: (string | number)[] = []) => ctx.addIssue({ code: 'custom', path: ['surfaces', i, ...at], message })
      const internalMass = s.kind === 'internal_mass'
      const interzone = !internalMass && isZoneId(s.zone_b)
      if (internalMass && s.zone_b !== s.zone_a) issue(`internal mass "${s.id}" must have zone_b equal to zone_a`, ['zone_b'])
      if (interzone) {
        if (!(INTERZONE_KINDS as readonly string[]).includes(s.kind)) issue(`a ${s.kind} cannot join two zones ("${s.id}"): only ${INTERZONE_KINDS.join(', ')}`, ['kind'])
        if (s.zone_b === s.zone_a) issue(`surface "${s.id}" joins zone "${s.zone_a}" to itself: use internal_mass`, ['zone_b'])
        if (s.kind === 'floor' && s.tilt_deg !== 180) issue(`interzone floor "${s.id}" must have tilt 180 from zone_a's side`, ['tilt_deg'])
        if (s.kind === 'ceiling' && s.tilt_deg !== 0) issue(`interzone ceiling "${s.id}" must have tilt 0 from zone_a's side`, ['tilt_deg'])
      }
      if (internalMass && s.faces_up == null) issue(`internal mass "${s.id}" needs faces_up`, ['faces_up'])
      if (internalMass && s.faces_up != null && s.tilt_deg !== (s.faces_up ? 180 : 90)) issue(`internal mass "${s.id}" with faces_up ${s.faces_up} must have tilt ${s.faces_up ? 180 : 90}`, ['tilt_deg'])
      if (!internalMass && s.faces_up != null) issue(`faces_up is for internal mass only ("${s.id}")`, ['faces_up'])
      if (interzone || internalMass) {
        if (s.solar_absorptance != null || s.thermal_emissivity != null || s.frame_fraction != null || s.g_value != null || s.azimuth_deg != null || s.facade != null) {
          issue(`surface "${s.id}" has no outside face: solar_absorptance, thermal_emissivity, frame_fraction, g_value, azimuth_deg and facade must be null`)
        }
        if (s.openings.length) issue(`surface "${s.id}" has no outside face to carry openings`, ['openings'])
        if (s.inside_solar_absorptance_b == null) issue(`surface "${s.id}" has two inside faces and needs inside_solar_absorptance_b`, ['inside_solar_absorptance_b'])
      } else if (s.inside_solar_absorptance_b != null) {
        issue(`surface "${s.id}" has one inside face: inside_solar_absorptance_b must be null`, ['inside_solar_absorptance_b'])
      }
    })
    // Every surface is listed by its zone_a and, when interzone, by its zone_b; by no other zone, and once.
    const listedBy = new Map<string, string[]>()
    doc.zones.forEach((z0, i) => {
      const seen = new Set<string>()
      z0.surfaces.forEach((sid, j) => {
        if (!surfaceIds.has(sid)) ctx.addIssue({ code: 'custom', path: ['zones', i, 'surfaces', j], message: `zone "${z0.id}" lists surface "${sid}", which does not exist` })
        if (seen.has(sid)) ctx.addIssue({ code: 'custom', path: ['zones', i, 'surfaces', j], message: `zone "${z0.id}" lists surface "${sid}" twice` })
        seen.add(sid)
        listedBy.set(sid, [...(listedBy.get(sid) ?? []), z0.id])
      })
    })
    doc.surfaces.forEach((s, i) => {
      const want = new Set([s.zone_a, ...(isZoneId(s.zone_b) ? [s.zone_b] : [])])
      const got = listedBy.get(s.id) ?? []
      for (const zid of want) {
        if (zoneIds.has(zid) && !got.includes(zid)) ctx.addIssue({ code: 'custom', path: ['surfaces', i], message: `surface "${s.id}" is not listed by its zone "${zid}"` })
      }
      for (const zid of got) {
        if (!want.has(zid)) ctx.addIssue({ code: 'custom', path: ['surfaces', i], message: `surface "${s.id}" is listed by zone "${zid}", which it does not face` })
      }
    })
    doc.system_groups.forEach((g, i) => {
      g.zones.forEach((zid, j) => {
        if (!zoneIds.has(zid)) ctx.addIssue({ code: 'custom', path: ['system_groups', i, 'zones', j], message: `system group "${g.id}" serves zone "${zid}", which does not exist` })
      })
    })
    const profileIds = new Set(doc.profiles.map((p) => p.id))
    doc.zones.forEach((z0, i) => {
      const refs = [z0.profile_refs.occupancy, ...z0.profile_refs.lighting, ...z0.profile_refs.equipment, ...z0.profile_refs.auxiliary]
      refs.forEach((r) => {
        if (r != null && !profileIds.has(r)) ctx.addIssue({ code: 'custom', path: ['zones', i, 'profile_refs'], message: `zone "${z0.id}" refers to profile "${r}", which does not exist` })
      })
    })
  })
export type ModelDocument = z.infer<typeof ModelDocument>
