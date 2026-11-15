// Brief 103 Part 1: 0005_store_fixes on the local Postgres (QA M4, M6, L2, L6). Run from frontend/:
//   npx vite-node ../scripts/102a_pgtest/test_p6.mjs
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { reset, user, org, check, summary, psql } from './common.mjs'
import { ensureLocalBuilding } from '../../frontend/src/thermal/store/versions.ts'

reset()
const a = await user('a@example.com'); const o = await org(a, 'Org A')
const q = (sql) => psql(sql).out?.trim()
const invite = async (inviter, org_, email, role) => { const x = await inviter.sb.rpc('invite_member', { p_org: org_, p_email: email, p_role: role }); if (x.error) throw x.error; return x.data }

// ── M4: matched by the local project id, never by name ──
const b1 = await ensureLocalBuilding(a.sb, o, 'local-1', 'Hotel')
check('first save creates the project and building', /^[0-9a-f-]{36}$/.test(b1), b1)
check('the same local id finds the same building', (await ensureLocalBuilding(a.sb, o, 'local-1', 'Hotel')) === b1)
const b2 = await ensureLocalBuilding(a.sb, o, 'local-2', 'Hotel')
check('two local projects with the same name stay apart', b2 !== b1)
check('...in two projects', q(`select count(*) from public.projects where org_id='${o}' and name='Hotel'`) === '2')
check('a rename keeps the building (and so its versions)', (await ensureLocalBuilding(a.sb, o, 'local-1', 'Hotel renamed')) === b1)
check('...and the names follow the rename', q(`select p.name || '/' || b.name from public.buildings b join public.projects p on p.id=b.project_id where b.id='${b1}'`) === 'Hotel renamed/Hotel renamed')
{ const x = await a.sb.rpc('ensure_local_building', { p_org: o, p_local_ref: '', p_name: 'X' }); check('an empty local id is refused', x.error?.code === '22023', x.error?.message) }
{ let threw = false; try { await ensureLocalBuilding(a.sb, o, null, 'X') } catch { threw = true }; check('the client refuses a missing local id before calling', threw) }
check('an unnamed project is "Untitled building"', q(`select name from public.buildings where id='${await ensureLocalBuilding(a.sb, o, 'local-3', '  ')}'`) === 'Untitled building')

// A project and building saved before 0005 (by name, no local_ref) are adopted once.
{ const p = (await a.sb.rpc('create_project', { p_org: o, p_name: 'ZZ TEST' })).data
  const old = (await a.sb.rpc('create_building', { p_project: p, p_name: 'ZZ TEST' })).data
  const got = await ensureLocalBuilding(a.sb, o, 'zz-local', 'ZZ TEST')
  check('a pre-0005 project of the same name is adopted, so its history continues', got === old, `${got} vs ${old}`)
  check('...and now carries the local id', q(`select local_ref from public.projects where id='${p}'`) === 'zz-local')
  check('a second local project with that name does not steal it', (await ensureLocalBuilding(a.sb, o, 'zz-other', 'ZZ TEST')) !== old) }

// Viewers cannot save; other organisations cannot use it.
const v = await user('v@example.com'); await v.sb.rpc('accept_invitation_token', { p_token: await invite(a, o, 'v@example.com', 'viewer') })
{ const x = await v.sb.rpc('ensure_local_building', { p_org: o, p_local_ref: 'local-9', p_name: 'X' }); check('a viewer is refused', x.error?.code === '42501', x.error?.message) }
const c = await user('c@example.com'); const oc = await org(c, 'Org C')
{ const x = await c.sb.rpc('ensure_local_building', { p_org: o, p_local_ref: 'local-1', p_name: 'X' }); check('another organisation is refused', x.error?.code === '42501', x.error?.message) }
check('the same local id in another organisation is its own building', (await ensureLocalBuilding(c.sb, oc, 'local-1', 'Hotel')) !== b1)

