/**
 * Brief 102 Part 5 / 102a Part 5: prove the anchor round-trips through NZA Sim's own database.
 * The logic is in scripts/102_anchor_roundtrip_lib.mjs; this is the command line.
 *
 * Three modes:
 *   --emit-sql [--org "NZA"]  No database access. Writes docs/audit/102a/anchor_record.sql and anchor_readback.sql:
 *                             paste the first into the Supabase SQL editor (it records the anchor as the
 *                             organisation's first admin, through the app's own functions and RLS), then the second
 *                             (every *_ok column must be true). No token in a terminal.
 *   --record [--org "NZA"]    With a browser session token: saves the fixture's version and run, then reads back.
 *   (default)                 With a token: read back only.
 *
 * Exit 0 only when the stored document hashes (by its stored text and by its jsonb) to a fresh conversion's hash,
 * a run exists for this engine version, and EUI and total kWh match the reference within the stated tolerances.
 *
 * Environment for the token modes (PowerShell `$env:NAME = '...'`): NZASIM_SUPABASE_URL, NZASIM_SUPABASE_ANON_KEY
 * (or the VITE_ names), NZASIM_ACCESS_TOKEN (an editor's or admin's browser session; see scripts/102_seed_library.mjs).
 * The EPW named by the fixture must be in data/weather/current/.
 *
 * Run (TypeScript imports, so through vite-node from frontend/):
 *   cd frontend; npx vite-node ../scripts/102_anchor_roundtrip.mjs --emit-sql --org "NZA"
 */
import fs from 'node:fs'
import path from 'node:path'

/** Supabase errors are plain objects, not Errors: print what they say and exit 1, never an unreadable rejection. */
function die(e) {
  const msg = e?.message ?? e?.msg ?? (typeof e === 'object' ? JSON.stringify(e) : String(e))
  console.error(`error: ${msg}${e?.code ? ` (code ${e.code})` : ''}${e?.hint ? ` hint: ${e.hint}` : ''}`)
  if (/JWT|jwt|token/.test(msg)) console.error('check NZASIM_ACCESS_TOKEN: a fresh access_token from the signed-in browser tab (it lasts an hour).')
  process.exit(1)
}
process.on('unhandledRejection', die)
process.on('uncaughtException', die)

import * as lib from './102_anchor_roundtrip_lib.mjs'
const argv = process.argv.slice(2)
const orgArg = argv.includes('--org') ? argv[argv.indexOf('--org') + 1] : null

if (argv.includes('--emit-sql')) {
  const org = orgArg ?? 'NZA'
  const { record, readback, templateHash, summary } = await lib.emitSql(org)
  const dir = path.join(lib.REPO, 'docs/audit/102a')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'anchor_record.sql'), record)
  fs.writeFileSync(path.join(dir, 'anchor_readback.sql'), readback)
  console.log(`wrote docs/audit/102a/anchor_record.sql and anchor_readback.sql for organisation "${org}"`)
  console.log(`fixture template hash ${templateHash}; EUI ${summary.eui_kwh_m2}, total ${lib.totalKwh(summary)} kWh`)
  process.exit(0)
}

const URL_ = process.env.NZASIM_SUPABASE_URL ?? process.env.VITE_NZASIM_SUPABASE_URL
const KEY = process.env.NZASIM_SUPABASE_ANON_KEY ?? process.env.VITE_NZASIM_SUPABASE_ANON_KEY
const TOKEN = process.env.NZASIM_ACCESS_TOKEN
if (!URL_ || !KEY || !TOKEN) { console.error('needs NZASIM_SUPABASE_URL, NZASIM_SUPABASE_ANON_KEY and NZASIM_ACCESS_TOKEN (or use --emit-sql)'); process.exit(2) }
if (!/jbjxduathkklruvbmeho/.test(URL_)) { console.error(`refusing: ${URL_} is not NZA Sim (dev)`); process.exit(2) }
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(URL_, KEY, {
  global: { headers: { Authorization: `Bearer ${TOKEN}` } },
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: access, error: accErr } = await sb.rpc('my_access')
if (accErr) die(accErr)
const orgs = access.orgs.filter((o) => (orgArg ? o.name === orgArg : true))
if (orgs.length !== 1) { console.error(`pick one organisation with --org; yours: ${access.orgs.map((o) => o.name).join(', ') || 'none'}`); process.exit(2) }

if (argv.includes('--record')) {
  const r = await lib.recordAnchor(sb, orgs[0].id)
  console.log(`recorded: version ${r.version.id} (${r.version.created ? 'new' : 'existing'}), run ${r.runId}`)
}
const { ok, lines } = await lib.readAnchor(sb, orgs[0].id)
for (const l of lines) console.log(l)
console.log(ok ? 'match' : 'MISMATCH')
process.exit(ok ? 0 : 1)
