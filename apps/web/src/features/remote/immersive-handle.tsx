import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Docked to an edge so restoring the toolbar takes very little desktop space. */
export function ImmersiveHandle({
  onRestore,
  onKeyboard,
  onLeave,
  leaveLabel = '结束会话',
}: {
  onRestore: () => void
  onKeyboard?: () => void
  onLeave?: () => void
  leaveLabel?: string
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => setOpen(false), 6000)
    return () => window.clearTimeout(timer)
  }, [open])
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
    <>
      <Button
        variant='secondary'
        size='icon'
        className='remote-tool-handle'
        aria-label='显示工具'
        title='显示工具；按住可拖到屏幕另一侧'
        data-active={active || dragging || open}
        aria-expanded={open}
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
          setOpen(false)
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
          setOpen((value) => !value)
        }}
      >
        <MoreHorizontal />
      </Button>
      {open && (
        <div
          role='group'
          aria-label='沉浸模式菜单'
          className='absolute z-30 flex max-h-[calc(100%-1rem)] w-36 flex-col gap-1 overflow-auto rounded-xl border bg-background/95 p-2 text-foreground shadow-lg'
          style={{
            [dock.side]: 36,
            top: `max(8px, calc((100% - 220px) * ${dock.y}))`,
          }}
        >
          {onKeyboard && (
            <Button
              variant='ghost'
              onClick={() => {
                setOpen(false)
                onKeyboard()
              }}
            >
              键盘
            </Button>
          )}
          <Button
            variant='ghost'
            onClick={() => {
              setOpen(false)
              onRestore()
            }}
          >
            退出全屏
          </Button>
          {onLeave && (
            <Button
              variant='ghost'
              onClick={() => {
                setOpen(false)
                onLeave()
              }}
            >
              {leaveLabel}
            </Button>
          )}
          <Button variant='ghost' onClick={() => setOpen(false)}>
            收起菜单
          </Button>
        </div>
      )}
    </>
  )
}
