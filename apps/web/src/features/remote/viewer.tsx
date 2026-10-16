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
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, sendSignal, signaling } from './api'
import { RemotePeer, type Telemetry } from './peer'

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
  const [keyboard, setKeyboard] = useState(false),
    [text, setText] = useState('')
  const activePointer = useRef<number | null>(null),
    lastPoint = useRef({ x: 0.5, y: 0.5 }),
    pendingMove = useRef<InputEvent | null>(null),
    raf = useRef(0)
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
  const fullscreen = async () => {
    try {
      if (!document.fullscreenElement)
        await container.current?.requestFullscreen()
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (value: string) => Promise<void>
      }
      await orientation.lock?.('landscape').catch(() => {})
    } catch {
      setError('此浏览器不支持页面全屏，请旋转手机并收起浏览器工具栏')
    }
  }
  return createPortal(
    <div
      ref={container}
      className='remote-viewer bg-background text-foreground'
    >
      <header className='flex min-h-12 items-center justify-between gap-2 border-b px-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <Button
            variant='ghost'
            size='icon'
            aria-label='结束会话并返回'
            onClick={onExit}
          >
            <ArrowLeft />
          </Button>
          <span className='truncate text-sm font-medium'>{host.name}</span>
          <Badge variant='secondary'>
            {state === 'connected' ? '已连接' : state}
          </Badge>
        </div>
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <span className='hidden sm:inline'>
            {stats.transport ?? '协商中'} ·{' '}
            {stats.rttMs === undefined ? '—' : Math.round(stats.rttMs)} ms RTT
          </span>
          <Button
            variant='outline'
            size='icon'
            aria-label='横屏全屏'
            onClick={() => void fullscreen()}
          >
            <Expand />
          </Button>
        </div>
      </header>
      <div
        className='remote-stage bg-muted'
        onContextMenu={(e) => e.preventDefault()}
      >
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          tabIndex={0}
          aria-label='远程桌面，触摸可发送测试输入'
          className='size-full touch-none object-contain outline-none'
          onClick={() => {
            void video.current
              ?.play()
              .then(() => setError(''))
              .catch(() => {})
          }}
          onBlur={() => send({ type: 'release-all' })}
          onPointerDown={(e) => {
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
            if (
              activePointer.current !== null &&
              activePointer.current !== e.pointerId
            )
              return
            const p = point(e)
            if (!p) return
            lastPoint.current = p
            pendingMove.current = { type: 'move', ...p }
            if (!raf.current)
              raf.current = requestAnimationFrame(() => {
                raf.current = 0
                if (pendingMove.current) send(pendingMove.current)
                pendingMove.current = null
              })
          }}
          onPointerUp={(e) => {
            if (activePointer.current !== e.pointerId) return
            send({
              type: 'button',
              button: e.button === 2 ? 'right' : 'left',
              down: false,
              ...(point(e) || lastPoint.current),
            })
            activePointer.current = null
          }}
          onPointerCancel={() => {
            send({ type: 'release-all' })
            activePointer.current = null
          }}
          onLostPointerCapture={() => {
            send({ type: 'release-all' })
            activePointer.current = null
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
      {keyboard && (
        <form
          className='flex gap-2 border-t p-2'
          onSubmit={(e) => {
            e.preventDefault()
            if (
              host.capabilities.textInput === 'ascii' &&
              /[^\x20-\x7e\n]/.test(text)
            ) {
              setError('此主机暂仅支持英文、数字和符号文本；中文输入尚未接入')
              return
            }
            if (text) send({ type: 'text', text })
            setText('')
          }}
        >
          <Input
            aria-label='发送文本'
            placeholder={
              host.capabilities.systemInput
                ? '输入英文或数字（暂不支持中文文本提交）'
                : '输入文字（浏览器主机只在测试面板显示）'
            }
            value={text}
            maxLength={2048}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type='submit'>发送</Button>
        </form>
      )}
      <footer className='flex flex-wrap items-center justify-between gap-2 border-t p-2'>
        <div className='flex items-center gap-1'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setKeyboard(!keyboard)}
          >
            <Keyboard />
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
            <MousePointer2 />
            右键
          </Button>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              send({ type: 'key', code: 'Escape', down: true })
              send({ type: 'key', code: 'Escape', down: false })
            }}
          >
            Esc
          </Button>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => send({ type: 'release-all' })}
          >
            <RotateCw />
            释放按键
          </Button>
        </div>
        <span className='text-xs text-muted-foreground'>
          {stats.fps ?? '—'} FPS · {stats.mbps?.toFixed(1) ?? '—'} Mbps ·{' '}
          {stats.width ? `${stats.width}×${stats.height}` : '—'}{' '}
          <span className='hidden md:inline'>
            ·{' '}
            {host.capabilities.systemInput
              ? 'Linux 桌面控制'
              : '浏览器共享 / 输入测试'}
          </span>
        </span>
      </footer>
    </div>,
    document.body
  )
}
