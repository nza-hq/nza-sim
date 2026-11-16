/**
 * Brief 109 Part 4 (redone for the review, 06_review_response.md): the heating hours panel on Bridgewater's five
 * storeys, office hours with a 16 °C setback, storeys 4 and 5 limited to 40 kW each (electric, all convective).
 * Runs the product's seam as the editor does (anchor EPW), writes the summary's hours and emitter lines to
 * docs/audit/109/04_panel_summary.json, and a static page of the panel (open and closed ⓘ) for the browser check.
 *
 * Run from frontend/:  npx vite-node ../scripts/109_panel.mts <page.html>
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
import { HeatingHours } from '../frontend/src/sim2/run/HeatingHours'

const root = path.resolve(__dirname, '..')
const read = (p: string) => readFileSync(path.join(root, p))
const fx = parse(read('validation/fixtures/bridgewater_anchor_v2.yaml').toString())
const w = await parseEpw(new Uint8Array(read(path.join('data/weather/current', fx.building_config.weather_file))))
const SB = JSON.parse(read('validation/energyplus/109_setback_spec.json').toString())
const d: any = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: 'x', file_hash: null }, building_id: 'b',
}, { zoning: 'per_storey' })).document
for (const r of d.library_refs) if (r.kind === 'construction') r.body_hash = CONSTRUCTIONS.find((c) => c.key === r.key)!.body_hash
d.profiles.push({ id: 'hours', kind: 'schedule', day_types: SB.hours })
for (const z of d.zones) { z.setpoints.hours_ref = 'hours'; z.setpoints.setback_c = 16 }
for (const z of d.zones.slice(3)) z.emitters = [{ id: `${z.id}_e`, kind: 'electric', count: 1, rated_output_w: 40000, radiant_fraction: 0, system_group_id: null, rated_flow_c: null, rated_return_c: null, rated_room_c: null, exponent_n: null }]
const r = simulate(d, { weather: { weather: w, file_name: fx.building_config.weather_file, station: 'Yeovilton', sha256: w.sha256, source: 'local' } as any })
if (!r.ok) throw new Error(JSON.stringify(r.missing))
const s = r.summary
writeFileSync(path.join(root, 'docs/audit/109/04_panel_summary.json'), JSON.stringify({
  source: 'scripts/109_panel.mts', steps_per_hour: s.steps_per_hour,
  zones: s.zones.map((z) => ({ name: z.name, hours: z.hours })),
  emitters: s.emitters?.zones.map((z) => ({ name: z.name, peak_w: +z.peak_w.toFixed(0), cap_w: z.cap_w, unmet_in_use_hours: z.unmet_hours, min_in_use_c: +z.min_c.toFixed(2), in_use: z.in_use })),
}, null, 1) + '\n')
const css = ['frontend/src/design-system/tokens.css', 'frontend/src/sim2/run/run.css', 'frontend/src/sim2/run/emitters.css'].map((p) => read(p).toString()).join('\n')
const closed = renderToStaticMarkup(createElement(HeatingHours, { summary: s }))
const out = process.argv[2]
if (out) writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="rp"><div class="rp-head"><h2>Results</h2></div>${closed}</div></body></html>`)
for (const z of s.zones) console.log(z.name, JSON.stringify(z.hours))
for (const z of s.emitters?.zones ?? []) console.log('sized', z.name, (z.peak_w / 1000).toFixed(1), 'kW; in use below', z.unmet_hours, 'lowest', z.min_c.toFixed(2))
