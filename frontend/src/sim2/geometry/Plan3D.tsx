/**
 * Sim2 geometry prototype: the plan in 3D, one storey. Walls are cut round their windows, each window has the reveal
 * frame and the optional shading frame (overhang, fins and sill all the same depth) that today's BuildingViewer3D
 * draws, and the floor shows each room in its zone's colour. Read-only apart from choosing a wall.
 *
 * Plan (x east, y north) → three (x, up, −y), so −Z is north as in BuildingViewer3D. Each wall run is a group turned
 * about Y so its local +X runs a→b along the wall and local +Z points outside. No Sky or Environment presets: they
 * fetch from a CDN, and this has to work offline in the published preview.
 */
import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, type ThreeEvent, useThree } from '@react-three/fiber'
import { type ReactElement, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { type Plan, type PlacedWindow, type Span, type WallRun, type XY, edgesOf } from './plan'
import { labelAt, zoneTint } from './ported/zones'

// Colours from BuildingViewer3D, so the two read as one tool.
const C = { wall: '#EBEBEB', chosen: '#CFE6DB', glazing: '#5E94C2', frame: '#D8D8D8', shading: '#7C8694', slab: '#C9CFCC', ground: '#EEF0ED', partition: '#F7F7F7', select: '#E28F2C', bad: '#B5322B', door: '#9C7B5A' }
const WALL_T = 0.25 // outside wall thickness, inward from the outside face
const PART_T = 0.1
const FD = 0.08 // reveal frame depth, out from the wall face (as today)
const SHADE_T = 0.04 // shading slab thickness (as today)
const SLAB = 0.3

type Band = Span & { colour: string }
type Props = {
  plan: Plan
  runs: WallRun[]
  placed: PlacedWindow[]
  /** The chosen wall piece (or whole wall), outlined. */
  chosen: Span | null
  /** Windows crossing into the next room, drawn red. */
  crossers: Set<string>
  /** Wall-type colour bands along the foot of the walls (only when there is more than one type). */
  bands: Band[]
  onPickWall: (i: number, t: number) => void
  /** Linzie, 17 Nov 10:03: the roof is drawn see-through, so the rooms show beneath; solid when the roof is chosen. */
  roofOn?: boolean
}

export default function Plan3D({ plan, runs, placed, chosen, crossers, bands, onPickWall, roofOn = false }: Props) {
  const H = plan.storey_height_m
  // The camera starts on the building as it was when 3D opened; edits after that do not move it.
  const [start] = useState(() => {
    const pts = plan.blocks.flat()
    if (!pts.length) return { c: [0, 0] as XY, r: 20 }
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const c: XY = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    return { c, r: Math.max(10, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) }
  })
  const target: [number, number, number] = [start.c[0], H / 3, -start.c[1]]
  const cam: [number, number, number] = [start.c[0] + start.r * 0.55, start.r * 0.95, -start.c[1] + start.r * 0.95]

  const partitions = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ a: XY; b: XY }> = []
    const k = (p: XY) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`
    for (const e of edgesOf(plan.blocks, plan.rooms.map((r) => ({ id: r.id, ring: r.ring }))).inner) {
      const key = [k(e.a), k(e.b)].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e)
    }
    return out
  }, [plan.blocks, plan.rooms])

  const zoneIndex = (zid: string) => Math.max(0, plan.zones.findIndex((z) => z.id === zid))

  return (
    <Canvas shadows camera={{ position: cam, fov: 40, near: 0.1, far: 2000 }} gl={{ antialias: true }} style={{ position: 'absolute', inset: 0, background: '#E4EEF2' }}>
      <ambientLight intensity={0.55} color="#EEF2FF" />
      <hemisphereLight args={['#F4F8FF', '#D9DDD8', 0.35]} />
      {/* Sun from the south-west, as in BuildingViewer3D (+Z is south). */}
      <directionalLight
        position={[start.c[0] - start.r, start.r * 1.4, -start.c[1] + start.r]}
        intensity={1.3}
        color="#FFF8F0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-start.r * 1.5}
        shadow-camera-right={start.r * 1.5}
        shadow-camera-top={start.r * 1.5}
        shadow-camera-bottom={-start.r * 1.5}
        shadow-camera-far={start.r * 5}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[start.c[0] + start.r, start.r * 0.6, -start.c[1] - start.r]} intensity={0.25} color="#D6E8F7" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[start.c[0], -SLAB - 0.01, -start.c[1]]} receiveShadow>
        <planeGeometry args={[start.r * 8, start.r * 8]} />
        <meshStandardMaterial color={C.ground} roughness={0.95} />
      </mesh>

      {plan.blocks.map((b, i) => <Slab key={`s${i}`} ring={b} />)}
      {plan.rooms.map((r) => (
        <RoomFloor key={r.id} ring={r.ring} colour={zoneTint(zoneIndex(r.zone)).fill} />
      ))}
      {plan.rooms.map((r) => {
        const at = labelAt(r.ring)
        return (
          <Html key={`l${r.id}`} position={[at[0], 0.05, -at[1]]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
            <span className="gl-3d-label" style={{ borderColor: zoneTint(zoneIndex(r.zone)).line }}>{r.name}</span>
          </Html>
        )
      })}
      {plan.blocks.map((b, i) => <Roof key={`r${i}`} ring={b} H={H} on={roofOn} />)}
      {partitions.map((p, i) => <Partition key={`p${i}`} a={p.a} b={p.b} H={H} />)}
      {runs.map((run) => (
        <Wall key={run.index} run={run} H={H} windows={placed.filter((w) => w.wall === run.index)} chosen={chosen?.run === run.index ? chosen : null} crossers={crossers} bands={bands.filter((b) => b.run === run.index)} onPick={(t) => onPickWall(run.index, t)} />
      ))}

      <FitToPane target={target} radius={start.r * 0.72} />
      <OrbitControls target={target} enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2 - 0.05} minDistance={3} maxDistance={start.r * 6} makeDefault />
    </Canvas>
  )
}

/** Keeps the whole building in view when the pane is narrow: sets the camera's distance (never its angle) so a
 * sphere round the building fits both across and up the view. Runs when the view opens and when the pane changes shape. */
function FitToPane({ target, radius }: { target: [number, number, number]; radius: number }) {
  const { camera, size } = useThree()
  const aspect = size.width / Math.max(1, size.height)
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    if (!cam.isPerspectiveCamera) return
    const vHalf = THREE.MathUtils.degToRad(cam.fov / 2)
    const hHalf = Math.atan(Math.tan(vHalf) * aspect)
    const dist = radius / Math.sin(Math.min(vHalf, hHalf))
    const t = new THREE.Vector3(...target)
    const dir = cam.position.clone().sub(t).normalize()
    cam.position.copy(t.add(dir.multiplyScalar(dist)))
    cam.updateProjectionMatrix()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect])
  return null
}

function shapeOf(ring: readonly XY[]) {
  const s = new THREE.Shape()
  ring.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])))
  s.closePath()
  return s
}

/** Floor slab under a block. A shape in plan (x, y) turned −90° about X lies at (x, 0, −y); the extrusion goes up. */
function Slab({ ring }: { ring: XY[] }) {
  const g = useMemo(() => new THREE.ExtrudeGeometry(shapeOf(ring), { depth: SLAB, bevelEnabled: false }), [ring])
  return (
    <mesh geometry={g} rotation={[-Math.PI / 2, 0, 0]} position={[0, -SLAB, 0]} receiveShadow castShadow>
      <meshStandardMaterial color={C.slab} roughness={0.95} />
    </mesh>
  )
}

/** The flat roof over a block: a slab at the storey height, see-through unless the roof is chosen. */
function Roof({ ring, H, on }: { ring: XY[]; H: number; on: boolean }) {
  const g = useMemo(() => new THREE.ExtrudeGeometry(shapeOf(ring), { depth: SLAB, bevelEnabled: false }), [ring])
  return (
    <mesh geometry={g} rotation={[-Math.PI / 2, 0, 0]} position={[0, H, 0]} castShadow={on} receiveShadow={on} renderOrder={on ? 0 : 2}>
      <meshStandardMaterial color={on ? C.chosen : C.slab} roughness={0.9} transparent={!on} opacity={on ? 1 : 0.16} depthWrite={on} />
    </mesh>
  )
}

function RoomFloor({ ring, colour }: { ring: XY[]; colour: string }) {
  const g = useMemo(() => new THREE.ShapeGeometry(shapeOf(ring)), [ring])
  return (
    <mesh geometry={g} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
      <meshStandardMaterial color={colour} roughness={0.9} />
    </mesh>
  )
}

/** A group whose local +X runs a→b and local +Z points to the right of a→b (outside, for an anticlockwise ring). */
function along(a: XY, b: XY) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  return { L, pos: [a[0], 0, -a[1]] as [number, number, number], rot: [0, Math.atan2(b[1] - a[1], b[0] - a[0]), 0] as [number, number, number] }
}

function Partition({ a, b, H }: { a: XY; b: XY; H: number }) {
  const { L, pos, rot } = along(a, b)
  return (
    <group position={pos} rotation={rot}>
      <mesh position={[L / 2, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[L, H, PART_T]} />
        <meshStandardMaterial color={C.partition} roughness={0.9} />
      </mesh>
    </group>
  )
}

/** Box in a wall group's frame: x from x0 to x1 along, y from y0 to y1 up, z from z0 to z1 (out is +). */
function Box({ x0, x1, y0, y1, z0, z1, colour, rough = 0.9 }: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; colour: string; rough?: number }) {
  if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return null
  return (
    <mesh position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} castShadow receiveShadow>
      <boxGeometry args={[x1 - x0, y1 - y0, z1 - z0]} />
      <meshStandardMaterial color={colour} roughness={rough} metalness={rough < 0.8 ? 0.05 : 0} />
    </mesh>
  )
}

function Wall({ run, H, windows, chosen, crossers, bands, onPick }: { run: WallRun; H: number; windows: PlacedWindow[]; chosen: Span | null; crossers: Set<string>; bands: Band[]; onPick: (t: number) => void }) {
  const { L, pos, rot } = along(run.a, run.b)
  const ws = [...windows].sort((p, q) => p.offset_m - q.offset_m)
  const colour = C.wall
  const wall = { z0: -WALL_T, z1: 0, colour }
  const click = (e: ThreeEvent<MouseEvent>) => {
    // A click, not the end of an orbit drag.
    if (e.delta > 4) return
    e.stopPropagation()
    // Where along the wall: the hit point back in plan (x, −z), onto the run.
    const ux = (run.b[0] - run.a[0]) / (L || 1)
    const uy = (run.b[1] - run.a[1]) / (L || 1)
    const t = (e.point.x - run.a[0]) * ux + (-e.point.z - run.a[1]) * uy
    onPick(Math.max(0, Math.min(L, t)))
  }
  const pieces: ReactElement[] = []
  let x = 0
  ws.forEach((w, i) => {
    const x0 = w.offset_m
    const x1 = w.offset_m + w.width_m
    const top = w.sill_m + w.height_m
    pieces.push(<Box key={`pier${i}`} x0={x} x1={x0} y0={0} y1={H} {...wall} />)
    pieces.push(<Box key={`sill${i}`} x0={x0} x1={x1} y0={0} y1={w.sill_m} {...wall} />)
    pieces.push(<Box key={`head${i}`} x0={x0} x1={x1} y0={top} y1={H} {...wall} />)
    x = x1
  })
  pieces.push(<Box key="pier-end" x0={x} x1={L} y0={0} y1={H} {...wall} />)

  return (
    <group position={pos} rotation={rot} onClick={click} onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
      {pieces}
      {ws.map((w, i) => <Window key={i} w={w} bad={crossers.has(w.set)} />)}
      {bands.map((b, i) => <Box key={`band${i}`} x0={b.t0} x1={b.t1} y0={0} y1={0.25} z0={0} z1={0.012} colour={b.colour} />)}
      {chosen && (
        <>
          {/* The chosen piece outlined on the outside face. */}
          <Box x0={chosen.t0} x1={chosen.t1} y0={H - 0.06} y1={H} z0={0} z1={0.03} colour={C.select} rough={0.6} />
          <Box x0={chosen.t0} x1={chosen.t1} y0={0} y1={0.06} z0={0} z1={0.03} colour={C.select} rough={0.6} />
          <Box x0={chosen.t0} x1={chosen.t0 + 0.06} y0={0} y1={H} z0={0} z1={0.03} colour={C.select} rough={0.6} />
          <Box x0={chosen.t1 - 0.06} x1={chosen.t1} y0={0} y1={H} z0={0} z1={0.03} colour={C.select} rough={0.6} />
        </>
      )}
    </group>
  )
}

/** Glass set back in the opening, a reveal frame round it on the wall face, and the shading frame if it has one. */
function Window({ w, bad }: { w: PlacedWindow; bad: boolean }) {
  const x0 = w.offset_m
  const x1 = w.offset_m + w.width_m
  const y0 = w.sill_m
  const y1 = w.sill_m + w.height_m
  const FW = Math.max(0.04, Math.min(0.08, w.width_m * 0.12)) // frame strip 40–80 mm, as today
  const f = { z0: 0, z1: FD, colour: bad ? C.bad : C.frame, rough: 0.55 }
  const d = w.shading_m
  const s = { z0: 0, z1: d, colour: C.shading, rough: 0.85 }
  const o = FW // the shading frame sits just outside the reveal frame
  if (w.door) {
    // A door: a solid leaf set back in the opening, frame on the sides and head only.
    return (
      <>
        <Box x0={x0} x1={x1} y0={0} y1={y1} z0={-0.1} z1={-0.05} colour={C.door} rough={0.7} />
        <Box x0={x0 - FW} x1={x1 + FW} y0={y1} y1={y1 + FW} {...f} />
        <Box x0={x0 - FW} x1={x0} y0={0} y1={y1} {...f} />
        <Box x0={x1} x1={x1 + FW} y0={0} y1={y1} {...f} />
      </>
    )
  }
  return (
    <>
      <mesh position={[(x0 + x1) / 2, (y0 + y1) / 2, -0.08]}>
        <planeGeometry args={[w.width_m, w.height_m]} />
        <meshPhysicalMaterial color={C.glazing} roughness={0.12} metalness={0.05} transparent opacity={0.55} reflectivity={0.35} side={THREE.DoubleSide} />
      </mesh>
      <Box x0={x0 - FW} x1={x1 + FW} y0={y1} y1={y1 + FW} {...f} />
      <Box x0={x0 - FW} x1={x1 + FW} y0={y0 - FW} y1={y0} {...f} />
      <Box x0={x0 - FW} x1={x0} y0={y0} y1={y1} {...f} />
      <Box x0={x1} x1={x1 + FW} y0={y0} y1={y1} {...f} />
      {d > 0 && (
        <>
          <Box x0={x0 - o - SHADE_T} x1={x1 + o + SHADE_T} y0={y1 + o} y1={y1 + o + SHADE_T} {...s} />
          <Box x0={x0 - o - SHADE_T} x1={x1 + o + SHADE_T} y0={y0 - o - SHADE_T} y1={y0 - o} {...s} />
          <Box x0={x0 - o - SHADE_T} x1={x0 - o} y0={y0 - o} y1={y1 + o} {...s} />
          <Box x0={x1 + o} x1={x1 + o + SHADE_T} y0={y0 - o} y1={y1 + o} {...s} />
        </>
      )}
    </>
  )
}
