import { REPO, fx, EPW, EPW_SHA, reset, user, org, check, summary, psql } from './common.mjs'
import { fromBuildingConfig } from '../../frontend/src/thermal/schema/fromBuildingConfig.ts'
import { canonicalJSON, sha256Hex } from '../../frontend/src/thermal/schema/canonical.ts'
import { ensureBuilding, ensureProject, saveModelVersion } from '../../frontend/src/thermal/store/versions.ts'

reset()
const a = await user('a@example.com'); const orgA = await org(a, 'Org A')
const bld = await ensureBuilding(a.sb, await ensureProject(a.sb, orgA, 'Anchor'), 'Anchor')
const conv = async () => (await fromBuildingConfig({ building_config: fx.building_config, construction_choices: fx.construction_choices,
  comfort_band: fx.comfort_band, library_constructions: fx.library_constructions, building_id: bld,
  weather: { file_name: EPW, file_hash: EPW_SHA } })).document

const doc = await conv()
const v1 = await saveModelVersion(a.sb, bld, doc, 'anchor')
check('anchor saves', v1.created)
check('anchor again: the same version, nothing new', !(await saveModelVersion(a.sb, bld, await conv(), null)).created)
const r = psql(`select encode(sha256(convert_to(canonical,'UTF8')),'hex') = model_hash, public.model_hash(document) = model_hash, weather_hash from public.model_versions where id='${v1.id}'`)
check('stored: sha256(canonical) = model_hash; the jsonb re-hash agrees too for the anchor', r.out.trim().startsWith('t|t|'), r.out.trim())
check('weather pinned by the EPW sha256', r.out.trim().endsWith(EPW_SHA))

// Find a numeric leaf under profiles and make it float noise.
function firstNumber(o, path = []) {
  if (typeof o === 'number') return path
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { const p = firstNumber(v, [...path, k]); if (p) return p }
  return null
}
const setAt = (o, p, v) => { let x = o; for (const k of p.slice(0, -1)) x = x[k]; x[p.at(-1)] = v }
for (const [label, val] of [['float noise 0.3-0.1-0.2 = ' + (0.3 - 0.1 - 0.2), 0.3 - 0.1 - 0.2], ['5e-7', 5e-7], ['1e21', 1e21], ['-1.5e-12', -1.5e-12]]) {
  const d = await conv(); const p = firstNumber(d.profiles); setAt(d.profiles, p, val)
  const text = canonicalJSON(d)
  const sqlHash = psql(`select public.model_hash(${"$j$"}${text}${"$j$"}::jsonb)`).out.trim()
  const jsHash = await sha256Hex(text)
  try {
    const v = await saveModelVersion(a.sb, bld, d, label)
    const back = psql(`select encode(sha256(convert_to(canonical,'UTF8')),'hex') = model_hash from public.model_versions where id='${v.id}'`).out.trim()
    check(`${label}: saves (0003's SQL re-hash ${sqlHash === jsHash ? 'agreed' : 'DISAGREED, so 102 refused it'})`, v.created && back === 't')
  } catch (e) { check(`${label}: saves`, false, e.message) }
}

// Raw calls: astral-plane keys (UTF-16 vs UTF-8 order), and the refusals.
const base = { building: { id: bld }, schema_version: doc.schema_version, weather_ref: { kind: 'legacy', id: 'x' } }
const call = async (obj, over = {}) => {
  const text = typeof obj === 'string' ? obj : canonicalJSON(obj); const h = await sha256Hex(text)
  return a.sb.rpc('create_model_version', { p_building: bld, p_schema_version: doc.schema_version, p_canonical: text,
    p_model_hash: h, p_library_hash: h, p_weather_hash: h, p_parent: null, p_note: null, ...over })
}
{ const t = canonicalJSON({ ...base, '\u{1F600}': 1, '～': 2 }); const x = await call(t)
  const sqlOk = psql(`select public.model_hash(${"$j$"}${t}${"$j$"}::jsonb) = '${await sha256Hex(t)}'`).out.trim()
  check(`astral-plane keys save (0003's SQL order ${sqlOk === 't' ? 'agreed' : 'disagreed'})`, !x.error, x.error?.message) }
{ const x = await call(base, { p_model_hash: 'f'.repeat(64) }); check('wrong hash refused, 23514, both hashes named', x.error?.code === '23514' && /does not match/.test(x.error.message), x.error?.message) }
{ const x = await call({ ...base, building: { id: '00000000-0000-0000-0000-000000000000' } }); check('document naming another building refused', x.error?.code === '23514' && /names building/.test(x.error.message), x.error?.message) }
{ const x = await call(base, { p_schema_version: '9.9' }); check('schema version mismatch refused', x.error?.code === '23514', x.error?.message) }
{ const d = { ...base, weather_ref: { kind: 'epw', file_name: EPW, file_hash: EPW_SHA, station_id: null } }
  const x = await call(d); check('weather_hash not the document\'s EPW hash refused', x.error?.code === '23514' && /EPW hash/.test(x.error.message), x.error?.message) }
{ const b2 = await user('b@example.com'); await org(b2, 'Org B')
  const x = await b2.sb.rpc('create_model_version', { p_building: bld, p_schema_version: '2.0', p_canonical: '{}', p_model_hash: 'a'.repeat(64), p_library_hash: 'a'.repeat(64), p_weather_hash: 'a'.repeat(64) })
  check('another organisation cannot save into this building (42501)', x.error?.code === '42501', x.error?.message) }
{ const r2 = psql(`set role anon; select public.create_model_version('${bld}', '2.0', '{}', '${'a'.repeat(64)}', '${'a'.repeat(64)}', '${'a'.repeat(64)}')`)
  check('anon cannot call it', /permission denied/.test(r2.error?.message ?? ''), r2.error?.message) }
summary()
