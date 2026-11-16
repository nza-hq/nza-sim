/**
 * Brief 119 Part 4: the emitter panel with cooling units on Bridgewater's five storeys, through the product's seam as
 * the editor runs it (anchor EPW). Nine Stelrad Vita Compact K2 600 × 2000 mm radiators a storey (31.2 kW at ΔT 50,
 * picked from the catalogue, Part 3) on the heat pump at 50/40 °C, and cooling-only VRF indoor units: four of 3 kW on storeys 1 to 4, six of 4 kW on storey 5. Writes
 * docs/audit/119/04_panel_summary.json and a static page of the panel for the browser check.
 *
 * Run from frontend/:  npx vite-node ../scripts/119_panel.mts <page.html>
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
d.zones.forEach((z: any, i: number) => {
  z.emitters = [
    { id: `${z.id}_rads`, kind: 'radiator', count: 9, rated_output_w: 3465, radiant_fraction: 0.3, system_group_id: hp.id, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: 1.33, catalogue_ref: { catalogue: 'stelrad-vita-compact', item: '76602220' } },
    { id: `${z.id}_vrf`, kind: 'vrf_indoor', count: i === 4 ? 6 : 4, heats: false, cooling_output_w: i === 4 ? 4000 : 3000, rated_output_w: null, radiant_fraction: null, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null },
  ]
})
const r = simulate(d, { weather: { weather: w, file_name: fx.building_config.weather_file, station: 'Yeovilton', sha256: w.sha256, source: 'local' } as any })
if (!r.ok) throw new Error(JSON.stringify(r.missing))
const s = r.summary
writeFileSync(path.join(root, 'docs/audit/119/04_panel_summary.json'), JSON.stringify({
  source: 'scripts/119_panel.mts', cooling_kwh: +s.building.cooling_kwh.toFixed(0),
  cooling: s.emitters!.cooling.map((z) => ({ name: z.name, cap_w: z.cap_w, peak_w: +z.peak_w.toFixed(0), short_w: +z.shortfall_w.toFixed(0), hours_above: z.unmet_hours, max_c: +z.max_c.toFixed(2), hours_at_cap: z.hours_at_cap })),
  heating: s.emitters!.zones.map((z) => ({ name: z.name, cap_w: +z.cap_w.toFixed(0), peak_w: +z.peak_w.toFixed(0), needed_rated_w: z.needed_rated_w && +z.needed_rated_w.toFixed(0), catalogue: z.catalogue })),
}, null, 1) + '\n')
const css = ['frontend/src/design-system/tokens.css', 'frontend/src/sim2/run/run.css', 'frontend/src/sim2/run/emitters.css'].map((p) => read(p).toString()).join('\n')
const body = renderToStaticMarkup(createElement(EmitterSizing, { summary: s, whatIf: null, onWhatIf: () => {} }))
const out = process.argv[2]
if (out) writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"><style>${css} body{margin:0;background:#fff} .rp{position:static;max-height:none;overflow:visible;width:380px;margin:16px;padding:12px;border:1px solid #DCE2DF;border-radius:10px}</style></head><body><div class="rp"><div class="rp-head"><h2>Results</h2></div>${body}</div></body></html>`)
for (const z of s.emitters!.cooling) console.log(z.name, z.cap_w, Math.round(z.peak_w), z.unmet_hours, z.max_c.toFixed(2))
