/** /model: the Model workspace with the editor's steps in it (Brief 110), saved and reopened as model versions. */
import { useContext, useRef, useState } from 'react'
// @ts-expect-error plain JS context
import { ProjectContext } from '../../context/ProjectContext.jsx'
import { useSearchParams } from 'react-router-dom'
import GeometryLab from '../geometry/GeometryLab'
import ModelExamples from './ModelExamples'
import ModelSave, { type EditorApi } from './ModelSave'
import ModelWorkspace from './ModelWorkspace'
import type { StepId } from './steps'

export default function ModelPage() {
  const [, setParams] = useSearchParams()
  const onStep = (s: StepId) => setParams((p) => { p.set('step', s); return p }, { replace: true })
  const api = useRef<EditorApi | null>(null)
  const [plan, setPlan] = useState<unknown>(null)
  const project = useContext(ProjectContext) as { params?: { name?: string }; updateParam?: (k: string, v: unknown) => void } | null
  return (
    <ModelWorkspace
      header={<><ModelSave api={api} plan={plan} /><ModelExamples api={api} plan={plan} /></>}
      render={({ step, slots, centre, setCentre, openRight }) => <GeometryLab slots={slots} step={step} onStep={onStep} centreTab={centre} onCentreTab={setCentre} onOpenRight={openRight} api={api} onPlan={setPlan} projectName={project?.params?.name ?? ''} renameProject={(n) => project?.updateParam?.('name', n)} />}
    />
  )
}
