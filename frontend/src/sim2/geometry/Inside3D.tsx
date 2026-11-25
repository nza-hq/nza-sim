/**
 * Inside the building, in decodED's inside viewer's look (Linzie, 25 Nov 2026: "Yes perfect!" to decodED's view of
 * the RWGC clubhouse; nza-decoded twin/app/inside/scene.ts, twin/app/detailed/insideView.ts):
 *
 * - One floor (`mode = 'floor'`): the floor being edited like a doll's house with its lid off. A pale slab, each room's
 *   floor in its decodED room type's colour (or the step's own colour, as on the plan), its walls white and cut at
 *   1.5 m (0.18 m thick; the outside wall white, 0.3 m), its name and m² on a label (a dot where names would crowd).
 *   The other floors are split off above and below and shown only as faint outlines.
 * - Every floor apart (`mode = 'apart'`): every floor pulled apart and stacked in the air, walls laid flat, each room a
 *   dot (its name on pointing), the floors' names at the side and faint lines joining their corners.
 *
 * Read only: picking walls and windows stays in the outside view. Plan (x east, y north) → three (x, up, −y).
 */
import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { type Plan, type PlanFloor, type PlanRoom, type XY, edgesOf, floorsOf } from './plan'
import { INSIDE, roomTypeColour } from './look/sketch'
import RoomLabels, { type LabelRoom } from './look/RoomLabels'
import { area } from './ported/zones'

type Props = {
  plan: Plan
  mode: 'floor' | 'apart'
  /** The step's own colour for a room (space type, system, …); absent or null: its decodED room type's. */
  roomColour?: (r: PlanRoom) => string | null
  /** The rooms chosen on the floor being edited, in decodED's orange. */
  chosenRooms?: ReadonlySet<string>
}

const shapeOf = (ring: readonly XY[]) => {
  const s = new THREE.Shape()
  ring.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])))
  s.closePath()
  return s
}

function Slab({ ring, y, t, mat }: { ring: XY[]; y: number; t: number; mat: THREE.Material }) {
  const g = useMemo(() => new THREE.ExtrudeGeometry(shapeOf(ring), { depth: t, bevelEnabled: false }), [ring, t])
  return <mesh geometry={g} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} material={mat} />
}

/** Walls along a ring's sides (or a list of segments), `h` tall from `y`, `t` thick, centred on the line. */
function Walls({ segs, y, h, t, mat }: { segs: Array<[XY, XY]>; y: number; h: number; t: number; mat: THREE.Material }) {
  return (
    <>
      {segs.map(([a, b], i) => {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (L < 0.05) return null
        return (
          <mesh key={i} position={[(a[0] + b[0]) / 2, y + h / 2, -(a[1] + b[1]) / 2]} rotation={[0, Math.atan2(b[1] - a[1], b[0] - a[0]), 0]} material={mat}>
            <boxGeometry args={[L + t, h, t]} />
          </mesh>
        )
      })}
    </>
  )
}
const sidesOf = (ring: readonly XY[]): Array<[XY, XY]> => ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as [XY, XY])

function RingLines({ rings, y, mat }: { rings: XY[][]; y: number; mat: THREE.LineBasicMaterial }) {
  const g = useMemo(() => new THREE.BufferGeometry().setFromPoints(rings.flatMap((r) => sidesOf(r).flatMap(([a, b]) => [new THREE.Vector3(a[0], y, -a[1]), new THREE.Vector3(b[0], y, -b[1])]))), [rings, y])
  return <lineSegments geometry={g} material={mat} />
}

