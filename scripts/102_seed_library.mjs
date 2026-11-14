/**
 * Brief 102 Part 3: seed NZA Sim's global library (public.library_items, org_id null) from
 * docs/audit/102/library_export.json through `upsert_library_item`, as a signed-in NZA team user.
 *
 * Dry run by default: writes nothing. `--apply` writes. Never a service-role key: it calls the API with the
 * anon key and the user's own session, so RLS and the function's NZA-team check apply.
 *
 * Versions: for each (kind, key) it reads the newest global row. Same body (canonical JSON) → nothing to do.
 * Different body → the next version. None → version 1. So `--apply` twice adds no rows, and an edited item is a
 * new version, never a silent overwrite (upsert_library_item returns the existing row for an existing version).
 *
 * Environment (PowerShell: `$env:NAME = '...'`):
 *   NZASIM_SUPABASE_URL       (or VITE_NZASIM_SUPABASE_URL)       https://jbjxduathkklruvbmeho.supabase.co
 *   NZASIM_SUPABASE_ANON_KEY  (or VITE_NZASIM_SUPABASE_ANON_KEY)  the publishable key
 *   NZASIM_ACCESS_TOKEN       the NZA-team user's access token, from a browser session (below)
 *
 * The session: sign in to the app (magic link), then in that tab's browser console run
 *   JSON.parse(localStorage['sb-jbjxduathkklruvbmeho-auth-token']).access_token
 * and set the result as NZASIM_ACCESS_TOKEN. It lasts an hour; never commit or log it.
 * (The project's emails carry a link, not a code, until custom SMTP lets the template change; 04_auth_config.md.)
 *
 * Run, from the repo root:
 *   node scripts/102_seed_library.mjs           counts from the export only; with the env set, the plan (no writes)
 *   node scripts/102_seed_library.mjs --apply
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const APPLY = flag('--apply')
const FILE = path.resolve(REPO, opt('--file') ?? 'docs/audit/102/library_export.json')
const KINDS = ['construction', 'profile', 'system_template', 'age_band_default', 'weather']

/** Sorted-key JSON, for comparing bodies regardless of key order (the same rule as canonical.ts). */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  }
  return JSON.stringify(Object.is(v, -0) ? 0 : v)
}

const exp = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const items = exp.items
const counts = {}
for (const it of items) {
  if (!KINDS.includes(it.kind)) throw new Error(`unknown kind ${it.kind} on ${it.key}`)
  counts[it.kind] = (counts[it.kind] ?? 0) + 1
}
console.log(`export: ${path.relative(REPO, FILE)} (exported ${exp.exported_at} on ${exp.machine}, db ${String(exp.source_db_sha256).slice(0, 12)}…)`)
console.log('items per kind:', JSON.stringify(counts))

const URL_ = process.env.NZASIM_SUPABASE_URL ?? process.env.VITE_NZASIM_SUPABASE_URL
const KEY = process.env.NZASIM_SUPABASE_ANON_KEY ?? process.env.VITE_NZASIM_SUPABASE_ANON_KEY
if (!URL_ || !KEY || !process.env.NZASIM_ACCESS_TOKEN) {
  if (APPLY) { console.error('--apply needs NZASIM_SUPABASE_URL, NZASIM_SUPABASE_ANON_KEY and NZASIM_ACCESS_TOKEN (see the header)'); process.exit(2) }
  console.log('dry run: no project or session configured, so nothing was read or written.')
  process.exit(0)
}
if (/jbjxduathkklruvbmeho/.test(URL_) === false) {
  console.error(`refusing: ${URL_} is not NZA Sim (dev). Prod is seeded on Chris's word only.`)
  process.exit(2)
}

async function call(method, p, body, token) {
  const r = await fetch(`${URL_}${p}`, {
    method,
    headers: { apikey: KEY, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  const data = text ? JSON.parse(text) : null
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${data?.code ?? ''} ${data?.message ?? data?.msg ?? text}`)
  return data
}

const token = process.env.NZASIM_ACCESS_TOKEN

const access = await call('POST', '/rest/v1/rpc/my_access', {}, token)
if (!access?.nza_team) { console.error('this user is not in nza_team: global library items cannot be written'); process.exit(2) }

const existing = await call('GET', '/rest/v1/library_items?select=kind,key,version,body&org_id=is.null&order=version.desc&limit=10000', undefined, token)
const latest = new Map()
for (const r of existing) { const k = `${r.kind}\u0000${r.key}`; if (!latest.has(k)) latest.set(k, r) }

const plan = { unchanged: 0, new: 0, new_version: 0 }
const writes = []
for (const it of items) {
  const cur = latest.get(`${it.kind}\u0000${it.key}`)
  if (cur && canon(cur.body) === canon(it.body)) { plan.unchanged++; continue }
  const version = cur ? cur.version + 1 : 1
  plan[cur ? 'new_version' : 'new']++
  writes.push({ ...it, version })
}
console.log(`global rows already in NZA Sim: ${existing.length}`)
console.log('plan:', JSON.stringify(plan))
for (const w of writes) console.log(`  ${APPLY ? 'write' : 'would write'} ${w.kind} ${w.key} v${w.version}`)

if (!APPLY) { console.log('dry run: nothing written (add --apply).'); process.exit(0) }

for (const w of writes) {
  await call('POST', '/rest/v1/rpc/upsert_library_item', {
    p_org: null, p_kind: w.kind, p_key: w.key, p_version: w.version, p_body: w.body,
    p_provenance: { ...w.provenance, exported_at: exp.exported_at, machine: exp.machine, source_db_sha256: exp.source_db_sha256 },
  }, token)
}
const after = await call('GET', '/rest/v1/library_items?select=kind&org_id=is.null&limit=10000', undefined, token)
const byKind = {}
for (const r of after) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
console.log(`applied ${writes.length}. global rows per kind now:`, JSON.stringify(byKind))
