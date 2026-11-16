/**
 * Sim2 geometry prototype (route /sim2/geometry). Dressed and driven like decodED's room editor (inside/RoomEditor.tsx):
 * a plan on paper with a grid, a floating box on the left, a card on the right for the thing in hand, the tool bar
 * along the bottom with one line above it saying what the tool does, and a note at the pointer when something can't be
 * done (never refused in silence).
 *
 * Four steps, shown at the top of the left box: the geometry (1, 2), then what it is made of (3) and what each room is
 * used for (4). Steps 3 and 4 pick from NZA Sim's library (../library), never typed-in numbers.
 *
 * 1. Outline: the building's shape, as one or more blocks.
 *   - Rectangle / Triangle: press and drag, corners on a 0.5 m grid, square to it (Shift: 0.1 m). A shape drawn
 *     touching a block joins it (an L, a T, a wing); one drawn apart is a new block.
 *   - Shape: tap corners (decodED's drawing core: near-square sides snap square, diagonals stay put; Shift: any angle).
 *   - Cut out: drag a box over the building to take that piece away.
 *   - Select: tap a block to choose it (Shift: more); drag it to move it (dropped against another, it joins on); drag a
 *     wall to push it straight out or in; drag a corner; the orange handle turns it (15° steps, Shift: free);
 *     double-click a corner to take it away. Tap a wall for its windows. Ctrl+C / Ctrl+V (or Copy on the card) copies
 *     a block; Delete removes it.
 *   - Add corner: only when chosen. Press on a wall to put a corner there and drag it.
 *
 * 2. Rooms: the floor cut into rooms, which always fill it wall to wall.
 *   - Wall: tap a point on one wall, then on another; a wall goes between them (decodED's zone cut).
 *   - Room: drag a box; it takes its space from the rooms under it. Halve: tap a room. Join: tap two rooms that touch.
 *   - Select: tap a room (Shift: more); drag a wall between rooms to move it. The card puts rooms in a zone.
 *
 * 3 to 5 work one way (ApplyPanels.tsx): choose on the left or the drawing (rooms, or a room's part of a wall; Ctrl or
 * Shift for more), pick or make a type on the right, then Apply (to what is chosen, or the whole building).
 * 3. Fabric: types per kind (external wall, ground floor, roof, windows and doors, walls between zones), each a library
 *    construction with an optional U-value over it; air permeability and thermal bridging are whole-building values.
 * 4. Spaces: space types (archetypes, as in IES): a use, occupancy / lighting / equipment profiles and gains, and the
 *    comfort band.
 * 5. Systems: heating, cooling, ventilation and hot water systems, each a library template (ventilation with its flow
 *    and hours), given to rooms.
 *
 * Nothing is saved, and nothing in today's tool reads this page.
 */