// Concurrent first saves: two sessions at once, one project and one building.
{ const claims = JSON.stringify({ sub: a.id, email: a.email, role: 'authenticated' }).replace(/'/g, "''")
  const sql = `begin; set local role authenticated; select set_config('request.jwt.claims', '${claims}', true); select public.ensure_local_building('${o}', 'race-1', 'Race'); commit;`
  const run = () => promisify(execFile)('psql', ['-h', process.env.PGHOST ?? '/tmp', '-p', process.env.PGPORT ?? '54329', '-U', 'postgres', '-d', 't', '-At', '-q', '-c', sql])
  const outs = await Promise.all(Array.from({ length: 6 }, run))
  const ids = new Set(outs.map((r) => r.stdout.trim().split('\n').filter((l) => /^[0-9a-f-]{36}$/.test(l)).pop()))
  check('six concurrent first saves return one building', ids.size === 1, [...ids].join(','))
  check('...and leave one project and one building', q(`select count(*) from public.projects where local_ref='race-1'`) === '1' && q(`select count(*) from public.buildings where local_ref='race-1'`) === '1') }

// ── M6: a library version never changes ──
psql(`insert into public.nza_team (user_id) values ('${a.id}') on conflict do nothing`)
const up = (body) => a.sb.rpc('upsert_library_item', { p_org: null, p_kind: 'construction', p_key: 'wall_x', p_version: 1, p_body: body, p_provenance: { source: 'test' } })
const l1 = await up({ u: 1 })
check('a new library version is written', !l1.error && !!l1.data, l1.error?.message)
{ const x = await up({ u: 1 }); check('the same body again is a no-op returning the same id', x.data === l1.data) }
{ const x = await up({ u: 999 }); check('a different body for the same version is refused (23505)', x.error?.code === '23505', x.error?.message)
  check('...and the message says to save a new version', /version 2/.test(x.error?.message ?? ''), x.error?.message) }
check('the stored body is unchanged', q(`select body::text from public.library_items where id='${l1.data}'`) === '{"u": 1}')

// ── L2: the helpers answer only for organisations the caller can read ──
const proj1 = q(`select project_id from public.buildings where id='${b1}'`)
{ const x = await c.sb.rpc('org_of_building', { b: b1 }); check('an outsider gets null from org_of_building', !x.error && x.data === null, JSON.stringify(x)) }
{ const x = await c.sb.rpc('org_of_project', { p: proj1 }); check('...and from org_of_project', !x.error && x.data === null, JSON.stringify(x)) }
{ const x = await a.sb.rpc('org_of_building', { b: b1 }); check('a member still gets the organisation', x.data === o, JSON.stringify(x)) }
{ const x = await a.sb.rpc('admin_count', { p_org: o }); check('admin_count is no longer callable by a signed-in user', x.error?.code === '42501', x.error?.message) }
{ const r = await a.sb.from('buildings').select('id').eq('id', b1); check('RLS reads still work for a member (buildings)', r.data?.length === 1, JSON.stringify(r)) }
{ const r = await v.sb.from('projects').select('id').eq('id', proj1); check('...and for a viewer (projects)', r.data?.length === 1, JSON.stringify(r)) }
{ const r = await c.sb.from('buildings').select('id').eq('id', b1); check('an outsider still reads nothing', r.data?.length === 0, JSON.stringify(r)) }
{ const x = await v.sb.rpc('remove_member', { p_org: o, p_user: v.id }); check('remove_member still works (admin_count runs inside it)', !x.error, x.error?.message) }
{ const x = await a.sb.rpc('remove_member', { p_org: o, p_user: a.id }); check('...and still guards the last admin', x.error?.code === '23514', x.error?.message) }

// ── L6: an admin revokes an unused invitation ──
const tok = await invite(a, o, 'd@example.com', 'editor')
const invId = q(`select id from public.invitations where org_id='${o}' and email='d@example.com'`)
const e = await user('e@example.com'); await e.sb.rpc('accept_invitation_token', { p_token: await invite(a, o, 'e@example.com', 'editor') })
{ const x = await e.sb.rpc('revoke_invitation', { p_invitation: invId }); check('an editor cannot revoke', x.error?.code === '42501', x.error?.message) }
{ const x = await c.sb.rpc('revoke_invitation', { p_invitation: invId }); check('another organisation cannot revoke', x.error?.code === '42501', x.error?.message) }
{ const x = await a.sb.rpc('revoke_invitation', { p_invitation: invId }); check('the admin revokes it', !x.error, x.error?.message) }
const d = await user('d@example.com')
{ const x = await d.sb.rpc('accept_invitation_token', { p_token: tok }); check('a revoked invitation can no longer be accepted', !!x.error, x.error?.message) }
{ const usedId = q(`select id from public.invitations where org_id='${o}' and email='e@example.com'`)
  const x = await a.sb.rpc('revoke_invitation', { p_invitation: usedId }); check('an accepted invitation cannot be revoked', x.error?.code === '23514', x.error?.message) }

check('0005 records itself', q(`select name from supabase_migrations.schema_migrations where version='20261115000005'`) === '0005_store_fixes')
summary()
