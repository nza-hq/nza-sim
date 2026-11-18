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
import { createContext, type ReactNode, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
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
  /** Navigate by: rooms (the list below), or the project's things of one kind, each with the rooms it reaches. */
  nav?: { by: string; tabs: Array<{ key: string; name: string; icon?: IconName }>; onBy: (k: string) => void; sections: NavSection[] }
  /** Brief 118 P2: zones are made, filled and named here. */
  onNewZone?: () => void
  onMoveTo?: (zone: string) => void
  onRenameZone?: (id: string, name: string) => void
  onRenameRoom?: (id: string, name: string) => void
  onRemoveZone?: (id: string) => void
  /** The line under the list; null for none. */
  hint?: string | null
}) {
  const { rows, zones, chosen, nav } = props
  const all = rows.length > 0 && rows.every((r) => chosen.has(r.id))
  const tick = (on: boolean, part = false) => <span className={`ap-tick${on ? ' on' : part ? ' part' : ''}`} aria-hidden="true" />
  const add = (e: React.MouseEvent) => e.shiftKey || e.ctrlKey || e.metaKey
  return (
    <div className="gl-sec ap-choose">
      {nav && (
        <div className="ap-navby" role="tablist" aria-label="Navigate by">
          {nav.tabs.map((t) => <button key={t.key} type="button" role="tab" aria-selected={nav.by === t.key} onClick={() => nav.onBy(t.key)} title={t.name}>{t.icon && <Icon name={t.icon} size={18} />}<span>{t.name}</span></button>)}
        </div>
      )}
      <h3>{nav && nav.by !== 'rooms' ? 'In this project' : 'Choose'} <small>{chosen.size ? `${chosen.size} of ${rows.length} rooms` : nav && nav.by !== 'rooms' ? '' : 'nothing yet'}{chosen.size > 0 && <button type="button" className="ap-link" onClick={props.onNone}>Clear</button>}</small></h3>
      {nav && nav.by !== 'rooms' ? <NavItems sections={nav.sections} rows={rows} chosen={chosen} onChoose={props.onChoose} /> : (
      <div className="ap-rows" role="listbox" aria-multiselectable="true" aria-label="Rooms">
        <div className="ap-row ap-whole" role="option" aria-selected={all} onClick={() => props.onChoose(all ? [] : rows.map((r) => r.id), false)}>
          {tick(all, chosen.size > 0)}
          <Icon name="building" size={18} />
          <b>Whole building</b>
          <small>{props.whole.area}</small>
        </div>
        {zones.map((z) => {
          const rs = rows.filter((r) => r.zone === z.id)
          if (!rs.length && !props.onNewZone) return null
          const on = rs.length > 0 && rs.every((r) => chosen.has(r.id))
          const canMove = !!props.onMoveTo && chosen.size > 0 && [...chosen].some((id) => rows.find((r) => r.id === id)?.zone !== z.id)
          return (
            <div key={z.id} className="ap-zone">
              {(zones.length > 1 || props.onNewZone) && (
                <div className="ap-row ap-zonehead" role="option" aria-selected={on} onClick={(e) => props.onChoose(rs.map((r) => r.id), add(e))}>
                  {tick(on, rs.some((r) => chosen.has(r.id)))}
                  <EditName name={z.name} onRename={props.onRenameZone && ((n) => props.onRenameZone!(z.id, n))} />
                  {!rs.length && <small className="ap-empty">no rooms yet</small>}
                  {!rs.length && props.onRemoveZone && <button type="button" className="gl-x small" title="Remove this empty zone" onClick={(e) => { e.stopPropagation(); props.onRemoveZone!(z.id) }}>×</button>}
                  {canMove && <button type="button" className="ap-link ap-move" onClick={(e) => { e.stopPropagation(); props.onMoveTo!(z.id) }}>Move chosen here</button>}
                </div>
              )}
              {rs.map((r) => (
                <div key={r.id} className={`ap-row ap-room${zones.length > 1 ? ' in' : ''}`} role="option" aria-selected={chosen.has(r.id)} onClick={(e) => props.onChoose([r.id], add(e))}>
                  {tick(chosen.has(r.id))}
                  <span className="ap-name"><EditName name={r.name} onRename={props.onRenameRoom && ((n) => props.onRenameRoom!(r.id, n))} /><small>{r.area}</small></span>
                  {r.has ? <span className="ap-has" title={r.has.name}><Sw s={r.has.swatch} />{r.has.name}</span> : <span className="ap-has none">—</span>}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      )}
      {props.onNewZone && (!nav || nav.by === 'rooms') && (
        <button type="button" className="gl-btn quiet ap-new" onClick={props.onNewZone}>{chosen.size ? `+ New zone from the ${chosen.size === 1 ? 'room' : `${chosen.size} rooms`} chosen` : '+ New zone'}</button>
      )}
      {props.extra}
      {props.hint !== null && <p className="gl-hint">{props.hint ?? 'Tap a room here or on the drawing; Ctrl or Shift adds more. Esc lets go. Double-click a name to rename it.'}</p>}
    </div>
  )
}

export type NavItem = { id: string; name: string; swatch: Swatch; rooms: string[]; active?: boolean; onPick?: () => void; onRename?: (name: string) => void; /** Instead of choosing its rooms (walls choose their wall parts). */ choose?: () => void; count?: number; what?: string }
export type NavSection = { title?: string; items: NavItem[]; onNew?: { label: string; run: () => void }; /** More ways to add one (from the library). */ add?: ReactNode }

/** A name that a double-click turns into a box: Enter or leaving it keeps the change, Esc drops it. */
export function EditName({ name, onRename }: { name: string; onRename?: (name: string) => void }) {
  const [ed, setEd] = useState(false)
  if (!ed || !onRename) return <span className="ap-nm" onDoubleClick={onRename ? (e) => { e.stopPropagation(); setEd(true) } : undefined} title={onRename ? 'Double-click to rename' : undefined}>{name}</span>
  const done = (v: string) => { setEd(false); const t = v.trim(); if (t && t !== name) onRename(t) }
  return <input className="ap-rename" autoFocus defaultValue={name} aria-label="Name" onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.stopPropagation()} onBlur={(e) => done(e.currentTarget.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = name; setEd(false) } }} />
}

/** The navigator's list: each thing with the rooms it reaches. A tap chooses its rooms (and shows it on the right);
 * Ctrl or Shift adds them to what is chosen. Rooms with none of the kind are listed last, so they can be chosen too. */
function NavItems({ sections, rows, chosen, onChoose }: { sections: NavSection[]; rows: Row[]; chosen: ReadonlySet<string>; onChoose: (ids: string[], add: boolean) => void }) {
  const tick = (on: boolean, part = false) => <span className={`ap-tick${on ? ' on' : part ? ' part' : ''}`} aria-hidden="true" />
  const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? id
  if (!sections.some((s) => s.items.length || s.onNew || s.add)) return <p className="gl-hint">Nothing of this kind in the project yet.</p>
  return (
    <div className="ap-rows" role="listbox" aria-multiselectable="true" aria-label="Navigate">
      {sections.map((s, i) => (!s.items.length && !s.onNew && !s.add ? null : (
        <div key={s.title ?? i} className="ap-zone">
          {s.title && <div className="ap-navsec">{s.title}</div>}
          {s.items.map((it) => {
            const on = it.rooms.length > 0 && it.rooms.every((id) => chosen.has(id))
            return (
              <div key={it.id} className={`ap-row ap-navit${it.active ? ' active' : ''}`} role="option" aria-selected={on}
                onClick={(e) => { if (it.choose) it.choose(); else onChoose(it.rooms, e.shiftKey || e.ctrlKey || e.metaKey); it.onPick?.() }}>
                {tick(on, it.rooms.some((id) => chosen.has(id)))}
                <Sw s={it.swatch} />
                <span className="ap-name"><EditName name={it.name} onRename={it.onRename} /><small>{it.rooms.length ? it.rooms.map(nameOf).join(', ') : it.count ? '' : 'not used'}</small></span>
                <span className="ap-count" title={it.what ? `${it.count} ${it.what}s` : `${it.rooms.length} rooms`}>{it.what ? it.count : it.rooms.length}</span>
              </div>
            )
          })}
          {!s.items.length && <p className="gl-hint">None in this project yet.</p>}
          {s.onNew && <button type="button" className="ap-link ap-newin" onClick={s.onNew.run}>{s.onNew.label}</button>}
          {s.add}
        </div>
      )))}
    </div>
  )
}

/** Where the Apply bar goes: the middle, over the drawing (Linzie, 17 Nov 00:31: do most of it in the middle). Null:
 * at the foot of the right, as before (the standalone lab, or the middle showing results). */
export const ApplyBarTarget = createContext<HTMLElement | null>(null)

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
  const barTo = useContext(ApplyBarTarget)
  const g = props.give
  return (
    <aside className="gl-panel gl-right ap-give" aria-label="Give">
      {g && !g.preview && barTo && createPortal(
        <div className="ap-bar" role="region" aria-label="Apply">
          <span className="ap-bar-what">{g.what}{g.now && <small>{g.now}</small>}</span>
          <button type="button" className="gl-btn ap-apply" disabled={!!g.why} onClick={g.onApply} title={g.why ?? g.label}>{g.label}</button>
          <button type="button" className="ap-link" onClick={g.onAll}>To the whole building</button>
        </div>,
        barTo,
      )}
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
              {active && <p className="ap-activename"><Sw s={active.swatch} /><b>{active.name}</b><small>{active.used}</small></p>}
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
                {props.onNew && <button type="button" className="gl-btn quiet ap-rnew" onClick={props.onNew}>+ {props.newLabel ?? 'New type'}</button>}
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
      ) : props.give && !barTo && (
        <div className="ap-foot">
          <p className="ap-what">{props.give.what}</p>
          {props.give.now && <p className="ap-now">{props.give.now}</p>}
          <button type="button" className="gl-btn ap-apply" disabled={!!props.give.why} onClick={props.give.onApply}>{props.give.label}</button>
          {props.give.why && <p className="ap-why">{props.give.why}</p>}
          <button type="button" className="ap-link" onClick={props.give.onAll}>Apply to the whole building</button>
        </div>
      )}
    </aside>
  )
}
