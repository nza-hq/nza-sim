// Brief 105 Part 4: the construction bodies the run seam resolves `construction_ref.key` against, made from the
// committed Brief 102 export (docs/audit/102/library_export.json). Each body is copied whole, with its epJSON layers,
// and keeps body_hash (the sha256 of its canonical JSON, as the editor's snapshot and fromBuildingConfig pin it).
// Draft items not yet in Chris's library (docs/audit/102/library_additions.json, pending his review) are added after
// the export's, each marked `draft` with its display name, so a run that uses one can say so.
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
const addSrc = join(repo, 'docs/audit/102/library_additions.json')
const addRaw = readFileSync(addSrc)
const add = JSON.parse(addRaw)
const hash = (body) => createHash('sha256').update(canonicalJSON(body)).digest('hex')
const constructions = ex.items.filter((i) => i.kind === 'construction').map(({ key, body }) => ({ key, body_hash: hash(body), body }))
for (const { kind, key, body, provenance } of add.items) {
  if (kind !== 'construction') continue
  if (constructions.some((c) => c.key === key)) throw new Error(`draft "${key}" is already in the export: remove it from library_additions.json`)
  constructions.push({ key, body_hash: hash(body), body, draft: provenance?.display_name ?? key })
}
writeFileSync(out, JSON.stringify({
  _note: 'Made by scripts/sim2_run_constructions.mjs from docs/audit/102/library_export.json and library_additions.json (drafts). Do not edit by hand.',
  source: 'docs/audit/102/library_export.json',
  source_sha256: createHash('sha256').update(raw).digest('hex'),
  exported_at: ex.exported_at,
  additions: 'docs/audit/102/library_additions.json',
  additions_sha256: createHash('sha256').update(addRaw).digest('hex'),
  constructions,
}, null, 1) + '\n')
console.log(`${constructions.length} constructions -> ${out}`)
