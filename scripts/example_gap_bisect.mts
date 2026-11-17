/**
 * 17 Nov 2026: bisects the 15-minute run against EnergyPlus on a worked example (default the extended school), one
 * element kind at a time, with no tuning: "plain" (no gains, 20 °C all year, no systems, windows shut), then only walls,
 * only windows, only ground, only roof, only air, only bridging (the rest at near-zero U), and the same with no sun.
 * Findings: docs/audit/examples/school_heating_gap.md.
 *
 * Run from frontend/:  EPW=<weather.epw> npx vite-node ../scripts/example_gap_bisect.mts "plain,only wall"
 * Options: INSIDE=tarp (inside convection), DUMPZ=<zone id> (that zone's lines), ZONES=1 (per zone), RUNS=<dir>.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan } from '../frontend/src/sim2/geometry/plan'
import { weatherFromBytes } from '../frontend/src/sim2/run/weather'
import { runOptionsFor, simulate } from '../frontend/src/sim2/run/seam'
import { energyPlusInput, energyPlusSummary } from '../frontend/src/sim2/run/energyplus'
// @ts-expect-error js
import { runEnergyPlus } from '../frontend/plugins/energyplusRunner.js'
const epw = process.env.EPW ?? process.argv[3] ?? ''
const weather = await weatherFromBytes(new Uint8Array(readFileSync(epw)), 'london.epw', 'local')
const planFile = process.env.PLAN ?? path.resolve(import.meta.dirname, '../docs/examples/extended_school.plan.json')
const base: any = buildDocument(upgradePlan(JSON.parse(readFileSync(planFile, 'utf8')).plan)).doc

// Plain: no gains, heating 20 °C all the time, no cooling, no windows opening, no ventilation systems, ideal heating (no emitters / capacity).
function plain(d: any) {
  for (const z of d.zones) {
    if (z.conditioning === 'unconditioned') continue
    z.profile_refs = { occupancy: null, lighting: [], equipment: [], auxiliary: [] }
    z.setpoints = { heat_c: 20, cool_c: null, setback_c: null, hours_ref: null, heat_ref: null, control_strategy: 'active_setpoint' }
    z.ventilation = []
    z.emitters = []
  }
  for (const s of d.surfaces) s.openings = (s.openings ?? []).filter((o: any) => o.kind !== 'operable')
  d.controls = []
  d.system_groups = []; d.services = d.services ?? {}
  d.other_loads = []
  return d
}
function nosun(d: any) { for (const s of d.surfaces) { if (s.solar_absorptance != null) { s.solar_absorptance = 0.01; s.thermal_emissivity = 0.01 } if (s.kind === 'glazing') s.g_value = 0.01 } return d }
const KINDS = ['wall', 'glazing', 'ground', 'roof']
function onlyKind(d: any, keep: string | null, opts: { air?: boolean; tb?: boolean } = {}) {
  for (const s of d.surfaces) if (KINDS.includes(s.kind) && s.kind !== keep) s.construction_ref = { ...s.construction_ref, u_value_override: s.kind === 'glazing' ? 0.3 : 0.02 }
  if (!opts.tb) d.building.thermal_bridging = { ...d.building.thermal_bridging, multiplier: 0.0001 }
  if (!opts.air) for (const z of d.zones) { if (z.conditioning !== 'unconditioned') { z.infiltration_q50 = 0.01; for (const s of d.surfaces) if (s.zone_a === z.id) s.openings = [] } }
  return d
}
const cases: Record<string, (d: any) => any> = {
  plain: (d) => plain(d),
  'plain today-air': (d) => { plain(d); for (const s of d.surfaces) for (const o of s.openings) if (o.kind === 'permanent_vent') { o.cd = 0.6; o.flow_mode = 'single_sided' }; d.building.air = { method: 'today', exponent: null, single_sided_turbulence: null }; return d },
  'only wall': (d) => onlyKind(plain(d), 'wall'),
  'only wall u0.3': (d) => { onlyKind(plain(d), 'wall'); for (const s of d.surfaces) if (s.kind === 'wall' && s.solar_absorptance != null) s.construction_ref = { ...s.construction_ref, u_value_override: 0.3 }; return d },
  'only wall u3': (d) => { onlyKind(plain(d), 'wall'); for (const s of d.surfaces) if (s.kind === 'wall' && s.solar_absorptance != null) s.construction_ref = { ...s.construction_ref, u_value_override: 3 }; return d },
  'only wall dark': (d) => { onlyKind(plain(d), 'wall'); for (const s of d.surfaces) if (s.solar_absorptance != null) { s.solar_absorptance = 0.01; s.thermal_emissivity = 0.01 } return d },
  'only wall u1.42': (d) => { onlyKind(plain(d), 'wall'); for (const s of d.surfaces) if (s.kind === 'wall' && s.solar_absorptance != null) s.construction_ref = { ...s.construction_ref, u_value_override: s.construction_ref.key === 'cavity_wall_unfilled_1960s' ? 1.42 : 0.3 }; return d },
  'only wall keys': (d) => { const m: any = {}; for (const s of d.surfaces) if (s.kind === 'wall') { const k = s.construction_ref.key + '|' + s.zone_a.startsWith('loft') + '|' + s.construction_ref.u_value_override; m[k] = (m[k] ?? 0) + s.area_m2 }; console.log(m); return null },
  'nosun': (d) => nosun(plain(d)),
  'nosun only wall u0.3': (d) => { nosun(onlyKind(plain(d), 'wall')); for (const s of d.surfaces) if (s.kind === 'wall' && s.solar_absorptance != null) s.construction_ref = { ...s.construction_ref, u_value_override: 0.3 }; return d },
  'nosun only wall u1.42': (d) => { nosun(onlyKind(plain(d), 'wall')); for (const s of d.surfaces) if (s.kind === 'wall' && s.solar_absorptance != null) s.construction_ref = { ...s.construction_ref, u_value_override: s.construction_ref.key === 'cavity_wall_unfilled_1960s' ? 1.42 : 0.3 }; return d },
  'only glazing': (d) => onlyKind(plain(d), 'glazing'),
  'only ground': (d) => onlyKind(plain(d), 'ground'),
  'only roof+ceiling': (d) => { plain(d); for (const s of d.surfaces) if (['wall','glazing','ground'].includes(s.kind)) s.construction_ref = { ...s.construction_ref, u_value_override: s.kind === 'glazing' ? 0.3 : 0.02 }; d.building.thermal_bridging = { ...d.building.thermal_bridging, multiplier: 0.0001 }; for (const z of d.zones) if (z.conditioning !== 'unconditioned') z.infiltration_q50 = 0.01; return d },
  'only air': (d) => onlyKind(plain(d), null, { air: true }),
  'only tb': (d) => onlyKind(plain(d), null, { tb: true }),
}
const only = process.argv[2]
for (const [label, f] of Object.entries(cases)) {
  if (only && !only.split(',').includes(label)) continue
  const doc = f(structuredClone(base))
  if (!doc) continue
  const opts: any = { ...runOptionsFor(doc) }; if (process.env.INSIDE) opts.surface_physics = { outside_convection: 'fixed', inside_convection: process.env.INSIDE, beam_on_floor: true }
  const run = simulate(doc, { weather, options: opts })
  if (!run.ok) { console.log(label, JSON.stringify(run.missing).slice(0, 400)); continue }
  const prep = energyPlusInput(doc, run.results, { weather })
  if (!prep.ok) { console.log(label, JSON.stringify(prep.missing).slice(0, 400)); continue }
  const out = await runEnergyPlus({ ...prep.input, epw: readFileSync(epw, 'utf8') }, path.join(process.env.RUNS ?? '/tmp/nza-bisect', label.replace(/[ +]/g, '_')))
  const ep = energyPlusSummary(prep.doc, run.results, prep.input, out, weather, 'fabric')
  const s = run.summary
  const a = s.building.heating_kwh, b = ep.building.heating_kwh
  const bd = s.breakdown.filter((l) => Math.abs(l.kwh) > 50).map((l) => `${l.term}:${Math.round(l.kwh)}`).join(' ')
  if (process.env.DUMPZ) { const zr: any = (run.results as any).zones.find((z: any) => (z.zone_id ?? z.id) === process.env.DUMPZ) ?? (run.results as any).zones[2]; const m: any = {}; for (const l of zr.breakdown) { const k = l.term + ' ' + (l.surface_id ?? ''); m[k] = (m[k] ?? 0) + l.kwh } for (const [k, v] of Object.entries(m)) if (Math.abs(v as number) > 5) console.log('    ', k, Math.round(v as number)) }
  if (process.env.ZONES) s.zones.forEach((z, i) => { const wa = doc.surfaces.filter((x: any) => x.zone_a === z.id && x.kind === 'wall' && x.solar_absorptance != null && x.construction_ref.key === 'cavity_wall_unfilled_1960s').reduce((t: number, x: any) => t + x.area_m2, 0); const ga = doc.surfaces.filter((x: any) => x.zone_a === z.id && x.kind === 'glazing').reduce((t: number, x: any) => t + x.area_m2, 0); console.log('  ', (z.name ?? '').padEnd(24), 'run', Math.round(z.heating_kwh), 'ep', Math.round(ep.zones[i].heating_kwh), 'oldwall m2', Math.round(wa), 'glaz', Math.round(ga), 'floor', Math.round(z.floor_m2)) })
  console.log(label.padEnd(18), 'run', Math.round(a), 'ep', Math.round(b), `${((a / b - 1) * 100).toFixed(1)}%`, 'severe', ep.severe, '|', bd)
}
