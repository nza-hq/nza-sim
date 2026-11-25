/**
 * decodED's room labels in 3D (twin/app/inside/scene.ts placeLabels, Brief 261): each room's name with its m² under
 * it; a room whose label would sit over another's, or not fit in the room on screen, becomes a small dot (its name
 * shows on pointing at it). The chosen rooms first, so they always show, then the biggest. `dots`: every room a dot
 * (decodED does this with every floor stacked).
 *
 * Mount inside a <Canvas>: it lays plain HTML over the canvas and places it each frame.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { XY } from '../plan'
import { area, labelAt } from '../ported/zones'

export type LabelRoom = { id: string; name: string; ring: XY[]; y: number; on?: boolean }

const DOT_PX = 12

export default function RoomLabels({ rooms, dots = false }: { rooms: LabelRoom[]; dots?: boolean }) {
  const { gl, camera, size } = useThree()
  const host = useMemo(() => document.createElement('div'), [])
  const items = useMemo(() => rooms.map((r) => ({ ...r, at: labelAt(r.ring), m2: area(r.ring) })), [rooms])
  const els = useRef(new Map<string, HTMLDivElement>())
  const sizes = useRef(new Map<string, [number, number]>())
  const hoverRef = useRef<string | null>(null)
  const v = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => {
    const parent = gl.domElement.parentElement?.parentElement ?? gl.domElement.parentElement
    if (!parent) return
    host.className = 'sk-labels'
    parent.appendChild(host)
    return () => { host.remove() }
  }, [gl, host])
  // Plain HTML, built again when the rooms change (the canvas's own renderer cannot hold DOM).
  useEffect(() => {
    host.replaceChildren()
    els.current.clear()
    sizes.current.clear()
    for (const r of items) {
      const el = document.createElement('div')
      el.className = `sk-label${r.on ? ' on' : ''}`
      el.title = `${r.name}, ${Math.round(r.m2)} m²`
      const b = document.createElement('b'); b.textContent = r.name
      const s = document.createElement('span'); s.textContent = `${Math.round(r.m2)} m²`
      el.append(b, s)
      el.style.opacity = '0'
      el.addEventListener('pointerenter', () => { hoverRef.current = r.id })
      el.addEventListener('pointerleave', () => { if (hoverRef.current === r.id) hoverRef.current = null })
      host.appendChild(el)
      els.current.set(r.id, el)
    }
  }, [host, items])

  useFrame(() => {
    const hover = hoverRef.current
    const w = size.width
    const h = size.height
    const toScreen = (x: number, y: number, z: number) => { v.set(x, y, z).project(camera); return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, v.z] as const }
    const order = [...items].sort((a, b) => Number(!!b.on) - Number(!!a.on) || Number(b.id === hover) - Number(a.id === hover) || b.m2 - a.m2)
    const placed: Array<[number, number, number, number]> = []
    const over = (b: [number, number, number, number]) => placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1])
    for (const r of order) {
      const el = els.current.get(r.id)
      if (!el) continue
      const [sx, sy, sz] = toScreen(r.at[0], r.y, -r.at[1])
      if (sz > 1 || sx < -50 || sy < -50 || sx > w + 50 || sy > h + 50) { el.style.opacity = '0'; continue }
      // The room's width on screen, from its ring.
      let x0 = Infinity, x1 = -Infinity
      for (const p of r.ring) { const [px] = toScreen(p[0], r.y, -p[1]); x0 = Math.min(x0, px); x1 = Math.max(x1, px) }
      if (!sizes.current.has(r.id) && el.offsetWidth && !el.classList.contains('sk-dot')) sizes.current.set(r.id, [el.offsetWidth, el.offsetHeight])
      const full = sizes.current.get(r.id) ?? [80, 30]
      const named = r.on || r.id === hover
      let dot = dots && !named
      let box: [number, number, number, number] = [sx - full[0] / 2, sy - full[1] / 2, sx + full[0] / 2, sy + full[1] / 2]
      if (!dot && !named && (over(box) || full[0] > (x1 - x0) * 0.95)) dot = true
      if (dot) box = [sx - DOT_PX / 2, sy - DOT_PX / 2, sx + DOT_PX / 2, sy + DOT_PX / 2]
      const show = !over(box) || named
      el.classList.toggle('sk-dot', dot)
      el.style.transform = `translate(${Math.round(box[0])}px, ${Math.round(box[1])}px)`
      el.style.opacity = show ? '1' : '0'
      el.style.pointerEvents = show ? 'auto' : 'none'
      if (show) placed.push(box)
    }
  })

  return null
}
