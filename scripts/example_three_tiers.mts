/**
 * Runs a worked-example plan (docs/examples/*.plan.json) through the workspace's three tiers, the same calls the
 * workspace makes: the instant monthly estimate (instantEstimate, Brief 122), the 15-minute run (simulate with
 * runOptionsFor, Brief 121) and Run in EnergyPlus (energyPlusInput + the runner + energyPlusSummary, Brief 123).
 * Writes one JSON with each tier's headline numbers, per zone, per system and the notes each tier gives.
 *
 * Run from frontend/:  npx vite-node ../scripts/example_three_tiers.mts <plan.json> <weather.epw> <out.json> [<runs dir>]
 * EnergyPlus: ENERGYPLUS_DIR, or the usual install folders. Never commit the EPW.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { upgradePlan } from '../frontend/src/sim2/geometry/plan'
import { weatherFromBytes } from '../frontend/src/sim2/run/weather'
import { instantEstimate, levelDocument, runOptionsFor, simulate } from '../frontend/src/sim2/run/seam'
import { energyPlusInput, energyPlusSummary } from '../frontend/src/sim2/run/energyplus'
// @ts-expect-error plain JS module
import { runEnergyPlus } from '../frontend/plugins/energyplusRunner.js'

const [planPath, epwPath, outPath, runsArg] = process.argv.slice(2)
const runs = runsArg ?? path.join(os.tmpdir(), 'nza-example')
const file = JSON.parse(readFileSync(planPath!, 'utf8'))
const built = buildDocument(upgradePlan(file.plan))
if (!built.ok) throw new Error(JSON.stringify(built.issues, null, 1))
const doc = built.doc as any
const weather = await weatherFromBytes(new Uint8Array(readFileSync(epwPath!)), path.basename(epwPath!), 'local')
const r0 = (n: number) => Math.round(n)
const r1 = (n: number) => +n.toFixed(1)

// Tier 1: the instant monthly estimate (static), as the workspace shows it at Systems level.
let t = performance.now()
const inst = instantEstimate(levelDocument(doc, 'systems'), { weather })
const instMs = performance.now() - t
if (!inst.ok) throw new Error('instant: ' + JSON.stringify(inst.missing))

// Tier 2: the 15-minute run.
t = performance.now()
const run = simulate(doc, { weather, options: runOptionsFor(doc) })
const runMs = performance.now() - t
if (!run.ok) throw new Error('run: ' + JSON.stringify(run.missing))
const s = run.summary

// Tier 3: EnergyPlus, from the 15-minute run's document and results.
const prep = energyPlusInput(doc, run.results, { weather })
if (!prep.ok) throw new Error('energyplus: ' + JSON.stringify(prep.missing))
t = performance.now()
const out = await runEnergyPlus({ ...prep.input, epw: readFileSync(epwPath!, 'utf8') }, path.join(runs, path.basename(planPath!, '.plan.json')))
const epS = (performance.now() - t) / 1000
const ep = energyPlusSummary(prep.doc, run.results, prep.input, out, weather, 'systems')

const energy = (e: any) => (e?.ok ? {
  eui_kwh_per_m2: r1(e.eui_kwh_per_m2), total_kwh: r0(e.total_kwh),
  by_fuel: e.by_fuel.map((f: any) => ({ fuel: f.fuel, kwh: r0(f.kwh) })),
  end_uses: e.end_uses.map((f: any) => ({ end_use: f.end_use, fuel: f.fuel, kwh: r0(f.kwh) })),
  systems: e.systems.map((x: any) => ({ label: x.label, service: x.service, fuel: x.fuel, efficiency: x.efficiency, served_kwh: r0(x.served_kwh), fuel_kwh: r0(x.fuel_kwh) })),
  pumps: e.pumps.map((p: any) => ({ label: p.label, kwh: r0(p.kwh) })),
  other_loads: e.other_loads.map((o: any) => ({ name: o.label ?? o.id, kwh: r0(o.kwh) })),
  not_modelled: e.not_modelled,
} : e)

const result = {
  source: 'scripts/example_three_tiers.mts',
  plan: path.basename(planPath!),
  weather: { file: path.basename(epwPath!), station: s.weather.station, sha256: weather.sha256 },
  document: { zones: doc.zones.length, surfaces: doc.surfaces.length, systems: doc.system_groups.length, notes: built.notes ?? [] },
  floor_m2: r1(s.building.floor_m2),
  instant: {
    ms: r0(instMs), heating_kwh: r0(inst.estimate.building.heating_kwh), cooling_kwh: r0(inst.estimate.building.cooling_kwh),
    monthly_heating_kwh: inst.estimate.monthly.heating_kwh.map(r0), notes: inst.estimate.notes,
  },
  run: {
    ms: r0(runMs), steps_per_hour: s.steps_per_hour,
    heating_kwh: r0(s.building.heating_kwh), cooling_kwh: r0(s.building.cooling_kwh),
    peak_heating_kw: r1(s.building.peak_heating_w / 1000), peak_cooling_kw: r1(s.building.peak_cooling_w / 1000),
    monthly_heating_kwh: s.building.monthly.heating_kwh.map(r0), monthly_cooling_kwh: s.building.monthly.cooling_kwh.map(r0),
    energy: energy(s.energy), drafts: s.drafts,
    breakdown: s.breakdown.map((b) => ({ term: b.term, kwh: r0(b.kwh) })),
    zones: s.zones.map((z) => ({ name: z.name, floor_m2: r1(z.floor_m2), heating_kwh: r0(z.heating_kwh), cooling_kwh: r0(z.cooling_kwh), unconditioned: z.unconditioned, hours: z.hours, short: z.short, air: z.air })),
    plants: s.plants,
  },
  energyplus: {
    version: ep.version, run_s: r1(ep.run_s), wall_s: r1(epS), warnings: ep.warnings, severe: ep.severe, severe_text: ep.severe_text,
    heating_kwh: r0(ep.building.heating_kwh), cooling_kwh: r0(ep.building.cooling_kwh),
    peak_heating_kw: r1(ep.building.peak_heating_w / 1000), peak_cooling_kw: r1(ep.building.peak_cooling_w / 1000),
    monthly_heating_kwh: ep.building.monthly.heating_kwh.map(r0),
    energy: energy(ep.energy), notes: ep.notes,
    zones: ep.zones.map((z: any, i: number) => ({ name: s.zones[i]?.name, heating_kwh: r0(z.heating_kwh), cooling_kwh: r0(z.cooling_kwh), unmet_heating_hours_in_use: z.unmet_heating_hours_in_use })),
  },
}
writeFileSync(outPath!, JSON.stringify(result, null, 1) + '\n')
console.log(JSON.stringify({ floor: result.floor_m2, instant: [result.instant.heating_kwh, result.instant.cooling_kwh, result.instant.ms + 'ms'], run: [result.run.heating_kwh, result.run.cooling_kwh, result.run.ms + 'ms', result.run.energy?.eui_kwh_per_m2], ep: [result.energyplus.heating_kwh, result.energyplus.cooling_kwh, result.energyplus.energy?.eui_kwh_per_m2, 'severe ' + result.energyplus.severe] }))