export default function Inside3D({ plan, mode, roomColour, chosenRooms }: Props) {
  const floors = useMemo(() => floorsOf(plan), [plan])
  const act = plan.active_floor ?? 0
  const H = plan.storey_height_m
  // The building's span, and the floors' spacing as decodED's: at least two and a half storeys, more for a big plan.
  const [box] = useState(() => {
    const pts = floors.flatMap((f) => f.blocks.flat())
    if (!pts.length) return { c: [0, 0] as XY, span: 20 }
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    return { c: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] as XY, span: Math.max(10, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) }
  })
  const gap = Math.max(H * 2.5, box.span * 0.28)
  const yOf = (i: number) => i * gap
  const apart = mode === 'apart'
  const wallH = apart ? INSIDE.flat : INSIDE.cut

  const mats = useMemo(() => ({
    slab: new THREE.MeshLambertMaterial({ color: INSIDE.slab }),
    wall: new THREE.MeshLambertMaterial({ color: INSIDE.wall }),
    outer: new THREE.MeshLambertMaterial({ color: INSIDE.outerWall }),
    ghost: new THREE.LineBasicMaterial({ color: INSIDE.ghost, transparent: true, opacity: INSIDE.ghostOpacity }),
    lines: new THREE.LineBasicMaterial({ color: INSIDE.ghost, transparent: true, opacity: apart ? INSIDE.lines : 0.07 }),
  }), [apart])
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats])
  const roomMat = useMemo(() => {
    const cache = new Map<string, THREE.MeshLambertMaterial>()
    return (c: string) => { let m = cache.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); cache.set(c, m) } return m }
  }, [])

  const shown = (i: number) => apart || i === act
  const colourOf = (r: PlanRoom, i: number) => (i === act && chosenRooms?.has(r.id) ? INSIDE.chosen : roomColour?.(r)?.slice(0, 7) ?? roomTypeColour(r.name))
  const labelRooms: LabelRoom[] = useMemo(
    () => floors.flatMap((f, i) => (shown(i) ? f.rooms.map((r) => ({ id: `${i}:${r.id}`, name: r.name, ring: r.ring, y: yOf(i) + INSIDE.slabT + 0.1, on: i === act && !!chosenRooms?.has(r.id) })) : [])),
    [floors, apart, act, chosenRooms, gap], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // The camera: decodED's, from the south-west and above, on the floor in hand (or the middle of the stack).
  const top = yOf(floors.length - 1)
  const target: [number, number, number] = [box.c[0], apart ? top * 0.45 : yOf(act), -box.c[1]]
  const size = apart ? Math.max(box.span, top * 0.9 + box.span * 0.5) : box.span
  const dir = apart ? new THREE.Vector3(-0.7, 0.62, 0.9).normalize() : new THREE.Vector3(-0.62, 0.78, 0.9).normalize()
  const fit = (size * 0.62) / Math.tan(THREE.MathUtils.degToRad(20))
  const cam = new THREE.Vector3(...target).addScaledVector(dir, fit).toArray() as [number, number, number]
  // The lines joining the floors: at the ground floor's real corners only (where its biggest block turns by more than
  // 25°, decodED's CORNER_TURN), not at every facet of a curved wall.
  const corners = useMemo(() => {
    const ring = [...(floors[0]?.blocks ?? [])].sort((a, b) => area(b) - area(a))[0]
    if (!ring) return null
    const n = ring.length
    const turn = (i: number) => {
      const a = ring[(i + n - 1) % n]!, p = ring[i]!, b = ring[(i + 1) % n]!
      const d = Math.atan2(b[1] - p[1], b[0] - p[0]) - Math.atan2(p[1] - a[1], p[0] - a[0])
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))
    }
    const pts = ring.filter((_, i) => turn(i) > THREE.MathUtils.degToRad(25))
    return new THREE.BufferGeometry().setFromPoints((pts.length >= 3 ? pts : ring).flatMap((p) => [new THREE.Vector3(p[0], 0, -p[1]), new THREE.Vector3(p[0], top, -p[1])]))
  }, [floors, top])

  return (
    <Canvas flat camera={{ position: cam, fov: 40, near: 0.5, far: 6000 }} gl={{ antialias: true }} style={{ position: 'absolute', inset: 0, background: INSIDE.page }}>
      <hemisphereLight args={['#FFFFFF', '#C9CFCC', 1.6]} />
      <directionalLight position={[box.c[0] - 40, 80, -box.c[1] - 30]} intensity={1.4} />
      {floors.map((f, i) => <FloorAt key={i} f={f} i={i} y={yOf(i)} full={shown(i)} wallH={wallH} mats={mats} roomMat={roomMat} colourOf={colourOf} name={apart ? f.name : null} tagAt={[box.c[0] + box.span / 2 + 2, -box.c[1]]} />)}
      {floors.length > 1 && corners && <lineSegments geometry={corners} material={mats.lines} />}
      <RoomLabels rooms={labelRooms} dots={apart} />
      <FitAspect />
      <OrbitControls target={target} enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI * 0.47} minDistance={3} maxDistance={fit * 4} screenSpacePanning makeDefault />
    </Canvas>
  )
}

/** Keeps the camera's aspect with the pane (R3F does), and nothing else: the start is set by the camera prop. */
function FitAspect() {
  const { camera, size } = useThree()
  useEffect(() => { (camera as THREE.PerspectiveCamera).updateProjectionMatrix() }, [camera, size])
  return null
}

function FloorAt({ f, i, y, full, wallH, mats, roomMat, colourOf, name, tagAt }: {
  f: PlanFloor; i: number; y: number; full: boolean; wallH: number
  mats: { slab: THREE.Material; wall: THREE.Material; outer: THREE.Material; ghost: THREE.LineBasicMaterial }
  roomMat: (c: string) => THREE.Material; colourOf: (r: PlanRoom, i: number) => string; name: string | null; tagAt: [number, number]
}) {
  const inner = useMemo(() => {
    const seen = new Set<string>()
    const k = (p: XY) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`
    const out: Array<[XY, XY]> = []
    for (const e of edgesOf(f.blocks, f.rooms.map((r) => ({ id: r.id, ring: r.ring }))).inner) {
      const key = [k(e.a), k(e.b)].sort().join('|')
      if (!seen.has(key)) { seen.add(key); out.push([e.a, e.b]) }
    }
    return out
  }, [f])
  const outer = useMemo(() => f.blocks.flatMap(sidesOf), [f])
  if (!full) return <RingLines rings={[...f.blocks, ...f.rooms.map((r) => r.ring)]} y={y + 0.05} mat={mats.ghost} />
  const T = INSIDE.slabT
  return (
    <group>
      {f.blocks.map((b, j) => <Slab key={`s${j}`} ring={b} y={y} t={T} mat={mats.slab} />)}
      {f.rooms.map((r) => <Slab key={r.id} ring={r.ring} y={y + T + 0.01} t={0.08} mat={roomMat(colourOf(r, i))} />)}
      <Walls segs={inner} y={y + T} h={wallH} t={INSIDE.wallT} mat={mats.wall} />
      <Walls segs={outer} y={y + T + 0.03} h={wallH} t={0.3} mat={mats.outer} />
      {name && (
        <Html position={[tagAt[0], y + 0.3, tagAt[1]]} zIndexRange={[2, 0]} style={{ pointerEvents: 'none' }}>
          <span className="sk-tag">{name}</span>
        </Html>
      )}
    </group>
  )
}
