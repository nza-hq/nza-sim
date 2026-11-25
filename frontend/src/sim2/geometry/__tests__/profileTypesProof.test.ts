/**
 * Brief 129 (Linzie, 25 Nov 2026: "for every type of profile, including window opening, create a template to prove that
 * it works in the model"). On the clubhouse (RWGC), each profile type's library template is put into the model in place
 * of what it had, the year is run, and the result must move the way that type acts (profileProof.ts). Nothing is tuned.
 *
 * Opt-in (each clubhouse year is about 40 s): PROOF=1 npx vitest run --pool=forks profileTypesProof. The table itself is
 * written by `npx vite-node scripts/sim2_profile_proof.ts`, outside the test runner.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runProof } from './profileProof'

const FIXTURE = process.env.PROOF_FIXTURE ?? '/mnt/project-files/nza-sim/inputs/rwgc_preview.plan.json'
const EPW = process.env.PROOF_EPW ?? '/mnt/project-files/nza-sim/preview/sample-chicago.epw'
const ON = process.env.PROOF === '1' && existsSync(FIXTURE) && existsSync(EPW)

describe.skipIf(!ON)('every profile type works in the model (clubhouse, Brief 129)', () => {
  it('each type\'s template moves the result', async () => {
    const { rows } = await runProof(FIXTURE, EPW, (process.env.PROOF_ONLY ?? '').split(',').filter(Boolean))
    for (const r of rows) expect(Math.abs(r.after - r.before), r.type).toBeGreaterThan(Math.abs(r.before) * 1e-4)
  }, 1_800_000)
})
