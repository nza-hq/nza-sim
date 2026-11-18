// Brief 124 P4 (Linzie 17 Nov 16:35): "assume some basics and then let the user edit the basics". Each space type
// always has a floor finish and a ceiling: typical for the space until someone chooses (finishesOf, Brief 124 D4).
import { useState } from 'react'
import { finishesOf, FINISH_NAME, type SpaceType } from './plan'

const WHY = 'What a finish costs the room\'s thermal mass, from NZA\'s investigation of mass behind finishes (17 Nov 2026): '
  + 'behind a sealed suspended ceiling the slab keeps 70–78 % of the benefit of an exposed one; under carpet, 85–95 %; '
  + 'with both, about 50 %. Carpet and the ceiling tiles are library constructions added on the room\'s face.'

/** One space type's floor finish and ceiling. `show` limits it to one of them (Fabric's floor or roof); `carpeted`: its
 * rooms' floor construction already has carpet in it, so no layer is added (toDocument). */
export function FinishRows({ sp, onSet, label, show = 'both', carpeted = false, info = true }: { sp: SpaceType; onSet: (q: Partial<SpaceType>) => void; label?: string; show?: 'both' | 'floor' | 'ceiling'; carpeted?: boolean; info?: boolean }) {
  const [why, setWhy] = useState(false)
  const f = finishesOf(sp)
  return (
    <>
      {show !== 'ceiling' && <div className="gl-row gl-librow">
        <span>{label ?? 'Floor finish'}{f.floor_typical && <small className="gl-typical"> typical</small>}</span>
        <select className="gl-sel" aria-label={`Floor finish${label ? `, ${label}` : ''}`} value={f.floor} onChange={(e) => onSet({ floor_finish: e.target.value as 'carpet' | 'hard' })}>
          <option value="carpet">{FINISH_NAME.carpet}</option>
          <option value="hard">{FINISH_NAME.hard}</option>
        </select>
      </div>}
      {show !== 'ceiling' && carpeted && (f.floor === 'carpet' || !f.floor_typical) && <p className="gl-hint">{f.floor === 'carpet' ? 'The carpet is already in its ground floor\'s construction, so none is added.' : 'Its ground floor\'s construction already has carpet in it: choose one without for a hard floor.'}</p>}
      {show !== 'floor' && <div className="gl-row gl-librow">
        <span>
          <label><input type="checkbox" aria-label={`Suspended ceiling${label ? `, ${label}` : ''}`} checked={f.ceiling === 'suspended'} onChange={(e) => onSet({ ceiling: e.target.checked ? 'suspended' : 'exposed' })} /> {label ? `${label}: suspended ceiling` : 'Suspended ceiling'}</label>
          <small className="gl-typical">{!label && f.ceiling === 'exposed' ? ` ${FINISH_NAME.exposed.toLowerCase()}` : ''}{f.ceiling_typical ? `${!label && f.ceiling === 'exposed' ? ',' : ''} typical` : ''}</small>
        </span>
        <span className="ap-setc">
          {info && <button type="button" className="gl-info" aria-label="What finishes do to thermal mass" aria-expanded={why} onClick={() => setWhy((w) => !w)}>ⓘ</button>}
        </span>
      </div>}
      {why && <p className="gl-hint">{WHY}</p>}
    </>
  )
}

/** The ⓘ on its own, for Fabric's list of space types. */
export function FinishInfo() {
  const [why, setWhy] = useState(false)
  return <>
    <button type="button" className="gl-info" aria-label="What finishes do to thermal mass" aria-expanded={why} onClick={() => setWhy((w) => !w)}>ⓘ</button>
    {why && <p className="gl-hint">{WHY}</p>}
  </>
}
