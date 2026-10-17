import { useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { sendSignal } from '@/features/remote/api'
import { RemotePeer, type Telemetry } from '@/features/remote/peer'
import { shareSocket } from './connection'

export function ShareViewer({ id }: { id: string }) {
  const [key, setKey] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get('key') || ''
  )
  const [name, setName] = useState('屏幕共享'),
    [status, setStatus] = useState('输入密钥或打开完整观看链接'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false),
    [stats, setStats] = useState<Telemetry>({})
  const video = useRef<HTMLVideoElement>(null),
    container = useRef<HTMLDivElement>(null)
  const resource = useRef<{
    generation: number
    ws?: WebSocket
    peer?: RemotePeer
    timer?: ReturnType<typeof setTimeout>
  }>({ generation: 0 })
  const stop = () => {
    const r = resource.current
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
            r.peer = new RemotePeer({
              role: 'controller',
              readOnly: true,
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
                  setStatus('正在观看 · 只读共享')
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
  return (
    <main className='mx-auto flex max-w-6xl flex-col gap-4 p-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
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
            <FieldLabel htmlFor='view-key'>观看密钥</FieldLabel>
            <Input
              id='view-key'
              type='password'
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
        ref={container}
        className='relative overflow-hidden rounded-xl bg-muted'
      >
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          controls
          className='aspect-video w-full object-contain'
        />
        {connected && (
          <div className='pointer-events-none absolute start-2 top-2 rounded-lg bg-foreground/90 px-3 py-2 text-sm font-semibold text-background tabular-nums'>
            {stats.fps === undefined ? '—' : Math.round(stats.fps)} FPS · 延迟{' '}
            {stats.rttMs === undefined ? '—' : Math.round(stats.rttMs)} ms
          </div>
        )}
      </div>
      {connected && (
        <div className='flex gap-2'>
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
              void container.current
                ?.requestFullscreen?.()
                .catch(() =>
                  setError('当前浏览器不支持页面全屏，可使用视频自带的全屏按钮')
                )
            }}
          >
            全屏观看
          </Button>
        </div>
      )}
      <p className='text-sm text-muted-foreground'>
        无需登录 · 仅观看画面 · 共享者可随时停止或更换密钥
      </p>
    </main>
  )
}
