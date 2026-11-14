import { REPO, reset, user, org, check, summary, psql } from './common.mjs'
import * as lib from '../102_anchor_roundtrip_lib.mjs'
import fs from 'node:fs'
reset()
const a = await user('admin@example.com'); const o = await org(a, 'NZA')
const viewer = await user('v@example.com')
const P = (f) => psql(fs.readFileSync(`${REPO}/docs/audit/102a/${f}`, 'utf8'))
const rec1 = P('anchor_record.sql'); check('emitted record SQL runs in the editor (as postgres, switching to the admin)', !rec1.error, rec1.error?.message)
const counts = () => psql(`select (select count(*) from public.model_versions)||'/'||(select count(*) from public.runs)||'/'||(select count(*) from public.buildings)`).out.trim()
check('one building, one version, one run', counts() === '1/1/1', counts())
const rec2 = P('anchor_record.sql'); check('running it again adds nothing', !rec2.error && counts() === '1/1/1', rec2.error?.message ?? counts())
const who = psql(`select created_by = '${a.id}' from public.model_versions`).out.trim()
check('the version is recorded as the organisation\'s admin, not the editor superuser', who === 't')
const rb = psql(fs.readFileSync(`${REPO}/docs/audit/102a/anchor_readback.sql`, 'utf8').replace(/;\s*$/, '').replace(/^select /m, 'select row_to_json(t) from (select ') + ') t')
console.log('readback:', rb.out?.trim() ?? rb.error?.message)
const row = JSON.parse(rb.out.trim())
check('read-back: every *_ok column true', Object.entries(row).filter(([k]) => k.endsWith('_ok')).every(([, v]) => v === true))
// The token path, through the real versions.ts against the same rows: it finds and verifies what the SQL stored.
const r = await lib.readAnchor(a.sb, o); r.lines.forEach((l) => console.log('  ' + l))
check('readAnchor (the token path) verifies the SQL-recorded anchor', r.ok)
const rr = await lib.recordAnchor(a.sb, o)
check('recordAnchor on top adds nothing (same version, same run)', !rr.version.created && counts() === '1/1/1', counts())
// Tamper: a stored document that differs from the fixture must fail the read-back.
psql(`update public.model_versions set canonical = replace(canonical, '"name":"', '"name":"X')`)
const bad = await lib.readAnchor(a.sb, o)
check('a tampered stored text fails readAnchor', !bad.ok, bad.lines[0])
const rb2 = JSON.parse(psql(fs.readFileSync(`${REPO}/docs/audit/102a/anchor_readback.sql`, 'utf8').replace(/;\s*$/, '').replace(/^select /m, 'select row_to_json(t) from (select ') + ') t').out.trim())
check('...and the SQL read-back', rb2.stored_text_hash_ok === false && rb2.same_document_as_javascript_ok === false)
// Without 0004 the record SQL refuses up front.
psql(`delete from supabase_migrations.schema_migrations where name = '0004_qa_fixes'`)
const no4 = P('anchor_record.sql'); check('without 0004 recorded, the record SQL refuses with a clear message', /apply supabase\/migrations\/0004_qa_fixes.sql first/.test(no4.error?.message ?? ''), no4.error?.message)
summary()