import { createPortal } from '../workspace/portal'
import { type PointerEvent as RPointerEvent, Suspense, lazy, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import './lab.css'
import { CLOSE_PX, SNAP_PX, createDrawCore } from './ported/drawCore'
import { type Hit, ccw, labelAt, nearestEdge, squareCut, zoneAt, zoneTint } from './ported/zones'
import { ALWAYS, type BuildingInputs, type DhwInputs, EMITTER_KINDS, type EmitterKind, type EmitterType, isWet, noDhw, FABRIC_ELEMENTS, type FabricElement, noBuildingInputs, type FabricType, type OtherLoadInput, type Plan, type PlanPumps, noPumps, type PlanSystem, SERVICES, type Service, type SpaceType, type Span, USES, type XY, allWindows, along, blankZone, compass16, dist, emptyPlan, floorArea, ringArea, upgradePlan, wallRuns } from './plan'
import { ChooseList, GivePanel, type Item, type Kind, type NavSection, Sw, type Swatch } from './ApplyPanels'
import Icon, { type IconName } from '../icons/Icon'
import { LIBRARY, construction, constructionsFor, profile, profilesFor, system, systemsFor } from '../library/library'
import { BORROWS, borrow, borrowedFrom } from './borrow'
import { CONSTRUCTION_SETS, SET_ELEMENTS } from '../library/sets'
import { applySet, setById } from './applySet'
import { BUILDING_USES, applyUse, roomKindsOf, useById } from './applyUse'
import Spark from './Spark'
import type { Slots } from '../workspace/ModelWorkspace'
import type { StepId } from '../workspace/steps'
import type { CentreTab } from '../workspace/layout'
import type { EditorApi } from '../workspace/ModelSave'
import { type Changed, addShape, blockAt, boxRing, centreOf, copyBlock, cutShape, dropBlocks, moveBlocks, pushWall, removeBlock, setBlock, snapXY, triRing, turnBlocks } from './outline'
import { type Side, assignZone, boxRoom, divideRoom, halveRoom, innerSideAt, joinRooms, moveWall, sideEnds, sideNormal } from './rooms'
import FacadeView from './FacadeView'
import ResultsPanel from '../run/ResultsPanel'
import EmbeddedResults from '../run/EmbeddedResults'
import { TODAY } from '../../thermal/schema/upgrade'
import { lightingWm2 } from '../../thermal/engine/lighting'
import { NCM_SOURCE, defaultPumps } from '../../thermal/catalogue/auxiliaryDefaults'
import { buildDocument } from './toDocument'
import { previewItems } from '../run/ResultsPanel'
import type { Summary } from '../run/seam'
// @ts-expect-error untyped JS from today's app
import { useUISettings } from '../../context/UISettingsContext.jsx'
// @ts-expect-error untyped JS from today's app (Brief 110b P2: today's inspectors, reused)
import ConstructionInspector from '../../components/library/ConstructionInspector.jsx'
// @ts-expect-error untyped JS from today's app
import GlazingInspector from '../../components/library/GlazingInspector.jsx'
import { DOOR, type DoorSpec, type WallPiece, type WindowSpec, changeWindow, crossing, firstType, removeWindow, roomType, setOpeningsIn, pieceAt, piecesOfRooms, setTypeOn, setTypeOnRooms, setWindowsIn, spaceByRoom, typeAt, typeColour, typeOfSpan, wallPieces, wholeWall, windowsIn } from './facade'

// three.js only loads when 3D is first opened.
const Plan3D = lazy(() => import('./Plan3D'))

type Mode = 'outline' | 'rooms' | 'fabric' | 'profiles' | 'spaces' | 'systems'
/** Steps 3 to 5: choose, then give (ApplyPanels.tsx). */
const GIVING = (m: Mode) => m === 'fabric' || m === 'spaces' || m === 'systems'
type Tool = 'select' | 'rect' | 'tri' | 'shape' | 'cut' | 'corner' | 'pick' | 'room' | 'halve' | 'divide' | 'join'
type WallEl = 'wall' | 'glazing' | 'door'
const onWalls = (e: FabricElement): e is WallEl => e === 'wall' || e === 'glazing' || e === 'door'
/** A wall: run `index`, at `t` m along it; `whole` = the whole wall, else the room piece at `t`. `set`: what steps 3 to 5
 * give to: rooms, and rooms' parts of outside walls. */
type Sel = { kind: 'wall'; index: number; t: number; whole: boolean } | { kind: 'blocks'; idx: number[] } | { kind: 'rooms'; ids: string[] } | { kind: 'set'; rooms: string[]; pieces: Span[] } | null
/** Typical starting points, shown with their value and typed over freely (q50 in m³/h·m² at 50 Pa). Guides, not data:
 * an air test or a Part L target wins. Bands as today's NZA Sim airtightness section (≤3 best, >10 leaky). */
const Q50_PRESETS = [
  { v: 1, name: 'Passive House' },
  { v: 3, name: 'Very good new build' },
  { v: 5, name: 'Typical new build today' },
  { v: 8, name: 'Part L limit for new buildings' },
  { v: 12, name: '1990s building, okay' },
  { v: 20, name: 'Older building, leaky' },
]
/** Junction detailing as a multiplier on ISO 14683's standard ψ values, the steps today's NZA Sim names
 * (thermalBridgesLibrary.js: 1 typical compliance detailing, 1.5 poor, 2 very poor); 3 is what Bridgewater uses. */
const TB_PRESETS = [
  { v: 1, name: 'Standard, Part L quality' },
  { v: 1.5, name: 'Poor' },
  { v: 2, name: 'Very poor' },
  { v: 3, name: 'Older building, unimproved' },
]

/** The kinds the Fabric step gives: an element's types, or (air, bridge) a whole-building value. */
type FabricKind = 'set' | 'wall' | 'floor' | 'roof' | 'openings' | 'air' | 'bridge' | 'partition'
const FABRIC_KINDS: Array<Kind & { key: FabricKind }> = [
  { key: 'set', name: 'Construction set', icon: 'building' },
  { key: 'wall', name: 'External wall', icon: 'wall' },
  { key: 'floor', name: 'Ground floor', icon: 'floor' },
  { key: 'roof', name: 'Roof', icon: 'roof' },
  { key: 'openings', name: 'Windows & doors', icon: 'openings' },
  { key: 'air', name: 'Air leakage', icon: 'air' },
  { key: 'bridge', name: 'Thermal bridges', icon: 'bridge' },
  { key: 'partition', name: 'Internal walls', icon: 'rooms' },
]
const SERVICE_ICON: Record<Service, IconName> = { heating: 'boiler', cooling: 'cooling', ventilation: 'ventilation', dhw: 'dhw', lighting: 'lighting' }
type SysKind = Service | 'emitters' | 'other'
const SYSTEM_KINDS: Kind[] = [
  { key: 'heating', name: 'Heating', icon: 'boiler' },
  { key: 'emitters', name: 'Emitters', icon: 'heating' },
  { key: 'cooling', name: 'Cooling', icon: 'cooling' },
  { key: 'ventilation', name: 'Ventilation', icon: 'ventilation' },
  { key: 'dhw', name: 'Hot water', icon: 'dhw' },
  { key: 'lighting', name: 'Lighting', icon: 'lighting' },
  { key: 'other', name: 'Other loads', icon: 'power' },
]
type View = { cx: number; cy: number; k: number }
type Drag =
  | { kind: 'pan'; x: number; y: number; v: View; moved: boolean }
  | { kind: 'box'; a: XY; b: XY }
  | { kind: 'move'; idx: number[]; start: XY; base: Plan; d: XY; moved: boolean; tapped: number; sh: boolean }
  | { kind: 'corner'; block: number; i: number; base: Plan; ring: XY[] }
  | { kind: 'turn'; idx: number[]; start: XY; c: XY; base: Plan; rad: number }
  | { kind: 'push'; block: number; side: number; run: number; start: XY; n: XY; base: Plan; by: number }
  | { kind: 'wall'; side: Side; start: XY; n: XY; base: Plan; by: number }

const TOOLS: Record<Mode, Array<{ key: Tool; name: string; glyph: string; line: string }>> = {
  outline: [
    { key: 'select', name: 'Select', glyph: '➚', line: 'Tap a block to choose it. Drag it to move, drag a wall to push it out, drag a corner. Tap a wall for windows.' },
    { key: 'rect', name: 'Rectangle', glyph: '▭', line: 'Press and drag a box on the 0.5 m grid. Touching the building, it joins on; apart, it is a new block.' },
    { key: 'tri', name: 'Triangle', glyph: '◺', line: 'Press and drag. The square corner is where you start.' },
    { key: 'shape', name: 'Shape', glyph: '⬠', line: 'Tap each corner. Tap the first corner to finish. Shift: any angle.' },
    { key: 'cut', name: 'Cut out', glyph: '⊟', line: 'Drag a box over the building to take that piece away.' },
    { key: 'corner', name: 'Add corner', glyph: '⌖', line: 'Press on a wall to add a corner there, and drag it.' },
  ],
  rooms: [
    { key: 'divide', name: 'Wall', glyph: '┃', line: 'Tap a wall: a new wall runs square across the room from there, on the 0.5 m grid. Shift: any angle (tap both ends).' },
    { key: 'room', name: 'Room', glyph: '▭', line: 'Drag a box. It becomes a room, taking the space from the rooms under it.' },
    { key: 'halve', name: 'Halve', glyph: '◫', line: 'Tap a room to halve it across its long side.' },
    { key: 'join', name: 'Join', glyph: '⧉', line: 'Tap two rooms that touch to make them one.' },
    { key: 'pick', name: 'Select', glyph: '➚', line: 'Tap a room (Shift: more than one) to put it in a zone. Drag a wall between rooms to move it.' },
  ],
  fabric: [{ key: 'pick', name: 'Select', glyph: '➚', line: 'Tap rooms or walls. Ctrl or Shift: more. Double-click: a whole wall.' }],
  profiles: [{ key: 'pick', name: 'Select', glyph: '➚', line: 'Choose a profile on the left: the rooms that use it are coloured.' }],
  spaces: [{ key: 'pick', name: 'Select', glyph: '➚', line: 'Tap rooms. Ctrl or Shift: more. Esc lets go.' }],
  systems: [{ key: 'pick', name: 'Select', glyph: '➚', line: 'Tap rooms. Ctrl or Shift: more. Esc lets go.' }],
}
const FIRST: Record<Mode, Tool> = { outline: 'select', rooms: 'divide', fabric: 'pick', profiles: 'pick', spaces: 'pick', systems: 'pick' }
const STEP: Record<Mode, string> = { outline: 'Outline', rooms: 'Rooms', fabric: 'Fabric', profiles: 'Profiles', spaces: 'Spaces', systems: 'Systems' }
const STEP_NO: Record<Mode, number> = { outline: 1, rooms: 2, fabric: 3, profiles: 4, spaces: 5, systems: 6 }
const MODES: Mode[] = ['outline', 'rooms', 'fabric', 'profiles', 'spaces', 'systems']
const STEP_ICON: Record<Mode, IconName> = { outline: 'building', rooms: 'rooms', fabric: 'wall', profiles: 'profile', spaces: 'person', systems: 'heating' }
const STEP_LINE: Record<Mode, string> = { outline: "The building's shape", rooms: 'Walls inside, and zones', fabric: 'What it is made of', profiles: 'When things happen, hour by hour', spaces: 'What each room is for', systems: 'What heats, cools and ventilates it' }
type ProfileKind = 'occupancy' | 'lighting' | 'equipment' | 'ventilation'
/** The kinds the engine reads today. Heating hours and setback join when Brief 109 lands. */
const PROFILE_KINDS: ReadonlyArray<{ key: ProfileKind; name: string; spark: string; icon: IconName; where: string }> = [
  { key: 'occupancy', name: 'Occupancy', spark: 'Occupancy', icon: 'person', where: 'a space type points at it on Spaces' },
  { key: 'lighting', name: 'Lighting', spark: 'Lighting', icon: 'lighting', where: 'a space type with its own lighting profile points at it on Spaces' },
  { key: 'equipment', name: 'Equipment', spark: 'Equipment', icon: 'power', where: 'a space type with its own equipment profile points at it on Spaces' },
  { key: 'ventilation', name: 'Ventilation', spark: 'Ventilation', icon: 'ventilation', where: 'a ventilation system points at it on Systems' },
]
const SPACE_COLOURS = ['#E0A84E', '#5B9BD5', '#6AA84F', '#C27BA0', '#45A5A0', '#D9734E', '#8E7CC3', '#A0A04A']
const SYSTEM_COLOURS = ['#45A5A0', '#D9734E', '#8E7CC3', '#5B9BD5', '#E0A84E', '#6AA84F', '#C27BA0', '#A0A04A']
/** How gains enter a zone, as today's engine assumes them (TODAY): a new space type starts here, all editable. */
const todaysGains = (): Partial<SpaceType> => ({
  occupancy_rate: TODAY.occupancy_rate,
  sensible_w_per_person: TODAY.sensible_w_per_person,
  equipment_baseload_w_per_m2: 0,
  radiant_fraction: TODAY.gains_radiant_fraction,
  light_area_share: TODAY.area_share,
  light_gain_fraction: TODAY.gain_fraction,
  light_relationship: TODAY.lighting_relationship,
  daylight_factor: TODAY.daylight_factor,
  equip_area_share: TODAY.area_share,
  equip_gain_fraction: TODAY.gain_fraction,
  equip_relationship: TODAY.equipment_relationship,
  standby_factor: TODAY.standby_factor,
})
const RELATIONSHIPS = [
  { key: 'proportional', name: 'With occupancy' },
  { key: 'proportional_with_spill', name: 'With occupancy, lights left on' },
  { key: 'independent', name: 'Own schedule only' },
]
const short = (name: string) => (name.length > 46 ? `${name.slice(0, 44)}…` : name)
const exportDate = new Date(LIBRARY.exported_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const LEFT = 328
const GRID = 0.5
const FINE = 0.1
const GRAB = 9
const TURN_PX = 46
const EXAMPLE: XY[] = [[0, 0], [30, 0], [30, 10], [20, 10], [20, 24], [10, 24], [10, 10], [0, 10]]

const f1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const f2 = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The workspace step a mode belongs to, and back (Brief 110: Outline and Rooms are the one step, Shape). */
const STEP_OF: Record<Mode, StepId> = { outline: 'shape', rooms: 'shape', fabric: 'fabric', profiles: 'profiles', spaces: 'spaces', systems: 'systems' }

/**
 * Standalone (`/sim2/geometry`): one full-screen canvas with floating panels. In the Model workspace (`slots` given,
 * Brief 110): the same state and behaviour, rendered into the workspace's panes, the step coming from its rail.
 */
/** A previewed give: the plan it would make, said in words. */
type Pending = { plan: Plan; who: string; name: string; change: string; ask: string; rooms: string[]; pieces: Span[]; colour: string; same: boolean }
/** The give on screen now (its footer), recorded each render so the preview can run it. */
type Giver = { name: string | null; rooms: boolean; now: string[]; onGive: (all: boolean) => void; colour: string }

export default function GeometryLab({ slots, step: railStep, onStep, centreTab, onCentreTab, api, onPlan }: { slots?: Slots; step?: StepId; onStep?: (s: StepId) => void; centreTab?: CentreTab; onCentreTab?: (c: CentreTab) => void; api?: React.MutableRefObject<EditorApi | null>; onPlan?: (p: Plan) => void } = {}) {
  const embedded = !!slots
  // ─── the plan, with Undo ───────────────────────────────────────────────────
  const [plan, setPlan] = useState<Plan>(emptyPlan)
  const [past, setPast] = useState<Plan[]>([])
  const [future, setFuture] = useState<Plan[]>([])
  /** While a preview is worked out, a give writes here instead of to the plan (preview, then apply). */
  const capture = useRef<{ plan: Plan | null } | null>(null)
  const commit = (next: Plan) => {
    if (capture.current) { capture.current.plan = next; return }
    setPast((p) => [...p.slice(-100), plan])
    setFuture([])
    setPlan(next)
  }
  const undo = () => {
    const prev = past[past.length - 1]
    if (!prev) return
    setFuture((f) => [...f, plan])
    setPast((p) => p.slice(0, -1))
    setPlan(prev)
    setSel(null)
  }
  const redo = () => {
    const next = future[future.length - 1]
    if (!next) return
    setPast((p) => [...p, plan])
    setFuture((f) => f.slice(0, -1))
    setPlan(next)
    setSel(null)
  }

  const [mode, setMode] = useState<Mode>('outline')
  const [look, setLook] = useState<'plan' | '3d' | 'elev'>('plan')
  const [from, setFrom] = useState<'out' | 'in'>('out')
  const [tool, setTool] = useState<Tool>('rect')
  const [joinFrom, setJoinFrom] = useState<string | null>(null)
  const [sel, setSel] = useState<Sel>(null)
  // ─── preview, then apply (Linzie, 16 Nov 00:22) ─────────────────────────────
  // Picking a type with something chosen previews it: the rooms or wall parts that would change are hatched in its
  // colour and marked Preview, the strip shows each figure now → if applied, and the right shows a card asking to
  // make it so. Apply (or Enter) commits it as one Undo step; Cancel (or Esc) drops it. After Apply the rooms flash
  // "Applied", a note says what changed, and it goes on the list of changes this session.
  const [pvAsk, setPvAsk] = useState<{ all: boolean } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const giverRef = useRef<Giver | null>(null)
  giverRef.current = null
  const pvKey = useRef('')
  const planIds = useRef(new WeakMap<Plan, number>())
  const planSeq = useRef(0)
  const [figs, setFigs] = useState<{ now: Summary | null; preview: Summary | null; why?: string | null }>({ now: null, preview: null })
  const [flash, setFlash] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [changes, setChanges] = useState<{ text: string; effect: string | null; depth: number }[]>([])
  const { unit } = useUISettings() as { unit: 'kwh' | 'kwh_per_m2' }
  const [fkind, setFkind] = useState<FabricKind>('wall')
  const [opening, setOpening] = useState<'glazing' | 'door'>('glazing')
  const elem: FabricElement = fkind === 'openings' ? opening : fkind === 'air' || fkind === 'bridge' || fkind === 'set' ? 'wall' : fkind
  const [sysKind, setSysKind] = useState<SysKind>('heating')
  const service: Service = sysKind === 'emitters' || sysKind === 'other' ? 'heating' : sysKind
  const [activeLoad, setActiveLoad] = useState<string | null>(null)
  const [activeEmit, setActiveEmit] = useState<string | null>(null)
  const [pumpNote, setPumpNote] = useState<string | null>(null)
  const [emitCount, setEmitCount] = useState(1)
  const [active, setActive] = useState<Partial<Record<FabricElement, string>>>({})
  const [activeSpace, setActiveSpace] = useState<string | null>(null)
  const [activeSys, setActiveSys] = useState<Partial<Record<Service, string>>>({})
  const [activeSet, setActiveSet] = useState<string | null>(null)
  const [spaceKind, setSpaceKind] = useState<'types' | 'use'>('types')
  const [activeUse, setActiveUse] = useState<string | null>(null)
  /** Brief 118: what the left navigates by; null follows the step (Fabric on Fabric, Systems on Systems…). */
  const [navBy, setNavBy] = useState<string | null>(null)
  useEffect(() => setNavBy(null), [mode])
  const [clip, setClip] = useState<number | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pointer, setPointer] = useState<XY | null>(null)
  const [shift, setShift] = useState(false)
  const [say, setSay] = useState<{ x: number; y: number; text: string; bad?: boolean } | null>(null)
  const [cutFrom, setCutFrom] = useState<Hit | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [size, setSize] = useState<[number, number]>([1400, 900])
  const [view, setView] = useState<View>({ cx: 15, cy: 10, k: 22 })
  const host = useRef<HTMLDivElement>(null)
  const core = useMemo(() => createDrawCore({ kind: 'area', square: 'soft', strictRing: true }), [])
  const cs = useSyncExternalStore(core.subscribe, core.state)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize([el.clientWidth || 1400, el.clientHeight || 900]))
    ro.observe(el)
    setSize([el.clientWidth || 1400, el.clientHeight || 900])
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!say) return
    const t = setTimeout(() => setSay(null), say.bad ? 2600 : 2200)
    return () => clearTimeout(t)
  }, [say])

  // In the workspace the panels are beside the drawing, not over it: no offsets.
  const narrow = size[0] < (embedded ? 420 : 760)
  const LEFTX = embedded ? 0 : LEFT
  const RIGHT = embedded ? 0 : GIVING(mode) ? 374 : 0
  const mid: [number, number] = narrow ? [size[0] / 2, size[1] * 0.3] : [LEFTX + (size[0] - LEFTX - RIGHT) / 2, size[1] / 2 - 30]
  const toPx = (p: XY): [number, number] => [mid[0] + (p[0] - view.cx) * view.k, mid[1] - (p[1] - view.cy) * view.k]
  const toM = (x: number, y: number): XY => [(x - mid[0]) / view.k + view.cx, -(y - mid[1]) / view.k + view.cy]
  const mPerPx = 1 / view.k
  const step = shift ? FINE : GRID
  const tell = (at: XY, text: string, bad = false) => {
    const [x, y] = toPx(at)
    setSay({ x: x + 14, y: y - 34, text, bad })
  }

  const fitTo = (pts: readonly XY[]) => {
    if (!pts.length) return
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const w = Math.max(...xs) - Math.min(...xs) || 1
    const h = Math.max(...ys) - Math.min(...ys) || 1
    const room = narrow ? [size[0] - 60, size[1] * 0.45] : [size[0] - LEFTX - (embedded ? 140 : 380), size[1] - 260]
    setView({ cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, k: Math.max(4, Math.min(60, room[0]! / w, room[1]! / h)) })
  }

  // The workspace saves and reopens through these (Brief 110 P4), and is told when the plan changes.
  useEffect(() => {
    if (api) api.current = { getPlan: () => plan, getDocument: () => built.doc, loadPlan: (p) => { commit(upgradePlan(p as Plan)); setSel(null); fitTo((p as Plan).blocks.flat()) } }
  })
  useEffect(() => { onPlan?.(plan) }, [plan])
  // For browser checks: read the plan, or load one (a fixture), from the page (window.sim2).
  useEffect(() => {
    ;(window as unknown as { sim2?: unknown }).sim2 = {
      getPlan: () => plan,
      getDocument: () => built.doc,
      loadPlan: (p: Plan) => {
        commit(upgradePlan(p))
        setSel(null)
        fitTo(p.blocks.flat())
      },
    }
  })
  const runs = useMemo(() => wallRuns(plan.blocks), [plan.blocks])
  const built = useMemo(() => buildDocument(plan), [plan])
  const placed = useMemo(() => allWindows(plan).windows, [plan])
  const rings = plan.rooms.map((z) => z.ring)
  const has = plan.blocks.length > 0
  const inRooms = mode !== 'outline'
  const selBlocks = sel?.kind === 'blocks' ? sel.idx.filter((i) => i < plan.blocks.length) : []

  // What is on screen while a drag is live (the plan itself changes only when the pointer comes up: one Undo step).
  const preview = (): Plan => {
    if (!drag) return plan
    const or = (r: Changed, base: Plan) => ('why' in r ? base : r.plan)
    try {
      if (drag.kind === 'move') return moveBlocks(drag.base, drag.idx, drag.d)
      if (drag.kind === 'turn') return turnBlocks(drag.base, drag.idx, drag.rad, drag.c)
      if (drag.kind === 'corner') return or(setBlock(drag.base, drag.block, drag.ring), { ...drag.base, blocks: drag.base.blocks.map((b, i) => (i === drag.block ? drag.ring : b)) })
      if (drag.kind === 'push') return or(pushWall(drag.base, drag.block, drag.side, drag.by), drag.base)
      if (drag.kind === 'wall') return or(moveWall(drag.base, drag.side, drag.by), drag.base)
    } catch {
      return 'base' in drag ? drag.base : plan
    }
    return plan
  }
  const shown = useMemo(preview, [plan, drag]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownRuns = drag ? wallRuns(shown.blocks) : runs

  /** Choose the block under a point after a change (blocks renumber when they join). */
  const chooseAt = (p: Plan, at: XY) => {
    const i = blockAt(p, at)
    setSel(i >= 0 ? { kind: 'blocks', idx: [i] } : null)
  }
  const apply = (r: Changed, at: XY, choose?: XY) => {
    if ('why' in r) return tell(at, r.why, true)
    commit(r.plan)
    if (r.said) tell(at, r.said)
    if (mode === 'outline' && choose) chooseAt(r.plan, choose)
  }

  // ─── hit tests (screen pixels) ─────────────────────────────────────────────
  const handleBlocks = mode === 'outline' && (tool === 'select' || tool === 'corner') ? (selBlocks.length ? selBlocks : shown.blocks.length === 1 ? [0] : []) : []
  const turnHandle = (): { at: [number, number]; c: XY } | null => {
    if (tool !== 'select' || !handleBlocks.length) return null
    const pts = handleBlocks.flatMap((i) => shown.blocks[i] ?? [])
    if (!pts.length) return null
    const px = pts.map(toPx)
    const top = Math.min(...px.map((p) => p[1]))
    const cx = (Math.min(...px.map((p) => p[0])) + Math.max(...px.map((p) => p[0]))) / 2
    return { at: [cx, top - TURN_PX], c: centreOf(pts) }
  }
  const cornerAt = (x: number, y: number): { block: number; i: number } | null => {
    for (const b of handleBlocks) {
      const i = (plan.blocks[b] ?? []).findIndex((p) => Math.hypot(toPx(p)[0] - x, toPx(p)[1] - y) <= GRAB)
      if (i >= 0) return { block: b, i }
    }
    return null
  }
  const wallAt = (x: number, y: number): number | null => {
    let best: number | null = null
    let bd = 7
    for (const r of shownRuns) {
      const [ax, ay] = toPx(r.a)
      const [bx, by] = toPx(r.b)
      const dx = bx - ax
      const dy = by - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
      if (d < bd) {
        bd = d
        best = r.index
      }
    }
    return best
  }
  /** How far along wall run `w` the point `m` falls. */
  const tOn = (w: number, m: XY) => {
    const r = runs[w]
    if (!r) return 0
    return Math.max(0, Math.min(r.length_m, ((m[0] - r.a[0]) * (r.b[0] - r.a[0]) + (m[1] - r.a[1]) * (r.b[1] - r.a[1])) / (r.length_m || 1)))
  }
  /** Where on wall run `w` the point `m` falls, snapped along it to the grid step. */
  const onWall = (w: number, m: XY, st: number): XY => {
    const r = runs[w]!
    const t = Math.max(0, Math.min(r.length_m, Math.round((((m[0] - r.a[0]) * (r.b[0] - r.a[0]) + (m[1] - r.a[1]) * (r.b[1] - r.a[1])) / (r.length_m || 1)) / st) * st))
    return along(r, t)
  }

  // ─── pointer ───────────────────────────────────────────────────────────────
  const local = (e: RPointerEvent) => {
    const r = (e.currentTarget as Element).getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as [number, number]
  }
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return
    const [x, y] = local(e)
    const m = toM(x, y)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setShift(e.shiftKey)
    const st = e.shiftKey ? FINE : GRID
    if (e.button === 1) return setDrag({ kind: 'pan', x, y, v: view, moved: false })
    if (tool === 'rect' || tool === 'tri' || tool === 'cut' || tool === 'room') {
      const a = snapXY(m, st)
      return setDrag({ kind: 'box', a, b: a })
    }
    if (tool === 'corner' && has) {
      const w = wallAt(x, y)
      if (w == null) return tell(m, 'Press on a wall to add a corner there.', true)
      const r = runs[w]!
      const ring = plan.blocks[r.block]!.map((p) => [p[0], p[1]] as XY)
      ring.splice(r.side + 1, 0, onWall(w, m, st))
      return setDrag({ kind: 'corner', block: r.block, i: r.side + 1, base: plan, ring })
    }
    if (tool === 'select' && has) {
      const th = turnHandle()
      if (th && Math.hypot(th.at[0] - x, th.at[1] - y) <= GRAB + 3) return setDrag({ kind: 'turn', idx: handleBlocks, start: m, c: th.c, base: plan, rad: 0 })
      const c = cornerAt(x, y)
      if (c) return setDrag({ kind: 'corner', block: c.block, i: c.i, base: plan, ring: plan.blocks[c.block]!.map((p) => [p[0], p[1]] as XY) })
      const w = wallAt(x, y)
      if (w != null) {
        const r = runs[w]!
        const L = r.length_m || 1
        return setDrag({ kind: 'push', block: r.block, side: r.side, run: w, start: m, n: [(r.b[1] - r.a[1]) / L, -(r.b[0] - r.a[0]) / L], base: plan, by: 0 })
      }
      const bi = blockAt(plan, m)
      if (bi >= 0) {
        const idx = e.shiftKey ? [...new Set([...selBlocks, bi])] : selBlocks.includes(bi) ? selBlocks : [bi]
        return setDrag({ kind: 'move', idx, start: m, base: plan, d: [0, 0], moved: false, tapped: bi, sh: e.shiftKey })
      }
    }
    if (tool === 'pick' && mode === 'rooms' && has && wallAt(x, y) == null) {
      const side = innerSideAt(plan, m, GRAB * mPerPx)
      if (side) return setDrag({ kind: 'wall', side, start: m, n: sideNormal(plan, side), base: plan, by: 0 })
    }
    setDrag({ kind: 'pan', x, y, v: view, moved: false })
  }
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const [x, y] = local(e)
    const m = toM(x, y)
    setShift(e.shiftKey)
    setPointer(m)
    if (!drag) return
    const st = e.shiftKey ? FINE : GRID
    if (drag.kind === 'pan') {
      if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 4) return
      setView({ ...drag.v, cx: drag.v.cx - (x - drag.x) / drag.v.k, cy: drag.v.cy + (y - drag.y) / drag.v.k })
      setDrag({ ...drag, moved: true })
    } else if (drag.kind === 'box') setDrag({ ...drag, b: snapXY(m, st) })
    else if (drag.kind === 'move') {
      const d = snapXY([m[0] - drag.start[0], m[1] - drag.start[1]], st)
      setDrag({ ...drag, d, moved: drag.moved || Math.hypot(d[0], d[1]) > 0 })
    } else if (drag.kind === 'corner') {
      setDrag({ ...drag, ring: drag.ring.map((p, i) => (i === drag.i ? snapXY(m, st) : p)) })
    } else if (drag.kind === 'push' || drag.kind === 'wall') {
      const raw = (m[0] - drag.start[0]) * drag.n[0] + (m[1] - drag.start[1]) * drag.n[1]
      setDrag({ ...drag, by: Math.round(raw / st) * st })
    } else if (drag.kind === 'turn') {
      let rad = Math.atan2(m[1] - drag.c[1], m[0] - drag.c[0]) - Math.atan2(drag.start[1] - drag.c[1], drag.start[0] - drag.c[0])
      if (!e.shiftKey) rad = Math.round(rad / (Math.PI / 12)) * (Math.PI / 12)
      setDrag({ ...drag, rad })
    }
  }
  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    const [x, y] = local(e)
    const m = toM(x, y)
    const d = drag
    setDrag(null)
    if (!d) return
    if (d.kind === 'box') {
      const ring = tool === 'tri' ? triRing(d.a, d.b) : boxRing(d.a, d.b)
      if (!ring) {
        if (tool === 'room' && d.a[0] === d.b[0] && d.a[1] === d.b[1]) return click(m, x, y, e.shiftKey)
        return tell(m, tool === 'cut' ? 'Drag a box over the building.' : 'Press and drag to draw.', !(d.a[0] === d.b[0] && d.a[1] === d.b[1]))
      }
      if (tool === 'room') {
        const r = boxRoom(plan, ring)
        if ('why' in r) return tell(d.b, r.why, true)
        commit(r.plan)
        if (r.said) tell(d.b, r.said)
        return setSel({ kind: 'rooms', ids: [r.plan.rooms[r.plan.rooms.length - 1]!.id] })
      }
      const mid2: XY = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2]
      if (tool === 'cut') return apply(cutShape(plan, ring), d.b)
      return apply(addShape(plan, ring), d.b, mid2)
    }
    if (d.kind === 'move') {
      if (!d.moved) {
        // A tap: choose the block (Shift: add or take away).
        if (d.sh) {
          const idx = selBlocks.includes(d.tapped) ? selBlocks.filter((i) => i !== d.tapped) : [...selBlocks, d.tapped]
          return setSel(idx.length ? { kind: 'blocks', idx } : null)
        }
        return setSel({ kind: 'blocks', idx: [d.tapped] })
      }
      const at = labelAt(moveBlocks(d.base, d.idx, d.d).blocks[d.tapped]!)
      const r = dropBlocks(moveBlocks(d.base, d.idx, d.d), 'Moved')
      if ('why' in r) return tell(m, r.why, true)
      commit(r.plan)
      if (r.said) tell(m, r.said)
      return r.plan.blocks.length !== d.base.blocks.length ? chooseAt(r.plan, at) : setSel({ kind: 'blocks', idx: d.idx })
    }
    if (d.kind === 'turn') {
      if (Math.abs(d.rad) < 1e-9) return
      const r = dropBlocks(turnBlocks(d.base, d.idx, d.rad, d.c), 'Turned')
      if ('why' in r) return tell(m, r.why, true)
      commit(r.plan)
      if (r.said) tell(m, r.said)
      return
    }
    if (d.kind === 'push') {
      if (Math.abs(d.by) < 1e-9) return setSel({ kind: 'wall', index: d.run, t: tOn(d.run, d.start), whole: true })
      return apply(pushWall(d.base, d.block, d.side, d.by), m)
    }
    if (d.kind === 'wall') {
      if (Math.abs(d.by) < 1e-9) return click(m, x, y, e.shiftKey)
      const r = moveWall(d.base, d.side, d.by)
      if ('why' in r) return tell(m, r.why, true)
      return commit(r.plan)
    }
    if (d.kind === 'corner') {
      const before = d.base.blocks[d.block]!
      if (d.ring.length === before.length && d.ring.every((p, i) => dist(p, before[i]!) < 1e-9)) return
      return apply(setBlock(d.base, d.block, d.ring), m, labelAt(d.ring))
    }
    if (d.kind === 'pan' && !d.moved) click(m, x, y, e.shiftKey || e.ctrlKey || e.metaKey)
  }
  const onDouble = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode === 'fabric' && wallsKind) {
      // The whole wall: every room's part of it.
      const r = (e.currentTarget as Element).getBoundingClientRect()
      const w = wallAt(e.clientX - r.left, e.clientY - r.top)
      if (w == null) return
      const ps = pieces.filter((p) => p.run === w)
      const add = e.shiftKey || e.ctrlKey || e.metaKey
      return setSel({ kind: 'set', rooms: add ? chosenSet.rooms : [], pieces: [...(add ? chosenSet.pieces.filter((x) => x.run !== w) : []), ...ps] })
    }
    if (tool !== 'select' || !has) return
    const r = (e.currentTarget as Element).getBoundingClientRect()
    const c = cornerAt(e.clientX - r.left, e.clientY - r.top)
    if (!c) return
    const b = plan.blocks[c.block]!
    apply(setBlock(plan, c.block, b.filter((_, j) => j !== c.i)), b[c.i]!)
  }
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const r = (e.currentTarget as Element).getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const before = toM(x, y)
    const k = Math.max(3, Math.min(200, view.k * Math.exp(-e.deltaY * 0.0015)))
    setView({ k, cx: before[0] - (x - mid[0]) / k, cy: before[1] + (y - mid[1]) / k })
  }

  /** Where a new wall starts: the nearest point on a side of the room under the pointer, on the 0.5 m grid along it
   *  (Shift: anywhere). A corner nearby wins. */
  const wallHit = (m: XY, free: boolean): Hit | null => {
    const ri = zoneAt(rings, m)
    const h = ri >= 0 ? nearestEdge([rings[ri]!], m, SNAP_PX * 4 * mPerPx, SNAP_PX * mPerPx) : nearestEdge(rings, m, SNAP_PX * 1.5 * mPerPx, SNAP_PX * mPerPx)
    if (!h) return null
    const hit = ri >= 0 ? { ...h, zone: ri } : h
    if (free || hit.corner) return hit
    const ring = rings[hit.zone]!
    const a = ring[hit.edge]!
    const b = ring[(hit.edge + 1) % ring.length]!
    const L = dist(a, b) || 1
    const g = GRID
    let p: XY
    if (Math.abs(b[1] - a[1]) < 1e-6) p = [Math.min(Math.max(a[0], b[0]), Math.max(Math.min(a[0], b[0]), Math.round(hit.p[0] / g) * g)), a[1]]
    else if (Math.abs(b[0] - a[0]) < 1e-6) p = [a[0], Math.min(Math.max(a[1], b[1]), Math.max(Math.min(a[1], b[1]), Math.round(hit.p[1] / g) * g))]
    else {
      const t = Math.max(0, Math.min(L, Math.round(dist(a, hit.p) / g) * g))
      p = [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]
    }
    return { ...hit, p }
  }
  /** The square wall from a hit: at 90° to the side it starts on, across to the room's far side. */
  const squareFrom = (h: Hit, m: XY): XY | null => squareCut(rings, h, m)

  const click = (m: XY, x: number, y: number, sh = false) => {
    if (tool === 'shape') {
      const at = sh ? m : snapXY(m, GRID)
      const o = core.tap(at, { mPerPx, shift: sh })
      if (o.kind === 'refused') return tell(o.at, o.message, true)
      if (o.kind === 'finished') {
        core.reset()
        return apply(addShape(plan, ccw(o.shape)), at, labelAt(o.shape))
      }
      return
    }
    if (tool === 'select') return setSel(null)
    if (GIVING(mode)) return chooseAt2(m, x, y, sh)
    if (tool === 'divide') {
      if (!plan.rooms.length) return tell(m, 'Draw the building first.', true)
      const h = wallHit(m, sh || !!cutFrom)
      if (!h) return tell(m, 'Tap on a wall.', true)
      if (!sh && !cutFrom) {
        // Square to the wall by default: one tap.
        const end = squareFrom(h, m)
        if (!end) return tell(h.p, 'No square wall fits from here. Hold Shift for any angle.', true)
        const r = divideRoom(plan, h.p, end)
        if ('why' in r) return tell(h.p, r.why, true)
        return commit(r.plan)
      }
      if (!cutFrom) return setCutFrom(h)
      const r = divideRoom(plan, cutFrom.p, h.p)
      setCutFrom(null)
      if ('why' in r) return tell(h.p, r.why, true)
      return commit(r.plan)
    }
    const ri = zoneAt(rings, m)
    const room = ri >= 0 ? plan.rooms[ri]! : null
    if (tool === 'halve') {
      if (!room) return tell(m, 'Tap a room.', true)
      const r = halveRoom(plan, room.id)
      if ('why' in r) return tell(m, r.why, true)
      return commit(r.plan)
    }
    if (tool === 'join') {
      if (!room) return tell(m, 'Tap a room.', true)
      if (!joinFrom || joinFrom === room.id) return setJoinFrom(room.id)
      const r = joinRooms(plan, [joinFrom, room.id])
      setJoinFrom(null)
      if ('why' in r) return tell(m, r.why, true)
      commit(r.plan)
      return setSel({ kind: 'rooms', ids: [joinFrom] })
    }
    if (tool === 'pick' || tool === 'room') {
      const w = wallAt(x, y)
      if (w != null && tool === 'pick') return setSel({ kind: 'wall', index: w, t: tOn(w, m), whole: false })
      if (!room) {
        setActiveSpace(null)
        return setSel(null)
      }
      if (sh && sel?.kind === 'rooms') {
        const ids = sel.ids.includes(room.id) ? sel.ids.filter((i) => i !== room.id) : [...sel.ids, room.id]
        return setSel(ids.length ? { kind: 'rooms', ids } : null)
      }
      return setSel({ kind: 'rooms', ids: [room.id] })
    }
  }

  const copy = (i: number) => {
    const r = copyBlock(plan, i)
    if ('why' in r) return
    commit(r.plan)
    setSel({ kind: 'blocks', idx: [r.plan.blocks.length - 1] })
    fitTo(r.plan.blocks.flat())
    setSay({ x: size[0] / 2, y: 90, text: r.said ?? 'Copied' })
  }
  const remove = (idx: number[]) => {
    let p = plan
    for (const i of [...idx].sort((a, b) => b - a)) p = removeBlock(p, i)
    commit(p)
    setSel(null)
  }

  // ─── keys ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setShift(e.shiftKey)
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
      const ctl = e.ctrlKey || e.metaKey
      if (pending && e.key === 'Enter') return void (e.preventDefault(), pending.same ? setPvAsk(null) : applyPending())
      if (pending && e.key === 'Escape') return void setPvAsk(null)
      if (ctl && e.key.toLowerCase() === 'a' && GIVING(mode)) return void (e.preventDefault(), setSel({ kind: 'set', rooms: plan.rooms.map((r) => r.id), pieces: [] }))
      if (ctl && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (tool === 'shape' && cs.corners.length) return void core.undo()
        return e.shiftKey ? redo() : undo()
      }
      if (ctl && e.key.toLowerCase() === 'y') return void (e.preventDefault(), redo())
      if (ctl && e.key.toLowerCase() === 'c' && selBlocks.length) return void (e.preventDefault(), setClip(selBlocks[0]!))
      if (ctl && e.key.toLowerCase() === 'v' && clip != null && plan.blocks[clip]) return void (e.preventDefault(), copy(clip))
      if (ctl && e.key.toLowerCase() === 'd' && selBlocks.length) return void (e.preventDefault(), copy(selBlocks[0]!))
      if ((e.key === 'Delete' || (e.key === 'Backspace' && tool !== 'shape')) && selBlocks.length && mode === 'outline') return void (e.preventDefault(), remove(selBlocks))
      if (e.key === 'Enter' && tool === 'shape') {
        const o = core.finish(mPerPx)
        if (o.kind === 'refused') return tell(o.at, o.message, true)
        if (o.kind === 'finished') {
          core.reset()
          return apply(addShape(plan, ccw(o.shape)), o.shape[0]!, labelAt(o.shape))
        }
      }
      if (e.key === 'Backspace' && tool === 'shape') return void core.back()
      if (e.key === 'Escape') {
        core.clear()
        setCutFrom(null)
        setJoinFrom(null)
        setDrag(null)
        setSel(null)
      }
      const t = TOOLS[mode][Number(e.key) - 1]
      if (t && !ctl && !e.altKey) pick(t.key)
    }
    const onKeyUp = (e: KeyboardEvent) => setShift(e.shiftKey)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  })

  const pick = (t: Tool) => {
    setTool(t)
    setCutFrom(null)
    setJoinFrom(null)
    core.reset()
    if (sel?.kind === 'rooms' && t !== 'pick' && t !== 'room') setSel(null)
    if (sel?.kind === 'wall' && t !== 'select' && t !== 'pick') setSel(null)
  }
  const toMode = (m: Mode) => {
    setMode(m)
    setSel(null)
    setTool(FIRST[m])
    setCutFrom(null)
    setJoinFrom(null)
    core.reset()
  }
  // The workspace's rail chooses the railStep; the editor's own "Next" buttons move the rail with it.
  useEffect(() => {
    if (!embedded || !railStep || railStep === 'site' || STEP_OF[mode] === railStep) return
    // With nothing drawn, steps 3 to 5 stay chosen and say what they need (needsShape), instead of bouncing to Shape.
    if (railStep === 'profiles') { toMode('profiles'); return }
    if (!has && railStep !== 'shape') return
    if (railStep === 'shape') toMode('outline')
    else if (railStep === 'fabric' || railStep === 'spaces' || railStep === 'systems') toMode(railStep)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railStep, has])
  useEffect(() => {
    if (embedded && railStep !== 'site' && railStep !== 'check' && railStep !== 'interventions' && !(railStep !== 'shape' && railStep !== 'profiles' && !has) && STEP_OF[mode] !== railStep) onStep?.(STEP_OF[mode])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])
  const onSite = embedded && railStep === 'site'
  /** Steps 6 and 7 are the workspace's empty states: the editor stays mounted (nothing is lost) with its right side empty. */
  const offStep = embedded && (railStep === 'check' || railStep === 'interventions')
  /** Fabric, Spaces or Systems chosen with nothing drawn yet: the right side says so and offers the way on. */
  const needsShape = embedded && !has && (railStep === 'fabric' || railStep === 'spaces' || railStep === 'systems')
  const startExample = () => { const r = addShape(plan, EXAMPLE); if (!('why' in r)) { commit(r.plan); fitTo(EXAMPLE); pick('select'); setSel({ kind: 'blocks', idx: [0] }) } }
  /** Where Site puts the weather choice (the run's own picker, rendered there). */
  const [weatherEl, setWeatherEl] = useState<HTMLElement | null>(null)
  const [sizingEl, setSizingEl] = useState<HTMLElement | null>(null)
  /** Profiles step: the kind shown and the profile chosen (Brief 110b). */
  const [profKind, setProfKind] = useState<ProfileKind>('occupancy')
  const [profSel, setProfSel] = useState<string | null>(null)
  /** Today's library inspector, opened from a fabric type's ⓘ (Brief 110b P2). */
  const [inspect, setInspect] = useState<{ name: string; glazing: boolean } | null>(null)

  // ─── the wall card: a room's piece of an outside wall, or the whole wall ─────────
  const pieces = useMemo(() => wallPieces(plan), [plan])
  const crossers = useMemo(() => new Set(crossing(plan, pieces).map((w) => w.id)), [plan, pieces])
  const selWall = sel?.kind === 'wall' ? runs[sel.index] : undefined
  const runPieces = selWall ? pieces.filter((p) => p.run === selWall.index) : []
  const selPiece = sel?.kind === 'wall' && selWall ? pieceAt(pieces, selWall.index, Math.min(sel.t, selWall.length_m)) : undefined
  const selSpan: Span | null = sel?.kind === 'wall' && selWall ? (sel.whole || !selPiece || runPieces.length < 2 ? wholeWall(plan, selWall.index) : selPiece) : null
  const isWhole = !!selSpan && !!selWall && selSpan.t1 - selSpan.t0 >= selWall.length_m - 1e-6
  const selOpen = selSpan ? windowsIn(plan, selSpan) : []
  const selWins = selOpen.filter((w) => !w.door)
  const selDoors = selOpen.filter((w) => w.door)
  // The elevation needs a wall; without one the plan shows.
  const shownLook = look === 'elev' && !selWall ? 'plan' : look
  const in3d = shownLook === '3d'
  const roomName = (id: string) => plan.rooms.find((r) => r.id === id)?.name ?? 'a room'
  const spanName = !selSpan ? '' : isWhole ? (runPieces.length > 1 ? `whole wall · ${runPieces.length} rooms` : runPieces[0] ? roomName(runPieces[0].room) : '') : selPiece ? `${roomName(selPiece.room)}'s part` : ''
  // Width, height and area of each window are tied (area = width × height): the two last typed stand and the third is
  // worked out. Once there are windows, every valid change shows at once (no Update button) and re-spaces them equally.
  type Dim = 'width' | 'height' | 'area'
  const editing = useRef<Sel>(null)
  const r1s = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : '')
  const r3s = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '')
  const [form, setForm] = useState({ count: '3', width: r3s(1 / 1.2), height: '1.2', area: '1', sill: '0.9', shade: '0', ratio: '', byRatio: false, doors: '0', doorW: String(DOOR.width_m), doorH: String(DOOR.height_m), recent: ['height', 'area'] as Dim[] })
  const autoDim: Dim = (['width', 'height', 'area'] as Dim[]).find((d) => !form.recent.includes(d))!
  const first = selWins[0]
  const sameSize = selWins.every((w) => first && Math.abs(w.width_m - first.width_m) < 1e-6 && Math.abs(w.height_m - first.height_m) < 1e-6 && Math.abs(w.sill_m - first.sill_m) < 1e-6 && Math.abs(w.shading_m - first.shading_m) < 1e-6)
  const spanKey = selSpan ? `${selSpan.run}:${selSpan.t0.toFixed(3)}:${selSpan.t1.toFixed(3)}` : ''
  useEffect(() => {
    const d = selDoors[0]
    if (selOpen.length) setForm((f) => ({ ...f, doors: String(selDoors.length), ...(d ? { doorW: r3s(d.width_m), doorH: r3s(d.height_m) } : {}), count: String(selWins.length) }))
    if (first) setForm((f) => ({ ...f, count: String(selWins.length), width: r3s(first.width_m), height: r3s(first.height_m), area: r3s(first.width_m * first.height_m), sill: r3s(first.sill_m), shade: r3s(first.shading_m), byRatio: false }))
  }, [spanKey, sel, selWins.length, selDoors.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const toDoor = (f: typeof form): DoorSpec => ({ count: Number(f.doors), width_m: Number(f.doorW), height_m: Number(f.doorH) })
  const toSpec = (f: typeof form): WindowSpec => ({ count: Number(f.count), height_m: Number(f.height), width_m: Number(f.width), sill_m: Number(f.sill), shading_m: Number(f.shade) })
  // Glazing ratio: glass area ÷ wall area of the chosen part (or whole wall), the same window-to-wall ratio today's tool
  // uses. Typing it sets the area of each window (ratio × wall area ÷ number), and it holds when the number changes.
  const grossM2 = selSpan ? (selSpan.t1 - selSpan.t0) * plan.storey_height_m : 0
  const ratioShown = form.byRatio ? form.ratio : grossM2 > 0 ? r1s((100 * Number(form.count) * Number(form.area)) / grossM2) : ''
  const edit = (k: 'count' | 'sill' | 'shade' | 'ratio' | 'doors' | 'doorW' | 'doorH' | Dim, v: string) => {
    let f = { ...form, [k]: v }
    if (k === 'width' || k === 'height' || k === 'area') f.byRatio = false
    if (k === 'ratio') f = { ...f, byRatio: true }
    if ((k === 'ratio' || k === 'count') && f.byRatio && grossM2 > 0 && Number(f.count) > 0) {
      f.area = r3s((Number(f.ratio) / 100) * grossM2 / Number(f.count))
      k = 'area'
    }
    if (k === 'width' || k === 'height' || k === 'area') {
      const recent: Dim[] = [form.recent.filter((d) => d !== k).slice(-1)[0] ?? (k === 'height' ? 'area' : 'height'), k]
      f = { ...f, recent }
      const auto = (['width', 'height', 'area'] as Dim[]).find((d) => !recent.includes(d))!
      const W = Number(f.width)
      const H = Number(f.height)
      const A = Number(f.area)
      if (auto === 'width' && H > 0) f.width = r3s(A / H)
      if (auto === 'height' && W > 0) f.height = r3s(A / W)
      if (auto === 'area') f.area = r3s(W * H)
    }
    setForm(f)
    if (!selOpen.length || !selSpan) return
    const r = setOpeningsIn(plan, selSpan, toSpec(f), toDoor(f))
    if ('why' in r) return
    // One Undo step per wall chosen, not one per key.
    if (editing.current === sel) setPlan(r.plan)
    else {
      editing.current = sel
      commit(r.plan)
    }
  }
  const spec = toSpec(form)
  const doorSpec = toDoor(form)
  // A dry run of what the card says, for its message (and the Add button).
  const lay = selSpan ? setOpeningsIn(plan, selSpan, spec, doorSpec) : null
  const chooseWall = (whole: boolean) => sel?.kind === 'wall' && setSel({ ...sel, whole })
  const choosePiece = (p: WallPiece) => setSel({ kind: 'wall', index: p.run, t: (p.t0 + p.t1) / 2, whole: false })

  // ─── steps 3 to 5: what is chosen (rooms, and rooms' parts of outside walls) ─────────────────
  const giving = GIVING(mode)
  const wallsKind = fkind === 'wall' || fkind === 'openings'
  const chosenSet = sel?.kind === 'set' ? sel : { kind: 'set' as const, rooms: [] as string[], pieces: [] as Span[] }
  const samePiece = (a: Span, b: Span) => a.run === b.run && Math.abs(a.t0 - b.t0) < 1e-6 && Math.abs(a.t1 - b.t1) < 1e-6
  const setChosen = (rooms: string[], ps: Span[]) => setSel(rooms.length || ps.length ? { kind: 'set', rooms, pieces: ps } : null)
  /** A tap on the drawing: a room's part of a wall (Fabric: walls, windows and doors), or a room. Ctrl or Shift adds
   * it, or takes it away; a plain tap chooses only it; a tap on empty paper lets go. */
  const chooseAt2 = (m: XY, x: number, y: number, add: boolean) => {
    const w = mode === 'fabric' && wallsKind ? wallAt(x, y) : null
    if (w != null) {
      const p = pieceAt(pieces, w, tOn(w, m))
      if (!p) return
      const sp: Span = { run: p.run, t0: p.t0, t1: p.t1 }
      const has = chosenSet.pieces.some((q) => samePiece(q, sp))
      return add ? setChosen(chosenSet.rooms, has ? chosenSet.pieces.filter((q) => !samePiece(q, sp)) : [...chosenSet.pieces, sp]) : setChosen([], [sp])
    }
    const ri = zoneAt(rings, m)
    const room = ri >= 0 ? plan.rooms[ri]! : null
    if (!room) return add ? undefined : setSel(null)
    if (!add) return setChosen([room.id], [])
    setChosen(chosenSet.rooms.includes(room.id) ? chosenSet.rooms.filter((r) => r !== room.id) : [...chosenSet.rooms, room.id], chosenSet.pieces)
  }
  /** From the list on the left: these rooms only, or (Ctrl or Shift) added, or taken away when all are in already. */
  const chooseRooms = (ids: string[], add: boolean) => {
    if (!add) return setChosen(ids, [])
    const allIn = ids.every((id) => chosenSet.rooms.includes(id))
    setChosen(allIn ? chosenSet.rooms.filter((r) => !ids.includes(r)) : [...new Set([...chosenSet.rooms, ...ids])], chosenSet.pieces)
  }
  /** The wall pieces chosen: those tapped, and every outside part of the rooms chosen. */
  const chosenPieces = (): Span[] => {
    const out: Span[] = [...chosenSet.pieces]
    for (const p of piecesOfRooms(plan, chosenSet.rooms)) if (!out.some((x) => samePiece(x, p))) out.push({ run: p.run, t0: p.t0, t1: p.t1 })
    return out
  }
  const allRooms = () => plan.rooms.map((r) => r.id)
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  /** "Now: A ×2, B ×1": what the chosen things have now. */
  const nowOf = (names: string[]) => {
    if (!names.length) return null
    const by = new Map<string, number>()
    for (const n of names) by.set(n, (by.get(n) ?? 0) + 1)
    return `Now: ${[...by.entries()].map(([n, k]) => (by.size > 1 ? `${n} ×${k}` : n)).join(', ')}`
  }

  // ─── fabric (step 3) ────────────────────────────────────────────────────────
  const activeOf = (e: FabricElement) => {
    const id = active[e]
    return id && plan.fabric_types.some((t) => t.id === id) ? id : firstType(plan, e)
  }
  const newType = (p: Plan, e: FabricElement, from?: FabricType): { plan: Plan; id: string } => {
    const same = p.fabric_types.filter((t) => t.element === e)
    let k = same.length + 1
    while (p.fabric_types.some((t) => t.id === `f_${e}${k}`)) k++
    const t: FabricType = from ? { ...from, id: `f_${e}${k}`, name: `${from.name} (copy)` } : { id: `f_${e}${k}`, element: e, name: `${FABRIC_ELEMENTS.find((x) => x.key === e)!.one} ${same.length + 1}`, construction: null, u: null }
    return { plan: { ...p, fabric_types: [...p.fabric_types, t] }, id: t.id }
  }
  const setFT = (id: string, q: Partial<FabricType>) => commit({ ...plan, fabric_types: plan.fabric_types.map((x) => (x.id === id ? { ...x, ...q, ...('construction' in q || 'u' in q ? { template: null } : {}) } : x)) })
  /** What a type is used on: wall metres, numbers of windows or doors, or roof / floor area. */
  const usage = (t: FabricType): { n: number; text: string } => {
    if (t.element === 'wall') {
      const m = pieces.filter((p) => typeOfSpan(plan, p) === t.id).reduce((n, p) => n + p.length_m, 0)
      return { n: m, text: `${f1(m)} m` }
    }
    if (t.element === 'glazing' || t.element === 'door') {
      const n = plan.windows.filter((w) => !!w.door === (t.element === 'door') && typeAt(plan, w.wall, w.t_m + w.width_m / 2, t.element as WallEl) === t.id).length
      return { n, text: count(n, t.element === 'door' ? 'door' : 'window') }
    }
    if (t.element === 'partition') return { n: 1, text: 'every one' }
    const a = plan.rooms.filter((r) => roomType(plan, r.id, t.element as 'roof' | 'floor') === t.id).reduce((n, r) => n + ringArea(r.ring), 0)
    return { n: a, text: `${f1(a)} m²` }
  }
  const typeName = (id: string) => plan.fabric_types.find((t) => t.id === id)?.name ?? id
  const unsetType = (t: FabricType | undefined) => !t || (t.construction == null && t.u == null)
  const fabricSwatch = (id: string): Swatch => ({ colour: typeColour(plan, id), unset: unsetType(plan.fabric_types.find((t) => t.id === id)) })
  const fabricLine = (t: FabricType) => {
    const c = construction(t.construction)
    const u = t.u ?? c?.u
    if (!c && t.u == null) return 'Not set yet'
    const from = setById(t.template)
    return [from ? `From ${from.name}` : '', c ? short(c.name) : 'Typed U-value', u != null ? `U ${u}${t.u != null && c ? ' (typed)' : ''}` : ''].filter(Boolean).join(' · ')
  }
  const showTypes = mode === 'fabric' && wallsKind
  const bandOf = (sp: Span) => typeColour(plan, typeOfSpan(plan, sp, onWalls(elem) ? elem : 'wall'))
  /** Apply the active type of the kind in hand to what is chosen (or every room). */
  const giveFabric = (all: boolean) => {
    const id = activeOf(elem)
    if (elem === 'roof' || elem === 'floor') return commit(setTypeOnRooms(plan, all ? allRooms() : chosenSet.rooms, id))
    commit(setTypeOn(plan, all ? pieces.map((p) => ({ run: p.run, t0: p.t0, t1: p.t1 })) : chosenPieces(), id))
  }

  // ─── spaces (step 4) ────────────────────────────────────────────────────────
  const spaceColour = (id: string | undefined) => {
    const i = plan.spaces.findIndex((x) => x.id === id)
    return i < 0 ? null : SPACE_COLOURS[i % SPACE_COLOURS.length]!
  }
  const curSpace = plan.spaces.find((x) => x.id === activeSpace) ?? plan.spaces[0] ?? null
  const newSpace = (from?: SpaceType) => {
    let k = plan.spaces.length + 1
    while (plan.spaces.some((x) => x.id === `s${k}`)) k++
    const sp: SpaceType = from
      ? { ...from, id: `s${k}`, name: `${from.name} (copy)` }
      : { id: `s${k}`, name: `Space type ${plan.spaces.length + 1}`, use: null, occupancy: null, lighting: null, equipment: null, ...todaysGains() }
    commit({ ...plan, spaces: [...plan.spaces, sp] })
    setActiveSpace(sp.id)
  }
  const setSpace = (id: string, q: Partial<SpaceType>) => commit({ ...plan, spaces: plan.spaces.map((x) => (x.id === id ? { ...x, ...q } : x)) })
  const giveSpaceTo = (ids: string[]) => curSpace && commit({ ...plan, rooms: plan.rooms.map((r) => (ids.includes(r.id) ? { ...r, space: curSpace.id } : r)) })
  /** Zones whose rooms have more than one space type (a zone gets one in the model). */
  const mixedZones = plan.zones.filter((z) => new Set(plan.rooms.filter((r) => r.zone === z.id).map((r) => r.space ?? '')).size > 1)
  /** Split a zone so each space type's rooms are a zone of their own (the type with the most floor keeps the zone). */
  const splitZone = (zid: string) => {
    const zone = plan.zones.find((z) => z.id === zid)
    if (!zone) return
    const groups = new Map<string, string[]>()
    for (const r of plan.rooms.filter((x) => x.zone === zid)) groups.set(r.space ?? '', [...(groups.get(r.space ?? '') ?? []), r.id])
    const area = (ids: string[]) => ids.reduce((t, id) => t + ringArea(plan.rooms.find((r) => r.id === id)!.ring), 0)
    const order = [...groups.entries()].sort((a, b) => area(b[1]) - area(a[1]))
    let p = plan
    for (const [sid, ids] of order.slice(1)) {
      const z = { ...blankZone(p.next.zone), name: `${zone.name} · ${plan.spaces.find((x) => x.id === sid)?.name ?? 'no space type'}` }
      p = assignZone({ ...p, zones: [...p.zones, z], next: { ...p.next, zone: p.next.zone + 1 } }, ids, z.id)
    }
    commit(p)
  }

  // ─── systems (step 5) ───────────────────────────────────────────────────────
  const systemsOf = (sv: Service) => plan.systems.filter((x) => x.service === sv)
  const sysColour = (id: string | undefined) => {
    const x = plan.systems.find((y) => y.id === id)
    return x ? SYSTEM_COLOURS[systemsOf(x.service).indexOf(x) % SYSTEM_COLOURS.length]! : null
  }
  const curSys = systemsOf(service).find((x) => x.id === activeSys[service]) ?? systemsOf(service)[0] ?? null
  const newSystem = (from?: PlanSystem) => {
    let k = plan.systems.length + 1
    while (plan.systems.some((x) => x.id === `y${k}`)) k++
    const one = SERVICES.find((x) => x.key === service)!.one
    const x: PlanSystem = from ? { ...from, id: `y${k}`, name: `${from.name} (copy)` } : { id: `y${k}`, service, name: `${one} ${systemsOf(service).length + 1}`, template: null, ...(service === 'ventilation' ? { flow: null, schedule: null } : {}), ...(service === 'lighting' ? { efficacy: null } : {}) }
    commit({ ...plan, systems: [...plan.systems, x] })
    setActiveSys((a) => ({ ...a, [service]: x.id }))
  }
  /** Not yet set: a library template, or for lighting (no templates) the luminaires' efficacy. */
  const sysUnset = (x: PlanSystem) => (x.service === 'lighting' ? x.efficacy == null : !x.template)
  const setSys = (id: string, q: Partial<PlanSystem>) => commit({ ...plan, systems: plan.systems.map((x) => (x.id === id ? { ...x, ...q } : x)) })
  const giveSystemTo = (ids: string[]) => curSys && commit({ ...plan, rooms: plan.rooms.map((r) => (ids.includes(r.id) ? { ...r, systems: { ...r.systems, [service]: curSys.id } } : r)) })
  const removeSystem = (id: string) => commit({ ...plan, systems: plan.systems.filter((x) => x.id !== id) })
  /** A library template's fuel and efficiency, in a line. */
  const sysLine = (key: string | null | undefined, s: Service) => {
    const t = system(key)
    if (!t) return 'Not set yet'
    if (!t.fuel) return 'None: no system in the model'
    const eff = s === 'heating' ? (t.scop != null ? `SCOP ${t.scop}` : t.efficiency != null ? `η ${t.efficiency}` : '') : s === 'cooling' ? (t.seer != null ? `SEER ${t.seer}` : t.efficiency != null ? `EER ${t.efficiency}` : '') : s === 'ventilation' ? [t.sfp != null ? `SFP ${t.sfp}` : '', t.heat_recovery ? `recovery ${Math.round(t.heat_recovery * 100)}%` : ''].filter(Boolean).join(', ') : t.efficiency != null ? `η ${t.efficiency}` : ''
    return [t.fuel, eff].filter(Boolean).join(' · ')
  }

  // ─── rooms and zones ───────────────────────────────────────────────────────
  const selRooms = sel?.kind === 'rooms' ? plan.rooms.filter((r) => sel.ids.includes(r.id)) : []
  /** The zone the person has chosen (every chosen room in one zone): Heat flow opens at it. */
  const focusZone = (() => {
    const ids = [...chosenSet.rooms, ...selRooms.map((r) => r.id)]
    const zs = new Set(plan.rooms.filter((r) => ids.includes(r.id)).map((r) => r.zone))
    return ids.length && zs.size === 1 && ids.length < plan.rooms.length ? [...zs][0]! : null
  })()
  const roomsIn = (zid: string) => plan.rooms.filter((r) => r.zone === zid)
  const setZoneOf = (v: string) => {
    if (v === '__mixed' || !selRooms.length) return
    let p = plan
    let zid = v
    if (v === '__new') {
      const z = blankZone(plan.next.zone)
      p = { ...plan, zones: [...plan.zones, z], next: { ...plan.next, zone: plan.next.zone + 1 } }
      zid = z.id
    }
    commit(assignZone(p, selRooms.map((r) => r.id), zid))
  }
  const tintOf = (zid: string) => zoneTint(Math.max(0, plan.zones.findIndex((z) => z.id === zid)))
  /** A room's fill: its zone (step 2), its roof or floor type (step 3), its space type (step 4). */
  const roomFill = (r: Plan['rooms'][number]) =>
    mode === 'profiles' ? (profSel && roomUses(r).includes(profSel) ? '#EA580C59' : '#FFFFFF')
    : mode === 'spaces' ? (spaceColour(r.space) ?? '#FFFFFF') + '59'
    : mode === 'systems' && sysKind === 'emitters' ? (emitColour(roomEmitters(r)[0]?.type) ?? '#FFFFFF') + '59'
    : mode === 'systems' ? (sysColour(r.systems?.[service]) ?? '#FFFFFF') + '59'
    : mode === 'fabric' ? (elem === 'roof' || elem === 'floor' ? typeColour(plan, roomType(plan, r.id, elem)) + '40' : '#FFFFFF')
    : tintOf(r.zone).fill
  /** Brief 120 P6: "short N h" (the system's capacity) on a room whose zone the system's capacity held below (above) its setpoint. */
  const shortMark = (r: Plan['rooms'][number]) => {
    if (service !== 'heating' && service !== 'cooling') return ''
    const sh = figs.now?.zones.find((z) => z.id === r.zone)?.short?.[service]
    // Short because of the system (alone, or with the room's own emitters at their limit too).
    const h = sh ? sh.system_short_hours + sh.both_short_hours : 0
    return h > 0 ? `short ${Math.round(h)} h` : ''
  }
  const roomSub = (r: Plan['rooms'][number]) =>
    mode === 'profiles' ? (profSel ? (roomUses(r).includes(profSel) ? 'uses it' : '') : `${f1(ringArea(r.ring))} m²`)
    : mode === 'spaces' ? (plan.spaces.find((x) => x.id === r.space)?.name ?? 'No space type')
    : mode === 'systems' && sysKind === 'emitters' ? (emitName(r) || 'No emitters')
    : mode === 'systems' ? shortMark(r) || (plan.systems.find((x) => x.id === r.systems?.[service])?.name ?? 'None given')
    : mode === 'fabric' && (elem === 'roof' || elem === 'floor') ? typeName(roomType(plan, r.id, elem))
    : `${f1(ringArea(r.ring))} m²`

  useEffect(() => { setPvAsk(null) }, [sel, mode, fkind, sysKind, opening, spaceKind])
  useEffect(() => {
    const g = giverRef.current
    if (!pvAsk || !g || !g.name) { if (pending) { setPending(null); pvKey.current = '' } return }
    if (!planIds.current.has(plan)) planIds.current.set(plan, ++planSeq.current)
    const key = JSON.stringify([pvAsk.all, g.name, g.colour, planIds.current.get(plan), chosenSet.rooms, chosenSet.pieces])
    if (key === pvKey.current) return
    pvKey.current = key
    capture.current = { plan: null }
    try { g.onGive(pvAsk.all) } finally { /* the give only wrote to capture */ }
    const next = capture.current.plan
    capture.current = null
    if (!next) { setPending(null); return }
    const same = JSON.stringify(next) === JSON.stringify(plan)
    const roomNames = (ids: string[]) => {
      const ns = ids.map((id) => plan.rooms.find((r) => r.id === id)?.name ?? id)
      return ns.length > 3 ? count(ns.length, 'room') : ns.length > 1 ? `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}` : ns[0] ?? ''
    }
    const changedRooms = next.rooms.filter((r) => JSON.stringify(r) !== JSON.stringify(plan.rooms.find((q) => q.id === r.id))).map((r) => r.id)
    const targetRooms = pvAsk.all ? allRooms() : chosenSet.rooms
    let pieces: Span[] = []
    let who: string
    let change: string
    let rooms: string[]
    if (g.rooms) {
      rooms = changedRooms.length || same ? changedRooms : targetRooms
      who = pvAsk.all ? 'the whole building' : roomNames(chosenSet.rooms)
      change = `${count(rooms.length, 'room')} ${rooms.length === 1 ? 'changes' : 'change'}`
    } else {
      pieces = pvAsk.all ? wallPieces(plan).map((q) => ({ run: q.run, t0: q.t0, t1: q.t1 })) : chosenPieces()
      const moved = pvAsk.all ? pieces.length : g.now.filter((n) => n !== g.name).length
      rooms = pvAsk.all ? allRooms() : chosenSet.rooms
      who = pvAsk.all ? 'the whole building' : `${count(pieces.length, 'wall part')}${chosenSet.rooms.length ? ` of ${roomNames(chosenSet.rooms)}` : ''}`
      change = `${count(moved, 'wall part')} ${moved === 1 ? 'changes' : 'change'}`
    }
    const ask = `Make ${who} ${g.name}?`
    setPending({ plan: next, who, name: g.name, change, ask, rooms, pieces, colour: g.colour, same })
  })
  useEffect(() => {
    if (!flash.length) return
    const t = setTimeout(() => setFlash([]), 1600)
    return () => clearTimeout(t)
  }, [flash])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 3200)
    return () => clearTimeout(t)
  }, [note])
  useEffect(() => { setChanges((c) => (c.some((x) => x.depth > past.length) ? c.filter((x) => x.depth <= past.length) : c)) }, [past.length])
  const previewDoc = useMemo(() => (pending && !pending.same ? buildDocument(pending.plan).doc : null), [pending])

  // ─── paint ─────────────────────────────────────────────────────────────────
  const P = (r: readonly XY[]) => r.map((p) => toPx(p).map((n) => n.toFixed(1)).join(',')).join(' ')
  const grid = (() => {
    const out: JSX.Element[] = []
    const g = view.k >= 16 ? 1 : 5
    const [x0, y1] = toM(0, 0)
    const [x1, y0] = toM(size[0], size[1])
    for (let x = Math.floor(x0 / g) * g; x <= x1; x += g) {
      const px = toPx([x, 0])[0]
      out.push(<line key={`x${x}`} className={`gl-gridline${Math.round(x) % 5 === 0 ? ' five' : ''}`} x1={px} x2={px} y1={0} y2={size[1]} />)
    }
    for (let y = Math.floor(y0 / g) * g; y <= y1; y += g) {
      const py = toPx([0, y])[1]
      out.push(<line key={`y${y}`} className={`gl-gridline${Math.round(y) % 5 === 0 ? ' five' : ''}`} y1={py} y2={py} x1={0} x2={size[0]} />)
    }
    return out
  })()
  const lenLabel = (a: XY, b: XY, key: string, live = false) => {
    const [ax, ay] = toPx(a)
    const [bx, by] = toPx(b)
    const L = Math.hypot(bx - ax, by - ay)
    if (L < 26) return null
    const nx = -(by - ay) / L
    const ny = (bx - ax) / L
    return (
      <text key={key} className={`gl-len${live ? ' live' : ''}`} x={(ax + bx) / 2 + nx * (15 + Math.abs(nx) * 16)} y={(ay + by) / 2 + ny * 15 + 4} textAnchor="middle">
        {f1(dist(a, b))} m
      </text>
    )
  }
  const hoverWall = (tool === 'select' || tool === 'corner' || (tool === 'pick' && (!giving || (mode === 'fabric' && wallsKind)))) && !drag && pointer ? wallAt(...toPx(pointer)) : null
  const hoverInner = tool === 'pick' && mode === 'rooms' && !drag && pointer && hoverWall == null ? innerSideAt(plan, pointer, GRAB * mPerPx) : null
  const liveInner = drag?.kind === 'wall' ? (() => { const r = moveWall(drag.base, drag.side, drag.by); return 'why' in r ? null : sideEnds(r.plan, drag.side) })() : hoverInner ? sideEnds(plan, hoverInner) : null
  const pushed = drag?.kind === 'push' ? shownRuns.find((r) => r.block === drag.block && r.side === drag.side) : undefined
  const th = turnHandle()
  const boxGhost = drag?.kind === 'box' ? (tool === 'tri' ? triRing(drag.a, drag.b) : boxRing(drag.a, drag.b)) : null
  const shapeGhost = tool === 'shape' && pointer && cs.corners.length ? (shift ? pointer : snapXY(pointer, GRID)) : null
  const closing = tool === 'shape' && shapeGhost && cs.corners.length >= 3 && Math.hypot(toPx(cs.corners[0] as XY)[0] - toPx(shapeGhost)[0], toPx(cs.corners[0] as XY)[1] - toPx(shapeGhost)[1]) <= CLOSE_PX
  const splitHit = tool === 'divide' && pointer && !drag ? wallHit(pointer, shift || !!cutFrom) : null
  const squareGhost = splitHit && !shift && !cutFrom ? squareFrom(splitHit, pointer!) : null
  const cornerGhost = tool === 'corner' && hoverWall != null && pointer ? onWall(hoverWall, pointer, step) : null
  const scaleM = [1, 2, 5, 10, 20, 50].find((s) => s * view.k >= 60) ?? 50
  const overBlock = pointer && mode === 'outline' ? blockAt(plan, pointer) >= 0 : false
  const cursor =
    drag?.kind === 'pan' && drag.moved ? 'grabbing'
    : drag?.kind === 'move' || drag?.kind === 'turn' ? 'grabbing'
    : drag?.kind === 'wall' || drag?.kind === 'push' || hoverInner || (tool === 'select' && hoverWall != null) ? 'col-resize'
    : tool === 'select' ? (overBlock ? 'move' : 'default')
    : tool === 'pick' ? 'pointer'
    : tool === 'corner' ? (hoverWall != null ? 'copy' : 'default')
    : 'crosshair'
  const tipLine =
    tool === 'divide' && cutFrom ? 'Now tap the other end. Esc to cancel.'
    : tool === 'join' && joinFrom ? 'Now tap the room beside it.'
    : drag?.kind === 'wall' || drag?.kind === 'push' ? `${drag.by >= 0 ? 'Out' : 'In'} ${f1(Math.abs(drag.by))} m${shift ? '' : ' (0.5 m steps; Shift: 0.1 m)'}`
    : drag?.kind === 'turn' ? `Turned ${Math.round((drag.rad * 180) / Math.PI)}°${shift ? '' : ' (15° steps; Shift: free)'}`
    : TOOLS[mode].find((t) => t.key === tool)?.line ?? ''
  const chosen = new Set(sel?.kind === 'rooms' ? sel.ids : sel?.kind === 'set' ? sel.rooms : joinFrom ? [joinFrom] : [])
  const chosenBlocks = new Set(drag?.kind === 'move' || drag?.kind === 'turn' ? drag.idx : selBlocks)

  // ─── steps 3 to 5: the two panels ───────────────────────────────────────────
  /** What each room has of the thing in hand, for the list on the left. */
  const hasOf = (r: Plan['rooms'][number]): { name: string; swatch: Swatch } | null => {
    if (mode === 'spaces') {
      const sp = plan.spaces.find((x) => x.id === r.space)
      return sp ? { name: sp.name, swatch: { colour: spaceColour(sp.id)! } } : null
    }
    if (mode === 'systems' && sysKind === 'emitters') {
      const es = roomEmitters(r)
      return es.length ? { name: emitName(r), swatch: { colour: emitColour(es[0]!.type)!, unset: es.some((e) => emitUnset(emitterTypes.find((t) => t.id === e.type)!)) } } : null
    }
    if (mode === 'systems') {
      const x = plan.systems.find((y) => y.id === r.systems?.[service])
      return x ? { name: x.name, swatch: { colour: sysColour(x.id)!, unset: !x.template } } : null
    }
    if (fkind === 'roof' || fkind === 'floor') {
      const id = roomType(plan, r.id, fkind)
      return { name: typeName(id), swatch: fabricSwatch(id) }
    }
    if (wallsKind) {
      const ids = [...new Set(piecesOfRooms(plan, [r.id]).map((p) => typeOfSpan(plan, p, elem as WallEl)))]
      if (!ids.length) return null
      return ids.length === 1 ? { name: typeName(ids[0]!), swatch: fabricSwatch(ids[0]!) } : { name: `${ids.length} types`, swatch: { colour: '#C3CBC7' } }
    }
    return null
  }
  // ─── Brief 118: the left navigates this step's own kinds (Linzie 11:37) ──────
  // The tabs along the top of the left are the step's kinds, with their icons (Fabric: external wall, ground floor,
  // roof, windows, doors…; Profiles: occupancy, lighting…), plus Rooms. A kind lists the project's things of that kind;
  // choosing one shows where it is applied on the drawing and opens its passport on the right.
  const NONE: Swatch = { colour: '#B8C0BC', unset: true }
  const roomsWhere = (f: (r: Plan['rooms'][number]) => boolean) => plan.rooms.filter(f).map((r) => r.id)
  const noneItem = (id: string, name: string, rooms: string[]) => (rooms.length ? [{ id, name, swatch: NONE, rooms }] : [])
  const newSystemFor = (sv: Service) => {
    let k = plan.systems.length + 1
    while (plan.systems.some((x) => x.id === `y${k}`)) k++
    const one = SERVICES.find((x) => x.key === sv)!.one
    const x: PlanSystem = { id: `y${k}`, service: sv, name: `${one} ${systemsOf(sv).length + 1}`, template: null, ...(sv === 'ventilation' ? { flow: null, schedule: null } : {}), ...(sv === 'lighting' ? { efficacy: null } : {}) }
    commit({ ...plan, systems: [...plan.systems, x] })
    setActiveSys((a) => ({ ...a, [sv]: x.id }))
  }
  const sysSection = (sv: Service): NavSection => ({
    items: [
      ...systemsOf(sv).map((x) => ({
        id: x.id, name: x.name, swatch: { colour: sysColour(x.id)!, unset: sysUnset(x) }, rooms: roomsWhere((r) => r.systems?.[sv] === x.id), onRename: (name: string) => setSys(x.id, { name }),
        active: curSys?.id === x.id, onPick: () => setActiveSys((a) => ({ ...a, [sv]: x.id })),
      })),
      ...noneItem(`none-${sv}`, `No ${SERVICES.find((x) => x.key === sv)!.name.toLowerCase()}`, roomsWhere((r) => !systemsOf(sv).some((x) => x.id === r.systems?.[sv]))),
    ],
    onNew: { label: `+ New ${SERVICES.find((x) => x.key === sv)!.one.toLowerCase()} system`, run: () => newSystemFor(sv) },
  })
  const showFabric = (el: FabricElement, id: string) => {
    if (el === 'glazing' || el === 'door') { setFkind('openings'); setOpening(el) } else setFkind(el as FabricKind)
    setActive((a) => ({ ...a, [el]: id }))
  }
  const [leftRooms, setLeftRooms] = [navBy === 'rooms', (on: boolean) => setNavBy(on ? 'rooms' : null)] as const
  const FAB_TABS: Kind[] = FABRIC_KINDS.flatMap((k): Kind[] => (k.key === 'openings' ? [{ key: 'glazing', name: 'Windows', icon: 'openings' }, { key: 'door', name: 'Doors', icon: 'openings' }] : [k]))
  const leftKinds = (): Kind[] =>
    mode === 'fabric' ? FAB_TABS
    : mode === 'spaces' ? [{ key: 'use', name: 'Building use', icon: 'building' }, { key: 'types', name: 'Space types', icon: 'person' }]
    : mode === 'systems' ? SYSTEM_KINDS
    : mode === 'profiles' ? PROFILE_KINDS.map((k) => ({ key: k.key, name: k.name, icon: k.icon }))
    : []
  const leftKind = mode === 'fabric' ? (fkind === 'openings' ? opening : fkind) : mode === 'spaces' ? spaceKind : mode === 'systems' ? sysKind : mode === 'profiles' ? profKind : ''
  const onLeftKind = (k: string) => {
    if (k === 'rooms') return setLeftRooms(true)
    setLeftRooms(false)
    if (mode === 'fabric') { if (k === 'glazing' || k === 'door') { setFkind('openings'); setOpening(k) } else setFkind(k as FabricKind) }
    else if (mode === 'spaces') setSpaceKind(k as 'types' | 'use')
    else if (mode === 'systems') setSysKind(k as SysKind)
    else if (mode === 'profiles') { setProfKind(k as ProfileKind); setProfSel(null) }
  }
  const navSections = (): NavSection[] => {
    if (mode === 'fabric') {
      if (fkind === 'set') {
        return [{ items: CONSTRUCTION_SETS.map((x) => ({ id: x.id, name: x.name, swatch: { colour: '#A1887F' }, rooms: plan.fabric_set === x.id ? allRooms() : [], active: (activeSet ?? plan.fabric_set) === x.id, onPick: () => setActiveSet(x.id) })) }]
      }
      if (fkind === 'air' || fkind === 'bridge') return [{ items: [{ id: fkind, name: 'Whole building', swatch: { colour: '#A1887F' }, rooms: allRooms(), active: true }] }]
      const el = elem
      const isWall = el === 'wall' || el === 'glazing' || el === 'door'
      return [{
        items: plan.fabric_types.filter((t) => t.element === el).map((t) => {
          const spans = isWall ? pieces.filter((p) => typeOfSpan(plan, p, el) === t.id).map((p) => ({ run: p.run, t0: p.t0, t1: p.t1 })) : []
          return {
            id: t.id, name: t.name, swatch: fabricSwatch(t.id), onRename: (name: string) => setFT(t.id, { name }),
            rooms: el === 'partition' ? [] : roomsWhere((r) => (el === 'roof' || el === 'floor' ? roomType(plan, r.id, el) === t.id : piecesOfRooms(plan, [r.id]).some((p) => typeOfSpan(plan, p, el) === t.id))),
            active: activeOf(el) === t.id,
            // Walls, windows and doors: choose the wall parts that have it, so the drawing shows exactly where.
            ...(isWall ? { choose: () => setChosen([], spans), count: spans.length, what: 'wall part' } : {}),
            onPick: () => showFabric(el, t.id),
          }
        }),
        onNew: { label: `+ New ${({ wall: 'external wall', glazing: 'window', door: 'door', roof: 'roof', floor: 'ground floor', partition: 'internal wall' } as const)[el]} type`, run: () => { const n = newType(plan, el); commit(n.plan); showFabric(el, n.id) } },
      }]
    }
    if (mode === 'spaces') {
      if (spaceKind === 'use') {
        return [{ items: BUILDING_USES.map((u) => ({ id: u.id, name: u.name, swatch: { colour: '#EA580C' }, rooms: plan.building_use === u.id ? allRooms() : [], active: (activeUse ?? plan.building_use) === u.id, onPick: () => setActiveUse(u.id) })) }]
      }
      return [{
        items: [
          ...plan.spaces.map((sp) => ({ id: sp.id, name: sp.name, swatch: { colour: spaceColour(sp.id)! }, rooms: roomsWhere((r) => r.space === sp.id), active: curSpace?.id === sp.id, onPick: () => setActiveSpace(sp.id), onRename: (name: string) => setSpace(sp.id, { name }) })),
          ...noneItem('none-space', 'No space type', roomsWhere((r) => !plan.spaces.some((sp) => sp.id === r.space))),
        ],
        onNew: { label: '+ New space type', run: () => newSpace() },
      }]
    }
    if (mode === 'systems') {
      if (sysKind === 'other') {
        return [{ items: otherLoads.map((l) => ({ id: l.id, name: l.name, onRename: (name: string) => setLoad(l.id, { name }), swatch: { colour: '#6B7280', unset: l.power_w == null || l.runs == null }, rooms: [], active: curLoad?.id === l.id, onPick: () => setActiveLoad(l.id) })), onNew: { label: '+ New other load', run: () => newLoad() } }]
      }
      if (sysKind === 'emitters') {
        return [{ items: emitterTypes.map((t) => ({ id: t.id, name: t.name, onRename: (name: string) => setEmit(t.id, { name }), swatch: { colour: emitColour(t.id)!, unset: emitUnset(t) }, rooms: roomsWhere((r) => roomEmitters(r).some((e) => e.type === t.id)), active: activeEmit === t.id, onPick: () => setActiveEmit(t.id) })), onNew: { label: '+ New emitter type', run: () => newEmitter() } }]
      }
      return [sysSection(sysKind)]
    }
    if (mode === 'profiles') {
      return [{
        items: projectProfiles().filter((key) => profile(key)!.schedule_type === profKind).map((key) => ({
          id: key, name: short(profile(key)!.name), swatch: { colour: '#EA580C' },
          rooms: roomsWhere((r) => { const sp = plan.spaces.find((x) => x.id === r.space); const v = plan.systems.find((x) => x.id === r.systems?.ventilation); return (!!sp && spaceUses(sp).includes(key)) || v?.schedule === key }),
          // On Profiles the drawing colours the rooms that use the profile chosen; nothing is chosen for applying.
          choose: () => undefined,
          active: profSel === key, onPick: () => setProfSel(key),
        })),
      }]
    }
    return []
  }

  const chooseList = () => (
    <ChooseList
      nav={{ by: leftRooms ? 'rooms' : leftKind, tabs: [...(mode === 'profiles' ? [] : [{ key: 'rooms', name: 'Rooms', icon: 'rooms' as const }]), ...leftKinds()], onBy: onLeftKind, sections: navSections() }}
      onNewZone={() => {
        const z = blankZone(plan.next.zone)
        const p = { ...plan, zones: [...plan.zones, z], next: { ...plan.next, zone: plan.next.zone + 1 } }
        commit(chosenSet.rooms.length ? assignZone(p, chosenSet.rooms, z.id) : p)
      }}
      onMoveTo={(zid) => commit(assignZone(plan, chosenSet.rooms, zid))}
      onRenameZone={(id, name) => commit({ ...plan, zones: plan.zones.map((z) => (z.id === id ? { ...z, name } : z)) })}
      onRemoveZone={(id) => commit({ ...plan, zones: plan.zones.filter((z) => z.id !== id) })}
      onRenameRoom={(id, name) => commit({ ...plan, rooms: plan.rooms.map((r) => (r.id === id ? { ...r, name } : r)) })}
      rows={plan.rooms.map((r) => ({ id: r.id, name: r.name, zone: r.zone, area: `${f1(ringArea(r.ring))} m²`, has: hasOf(r) }))}
      zones={plan.zones}
      chosen={new Set(chosenSet.rooms)}
      whole={{ area: `${f1(floorArea(plan.blocks))} m²` }}
      onChoose={chooseRooms}
      onNone={() => setSel(null)}
      extra={
        <>
          {chosenSet.pieces.length > 0 && (
            <p className="ap-pieces">
              <span>{count(chosenSet.pieces.length, 'wall part')} from the drawing, {f1(chosenSet.pieces.reduce((t, p) => t + p.t1 - p.t0, 0))} m</span>
              <button type="button" className="ap-link" onClick={() => setChosen(chosenSet.rooms, [])}>Clear</button>
            </p>
          )}
          {mode === 'spaces' && mixedZones.map((z) => (
            <div key={z.id} className="gl-mixed">
              <p className="gl-warn">{z.name} has rooms of different space types. The model gives a zone one, so it takes the one with the most floor.</p>
              <button type="button" className="gl-btn quiet" onClick={() => splitZone(z.id)}>Split {z.name} by space type</button>
            </div>
          ))}
        </>
      }
    />
  )

  /** The Apply footer: what is chosen, what it has now, and why Apply can't run yet (if it can't). */
  const giveFoot = (o: { name: string | null; rooms: boolean; now: string[]; onGive: (all: boolean) => void }) => {
    giverRef.current = { ...o, colour: giveColour() }
    const ps = mode === 'fabric' && !o.rooms ? chosenPieces() : []
    const nRooms = chosenSet.rooms.length
    const what = o.rooms
      ? nRooms ? `${count(nRooms, 'room')} chosen, ${f1(plan.rooms.filter((r) => chosenSet.rooms.includes(r.id)).reduce((t, r) => t + ringArea(r.ring), 0))} m²` : chosenSet.pieces.length ? 'Wall parts are chosen: this goes on rooms.' : 'Nothing chosen yet.'
      : ps.length ? `${count(ps.length, 'wall part')} chosen, ${f1(ps.reduce((t, p) => t + p.t1 - p.t0, 0))} m${nRooms ? ` (${count(nRooms, 'room')})` : ''}` : nRooms ? 'These rooms have no outside walls.' : 'Nothing chosen yet.'
    const empty = o.rooms ? !nRooms : !ps.length
    return {
      what,
      now: empty ? null : nowOf(o.now),
      why: !o.name ? 'Make one first.' : empty ? 'Choose rooms on the left or on the drawing.' : null,
      label: o.name ? `Preview ${o.name}` : 'Preview',
      onApply: () => setPvAsk({ all: false }),
      onAll: () => o.name && setPvAsk({ all: true }),
      preview: pending ? {
        same: pending.same,
        ask: pending.ask,
        change: pending.change,
        effect: pendingEffect(),
        onApply: applyPending,
        onCancel: () => setPvAsk(null),
      } : null,
    }
  }
  /** The colour of the type in hand: what the preview hatches in. */
  const giveColour = () =>
    mode === 'fabric' ? typeColour(plan, activeOf(elem))
    : mode === 'spaces' ? spaceColour(curSpace?.id) ?? '#6B7280'
    : mode === 'systems' && sysKind === 'emitters' ? emitColour(curEmit?.id) ?? '#6B7280'
    : mode === 'systems' ? sysColour(curSys?.id) ?? '#6B7280'
    : '#6B7280'
  /** The previewed figure for the card: heating now → if applied, in the top bar's unit. */
  const pendingEffect = () => {
    if (!pending || pending.same) return null
    if (!figs.now) return null
    if (!figs.preview) return figs.why ?? 'Working out the change…'
    // A system changes energy used, not demand: on Systems the card says energy used when the run has it.
    const its = previewItems(figs.now, figs.preview, unit)
    const e = its.find((x) => x.label === 'Energy used')
    if (mode === 'systems' && !e) {
      // Energy used shows only once every service has a system: say what this change brings it to, or that it is still missing.
      const pe = figs.preview.energy
      if (!pe?.ok) return 'Energy used: shown once every service has a system'
      const v = unit === 'kwh_per_m2' ? pe.total_kwh / figs.preview.building.floor_m2 : pe.total_kwh / 1000
      return `Energy used → ${v.toFixed(1)} ${unit === 'kwh_per_m2' ? 'kWh/m²' : 'MWh'} (every service now has a system)`
    }
    const h = (mode === 'systems' && e) || its[0]!
    return `${h.label} ${h.value} ${h.unit} (${h.sub})`
  }
  const applyPending = () => {
    if (!pending || pending.same) return
    const effect = pendingEffect()
    commit(pending.plan)
    setChanges((c) => [{ text: `${pending.who} → ${pending.name}`, effect: figs.preview && effect ? effect : null, depth: past.length + 1 }, ...c].slice(0, 30))
    setFlash(pending.rooms)
    setNote(`Applied: ${pending.name} to ${pending.who}. ${pending.change}.`)
    setPvAsk(null)
  }
  /** With something chosen, picking a type previews it on what is chosen. */
  const previewOnPick = <T,>(f: (id: T) => void) => (id: T) => {
    f(id)
    if (chosenSet.rooms.length || chosenSet.pieces.length) setPvAsk({ all: false })
  }

  /** Step 1 in the workspace: where the building is. Exposure is the same whole-building value Air leakage shows. */
  const sitePanel = () => {
    const bi = plan.building ?? noBuildingInputs()
    return (
      <GivePanel title="Site" icon="building" items={[]} active={null} onActive={() => undefined}
        body={
          <div className="ap-whole-body">
            <div className="gl-row"><span>Site exposure</span>
              <select className="gl-sel" aria-label="Site exposure" value={bi.exposure ?? ''} onChange={(e) => commit({ ...plan, building: { ...bi, exposure: (e.target.value || null) as BuildingInputs['exposure'] } })}>
                <option value="">Not set</option>
                <option value="sheltered">Sheltered</option>
                <option value="normal">Normal</option>
                <option value="exposed">Exposed</option>
              </select>
            </div>
            <p className="gl-hint">How much wind reaches the building: it drives air leakage and the vents. One value for the whole site.</p>
            <h4>Weather</h4>
            <div ref={setWeatherEl} />
            <p className="gl-hint">An EPW file from this computer, or one your organisation has saved. Every result is worked out on it, and names it.</p>
          </div>
        }
      />
    )
  }

  const fabricPanel = () => {
    const kinds = FABRIC_KINDS
    const k = FABRIC_KINDS.find((x) => x.key === fkind)!
    const bi = plan.building ?? noBuildingInputs()
    const setBi = (q: Partial<BuildingInputs>) => commit({ ...plan, building: { ...bi, ...q } })
    const onKind = (x: string) => setFkind(x as FabricKind)
    if (fkind === 'set') {
      const cur = setById(activeSet) ?? setById(plan.fabric_set) ?? null
      const items: Item[] = CONSTRUCTION_SETS.map((x) => ({ id: x.id, name: x.name, swatch: { colour: '#A1887F' }, line: x.line, used: plan.fabric_set === x.id ? 'whole building' : '', removable: false }))
      return (
        <GivePanel kinds={kinds} kind={fkind} onKind={onKind} title="Construction sets" icon="building" items={items} active={cur?.id ?? null} onActive={previewOnPick(setActiveSet)}
          detail={cur ? (
            <>
              <h4>{cur.name}</h4>
              {SET_ELEMENTS.map(({ key, name }) => {
                const c = construction(cur[key])
                return <div key={key} className="gl-row gl-typed"><span>{name}</span><span className="ap-setc" title={c?.name}>{c ? `${short(c.name)} · U ${c.u}` : 'Not in the library'}</span></div>
              })}
              <p className="gl-hint">Every value comes from NZA Sim's library. Apply puts these on the rooms chosen, or the whole building; change any room or wall afterwards on its own kind. Doors keep their own type (there is no door in the library yet).</p>
              <p className="gl-hint">Sets for existing buildings by age need their constructions added to the library first, for Chris to check.</p>
            </>
          ) : <p className="gl-hint ap-pnone">Choose a set to see what it puts on each part.</p>}
          give={giveFoot({ name: cur?.name ?? null, rooms: true, now: chosenSet.rooms.map((id) => setById(plan.fabric_set)?.name ?? `${typeName(roomType(plan, id, 'roof'))} roof`), onGive: (all) => cur && commit(applySet(plan, cur, all ? allRooms() : chosenSet.rooms)) })}
        />
      )
    }
    if (fkind === 'air' || fkind === 'bridge') {
      return (
        <GivePanel kinds={kinds} kind={fkind} onKind={onKind} title={k.name} icon={k.icon} items={[]} active={null} onActive={() => undefined}
          body={
            <div className="ap-whole-body">
              <p className="ap-wholenote"><Icon name="building" size={16} />The whole building. {fkind === 'air' ? 'An air test measures the whole envelope at once, so this goes on every room.' : 'Junctions are counted along every edge of the building, so this goes on every room.'}</p>
              {fkind === 'air' ? (
                <>
                  <div className="gl-row gl-librow"><span>Typical for</span>
                    <select className="gl-sel" aria-label="Air leakage, typical for" value={bi.q50 == null ? '' : (Q50_PRESETS.find((x) => x.v === bi.q50)?.v.toString() ?? 'own')} onChange={(e) => e.target.value !== 'own' && setBi({ q50: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Not set</option>
                      {Q50_PRESETS.map((x) => <option key={x.v} value={x.v}>{x.name} ({x.v})</option>)}
                      <option value="own" disabled>Own value (tested or target)</option>
                    </select>
                  </div>
                  <div className="gl-row"><span>Air leakage (q50)</span><Num value={bi.q50 ?? ''} unit="m³/h·m²" step={0.5} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v > 0 ? v : null; if (n !== bi.q50) setBi({ q50: n }) }} /></div>
                  {bi.q50 != null && <p className="ap-sysline">= {(bi.q50 / 3.6).toFixed(2)} l/s·m², at 50 Pa, per m² of outside envelope</p>}
                  <div className="gl-row"><span>Site exposure</span>
                    <select className="gl-sel" value={bi.exposure ?? ''} onChange={(e) => setBi({ exposure: (e.target.value || null) as BuildingInputs['exposure'] })}>
                      <option value="">Not set</option>
                      <option value="sheltered">Sheltered</option>
                      <option value="normal">Normal</option>
                      <option value="exposed">Exposed</option>
                    </select>
                  </div>
                  <p className="gl-hint">Use the air test result if there is one, or the Part L target for a new building. The list gives typical values to start from; type over them. Empty stays unset.</p>
                </>
              ) : (
                <>
                  <div className="gl-row gl-librow"><span>Junction detailing</span>
                    <select className="gl-sel" aria-label="Junction detailing" value={bi.tb_multiplier == null ? '' : (TB_PRESETS.find((x) => x.v === bi.tb_multiplier)?.v.toString() ?? 'own')} onChange={(e) => e.target.value !== 'own' && setBi({ tb_multiplier: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Not set</option>
                      {TB_PRESETS.map((x) => <option key={x.v} value={x.v}>{x.name}</option>)}
                      <option value="own" disabled>Own value</option>
                    </select>
                  </div>
                  <div className="gl-row"><span>Times the standard ψ values</span><Num value={bi.tb_multiplier ?? ''} unit="×" step={0.5} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v > 0 ? v : null; if (n !== bi.tb_multiplier) setBi({ tb_multiplier: n }) }} /></div>
                  <p className="gl-hint">The engine finds every junction from the drawing (roof edge, ground edge, floors, corners, round windows) and gives each the ISO 14683 standard ψ value, which is about what Part L's notional building assumes. Worse detailing multiplies them all. Empty stays unset.</p>
                </>
              )}
            </div>
          }
        />
      )
    }
    const types = plan.fabric_types.filter((t) => t.element === elem)
    const act = activeOf(elem)
    const at = plan.fabric_types.find((t) => t.id === act)
    const lib = constructionsFor(elem)
    const c = construction(at?.construction)
    const items: Item[] = types.map((t, i) => {
      const used = usage(t)
      return { id: t.id, name: t.name, swatch: fabricSwatch(t.id), line: fabricLine(t), used: used.text, removable: i > 0 && !used.n }
    })
    const detail = at && (
      <>
        <input className="gl-title-in ap-tname" aria-label="Type name" defaultValue={at.name} key={`${at.id}-${at.name}`} onBlur={(e) => e.target.value.trim() && e.target.value !== at.name && setFT(at.id, { name: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <div className="gl-row gl-librow"><span>Construction</span>
          <select className="gl-sel" aria-label={`Construction of ${at.name}`} value={at.construction ?? ''} onChange={(e) => setFT(at.id, { construction: e.target.value || null })}>
            <option value="">{lib.length ? 'Not set' : 'None in the library yet'}</option>
            {lib.map((x) => <option key={x.key} value={x.key}>{short(x.name)}{x.u != null ? ` · U ${x.u}` : ''}</option>)}
          </select>
          {at.construction && <button type="button" className="gl-info" aria-label={`Layers and values of ${at.name}`} title="See the construction in the library" onClick={() => setInspect({ name: at.construction!, glazing: at.element === 'glazing' })}>ⓘ</button>}
        </div>
        <div className="gl-row"><span>U-value you know</span>
          <label className="gl-u" title="Used over the library's. Empty: the library's.">
            <input aria-label={`U-value of ${at.name}`} inputMode="decimal" placeholder={c?.u != null ? String(c.u) : '—'} defaultValue={at.u ?? ''} key={`${at.id}-u-${at.u}`} onBlur={(e) => { const v = e.target.value.trim(); const u = v === '' ? null : Number(v); if (u === null || (Number.isFinite(u) && u > 0)) { if (u !== at.u) setFT(at.id, { u }) } else e.target.value = at.u == null ? '' : String(at.u) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            W/m²K
          </label>
        </div>
        <p className="gl-hint">{usage(at).n ? `Used on ${usage(at).text}: a change here changes all of it. Copy it for an exception.` : 'Not used yet.'}{elem === 'door' ? ' The library has no door constructions yet, so a door needs a typed U.' : ''}{elem === 'partition' ? " Every wall between zones takes this type. The library's internal wall is a draft (plaster, block, plaster from existing library layers) waiting for Chris to check." : ''}</p>
      </>
    )
    const isRooms = elem === 'roof' || elem === 'floor'
    return (
      <GivePanel
        kinds={kinds} kind={fkind} onKind={onKind}
        title={fkind === 'openings' ? 'Windows & doors' : k.name} icon={k.icon}
        items={items} active={act}
        onActive={previewOnPick((id) => setActive((a) => ({ ...a, [elem]: id })))}
        onNew={elem === 'partition' && types.length ? undefined : () => { const r = newType(plan, elem); commit(r.plan); setActive((a) => ({ ...a, [elem]: r.id })) }}
        onCopy={elem === 'partition' ? undefined : (id) => { const r = newType(plan, elem, plan.fabric_types.find((t) => t.id === id)); commit(r.plan); setActive((a) => ({ ...a, [elem]: r.id })) }}
        onRemove={(id) => commit({ ...plan, fabric_types: plan.fabric_types.filter((x) => x.id !== id), wall_spans: plan.wall_spans.filter((x) => x.type !== id) })}
        detail={detail}
        give={elem === 'partition' ? null : giveFoot({
          name: at?.name ?? null,
          rooms: isRooms,
          now: isRooms ? chosenSet.rooms.map((id) => typeName(roomType(plan, id, elem))) : chosenPieces().map((p) => typeName(typeOfSpan(plan, p, elem as WallEl))),
          onGive: giveFabric,
        })}
        top={fkind === 'openings' ? (
          <div className="gl-chips small" role="group" aria-label="Windows or doors">
            <button type="button" aria-pressed={opening === 'glazing'} onClick={() => setOpening('glazing')}>Windows</button>
            <button type="button" aria-pressed={opening === 'door'} onClick={() => setOpening('door')}>Doors</button>
          </div>
        ) : undefined}
      />
    )
  }

  // ─── Profiles (Brief 110b): the project's hour-by-hour patterns, pointed at by space types and systems ─────────
  /** What a space type points at, by profile key (a "with occupancy" relationship reads the occupancy profile). */
  const spaceUses = (sp: SpaceType): string[] => {
    const out: string[] = []
    if (sp.occupancy && sp.occupancy !== ALWAYS) out.push(sp.occupancy)
    if (sp.lighting && (sp.light_relationship === 'independent' || sp.light_relationship === 'proportional_with_spill')) out.push(sp.lighting)
    if (sp.equipment && sp.equip_relationship === 'independent') out.push(sp.equipment)
    return out
  }
  const roomUses = (r: Plan['rooms'][number]): string[] => {
    const sp = plan.spaces.find((x) => x.id === r.space)
    const sys = Object.values(r.systems ?? {}).map((id) => plan.systems.find((x) => x.id === id)?.schedule).filter((k): k is string => !!k && k !== 'always_on')
    return [...(sp ? spaceUses(sp) : []), ...sys]
  }
  const usersOf = (key: string): string[] => [
    ...plan.spaces.filter((sp) => spaceUses(sp).includes(key)).map((sp) => `${sp.name} (space type)`),
    ...plan.systems.filter((x) => x.schedule === key).map((x) => `${x.name} (system)`),
  ]
  const projectProfiles = (): string[] => {
    const used = [...plan.spaces.flatMap(spaceUses), ...plan.systems.map((x) => x.schedule).filter((k): k is string => !!k && k !== 'always_on')]
    return [...new Set([...(plan.profiles ?? []), ...used])].filter((k) => !!profile(k))
  }
  /** A profile choice on Spaces or Systems: the project's own profiles first (the Profiles step), then the library. */
  const profOptions = (items: Array<{ key: string; name: string }>) => {
    const mine = new Set(projectProfiles())
    const a = items.filter((x) => mine.has(x.key) || !profile(x.key)), b = items.filter((x) => !mine.has(x.key) && profile(x.key))
    const o = (x: { key: string; name: string }) => <option key={x.key} value={x.key}>{short(x.name)}</option>
    return !a.length || !b.length ? items.map(o) : <><optgroup label="This project's profiles">{a.map(o)}</optgroup><optgroup label="More in the library">{b.map(o)}</optgroup></>
  }
  const profilesPanel = () => {
    const kind = PROFILE_KINDS.find((k) => k.key === profKind)!
    const mine = projectProfiles().filter((k) => profile(k)!.schedule_type === kind.key)
    const others = profilesFor(kind.key).filter((p) => !mine.includes(p.key))
    const sel = profSel && mine.includes(profSel) ? profile(profSel)! : null
    const items: Item[] = mine.map((k) => {
      const p = profile(k)!, u = usersOf(k)
      return { id: k, name: short(p.name), swatch: { colour: '#EA580C' }, line: 'From the library', used: u.length ? count(u.length, 'user') : 'not used', removable: !u.length }
    })
    return (
      <GivePanel
        kinds={PROFILE_KINDS.map((k) => ({ key: k.key, name: k.name, icon: k.icon }))} kind={profKind} onKind={(k) => { setProfKind(k as ProfileKind); setProfSel(null) }}
        title={`${kind.name} profiles`} icon="profile"
        items={items} active={sel?.key ?? null}
        onActive={setProfSel}
        onRemove={(id) => { commit({ ...plan, profiles: (plan.profiles ?? []).filter((k) => k !== id) }); if (profSel === id) setProfSel(null) }}
        top={
          <div className="gl-row gl-librow"><span>Add from the library</span>
            <select className="gl-sel" aria-label={`Add a ${kind.name.toLowerCase()} profile`} value="" onChange={(e) => { const k = e.target.value; if (k) { commit({ ...plan, profiles: [...(plan.profiles ?? []), k] }); setProfSel(k) } }}>
              <option value="">{others.length ? 'Choose one…' : 'None left in the library'}</option>
              {others.map((p) => <option key={p.key} value={p.key}>{short(p.name)}</option>)}
            </select>
          </div>
        }
        detail={sel ? (
          <>
            <h3 className="ap-pname">{sel.name}</h3>
            <Spark label={kind.spark} days={sel.day_types ?? null} />
            <p className="gl-hint">{usersOf(sel.key).length ? `Used by ${usersOf(sel.key).join(', ')}.` : `Not used yet: ${kind.where}.`}</p>
            <p className="gl-hint">From today's NZA Sim library, as it is there. To change its hours, use today's <a href="/gains">Profiles page</a>; making a project's own profile here comes next.</p>
          </>
        ) : (
          <p className="gl-hint ap-pnone">{mine.length ? 'Choose one to see its day and what uses it.' : `None in this project yet. Add one from the library; ${kind.where}.`}</p>
        )}
        give={null}
      />
    )
  }

  const spacesPanel = () => {
    const sp = curSpace
    const opt = (label: string, k: keyof SpaceType, items: Array<{ key: string; name: string }>) => sp && (
      <div className="gl-row gl-librow">
        <span>{label}</span>
        <select className="gl-sel" aria-label={label} value={(sp[k] as string | null) ?? ''} onChange={(e) => setSpace(sp.id, { [k]: e.target.value || null })}>
          <option value="">Not set</option>
          {profOptions(items)}
        </select>
      </div>
    )
    // A value the library has no number for: typed here; empty stays unset (the document says nothing).
    type Gk = 'radiant_fraction' | 'light_area_share' | 'light_gain_fraction' | 'daylight_factor' | 'equip_area_share' | 'equip_gain_fraction' | 'standby_factor' | 'heat_c' | 'cool_c' | 'people_per_m2' | 'sensible_w_per_person' | 'occupancy_rate' | 'lighting_w_per_m2' | 'equipment_w_per_m2' | 'equipment_baseload_w_per_m2' | 'people_per_room' | 'lux' | 'hot_water_litres'
    const typed = (label: string, k: Gk, step: number, unit?: string, max?: number) => sp && (
      <div className="gl-row gl-typed">
        <span>{label}</span>
        <Num value={sp[k] ?? ''} unit={unit} step={step} min={0} max={max} onCommit={(v) => { const n = Number.isFinite(v) && v >= 0 && (max == null || v <= max) ? (v > 0 || k === 'equipment_baseload_w_per_m2' ? v : null) : (sp[k] ?? null); if (n !== (sp[k] ?? null)) setSpace(sp.id, { [k]: n }) }} />
      </div>
    )
    const items: Item[] = plan.spaces.map((x) => {
      const rs = plan.rooms.filter((r) => r.space === x.id)
      return { id: x.id, name: x.name, swatch: { colour: spaceColour(x.id)! }, line: USES.find((u) => u.key === x.use)?.name ?? 'Use not set', used: rs.length ? `${count(rs.length, 'room')}` : 'not used', removable: !rs.length }
    })
    const SPACE_KINDS: Kind[] = [{ key: 'use', name: 'Building use', icon: 'building' }, { key: 'types', name: 'Space types', icon: 'person' }]
    if (spaceKind === 'use') {
      const cur = useById(activeUse) ?? useById(plan.building_use) ?? null
      const uses: Item[] = BUILDING_USES.map((u) => ({ id: u.id, name: u.name, swatch: { colour: '#EA580C' }, line: roomKindsOf(u).map((b) => b.name).join(', '), used: plan.building_use === u.id ? 'whole building' : '', removable: false }))
      return (
        <GivePanel kinds={SPACE_KINDS} kind="use" onKind={(k) => setSpaceKind(k as 'types' | 'use')} title="Building uses" icon="building"
          items={uses} active={cur?.id ?? null} onActive={previewOnPick(setActiveUse)}
          detail={cur && (
            <>
              <h4>{cur.name}</h4>
              <p className="gl-hint">Brings these space types, each filled from NZA Sim's profiles and today's Internal Gains templates (occupancy, lighting, equipment and comfort temperatures). Apply gives the rooms chosen the {roomKindsOf(cur).find((b) => b.key === cur.main)!.name.toLowerCase()} type; give the others to their rooms on Space types.</p>
              {roomKindsOf(cur).map((b) => <div key={b.key} className="gl-row"><span>{b.name}</span><span className="ap-setc">{b.key === cur.main ? 'on the rooms chosen' : 'made, ready to give'}</span></div>)}
              <p className="gl-hint">People per m² is not in the library, so it stays unset until typed. Schools and other uses need their profiles added to the library first, for Chris to check.</p>
            </>
          )}
          give={giveFoot({ name: cur?.name ?? null, rooms: true, now: chosenSet.rooms.map((id) => plan.spaces.find((x) => x.id === plan.rooms.find((r) => r.id === id)?.space)?.name ?? 'none'), onGive: (all) => cur && commit(applyUse(plan, cur, all ? allRooms() : chosenSet.rooms, todaysGains)) })}
        />
      )
    }
    return (
      <GivePanel
        kinds={SPACE_KINDS} kind="types" onKind={(k) => setSpaceKind(k as 'types' | 'use')}
        title="Space types" icon="person"
        items={items} active={sp?.id ?? null}
        onActive={previewOnPick(setActiveSpace)}
        onNew={() => newSpace()} newLabel="New space type"
        onCopy={(id) => newSpace(plan.spaces.find((x) => x.id === id))}
        onRemove={(id) => commit({ ...plan, spaces: plan.spaces.filter((x) => x.id !== id) })}
        detail={sp && (
          <>
            <input className="gl-title-in ap-tname" aria-label="Space type name" defaultValue={sp.name} key={`${sp.id}-${sp.name}`} onBlur={(e) => e.target.value.trim() && e.target.value !== sp.name && setSpace(sp.id, { name: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            <div className="ap-borrow">
              <div className="gl-row gl-librow"><span>Used for</span>
                <select className="gl-sel" aria-label="Used for" value={sp.borrowed ?? ''} onChange={(e) => { const bw = BORROWS.find((x) => x.key === e.target.value); setSpace(sp.id, bw ? borrow(bw) : { borrowed: null }) }}>
                  <option value="">Not chosen</option>
                  {BORROWS.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                </select>
              </div>
              <p>{sp.borrowed ? borrowedFrom(BORROWS.find((x) => x.key === sp.borrowed)!) + ' All can be changed below.' : "Pick one to fill this in from today's NZA Sim profiles, or fill it in yourself."}</p>
            </div>
            {opt('Use', 'use', USES as Array<{ key: string; name: string }>)}
            <h4 className="gl-h4i"><Icon name="person" size={18} />People</h4>
            {opt('Occupancy', 'occupancy', [{ key: ALWAYS, name: 'In all the time (100%)' }, ...profilesFor('occupancy')])}
            <Spark label="Occupancy" days={sp.occupancy === ALWAYS ? { weekday: Array(24).fill(1) } : profile(sp.occupancy ?? '')?.day_types ?? null} />
            <div className="gl-row gl-librow"><span>Count people</span>
              <select className="gl-sel" aria-label="Count people" value={sp.people_basis ?? 'per_m2'} onChange={(e) => setSpace(sp.id, { people_basis: e.target.value as 'per_m2' | 'per_room' })}>
                <option value="per_m2">Per m² of floor</option>
                <option value="per_room">Per room</option>
              </select>
            </div>
            {sp.people_basis === 'per_room' ? typed('People in each room', 'people_per_room', 1) : typed('People per m²', 'people_per_m2', 0.01)}
            {typed('Heat per person', 'sensible_w_per_person', 5, 'W')}
            {typed('Occupancy rate', 'occupancy_rate', 0.05, undefined, 1)}
            <h4 className="gl-h4i"><Icon name="lighting" size={18} />Lighting</h4>
            {typed('Light needed', 'lux', 50, 'lux')}
            {sp.lux != null ? (() => {
              // Read-only: lux ÷ 100 × the efficacy of the luminaires lighting this space type's rooms (Systems).
              const effs = [...new Set(plan.rooms.filter((r) => r.space === sp.id).map((r) => plan.systems.find((y) => y.id === r.systems?.lighting)?.efficacy ?? null))]
              const e = effs.length === 1 ? effs[0] : null
              return <div className="gl-row"><span>Lighting power</span><span className="ap-setc">{e != null ? `${lightingWm2(sp.lux, e).toFixed(1)} W/m², from ${sp.lux} lux × ${e}` : effs.length > 1 ? 'its rooms have luminaires of different efficacies' : 'from the luminaires\' efficacy (Systems, Lighting)'}</span></div>
            })() : sp.lighting_w_per_m2 != null && typed('Lighting power, stated', 'lighting_w_per_m2', 0.5, 'W/m²')}
            {sp.lux == null && sp.lighting_w_per_m2 != null && <p className="gl-hint">Stated, not from lux. Type the light needed above to work it out from the luminaires instead.</p>}
            {opt('Follows', 'light_relationship', [...RELATIONSHIPS, { key: 'always_on', name: 'Always on' }])}
            {(sp.light_relationship === 'independent' || sp.light_relationship === 'proportional_with_spill') && opt('Its profile', 'lighting', profilesFor('lighting'))}
            {sp.light_relationship === 'independent' || sp.light_relationship === 'proportional_with_spill'
              ? <Spark label="Lighting" days={profile(sp.lighting ?? '')?.day_types ?? null} />
              : sp.light_relationship === 'always_on' ? <Spark label="Lighting" days={{ weekday: Array(24).fill(1) }} /> : null}
            <h4 className="gl-h4i"><Icon name="power" size={18} />Equipment</h4>
            {typed('In use', 'equipment_w_per_m2', 0.5, 'W/m²')}
            {typed('Always on', 'equipment_baseload_w_per_m2', 0.5, 'W/m²')}
            {opt('Follows', 'equip_relationship', RELATIONSHIPS.filter((x) => x.key !== 'proportional_with_spill'))}
            {sp.equip_relationship === 'independent' && opt('Its profile', 'equipment', profilesFor('equipment'))}
            {sp.equip_relationship === 'independent' && <Spark label="Equipment" days={profile(sp.equipment ?? '')?.day_types ?? null} />}
            <p className="gl-hint">"With occupancy" uses the occupancy profile above, so lighting and equipment rise and fall with the people.</p>
            <h4 className="gl-h4i"><Icon name="dhw" size={18} />Hot water</h4>
            <div className="gl-row gl-librow"><span>Used</span>
              <select className="gl-sel" aria-label="Hot water counted" value={sp.hot_water_basis ?? ''} onChange={(e) => setSpace(sp.id, { hot_water_basis: (e.target.value || null) as SpaceType['hot_water_basis'] })}>
                <option value="">Not set</option>
                <option value="per_person">Per person</option>
                <option value="per_m2">Per m² of floor</option>
              </select>
            </div>
            {sp.hot_water_basis && typed('Litres a day', 'hot_water_litres', sp.hot_water_basis === 'per_person' ? 5 : 0.5, sp.hot_water_basis === 'per_person' ? 'per person' : 'per m²')}
            <h4>Comfort</h4>
            {typed('Heating to', 'heat_c', 0.5, '°C', 40)}
            {typed('Cooling to', 'cool_c', 0.5, '°C', 40)}
            <p className="gl-hint">Held every hour for now. A lower temperature outside occupied hours (setback) needs the engine first; asked.</p>
            <details className="gl-more">
              <summary>How the gains enter the room</summary>
              {typed('Radiant share', 'radiant_fraction', 0.05, undefined, 1)}
              {sp.light_relationship === 'proportional_with_spill' && typed('Daylight factor', 'daylight_factor', 0.05, undefined, 1)}
              {typed('Lit share of floor', 'light_area_share', 0.05)}
              {typed('Lighting heat to room', 'light_gain_fraction', 0.05, undefined, 1)}
              {sp.equip_relationship !== 'independent' && typed('Standby when empty', 'standby_factor', 0.05, undefined, 1)}
              {typed('Equipped share of floor', 'equip_area_share', 0.05)}
              {typed('Equipment heat to room', 'equip_gain_fraction', 0.05, undefined, 1)}
              <p className="gl-hint">Shares and factors run 0 to 1. A new space type starts from today's engine values; all can be changed. Empty: not stated, and the results say so.</p>
              <div className="gl-btns"><button type="button" className="gl-btn quiet" onClick={() => setSpace(sp.id, { ...todaysGains(), equipment_baseload_w_per_m2: sp.equipment_baseload_w_per_m2 ?? 0, occupancy_rate: sp.occupancy_rate ?? TODAY.occupancy_rate, sensible_w_per_person: sp.sensible_w_per_person ?? TODAY.sensible_w_per_person })}>Fill with today's engine values</button></div>
            </details>
            <p className="gl-hint">Profiles are the library's daily shapes; the numbers are typed here. A change changes every room of this type.</p>
          </>
        )}
        give={giveFoot({ name: sp?.name ?? null, rooms: true, now: chosenSet.rooms.map((id) => plan.spaces.find((x) => x.id === plan.rooms.find((r) => r.id === id)?.space)?.name ?? 'none'), onGive: (all) => giveSpaceTo(all ? allRooms() : chosenSet.rooms) })}
      />
    )
  }

  // ─── emitters (step 5): types made once, given to rooms with a count ─────────
  const emitterTypes = plan.emitter_types ?? []
  const emitColour = (id: string | undefined) => {
    const i = emitterTypes.findIndex((x) => x.id === id)
    return i < 0 ? null : SYSTEM_COLOURS[(i + 3) % SYSTEM_COLOURS.length]!
  }
  const curEmit = emitterTypes.find((x) => x.id === activeEmit) ?? emitterTypes[0] ?? null
  const emitUnset = (t: EmitterType) => t.rated_output_w == null || t.radiant_fraction == null || (isWet(t.kind) && [t.rated_flow_c, t.rated_return_c, t.rated_room_c, t.exponent_n].some((v) => v == null))
  const roomEmitters = (r: Plan['rooms'][number]) => (r.emitters ?? []).filter((e) => e.count > 0 && emitterTypes.some((t) => t.id === e.type))
  const emitName = (r: Plan['rooms'][number]) => roomEmitters(r).map((e) => `${e.count} × ${emitterTypes.find((t) => t.id === e.type)!.name}`).join(', ')
  const newEmitter = (from?: EmitterType) => {
    let k = emitterTypes.length + 1
    while (emitterTypes.some((x) => x.id === `e${k}`)) k++
    const x: EmitterType = from ? { ...from, id: `e${k}`, name: `${from.name} (copy)` } : { id: `e${k}`, name: `Radiator ${emitterTypes.length + 1}`, kind: 'radiator', rated_output_w: null, radiant_fraction: null, rated_flow_c: 75, rated_return_c: 65, rated_room_c: 20, exponent_n: null }
    commit({ ...plan, emitter_types: [...emitterTypes, x] })
    setActiveEmit(x.id)
  }
  const setEmit = (id: string, q: Partial<EmitterType>) => commit({ ...plan, emitter_types: emitterTypes.map((x) => (x.id === id ? { ...x, ...q } : x)) })
  const giveEmitterTo = (ids: string[]) => curEmit && commit({ ...plan, rooms: plan.rooms.map((r) => (ids.includes(r.id) ? { ...r, emitters: [...(r.emitters ?? []).filter((e) => e.type !== curEmit.id), ...(emitCount > 0 ? [{ type: curEmit.id, count: emitCount }] : [])] } : r)) })

  const emittersPanel = () => {
    const x = curEmit
    const items: Item[] = emitterTypes.map((t) => {
      const n = plan.rooms.reduce((s2, r) => s2 + (r.emitters ?? []).filter((e) => e.type === t.id).reduce((a, e) => a + e.count, 0), 0)
      const kind = EMITTER_KINDS.find((k) => k.key === t.kind)!.name
      return { id: t.id, name: t.name, swatch: { colour: emitColour(t.id)!, unset: emitUnset(t) }, line: [kind, t.rated_output_w != null ? `${t.rated_output_w} W each` : 'output not set'].join(' · '), used: n ? `${n} in rooms` : 'not used', removable: !n }
    })
    const wet = x ? isWet(x.kind) : false
    const num = (label: string, k: 'rated_output_w' | 'radiant_fraction' | 'rated_flow_c' | 'rated_return_c' | 'rated_room_c' | 'exponent_n', step: number, unit?: string, max?: number) => x && (
      <div className="gl-row gl-typed"><span>{label}</span><Num value={x[k] ?? ''} unit={unit} step={step} min={0} max={max} onCommit={(v) => { const n = Number.isFinite(v) && v > 0 && (max == null || v <= max) ? v : k === 'radiant_fraction' && v === 0 ? 0 : x[k]; if (n !== x[k]) setEmit(x.id, { [k]: n }) }} /></div>
    )
    return (
      <GivePanel
        kinds={SYSTEM_KINDS} kind={sysKind} onKind={(k) => setSysKind(k as SysKind)}
        title="Emitters" icon="heating"
        items={items} active={x?.id ?? null}
        onActive={previewOnPick(setActiveEmit)}
        onNew={() => newEmitter()} newLabel="New emitter"
        onCopy={(id) => newEmitter(emitterTypes.find((t) => t.id === id))}
        onRemove={(id) => commit({ ...plan, emitter_types: emitterTypes.filter((t) => t.id !== id) })}
        detail={x && (
          <>
            <input className="gl-title-in ap-tname" aria-label="Emitter name" defaultValue={x.name} key={`${x.id}-${x.name}`} onBlur={(e) => e.target.value.trim() && e.target.value !== x.name && setEmit(x.id, { name: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            <div className="gl-row gl-librow"><span>Kind</span>
              <select className="gl-sel" aria-label="Emitter kind" value={x.kind} onChange={(e) => setEmit(x.id, { kind: e.target.value as EmitterKind })}>
                {EMITTER_KINDS.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
              </select>
            </div>
            {num(wet ? 'Output of one, rated' : 'Output of one', 'rated_output_w', 50, 'W')}
            {num('Radiant share', 'radiant_fraction', 0.05, undefined, 1)}
            {wet && (
              <>
                <h4>Rated at (EN 442)</h4>
                {num('Flow', 'rated_flow_c', 1, '°C')}
                {num('Return', 'rated_return_c', 1, '°C')}
                {num('Room', 'rated_room_c', 1, '°C')}
                {num('Exponent n', 'exponent_n', 0.05)}
                <p className="gl-hint">From the maker's data. A new radiator starts at the EN 442 rating, 75/65/20 °C. n is about 1.3 for panel radiators, 1.1 underfloor, 1.0 fan coils. Its output is re-rated at the heating system's design flow and return.</p>
              </>
            )}
            {!wet && <p className="gl-hint">A fixed output, not fed by the heating system's water.</p>}
            <div className="gl-row gl-typed ap-count"><span>How many in each room</span><Num value={emitCount} step={1} min={0} onCommit={(v) => setEmitCount(Number.isFinite(v) && v >= 0 ? Math.round(v) : 1)} /></div>
            <p className="gl-hint">Apply puts this many in each chosen room (0 takes them out). A room's emitters cap the heat it can get; a room with none is not capped.</p>
          </>
        )}
        give={giveFoot({ name: x ? `${emitCount} × ${x.name}` : null, rooms: true, now: chosenSet.rooms.map((id) => emitName(plan.rooms.find((r) => r.id === id)!) || 'none'), onGive: (all) => giveEmitterTo(all ? allRooms() : chosenSet.rooms) })}
      />
    )
  }

  // ─── Brief 114: other building loads (lifts, external lighting), outside the rooms ─────────
  const otherLoads = plan.other_loads ?? []
  const curLoad = otherLoads.find((x) => x.id === activeLoad) ?? otherLoads[0] ?? null
  const LOAD_KINDS: Array<{ key: OtherLoadInput['kind']; name: string }> = [{ key: 'lift', name: 'Lift' }, { key: 'external_lighting', name: 'External lighting' }, { key: 'other', name: 'Other' }]
  const newLoad = () => {
    let k = otherLoads.length + 1
    while (otherLoads.some((x) => x.id === `load_${k}`)) k++
    const x: OtherLoadInput = { id: `load_${k}`, kind: 'lift', name: `Lift ${otherLoads.filter((y) => y.kind === 'lift').length + 1}`, power_w: null, runs: null, schedule: null }
    commit({ ...plan, other_loads: [...otherLoads, x] })
    setActiveLoad(x.id)
  }
  const setLoad = (id: string, q: Partial<OtherLoadInput>) => commit({ ...plan, other_loads: otherLoads.map((x) => (x.id === id ? { ...x, ...q } : x)) })
  const otherLoadsPanel = () => {
    const x = curLoad
    const items: Item[] = otherLoads.map((l) => ({ id: l.id, name: l.name, swatch: { colour: '#6B7280', unset: l.power_w == null || l.runs == null }, line: `${LOAD_KINDS.find((k) => k.key === l.kind)!.name}${l.power_w != null ? ` · ${l.power_w} W` : ''}`, used: 'the building', removable: true }))
    const res = figs.now?.energy && figs.now.energy.ok ? figs.now.energy.other_loads.find((r) => r.id === x?.id) : null
    return (
      <GivePanel
        kinds={SYSTEM_KINDS} kind={sysKind} onKind={(k) => setSysKind(k as SysKind)}
        title="Other building loads" icon="power"
        items={items} active={x?.id ?? null} onActive={setActiveLoad}
        onNew={newLoad} newLabel="New load"
        onRemove={(id) => commit({ ...plan, other_loads: otherLoads.filter((y) => y.id !== id) })}
        detail={x ? (
          <>
            <input className="gl-title-in ap-tname" aria-label="Load name" defaultValue={x.name} key={`${x.id}-${x.name}`} onBlur={(e) => e.target.value.trim() && e.target.value !== x.name && setLoad(x.id, { name: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            <div className="gl-row gl-librow"><span>What it is</span>
              <select className="gl-sel" aria-label="What the load is" value={x.kind} onChange={(e) => setLoad(x.id, { kind: e.target.value as OtherLoadInput['kind'] })}>
                {LOAD_KINDS.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
              </select>
            </div>
            <div className="gl-row gl-typed"><span>Power</span><Num value={x.power_w ?? ''} unit="W" step={50} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v >= 0 ? v : null; if (n !== x.power_w) setLoad(x.id, { power_w: n }) }} /></div>
            <div className="gl-row gl-librow"><span>Runs</span>
              <select className="gl-sel" aria-label="When the load runs" value={x.runs ?? ''} onChange={(e) => setLoad(x.id, { runs: (e.target.value || null) as OtherLoadInput['runs'], ...(e.target.value === 'continuous' ? { schedule: null } : {}) })}>
                <option value="">Not set</option>
                <option value="continuous">Every hour</option>
                <option value="schedule">On a schedule</option>
                <option value="dusk_to_dawn">Dusk to dawn (photocell)</option>
              </select>
            </div>
            {(x.runs === 'schedule' || x.runs === 'dusk_to_dawn') && (
              <div className="gl-row gl-librow"><span>{x.runs === 'dusk_to_dawn' ? 'And within' : 'Schedule'}</span>
                <select className="gl-sel" aria-label="Load schedule" value={x.schedule ?? ''} onChange={(e) => setLoad(x.id, { schedule: e.target.value || null })}>
                  <option value="">{x.runs === 'dusk_to_dawn' ? 'All night (no time clock)' : 'Not set'}</option>
                  {profOptions(profilesFor('ventilation'))}
                </select>
              </div>
            )}
            {res && <div className="gl-row"><span>In the year</span><span className="ap-setc">{Math.round(res.hours_run).toLocaleString('en-GB')} h, {Math.round(res.kwh).toLocaleString('en-GB')} kWh</span></div>}
            <p className="gl-hint">Power while it runs, in W. Dusk to dawn runs the hours the weather file has no daylight; with a schedule too, only inside it (photocell and time clock). Its heat warms no room. Empty stays unset.</p>
          </>
        ) : <p className="gl-hint ap-pnone">Lifts, external lighting and other loads outside the rooms. Add one with "New load".</p>}
        give={null}
      />
    )
  }
  /** Brief 114: a system's pumps block. An edit clears "default, from …". */
  const pumpsBlock = (x: PlanSystem, sv: Service) => {
    const pu: PlanPumps = x.pumps ?? noPumps()
    const setPu = (q: Partial<PlanPumps>) => setSys(x.id, { pumps: { ...pu, ...q, default_from: null } })
    const dflt = () => {
      const d = defaultPumps(built.doc as Parameters<typeof defaultPumps>[0], `${sv}_${x.id}`)
      if (!d) return setPumpNote(x.id)
      const [basis, value] = Object.entries(d.power)[0] as [PlanPumps['basis'], number]
      setPumpNote(null)
      setSys(x.id, { pumps: { basis, value, speed: d.speed, runs: d.runs, schedule: null, default_from: d.default_from } })
    }
    return (
      <>
        <h4>Pumps</h4>
        <div className="gl-row gl-typed"><span>Power</span>
          <Num value={pu.value ?? ''} unit={pu.basis === 'w_per_kw_capacity' ? 'W per kW' : pu.basis === 'w_per_m2' ? 'W/m²' : 'W'} step={pu.basis === 'w' ? 10 : 0.1} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v >= 0 ? v : null; if (n !== pu.value) setPu({ value: n, basis: pu.basis ?? 'w' }) }} />
        </div>
        <div className="gl-row gl-librow"><span>Stated as</span>
          <select className="gl-sel" aria-label="Pump power stated as" value={pu.basis ?? ''} onChange={(e) => setPu({ basis: (e.target.value || null) as PlanPumps['basis'] })}>
            <option value="">Not set</option>
            <option value="w">Watts</option>
            <option value="w_per_kw_capacity">W per kW of output</option>
            <option value="w_per_m2">W per m² it serves</option>
          </select>
        </div>
        <div className="gl-row gl-librow"><span>Speed</span>
          <select className="gl-sel" aria-label="Pump speed" value={pu.speed ?? ''} onChange={(e) => setPu({ speed: (e.target.value || null) as PlanPumps['speed'] })}>
            <option value="">Not set</option>
            <option value="fixed">Fixed speed</option>
            <option value="variable">Variable speed (inverter)</option>
          </select>
        </div>
        <div className="gl-row gl-librow"><span>Runs</span>
          <select className="gl-sel" aria-label="When the pumps run" value={pu.runs ?? ''} onChange={(e) => setPu({ runs: (e.target.value || null) as PlanPumps['runs'], ...(e.target.value !== 'schedule' ? { schedule: null } : {}) })}>
            <option value="">Not set</option>
            <option value="with_demand">With demand (when the system has load)</option>
            <option value="continuous">Continuously through its season</option>
            <option value="schedule">On a schedule</option>
          </select>
        </div>
        {pu.runs === 'schedule' && (
          <div className="gl-row gl-librow"><span>Schedule</span>
            <select className="gl-sel" aria-label="Pump schedule" value={pu.schedule ?? ''} onChange={(e) => setPu({ schedule: e.target.value || null })}>
              <option value="">Not set</option>
              {profOptions(profilesFor('ventilation'))}
            </select>
          </div>
        )}
        {pu.default_from && <p className="ap-default">Default, from {pu.default_from}</p>}
        {(() => {
          const r = figs.now?.energy && figs.now.energy.ok ? figs.now.energy.pumps.find((y) => y.id === `${sv}_${x.id}`) : null
          return r ? <div className="gl-row"><span>In the year</span><span className="ap-setc">{Math.round(r.rated_w).toLocaleString('en-GB')} W rated, {Math.round(r.hours_run).toLocaleString('en-GB')} h, {Math.round(r.kwh).toLocaleString('en-GB')} kWh</span></div> : null
        })()}
        {pumpNote === x.id && <p className="gl-hint">{sv === 'dhw' ? 'No published default for a hot water circuit: state its pumps (the circulation pump is under "For the whole building").' : 'No default: no water circuit is known for this system. State its flow temperature (heating) or give it wet emitters, or state the pumps.'}</p>}
        <div className="gl-btns"><button type="button" className="gl-btn quiet" onClick={dflt}>Use defaults</button></div>
        <p className="gl-hint">"Continuously" runs every hour of the system's season (the months it has load), not all year. A variable-speed pump keeps its rated power and saves at part load. The pumps' heat into the water is not counted. Defaults are {NCM_SOURCE}.</p>
      </>
    )
  }

  const systemsPanel = () => {
    if (sysKind === 'emitters') return emittersPanel()
    if (sysKind === 'other') return otherLoadsPanel()
    const x = curSys
    const sv = SERVICES.find((s) => s.key === service)!
    const items: Item[] = systemsOf(service).map((y) => {
      const rs = plan.rooms.filter((r) => r.systems?.[service] === y.id)
      return { id: y.id, name: y.name, swatch: { colour: sysColour(y.id)!, unset: sysUnset(y) }, line: service === 'lighting' ? (y.efficacy != null ? `electricity · ${y.efficacy} W/m² per 100 lux` : 'Efficacy not set yet') : sysLine(y.template, service), used: rs.length ? count(rs.length, 'room') : 'not used', removable: !rs.length }
    })
    const mech = ['mvhr', 'mev'].includes(system(x?.template)?.type ?? '')
    return (
      <GivePanel
        kinds={SYSTEM_KINDS} kind={sysKind} onKind={(k) => setSysKind(k as SysKind)}
        title={`${sv.name} systems`} icon={SERVICE_ICON[service]}
        top={service === 'heating' ? (() => {
          // Brief 117/120: the design heat loss's conditions, for sizing the systems against their rooms.
          const bi = plan.building ?? noBuildingInputs()
          const setBi = (q: Partial<BuildingInputs>) => commit({ ...plan, building: { ...bi, ...q } })
          const out = bi.design_outdoor
          return (
            <details className="ap-hw" open>
              <summary>Design heat loss, for sizing</summary>
              <div className="gl-row gl-librow"><span>Design outdoor</span>
                <select className="gl-sel" aria-label="Design outdoor temperature" value={out == null ? '' : typeof out === 'number' ? 'stated' : out} onChange={(e) => { const v = e.target.value; setBi({ design_outdoor: v === '' ? null : v === 'stated' ? (typeof out === 'number' ? out : -3) : (v as 'heating_99_6' | 'heating_99') }) }}>
                  <option value="">Not set</option>
                  <option value="heating_99_6">Weather file, coldest 0.4 % of hours</option>
                  <option value="heating_99">Weather file, coldest 1 % of hours</option>
                  <option value="stated">Stated (MCS / CIBSE Guide A)</option>
                </select>
              </div>
              {typeof out === 'number' && <div className="gl-row gl-typed"><span>Outdoor at</span><Num value={out} unit="°C" step={0.5} onCommit={(v) => { if (Number.isFinite(v) && v !== out) setBi({ design_outdoor: v }) }} /></div>}
              {out != null && <div className="gl-row gl-typed"><span>Warm-up allowance</span><Num value={bi.warm_up_w_per_m2 ?? ''} unit="W/m²" step={1} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v > 0 ? v : null; if (n !== (bi.warm_up_w_per_m2 ?? null)) setBi({ warm_up_w_per_m2: n }) }} /></div>}
              {out != null && <div className="gl-row gl-typed"><span>Wind for vents</span><Num value={bi.vent_wind_m_s ?? ''} unit="m/s" step={0.5} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v > 0 ? v : null; if (n !== (bi.vent_wind_m_s ?? null)) setBi({ vent_wind_m_s: n }) }} /></div>}
              <p className="gl-hint">Each heated room is held at its heating temperature (Spaces). The design heat loss is shown beside each system's output below, and per room under "Do they meet the need?". Wind is needed only where rooms have permanent vents. Empty stays unset.</p>
            </details>
          )
        })() : service === 'dhw' ? (() => {
          const hw = plan.dhw ?? noDhw()
          const setHw = (q: Partial<DhwInputs>) => commit({ ...plan, dhw: { ...hw, ...q } })
          const n = (label: string, k: 'storage_c' | 'tap_c' | 'cold_c' | 'pump_w', step: number, unit: string) => (
            <div className="gl-row gl-typed"><span>{label}</span><Num value={hw[k] ?? ''} unit={unit} step={step} min={0} onCommit={(v) => { const x = Number.isFinite(v) && v > 0 ? v : k === 'pump_w' && v === 0 ? 0 : null; if (x !== hw[k]) setHw({ [k]: x }) }} /></div>
          )
          return (
            <details className="ap-hw" open>
              <summary>For the whole building</summary>
              {n('Stored at', 'storage_c', 1, '°C')}
              {n('Hot at the tap', 'tap_c', 1, '°C')}
              {n('Cold water in', 'cold_c', 1, '°C')}
              {n('Circulation pump', 'pump_w', 10, 'W')}
              <div className="gl-row gl-librow"><span>Used</span>
                <select className="gl-sel" aria-label="When hot water is used" value={hw.shape === undefined ? 'flat' : hw.shape ?? ''} onChange={(e) => setHw({ shape: (e.target.value || null) as DhwInputs['shape'] })}>
                  <option value="">Not set</option>
                  <option value="flat">Evenly through the day</option>
                  <option value="follow_occupancy">With occupancy</option>
                </select>
              </div>
              <p className="gl-hint">One set for the building. How much hot water is used is on each space type (Spaces). The heater only heats the hot share of what runs from the tap. Empty stays unset.</p>
            </details>
          )
        })() : undefined}
        items={items} active={x?.id ?? null}
        onActive={previewOnPick((id) => setActiveSys((a) => ({ ...a, [service]: id })))}
        onNew={() => newSystem()} newLabel="New system"
        onCopy={(id) => newSystem(plan.systems.find((y) => y.id === id))}
        onRemove={removeSystem}
        detail={x && (
          <>
            <input className="gl-title-in ap-tname" aria-label="System name" defaultValue={x.name} key={`${x.id}-${x.name}`} onBlur={(e) => e.target.value.trim() && e.target.value !== x.name && setSys(x.id, { name: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            {service === 'lighting' ? (
              <>
                <div className="gl-row gl-typed"><span>Efficacy</span><Num value={x.efficacy ?? ''} unit="W/m² per 100 lux" step={0.1} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v > 0 ? v : null; if (n !== (x.efficacy ?? null)) setSys(x.id, { efficacy: n }) }} /></div>
                <p className="ap-sysline">electricity</p>
                {(() => {
                  // The W/m² it gives each space type it lights: lux ÷ 100 × efficacy, worked out only by lightingWm2.
                  const lit = plan.spaces.filter((sp2) => sp2.lux != null && plan.rooms.some((r) => r.space === sp2.id && r.systems?.lighting === x.id))
                  return x.efficacy != null && lit.map((sp2) => <div key={sp2.id} className="gl-row"><span>{sp2.name}</span><span className="ap-setc">{lightingWm2(sp2.lux!, x.efficacy!).toFixed(1)} W/m², from {sp2.lux} lux × {x.efficacy}</span></div>)
                })()}
                <p className="gl-hint">How many watts the luminaires draw per m² for each 100 lux they deliver (LED about 2 to 3). The lux each space needs is on its space type (Spaces). Lighting controls come with the Controls step. Empty stays unset.</p>
              </>
            ) : <>
            <div className="gl-row gl-librow"><span>From the library</span>
              <select className="gl-sel" aria-label={`Library system for ${x.name}`} value={x.template ?? ''} onChange={(e) => setSys(x.id, { template: e.target.value || null })}>
                <option value="">Not set</option>
                {systemsFor(service).map((t) => <option key={t.key} value={t.key}>{short(t.name)}</option>)}
              </select>
            </div>
            <p className="ap-sysline">{sysLine(x.template, service)}</p>
            </>}
            {service === 'ventilation' && x.template && (
              <>
                <div className="gl-row gl-typed"><span>{mech ? 'Air flow' : 'Air changes'}</span><Num value={x.flow ?? ''} unit={mech ? 'l/s per m²' : 'per hour'} step={mech ? 0.1 : 0.5} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v > 0 ? v : null; if (n !== (x.flow ?? null)) setSys(x.id, { flow: n }) }} /></div>
                <div className="gl-row gl-librow"><span>Runs</span>
                  <select className="gl-sel" aria-label="How the fans run" value={x.runs ?? (x.schedule === 'always_on' ? 'continuous' : x.schedule ? 'schedule' : '')} onChange={(e) => { const r = (e.target.value || null) as PlanSystem['runs']; setSys(x.id, { runs: r, ...(r === 'continuous' ? { schedule: 'always_on' } : r === 'demand' ? { schedule: null } : x.schedule === 'always_on' ? { schedule: null } : {}) }) }}>
                    <option value="">Not set</option>
                    <option value="continuous">Continuously (24/7)</option>
                    <option value="schedule">On a schedule</option>
                    <option value="demand">With demand (CO₂ or presence)</option>
                  </select>
                </div>
                {(x.runs ?? (x.schedule && x.schedule !== 'always_on' ? 'schedule' : null)) === 'schedule' && (
                  <div className="gl-row gl-librow"><span>Schedule</span>
                    <select className="gl-sel" aria-label="When it runs" value={x.schedule ?? ''} onChange={(e) => setSys(x.id, { schedule: e.target.value || null })}>
                      <option value="">Not set</option>
                      {profOptions(profilesFor('ventilation'))}
                    </select>
                  </div>
                )}
                {x.runs === 'demand' && <div className="gl-row gl-typed"><span>Least share of flow</span><Num value={x.demand_min ?? ''} step={0.05} min={0} max={1} onCommit={(v) => { const n = Number.isFinite(v) && v >= 0 && v <= 1 ? v : null; if (n !== (x.demand_min ?? null)) setSys(x.id, { demand_min: n }) }} /></div>}
                {x.runs === 'demand' && <p className="gl-hint">The flow follows the people in the rooms (their occupancy profile), never below the least share (0 to 1).</p>}
              </>
            )}
            {service === 'heating' && x.template && (
              <>
                <h4>Design water temperatures</h4>
                {(['design_flow_c', 'design_return_c'] as const).map((k) => (
                  <div key={k} className="gl-row gl-typed"><span>{k === 'design_flow_c' ? 'Flow' : 'Return'}</span><Num value={x[k] ?? ''} unit="°C" step={1} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v > 0 ? v : null; if (n !== (x[k] ?? null)) setSys(x.id, { [k]: n }) }} /></div>
                ))}
                <p className="gl-hint">What the water leaves and comes back at on a design day. Radiators and underfloor fed by this system are re-rated to these (a heat pump at 45/40 gets much less from a radiator rated at 75/65). Empty stays unset.</p>
              </>
            )}
            {(service === 'heating' || service === 'cooling' || service === 'dhw') && x.template && system(x.template)?.fuel && (() => {
              // Brief 120 P6: what the system can give, against what its rooms ask of it.
              const gid = `${service}_${x.id}`
              const s0 = figs.now
              const plant = s0?.plants?.find((p0) => p0.id === gid)
              const dhl = s0?.design_heat_loss?.ok ? s0.design_heat_loss.systems.find((d) => d.id === gid) : null
              const wh = s0?.energy && s0.energy.ok ? s0.energy.water_heaters.find((w) => w.id === gid) : null
              const kw = (w: number) => `${(w / 1000).toFixed(1)} kW`
              const hws = systemsOf('dhw').filter((y) => system(y.template)?.fuel)
              return (
                <>
                  <h4>{service === 'dhw' ? 'Water heater' : 'Capacity'}</h4>
                  <div className="gl-row gl-typed"><span>{service === 'dhw' ? "Heater's output" : 'Output'}</span><Num value={x.capacity_kw ?? ''} unit="kW" step={0.5} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v > 0 ? v : null; if (n !== (x.capacity_kw ?? null)) setSys(x.id, { capacity_kw: n }) }} /></div>
                  {service === 'dhw' && <div className="gl-row gl-typed"><span>Store</span><Num value={x.storage_litres ?? ''} unit="litres" step={10} min={0} onCommit={(v) => { const n = Number.isFinite(v) && v > 0 ? v : null; if (n !== (x.storage_litres ?? null)) setSys(x.id, { storage_litres: n }) }} /></div>}
                  {service === 'heating' && (
                    dhl ? <div className="gl-row"><span>Its rooms' design heat loss</span><span className="ap-setc">{kw(dhl.rooms_w)}{dhl.hot_water_w > 0 ? ` + hot water ${kw(dhl.hot_water_w)}` : ''}{dhl.hot_water_w > 0 ? ` = ${kw(dhl.total_w)}` : ''}</span></div>
                    : <p className="gl-hint">{x.capacity_kw == null ? '' : 'Choose the design outdoor temperature above to see its rooms\' design heat loss beside it.'}</p>
                  )}
                  {plant && <div className="gl-row"><span>In the year</span><span className="ap-setc">{plant.hours_short > 0 ? `short ${Math.round(plant.hours_short)} h at ${kw(plant.capacity_kw * 1000)}${plant.min_flow_c != null ? `; flow fell to ${plant.min_flow_c.toFixed(0)} °C` : ''}${plant.hot_water_short_hours > 0 ? `; hot water short ${Math.round(plant.hot_water_short_hours)} h` : ''}` : 'never short'}</span></div>}
                  {wh && <div className="gl-row"><span>In the year</span><span className="ap-setc">{wh.hours_short > 0 ? `short ${Math.round(wh.hours_short)} h, ${(wh.short_kwh / 1000).toFixed(1)} MWh not given` : `never short (peak draw ${kw(wh.peak_draw_w)})`}</span></div>}
                  {wh && wh.short_without_store && <p className="gl-hint">Its output limits the hot water now, with no store to cover the peaks: state the store if it has one.</p>}
                  {wh && wh.assumes.length > 0 && <p className="gl-hint">Assumes: {wh.assumes.join('; ')}.</p>}
                  {service === 'heating' && hws.length > 0 && (
                    <div className="gl-row gl-librow"><span>Heats hot water first</span>
                      <select className="gl-sel" aria-label="Hot water it heats first" value={x.dhw_first ?? ''} onChange={(e) => setSys(x.id, { dhw_first: e.target.value || null })}>
                        <option value="">No</option>
                        {hws.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                      </select>
                    </div>
                  )}
                  {pumpsBlock(x, service)}
                  <p className="gl-hint">{service === 'dhw'
                    ? 'A dedicated water heater: its output, and the store it refills (the store needs the output). A hot water system a boiler heats first takes neither. Empty: not limited.'
                    : `Empty: not limited. With an output, the rooms it serves share it; a room it cannot hold is marked "system short" on the drawing. Where two systems split a room, the others top up what a capped one cannot give, in no order (no lead/lag).${service === 'heating' ? ' Heating hot water first takes from the same output.' : ' Cooling output is shared between rooms in proportion to what each asks; this has not yet been checked against EnergyPlus.'}`}</p>
                </>
              )
            })()}
            {service === 'heating' && x && (() => {
              // Brief 118 P4 (a view): the emitters this system feeds are the emitters in the rooms it heats.
              const rs = plan.rooms.filter((r) => r.systems?.heating === x.id)
              return (
                <>
                  <h4>Emitters it feeds</h4>
                  {rs.length ? rs.map((r) => (
                    <div key={r.id} className="gl-row"><span>{r.name}</span><span className="ap-setc">{roomEmitters(r).length ? emitName(r) : 'none yet'}</span></div>
                  )) : <p className="gl-hint">No rooms have this system yet.</p>}
                  {rs.length > 0 && <button type="button" className="ap-link" onClick={() => { setSysKind('emitters'); setChosen(rs.map((r) => r.id), []) }}>Give emitters to its {rs.length === 1 ? 'room' : `${rs.length} rooms`}</button>}
                  <h4>Do they meet the need?</h4>
                  <div ref={setSizingEl} className="ap-sizing" />
                </>
              )
            })()}
            <p className="gl-hint">{service === 'lighting' ? 'A change changes every room with this system.' : "Fuel and efficiency come from NZA Sim's library. A change changes every room with this system."}</p>
          </>
        )}
        give={giveFoot({ name: x?.name ?? null, rooms: true, now: chosenSet.rooms.map((id) => plan.systems.find((y) => y.id === plan.rooms.find((r) => r.id === id)?.systems?.[service])?.name ?? 'none'), onGive: (all) => giveSystemTo(all ? allRooms() : chosenSet.rooms) })}
      />
    )
  }

  // A card is open on the right (wall, block, rooms or space type): the results panel sits to its left.
  const cardOpen = !!(selWall && selSpan) || (mode === 'outline' && selBlocks.length > 0) || selRooms.length > 0
  // In the workspace, the left and right parts go to its panes (each wrapped so the editor's scoped styles apply).
  const toPane = (el: HTMLElement | undefined, node: React.ReactNode, key: string) => (embedded && el ? createPortal(<div className="gl-root gl-pane">{node}</div>, el, key) : node)
  const root = (
    <div className={`gl-root${giving ? ' giving' : ''}${embedded ? ' embedded' : ''}`} ref={host}>
      {!embedded && <ResultsPanel doc={built.doc} right={giving ? 384 : cardOpen ? 358 : 16} />}
      {inspect && !inspect.glazing && <ConstructionInspector open constructionName={inspect.name} onClose={() => setInspect(null)} />}
      {inspect && inspect.glazing && <GlazingInspector open glazingName={inspect.name} onClose={() => setInspect(null)} />}
      {embedded && slots && <EmbeddedResults step={railStep} doc={built.doc} previewDoc={previewDoc} onFigures={(now, preview, why) => setFigs((f) => (f.now === now && f.preview === preview && f.why === why ? f : { now, preview, why }))} strip={slots.strip} centre={slots.centre} showBody={centreTab === 'heat-flow'} focusZone={focusZone} weatherEl={onSite ? weatherEl : null} sizingEl={mode === 'systems' && sysKind === 'heating' ? sizingEl : null} onOpen={() => onCentreTab?.('heat-flow')} />}
      {in3d && (
        <div className="gl-3d">
          <Suspense fallback={<p className="gl-3d-wait">Loading 3D…</p>}>
            <Plan3D plan={plan} runs={runs} placed={placed} chosen={selSpan} crossers={crossers} bands={showTypes ? pieces.map((p) => ({ ...p, colour: bandOf(p) })) : []} onPickWall={(i, t) => { if (!giving) return setSel({ kind: 'wall', index: i, t, whole: mode === 'outline' }); const p = mode === 'fabric' && wallsKind ? pieceAt(pieces, i, t) : undefined; if (p) setChosen([], [{ run: p.run, t0: p.t0, t1: p.t1 }]) }} />
          </Suspense>
        </div>
      )}
      {note && <div className="gl-note" role="status">{note}</div>}
      <div className="gl-viewswitch" role="group" aria-label="View">
        <button type="button" aria-pressed={shownLook === 'plan'} onClick={() => setLook('plan')}>Plan</button>
        <button type="button" aria-pressed={in3d} onClick={() => setLook('3d')} disabled={!plan.blocks.length}>3D</button>
        <button type="button" aria-pressed={shownLook === 'elev'} onClick={() => setLook('elev')} disabled={!selWall} title={selWall ? undefined : 'Choose a wall first'}>Elevation</button>
      </div>
      {shownLook === 'elev' && selWall && selSpan && (
        <FacadeView
          plan={plan}
          run={selWall}
          pieces={runPieces}
          span={selSpan}
          whole={isWhole}
          crossers={crossers}
          from={from}
          setFrom={setFrom}
          width={narrow || embedded ? size[0] : size[0] - LEFT - 330}
          height={size[1]}
          roomName={roomName}
          typeName={(sp) => typeName(typeOfSpan(plan, sp))}
          typeColour={(sp) => (showTypes ? bandOf(sp) : null)}
          onPick={(p) => p && choosePiece(p)}
          onChange={(id, to) => commit(changeWindow(plan, id, to))}
          onRemove={(id) => commit(removeWindow(plan, id))}
          doorSize={{ width_m: Number(form.doorW) || DOOR.width_m, height_m: Number(form.doorH) || DOOR.height_m }}
          windowSize={{ width_m: Number(form.width) || 1, height_m: Number(form.height) || 1.2, sill_m: Number(form.sill) || 0.9 }}
        />
      )}
      <svg className="gl-svg" width={size[0]} height={size[1]} style={{ cursor, display: shownLook !== 'plan' ? 'none' : undefined }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setPointer(null)} onDoubleClick={onDouble} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}>
        {grid}
        {shown.blocks.map((b, i) => <polygon key={`f${i}`} className="gl-floor" points={P(b)} />)}
        {inRooms &&
          shown.rooms.map((r) => <polygon key={r.id} className={`gl-room${chosen.has(r.id) && !giving ? ' on' : ''}`} points={P(r.ring)} fill={roomFill(r)} />)}
        {liveInner && <line className="gl-wall-hover" x1={toPx(liveInner[0])[0]} y1={toPx(liveInner[0])[1]} x2={toPx(liveInner[1])[0]} y2={toPx(liveInner[1])[1]} />}
        {giving && !drag && shown.rooms.filter((r) => chosen.has(r.id)).map((r) => <polygon key={`pk${r.id}`} className="gl-room-pick" points={P(r.ring)} />)}
        {pending && !pending.same && !drag && (
          <>
            <defs>
              <pattern id="gl-pv-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="9" height="9" fill={`${pending.colour}33`} />
                <line x1="0" y1="0" x2="0" y2="9" stroke={pending.colour} strokeWidth="3" />
              </pattern>
            </defs>
            {pending.pieces.length === 0 && shown.rooms.filter((r) => pending.rooms.includes(r.id)).map((r) => <polygon key={`pv${r.id}`} className="gl-room-pv" points={P(r.ring)} fill="url(#gl-pv-hatch)" />)}
          </>
        )}
        {flash.length > 0 && shown.rooms.filter((r) => flash.includes(r.id)).map((r) => <polygon key={`fl${r.id}`} className="gl-room-flash" points={P(r.ring)} />)}
        {shown.blocks.map((b, i) => <polygon key={`s${i}`} className={`gl-shell${chosenBlocks.has(i) || (drag && drag.kind === 'corner' && drag.block === i) ? ' chosen' : ''}`} points={P(b)} />)}
        {hoverWall != null && sel?.kind !== 'wall' && (() => {
          const r = runs[hoverWall]!
          return <line className="gl-wall-hover" x1={toPx(r.a)[0]} y1={toPx(r.a)[1]} x2={toPx(r.b)[0]} y2={toPx(r.b)[1]} />
        })()}
        {giving && !drag && !(mode === 'fabric' && wallsKind) && shown.rooms.filter((r) => chosen.has(r.id)).map((r) => <polygon key={`pl${r.id}`} className="gl-room-pick-line" points={P(r.ring)} />)}
        {pending && !pending.same && !drag && pending.pieces.map((sp, i) => {
          const r = runs[sp.run]
          if (!r) return null
          const [ax, ay] = toPx(along(r, sp.t0))
          const [bx, by] = toPx(along(r, sp.t1))
          return <line key={`pvw${i}`} className="gl-wall-pv" x1={ax} y1={ay} x2={bx} y2={by} stroke={pending.colour} />
        })}
        {pushed && <line className="gl-wall-on" x1={toPx(pushed.a)[0]} y1={toPx(pushed.a)[1]} x2={toPx(pushed.b)[0]} y2={toPx(pushed.b)[1]} />}
        {showTypes && !drag &&
          pieces.map((p, i) => {
            const r = runs[p.run]
            if (!r) return null
            const [ax, ay] = toPx(along(r, p.t0))
            const [bx, by] = toPx(along(r, p.t1))
            return <line key={`ty${i}`} className="gl-wall-type" x1={ax} y1={ay} x2={bx} y2={by} stroke={bandOf(p)} />
          })}
        {giving && !drag && chosenSet.pieces.map((sp, i) => {
          const r = runs[sp.run]
          if (!r) return null
          const [ax, ay] = toPx(along(r, sp.t0))
          const [bx, by] = toPx(along(r, sp.t1))
          return <line key={`pp${i}`} className="gl-wall-on" x1={ax} y1={ay} x2={bx} y2={by} />
        })}
        {selWall && selSpan && !drag && (() => {
          const [ax, ay] = toPx(along(selWall, selSpan.t0))
          const [bx, by] = toPx(along(selWall, selSpan.t1))
          return <line className="gl-wall-on" x1={ax} y1={ay} x2={bx} y2={by} />
        })()}
        {!drag &&
          placed.map((w, i) => {
            const r = runs[w.wall]
            if (!r) return null
            const [ax, ay] = toPx(along(r, w.offset_m))
            const [bx, by] = toPx(along(r, w.offset_m + w.width_m))
            return (
              <g key={`w${i}`}>
                <line className={`gl-win${crossers.has(w.set) ? ' bad' : ''}`} x1={ax} y1={ay} x2={bx} y2={by} />
                <line className={w.door ? 'gl-win-door' : 'gl-win-glass'} x1={ax} y1={ay} x2={bx} y2={by} />
              </g>
            )
          })}
        {shownRuns.map((r) => lenLabel(r.a, r.b, `l${r.index}`, (drag?.kind === 'corner' && drag.block === r.block) || (drag?.kind === 'push' && drag.block === r.block)))}
        {inRooms
          ? shown.rooms.map((r) => {
              const on = chosen.has(r.id)
              const [lx, ly] = toPx(labelAt(r.ring))
              const xs = r.ring.map((p) => toPx(p)[0])
              const wide = Math.max(...xs) - Math.min(...xs)
              if (wide < 34) return null
              return (
                <g key={`rl${r.id}`}>
                  <text className={`gl-zname${on && !giving ? ' on' : ''}`} x={lx} y={ly}>{r.name}</text>
                  {wide > 56 && <text className={`gl-zarea${on && !giving ? ' on' : ''}`} x={lx} y={ly + 15}>{roomSub(r)}</text>}
                  {pending && !pending.same && pending.rooms.includes(r.id) && <text className="gl-pvtag" x={lx} y={ly + 31}>Preview</text>}
                  {flash.includes(r.id) && <text className="gl-pvtag done" x={lx} y={ly + 31}>✓ Applied</text>}
                </g>
              )
            })
          : shown.blocks.map((b, i) => {
              const [lx, ly] = toPx(labelAt(b))
              return <text key={`bl${i}`} className="gl-zarea" x={lx} y={ly + 4}>{f1(ringArea(b))} m²</text>
            })}

        {/* select: the chosen block's corners and turn handle */}
        {handleBlocks.length > 0 && !(drag && (drag.kind === 'move' || drag.kind === 'turn' || drag.kind === 'push')) && (
          <g>{handleBlocks.flatMap((bi) => (shown.blocks[bi] ?? []).map((p, i) => <circle key={`c${bi}-${i}`} className="gl-handle" cx={toPx(p)[0]} cy={toPx(p)[1]} r={tool === 'corner' ? 4.5 : 6} />))}</g>
        )}
        {th && !(drag && (drag.kind === 'corner' || drag.kind === 'push')) && (
          <g>
            <line className="gl-stalk" x1={th.at[0]} y1={th.at[1] + 10} x2={th.at[0]} y2={th.at[1] + 20} />
            <circle className="gl-turn" cx={th.at[0]} cy={th.at[1]} r={10} />
            <path className="gl-turn-glyph" d={`M${th.at[0] + 4.5} ${th.at[1] - 2} A5 5 0 1 0 ${th.at[0] + 4} ${th.at[1] + 3.2}`} />
            <path className="gl-turn-glyph" d={`M${th.at[0] + 4.8} ${th.at[1] - 5.5} L${th.at[0] + 4.6} ${th.at[1] - 1.8} L${th.at[0] + 1.2} ${th.at[1] - 2.4}`} />
          </g>
        )}
        {cornerGhost && !drag && <circle className="gl-corner first" cx={toPx(cornerGhost)[0]} cy={toPx(cornerGhost)[1]} r={6} />}

        {/* drawing ghosts */}
        {boxGhost && (
          <g>
            <polygon className={`gl-ghost${tool === 'cut' ? ' cut' : ''}${tool === 'room' ? ' room' : ''}`} points={P(boxGhost)} />
            {boxGhost.map((a, i) => (i < 2 ? lenLabel(a, boxGhost[(i + 1) % boxGhost.length]!, `bg${i}`, true) : null))}
          </g>
        )}
        {tool === 'shape' && cs.corners.length > 0 && (
          <g>
            <polyline className="gl-draw-line" points={P(cs.corners as XY[])} />
            {(cs.corners as XY[]).slice(1).map((c, i) => lenLabel(cs.corners[i] as XY, c, `dl${i}`))}
            {shapeGhost && (
              <>
                <line className="gl-ghost-line" x1={toPx(cs.corners[cs.corners.length - 1] as XY)[0]} y1={toPx(cs.corners[cs.corners.length - 1] as XY)[1]} x2={toPx(shapeGhost)[0]} y2={toPx(shapeGhost)[1]} />
                {lenLabel(cs.corners[cs.corners.length - 1] as XY, shapeGhost, 'gl', true)}
              </>
            )}
            {cs.refused?.sides.map((i) => {
              const a = cs.corners[i] as XY
              const b = cs.corners[(i + 1) % cs.corners.length] as XY
              return <line key={`bad${i}`} className="gl-bad-line" x1={toPx(a)[0]} y1={toPx(a)[1]} x2={toPx(b)[0]} y2={toPx(b)[1]} />
            })}
            {(cs.corners as XY[]).map((c, i) => <circle key={`sc${i}`} className={`gl-corner${i === 0 ? ' first' : ''}`} cx={toPx(c)[0]} cy={toPx(c)[1]} r={i === 0 ? (closing ? 9 : 7) : 4.5} />)}
          </g>
        )}
        {tool === 'divide' && (
          <g>
            {cutFrom && <line className="gl-ghost-line" x1={toPx(cutFrom.p)[0]} y1={toPx(cutFrom.p)[1]} x2={toPx(splitHit?.p ?? pointer ?? cutFrom.p)[0]} y2={toPx(splitHit?.p ?? pointer ?? cutFrom.p)[1]} />}
            {cutFrom && <circle className="gl-corner first" cx={toPx(cutFrom.p)[0]} cy={toPx(cutFrom.p)[1]} r={5} />}
            {squareGhost && splitHit && (
              <>
                <line className="gl-ghost-line" x1={toPx(splitHit.p)[0]} y1={toPx(splitHit.p)[1]} x2={toPx(squareGhost)[0]} y2={toPx(squareGhost)[1]} />
                {lenLabel(splitHit.p, squareGhost, 'sq', true)}
              </>
            )}
            {splitHit && <circle className="gl-corner" cx={toPx(splitHit.p)[0]} cy={toPx(splitHit.p)[1]} r={splitHit.corner ? 7 : 5} />}
          </g>
        )}
        {(tool === 'rect' || tool === 'tri' || tool === 'cut' || tool === 'room') && pointer && !drag && (() => {
          const s = snapXY(pointer, step)
          return <circle className="gl-corner" cx={toPx(s)[0]} cy={toPx(s)[1]} r={4} />
        })()}
      </svg>

      {say && <div className={`gl-pill${say.bad ? ' bad' : ''}`} style={{ left: say.x, top: say.y }}>{say.text}</div>}

      {/* ─── left: the steps and the building ─── */}
      {toPane(slots?.left, <aside className="gl-panel gl-left">
        {!embedded && <div className="gl-head">
          <h2>Building geometry</h2>
          <p>Simulate v2 prototype. Nothing here is saved.</p>
        </div>}
        {!embedded && <div className="gl-steps" role="tablist" aria-label="Steps">
          {MODES.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} disabled={m !== 'outline' && m !== 'profiles' && !has} onClick={() => toMode(m)} title={STEP_LINE[m]}>
              <Icon name={STEP_ICON[m]} size={26} />
              <span><i>{STEP_NO[m]}</i>{STEP[m]}</span>
            </button>
          ))}
        </div>}
        {embedded && STEP_OF[mode] === 'shape' && !onSite && (
          <div className="gl-shape-sw" role="tablist" aria-label="Shape">
            {(['outline', 'rooms'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} disabled={m === 'rooms' && !has} onClick={() => toMode(m)}>{STEP[m]}</button>
            ))}
          </div>
        )}
        <div className="gl-body">
          {mode === 'profiles' && (
            <div className="gl-sec">
              <p className="gl-say">Profiles are the project's hour-by-hour patterns: when people are in, when lights and equipment are on, when ventilation runs. Space types (step 5) and systems (step 6) point at them, so one profile can drive both.</p>
              {profSel && has && (() => {
                const rs = plan.rooms.filter((r) => roomUses(r).includes(profSel))
                return <p className="gl-say">{rs.length ? `Used in ${rs.length === 1 ? '1 room' : `${rs.length} rooms`} (coloured in the drawing): ${rs.map((r) => r.name).join(', ')}.` : 'No room uses it yet.'}</p>
              })()}
            </div>
          )}
          {!has && mode !== 'profiles' && (
            <div className="gl-sec">
              <p className="gl-say">Press and drag a rectangle for the building. Add more rectangles or triangles to make an L or a T, or tap corners with Shape.</p>
              <button type="button" className="gl-btn quiet" onClick={startExample}>
                Start from an example
              </button>
            </div>
          )}
          {has && (giving || mode === 'profiles') && !onSite && chooseList()}
          {has && (
            <>
              {!giving && mode !== 'profiles' && <div className="gl-sec">
                <h3>Building <small>{f1(floorArea(plan.blocks))} m² · {runs.length} walls{plan.blocks.length > 1 ? ` · ${plan.blocks.length} blocks` : ''}</small></h3>
                <div className="gl-row">
                  <span>Storey height</span>
                  <Num value={plan.storey_height_m} unit="m" step={0.1} min={2} onCommit={(v) => v > 0 && commit({ ...plan, storey_height_m: v })} />
                </div>
                <div className="gl-btns">
                  <button type="button" className="gl-btn quiet" onClick={() => fitTo(plan.blocks.flat())}>Fit to screen</button>
                  <button type="button" className="gl-btn quiet" onClick={() => { commit({ ...emptyPlan(), storey_height_m: plan.storey_height_m }); setSel(null); toMode('outline'); setTool('rect') }}>Clear all</button>
                </div>
              </div>}
              {mode === 'outline' && (
                <div className="gl-sec ap-choose">
                  <h3>The building <small>tap to choose</small></h3>
                  <div className="ap-rows" role="listbox" aria-label="Building, blocks and walls">
                    <div className="ap-row ap-whole" role="option" aria-selected={selBlocks.length === plan.blocks.length} onClick={() => { setTool('select'); setSel({ kind: 'blocks', idx: plan.blocks.map((_, i) => i) }) }}>
                      <Icon name="building" size={18} /><b>Whole building</b><small>{f1(floorArea(plan.blocks))} m²</small>
                    </div>
                    {plan.blocks.map((_, bi) => (
                      <div key={bi} className="ap-zone">
                        {plan.blocks.length > 1 && (
                          <div className="ap-row ap-zonehead" role="option" aria-selected={selBlocks.length === 1 && selBlocks[0] === bi} onClick={() => { setTool('select'); setSel({ kind: 'blocks', idx: [bi] }) }}>
                            <span>Block {bi + 1}</span>
                          </div>
                        )}
                        {runs.filter((w) => w.block === bi).map((w) => (
                          <div key={w.index} className="ap-row ap-room in" role="option" aria-selected={selWall?.index === w.index} onClick={() => { setTool('select'); setSel({ kind: 'wall', index: w.index, t: w.length_m / 2, whole: true }) }}>
                            <Icon name="wall" size={16} />
                            <span className="ap-name">External wall {w.index + 1}<small>Faces {compass16(w.azimuth_deg)}</small></span>
                            <span className="ap-count">{f1(w.length_m)} m</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {mode === 'outline' && (
                <div className="gl-sec">
                  <p className="gl-say">When the outline is right, cut it into rooms by drawing walls across it.</p>
                  <button type="button" className="gl-btn" onClick={() => toMode('rooms')}>Next: rooms →</button>
                </div>
              )}
              {mode === 'rooms' && (
                <div className="gl-sec">
                  <h3>Zones <small>{plan.zones.length}</small></h3>
                  <div className="gl-zones">
                    {plan.zones.map((z, i) => {
                      const rs = roomsIn(z.id)
                      const allOn = rs.length > 0 && rs.every((r) => chosen.has(r.id))
                      return (
                        <div key={z.id} className="gl-zonerow" aria-selected={allOn} onClick={() => { if (rs.length) { setSel({ kind: 'rooms', ids: rs.map((r) => r.id) }); setTool('pick') } }}>
                          <span className="gl-sw" style={{ background: zoneTint(i).fill, borderColor: zoneTint(i).line }} />
                          <input aria-label="Zone name" defaultValue={z.name} key={`${z.id}-${z.name}`} onClick={(e) => e.stopPropagation()} onBlur={(e) => e.target.value.trim() && e.target.value !== z.name && commit({ ...plan, zones: plan.zones.map((q) => (q.id === z.id ? { ...q, name: e.target.value.trim() } : q)) })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                          {rs.length ? <small>{rs.length} room{rs.length === 1 ? '' : 's'} · {f1(rs.reduce((t, r) => t + ringArea(r.ring), 0))} m²</small> : (
                            <button type="button" className="gl-x small" title="Remove this empty zone" onClick={(e) => { e.stopPropagation(); commit({ ...plan, zones: plan.zones.filter((q) => q.id !== z.id) }) }}>×</button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p className="gl-hint">Every room starts in Zone 1. Choose rooms (Select, Shift for more) to put them in another zone. Tap a zone to choose all its rooms.</p>
                  <button type="button" className="gl-btn" onClick={() => toMode('fabric')}>Next: fabric →</button>
                </div>
              )}
              {embedded && GIVING(mode) && (
                <div className="gl-sec gl-changes">
                  <h3>Changes this session</h3>
                  {changes.length ? (
                    <ol>
                      {changes.map((c, i) => (
                        <li key={`${c.depth}-${i}`}>
                          <span>{c.text}{c.effect && <small>{c.effect}</small>}</span>
                          {c.depth === past.length && <button type="button" className="gl-btn quiet" onClick={undo} title="Undo (Ctrl+Z)">Undo</button>}
                        </li>
                      ))}
                    </ol>
                  ) : <p className="gl-hint">Nothing applied yet. Choose rooms or walls, pick a type on the right, and Apply.</p>}
                </div>
              )}
              <details className="gl-sec gl-doc">
                <summary><h3>Model document <span className={`gl-chip ${built.ok ? 'ok' : 'no'}`}>{built.ok ? `✓ Valid · ${(built.doc as { schema_version: string }).schema_version}` : 'Not valid'}</span>{built.notes.length > 0 && <small>{count(built.notes.length, 'note')}</small>}</h3></summary>
                <table className="gl-facts">
                  <tbody>
                    <tr><td>Zones · rooms</td><td className="n">{built.totals.zones} · {built.totals.rooms}</td></tr>
                    <tr><td>Floor area</td><td className="n">{f1(built.totals.floor_m2)} m²</td></tr>
                    <tr><td>External wall (net)</td><td className="n">{f1(built.totals.wall_net_m2)} m²</td></tr>
                    <tr><td>Windows</td><td className="n">{built.totals.windows} · {f2(built.totals.glazing_m2)} m²</td></tr>
                    {built.totals.doors > 0 && <tr><td>Doors</td><td className="n">{built.totals.doors} · {f2(built.totals.door_m2)} m²</td></tr>}
                    <tr><td>Partitions between zones</td><td className="n">{built.totals.partitions}</td></tr>
                  </tbody>
                </table>
                {built.notes.map((n, i) => <p key={i} className="gl-warn">{n}</p>)}
                {built.issues.map((x, i) => <p key={i} className="gl-err">{x.path}: {x.message}</p>)}
                <button type="button" className="gl-btn quiet" onClick={() => setShowJson((s) => !s)}>{showJson ? 'Hide' : 'Show'} the JSON</button>
                {showJson && <pre className="gl-json">{JSON.stringify(built.doc, null, 1)}</pre>}
                <p className="gl-hint">Anything not chosen yet stays marked unset in the document. Weather is set elsewhere. Library: NZA Sim's, exported {exportDate}.</p>
              </details>
            </>
          )}
        </div>
      </aside>, 'left')}

      {/* ─── right: the thing in hand ─── */}
      {toPane(slots?.right, needsShape ? (
        <div className="gl-sec gl-needs">
          <p className="gl-say"><strong>Nothing drawn yet.</strong> {railStep === 'fabric' ? 'Fabric is given to walls, roofs and floors' : railStep === 'spaces' ? 'Spaces are given to rooms' : 'Systems are given to rooms'}, so the building needs an outline first.</p>
          <div className="gl-needs-btns">
            <button type="button" className="gl-btn" onClick={startExample}>Start from an example</button>
            <button type="button" className="gl-btn quiet" onClick={() => onStep?.('shape')}>Go to Shape and draw</button>
          </div>
        </div>
      ) : offStep ? null : <>{onSite && sitePanel()}{!onSite && <>
      {selWall && selSpan && (() => {
        const L = selSpan.t1 - selSpan.t0
        const glass = selWins.reduce((t, w) => t + w.width_m * w.height_m, 0)
        const cross = selWins.filter((w) => crossers.has(w.id)).length + (isWhole ? 0 : plan.windows.filter((w) => w.wall === selWall.index && crossers.has(w.id) && !selWins.includes(w) && w.t_m < selSpan.t1 && w.t_m + w.width_m > selSpan.t0).length)
        return (
          <aside className="gl-panel gl-right">
            <div className="gl-card-head">
              <div>
                <b>Wall {selWall.index + 1}{spanName ? ` · ${spanName}` : ''}</b>
                <small>{f2(L)} m{isWhole ? '' : ` of ${f2(selWall.length_m)} m`} · faces {compass16(selWall.azimuth_deg)} ({Math.round(selWall.azimuth_deg)}°)</small>
              </div>
              <button type="button" className="gl-x" aria-label="Close" onClick={() => setSel(null)}>×</button>
            </div>
            <div className="gl-body">
              {runPieces.length > 1 && (
                <div className="gl-chips" role="group" aria-label="Which part">
                  {runPieces.map((p, i) => (
                    <button key={i} type="button" aria-pressed={!isWhole && selPiece === p} onClick={() => choosePiece(p)}>{roomName(p.room)}</button>
                  ))}
                  <button type="button" aria-pressed={isWhole} onClick={() => chooseWall(true)}>Whole wall</button>
                </div>
              )}
              <div className="gl-sec">
                <h3>Windows <small>{selWins.length ? (sameSize ? `${selWins.length} here` : `${selWins.length} here, mixed sizes`) : 'spaced equally'}</small></h3>
                <div className="gl-row"><span>How many</span><Num value={form.count} step={1} min={0} onChange={(v) => edit('count', v)} /></div>
                <div className="gl-row"><span>Glazing ratio</span><Num value={ratioShown} unit="%" step={1} min={0} auto={!form.byRatio} onChange={(v) => edit('ratio', v)} /></div>
                <div className="gl-row"><span>Area of each</span><Num value={form.area} unit="m²" step={0.1} auto={autoDim === 'area'} onChange={(v) => edit('area', v)} /></div>
                <div className="gl-row"><span>Width</span><Num value={form.width} unit="m" step={0.1} auto={autoDim === 'width'} onChange={(v) => edit('width', v)} /></div>
                <div className="gl-row"><span>Height</span><Num value={form.height} unit="m" step={0.1} auto={autoDim === 'height'} onChange={(v) => edit('height', v)} /></div>
                <div className="gl-row"><span>Sill height</span><Num value={form.sill} unit="m" step={0.1} onChange={(v) => edit('sill', v)} /></div>
                <div className="gl-row"><span>Shading depth</span><Num value={form.shade} unit="m" step={0.1} min={0} onChange={(v) => edit('shade', v)} /></div>
                <p className="gl-hint">Type a glazing ratio (glass as a % of the wall) and the window size is worked out, or type any two of area, width and height; whatever is marked <i className="gl-auto-tag">auto</i> is worked out.{selWins.length ? ' A change re-spaces these windows equally.' : ''}</p>
              </div>
              <div className="gl-sec">
                <h3>Doors <small>{selDoors.length ? `${selDoors.length} here` : 'spaced with the windows'}</small></h3>
                <div className="gl-row"><span>How many</span><Num value={form.doors} step={1} min={0} onChange={(v) => edit('doors', v)} /></div>
                <div className="gl-row"><span>Width</span><Num value={form.doorW} unit="m" step={0.1} onChange={(v) => edit('doorW', v)} /></div>
                <div className="gl-row"><span>Height</span><Num value={form.doorH} unit="m" step={0.1} onChange={(v) => edit('doorH', v)} /></div>
                <p className="gl-hint">Doors and windows share the wall, spaced equally together; the first door goes in the middle. In the elevation, drag any of them, or tap one to make it a door or a window.</p>
                {lay && 'why' in lay && <p className="gl-err">{lay.why}</p>}
                {selWins.length > 0 && <p className="gl-hint">{f2(glass)} m² of glass, {Math.round((100 * glass) / (L * plan.storey_height_m))}% of {isWhole ? 'this wall' : 'this part'}.</p>}
                {cross > 0 && (
                  <p className="gl-err">
                    {cross === 1 ? 'A window crosses' : `${cross} windows cross`} the line between rooms. Drag {cross === 1 ? 'it' : 'them'} in the elevation, or space each room's windows.
                  </p>
                )}
                <div className="gl-btns">
                  {!selOpen.length && (
                    <button type="button" className="gl-btn orange" disabled={!lay || 'why' in lay || (spec.count < 1 && doorSpec.count < 1)} onClick={() => { if (lay && !('why' in lay)) { editing.current = sel; commit(lay.plan) } }}>
                      {spec.count > 0 && doorSpec.count > 0 ? 'Add windows and doors' : doorSpec.count > 0 ? 'Add doors' : 'Add windows'}
                    </button>
                  )}
                  {selOpen.length > 0 && <button type="button" className="gl-btn quiet" onClick={() => { const r = setWindowsIn(plan, selSpan, null); if (!('why' in r)) commit(r.plan) }}>Remove all</button>}
                  {plan.windows.some((w) => w.wall === selWall.index && crossers.has(w.id)) && (
                    <button type="button" className="gl-btn quiet" onClick={() => commit(spaceByRoom(plan, selWall.index))}>Space each room's windows</button>
                  )}
                  {look !== 'elev' && <button type="button" className="gl-btn quiet" onClick={() => setLook('elev')}>Elevation</button>}
                </div>
                {mode === 'outline' && <p className="gl-hint">Drag a wall to push it straight out or in.</p>}
              </div>
            </div>
          </aside>
        )
      })()}
      {mode === 'outline' && selBlocks.length > 0 && !drag && (
        <aside className="gl-panel gl-right">
          <div className="gl-card-head">
            <div>
              <b>{selBlocks.length === 1 ? (plan.blocks.length > 1 ? `Block ${selBlocks[0]! + 1}` : 'The building') : `${selBlocks.length} blocks`}</b>
              <small>{f1(selBlocks.reduce((t, i) => t + ringArea(plan.blocks[i]!), 0))} m² · {selBlocks.reduce((t, i) => t + plan.blocks[i]!.length, 0)} walls</small>
            </div>
            <button type="button" className="gl-x" aria-label="Close" onClick={() => setSel(null)}>×</button>
          </div>
          <div className="gl-body">
            <div className="gl-sec">
              <div className="gl-btns">
                <button type="button" className="gl-btn quiet" onClick={() => copy(selBlocks[0]!)}>Copy</button>
                <button type="button" className="gl-btn quiet" onClick={() => remove(selBlocks)}>Delete</button>
              </div>
              <p className="gl-hint">Drag it to move it; dropped against another block, they join. Drag a wall to push it out, a corner to reshape, the orange handle to turn. Ctrl+C, Ctrl+V and Delete work too.</p>
            </div>
          </div>
        </aside>
      )}
      {selRooms.length > 0 && (() => {
        const one = selRooms.length === 1 ? selRooms[0]! : null
        const zones = [...new Set(selRooms.map((r) => r.zone))]
        const zv = zones.length === 1 ? zones[0]! : '__mixed'
        return (
          <aside className="gl-panel gl-right">
            <div className="gl-card-head">
              <div>
                {one ? (
                  <input className="gl-title-in" aria-label="Room name" defaultValue={one.name} key={`${one.id}-${one.name}`} onBlur={(e) => e.target.value.trim() && e.target.value !== one.name && commit({ ...plan, rooms: plan.rooms.map((r) => (r.id === one.id ? { ...r, name: e.target.value.trim() } : r)) })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                ) : (
                  <b>{selRooms.length} rooms</b>
                )}
                <small>{f1(selRooms.reduce((t, r) => t + ringArea(r.ring), 0))} m² · ground floor</small>
              </div>
              <button type="button" className="gl-x" aria-label="Close" onClick={() => setSel(null)}>×</button>
            </div>
            <div className="gl-body">
              <div className="gl-sec">
                <div className="gl-row">
                  <span>{one ? 'Zone' : 'Put them in'}</span>
                  <select className="gl-sel" value={zv} onChange={(e) => setZoneOf(e.target.value)}>
                    {zv === '__mixed' && <option value="__mixed">Several</option>}
                    {plan.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                    <option value="__new">New zone…</option>
                  </select>
                </div>
                <p className="gl-hint">A zone is a group of rooms the model treats as one space.</p>
              </div>
              <div className="gl-sec">
                <div className="gl-btns">
                  {selRooms.length > 1 && (
                    <button type="button" className="gl-btn quiet" onClick={() => { const r = joinRooms(plan, selRooms.map((x) => x.id)); if ('why' in r) return setSay({ x: size[0] - 320, y: 120, text: r.why, bad: true }); commit(r.plan); setSel({ kind: 'rooms', ids: [selRooms[0]!.id] }) }}>Join these rooms</button>
                  )}
                  {one && <button type="button" className="gl-btn quiet" onClick={() => { const r = halveRoom(plan, one.id); if ('why' in r) return setSay({ x: size[0] - 320, y: 120, text: r.why, bad: true }); commit(r.plan) }}>Halve</button>}
                  <button type="button" className="gl-btn quiet" onClick={() => setSel({ kind: 'rooms', ids: plan.rooms.map((r) => r.id) })}>Choose all rooms</button>
                </div>
              </div>
            </div>
          </aside>
        )
      })()}

      </>}</>, 'right')}
      {has && giving && shownLook === 'plan' && (() => {
        // The key: what the drawing's colours mean for the kind in hand.
        const seen = new Map<string, Swatch>()
        if (mode === 'fabric' && wallsKind) for (const p of pieces) { const id = typeOfSpan(plan, p, elem as WallEl); seen.set(typeName(id), fabricSwatch(id)) }
        else for (const r of plan.rooms) { const h = hasOf(r); if (h) seen.set(h.name, h.swatch) }
        const none = mode !== 'fabric' && plan.rooms.some((r) => !hasOf(r))
        if (mode === 'fabric' && (fkind === 'air' || fkind === 'bridge' || fkind === 'partition')) return null
        return (
          <div className="gl-key" aria-label="Key">
            {[...seen.entries()].map(([n, sw]) => <span key={n}><Sw s={sw} />{n}</span>)}
            {none && <span><Sw s={{ colour: '#FFFFFF' }} />None yet</span>}
            {[...seen.values()].some((x) => x.unset) && <span className="gl-key-note">Striped: not set yet</span>}
          </div>
        )
      })()}
      {toPane(slots?.right, !onSite && !offStep && <>
      {has && mode === 'fabric' && fabricPanel()}
      {mode === 'profiles' && profilesPanel()}
      {has && mode === 'spaces' && spacesPanel()}
      {has && mode === 'systems' && systemsPanel()}
      </>, 'right2')}

      {/* ─── bottom: tools ─── */}
      <p className="gl-tip">{in3d ? 'Drag to turn, right-drag to pan, scroll to zoom. Tap a wall to choose it.' : shownLook === 'elev' ? 'Drag a window or door (0.1 m steps; Shift: 0.01 m). Tap one to nudge it with the arrow keys or make it a door.' : tipLine}</p>
      {shownLook === 'plan' && <div className="gl-bar" role="toolbar" aria-label={`${STEP[mode]} tools`}>
        <span className="gl-step-tag">{STEP_NO[mode]} {STEP[mode]}</span>
        {TOOLS[mode].map((t, i) => (
          <button key={t.key} type="button" className={`gl-tool${t.key === 'corner' ? ' optional' : ''}`} aria-pressed={tool === t.key} title={`${t.name} (${i + 1})`} onClick={() => pick(t.key)} disabled={(t.key === 'cut' || t.key === 'select' || t.key === 'corner') && !has}>
            <span>{t.glyph}</span>
            {t.name}
          </button>
        ))}
        <span className="gl-sep" />
        <button type="button" className="gl-tool" onClick={undo} disabled={!past.length}><span>↶</span>Undo</button>
        <button type="button" className="gl-tool" onClick={redo} disabled={!future.length}><span>↷</span>Redo</button>
      </div>}
      {shownLook === 'plan' && <div className="gl-compass">
        <svg width="34" height="40" viewBox="-17 -20 34 40" aria-label="North is up">
          <circle r="15" fill="#fff" stroke="#DCE2DF" />
          <path d="M0 -11 L5 2 L0 -1 L-5 2 Z" fill="#235546" />
          <path d="M0 11 L5 2 L0 -1 L-5 2 Z" fill="#C3CBC7" />
          <text y="-22" textAnchor="middle" style={{ font: '700 11px var(--gl-detail)', fill: '#235546' }}>N</text>
        </svg>
        <div className="gl-scale" style={{ width: scaleM * view.k }}>
          <i />
          {scaleM} m
        </div>
      </div>}
    </div>
  )
  return embedded && slots ? createPortal(root, slots.centre) : root
}

function Num({ value, unit, auto, step, min = 0, max, onCommit, onChange }: { value: number | string; unit?: string; auto?: boolean; step?: number; min?: number; max?: number; onCommit?: (v: number) => void; onChange?: (s: string) => void }) {
  const [s, setS] = useState(String(value))
  useEffect(() => setS(String(value)), [value])
  const bump = (dir: 1 | -1) => {
    if (!step) return
    const n = Number(s)
    const base = Number.isFinite(n) ? n : 0
    // Step to the next whole multiple of `step` (1.67 + 0.1 → 1.7), never below `min`.
    const k = dir > 0 ? Math.floor(base / step + 1e-9) + 1 : Math.ceil(base / step - 1e-9) - 1
    const v = String(Math.min(max ?? Infinity, Math.max(min, Math.round(k * step * 1000) / 1000)))
    setS(v)
    onChange?.(v)
    onCommit?.(Number(v))
  }
  return (
    <span className={`gl-num${auto ? ' auto' : ''}${step ? ' stepped' : ''}`}>
      {auto && <i className="gl-auto-tag">auto</i>}
      {step && <button type="button" className="gl-step" aria-label="Less" onClick={() => bump(-1)}>−</button>}
      <input
        inputMode="decimal"
        value={s}
        onChange={(e) => {
          setS(e.target.value)
          onChange?.(e.target.value)
        }}
        onBlur={() => onCommit && Number.isFinite(Number(s)) && onCommit(Number(s))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (step && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault()
            bump(e.key === 'ArrowUp' ? 1 : -1)
          }
        }}
      />
      {step && <button type="button" className="gl-step" aria-label="More" onClick={() => bump(1)}>+</button>}
      {unit && <small>{unit}</small>}
    </span>
  )
}
