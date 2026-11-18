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
import pc from 'polygon-clipping'
import { type Plan, type PlacedWindow, type PlanFloor, type Span, type WallRun, type XY, allWindows, edgesOf, floorsOf, wallRuns } from './plan'
import { labelAt, zoneTint } from './ported/zones'
import { type BlockRoof, type RoofPiece, blockRoof, roofPieces } from './roof'
import { type WallCurve, curvedWalls, displayRing, displayRoomRing } from './curves'

// Colours from BuildingViewer3D, so the two read as one tool.
const C = { tiles: '#9C5B4A', flatRoof: '#8E979B', floorOn: '#F2B872', wall: '#EBEBEB', chosen: '#CFE6DB', glazing: '#5E94C2', frame: '#D8D8D8', shading: '#7C8694', slab: '#C9CFCC', ground: '#EEF0ED', partition: '#F7F7F7', select: '#E28F2C', bad: '#B5322B', door: '#9C7B5A' }
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
  /** Linzie, 17 Nov 10:29: the ground floor tinted a lighter orange when it is chosen. */
  floorOn?: boolean
  /** Brief 123: one roof per roof piece (roofPieces: each block, or each of its roof parts), from the roof service or the browser; absent, worked out here. */
  roofs?: BlockRoof[]
  /** The rooms' names on the floor (off for a busy building, so the building itself can be seen). */
  labels?: boolean
  /** 18 Nov 2026 (Linzie: "see the whole building in 3D with all the roof shapes"): every roof drawn solid, in a
   * roof colour, rather than see-through. */
  solidRoofs?: boolean
}

