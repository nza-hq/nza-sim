/**
 * Brief 105 Part 6: per-floor accuracy. Engine 2 with sub-hourly steps and TARP inside convection, against the
 * EnergyPlus runs of validation/energyplus/105_per_floor_referee.py (docs/audit/105/06_referee.json).
 *
 * Run from frontend/:  npx vite-node ../scripts/105_per_floor.mts [<referee runs dir>]
 * Needs the anchor EPW in data/weather/current (checked by sha) and the committed Denver weather. With the referee's
 * runs directory, also follows the roof storey's slab hour by hour (the referee's slab_hourly.json files, not
 * committed). Writes docs/audit/105/06_per_floor.json.
 *
 * Everything is envelope-only on REFEREE_OPTIONS, as Brief 104's gate, so the numbers line up with Brief 104 Part 5.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig'
import {
  parseEpw, readBuildingCoolingKwh, readBuildingHeatingKwh, REFEREE_OPTIONS, runModel, type ModelResults, type RunOptions,
} from '../frontend/src/thermal/engine/index'
import { bestestDoc, LIB as BLIB, MOS, readMos } from '../frontend/src/thermal/engine/__tests__/denver'
import { grid50, PERF_PARTITION } from './104_grid50.mts'

const root = path.resolve(__dirname, '..')
const runsDir = process.argv[2] ?? null
const EPW_SHA = 'c65711022b0ea7e05ccfe03565f5d6b377fa6ea9157e3bc0066f0793fa478cf2'
const fx = parse(readFileSync(path.join(root, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
const ref = JSON.parse(readFileSync(path.join(root, 'docs/audit/105/06_referee.json'), 'utf8'))
const b104 = JSON.parse(readFileSync(path.join(root, 'docs/audit/104/01_attribution.json'), 'utf8')).bestest
const weather = await parseEpw(new Uint8Array(readFileSync(path.join(root, 'data/weather/current', fx.building_config.weather_file))))
if (weather.sha256 !== EPW_SHA) throw new Error('anchor EPW sha mismatch')
const lib: Record<string, any> = Object.fromEntries(fx.library_constructions.map((c: any) => [c.name, c.config_json]))
const five = (await fromBuildingConfig({
  building_config: structuredClone(fx.building_config), construction_choices: fx.construction_choices, comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions, weather: { file_name: fx.building_config.weather_file, file_hash: EPW_SHA },
  building_id: 'bridgewater-anchor',
}, { zoning: 'per_storey' })).document

const r4 = (x: number) => +x.toFixed(4)
const pct = (a: number, b: number) => +((a / b - 1) * 100).toFixed(1)
const steps = (n: number, between: 'hold' | 'linear' = 'linear'): Partial<RunOptions> => ({ time_step: { steps_per_hour: n, theta_e_between: between } })
const tarp: Partial<RunOptions> = { surface_physics: { ...REFEREE_OPTIONS.surface_physics!, inside_convection: 'tarp' } }

const VARIANTS: Record<string, { opts: Partial<RunOptions>; referee: string | null }> = {
  base: { opts: {}, referee: 'r2_z_e2like_ts1' },
  steps2: { opts: steps(2), referee: null },
  steps4: { opts: steps(4), referee: 'r2_z_e2like' },
  steps4_hold: { opts: steps(4, 'hold'), referee: null },
  steps12: { opts: steps(12), referee: null },
  steps60: { opts: steps(60), referee: null },
  tarp: { opts: tarp, referee: 'r2_z_e2tarp_ts1' },
  tarp_steps4: { opts: { ...tarp, ...steps(4) }, referee: 'r2_z_e2tarp' },
}
const bridgewater: Record<string, any> = {}
const runs: Record<string, ModelResults> = {}
for (const [name, v] of Object.entries(VARIANTS)) {
  const r = runModel(five, weather, lib, { ...REFEREE_OPTIONS, ...v.opts })
  runs[name] = r
  const zones = Object.fromEntries(r.zones.map((z, i) => [`z${i + 1}`, {
    heating_mwh: r4(z.annual.heating_kwh / 1000), cooling_mwh: r4(z.annual.cooling_kwh / 1000),
    slab_in_mwh: r4(z.breakdown.filter((l) => l.term === 'interzone').reduce((s, l) => s + l.kwh, 0) / 1000),
    closure_max_wh: +z.closure.max_wh.toExponential(2),
  }]))
  const t = { heating_mwh: r4(readBuildingHeatingKwh(r) / 1000), cooling_mwh: r4(readBuildingCoolingKwh(r) / 1000) }
  const vs = (k: string) => {
    const e = ref.runs[k]
    return {
      referee: k, heating_pct: pct(t.heating_mwh, e.heating_mwh), cooling_pct: pct(t.cooling_mwh, e.cooling_mwh),
      zones: Object.fromEntries(Object.keys(zones).map((z, i) => {
        const ez = e.zones[`Floor_${i + 1}`]
        return [z, { heating_pct: pct(zones[z].heating_mwh, ez.heating_mwh), cooling_pct: pct(zones[z].cooling_mwh, ez.cooling_mwh), slab_in_mwh_referee: ez.slab_inside_face_conduction_mwh ?? 0 }]
      })),
    }
  }
  bridgewater[name] = {
    options: v.opts, ...t, run_ms: Math.round(r.run_ms), zones,
    vs_same_form: v.referee ? vs(v.referee) : null,
    vs_r2_z: vs('r2_z'),
  }
  console.log(name.padEnd(12), t.heating_mwh.toFixed(2), t.cooling_mwh.toFixed(2), `${Math.round(r.run_ms)} ms`,
    v.referee ? `vs ${v.referee}: ${bridgewater[name].vs_same_form.heating_pct} % / ${bridgewater[name].vs_same_form.cooling_pct} %` : '',
    `| r2_z ${bridgewater[name].vs_r2_z.heating_pct} % / ${bridgewater[name].vs_r2_z.cooling_pct} %`,
    '| z5 slab', zones.z5.slab_in_mwh)
}

// ── The step error: each variant against 60 steps an hour ────────────────────────────────────────────────────────
const fine = bridgewater.steps60
const stepError = Object.fromEntries(['base', 'steps2', 'steps4', 'steps12'].map((k) => [k, {
  heating_pct: pct(bridgewater[k].heating_mwh, fine.heating_mwh), cooling_pct: pct(bridgewater[k].cooling_mwh, fine.cooling_mwh),
  zones: Object.fromEntries(Object.keys(fine.zones).map((z) => [z, { heating_pct: pct(bridgewater[k].zones[z].heating_mwh, fine.zones[z].heating_mwh), cooling_pct: pct(bridgewater[k].zones[z].cooling_mwh, fine.zones[z].cooling_mwh) }])),
}]))

// ── BESTEST 900 ────────────────────────────────────────────────────────────────────────────────────────────────
const mos = readMos(readFileSync(MOS))
const B_OPT: RunOptions = { ...REFEREE_OPTIONS, other_gains: { w: new Float64Array(8760).fill(200), convective_fraction: 0.4 } }
const bestest: Record<string, any> = {}
for (const [name, o] of Object.entries({ base: {}, steps4: steps(4), steps60: steps(60), tarp, tarp_steps4: { ...tarp, ...steps(4) } })) {
  const r = runModel(bestestDoc('wall900', 'floor900'), mos, BLIB, { ...B_OPT, ...o })
  bestest[name] = { heating_mwh: r4(readBuildingHeatingKwh(r) / 1000), cooling_mwh: r4(readBuildingCoolingKwh(r) / 1000), closure_max_wh: +r.zones[0].closure.max_wh.toExponential(2) }
}
const b = bestest
const bestestOut = {
  engine2: b,
  step_error_vs_60: { base: { heating_pct: pct(b.base.heating_mwh, b.steps60.heating_mwh), cooling_pct: pct(b.base.cooling_mwh, b.steps60.cooling_mwh) }, steps4: { heating_pct: pct(b.steps4.heating_mwh, b.steps60.heating_mwh), cooling_pct: pct(b.steps4.cooling_mwh, b.steps60.cooling_mwh) } },
  energyplus_104: { '900_iso3 (4 steps)': b104['900_iso3'], '900_iso3_ts (1 step)': b104['900_iso3_ts'], '900 (TARP, 4 steps)': b104['900'] },
}
console.log('BESTEST 900', JSON.stringify(b))

// ── The roof storey's slab, hour by hour ─────────────────────────────────────────────────────────────────────────
let slab: any = null
if (runsDir) {
  const read = (k: string) => {
    const f = path.join(runsDir, k, k, 'slab_hourly.json')
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
  }
  const H = weather.hours.count
  const month = weather.hours.month
  const byMonth = (a: ArrayLike<number>) => { const m = new Array(12).fill(0); for (let h = 0; h < H; h++) m[month[h] - 1] += a[h] / 1e6; return m.map(r4) }
  // Heat into z5 through its floor: Engine 2's interzone (z5 has one neighbour), EnergyPlus's floor inside-face conduction.
  const pairs: [string, string][] = [['base', 'r2_z_e2like_ts1'], ['steps4', 'r2_z_e2like'], ['tarp', 'r2_z_e2tarp_ts1'], ['tarp_steps4', 'r2_z_e2tarp']]
  slab = {}
  for (const [e, k] of pairs) {
    const ep = read(k)
    if (!ep) continue
    const z5 = runs[e].zones[4], ez = ep.zones.Floor_5
    const q = z5.hourly.interzone_w, qe = ez.floor.conduction_w
    // Split by what the zone is doing: heated hours, cooled hours, free hours (Engine 2's own state each hour).
    const split = { heating: [0, 0], cooling: [0, 0], free: [0, 0] }
    for (let h = 0; h < H; h++) {
      const s = z5.hourly.heating_w[h] > 0 ? 'heating' : z5.hourly.cooling_w[h] > 0 ? 'cooling' : 'free'
      split[s as keyof typeof split][0] += q[h] / 1e6; split[s as keyof typeof split][1] += qe[h] / 1e6
    }
    let dAir = 0, dFloor = 0
    for (let h = 0; h < H; h++) { dAir += z5.hourly.theta_air_c[h] - ez.air_c[h] }
    for (let h = 0; h < H; h++) dFloor += ez.floor.temp_c[h]
    const z4 = runs[e].zones[3], e4 = ep.zones.Floor_4
    let dAir4 = 0
    for (let h = 0; h < H; h++) dAir4 += z4.hourly.theta_air_c[h] - e4.air_c[h]
    slab[`${e} / ${k}`] = {
      annual_mwh: { engine2: r4(q.reduce((s, v) => s + v, 0) / 1e6), energyplus: r4(qe.reduce((s: number, v: number) => s + v, 0) / 1e6) },
      monthly_mwh: { engine2: byMonth(q), energyplus: byMonth(qe) },
      by_engine2_state_mwh: Object.fromEntries(Object.entries(split).map(([s, [a, c]]) => [s, { engine2: r4(a), energyplus: r4(c) }])),
      mean_air_difference_k: { z5: +(dAir / H).toFixed(3), z4: +(dAir4 / H).toFixed(3) },
      energyplus_mean_floor_c: +(dFloor / H).toFixed(3),
    }
  }
  console.log('slab', JSON.stringify(slab, null, 1))
}

// ── Speed: TARP rebuilds the solver's matrix every step; time it on Brief 104's 50-zone document (one run each) ────
const libP: Record<string, any> = { ...lib, [PERF_PARTITION.name]: PERF_PARTITION }
const g50 = grid50(five)
const speed = Object.fromEntries((['fixed', 'tarp'] as const).map((k) => {
  const r = runModel(g50, weather, libP, { ...REFEREE_OPTIONS, ...(k === 'tarp' ? tarp : {}) })
  return [k, Math.round(r.run_ms)]
}))
console.log('50 zones ms', JSON.stringify(speed))

const out = {
  source: 'scripts/105_per_floor.mts', epw_sha256: EPW_SHA, referee: 'docs/audit/105/06_referee.json', base_options: REFEREE_OPTIONS,
  bridgewater, step_error_vs_60_steps: stepError, fifty_zones_run_ms: speed, bestest_900: bestestOut, roof_slab_hourly: slab,
}
writeFileSync(path.join(root, 'docs/audit/105/06_per_floor.json'), JSON.stringify(out, null, 1) + '\n')
