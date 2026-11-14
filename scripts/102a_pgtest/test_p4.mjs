import { REPO, reset, user, org, check, summary, psql } from './common.mjs'
reset()
const a = await user('a@example.com'); const o = await org(a, 'Org A')
const role = (u) => psql(`select role || '/' || status from public.memberships where org_id='${o}' and user_id='${u.id}'`).out.trim()
const admins = () => psql(`select public.admin_count('${o}')`).out.trim()
const invite = async (email, r) => { const x = await a.sb.rpc('invite_member', { p_org: o, p_email: email, p_role: r }); if (x.error) throw x.error; return x.data }
// QA's case: the sole admin accepts a viewer invitation to their own email.
{ const t = await invite('a@example.com', 'viewer'); const x = await a.sb.rpc('accept_invitation_token', { p_token: t })
  check('sole admin accepting a viewer invite to own email: accepted', !x.error && x.data === o, x.error?.message)
  check('...and is still admin; admin_count 1', role(a) === 'admin/active' && admins() === '1', `${role(a)}, admins ${admins()}`) }
// A viewer invited up becomes editor; an editor invited as viewer stays editor.
const b = await user('b@example.com')
{ await b.sb.rpc('accept_invitation_token', { p_token: await invite('b@example.com', 'viewer') }); check('new member joins with the invited role', role(b) === 'viewer/active', role(b)) }
{ await b.sb.rpc('accept_invitation_token', { p_token: await invite('b@example.com', 'editor') }); check('an invitation can raise a role', role(b) === 'editor/active', role(b)) }
{ await b.sb.rpc('accept_invitation_token', { p_token: await invite('b@example.com', 'viewer') }); check('an invitation never lowers one', role(b) === 'editor/active', role(b)) }
// A removed member rejoins with the invited role.
{ const x = await a.sb.rpc('remove_member', { p_org: o, p_user: b.id }); check('admin removes b', !x.error, x.error?.message)
  await b.sb.rpc('accept_invitation_token', { p_token: await invite('b@example.com', 'viewer') }); check('a removed member rejoins with the invited role', role(b) === 'viewer/active', role(b)) }
// The last-admin guards still hold elsewhere.
{ const x = await a.sb.rpc('set_member_role', { p_org: o, p_user: a.id, p_role: 'viewer' }); check('set_member_role still refuses demoting the last admin', !!x.error, x.error?.message) }
{ const t = await invite('c@example.com', 'editor'); const x = await b.sb.rpc('accept_invitation_token', { p_token: t }); check('an invitation for another email is refused', x.error?.code === '42501', x.error?.message) }
summary()
