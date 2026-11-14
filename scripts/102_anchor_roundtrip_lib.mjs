/**
 * Brief 102 Part 5 / Brief 102a Part 5: the anchor round trip, as functions over any supabase-js-shaped client.
 * scripts/102_anchor_roundtrip.mjs is the command line; the local-Postgres tests call these directly.
 *
 *   validation/fixtures/bridgewater_anchor_v2.yaml → fromBuildingConfig → canonical text and model hash
 *   → the stored model version → its instant-engine run → the stored EUI and total.
 *
 * "match" means the STORED document hashes to the fresh conversion's hash, both through its stored canonical text
 * and through re-serialising its jsonb in JavaScript (QA M5: 102 compared two fresh conversions with each other,
 * which always match). The figures are checked against the reference with stated tolerances, never by exact float
 * equality: total 561,572 kWh ± 1 kWh, EUI 133.2 ± 0.05 (Brief 102b; 558,972 / 132.6 before) (the engine rounds the EUI to one decimal place; QA trap 1).
 *
 * Engine files are imported, never changed.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { fromBuildingConfig } from '../frontend/src/thermal/schema/fromBuildingConfig.ts'
import { canonicalJSON, sha256Hex } from '../frontend/src/thermal/schema/canonical.ts'
import { libraryHash, modelHash, weatherHash } from '../frontend/src/thermal/schema/hash.ts'
import {
  ensureLocalBuilding, INSTANT_ENGINE_VERSION, INSTANT_SOURCE, instantSummary, recordRun, saveModelVersion,
} from '../frontend/src/thermal/store/versions.ts'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// yaml through Node's own require from frontend/ (vite-node mis-resolves a bare 'yaml' imported from scripts/).
const { parse: parseYaml } = createRequire(path.join(REPO, 'frontend/package.json'))('yaml')
export const NAME = 'Bridgewater anchor fixture'
export const EXPECTED = { eui_kwh_m2: 133.2, eui_tol: 0.05, total_kwh: 561572, total_tol: 1 }
/** Stands in for the database building id in the emitted SQL's document template (a v4-shaped, never-issued uuid). */
export const BUILDING_SENTINEL = '00000000-0000-4000-8000-00000000b1d0'

export const fx = parseYaml(fs.readFileSync(path.join(REPO, 'validation/fixtures/bridgewater_anchor_v2.yaml'), 'utf8'))
if (!fx.comfort_band || typeof fx.comfort_band.lower_c !== 'number' || typeof fx.comfort_band.upper_c !== 'number') {
  // 102 fell back to 20/26 °C, retired by Brief 58 A2 (QA M5). The fixture carries its band; refuse if it ever does not.
  throw new Error('the anchor fixture has no comfort band (comfort_band.lower_c / upper_c): refusing to default it')
}
export const EPW_NAME = fx.building_config.weather_file
export const EPW_SHA = crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(REPO, 'data/weather/current', EPW_NAME))).digest('hex')

/** The fixture as a model document for this building id, with the EPW pinned by its bytes. */
export async function convert(buildingId) {
  const { document } = await fromBuildingConfig({
    building_config: fx.building_config,
    construction_choices: fx.construction_choices,
    comfort_band: fx.comfort_band,
    library_constructions: fx.library_constructions,
    building_id: buildingId,
    weather: { file_name: EPW_NAME, file_hash: EPW_SHA },
  })
  return document
}

/** Total kWh across fuels, from a run summary. */
export const totalKwh = (s) => Object.values(s?.annual_by_fuel ?? {}).reduce((a, b) => a + b, 0)

/** Checks a stored summary against the reference. Returns a list of failures (empty = pass). */
export function checkFigures(summary) {
  const out = []
  const eui = summary?.eui_kwh_m2, tot = totalKwh(summary)
  if (!(typeof eui === 'number' && Math.abs(eui - EXPECTED.eui_kwh_m2) <= EXPECTED.eui_tol)) out.push(`EUI ${eui}, expected ${EXPECTED.eui_kwh_m2} ± ${EXPECTED.eui_tol}`)
  if (!(Math.abs(tot - EXPECTED.total_kwh) <= EXPECTED.total_tol)) out.push(`total ${tot} kWh, expected ${EXPECTED.total_kwh} ± ${EXPECTED.total_tol}`)
  return out
}

/** The instant engine on the fixture, called as scripts/_brief93_anchor.mjs --fixture calls it (band never defaulted). */
export async function runAnchorEngine() {
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
  const comfortBand = { lower_c: fx.comfort_band.lower_c, upper_c: fx.comfort_band.upper_c }
  return calculateInstant(building, fx.construction_choices, {}, libraryData, weatherData, hourlySolar, null,
    { comfortBand, _skipInterventions: true, engine: 'v2.5' })
}

