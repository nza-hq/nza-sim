/**
 * The RWGC clubhouse as one "nza-detailed-building/1" file for decodED (25 Nov 2026, Linzie: "how a detailed NZA Sim
 * building shows up inside decodED"; one file passed by hand until Brief 113's live link).
 *
 * Opens docs/examples/rwgc_clubhouse.plan.json as the editor does (upgradePlan), builds its document, runs the hourly
 * (15-minute) run the workspace runs (simulate with runOptionsFor) and, when EnergyPlus is installed, Run in
 * EnergyPlus. Every result is read from the run as it is; nothing is worked out here. Fields the run does not give are
 * left out. The placement (where the plan sits on the map) is fitted separately and passed in as JSON.
 *
 * Run from frontend/:
 *   npx vite-node ../scripts/rwgc_detailed_export.mts <weather.epw> <placement.json> <out.json> [<runs dir>]
 * Never commit the EPW.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDocument } from '../frontend/src/sim2/geometry/toDocument'
import { floorsOf, ringArea, upgradePlan, type Plan } from '../frontend/src/sim2/geometry/plan'
import { weatherFromBytes } from '../frontend/src/sim2/run/weather'
import { runOptionsFor, simulate } from '../frontend/src/sim2/run/seam'
import { energyPlusInput, energyPlusSummary } from '../frontend/src/sim2/run/energyplus'
import { modelHash } from '../frontend/src/thermal/schema/hash'
// @ts-expect-error plain JS module
import { findEnergyPlus, runEnergyPlus } from '../frontend/plugins/energyplusRunner.js'

const [epwPath, placementPath, outPath, runsArg] = process.argv.slice(2)
const root = path.resolve(__dirname, '..')
const file = JSON.parse(readFileSync(path.join(root, 'docs/examples/rwgc_clubhouse.plan.json'), 'utf8'))
const plan: Plan = upgradePlan(JSON.parse(JSON.stringify(file.plan)))
const built = buildDocument(plan)
if (!built.ok) throw new Error(JSON.stringify(built.issues, null, 1))
const doc = built.doc as any
const hash = await modelHash(doc)
const commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim()

const epwBytes = new Uint8Array(readFileSync(epwPath!))
const weather = await weatherFromBytes(epwBytes, path.basename(epwPath!), 'local')
const run = simulate(doc, { weather, options: runOptionsFor(doc) })
if (!run.ok) throw new Error('run: ' + JSON.stringify(run.missing))
const s = run.summary
if (!s.energy || !s.energy.ok) throw new Error('the run gives no energy')
const r0 = (n: number) => Math.round(n)
const r1 = (n: number) => Math.round(n * 10) / 10
const fuel = (e: { by_fuel: { fuel: string; kwh: number }[] }, f: string) => e.by_fuel.find((x) => x.fuel === f)?.kwh ?? 0

// Rooms and their floors, from the plan the editor holds.
const floors = floorsOf(plan)
const floorOfZone = new Map<string, number>()
const rooms = floors.flatMap((f, k) => f.rooms.map((r) => {
  floorOfZone.set(r.zone, k)
  return { id: r.id, name: r.name, zone: r.zone, floor: k, area_m2: r1(ringArea(r.ring)) }
}))

// Zones: the run's own figures (control temperature; hours in use below the heating setpoint, as the workspace shows).
const zones = s.zones.map((z, i) => {
  const a = run.results.zones[i]!.annual
  const out: Record<string, unknown> = { id: z.id, name: z.name, floor: floorOfZone.get(z.id), heat_demand_kwh: r0(z.heating_kwh), cooling_demand_kwh: r0(z.cooling_kwh) }
  if (a.unmet_heating_hours_in_use != null) out.hours_below_setpoint = a.unmet_heating_hours_in_use
  out.max_c = r1(a.max_control_c)
  out.min_c = r1(a.min_control_c)
  return out
})

// EnergyPlus, when installed (about 20 s for this building).
let energyplus: Record<string, unknown> | undefined
if (findEnergyPlus()) {
  const prep = energyPlusInput(doc, run.results, { weather })
  if (!prep.ok) throw new Error('energyplus: ' + JSON.stringify(prep.missing))
  const out = await runEnergyPlus({ ...prep.input, epw: readFileSync(epwPath!, 'utf8') }, path.join(runsArg ?? path.join(os.tmpdir(), 'nza-detailed'), 'rwgc'))
  const ep = energyPlusSummary(prep.doc, run.results, prep.input, out, weather, 'systems')
  const e = ep.energy?.ok ? ep.energy : null
  energyplus = {
    version: ep.version, severe: ep.severe,
    gas_kwh: e ? r0(fuel(e, 'gas')) : undefined, electricity_kwh: e ? r0(fuel(e, 'electricity')) : undefined,
    heat_demand_kwh: r0(ep.building.heating_kwh), cooling_demand_kwh: r0(ep.building.cooling_kwh),
    eui_kwh_m2: e ? r1(e.eui_kwh_per_m2) : undefined, peak_heat_kw: r1(ep.building.peak_heating_w / 1000),
  }
}

const placement = JSON.parse(readFileSync(placementPath!, 'utf8'))
const t = built.totals
const result = {
  schema: 'nza-detailed-building/1',
  status: 'existing',
  decoded_building_key: null,
  placement,
  model_version: { hash, engine_version: `${s.engine}@${commit}`, made: new Date().toISOString() },
  plan,
  storey_height_m: floors.map(() => plan.storey_height_m),
  results: {
    weather: `${s.weather.file_name} (${s.weather.station}; sha256 ${s.weather.sha256})`,
    building: {
      floor_area_m2: r1(s.building.floor_m2),
      gas_kwh: r0(fuel(s.energy, 'gas')),
      electricity_kwh: r0(fuel(s.energy, 'electricity')),
      heat_demand_kwh: r0(s.building.heating_kwh),
      cooling_demand_kwh: r0(s.building.cooling_kwh),
      eui_kwh_m2: r1(s.energy.eui_kwh_per_m2),
      peak_heat_kw: r1(s.building.peak_heating_w / 1000),
    },
    ...(energyplus ? { energyplus } : {}),
    zones,
    rooms,
  },
  counts: { floors: floors.length, rooms: rooms.length, zones: s.zones.length, windows: t.windows, doors: t.doors },
}
writeFileSync(outPath!, JSON.stringify(result, null, 1) + '\n')
console.log(JSON.stringify({ hash, engine: result.model_version.engine_version, building: result.results.building, energyplus, counts: result.counts, totals: t, run_ms: s.run_ms }, null, 1))
