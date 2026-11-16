/**
 * Schema upgrades for stored model documents (Brief 103 Part 2).
 *
 * 2.0 → 2.1 adds the inputs Engine 1 needs that today's engine hard-codes, written into the document so they are
 * stated rather than hidden (Part 0 §5): outside solar absorptance on outside walls and roofs, outside emissivity on those and on glazing, the
 * glazing frame fraction, the zone's internal heat capacity, the ground boundary method, and each permanent vent's cd
 * and flow mode (today resolved at run time from fallbacks). A 2.0 document upgrades by
 * filling today's values, so the upgraded document says exactly what today's engine assumed. The model hash changes,
 * as it must: it is a different document.
 *
 * 2.1 → 2.2 (Brief 104 Part 1b) adds each opaque surface's inside solar absorptance, filled with the value today's
 * EnergyPlus simulation path uses (it states none, so EnergyPlus's default applies). Today's instant engine has no
 * such input: it puts all transmitted solar into the zone, which is absorptance 1 with no window losses.
 * It also adds `inside_solar_absorptance_b` and `faces_up` (Brief 104 Part 2): null, except the second face of a
 * surface between two zones (which 2.1 allowed in the document but no engine ran), filled the same way.
 *
 * 2.2 → 2.3 (Brief 105 Part 1) states the internal-gain inputs today's engine falls back to when a profile leaves
 * them out (instantCalc.js computeHourlyGains and its helpers), and adds each gain profile's radiant fraction, filled
 * with the split today's engine applies to internal gains. Gains stay where 2.x already keeps them, on the document's
 * profiles referred to by each zone (CLAUDE.md Rule 11: one exposure); the zone's area and rooms scale the densities.
 *
 * 2.3 → 2.4 (Brief 108) adds each zone's emitters, empty: nothing is stated, so heating stays unlimited, as before. It
 * fills no value, so the run seam accepts a 2.3 document through it (unlike 2.2 and older, Brief 105 review F1).
 *
 * 2.4 → 2.5 (Brief 109) adds each emitter's source surface and layer, null. It fills nothing either, so the seam
 * accepts a 2.4 document the same way.
 *
 * 2.5 → 2.6 (Brief 117) adds the building's design conditions and each zone's design internal temperature, null: no
 * design heat loss is worked out until they are stated. Nothing is filled.
 *
 * 2.6 → 2.7 (Brief 119) adds each emitter's cooling output and catalogue reference, null, and `heats`, true: every
 * emitter before 2.7 heated (the meaning it had, not a value filled in). No zone's cooling is limited until stated.
 */
import { ModelDocument, SCHEMA_VERSION } from './model'

/** Today's engine constants, with where it holds them (frontend/src/utils/instantCalc.js, _calculateEnvelopeOnly). */
export const TODAY = {
  /** extWallModel solar_abs (instantCalc.js ~941). */
  wall_solar_absorptance: 0.6,
  /** roofModel solar_abs (~946). */
  roof_solar_absorptance: 0.7,
  /** Not in today's engine (its h_out of 25 W/m²K lumps convection and radiation); ISO 52016-1's default. */
  outside_emissivity: 0.9,
  /** FRAME_FRACTION (~927). */
  frame_fraction: 0.2,
  /** internal_mass_J_per_K_per_m2 default (~887). */
  internal_heat_capacity_j_per_k_m2: 250_000,
  /** resolveCd fallback (instantCalc.js 221). */
  vent_cd: 0.25,
  /** resolveFlowMode fallback (instantCalc.js 210). */
  vent_flow_mode: 'single_sided',
  /** ISO 14683 auto-mode multiplier when none is set (thermalBridges.js 182, `tb.multiplier ?? 1.0`). */
  bridging_multiplier: 1,
  /**
   * Inside-face solar absorptance of opaque surfaces: nza_engine/generators/epjson_assembler.py writes no
   * solar_absorptance on any inside layer, so EnergyPlus's Material default (0.7, Input Output Reference) applies.
   */
  inside_solar_absorptance: 0.7,
  /**
   * The construction between storeys: nza_engine/generators/epjson_assembler.py `_INTERIOR_CONSTRUCTION` ("Interior
   * floor/ceiling always uses the same library construction"). Read by the per-storey converter (Brief 104 Part 2).
   */
  interior_floor_construction: 'interior_floor_ceiling',
  /** computeHourlyGains: `occ.occupancy_rate ?? 0.75`. */
  occupancy_rate: 0.75,
  /** computeHourlyGains: `occ.sensible_w_per_person ?? 75`. */
  sensible_w_per_person: 75,
  /** `profile.area_share ?? 1.0` (lighting, equipment, auxiliary). */
  area_share: 1,
  /** `profile.gain_fraction ?? 1.0`: all the electricity becomes heat in the zone. */
  gain_fraction: 1,
  /** lightingFractionForHour: `relationship_to_occupancy ?? 'proportional_with_spill'` (auxiliary reuses it). */
  lighting_relationship: 'proportional_with_spill',
  /** equipmentFractionForHour: `relationship_to_occupancy ?? 'proportional'`. */
  equipment_relationship: 'proportional',
  /** lightingFractionForHour: `daylight_factor ?? 0.6`, read only for 'proportional_with_spill'. */
  daylight_factor: 0.6,
  /** equipmentFractionForHour: `standby_factor ?? 0.10`, read only when not 'independent'. */
  standby_factor: 0.1,
  /** TUNE_SOLAR_RAD_FRAC (instantCalc.js ~2606): "Internal gains use the same radiative/convective split as solar (30/70)". */
  gains_radiant_fraction: 0.3,
} as const