/** The anchor's stable local id (Brief 103 P1, QA M4): buildings are found by it, never by name. */
export const LOCAL_REF = 'fixture:bridgewater_anchor_v2'

/** The anchor building in this organisation, or null (by its local id; by name only for a pre-0005 row). */
export async function findBuilding(sb, orgId) {
  const byRef = await sb.from('projects').select('id').eq('org_id', orgId).eq('local_ref', LOCAL_REF)
  if (byRef.error) throw byRef.error
  for (const p of byRef.data) {
    const { data: b, error: e2 } = await sb.from('buildings').select('id').eq('project_id', p.id).eq('local_ref', LOCAL_REF).limit(1)
    if (e2) throw e2
    if (b.length) return b[0].id
  }
  const { data: projects, error } = await sb.from('projects').select('id').eq('org_id', orgId).eq('name', NAME)
  if (error) throw error
  for (const p of projects) {
    const { data: b, error: e2 } = await sb.from('buildings').select('id').eq('project_id', p.id).eq('name', NAME).limit(1)
    if (e2) throw e2
    if (b.length) return b[0].id
  }
  return null
}

/** Saves the fixture's version and records its run (both idempotent). */
export async function recordAnchor(sb, orgId) {
  const buildingId = await ensureLocalBuilding(sb, orgId, LOCAL_REF, NAME)
  const version = await saveModelVersion(sb, buildingId, await convert(buildingId), 'Brief 102a P5: frozen Bridgewater anchor fixture')
  const runId = await recordRun(sb, version.id, {}, instantSummary(await runAnchorEngine()), INSTANT_ENGINE_VERSION, INSTANT_SOURCE)
  return { buildingId, version, runId }
}

/**
 * Reads the round trip back. Returns { ok, lines }: ok only if the stored document's own text and its jsonb both hash
 * to a fresh conversion's hash, a run exists for this engine version, and its figures match the reference.
 */
export async function readAnchor(sb, orgId) {
  const lines = []
  const buildingId = await findBuilding(sb, orgId)
  if (!buildingId) return { ok: false, lines: [`no "${NAME}" building in this organisation: record it first`] }
  const fresh = await modelHash(await convert(buildingId))
  const { data: versions, error } = await sb.from('model_versions').select('id, model_hash, canonical, document')
    .eq('building_id', buildingId).eq('model_hash', fresh)
  if (error) throw error
  if (!versions.length) return { ok: false, lines: [`no stored version with the fixture's model hash ${fresh}`] }
  const v = versions[0]
  const fromText = v.canonical == null ? null : await sha256Hex(v.canonical)
  const fromJson = await modelHash(v.document)
  const { data: runs, error: e2 } = await sb.from('runs').select('id, summary, source, engine_version')
    .eq('model_version_id', v.id).eq('engine_version', INSTANT_ENGINE_VERSION)
  if (e2) throw e2
  const docOk = fromText === fresh && fromJson === fresh
  lines.push(`version ${v.id}: stored text → ${fromText?.slice(0, 12) ?? 'none'}, stored jsonb → ${fromJson.slice(0, 12)}, fixture → ${fresh.slice(0, 12)}: ${docOk ? 'match' : 'MISMATCH'}`)
  if (!runs.length) return { ok: false, lines: [...lines, `no run for engine ${INSTANT_ENGINE_VERSION}`] }
  const bad = checkFigures(runs[0].summary)
  lines.push(`run ${runs[0].id} (${runs[0].engine_version}, ${runs[0].source}): EUI ${runs[0].summary.eui_kwh_m2} kWh/m2, total ${totalKwh(runs[0].summary)} kWh: ${bad.length ? bad.join('; ') : 'match'}`)
  return { ok: docOk && !bad.length, lines }
}

/**
 * SQL for the Supabase SQL editor that records the anchor as the organisation's first active admin, through the same
 * security-definer functions and RLS as the app (a signed-in session, not the editor's superuser), in one transaction.
 * No token in a terminal. The document is the JavaScript canonical text with a sentinel building id, replaced by the
 * real one in SQL; the read-back reverses that and checks the stored text against the JavaScript hash.
 */
