import { REPO, fx, EPW, EPW_SHA, reset, user, org, check, summary, psql } from './common.mjs'
import { fromBuildingConfig } from '../../frontend/src/thermal/schema/fromBuildingConfig.ts'
import { ensureBuilding, ensureProject, saveModelVersion, recordRun, INSTANT_ENGINE_VERSION, INSTANT_SOURCE } from '../../frontend/src/thermal/store/versions.ts'

reset()
const summaryA = { eui_kwh_m2: 132.6, annual_by_end_use: { heating: 1 }, annual_by_fuel: { electricity: 1 } }
const summaryB = { eui_kwh_m2: 999, annual_by_end_use: { heating: 2 }, annual_by_fuel: { electricity: 2 } }
async function setup(email, name) {
  const u = await user(email); const o = await org(u, name)
  const b = await ensureBuilding(u.sb, await ensureProject(u.sb, o, 'Anchor'), 'Anchor')
  const doc = (await fromBuildingConfig({ building_config: fx.building_config, construction_choices: fx.construction_choices,
    comfort_band: fx.comfort_band, library_constructions: fx.library_constructions, building_id: b,
    weather: { file_name: EPW, file_hash: EPW_SHA } })).document
  return { u, o, b, v: await saveModelVersion(u.sb, b, doc, null) }
}
const A = await setup('a@example.com', 'Org A'); const B = await setup('b@example.com', 'Org B')

// QA's case, forced: give B's version A's model_hash (as postgres), as if both stored one document.
psql(`update public.model_versions set model_hash = (select model_hash from public.model_versions where id='${A.v.id}'), library_hash = (select library_hash from public.model_versions where id='${A.v.id}') where id='${B.v.id}'`)
const ra = await recordRun(A.u.sb, A.v.id, {}, summaryA, INSTANT_ENGINE_VERSION, INSTANT_SOURCE)
const rb = await recordRun(B.u.sb, B.v.id, {}, summaryB, INSTANT_ENGINE_VERSION, INSTANT_SOURCE)
check('same four hashes in two organisations: two runs, not one', ra !== rb, `${ra.slice(0, 8)} vs ${rb.slice(0, 8)}`)
const bRead = await B.u.sb.from('runs').select('id, summary').eq('model_version_id', B.v.id)
check('B reads its own run, with its own number', bRead.data?.length === 1 && bRead.data[0].id === rb && bRead.data[0].summary.eui_kwh_m2 === 999)
const bOfA = await B.u.sb.from('runs').select('id').eq('id', ra)
check('B still cannot read A\'s run', bOfA.data?.length === 0)
check('a repeat returns the same run, adds nothing', (await recordRun(A.u.sb, A.v.id, {}, summaryB, INSTANT_ENGINE_VERSION, INSTANT_SOURCE)) === ra
  && psql(`select count(*) from public.runs where model_version_id='${A.v.id}'`).out.trim() === '1')
check('and keeps the first number (runs are never updated)', psql(`select summary->>'eui_kwh_m2' from public.runs where id='${ra}'`).out.trim() === '132.6')
const other = await recordRun(A.u.sb, A.v.id, {}, summaryA, 'instant-1+' + '0'.repeat(24), INSTANT_SOURCE)
check('another engine version is another run', other !== ra)
// A lost race: the row exists before the insert (the select-then-insert of 0002 raised 23505 here).
const race = psql(`begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${A.u.id}","role":"authenticated"}', true);
  select public.record_run('${A.v.id}', '${INSTANT_ENGINE_VERSION}', '{}', '{}', 'x') = '${ra}'; commit;`)
check('insert conflict returns the existing row, no 23505', race.out?.trim().split('\n').pop() === 't', race.error?.message)
{ const x = await B.u.sb.rpc('record_run', { p_version: A.v.id, p_engine_version: 'x', p_results: {}, p_summary: {}, p_source: 'x' })
  check('B cannot record a run on A\'s version (42501)', x.error?.code === '42501', x.error?.message) }
summary()
