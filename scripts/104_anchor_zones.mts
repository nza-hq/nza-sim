/**
 * Brief 104 Part 5: Bridgewater as five zones (Engine 2) against the five-zone EnergyPlus referee, per zone.
 *
 * Run from frontend/:  npx vite-node ../scripts/104_anchor_zones.mts
 * Needs the anchor EPW in data/weather/current (local data, checked by sha) and docs/audit/104/05_referee_zones.json
 * (validation/energyplus/104_zones_referee.py). Writes docs/audit/104/05_anchor_zones.json.
 *
 * Comparisons:
 * - gate: the per-storey document on REFEREE_OPTIONS against r2_z (the referee with the document's frame and internal
 *   capacity, each slab one construction seen from both sides, and bridging and infiltration allocated by zone as
 *   Engine 2 allocates them), ±10 % on the building totals, per zone and monthly reported;
 * - the one-zone document with the four slabs as internal mass against r2_one_zone;
 * - both against the referee with Engine 2's surface simplifications (…_e2like), to separate the solver from them;
 * - the earlier referees (r1, r1_tbz, r1_z), which show what each allocation and the slab fix moved.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import { ModelDocument } from '../frontend/src/thermal/schema/model'
import {
  parseEpw, readBuildingCoolingKwh, readBuildingHeatingKwh, REFEREE_OPTIONS, runModel, type ModelResults,
} from '../frontend/src/thermal/engine/index'

const root = path.resolve(__dirname, '..')
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const ref = JSON.parse(readFileSync(path.join(root, 'docs/audit/104/05_referee_zones.json'), 'utf8'))
const weather = await parseEpw(new Uint8Array(readFileSync(path.join(root, 'data/weather/current', fx.building_config.weather_file))))
if (weather.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const lib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((c: any) => [c.name, c.config_json]))
const H = weather.hours.count

const convert = async (zoning: 'single' | 'per_storey') => (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA },
  building_id: 'bridgewater-anchor',
}, { zoning })).document

const five = await convert('per_storey')
// One zone with the four slabs as internal mass: each lies flat with its zone_a face up. The schema runs layers from
// the zone_b face to the zone_a face, so the library's carpet-first order would put the carpet underneath; the slab
// is given here as its own reversed copy so the carpet faces up, as in the five-zone document and the referee.
const single: any = structuredClone(await convert('single'))
const slab = five.surfaces.find((s) => s.kind === 'ceiling')!
const key = `${slab.construction_ref.key}_up`
lib[key] = { ...lib[slab.construction_ref.key], name: key, layers: [...lib[slab.construction_ref.key].layers].reverse() }
const z1 = single.zones[0]
for (let i = 1; i < 5; i++) {
  const id = `slab_${i}`
  single.surfaces.push({ ...structuredClone(slab), id, kind: 'internal_mass', zone_a: z1.id, zone_b: z1.id, tilt_deg: 180, faces_up: true,
    construction_ref: { ...slab.construction_ref, key } })
  z1.surfaces.push(id)
}
const oneMass = ModelDocument.parse(single)

const monthly = (a: Float64Array) => {
  const m = new Array(12).fill(0)
  for (let h = 0; h < H; h++) m[weather.hours.month[h] - 1] += a[h] / 1e6
  return m.map((v) => +v.toFixed(4))
}
const zoneRows = (r: ModelResults) => Object.fromEntries(r.zones.map((z) => [z.zone_id, {
  heating_mwh: +(z.annual.heating_kwh / 1000).toFixed(4), cooling_mwh: +(z.annual.cooling_kwh / 1000).toFixed(4),
  heating_monthly_mwh: monthly(z.hourly.heating_w), cooling_monthly_mwh: monthly(z.hourly.cooling_w),
  interzone_mwh: +(z.breakdown.filter((l) => l.term === 'interzone').reduce((s, l) => s + l.kwh, 0) / 1000).toFixed(4),
  bridging_w_per_k: +z.conductances.bridging.total_w_per_k.toFixed(4), infiltration_ach: +z.conductances.infiltration.ach.toFixed(6),
}]))
const pct = (a: number, b: number) => +((a / b - 1) * 100).toFixed(1)

const e5 = runModel(five, weather, lib, REFEREE_OPTIONS)
const e1m = runModel(oneMass, weather, lib, REFEREE_OPTIONS)
const t = (r: ModelResults) => ({ heating_mwh: +(readBuildingHeatingKwh(r) / 1000).toFixed(4), cooling_mwh: +(readBuildingCoolingKwh(r) / 1000).toFixed(4) })
const refZone = (run: string, i: number) => ref.runs[run].zones[`Floor_${i + 1}`]

const out: any = {
  source: 'scripts/104_anchor_zones.mts', epw_sha256: EPW_SHA, options: REFEREE_OPTIONS,
  five_zones: {
    engine2: { ...t(e5), zones: zoneRows(e5), solver: e5.solver, run_ms: +e5.run_ms.toFixed(0) },
    vs: Object.fromEntries(['r2_z', 'r2_z_e2like', 'r2', 'r1_z', 'r1_tbz', 'r1'].filter((k) => ref.runs[k]).map((k) => [k, {
      referee: { heating_mwh: ref.runs[k].heating_mwh, cooling_mwh: ref.runs[k].cooling_mwh },
      heating_pct: pct(t(e5).heating_mwh, ref.runs[k].heating_mwh), cooling_pct: pct(t(e5).cooling_mwh, ref.runs[k].cooling_mwh),
      zones: e5.zones.map((z, i) => ({
        zone: z.zone_id, heating: [+(z.annual.heating_kwh / 1000).toFixed(2), +refZone(k, i).heating_mwh.toFixed(2)],
        cooling: [+(z.annual.cooling_kwh / 1000).toFixed(2), +refZone(k, i).cooling_mwh.toFixed(2)],
        interzone: [+(z.breakdown.filter((l) => l.term === 'interzone').reduce((s, l) => s + l.kwh, 0) / 1000).toFixed(2), refZone(k, i).slab_inside_face_conduction_mwh ?? null],
      })),
    }])),
  },
  one_zone_slabs_as_mass: {
    engine2: { ...t(e1m), solver: e1m.solver },
    vs: Object.fromEntries(['r2_one_zone', 'r2_one_zone_e2like', 'r1_one_zone'].filter((k) => ref.runs[k]).map((k) => [k, {
      referee: { heating_mwh: ref.runs[k].heating_mwh, cooling_mwh: ref.runs[k].cooling_mwh },
      heating_pct: pct(t(e1m).heating_mwh, ref.runs[k].heating_mwh), cooling_pct: pct(t(e1m).cooling_mwh, ref.runs[k].cooling_mwh),
    }])),
  },
}
const g = out.five_zones.vs.r2_z
out.gate = { against: 'r2_z', heating_pct: g.heating_pct, cooling_pct: g.cooling_pct, pass: Math.abs(g.heating_pct) <= 10 && Math.abs(g.cooling_pct) <= 10 }
writeFileSync(path.join(root, 'docs/audit/104/05_anchor_zones.json'), JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify({ gate: out.gate, five: Object.fromEntries(Object.entries(out.five_zones.vs).map(([k, v]: any) => [k, [v.heating_pct, v.cooling_pct, v.zones.map((z: any) => `${z.zone} h ${z.heating} c ${z.cooling} iz ${z.interzone}`)]])), one: out.one_zone_slabs_as_mass }, null, 1))
