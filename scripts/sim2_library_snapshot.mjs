// Sim2 prototype: a slim, read-only snapshot of NZA Sim's library for the geometry prototype's Fabric and Spaces
// steps, made from the committed Brief 102 export (docs/audit/102/library_export.json). Nothing is invented: every
// value is copied from an exported library row, and the export's sha256 and date travel with it. Re-run after a new
// export:  node --experimental-transform-types scripts/sim2_library_snapshot.mjs
// Each item keeps body_hash, the sha256 of its body's canonical JSON (the same hash today's fromBuildingConfig pins
// in library_refs), so a model document can pin what it used.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(repo, 'docs/audit/102/library_export.json')
const out = join(repo, 'frontend/src/sim2/library/snapshot.json')
const raw = readFileSync(src)
const ex = JSON.parse(raw)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const { canonicalJSON } = await import('../frontend/src/thermal/schema/canonical.ts')
// Drafted items awaiting Chris's review (docs/audit/102/library_additions.json) come too, flagged pending.
const addRaw = readFileSync(join(repo, 'docs/audit/102/library_additions.json'))
const additions = JSON.parse(addRaw).items.map((i) => ({ ...i, pending: true }))
const items = [...ex.items, ...additions].map((i) => ({ ...i, hash: createHash('sha256').update(canonicalJSON(i.body)).digest('hex') }))
const constructions = items.filter((i) => i.kind === 'construction').map(({ key, body, provenance, hash, pending }) => ({
  key,
  body_hash: hash,
  ...(pending ? { pending: true } : {}),
  // wall | glazing | roof | floor | interior; an interior wall (key interior_wall_*) is a wall between zones.
  element: body.type === 'interior' && key.startsWith('interior_wall') ? 'partition' : body.type,
  name: provenance?.display_name ?? body.description ?? key,
  u: num(body.u_value_W_per_m2K),
  g: num(body.g_value),
}))
const systems = items.filter((i) => i.kind === 'system_template').map(({ key, body, hash }) => ({
  key,
  body_hash: hash,
  name: body.display_name ?? key,
  type: body.type ?? null, // vrf, mvhr, mev, gas_boiler, …
  category: body.category, // heating | cooling | hvac | ventilation | dhw
  serves: body.serves ?? null,
  fuel: body.fuel_type ?? null,
  scop: num(body.scop) ?? num(body.heating_cop),
  seer: num(body.seer) ?? num(body.cooling_eer),
  efficiency: num(body.efficiency_value),
  efficiency_type: body.efficiency_type ?? null,
  sfp: num(body.specific_fan_power) ?? num(body.sfp),
  heat_recovery: num(body.heat_recovery_efficiency),
}))
const profiles = items.filter((i) => i.kind === 'profile').map(({ key, body, hash }) => ({
  key,
  body_hash: hash,
  name: body.display_name ?? key,
  schedule_type: body.schedule_type,
  building_type: body.building_type ?? null,
  zone_type: body.zone_type ?? null,
  day_types: body.day_types ?? null,
  monthly_multipliers: body.monthly_multipliers ?? null,
}))
const snap = {
  _note: 'Made by scripts/sim2_library_snapshot.mjs from docs/audit/102/library_export.json. Do not edit by hand.',
  source: 'docs/audit/102/library_export.json',
  source_sha256: createHash('sha256').update(raw).digest('hex'),
  exported_at: ex.exported_at,
  additions_sha256: createHash('sha256').update(addRaw).digest('hex'),
  constructions,
  systems,
  profiles,
}
writeFileSync(out, JSON.stringify(snap, null, 1) + '\n')
console.log(`${constructions.length} constructions, ${systems.length} systems, ${profiles.length} profiles -> ${out}`)
