/**
 * Brief 112 Part 2: lighting from the light a space needs (lux, demand, on the space's lighting profile) and the
 * luminaires that deliver it (efficacy, W/m² per 100 lux, on the lighting system). Rule 11: this is the one place lux
 * becomes W/m². The W/m² is never stored on the document; the engine, the panel and the energy split read it from here
 * (`__tests__/lighting.test.ts` fails if any other file does the multiplication).
 */
import type { ModelDocument } from '../schema/model'

/** W/m² while lit: lux ÷ 100 × efficacy. */
export function lightingWm2(lux: number, efficacyWm2Per100lux: number): number {
  return (lux / 100) * efficacyWm2Per100lux
}

export type EfficacyAnswer = { ok: true; efficacy: number; group_ids: string[] } | { ok: false; path: string; message: string }

/**
 * The efficacy of the luminaires in zone `zi`: that of the enabled lighting systems serving it. None, or one without its
 * efficacy, is refused by name; two with different efficacies are refused too (each would light its own share at its
 * own W/m², which the gains do not yet split; Brief 112 P1).
 */
export function zoneEfficacy(doc: ModelDocument, zi: number): EfficacyAnswer {
  const zone = doc.zones[zi]
  const name = zone.name || zone.id
  const gs = doc.system_groups.map((g, i) => ({ g, i })).filter(({ g }) => g.enabled && g.service === 'lighting' && g.zones.includes(zone.id))
  if (gs.length === 0) return { ok: false, path: `zones[${zi}].profile_refs.lighting`, message: `lighting in ${name} is stated in lux, so it needs a lighting system with its efficacy (W/m² per 100 lux)` }
  for (const { g, i } of gs) {
    if (g.efficacy_w_m2_per_100lux == null) return { ok: false, path: `system_groups[${i}].efficacy_w_m2_per_100lux`, message: `required: lighting in ${name} is stated in lux, so its luminaires' efficacy (W/m² per 100 lux) is needed` }
  }
  const e = gs[0].g.efficacy_w_m2_per_100lux as number
  const other = gs.find(({ g }) => g.efficacy_w_m2_per_100lux !== e)
  if (other) return { ok: false, path: `system_groups[${other.i}].efficacy_w_m2_per_100lux`, message: `the lighting systems in ${name} have different efficacies (${e} and ${other.g.efficacy_w_m2_per_100lux} W/m² per 100 lux), which is not modelled yet: give ${name} one` }
  return { ok: true, efficacy: e, group_ids: gs.map(({ g }) => g.id) }
}
