/** /model: the Model workspace with the editor's steps in it (Brief 110 P2). */
import { useSearchParams } from 'react-router-dom'
import GeometryLab from '../geometry/GeometryLab'
import ModelWorkspace from './ModelWorkspace'
import type { StepId } from './steps'

export default function ModelPage() {
  const [, setParams] = useSearchParams()
  const onStep = (s: StepId) => setParams((p) => { p.set('step', s); return p }, { replace: true })
  return <ModelWorkspace render={({ step, slots }) => <GeometryLab slots={slots} step={step} onStep={onStep} />} />
}
