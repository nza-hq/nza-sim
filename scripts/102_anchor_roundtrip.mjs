/**
 * Brief 102 Part 5: prove the anchor round-trips through NZA Sim's own database.
 *
 *   validation/fixtures/bridgewater_anchor_v2.yaml → fromBuildingConfig → model hash
 *   → the stored model version with that hash → its `instant-1` run → the stored EUI.
 *
 * Exits 0 only when a stored run exists for a version whose model hash equals a fresh conversion of the fixture,
 * and its stored EUI is 132.6. Prints the EUI, the hash and `match`.
 *
 * Read-only by default. `--record` first saves the fixture's own version and records its instant-engine run (the
 * engine called exactly as scripts/_brief93_anchor.mjs --fixture calls it) if they are not there yet, through the
 * same functions the Save button uses. That is needed because the button saves the LIVE inputs, whose library
 * items may differ from the frozen fixture's, so the button's hash is not the fixture's hash (docs/audit/102/05).
 * Re-running `--record` adds nothing (same hash → same version; same four hashes → same run).
 *
 * The building is "<org> / Bridgewater anchor fixture / Bridgewater anchor fixture", so it never mixes with a
 * real project. Engine files are imported, never changed.
 *
 * Environment (PowerShell `$env:NAME = '...'`): NZASIM_SUPABASE_URL, NZASIM_SUPABASE_ANON_KEY (or the VITE_ names),
 * NZASIM_ACCESS_TOKEN (an editor's or admin's browser session; see scripts/102_seed_library.mjs).
 * The EPW named by the fixture must be in data/weather/current/.
 *
 * Run (TypeScript imports, so through vite-node from frontend/):
 *   cd frontend; npx vite-node ../scripts/102_anchor_roundtrip.mjs [--record] [--org "NZA"]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { createClient } from '@supabase/supabase-js'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig.ts'
import { modelHash } from '../frontend/src/thermal/schema/hash.ts'
import {
  ensureBuilding, ensureProject, INSTANT_ENGINE_VERSION, INSTANT_SOURCE, instantSummary, recordRun, saveModelVersion,
} from '../frontend/src/thermal/store/versions.ts'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const RECORD = argv.includes('--record')
const orgArg = argv.includes('--org') ? argv[argv.indexOf('--org') + 1] : null
const NAME = 'Bridgewater anchor fixture'
const EXPECTED_EUI = 132.6

const URL_ = process.env.NZASIM_SUPABASE_URL ?? process.env.VITE_NZASIM_SUPABASE_URL
const KEY = process.env.NZASIM_SUPABASE_ANON_KEY ?? process.env.VITE_NZASIM_SUPABASE_ANON_KEY
const TOKEN = process.env.NZASIM_ACCESS_TOKEN
if (!URL_ || !KEY || !TOKEN) { console.error('needs NZASIM_SUPABASE_URL, NZASIM_SUPABASE_ANON_KEY and NZASIM_ACCESS_TOKEN'); process.exit(2) }
if (!/jbjxduathkklruvbmeho/.test(URL_)) { console.error(`refusing: ${URL_} is not NZA Sim (dev)`); process.exit(2) }
const sb = createClient(URL_, KEY, {
  global: { headers: { Authorization: `Bearer ${TOKEN}` } },
  auth: { persistSession: false, autoRefreshToken: false },
})

const fx = parseYaml(fs.readFileSync(path.join(REPO, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))

// The organisation.
const { data: access, error: accErr } = await sb.rpc('my_access')
if (accErr) throw accErr
const orgs = access.orgs.filter((o) => (orgArg ? o.name === orgArg : true))
if (orgs.length !== 1) { console.error(`pick one organisation with --org; yours: ${access.orgs.map((o) => o.name).join(', ') || 'none'}`); process.exit(2) }
const org = orgs[0]

// Find (or, with --record, create) the anchor's building.
let buildingId = null
{
  const { data: projects, error } = await sb.from('projects').select('id').eq('org_id', org.id).eq('name', NAME)
  if (error) throw error
  for (const p of projects) {
    const { data: b, error: e2 } = await sb.from('buildings').select('id').eq('project_id', p.id).eq('name', NAME).limit(1)
    if (e2) throw e2
    if (b.length) { buildingId = b[0].id; break }
  }
}
if (!buildingId && RECORD) buildingId = await ensureBuilding(sb, await ensureProject(sb, org.id, NAME), NAME)
if (!buildingId) { console.error(`no "${NAME}" building in ${org.name}: run once with --record`); process.exit(1) }

// A fresh conversion of the fixture, with the stored building's id.
const conv = () => fromBuildingConfig({
  building_config: fx.building_config,
  construction_choices: fx.construction_choices,
  comfort_band: fx.comfort_band,
  library_constructions: fx.library_constructions,
  building_id: buildingId,
})
const { document } = await conv()
const hash = await modelHash(document)

if (RECORD) {
  const version = await saveModelVersion(sb, buildingId, document, 'Brief 102 P5: frozen Bridgewater anchor fixture')
  const result = await runAnchorEngine()
  const runId = await recordRun(sb, version.id, {}, instantSummary(result), INSTANT_ENGINE_VERSION, INSTANT_SOURCE)
  console.log(`recorded: version ${version.id} (${version.created ? 'new' : 'existing'}), run ${runId}`)
}

// Read back.
const { data: versions, error: vErr } = await sb.from('model_versions').select('id, model_hash').eq('building_id', buildingId).eq('model_hash', hash)
if (vErr) throw vErr
if (!versions.length) { console.error(`no stored version with model hash ${hash}`); process.exit(1) }
const { data: runs, error: rErr } = await sb.from('runs').select('id, summary, source, engine_version, model_hash')
  .eq('model_version_id', versions[0].id).eq('engine_version', INSTANT_ENGINE_VERSION)
if (rErr) throw rErr
if (!runs.length) { console.error(`version ${versions[0].id} has no ${INSTANT_ENGINE_VERSION} run`); process.exit(1) }
const run = runs[0]
const again = await modelHash((await conv()).document)
const eui = run.summary?.eui_kwh_m2
const match = run.model_hash === hash && again === hash
console.log(`stored EUI ${eui} kWh/m2 (source ${run.source}), model hash ${hash}, ${match ? 'match' : 'MISMATCH'}`)
process.exit(match && eui === EXPECTED_EUI ? 0 : 1)

/** The instant engine on the fixture, called exactly as scripts/_brief93_anchor.mjs --fixture calls it. */
async function runAnchorEngine() {
  const { calculateInstant } = await import('../frontend/src/utils/instantCalc.js')
  const { computeHourlySolarByFacade } = await import('../frontend/src/utils/solarCalc.js')
  const { SYSTEM_TEMPLATES_LIBRARY } = await import('../frontend/src/data/systemTemplatesLibrary.js')
  const building = fx.building_config
  const epwLines = fs.readFileSync(path.join(REPO, 'data/weather/current', building.weather_file), 'utf-8').split(/\r?\n/)
  const latitude = parseFloat(epwLines[0].split(',')[6])
  const dataLines = epwLines.slice(8).filter((l) => l.trim().length > 0)
  const N = dataLines.length
  const month = new Int8Array(N), day = new Int8Array(N), hour = new Int8Array(N)
  const temperature = new Float32Array(N), direct_normal = new Float32Array(N)
  const diffuse_horizontal = new Float32Array(N), wind_speed = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const p = dataLines[i].split(',')
    month[i] = parseInt(p[1]); day[i] = parseInt(p[2]); hour[i] = parseInt(p[3])
    temperature[i] = parseFloat(p[6]); direct_normal[i] = parseFloat(p[14])
    diffuse_horizontal[i] = parseFloat(p[15]); wind_speed[i] = parseFloat(p[21])
  }
  const weatherData = { temperature, direct_normal, diffuse_horizontal, wind_speed, month, day, hour }
  const hourlySolar = computeHourlySolarByFacade(weatherData, latitude, building.orientation ?? 0)
  const libraryData = {
    constructions: (fx.library_constructions ?? []).map((c) => ({
      name: c.name,
      u_value_W_per_m2K: c.config_json?.u_value_W_per_m2K ?? c.u_value_W_per_m2K,
      y_factor: c.config_json?.y_factor ?? c.y_factor ?? 1.0,
      g_value: c.config_json?.g_value, config_json: c.config_json ?? c, layers: c.layers,
    })),
    system_templates: SYSTEM_TEMPLATES_LIBRARY,
    library_systems: building?.library_systems ?? [],
    library_schedules: building?.library_schedules ?? [],
  }
  const comfortBand = { lower_c: fx.comfort_band?.lower_c ?? 20, upper_c: fx.comfort_band?.upper_c ?? 26 }
  return calculateInstant(building, fx.construction_choices, {}, libraryData, weatherData, hourlySolar, null,
    { comfortBand, _skipInterventions: true, engine: 'v2.5' })
}
