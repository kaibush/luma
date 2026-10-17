import { useEffect, useRef, useState } from 'react'
import { Minimize } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Docked to an edge so restoring the toolbar takes very little desktop space. */
export function ImmersiveHandle({ onRestore }: { onRestore: () => void }) {
  const [dock, setDock] = useState({ side: 'right', y: 0.5 })
  const [active, setActive] = useState(true)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{
    id: number
    x: number
    y: number
    moved: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  useEffect(() => {
    setActive(true)
    if (dragging) return
    const timer = window.setTimeout(() => setActive(false), 2500)
    return () => window.clearTimeout(timer)
  }, [dock, dragging])
  return (
    <Button
      variant='secondary'
      size='icon'
      className='remote-tool-handle'
      aria-label='显示工具'
      title='显示工具；按住可拖到屏幕另一侧'
      data-active={active || dragging}
      style={{
        [dock.side]: 0,
        top: `calc((100% - 48px) * ${dock.y})`,
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        gesture.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          moved: false,
        }
        suppressClick.current = false
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const g = gesture.current
        if (!g || g.id !== e.pointerId) return
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6) g.moved = true
        if (!g.moved) return
        const rect = e.currentTarget.parentElement!.getBoundingClientRect()
        setDock({
          side: e.clientX - rect.left < rect.width / 2 ? 'left' : 'right',
          y: Math.max(
            0,
            Math.min(
              1,
              (e.clientY - rect.top - 24) / Math.max(1, rect.height - 48)
            )
          ),
        })
      }}
      onPointerUp={(e) => {
        const g = gesture.current
        if (!g || g.id !== e.pointerId) return
        suppressClick.current = g.moved
        gesture.current = null
        setDragging(false)
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        suppressClick.current = true
        gesture.current = null
        setDragging(false)
      }}
      onLostPointerCapture={() => {
        if (gesture.current) {
          suppressClick.current = true
          gesture.current = null
          setDragging(false)
        }
      }}
      onClick={(e) => {
        if (suppressClick.current && e.detail !== 0) return
        onRestore()
      }}
    >
      <Minimize />
    </Button>
  )
}