/**
 * Writes today's fallbacks into a gain profile wherever it leaves them out, so the document says what today's engine
 * assumed (used by the 2.2 → 2.3 upgrade and by the converter). Only the fields today's engine reads for that profile
 * are filled. A field a profile states is kept.
 */
export function stateTodaysGainInputs(p: Obj): void {
  if (p.kind === 'occupancy') {
    p.occupancy_rate ??= TODAY.occupancy_rate
    p.sensible_w_per_person ??= TODAY.sensible_w_per_person
  } else if (p.kind === 'lighting' || p.kind === 'auxiliary' || p.kind === 'equipment') {
    p.area_share ??= TODAY.area_share
    p.gain_fraction ??= TODAY.gain_fraction
    if (p.kind === 'equipment') {
      p.relationship_to_occupancy ??= TODAY.equipment_relationship
      if (p.relationship_to_occupancy !== 'independent') p.standby_factor ??= TODAY.standby_factor
    } else {
      p.relationship_to_occupancy ??= TODAY.lighting_relationship
      if (p.relationship_to_occupancy === 'proportional_with_spill') p.daylight_factor ??= TODAY.daylight_factor
    }
  } else return
  p.radiant_fraction ??= TODAY.gains_radiant_fraction
}

type Obj = Record<string, any>

/** Returns a current-schema document from any supported stored version, or throws naming the version. */
export function upgradeDocument(input: unknown): ModelDocument {
  const doc = structuredClone(input) as Obj
  const from = doc?.schema_version
  if (from === SCHEMA_VERSION) return ModelDocument.parse(doc)
  if (from !== '2.0' && from !== '2.1' && from !== '2.2' && from !== '2.3' && from !== '2.4' && from !== '2.5' && from !== '2.6' && from !== '2.7' && from !== '2.8' && from !== '2.9' && from !== '2.10') throw new Error(`cannot upgrade a model document of schema version ${JSON.stringify(from)}`)
  if (from === '2.0') to21(doc)
  if (from === '2.0' || from === '2.1') to22(doc)
  // Review F1 (Brief 112): from 2.3 on, a null gain input means "not stated" and stays null (the engine names it).
  if (from === '2.0' || from === '2.1' || from === '2.2') for (const p of doc.profiles as Obj[]) stateTodaysGainInputs(p)
  to24(doc)
  to25(doc)
  to26(doc)
  // As before 2.11 for every older version; a 2.10 document has had all three.
  const before210 = from !== '2.10'
  if (before210 && from !== '2.7') to27(doc)
  if (before210 && from !== '2.8') to28(doc)
  if (before210 && from !== '2.9') to29(doc)
  to210(doc)
  to211(doc)
  doc.schema_version = SCHEMA_VERSION
  return ModelDocument.parse(doc)
}

/**
 * 2.9 → 2.10 (Brief 114): no system states pumps, no fans state how they run (the schedule decides, as before), no
 * other loads and no control entries. Nothing is filled: an old auxiliary "Pumps" profile stays as it is, stated, so
 * the document runs as before.
 */
function to210(doc: Obj): void {
  for (const g of doc.system_groups as Obj[]) g.pumps ??= null
  for (const z of doc.zones as Obj[]) for (const v of z.ventilation as Obj[]) { v.runs ??= null; v.demand_min_fraction ??= null }
  doc.other_loads ??= []
  doc.controls ??= []
}

/**
 * 2.10 → 2.11 (Brief 115): air stays today's method (n50/20 leakage, wind-only vents), written explicitly, so every
 * older document, Bridgewater's included, gives exactly what it did. No terrain, no window temperatures.
 */
function to211(doc: Obj): void {
  doc.building.air ??= { method: 'today', exponent: null, single_sided_turbulence: null }
  doc.building.site.terrain ??= null
  for (const c of (doc.controls ?? []) as Obj[]) c.open_above_c ??= null
}

/** 2.8 → 2.9 (Brief 120): no heating system heats hot water first and no hot water store is stated. Capacities already stated now limit (Linzie's decision 3), a hot water system's included. */
function to29(doc: Obj): void {
  for (const g of doc.system_groups as Obj[]) { g.dhw_priority_group_id ??= null; g.storage_litres ??= null }
}

