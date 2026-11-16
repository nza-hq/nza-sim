/**
 * Brief 117 Part 2: the engine's design heat loss for the referee's two buildings.
 *
 * (a) The cooled room (validation/energyplus/104_cooled_room_spec.json, Denver): west and east heated at 20 °C, the
 *     middle room unheated at a stated 12 °C. (b) Bridgewater as five storeys (the anchor fixture, per-storey converter,
 *     Yeovilton), every storey at its heating setpoint. Both at the weather file's 99.6 % design temperature, with no
 *     warm-up allowance, permanent vents at 4 m/s. Writes docs/audit/117/02_engine_design.json, which the EnergyPlus referee reads for its
 *     conditions (outdoor and ground temperatures, each room's temperature and air change).
 *
 * Run from frontend/:  npx vite-node ../scripts/117_design.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import { parseEpw } from '../frontend/src/thermal/engine/index'
import { REFEREE_OPTIONS, runModel } from '../frontend/src/thermal/engine/model'
import { designHeatLoss, type DesignHeatLoss } from '../frontend/src/thermal/engine/designHeatLoss'
import { cooledRoomDocument } from '../frontend/src/thermal/engine/__tests__/cooledRoom'
import { MOS, readMos } from '../frontend/src/thermal/engine/__tests__/denver'
import { CONSTRUCTIONS } from '../frontend/src/sim2/run/library'
import { simulate } from '../frontend/src/sim2/run/seam'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
// The vents' design wind speed is a referee input, not a product default: EnergyPlus's weather holds the same speed.
const DESIGN = { outdoor: { from_weather: 'heating_99_6' }, warm_up_w_per_m2: null, vent_wind_m_s: 4 }

function report(r: DesignHeatLoss) {
  return {
    outdoor_c: r.outdoor_c, outdoor_source: r.outdoor_source, ground_c: r.ground_c, building_w: r.building_w,
    zones: r.zones.map((z) => {
      const by: Record<string, number> = {}
      for (const l of z.lines) by[l.term] = (by[l.term] ?? 0) + l.w
      return { zone_id: z.zone_id, heated: z.heated, internal_c: z.internal_c, ach: z.ach, total_w: z.total_w, terms_w: by,
        lines: z.lines.map((l) => ({ ...l, w: +l.w.toFixed(3) })) }
    }),
  }
}

// (a) The cooled room.
const c = cooledRoomDocument()
const cd: any = structuredClone(c.doc)
cd.building.design = DESIGN
for (const z of cd.zones) z.design_internal_c = z.setpoints.heat_c == null ? 12 : 'follow_heat_c'
const cdoc = ModelDocument.parse(cd)
const W = readMos(readFileSync(MOS))
const cooled = report(designHeatLoss(cdoc, runModel(cdoc, W, c.lib, REFEREE_OPTIONS).zones, W))

// (b) Bridgewater, five storeys, through the product's seam.
const fx = parse(read('validation/fixtures/bridgewater_anchor_v2.yaml').toString())
const w = await parseEpw(new Uint8Array(read(path.join('data/weather/current', fx.building_config.weather_file))))
const d: any = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: 'x', file_hash: null }, building_id: 'b',
}, { zoning: 'per_storey' })).document
for (const r of d.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((x) => x.key === r.key)!.body_hash
d.building.design = DESIGN
for (const z of d.zones) z.design_internal_c = 'follow_heat_c'
const s = simulate(d, { weather: { weather: w, file_name: fx.building_config.weather_file, station: 'Yeovilton', sha256: w.sha256, source: 'local' } as any })
if (!s.ok) throw new Error(JSON.stringify(s.missing))
const bw = report(designHeatLoss(ModelDocument.parse(d), s.results.zones, w))

writeFileSync(path.join(root, 'docs/audit/117/02_engine_design.json'), JSON.stringify({ source: 'scripts/117_design.mts', cooled_room: cooled, bridgewater: bw }, null, 1) + '\n')
for (const [n, r] of [['cooled room', cooled], ['bridgewater', bw]] as const) {
  console.log(n, 'outdoor', r.outdoor_c, 'ground', r.ground_c.toFixed(3), 'building', r.building_w.toFixed(0))
  for (const z of r.zones) console.log(' ', z.zone_id, z.internal_c, 'ach', z.ach.toFixed(3), 'total', z.total_w.toFixed(0), JSON.stringify(Object.fromEntries(Object.entries(z.terms_w).map(([k, v]) => [k, Math.round(v)]))))
}
