/**
 * Brief 108 Part 4: sizing on Bridgewater (five storeys, anchor weather), Linzie's case.
 *
 * Each storey is given radiators sized for a boiler at 70/60 °C (rated at EN 442's 75/65/20 to give exactly the
 * storey's peak at 70/60), then the air source heat pump is run at 50/40 °C, with 70/60 as the what-if. Reports, per
 * storey, the peak (emitters unlimited), the radiators' output at each pair, the shortfall, unmet hours, the lowest
 * temperature and the rating needed at 50/40. Then states that rating and checks no hours go unmet.
 *
 *   cd frontend && npx vite-node ../scripts/108_sizing.mts      → docs/audit/108/04_sizing.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { EN442_STANDARD, logMeanDeltaT } from '../frontend/src/thermal/engine/emitters'
import { CONSTRUCTIONS } from '../frontend/src/sim2/run/library'
import { RUN_OPTIONS, simulate } from '../frontend/src/sim2/run/seam'
import { weatherFromBytes } from '../frontend/src/sim2/run/weather'

const root = path.resolve(__dirname, '..')
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const file = fx.building_config.weather_file
const weather = await weatherFromBytes(new Uint8Array(readFileSync(path.join(root, 'data/weather/current', file))), file, 'local')
if (weather.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')

const N = 1.3
const factor = (flow: number, ret: number, room: number) => Math.pow(logMeanDeltaT(flow, ret, room) / logMeanDeltaT(EN442_STANDARD.flow_c, EN442_STANDARD.return_c, EN442_STANDARD.room_c), N)
async function doc(rated: (zi: number) => number) {
  const d: any = (await fromBuildingConfig({
    building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
    library_constructions: fx.library_constructions, weather: { file_name: file, file_hash: EPW_SHA }, building_id: 'bridgewater-anchor',
  }, { zoning: 'per_storey' })).document
  for (const r of d.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash
  const hp = d.system_groups.find((g: any) => g.service === 'heating' && g.source === 'ambient_air')
  hp.design_flow_c = 50; hp.design_return_c = 40
  d.zones.forEach((z: any, zi: number) => {
    z.emitters = [{ id: `${z.id}_rads`, kind: 'radiator', count: 1, rated_output_w: rated(zi), radiant_fraction: 0.3, system_group_id: hp.id, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: N }]
  })
  return d
}
const run = (d: any, what_if?: { design_flow_c: number; design_return_c: number }, options = RUN_OPTIONS) => {
  const r = simulate(d, { weather, what_if, options })
  if (!r.ok) throw new Error(JSON.stringify(r.missing))
  return r.summary
}

// 1. The peaks (they do not depend on the rating), then radiators sized for 70/60.
const peaks = run(await doc(() => 1)).emitters!.zones.map((z) => z.peak_w)
const room = 21
const rated = peaks.map((p) => p / factor(70, 60, room))
// 2. The heat pump at 50/40, and the same rooms at 70/60.
const s = run(await doc((zi) => rated[zi]), { design_flow_c: 70, design_return_c: 60 })
const wi = s.emitters!.what_if!
if (!wi.ok) throw new Error(JSON.stringify(wi.missing))
if (!s.energy.ok || !wi.energy.ok) throw new Error('energy missing')
// Review F1: the same at 50/40 with the radiators rated with the room at its setpoint all year (LimitCapacity's form),
// to show how much the hourly rating moves.
const fixed = run(await doc((zi) => rated[zi]), undefined, { ...RUN_OPTIONS, emitter_rating: 'setpoint' }).emitters!.zones
const zones = s.emitters!.zones.map((z, i) => ({
  zone: z.name, peak_w: z.peak_w, rated_now_w: z.rated_now_w,
  at_50_40: { output_w: z.cap_w, shortfall_w: z.shortfall_w, unmet_hours: z.unmet_hours, min_c: z.min_c, hours_at_cap: z.hours_at_cap, needed_rated_w: z.needed_rated_w },
  at_50_40_rated_at_setpoint: { unmet_hours: fixed[i].unmet_hours, min_c: fixed[i].min_c },
  at_70_60: { output_w: wi.zones[i].cap_w, shortfall_w: wi.zones[i].shortfall_w, unmet_hours: wi.zones[i].unmet_hours, min_c: wi.zones[i].min_c, hours_at_cap: wi.zones[i].hours_at_cap, needed_rated_w: wi.zones[i].needed_rated_w },
}))
// 3. The rating needed at 50/40, stated: no unmet hours.
const need = s.emitters!.zones.map((z) => z.needed_rated_w! * (1 + 1e-9))
const v = run(await doc((zi) => need[zi]))
const verify = v.emitters!.zones.map((z) => ({ zone: z.name, rated_w: z.rated_now_w, unmet_hours: z.unmet_hours, shortfall_w: z.shortfall_w }))
if (verify.some((z) => z.unmet_hours !== 0)) throw new Error(`stated rating left unmet hours: ${JSON.stringify(verify)}`)

const out = {
  brief: '108 P4', weather: { file, sha256: weather.sha256 }, radiators: { exponent_n: N, radiant_fraction: 0.3, sized_for: '70/60 °C, room 21 °C' },
  zones,
  building: {
    at_50_40_rated_at_setpoint: { unmet_hours: zones.reduce((a, z) => a + z.at_50_40_rated_at_setpoint.unmet_hours!, 0) },
    at_50_40: { heating_kwh: s.building.heating_kwh, unmet_hours: zones.reduce((a, z) => a + z.at_50_40.unmet_hours!, 0), energy_kwh: s.energy.total_kwh, eui_kwh_per_m2: s.energy.eui_kwh_per_m2 },
    at_70_60: { heating_kwh: wi.heating_kwh, unmet_hours: zones.reduce((a, z) => a + z.at_70_60.unmet_hours!, 0), energy_kwh: wi.energy.total_kwh, eui_kwh_per_m2: wi.energy.eui_kwh_per_m2 },
  },
  verify_needed_rating_at_50_40: verify,
}
writeFileSync(path.join(root, 'docs/audit/108/04_sizing.json'), JSON.stringify(out, null, 2) + '\n')
console.log(JSON.stringify(out, null, 2))
