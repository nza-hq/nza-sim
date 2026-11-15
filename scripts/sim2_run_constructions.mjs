// Brief 105 Part 4: the construction bodies the run seam resolves `construction_ref.key` against, made from the
// committed Brief 102 export (docs/audit/102/library_export.json). Each body is copied whole, with its epJSON layers,
// and keeps body_hash (the sha256 of its canonical JSON, as the editor's snapshot and fromBuildingConfig pin it).
// This is the one file to replace when the seam reads NZA Sim's own Supabase library.
// Re-run after a new export:  node --experimental-transform-types scripts/sim2_run_constructions.mjs
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(repo, 'docs/audit/102/library_export.json')
const out = join(repo, 'frontend/src/sim2/run/constructions.json')
const raw = readFileSync(src)
const ex = JSON.parse(raw)
const { canonicalJSON } = await import('../frontend/src/thermal/schema/canonical.ts')
const constructions = ex.items.filter((i) => i.kind === 'construction').map(({ key, body }) => ({
  key, body_hash: createHash('sha256').update(canonicalJSON(body)).digest('hex'), body,
}))
writeFileSync(out, JSON.stringify({
  _note: 'Made by scripts/sim2_run_constructions.mjs from docs/audit/102/library_export.json. Do not edit by hand.',
  source: 'docs/audit/102/library_export.json',
  source_sha256: createHash('sha256').update(raw).digest('hex'),
  exported_at: ex.exported_at,
  constructions,
}, null, 1) + '\n')
console.log(`${constructions.length} constructions -> ${out}`)
