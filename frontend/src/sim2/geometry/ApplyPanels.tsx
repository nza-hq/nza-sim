/**
 * Steps 3 to 5 (Fabric, Spaces, Systems) share one way of working, the same on every step:
 *
 *   left   = what you are choosing: the whole building, its zones and rooms (Ctrl or Shift for more). The drawing in the
 *            middle chooses too (rooms, or a room's part of a wall), and shows what each has.
 *   right  = what to give them: the kinds (icons), the types made for this project (make one, copy one, change one),
 *            and one Apply button for what is chosen, or the whole building.
 *
 * These are the two panels' frames; what goes in a type's detail is the step's own (GeometryLab).
 */
import type { ReactNode } from 'react'
import Icon, { type IconName } from '../icons/Icon'

export type Swatch = { colour: string; unset?: boolean }
export type Row = { id: string; name: string; zone?: string; area: string; has: { name: string; swatch: Swatch } | null }

const swatchStyle = (s: Swatch) => (s.unset ? { background: `repeating-linear-gradient(135deg, #fff 0 3px, ${s.colour} 3px 5px)`, borderColor: s.colour } : { background: s.colour, borderColor: s.colour })
export const Sw = ({ s }: { s: Swatch }) => <span className="gl-sw" style={swatchStyle(s)} />

/** Left: the building, its zones and rooms, each with what it has now. A tap chooses only that; Ctrl or Shift adds or
 * takes away. A zone's row chooses its rooms. */
