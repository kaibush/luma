import { useEffect, useRef, useState } from 'react'
import {
  mapPoint,
  type Host,
  type IceServer,
  type InputEvent,
  type Session,
} from '@remote/protocol'
import {
  ArrowLeft,
  Expand,
  Keyboard,
  MousePointer2,
  RotateCw,
  Hand,
  MoreHorizontal,
  Minimize,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api, sendSignal, signaling } from './api'
import { canFullscreen, enterDisplayMode } from './display-mode'
import { RemotePeer, type Telemetry } from './peer'
import { RemoteKeyboard, sendChord } from './remote-keyboard'
import { moveTouch, isTap, type TouchGesture } from './touchpad'

export function Viewer({
  host,
  session,
  iceServers,
  token,
  onExit,
}: {
  host: Host
  session: Session
  iceServers: IceServer[]
  token: string
  onExit: () => void
}) {
  const container = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null),
    peer = useRef<RemotePeer | null>(null)
  const [state, setState] = useState('准备连接'),
    [stats, setStats] = useState<Telemetry>({}),
    [error, setError] = useState('')
  const [panel, setPanel] = useState<'keyboard' | 'more' | null>(null)
  const [immersive, setImmersive] = useState(false)
  const [nativeFullscreen, setNativeFullscreen] = useState(false)
  const [supportsFullscreen, setSupportsFullscreen] = useState(false)
  const [displayHint, setDisplayHint] = useState('')
  useEffect(() => {
    if (!displayHint) return
    const timer = window.setTimeout(() => setDisplayHint(''), 3000)
    return () => window.clearTimeout(timer)
  }, [displayHint])
  const [touchpad, setTouchpad] = useState(false)
  const gesture = useRef<TouchGesture | null>(null)
  const activePointer = useRef<number | null>(null),
    lastPoint = useRef({ x: 0.5, y: 0.5 }),
    pendingMove = useRef<InputEvent | null>(null),
    raf = useRef(0)
  useEffect(() => {
    const element = container.current!
    setSupportsFullscreen(canFullscreen(element))
    const updateFullscreen = () => {
      setNativeFullscreen(!!document.fullscreenElement)
      if (!document.fullscreenElement) setImmersive(false)
    }
    const viewport = window.visualViewport
    const resize = () => {
      if (!viewport) return
      element.style.height = `${viewport.height}px`
      element.style.top = `${viewport.offsetTop}px`
      element.style.left = `${viewport.offsetLeft}px`
    }
    resize()
    window.addEventListener('resize', resize)
    viewport?.addEventListener('resize', resize)
    viewport?.addEventListener('scroll', resize)
    document.addEventListener('fullscreenchange', updateFullscreen)
    return () => {
      window.removeEventListener('resize', resize)
      viewport?.removeEventListener('resize', resize)
      viewport?.removeEventListener('scroll', resize)
      document.removeEventListener('fullscreenchange', updateFullscreen)
    }
  }, [])
  useEffect(() => {
    const start = () => {
      let disposed = false
      const ws = signaling(
        { role: 'controller', token, sessionId: session.id },
        (message) => {
          if (disposed) return
          if (message.type === 'ready')
            void connection
              .offer()
              .catch(() => setError('协商失败，请重新连接'))
          else if (message.type === 'ended' || message.type === 'error') {
            setError(
              message.type === 'ended' ? message.reason : message.message
            )
            connection.close()
          } else if (['offer', 'answer', 'ice'].includes(message.type))
            void connection.handle(
              message as Parameters<RemotePeer['handle']>[0]
            )
        },
        () => {
          if (!disposed) {
            setState('已断开')
            setError('连接已断开，请返回主机列表重试')
            connection.close()
          }
        }
      )
      const connection = new RemotePeer({
        role: 'controller',
        iceServers,
        quality: session.quality,
        signal: (m) => sendSignal(ws, { ...m, sessionId: session.id }),
        onStream: (stream) => {
          if (video.current) {
            video.current.srcObject = stream
            void video.current
              .play()
              .catch(() => setError('点击画面以开始播放'))
          }
        },
        onState: (s) => {
          if (!disposed) {
            setState(s)
            if (s === 'failed') setError('连接失败，请检查网络或 TURN 配置')
            if (s === 'connected') setError('')
          }
        },
        onStats: (s) => {
          if (!disposed) setStats(s)
        },
      })
      peer.current = connection
      const timeout = setTimeout(() => {
        if (connection.pc.connectionState !== 'connected') {
          setError('连接超时，请检查主机与网络；跨网络可能需要 TURN')
          connection.close()
          ws.close()
        }
      }, 25_000)
      const release = () => {
        connection.sendInput({ type: 'release-all' })
        activePointer.current = null
        gesture.current = null
        cancelAnimationFrame(raf.current)
        raf.current = 0
        pendingMove.current = null
      }
      const key = (e: KeyboardEvent) => {
        if (
          document.activeElement !== video.current ||
          e.isComposing ||
          e.repeat
        )
          return
        if (e.code === 'Escape') return // Keep browser exit-fullscreen available.
        e.preventDefault()
        connection.sendInput({
          type: 'key',
          code: e.code,
          down: e.type === 'keydown',
        })
      }
      document.addEventListener('visibilitychange', release)
      window.addEventListener('blur', release)
      window.addEventListener('keydown', key)
      window.addEventListener('keyup', key)
      const original = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        disposed = true
        clearTimeout(timeout)
        cancelAnimationFrame(raf.current)
        connection.close()
        sendSignal(ws, { type: 'end', sessionId: session.id })
        ws.close()
        peer.current = null
        void api(`/sessions/${session.id}`, token, { method: 'DELETE' }).catch(
          () => {}
        )
        document.removeEventListener('visibilitychange', release)
        window.removeEventListener('blur', release)
        window.removeEventListener('keydown', key)
        window.removeEventListener('keyup', key)
        document.body.style.overflow = original
      }
    }
    let cleanup: (() => void) | undefined
    const startTimer = setTimeout(() => {
      cleanup = start()
    }, 0)
    return () => {
      clearTimeout(startTimer)
      cleanup?.()
    }
  }, [session, iceServers, token])
  const send = (e: InputEvent) => peer.current?.sendInput(e)
  const point = (e: { clientX: number; clientY: number }) => {
    const v = video.current
    return (
      v &&
      mapPoint(
        e.clientX,
        e.clientY,
        v.getBoundingClientRect(),
        v.videoWidth,
        v.videoHeight
      )
    )
  }
  const releasePointer = () => {
    send({ type: 'release-all' })
    activePointer.current = null
    gesture.current = null
    cancelAnimationFrame(raf.current)
    raf.current = 0
    pendingMove.current = null
  }
  const queueMove = () => {
    pendingMove.current = { type: 'move', ...lastPoint.current }
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0
        if (pendingMove.current) send(pendingMove.current)
        pendingMove.current = null
      })
  }
  const moveFinger = (e: { clientX: number; clientY: number }) => {
    const v = video.current,
      g = gesture.current
    if (!v || !g || !v.videoWidth || !v.videoHeight) return
    const rect = v.getBoundingClientRect()
    const scale = Math.min(
      rect.width / v.videoWidth,
      rect.height / v.videoHeight
    )
    lastPoint.current = moveTouch(
      g,
      { x: e.clientX, y: e.clientY },
      lastPoint.current,
      v.videoWidth * scale,
      v.videoHeight * scale
    )
    if (g.moved) queueMove()
  }
  const fullscreen = async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        /* Restore tools even if browser refuses. */
      }
      setImmersive(false)
      return
    }
    releasePointer()
    setPanel(null)
    const result = await enterDisplayMode(container.current!)
    setImmersive(true)
    setDisplayHint(
      result === 'immersive' ? '已进入沉浸模式，点「显示工具」可恢复。' : ''
    )
  }
  const openPanel = (next: 'keyboard' | 'more') => {
    releasePointer()
    setPanel(panel === next ? null : next)
  }
  const exit = () => {
    releasePointer()
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {})
    onExit()
  }
  return createPortal(
    <div
      ref={container}
      className='remote-viewer bg-background text-foreground'
      data-panel={immersive ? undefined : (panel ?? undefined)}
    >
      {!immersive && (
        <header className='flex min-h-12 shrink-0 items-center justify-between gap-2 border-b px-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <Button
              variant='ghost'
              size='sm'
              aria-label='结束会话并返回'
              onClick={exit}
            >
              <ArrowLeft data-icon='inline-start' />
              返回
            </Button>
            <span className='truncate text-sm font-medium'>{host.name}</span>
            <Badge variant='secondary'>
              {state === 'connected'
                ? '已连接'
                : state === '准备连接'
                  ? '连接中'
                  : state === 'disconnected' || state === 'closed'
                    ? '已断开'
                    : state === 'failed'
                      ? '连接失败'
                      : '连接中'}
            </Badge>
          </div>
          <Button
            variant='outline'
            size='sm'
            aria-label={
              nativeFullscreen
                ? '退出全屏'
                : supportsFullscreen
                  ? '横屏全屏'
                  : '沉浸模式'
            }
            onClick={() => void fullscreen()}
          >
            {nativeFullscreen ? (
              <Minimize data-icon='inline-start' />
            ) : (
              <Expand data-icon='inline-start' />
            )}
            {nativeFullscreen
              ? '退出全屏'
              : supportsFullscreen
                ? '全屏'
                : '沉浸'}
          </Button>
        </header>
      )}
      <div
        className='remote-stage bg-muted'
        onContextMenu={(e) => e.preventDefault()}
      >
        {immersive && (
          <div className='pointer-events-none absolute end-2 top-2 z-10 flex max-w-[85%] flex-col items-end gap-2'>
            <Button
              variant='secondary'
              size='sm'
              className='pointer-events-auto'
              onClick={() => {
                setImmersive(false)
                setDisplayHint('')
              }}
            >
              <Minimize data-icon='inline-start' />
              显示工具
            </Button>
            {displayHint && (
              <Alert role='status' className='pointer-events-none max-w-xs'>
                <AlertDescription>{displayHint}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          tabIndex={0}
          aria-label={
            touchpad
              ? '远程桌面，滑动移动鼠标，轻点单击'
              : '远程桌面，直接触摸控制'
          }
          className='size-full touch-none object-contain outline-none'
          onClick={() => {
            void video.current
              ?.play()
              .then(() => setError(''))
              .catch(() => {})
          }}
          onBlur={releasePointer}
          onPointerDown={(e) => {
            if (touchpad && e.pointerType === 'touch') {
              e.preventDefault()
              if (activePointer.current !== null) {
                releasePointer()
                return
              }
              e.currentTarget.focus()
              e.currentTarget.setPointerCapture(e.pointerId)
              activePointer.current = e.pointerId
              const finger = { x: e.clientX, y: e.clientY }
              gesture.current = {
                id: e.pointerId,
                start: finger,
                previous: finger,
                startedAt: performance.now(),
                moved: false,
              }
              return
            }
            if (![0, 2].includes(e.button) || activePointer.current !== null)
              return
            const p = point(e)
            if (!p) return
            e.preventDefault()
            e.currentTarget.focus()
            e.currentTarget.setPointerCapture(e.pointerId)
            activePointer.current = e.pointerId
            lastPoint.current = p
            send({
              type: 'button',
              button: e.button === 2 ? 'right' : 'left',
              down: true,
              ...p,
            })
          }}
          onPointerMove={(e) => {
            if (touchpad && e.pointerType === 'touch') {
              if (gesture.current?.id === e.pointerId) {
                e.preventDefault()
                moveFinger(e)
              }
              return
            }
            if (
              activePointer.current !== null &&
              activePointer.current !== e.pointerId
            )
              return
            const p = point(e)
            if (!p) return
            lastPoint.current = p
            queueMove()
          }}
          onPointerUp={(e) => {
            if (touchpad && e.pointerType === 'touch') {
              if (gesture.current?.id !== e.pointerId) return
              e.preventDefault()
              moveFinger(e)
              if (isTap(gesture.current, performance.now())) {
                send({
                  type: 'button',
                  button: 'left',
                  down: true,
                  ...lastPoint.current,
                })
                send({
                  type: 'button',
                  button: 'left',
                  down: false,
                  ...lastPoint.current,
                })
              }
              gesture.current = null
              activePointer.current = null
              return
            }
            if (activePointer.current !== e.pointerId) return
            send({
              type: 'button',
              button: e.button === 2 ? 'right' : 'left',
              down: false,
              ...(point(e) || lastPoint.current),
            })
            activePointer.current = null
          }}
          onPointerCancel={releasePointer}
          onLostPointerCapture={() => {
            if (activePointer.current !== null) releasePointer()
          }}
          onWheel={(e) => {
            const unit =
              e.deltaMode === 1
                ? 16
                : e.deltaMode === 2
                  ? e.currentTarget.clientHeight
                  : 1
            send({
              type: 'wheel',
              dx: Math.max(-2000, Math.min(2000, e.deltaX * unit)),
              dy: Math.max(-2000, Math.min(2000, e.deltaY * unit)),
            })
          }}
        />
        {state !== 'connected' && (
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground'>
            {error || '正在建立安全视频连接…'}
          </div>
        )}
      </div>
      {error && (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!immersive && panel === 'keyboard' && (
        <RemoteKeyboard
          send={send}
          asciiOnly={host.capabilities.textInput === 'ascii'}
          onClose={() => {
            releasePointer()
            setPanel(null)
          }}
        />
      )}
      {!immersive && panel === 'more' && (
        <section
          className='remote-panel border-t bg-background'
          aria-label='更多工具'
        >
          <div className='flex items-center justify-between'>
            <h2 className='font-medium'>操作与连接</h2>
            <Button
              variant='ghost'
              size='icon'
              aria-label='关闭更多工具'
              onClick={() => setPanel(null)}
            >
              <X />
            </Button>
          </div>
          <p className='mb-2 text-sm text-muted-foreground'>
            {touchpad
              ? '触控板：滑动移动光标，在任意位置轻点单击、连点双击。'
              : '直接触控：点哪里，鼠标就点哪里；按住移动可拖拽。'}
          </p>
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => sendChord(send, ['Escape'])}
            >
              Esc
            </Button>
            <Button variant='outline' size='sm' onClick={releasePointer}>
              <RotateCw data-icon='inline-start' />
              释放所有按键
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => send({ type: 'wheel', dx: 0, dy: -400 })}
            >
              向上滚动
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => send({ type: 'wheel', dx: 0, dy: 400 })}
            >
              向下滚动
            </Button>
          </div>
          <p className='mt-3 text-xs text-muted-foreground'>
            {stats.transport ?? '正在检测连接'} · {stats.fps ?? '—'} FPS ·{' '}
            {stats.mbps?.toFixed(1) ?? '—'} Mbps ·{' '}
            {stats.rttMs === undefined ? '—' : Math.round(stats.rttMs)} ms RTT ·{' '}
            {stats.width ? `${stats.width}×${stats.height}` : '—'} ·{' '}
            {host.capabilities.systemInput
              ? '系统桌面控制'
              : '浏览器共享 / 输入测试'}
          </p>
          <Alert className='mt-3'>
            <AlertDescription>
              iPhone
              浏览器的全屏能力由系统限制。可以使用「沉浸」隐藏页面工具栏，再手动横屏。想减少浏览器栏遮挡，可在
              Safari 打开本站，点分享 → 添加到主屏幕（如有「作为 Web App
              打开」，请开启），再从主屏幕图标进入。
            </AlertDescription>
          </Alert>
        </section>
      )}
      {!immersive && (
        <footer className='shrink-0 border-t bg-background px-2 py-1'>
          <div className='grid grid-cols-4 gap-1'>
            <Button
              variant={touchpad ? 'secondary' : 'ghost'}
              size='sm'
              aria-label='触控板模式'
              aria-pressed={touchpad}
              onClick={() => {
                releasePointer()
                setTouchpad(!touchpad)
              }}
            >
              <Hand data-icon='inline-start' />
              {touchpad ? '触控板' : '直接触控'}
            </Button>
            <Button
              variant={panel === 'keyboard' ? 'secondary' : 'ghost'}
              size='sm'
              aria-expanded={panel === 'keyboard'}
              onClick={() => openPanel('keyboard')}
            >
              <Keyboard data-icon='inline-start' />
              键盘
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                send({
                  type: 'button',
                  button: 'right',
                  down: true,
                  ...lastPoint.current,
                })
                send({
                  type: 'button',
                  button: 'right',
                  down: false,
                  ...lastPoint.current,
                })
              }}
            >
              <MousePointer2 data-icon='inline-start' />
              右键
            </Button>
            <Button
              variant={panel === 'more' ? 'secondary' : 'ghost'}
              size='sm'
              aria-expanded={panel === 'more'}
              onClick={() => openPanel('more')}
            >
              <MoreHorizontal data-icon='inline-start' />
              更多
            </Button>
          </div>
          <p className='text-center text-xs text-muted-foreground'>
            {touchpad
              ? '滑动移动 · 轻点单击 · 连点双击'
              : '点哪里就操作哪里 · 按住可拖拽 · 点左侧切换触控板'}
          </p>
        </footer>
      )}
    </div>,
    document.body
  )
}
