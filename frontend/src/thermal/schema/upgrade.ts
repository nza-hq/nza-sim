/**
 * Schema upgrades for stored model documents (Brief 103 Part 2).
 *
 * 2.0 → 2.1 adds the inputs Engine 1 needs that today's engine hard-codes, written into the document so they are
 * stated rather than hidden (Part 0 §5): outside solar absorptance and emissivity on outside walls and roofs, the
 * glazing frame fraction, the zone's internal heat capacity, and the ground boundary method. A 2.0 document upgrades by
 * filling today's values, so the upgraded document says exactly what today's engine assumed. The model hash changes,
 * as it must: it is a different document.
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
} as const

type Obj = Record<string, any>

/** Returns a current-schema document from any supported stored version, or throws naming the version. */
export function upgradeDocument(input: unknown): ModelDocument {
  const doc = structuredClone(input) as Obj
  const from = doc?.schema_version
  if (from === SCHEMA_VERSION) return ModelDocument.parse(doc)
  if (from !== '2.0') throw new Error(`cannot upgrade a model document of schema version ${JSON.stringify(from)}`)
  for (const s of doc.surfaces as Obj[]) {
    const exteriorOpaque = (s.kind === 'wall' || s.kind === 'roof') && s.zone_b === 'outside'
    s.solar_absorptance = exteriorOpaque ? (s.kind === 'roof' ? TODAY.roof_solar_absorptance : TODAY.wall_solar_absorptance) : null
    s.thermal_emissivity = exteriorOpaque ? TODAY.outside_emissivity : null
    s.frame_fraction = s.kind === 'glazing' ? TODAY.frame_fraction : null
  }
  for (const z of doc.zones as Obj[]) z.internal_heat_capacity_j_per_k_m2 = TODAY.internal_heat_capacity_j_per_k_m2
  doc.building.site.ground = { method: 'annual_mean_outdoor' }
  doc.schema_version = SCHEMA_VERSION
  return ModelDocument.parse(doc)
}
