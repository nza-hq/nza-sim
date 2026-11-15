/**
 * Brief 107 Part 0: what the converted Bridgewater document holds for systems (one zone and per storey).
 * Run from frontend/: node ../scripts/107_recon.mts   Prints JSON; writes nothing.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'

const root = path.resolve(import.meta.dirname, '..')
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const conv = async (zoning: 'single' | 'per_storey') => (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: '0'.repeat(64) },
  building_id: 'bridgewater-anchor',
}, zoning === 'single' ? {} : { zoning })).document as any

for (const zoning of ['single', 'per_storey'] as const) {
  const d = await conv(zoning)
  console.log(JSON.stringify({
    zoning,
    services: d.services,
    system_groups: d.system_groups.map((g: any) => ({ id: g.id, service: g.service, zones: g.zones.length, share: g.share_pct, src: g.source, eff: g.efficiency_metric, cf: g.control_factor, enabled: g.enabled })),
    ventilation: d.zones.map((z: any) => z.ventilation.map((v: any) => ({ id: v.id, kind: v.kind, flow: v.flow_rate, basis: v.flow_rate_basis, sfp: v.sfp_w_per_l_s, sched: v.control_schedule_ref, enabled: v.enabled }))),
    zones: d.zones.map((z: any) => ({ id: z.id, area: z.area_m2, rooms: z.rooms, refs: z.profile_refs })),
    occupancy_profiles: d.profiles.filter((p: any) => p.kind === 'occupancy').map((p: any) => { const { schedule, ...rest } = p; return rest }),
    aux_profiles: d.profiles.filter((p: any) => p.kind === 'auxiliary').map((p: any) => { const { schedule, ...rest } = p; return rest }),
  }, null, 1))
}
