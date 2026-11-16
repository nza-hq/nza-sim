/**
 * A vertical drag handle between two panes; calls onResize(dx) for every pixel dragged.
 *
 * Provenance: copied from frontend/src/components/modules/building/BuildingDefinition.jsx ResizeHandle (lines 101–131
 * at cd7b440), behaviour and classes unchanged. Copied, not imported, because that function is not exported and Brief
 * 110 does not touch the Building module.
 */
import { useCallback, useRef } from 'react'

export default function ResizeHandle({ onResize }: { onResize: (dx: number) => void }) {
  const startX = useRef<number | null>(null)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    startX.current = e.clientX
    const onMove = (ev: MouseEvent) => {
      if (startX.current == null) return
      const dx = ev.clientX - startX.current
      startX.current = ev.clientX
      onResize(dx)
    }
    const onUp = () => {
      startX.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onResize])

  return (
    <div
      className="w-1 flex-shrink-0 cursor-col-resize bg-light-grey/0 hover:bg-teal/40 active:bg-teal/60 transition-colors relative group"
      onMouseDown={handleMouseDown}
      title="Drag to resize"
      role="separator"
      aria-orientation="vertical"
    >
      <div className="absolute inset-y-0 -inset-x-1.5" />
    </div>
  )
}
