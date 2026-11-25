// Brief 129: writes the clubhouse table proving every profile type's template works in the model.
//   cd frontend && npx vite-node ../scripts/sim2_profile_proof.ts -- OUT.json [Type,Type…]
// Fixture and weather: PROOF_FIXTURE / PROOF_EPW (defaults: the project's RWGC preview plan and sample Chicago EPW).
import { runProof } from '../frontend/src/sim2/geometry/__tests__/profileProof'

const args = process.argv.slice(2).filter((a) => a !== '--')
const out = args[0]
const only = (args[1] ?? '').split(',').filter(Boolean)
const FIXTURE = process.env.PROOF_FIXTURE ?? '/mnt/project-files/nza-sim/inputs/rwgc_preview.plan.json'
const EPW = process.env.PROOF_EPW ?? '/mnt/project-files/nza-sim/preview/sample-chicago.epw'
await runProof(FIXTURE, EPW, only, out)
