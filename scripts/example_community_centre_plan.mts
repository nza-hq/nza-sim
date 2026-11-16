/**
 * Worked example (16 Nov 2026): makes docs/examples/community_centre.plan.json from the base plan written by
 * scripts/example_community_centre_base.py (outline, rooms, zones, windows, space types, systems, emitters), then
 * applies construction sets with the editor's own applySet, as the Fabric step's "Apply" does: "Enhanced fabric" to
 * every room, then "Timber frame, pitched roof" to the main hall.
 *
 * Run from frontend/:  npx vite-node ../scripts/example_community_centre_plan.mts <base.plan.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { applySet, setById } from '../frontend/src/sim2/geometry/applySet'
import { upgradePlan } from '../frontend/src/sim2/geometry/plan'

const root = path.resolve(__dirname, '..')
const base = JSON.parse(readFileSync(process.argv[2]!, 'utf8'))
let plan = upgradePlan(base.plan)
plan = applySet(plan, setById('set_enhanced')!, plan.rooms.map((r) => r.id))
plan = applySet(plan, setById('set_timber')!, plan.rooms.filter((r) => r.name === 'Main hall').map((r) => r.id))
writeFileSync(path.join(root, 'docs/examples/community_centre.plan.json'), JSON.stringify({ _note: base._note, plan }, null, 1) + '\n')
console.log(plan.fabric_types.map((t) => `${t.id} ${t.name} ${t.construction}`).join('\n'), '\nset:', plan.fabric_set, 'spans:', plan.wall_spans.length)