export async function emitSql(orgName) {
  const doc = await convert(BUILDING_SENTINEL)
  const text = canonicalJSON(doc)
  if (text.split(BUILDING_SENTINEL).length !== 2) throw new Error('the sentinel building id must appear exactly once in the document')
  if (text.includes('$fx$')) throw new Error('the document contains the SQL dollar-quote tag')
  const templateHash = await sha256Hex(text)
  const lh = await libraryHash(doc.library_refs), wh = await weatherHash(doc.weather_ref)
  const summary = instantSummary(await runAnchorEngine())
  const bad = checkFigures(summary)
  if (bad.length) throw new Error(`the engine no longer gives the reference: ${bad.join('; ')}`)
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`
  const record = `-- Brief 102a Part 5: record the frozen Bridgewater anchor in NZA Sim (dev), for the Supabase SQL editor.
-- Generated by: cd frontend; npx vite-node ../scripts/102_anchor_roundtrip.mjs --emit-sql --org ${JSON.stringify(orgName)}
-- Runs as the organisation's first active admin (role authenticated, their uid in request.jwt.claims), so RLS and
-- the security-definer functions apply exactly as for the app. Idempotent: a second run adds nothing.
-- Engine ${INSTANT_ENGINE_VERSION}; EPW ${EPW_NAME} sha256 ${EPW_SHA}.
-- Expected: EUI ${summary.eui_kwh_m2}, total ${totalKwh(summary)} kWh. Fixture template hash ${templateHash}.
begin;
do $do$
declare
  v_org uuid; v_user uuid; v_proj uuid; v_bld uuid; v_txt text; v_hash text; v_ver uuid; v_parent uuid; v_run uuid;
begin
  if (select count(*) from supabase_migrations.schema_migrations where name = '0004_qa_fixes') = 0 then
    raise exception 'apply supabase/migrations/0004_qa_fixes.sql first';
  end if;
  select o.id into strict v_org from public.organisations o where o.name = ${q(orgName)};
  select m.user_id into v_user from public.memberships m
   where m.org_id = v_org and m.role = 'admin' and m.status = 'active' order by m.joined_at limit 1;
  if v_user is null then raise exception 'organisation % has no active admin', ${q(orgName)}; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select p.id into v_proj from public.projects p where p.org_id = v_org and p.name = ${q(NAME)} order by p.created_at limit 1;
  if v_proj is null then v_proj := public.create_project(v_org, ${q(NAME)}); end if;
  select b.id into v_bld from public.buildings b where b.project_id = v_proj and b.name = ${q(NAME)} order by b.created_at limit 1;
  if v_bld is null then v_bld := public.create_building(v_proj, ${q(NAME)}); end if;

  v_txt := replace($fx$${text}$fx$, ${q(BUILDING_SENTINEL)}, v_bld::text);
  v_hash := encode(sha256(convert_to(v_txt, 'UTF8')), 'hex');
  select id into v_ver from public.model_versions where building_id = v_bld and model_hash = v_hash;
  if v_ver is null then
    select id into v_parent from public.model_versions where building_id = v_bld order by created_at desc limit 1;
    v_ver := public.create_model_version(v_bld, ${q(doc.schema_version)}, v_txt, v_hash, ${q(lh)}, ${q(wh)}, v_parent,
      'Brief 102a P5: frozen Bridgewater anchor fixture');
  end if;
  v_run := public.record_run(v_ver, ${q(INSTANT_ENGINE_VERSION)}, '{}'::jsonb, ${q(JSON.stringify(summary))}::jsonb, ${q(INSTANT_SOURCE)});
  raise notice 'anchor recorded: building %, version %, run %', v_bld, v_ver, v_run;
end
$do$;
commit;
`
  const readback = `-- Brief 102a Part 5: read the anchor round trip back (any role that can read the tables; the SQL editor is fine).
-- Every column ending in _ok must be true.
select v.id as version_id,
       encode(sha256(convert_to(v.canonical, 'UTF8')), 'hex') = v.model_hash as stored_text_hash_ok,
       encode(sha256(convert_to(replace(v.canonical, b.id::text, ${q(BUILDING_SENTINEL)}), 'UTF8')), 'hex')
         = ${q(templateHash)} as same_document_as_javascript_ok,
       v.weather_hash = ${q(EPW_SHA)} as weather_is_the_epw_bytes_ok,
       r.engine_version = ${q(INSTANT_ENGINE_VERSION)} as engine_version_ok,
       abs((r.summary->>'eui_kwh_m2')::numeric - ${EXPECTED.eui_kwh_m2}) <= ${EXPECTED.eui_tol} as eui_ok,
       abs((select sum(value::numeric) from jsonb_each_text(r.summary->'annual_by_fuel')) - ${EXPECTED.total_kwh}) <= ${EXPECTED.total_tol} as total_kwh_ok,
       r.summary->>'eui_kwh_m2' as eui,
       (select sum(value::numeric) from jsonb_each_text(r.summary->'annual_by_fuel')) as total_kwh,
       (select count(*) from public.runs r2 where r2.model_version_id = v.id) as runs_on_version
  from public.organisations o
  join public.projects p on p.org_id = o.id and p.name = ${q(NAME)}
  join public.buildings b on b.project_id = p.id and b.name = ${q(NAME)}
  join public.model_versions v on v.building_id = b.id and v.canonical is not null
  left join public.runs r on r.model_version_id = v.id and r.engine_version = ${q(INSTANT_ENGINE_VERSION)}
 where o.name = ${q(orgName)};
`
  return { record, readback, templateHash, summary }
}