export default function Plan3D({ plan, runs, placed, chosen, crossers, bands, onPickWall, roofOn = false, floorOn = false, roofs, labels = true, solidRoofs = false }: Props) {
  const H = plan.storey_height_m
  // Stacked floors (18 Nov 2026, Linzie: "see the whole building in 3D"): every floor at its height, the one being
  // edited as before (walls to choose, labels), the others drawn with their walls, windows and roofs.
  const floors = useMemo(() => floorsOf(plan), [plan])
  const act = plan.active_floor ?? 0
  // The camera starts on the building as it was when 3D opened; edits after that do not move it.
  const [start] = useState(() => {
    const pts = floorsOf(plan).flatMap((f) => f.blocks.flat())
    if (!pts.length) return { c: [0, 0] as XY, r: 20 }
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const c: XY = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    return { c, r: Math.max(10, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) }
  })
  const target: [number, number, number] = [start.c[0], (H * floors.length) / 3, -start.c[1]]
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
  // Curved walls (drawing only): the facets they replace, the smooth wall's segments, and outlines to match.
  const curves = plan.curves ?? []
  const cw = useMemo(() => curvedWalls(plan.blocks, runs, placed, curves), [plan.blocks, runs, placed, curves])
  const smooth = (ring: XY[], block: number) => (curves.length ? displayRing(ring, curves.filter((c) => c.block === block)) : ring)
  const joins = useMemo(() => wallJoins(ordered(runs, cw)), [runs, cw])

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

      {floors.map((f, i) => (i === act ? null : <OtherFloor key={`f${i}`} plan={plan} floor={f} above={floors[i + 1]} y={i * H} H={H} solid={solidRoofs} />))}
      <group position={[0, act * H, 0]}>
      {plan.blocks.map((b, i) => <Slab key={`s${i}`} ring={smooth(b, i)} on={floorOn} />)}
      {plan.rooms.map((r) => (
        <RoomFloor key={r.id} ring={curves.length ? displayRoomRing(r.ring, plan.blocks, curves) : r.ring} colour={zoneTint(zoneIndex(r.zone)).fill} />
      ))}
      {floorOn && plan.blocks.map((b, i) => <FloorGlow key={`fg${i}`} ring={smooth(b, i)} />)}
      {labels && plan.rooms.map((r) => {
        const at = labelAt(r.ring)
        return (
          <Html key={`l${r.id}`} position={[at[0], 0.05, -at[1]]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
            <span className="gl-3d-label" style={{ borderColor: zoneTint(zoneIndex(r.zone)).line }}>{r.name}</span>
          </Html>
        )
      })}
      {roofPieces(plan).map((p, i, all) => { const br = roofs?.[i] ?? blockRoof(p.ring, p.recipe); return br.style === 'flat' ? <Roof key={`r${i}`} ring={p.part ? p.ring : smooth(p.ring, p.block)} cut={restCut(p, all, floors[act + 1])} H={H} on={roofOn} solid={solidRoofs} hide={floorOn && !roofOn} /> : <Pitched key={`r${i}`} roof={br} H={H} on={roofOn} solid={solidRoofs} hide={floorOn && !roofOn} /> })}
      {partitions.map((p, i) => <Partition key={`p${i}`} a={p.a} b={p.b} H={H} />)}
      {cw.segments.map((g, i) => <Wall key={`cw${i}`} run={g.run} H={H} windows={g.windows} chosen={null} crossers={crossers} bands={[]} onPick={() => {}} join={joins.get(g.run.index)} />)}
      {runs.filter((run) => !cw.replaced.has(run.index)).map((run) => (
        <Wall key={run.index} join={joins.get(run.index)} run={run} H={H} windows={placed.filter((w) => w.wall === run.index)} chosen={chosen?.run === run.index ? chosen : null} crossers={crossers} bands={bands.filter((b) => b.run === run.index)} onPick={(t) => onPickWall(run.index, t)} />
      ))}
      </group>

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
function Slab({ ring, on = false }: { ring: XY[]; on?: boolean }) {
  const g = useMemo(() => new THREE.ExtrudeGeometry(shapeOf(ring), { depth: SLAB, bevelEnabled: false }), [ring])
  return (
    <mesh geometry={g} rotation={[-Math.PI / 2, 0, 0]} position={[0, -SLAB, 0]} receiveShadow castShadow>
      <meshStandardMaterial color={on ? C.floorOn : C.slab} roughness={0.95} />
    </mesh>
  )
}

/** The chosen ground floor: a see-through orange wash over the room colours, so the rooms still read. */
function FloorGlow({ ring }: { ring: XY[] }) {
  const g = useMemo(() => new THREE.ShapeGeometry(shapeOf(ring)), [ring])
  return (
    <mesh geometry={g} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} renderOrder={1}>
      <meshStandardMaterial color={C.select} roughness={0.9} transparent opacity={0.4} depthWrite={false} />
    </mesh>
  )
}

/** The part of a ring no floor above stands on (stacked floors), as shapes with their holes. */
function uncovered(ring: readonly XY[], cut: readonly (readonly XY[])[] | undefined): THREE.Shape[] {
  const close = (r: readonly XY[]) => [...r.map((p) => [p[0], p[1]] as [number, number]), [r[0]![0], r[0]![1]] as [number, number]]
  if (!cut?.length) return [shapeOf(ring)]
  const left = pc.difference([close(ring)], ...cut.map((c) => [close(c)] as pc.Polygon))
  return left.map((poly) => {
    const sh = shapeOf(poly[0]!.slice(0, -1) as XY[])
    for (const hole of poly.slice(1)) { const h = new THREE.Path(); hole.slice(0, -1).forEach((p, i) => (i ? h.lineTo(p[0], p[1]) : h.moveTo(p[0], p[1]))); sh.holes.push(h) }
    return sh
  })
}

/** The flat roof over a block: a slab at the storey height, see-through unless the roof is chosen. With floors stacked,
 * only where no floor above stands on it. */
function Roof({ ring, cut, H, on, hide, solid = false }: { ring: XY[]; cut?: XY[][]; H: number; on: boolean; hide: boolean; solid?: boolean }) {
  const g = useMemo(() => new THREE.ExtrudeGeometry(uncovered(ring, cut), { depth: SLAB, bevelEnabled: false }), [ring, cut])
  // With the ground floor chosen the roof is left off, so the floor can be seen.
  if (hide) return null
  return (
    <mesh geometry={g} rotation={[-Math.PI / 2, 0, 0]} position={[0, H, 0]} castShadow={on || solid} receiveShadow={on || solid} renderOrder={on || solid ? 0 : 2}>
      <meshStandardMaterial color={on ? C.select : solid ? C.flatRoof : C.slab} roughness={0.8} transparent={!on && !solid} opacity={on || solid ? 1 : 0.16} depthWrite={on || solid} />
    </mesh>
  )
}

/** Brief 123: a pitched roof's faces (slopes and gable walls) from roof.ts; see-through unless the roof is chosen. */
function Pitched({ roof, H, on, hide, solid = false }: { roof: BlockRoof; H: number; on: boolean; hide: boolean; solid?: boolean }) {
  const g = useMemo(() => {
    const pos: number[] = []
    for (const f of roof.faces) {
      const p = f.pts.map(([x, y, z]) => [x, H + z, -y])
      for (let i = 1; i + 1 < p.length; i++) pos.push(...p[0]!, ...p[i]!, ...p[i + 1]!) // every face is convex
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.computeVertexNormals()
    return geo
  }, [roof, H])
  const edges = useMemo(() => new THREE.EdgesGeometry(g, 1), [g])
  if (hide) return null
  return (
    <group renderOrder={on || solid ? 0 : 2}>
      <mesh geometry={g} castShadow={on || solid} receiveShadow={on || solid}>
        <meshStandardMaterial color={on ? C.select : solid ? C.tiles : C.slab} roughness={0.8} side={THREE.DoubleSide} transparent={!on && !solid} opacity={on || solid ? 1 : 0.22} depthWrite={on || solid} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={on ? '#9A5A12' : '#7C8694'} transparent opacity={on ? 1 : 0.6} />
      </lineSegments>
    </group>
  )
}

/** A floor other than the one being edited: slab, room colours, walls with their windows and its roof, drawn at its
 * height and not chosen from here (switch floors to edit it). */
function OtherFloor({ plan, floor, above, y, H, solid }: { plan: Plan; floor: PlanFloor; above?: PlanFloor; y: number; H: number; solid: boolean }) {
  const sub = useMemo(() => ({ ...plan, blocks: floor.blocks, rooms: floor.rooms, windows: floor.windows, wall_spans: floor.wall_spans, roof_parts: floor.roof_parts, roof: floor.roof ?? plan.roof }), [plan, floor])
  const runs = useMemo(() => wallRuns(sub.blocks), [sub])
  const placed = useMemo(() => allWindows(sub).windows, [sub])
  const zoneIndex = (zid: string) => Math.max(0, plan.zones.findIndex((z) => z.id === zid))
  const curves: WallCurve[] = floor.curves ?? []
  const cw = useMemo(() => curvedWalls(sub.blocks, runs, placed, curves), [sub, runs, placed, curves])
  const smooth = (ring: XY[], block: number) => (curves.length ? displayRing(ring, curves.filter((c) => c.block === block)) : ring)
  const joins = useMemo(() => wallJoins(ordered(runs, cw)), [runs, cw])
  return (
    <group position={[0, y, 0]}>
      {sub.blocks.map((b, i) => <Slab key={`s${i}`} ring={smooth(b, i)} />)}
      {sub.rooms.map((r) => <RoomFloor key={r.id} ring={curves.length ? displayRoomRing(r.ring, sub.blocks, curves) : r.ring} colour={zoneTint(zoneIndex(r.zone)).fill} />)}
      {roofPieces(sub, true).map((p, i, all) => { const br = blockRoof(p.ring, p.recipe); return br.style === 'flat' ? <Roof key={`r${i}`} ring={p.part ? p.ring : smooth(p.ring, p.block)} cut={restCut(p, all, above)} H={H} on={false} solid={solid} hide={false} /> : <Pitched key={`r${i}`} roof={br} H={H} on={false} solid={solid} hide={false} /> })}
      {cw.segments.map((g, i) => <Wall key={`cw${i}`} run={g.run} H={H} windows={g.windows} chosen={null} crossers={NONE} bands={[]} onPick={() => {}} join={joins.get(g.run.index)} />)}
      {runs.filter((run) => !cw.replaced.has(run.index)).map((run) => <Wall key={run.index} join={joins.get(run.index)} run={run} H={H} windows={placed.filter((w) => w.wall === run.index)} chosen={null} crossers={NONE} bands={[]} onPick={() => {}} />)}
    </group>
  )
}
const NONE = new Set<string>()
/** A floor's walls in order round each block, a curve's segments in place of its facets. */
function ordered(runs: readonly WallRun[], cw: { replaced: Set<number>; segments: Array<{ run: WallRun }> }): Array<{ run: WallRun }> {
  const out: Array<{ run: WallRun }> = []
  let s = 0
  for (const run of runs) {
    if (!cw.replaced.has(run.index)) { out.push({ run }); continue }
    // The first facet of a curve brings in its segments (in order), the rest of its facets nothing.
    const first = !cw.replaced.has(run.index - 1) || runs.find((r) => r.index === run.index - 1)?.block !== run.block
    if (!first) continue
    while (s < cw.segments.length && cw.segments[s]!.run.block === run.block) {
      out.push(cw.segments[s]!)
      s++
      const g = cw.segments[s - 1]!.run, next = cw.segments[s]?.run
      if (!next || Math.hypot(next.a[0] - g.b[0], next.a[1] - g.b[1]) > 1e-6) break
    }
  }
  return out
}
/** What a flat roof piece leaves out: the floor above, and (for a floor's flat rest) its pitched parts. */
const restCut = (p: RoofPiece, all: readonly RoofPiece[], above?: PlanFloor): XY[][] => [...(above?.blocks ?? []), ...(p.rest ? all.filter((q) => q.block === p.block && !q.rest).map((q) => q.ring) : [])]

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

/** Where a wall's inside face starts and ends against its neighbours: e = T·tan(turn / 2), positive at an outside
 * corner (the inside face is shorter), negative at an inside one. */
type Join = { e0: number; e1: number }
const NO_JOIN: Join = { e0: 0, e1: 0 }
/** The joins of a floor's walls, each block's walls in order round it (a curve's segments in its facets' place). */
export function wallJoins(walls: ReadonlyArray<{ run: WallRun }>): Map<number, Join> {
  const out = new Map<number, Join>()
  const byBlock = new Map<number, WallRun[]>()
  for (const { run } of walls) byBlock.set(run.block, [...(byBlock.get(run.block) ?? []), run])
  for (const list of byBlock.values()) {
    const n = list.length
    const dir = list.map((r) => Math.atan2(r.b[1] - r.a[1], r.b[0] - r.a[0]))
    const e = list.map((r, i) => {
      // Only where this wall's end meets the next one's start.
      const nx = list[(i + 1) % n]!
      if (Math.hypot(nx.a[0] - r.b[0], nx.a[1] - r.b[1]) > 1e-3) return 0
      const turn = ((dir[(i + 1) % n]! - dir[i]! + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
      return Math.abs(turn) > 3 ? 0 : WALL_T * Math.tan(turn / 2)
    })
    list.forEach((r, i) => out.set(r.index, { e0: e[(i + n - 1) % n]!, e1: e[i]! }))
  }
  return out
}

/** A wall piece whose inside face runs from xi0 to xi1 (its outside face from x0 to x1): a mitred end. */
function Mitred({ x0, x1, xi0, xi1, y0, y1, z0, z1, colour, rough = 0.9 }: { x0: number; x1: number; xi0: number; xi1: number; y0: number; y1: number; z0: number; z1: number; colour: string; rough?: number }) {
  const g = useMemo(() => {
    // Outside face at z1, inside at z0; eight corners, six faces.
    const P = [[x0, y0, z1], [x1, y0, z1], [xi1, y0, z0], [xi0, y0, z0], [x0, y1, z1], [x1, y1, z1], [xi1, y1, z0], [xi0, y1, z0]]
    const F = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0]]
    const pos: number[] = []
    for (const [a, b, c, d] of F) pos.push(...P[a]!, ...P[b]!, ...P[c]!, ...P[a]!, ...P[c]!, ...P[d]!)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.computeVertexNormals()
    return geo
  }, [x0, x1, xi0, xi1, y0, y1, z0, z1])
  if (y1 - y0 < 1e-4) return null
  return (
    <mesh geometry={g} castShadow receiveShadow>
      <meshStandardMaterial color={colour} roughness={rough} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** Box in a wall group's frame: x from x0 to x1 along, y from y0 to y1 up, z from z0 to z1 (out is +). */
function Box({ x0, x1, y0, y1, z0, z1, colour, rough = 0.9, op = 1 }: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; colour: string; rough?: number; op?: number }) {
  if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return null
  return (
    <mesh position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} castShadow={op === 1} receiveShadow>
      <boxGeometry args={[x1 - x0, y1 - y0, z1 - z0]} />
      <meshStandardMaterial color={colour} roughness={rough} metalness={rough < 0.8 ? 0.05 : 0} transparent={op < 1} opacity={op} depthWrite={op === 1} />
    </mesh>
  )
}

function Wall({ run, H, windows, chosen, crossers, bands, onPick, join = NO_JOIN }: { run: WallRun; H: number; windows: PlacedWindow[]; chosen: Span | null; crossers: Set<string>; bands: Band[]; onPick: (t: number) => void; join?: Join }) {
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
  // 18 Nov 2026 (Linzie: walls of one thickness that follow round the corners): a piece at either end of the wall is
  // mitred, its inside face cut back (an outside corner) or carried on (an inside corner) to meet the next wall's.
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!.props as { x0: number; x1: number }
    if (!p || (Math.abs(p.x0) > 1e-6 && Math.abs(p.x1 - L) > 1e-6)) continue
    const e0 = Math.abs(p.x0) <= 1e-6 ? join.e0 : 0, e1 = Math.abs(p.x1 - L) <= 1e-6 ? join.e1 : 0
    if (e0 || e1) pieces[i] = <Mitred key={`m${i}`} {...(pieces[i]!.props as Parameters<typeof Mitred>[0])} xi0={p.x0 + e0} xi1={p.x1 - e1} />
  }

  return (
    <group position={pos} rotation={rot} onClick={click} onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = '' }}>
      {pieces}
      {ws.map((w, i) => <Window key={i} w={w} bad={crossers.has(w.set)} />)}
      {bands.map((b, i) => <Box key={`band${i}`} x0={b.t0} x1={b.t1} y0={0} y1={0.25} z0={0} z1={0.012} colour={b.colour} />)}
      {chosen && (
        <>
          {/* Linzie, 17 Nov 10:29: as obvious as in plan. The chosen piece washed orange on its outside face, with a solid edge. */}
          <Box x0={chosen.t0} x1={chosen.t1} y0={0} y1={H} z0={0.002} z1={0.02} colour={C.select} rough={0.7} op={0.55} />
          <Box x0={chosen.t0} x1={chosen.t1} y0={H - 0.12} y1={H} z0={0} z1={0.04} colour={C.select} rough={0.6} />
          <Box x0={chosen.t0} x1={chosen.t1} y0={0} y1={0.12} z0={0} z1={0.04} colour={C.select} rough={0.6} />
          <Box x0={chosen.t0} x1={chosen.t0 + 0.12} y0={0} y1={H} z0={0} z1={0.04} colour={C.select} rough={0.6} />
          <Box x0={chosen.t1 - 0.12} x1={chosen.t1} y0={0} y1={H} z0={0} z1={0.04} colour={C.select} rough={0.6} />
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