export function ChooseList(props: {
  rows: Row[]
  zones: Array<{ id: string; name: string }>
  chosen: ReadonlySet<string>
  whole: { area: string }
  extra?: ReactNode
  onChoose: (ids: string[], add: boolean) => void
  onNone: () => void
}) {
  const { rows, zones, chosen } = props
  const all = rows.length > 0 && rows.every((r) => chosen.has(r.id))
  const tick = (on: boolean, part = false) => <span className={`ap-tick${on ? ' on' : part ? ' part' : ''}`} aria-hidden="true" />
  const add = (e: React.MouseEvent) => e.shiftKey || e.ctrlKey || e.metaKey
  return (
    <div className="gl-sec ap-choose">
      <h3>Choose <small>{chosen.size ? `${chosen.size} of ${rows.length} rooms` : 'nothing yet'}{chosen.size > 0 && <button type="button" className="ap-link" onClick={props.onNone}>Clear</button>}</small></h3>
      <div className="ap-rows" role="listbox" aria-multiselectable="true" aria-label="Rooms">
        <div className="ap-row ap-whole" role="option" aria-selected={all} onClick={() => props.onChoose(all ? [] : rows.map((r) => r.id), false)}>
          {tick(all, chosen.size > 0)}
          <Icon name="building" size={18} />
          <b>Whole building</b>
          <small>{props.whole.area}</small>
        </div>
        {zones.map((z) => {
          const rs = rows.filter((r) => r.zone === z.id)
          if (!rs.length) return null
          const on = rs.every((r) => chosen.has(r.id))
          return (
            <div key={z.id} className="ap-zone">
              {zones.length > 1 && (
                <div className="ap-row ap-zonehead" role="option" aria-selected={on} onClick={(e) => props.onChoose(rs.map((r) => r.id), add(e))}>
                  {tick(on, rs.some((r) => chosen.has(r.id)))}
                  <span>{z.name}</span>
                </div>
              )}
              {rs.map((r) => (
                <div key={r.id} className={`ap-row ap-room${zones.length > 1 ? ' in' : ''}`} role="option" aria-selected={chosen.has(r.id)} onClick={(e) => props.onChoose([r.id], add(e))}>
                  {tick(chosen.has(r.id))}
                  <span className="ap-name">{r.name}<small>{r.area}</small></span>
                  {r.has ? <span className="ap-has" title={r.has.name}><Sw s={r.has.swatch} />{r.has.name}</span> : <span className="ap-has none">—</span>}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {props.extra}
      <p className="gl-hint">Tap a room here or on the drawing; Ctrl or Shift adds more. Esc lets go.</p>
    </div>
  )
}

export type Kind = { key: string; name: string; icon: IconName }
export type Item = { id: string; name: string; swatch: Swatch; line: string; used: string; removable: boolean }

/** Right: the kinds along the top, this project's types of the kind, the chosen type's detail, and Apply. */
export function GivePanel(props: {
  kinds?: Kind[]
  kind?: string
  onKind?: (k: string) => void
  title: string
  icon?: IconName
  items: Item[]
  active: string | null
  onActive: (id: string) => void
  onNew?: () => void
  newLabel?: string
  onCopy?: (id: string) => void
  onRemove?: (id: string) => void
  detail?: ReactNode
  /** Under the title: a choice within the kind (windows or doors). */
  top?: ReactNode
  /** Instead of types: a note (a whole-building value has nothing to apply). */
  body?: ReactNode
  give?: {
    what: string; now: string | null; why: string | null; label: string; onApply: () => void; onAll: () => void
    /** Preview, then apply: the card asking to make the previewed change. */
    preview?: { same: boolean; ask: string; change: string; effect: string | null; onApply: () => void; onCancel: () => void } | null
  } | null
}) {
  const active = props.items.find((x) => x.id === props.active)
  return (
    <aside className="gl-panel gl-right ap-give" aria-label="Give">
      {props.kinds && (
        <div className="ap-kinds" role="tablist" aria-label="Kind">
          {props.kinds.map((k) => (
            <button key={k.key} type="button" role="tab" aria-selected={k.key === props.kind} onClick={() => props.onKind?.(k.key)} title={k.name}>
              <Icon name={k.icon} size={30} />
              <span>{k.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="gl-body">
        <div className="gl-sec">
          <h3 className="ap-title">{props.icon && <Icon name={props.icon} size={20} />}{props.title}</h3>
          {props.top}
          {props.body}
          {!props.body && (
            <>
              <div className="ap-items" role="radiogroup" aria-label={props.title}>
                {props.items.map((x) => (
                  <div key={x.id} className="ap-item" role="radio" aria-checked={x.id === props.active} tabIndex={0} onClick={() => props.onActive(x.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && props.onActive(x.id)}>
                    <span className="ap-radio" aria-hidden="true" />
                    <Sw s={x.swatch} />
                    <span className="ap-iname">{x.name}<small className={x.swatch.unset ? 'unset' : ''}>{x.line}</small></span>
                    <small className="ap-used">{x.used}</small>
                  </div>
                ))}
                {!props.items.length && <p className="gl-hint">None made yet.</p>}
              </div>
              <div className="gl-btns">
                {props.onNew && <button type="button" className="gl-btn quiet" onClick={props.onNew}>+ {props.newLabel ?? 'New type'}</button>}
                {active && props.onCopy && <button type="button" className="gl-btn quiet" onClick={() => props.onCopy!(active.id)}>Copy</button>}
                {active && props.onRemove && active.removable && <button type="button" className="gl-btn quiet" onClick={() => props.onRemove!(active.id)}>Delete</button>}
              </div>
            </>
          )}
        </div>
        {active && props.detail && <div className="gl-sec ap-detail">{props.detail}</div>}
      </div>
      {props.give?.preview ? (
        <div className="ap-foot ap-card" role="dialog" aria-label="Apply this change?">
          {props.give.preview.same ? (
            <>
              <p className="ap-what">These already have it: nothing would change.</p>
              <button type="button" className="gl-btn quiet" onClick={props.give.preview.onCancel}>Close</button>
            </>
          ) : (
            <>
              <p className="ap-ask">{props.give.preview.ask}</p>
              <p className="ap-eff">{props.give.preview.change}{props.give.preview.effect && <><br />{props.give.preview.effect}</>}</p>
              <div className="ap-card-btns">
                <button type="button" className="gl-btn ap-apply" onClick={props.give.preview.onApply} autoFocus>Apply</button>
                <button type="button" className="gl-btn quiet" onClick={props.give.preview.onCancel}>Cancel</button>
              </div>
              <p className="ap-keys"><kbd>Enter</kbd> applies · <kbd>Esc</kbd> cancels</p>
            </>
          )}
        </div>
      ) : props.give && (
        <div className="ap-foot">
          <p className="ap-what">{props.give.what}</p>
          {props.give.now && <p className="ap-now">{props.give.now}</p>}
          <button type="button" className="gl-btn ap-apply" disabled={!!props.give.why} onClick={props.give.onApply}>{props.give.label}</button>
          {props.give.why && <p className="ap-why">{props.give.why}</p>}
          <button type="button" className="ap-link" onClick={props.give.onAll}>Preview on the whole building</button>
        </div>
      )}
    </aside>
  )
}
