import { useContext, useEffect, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import {
  FolderOpen, BookOpen, CloudSun, SlidersHorizontal, Gauge, Layers, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react'
import { ProjectContext } from '../../context/ProjectContext.jsx'
import Icon from '../../sim2/icons/Icon'
import { STEPS, STEP_ACCENT, DEFAULT_STEP, isStep } from '../../sim2/workspace/steps'

// NZA Sim's left navigation (18 Nov 2026, Linzie 15:11: "get rid of the old stuff and layer this new stuff in the
// left navigation, and clean everything up"). The model's steps ARE the navigation: they used to be tabs across the
// top of /model, with today's Overview / Weather / Building / Internal Gains / Operation / Systems pages down here.
// Those pages are no longer in the navigation; their routes stay (nothing is deleted), and the Interventions and
// Check steps still point at today's pages until their own steps are built.
//
// It opens out with names, or closes to icons for more drawing room; the choice is remembered on this computer.

// Linzie's own line icons where the set has one (sim2/icons), lucide's otherwise, at the same weight.
const STEP_ICON = {
  site:          { lucide: CloudSun },
  shape:         { nza: 'building' },
  fabric:        { nza: 'wall' },
  profiles:      { nza: 'profile' },
  spaces:        { nza: 'person' },
  systems:       { nza: 'heating' },
  controls:      { lucide: SlidersHorizontal },
  check:         { lucide: Gauge },
  interventions: { lucide: Layers },
}

function StepIcon({ id, size = 18 }) {
  const i = STEP_ICON[id]
  if (i?.nza) return <Icon name={i.nza} size={size} />
  const L = i?.lucide
  return L ? <L size={size} strokeWidth={1.6} /> : null
}

const KEY = 'nza-sim.sidebar-open'
function useOpen() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(KEY) !== '0' } catch { return true }
  })
  useEffect(() => { try { localStorage.setItem(KEY, open ? '1' : '0') } catch { /* private window */ } }, [open])
  return [open, setOpen]
}

function Tip({ show, children }) {
  if (!show) return null
  return (
    <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 px-2 py-1 rounded text-xxs font-medium text-white bg-navy border border-white/10 whitespace-nowrap shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-300">
      {children}
    </div>
  )
}

function Row({ to, active, accent, icon, label, sub, n, open }) {
  return (
    <div className="relative group">
      <Link
        to={to}
        aria-current={active ? 'page' : undefined}
        className={`relative flex items-center gap-3 h-10 ${open ? 'px-4' : 'justify-center'} transition-colors duration-150 ${active ? 'bg-white/12 text-white' : 'text-white/65 hover:bg-white/6 hover:text-white'}`}
        title={open ? sub : undefined}
      >
        {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full" style={{ backgroundColor: accent }} />}
        <span className="flex-none flex items-center justify-center w-5" style={active ? { color: '#fff' } : undefined}>{icon}</span>
        {open && (
          <span className="flex-1 min-w-0 flex items-baseline gap-2">
            {n != null && <span className="text-xxs tabular-nums text-white/40 w-3 text-right">{n}</span>}
            <span className={`text-caption truncate ${active ? 'font-medium' : ''}`}>{label}</span>
          </span>
        )}
      </Link>
      <Tip show={!open}>{n != null ? `${n} ${label}` : label}</Tip>
    </div>
  )
}

export default function Sidebar() {
  const location = useLocation()
  const ctx = useContext(ProjectContext)
  const [open, setOpen] = useOpen()
  const onModel = location.pathname === '/model'
  const q = new URLSearchParams(location.search).get('step')
  const current = onModel ? (isStep(q) ? q : DEFAULT_STEP) : null
  const projectName = ctx?.currentProjectId ? (ctx?.params?.name || 'Untitled project') : null

  return (
    <nav className={`${open ? 'w-52' : 'w-14'} min-h-screen bg-navy flex flex-col flex-shrink-0 select-none transition-[width] duration-150`} aria-label="NZA Sim">
      {/* Brand */}
      <NavLink to="/" className={`h-12 flex items-center ${open ? 'px-4 gap-2' : 'justify-center'} border-b border-white/8 hover:bg-white/8 transition-colors`} title="Projects">
        <span className="text-white font-medium text-caption tracking-widest">N</span>
        {open && <span className="text-white text-caption font-medium tracking-wide">NZA Sim</span>}
      </NavLink>

      {/* Projects */}
      <div className="pt-1">
        <Row to="/" active={location.pathname === '/'} accent="#E84393" icon={<FolderOpen size={18} strokeWidth={1.6} />} label="Projects" open={open} />
      </div>

      {/* The model, step by step */}
      <div className="mt-2 pt-2 border-t border-white/12">
        {open && (
          <div className="px-4 pb-1.5">
            <div className="text-xxs uppercase tracking-wider text-white/40">Model</div>
            {projectName && <div className="text-xxs text-white/70 truncate" title={projectName}>{projectName}</div>}
          </div>
        )}
        <ol className="list-none m-0 p-0" aria-label="Model steps">
          {STEPS.map(s => (
            <li key={s.id}>
              <Row to={`/model?step=${s.id}`} active={current === s.id} accent={STEP_ACCENT[s.id]} icon={<StepIcon id={s.id} />} label={s.name} sub={s.line} n={s.n} open={open} />
            </li>
          ))}
        </ol>
      </div>

      <div className="flex-1" />

      {/* Reference, pinned to the bottom */}
      <div className="border-t border-white/12 pt-1">
        <Row to="/library" active={location.pathname.startsWith('/library')} accent="#16A34A" icon={<BookOpen size={18} strokeWidth={1.6} />} label="Library" open={open} />
      </div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`h-10 mb-1 flex items-center ${open ? 'px-4 gap-3' : 'justify-center'} text-white/45 hover:text-white transition-colors`}
        aria-label={open ? 'Close the navigation to icons' : 'Open the navigation'}
        title={open ? 'Close to icons' : 'Open'}
      >
        {open ? <><PanelLeftClose size={16} strokeWidth={1.6} /><span className="text-xxs">Close to icons</span></> : <PanelLeftOpen size={16} strokeWidth={1.6} />}
      </button>
    </nav>
  )
}
