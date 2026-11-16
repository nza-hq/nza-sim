/**
 * Brief 117 Part 3: the design heat loss and the emitters' design view on Bridgewater's five storeys, through the
 * product's seam as the editor runs it (anchor EPW). Radiators of 30 kW each at 75/65/20 °C on the heat pump at
 * 50/40 °C, compared at 70/60 °C; design at the weather file's 99.6 %, no warm-up allowance, vents at 4 m/s. Writes
 * docs/audit/117/03_panel_summary.json and a static page of the two panels for the browser check.
 *
 * Run from frontend/:  npx vite-node ../scripts/117_panel.mts <page.html>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { parseEpw } from '../frontend/src/thermal/engine/index'
import { simulate } from '../frontend/src/sim2/run/seam'
import { CONSTRUCTIONS } from '../frontend/src/sim2/run/library'
import { DesignHeatLoss } from '../frontend/src/sim2/run/DesignHeatLoss'
import { EmitterSizing } from '../frontend/src/sim2/run/EmitterSizing'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
const fx = parse(read('validation/fixtures/bridgewater_anchor_v2.yaml').toString())
const w = await parseEpw(new Uint8Array(read(path.join('data/weather/current', fx.building_config.weather_file))))
const d: any = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: 'x', file_hash: null }, building_id: 'b',
}, { zoning: 'per_storey' })).document
for (const r of d.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash
const hp = d.system_groups.find((g: any) => g.service === 'heating' && g.source === 'ambient_air')
hp.design_flow_c = 50; hp.design_return_c = 40
for (const z of d.zones) {
  z.emitters = [{ id: `${z.id}_rads`, kind: 'radiator', count: 1, rated_output_w: 30000, radiant_fraction: 0.3, system_group_id: hp.id, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.3 }]
  z.design_internal_c = 'follow_heat_c'
}
d.building.design = { outdoor: { from_weather: 'heating_99_6' }, warm_up_w_per_m2: null, vent_wind_m_s: 4 }
const whatIf = { design_flow_c: 70, design_return_c: 60 }
const r = simulate(d, { weather: { weather: w, file_name: fx.building_config.weather_file, station: 'Yeovilton', sha256: w.sha256, source: 'local' } as any, what_if: whatIf })
if (!r.ok) throw new Error(JSON.stringify(r.missing))
const s = r.summary
const dh = s.design_heat_loss
if (!dh?.ok) throw new Error(JSON.stringify(dh))
writeFileSync(path.join(root, 'docs/audit/117/03_panel_summary.json'), JSON.stringify({
  source: 'scripts/117_panel.mts', outdoor_c: dh.outdoor_c, building_w: +dh.building_w.toFixed(0),
  zones: dh.zones.map((z) => ({ name: z.name, total_w: +z.total_w.toFixed(0), w_per_m2: +z.w_per_m2.toFixed(1), cap_50_40_w: +z.emitters!.cap_w.toFixed(0), short_50_40_w: +z.emitters!.shortfall_w.toFixed(0), needed_rated_w: +z.emitters!.needed_rated_w!.toFixed(0), cap_70_60_w: +z.what_if_emitters!.cap_w.toFixed(0), short_70_60_w: +z.what_if_emitters!.shortfall_w.toFixed(0) })),
  year_round_peak_w: s.emitters!.zones.map((z) => +z.peak_w.toFixed(0)),
}, null, 1) + '\n')
const css = ['frontend/src/design-system/tokens.css', 'frontend/src/sim2/run/run.css', 'frontend/src/sim2/run/emitters.css'].map((p) => read(p).toString()).join('\n')
const body = renderToStaticMarkup(createElement(DesignHeatLoss, { summary: s })) + renderToStaticMarkup(createElement(EmitterSizing, { summary: s, whatIf, onWhatIf: () => {} }))
const out = process.argv[2]
if (out) writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"><style>${css} body{margin:0;background:#fff} .rp{position:static;max-height:none;overflow:visible;width:380px;margin:16px;padding:12px;border:1px solid #DCE2DF;border-radius:10px}</style></head><body><div class="rp"><div class="rp-head"><h2>Results</h2></div>${body}</div></body></html>`)
console.log('building', (dh.building_w / 1000).toFixed(1), 'kW at', dh.outdoor_c)
for (const z of dh.zones) console.log(z.name, (z.total_w / 1000).toFixed(1), 'kW; 50/40 gives', (z.emitters!.cap_w / 1000).toFixed(1), '; 70/60 gives', (z.what_if_emitters!.cap_w / 1000).toFixed(1))
