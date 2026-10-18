import { useEffect, useRef, useState } from 'react'
import { mapPoint, type InputEvent } from '@remote/protocol'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { PasswordInput } from '@/components/password-input'
import { sendSignal } from '@/features/remote/api'
import { enterDisplayMode } from '@/features/remote/display-mode'
import { ImmersiveHandle } from '@/features/remote/immersive-handle'
import { RemotePeer, type Telemetry } from '@/features/remote/peer'
import { RemoteKeyboard } from '@/features/remote/remote-keyboard'
import { shareSocket } from './connection'

export function ShareViewer({ id }: { id: string }) {
  const [key, setKey] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('key') || ''
  )
  const [name, setName] = useState('屏幕共享'),
    [status, setStatus] = useState('输入分享码后连接远程画面'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false),
    [stats, setStats] = useState<Telemetry>({})
  const [canControl, setCanControl] = useState(false)
  const [keyboard, setKeyboard] = useState(false)
  const [immersive, setImmersive] = useState(false)
  const [displayHint, setDisplayHint] = useState('')
  const surface = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!displayHint) return
    const timer = window.setTimeout(() => setDisplayHint(''), 3000)
    return () => window.clearTimeout(timer)
  }, [displayHint])
  const [asciiOnly, setAsciiOnly] = useState(true)
  const pointer = useRef<{ id: number; button: 'left' | 'right' } | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const resource = useRef<{
    generation: number
    ws?: WebSocket
    peer?: RemotePeer
    timer?: ReturnType<typeof setTimeout>
  }>({ generation: 0 })
  const stop = () => {
    const r = resource.current
    r.peer?.sendInput({ type: 'release-all' })
    pointer.current = null
    r.generation++
    clearTimeout(r.timer)
    const ws = r.ws
    r.ws = undefined
    r.peer?.close()
    r.peer = undefined
    ws?.close()
    if (video.current) video.current.srcObject = null
  }
  const join = async (accessKey = key) => {
    stop()
    const r = resource.current,
      generation = r.generation
    setBusy(true)
    setConnected(false)
    setCanControl(false)
    setError('')
    setStatus('正在验证观看链接…')
    try {
      const response = await fetch(
        `/api/public/shares/${encodeURIComponent(id)}/join`,
        {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: accessKey }),
        }
      )
      const result = await response.json()
      if (r.generation !== generation) return
      if (!response.ok) throw new Error(result.error || '无法加入共享')
      setName(result.name)
      setStatus('正在连接共享画面…')
      const ws = shareSocket(
        { role: 'viewer', ticket: result.ticket },
        (message) => {
          if (r.generation !== generation) return
          if (message.type === 'session') {
            const control = message.session.readOnly === false
            setCanControl(control)
            setAsciiOnly(message.textInput !== 'unicode')
            r.peer = new RemotePeer({
              role: 'controller',
              readOnly: !control,
              quality: message.session.quality,
              iceServers: message.iceServers,
              signal: (signal) =>
                sendSignal(ws, { ...signal, sessionId: message.session.id }),
              onStream: (stream) => {
                if (video.current) {
                  video.current.srcObject = stream
                  void video.current
                    .play()
                    .catch(() => setStatus('点击画面开始播放'))
                }
              },
              onStats: (value) => {
                if (r.generation === generation) setStats(value)
              },
              onState: (state) => {
                if (r.generation !== generation) return
                if (state === 'connected') {
                  clearTimeout(r.timer)
                  setBusy(false)
                  setConnected(true)
                  setStatus(
                    control ? '已连接 · 允许控制' : '正在观看 · 只读共享'
                  )
                }
                if (state === 'failed') {
                  stop()
                  setBusy(false)
                  setConnected(false)
                  setError('视频连接失败，请重试')
                }
                if (state === 'disconnected')
                  setStatus('网络暂时中断，等待恢复…')
              },
            })
          } else if (message.type === 'ready')
            void r.peer?.offer().catch(() => {
              stop()
              setBusy(false)
              setError('连接协商失败，请重试')
            })
          else if (message.type === 'ended' || message.type === 'error') {
            stop()
            setConnected(false)
            setBusy(false)
            setError(
              message.type === 'ended' ? message.reason : message.message
            )
            setStatus('观看已结束')
          } else void r.peer?.handle(message)
        },
        () => {
          if (r.generation === generation) {
            stop()
            setBusy(false)
            setConnected(false)
            setError('共享已断开或链接已失效，请向共享者确认后重试')
          }
        }
      )
      r.ws = ws
      r.timer = setTimeout(() => {
        if (r.generation === generation) {
          stop()
          setBusy(false)
          setError('连接超时，请检查网络或稍后重试')
        }
      }, 30000)
    } catch (e) {
      if (r.generation === generation) {
        stop()
        setBusy(false)
        setError((e as Error).message)
      }
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      if (key) void join()
    }, 0)
    const changed = () => {
      const nextKey =
        new URLSearchParams(location.hash.slice(1)).get('key') || ''
      setKey(nextKey)
      void join(nextKey)
    }
    window.addEventListener('hashchange', changed)
    return () => {
      window.removeEventListener('hashchange', changed)
      clearTimeout(timer)
      stop()
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = (event: InputEvent) => {
    if (connected && canControl) resource.current.peer?.sendInput(event)
  }
  const release = () => {
    resource.current.peer?.sendInput({ type: 'release-all' })
    pointer.current = null
  }
  useEffect(() => {
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', release)
    return () => {
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', release)
    }
  }, [])
  const exitDisplay = () => {
    release()
    setImmersive(false)
    setDisplayHint('')
    setKeyboard(false)
    if (document.fullscreenElement === surface.current)
      void document.exitFullscreen().catch(() => {})
  }
  const enterDisplay = async () => {
    if (!surface.current) return
    release()
    setKeyboard(false)
    const generation = resource.current.generation
    const mode = await enterDisplayMode(surface.current)
    if (generation !== resource.current.generation) {
      if (document.fullscreenElement === surface.current)
        void document.exitFullscreen().catch(() => {})
      return
    }
    setImmersive(true)
    setDisplayHint(
      mode === 'immersive'
        ? '已进入沉浸模式，点边缘按钮打开菜单，按住可拖动；可手动横屏。'
        : ''
    )
  }
  useEffect(() => {
    if (!connected) exitDisplay()
  }, [connected]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!immersive) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const changed = () => {
      if (!document.fullscreenElement) exitDisplay()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') exitDisplay()
    }
    document.addEventListener('fullscreenchange', changed)
    window.addEventListener('keydown', escape)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('fullscreenchange', changed)
      window.removeEventListener('keydown', escape)
    }
  }, [immersive]) // eslint-disable-line react-hooks/exhaustive-deps
  const point = (x: number, y: number) => {
    const v = video.current
    return (
      v &&
      mapPoint(x, y, v.getBoundingClientRect(), v.videoWidth, v.videoHeight)
    )
  }
  return (
    <main
      ref={surface}
      data-display-mode={immersive ? 'immersive' : 'normal'}
      className={
        immersive
          ? 'fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground'
          : 'mx-auto flex max-w-6xl flex-col gap-4 p-4'
      }
    >
      <div
        hidden={immersive}
        className={
          immersive
            ? 'hidden'
            : 'flex flex-wrap items-center justify-between gap-3'
        }
      >
        <h1 className='text-xl font-semibold'>{name}</h1>
        <span className='text-sm' role='status'>
          {status}
        </span>
      </div>
      {!connected && (
        <form
          className='flex flex-col gap-3'
          onSubmit={(e) => {
            e.preventDefault()
            void join()
          }}
        >
          <Field>
            <FieldLabel htmlFor='view-key'>分享码</FieldLabel>
            <PasswordInput
              id='view-key'
              visibilityLabel='分享码'
              autoComplete='off'
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              maxLength={128}
            />
          </Field>
          <Button disabled={busy}>
            {busy ? '正在连接…' : '开始观看 / 重试'}
          </Button>
        </form>
      )}
      {error && (
        <Alert variant='destructive' role='alert'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div
        className={
          immersive
            ? 'relative min-h-0 flex-1 overflow-hidden bg-black'
            : 'relative overflow-hidden rounded-xl bg-muted'
        }
      >
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          controls={!canControl && !immersive}
          tabIndex={canControl ? 0 : undefined}
          aria-label='共享远程画面'
          style={{ touchAction: canControl ? 'none' : 'auto' }}
          onContextMenu={(e) => {
            if (canControl) e.preventDefault()
          }}
          onPointerDown={(e) => {
            if (!canControl || pointer.current) return
            const p = point(e.clientX, e.clientY)
            if (!p) return
            e.preventDefault()
            e.currentTarget.focus()
            e.currentTarget.setPointerCapture(e.pointerId)
            const button = e.button === 2 ? 'right' : 'left'
            pointer.current = { id: e.pointerId, button }
            send({ type: 'button', down: true, button, ...p })
          }}
          onPointerMove={(e) => {
            if (
              !canControl ||
              (pointer.current && pointer.current.id !== e.pointerId)
            )
              return
            const p = point(e.clientX, e.clientY)
            if (p) send({ type: 'move', ...p })
          }}
          onPointerUp={(e) => {
            if (pointer.current?.id !== e.pointerId) return
            const p = point(e.clientX, e.clientY)
            if (p)
              send({
                type: 'button',
                down: false,
                button: pointer.current.button,
                ...p,
              })
            release()
          }}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onBlur={release}
          onWheel={(e) => {
            if (canControl)
              send({
                type: 'wheel',
                dx: Math.max(-2000, Math.min(2000, e.deltaX)),
                dy: Math.max(-2000, Math.min(2000, e.deltaY)),
              })
          }}
          onKeyDown={(e) => {
            if (
              canControl &&
              !e.repeat &&
              !e.nativeEvent.isComposing &&
              e.code !== 'Escape'
            ) {
              e.preventDefault()
              send({ type: 'key', code: e.code, down: true })
            }
          }}
          onKeyUp={(e) => {
            if (canControl && e.code !== 'Escape') {
              e.preventDefault()
              send({ type: 'key', code: e.code, down: false })
            }
          }}
          className={
            immersive
              ? 'h-full w-full object-contain'
              : 'aspect-video w-full object-contain'
          }
        />
        {connected && !immersive && (
          <div className='pointer-events-none absolute start-2 top-2 rounded-lg bg-foreground/90 px-3 py-2 text-sm font-semibold text-background tabular-nums'>
            {stats.fps === undefined ? '—' : Math.round(stats.fps)} FPS · 延迟{' '}
            {stats.rttMs === undefined ? '—' : Math.round(stats.rttMs)} ms
          </div>
        )}
      </div>
      {connected && immersive && (
        <ImmersiveHandle
          stats={stats}
          onRestore={exitDisplay}
          onKeyboard={
            canControl
              ? () => {
                  release()
                  setKeyboard((value) => !value)
                }
              : undefined
          }
          onLeave={() => {
            stop()
            setConnected(false)
            setStatus('已离开共享')
          }}
          leaveLabel='离开观看'
        />
      )}
      {connected && !immersive && (
        <div
          className={
            immersive
              ? 'flex shrink-0 flex-wrap justify-center gap-2 bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]'
              : 'flex flex-wrap gap-2'
          }
        >
          {canControl && (
            <Button variant='outline' onClick={() => setKeyboard(!keyboard)}>
              键盘
            </Button>
          )}
          <Button
            variant='outline'
            onClick={() => {
              stop()
              setConnected(false)
              setStatus('已离开共享')
            }}
          >
            离开观看
          </Button>
          <Button
            variant='outline'
            onClick={() => {
              if (immersive) exitDisplay()
              else void enterDisplay()
            }}
          >
            {immersive ? '退出全屏' : '全屏观看'}
          </Button>
        </div>
      )}
      {displayHint && (
        <p
          role='status'
          className='pointer-events-none absolute inset-x-4 top-14 rounded-lg bg-background/90 p-2 text-center text-xs'
        >
          {displayHint}
        </p>
      )}
      {connected && canControl && keyboard && (
        <div
          className={
            immersive
              ? 'absolute inset-x-0 bottom-16 max-h-[65dvh] overflow-auto bg-background'
              : ''
          }
        >
          <RemoteKeyboard
            send={send}
            asciiOnly={asciiOnly}
            onClose={() => {
              release()
              setKeyboard(false)
            }}
          />
        </div>
      )}
      <p className={immersive ? 'hidden' : 'text-sm text-muted-foreground'}>
        无需登录 · {canControl ? '允许控制远程桌面' : '仅观看画面'} ·
        共享者可随时停止或更换分享码
      </p>
    </main>
  )
}