/**
 * 2.7 → 2.8 (Brief 112): hot water use moves from the building (`services.dhw`) to the occupancy profiles, the same
 * litres on every one, so every zone uses what it did. Lighting stays as stated W/m²; no lux and no efficacy is guessed.
 * A per-m² use on a building whose zones without occupancy would lose their hot water is refused, naming them.
 */
export function to28(doc: Obj): void {
  const d = doc.services?.dhw as Obj | undefined
  if (d) {
    const basis = d.demand_basis ?? null
    const litres = basis === 'per_person' ? d.litres_per_person_per_day : basis === 'per_m2' ? d.litres_per_m2_per_day : null
    if (basis != null && basis !== 'per_person' && basis !== 'per_m2') throw new Error(`services.dhw.demand_basis: unknown basis "${basis}" (per_person or per_m2)`)
    if (basis != null && litres != null) {
      if (basis === 'per_m2') {
        const bare = (doc.zones as Obj[]).filter((z) => z.profile_refs?.occupancy == null)
        if (bare.length) throw new Error(`hot water is ${litres} litres per m² a day, and ${bare.map((z) => z.name || z.id).join(', ')} has no occupancy to carry it: state hot water on its space`)
      }
      for (const p of doc.profiles as Obj[]) if (p.kind === 'occupancy') p.dhw = { basis, litres_per_day: litres }
    }
    delete d.demand_basis; delete d.litres_per_person_per_day; delete d.litres_per_m2_per_day
  }
  for (const p of doc.profiles as Obj[]) {
    if (p.kind === 'occupancy') p.dhw ??= null
    if (p.kind === 'lighting') p.lux ??= null
  }
  for (const g of doc.system_groups as Obj[]) g.efficacy_w_m2_per_100lux ??= null
}

/** 2.6 → 2.7 (Brief 119): no emitter cools or names a catalogue item; every emitter heats, as it did. Nothing is filled. */
function to27(doc: Obj): void {
  for (const z of doc.zones as Obj[]) for (const e of z.emitters as Obj[]) { e.heats ??= true; e.cooling_output_w ??= null; e.catalogue_ref ??= null }
}

/** 2.3 → 2.4 (Brief 108): no emitters stated, so no zone's heating is limited (as before). Nothing is filled. */
function to24(doc: Obj): void {
  for (const z of doc.zones as Obj[]) z.emitters ??= []
}

/**
 * 2.4 → 2.5 (Brief 109): every emitter states no source surface or layer. Nothing is filled: an underfloor emitter
 * from 2.4 is then refused by name until its floor and layer are stated.
 */
function to25(doc: Obj): void {
  for (const z of doc.zones as Obj[]) for (const e of z.emitters as Obj[]) { e.source_surface_id ??= null; e.source_layer_index ??= null }
}

function to22(doc: Obj): void {
  for (const s of doc.surfaces as Obj[]) {
    s.inside_solar_absorptance = s.kind === 'glazing' ? null : TODAY.inside_solar_absorptance
    const interzone = s.zone_b !== 'outside' && s.zone_b !== 'ground'
    s.inside_solar_absorptance_b = interzone ? TODAY.inside_solar_absorptance : null
    s.faces_up = null
  }
}

function to21(doc: Obj): void {
  for (const s of doc.surfaces as Obj[]) {
    const exteriorOpaque = (s.kind === 'wall' || s.kind === 'roof' || s.kind === 'floor') && s.zone_b === 'outside'
    s.solar_absorptance = exteriorOpaque ? (s.kind === 'roof' ? TODAY.roof_solar_absorptance : TODAY.wall_solar_absorptance) : null
    s.thermal_emissivity = exteriorOpaque || s.kind === 'glazing' ? TODAY.outside_emissivity : null
    s.frame_fraction = s.kind === 'glazing' ? TODAY.frame_fraction : null
    for (const o of s.openings as Obj[]) {
      if (o.kind !== 'permanent_vent') continue
      o.cd ??= doc.building.opening_defaults?.cd ?? TODAY.vent_cd
      o.flow_mode ??= doc.building.opening_defaults?.flow_mode ?? TODAY.vent_flow_mode
    }
  }
  const tb = doc.building.thermal_bridging
  if (tb?.mode === 'iso14683_auto' && tb.multiplier == null) tb.multiplier = TODAY.bridging_multiplier
  for (const z of doc.zones as Obj[]) z.internal_heat_capacity_j_per_k_m2 = TODAY.internal_heat_capacity_j_per_k_m2
  doc.building.site.ground = { method: 'annual_mean_outdoor' }
}

/** 2.5 → 2.6 (Brief 117): no design conditions and no design internal temperatures. Nothing is filled. */
function to26(doc: Obj): void {
  doc.building.design ??= null
  for (const z of doc.zones as Obj[]) z.design_internal_c ??= null
}
