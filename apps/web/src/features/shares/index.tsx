import { useEffect, useRef, useState } from 'react'
import { Copy, Monitor, Square, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { api, sendSignal } from '@/features/remote/api'
import { RemotePeer } from '@/features/remote/peer'
import { shareLink, shareSocket, type Share } from './connection'

function ShareCard({
  share,
  pending,
  capturing,
  onStart,
  onAction,
}: {
  share: Share
  pending: boolean
  capturing: boolean
  onStart: () => void
  onAction: (
    share: Share,
    action: 'rotate' | 'stop' | 'delete',
    key?: string
  ) => void
}) {
  const [key, setKey] = useState(''),
    [copied, setCopied] = useState(false)
  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <CardTitle>{share.name}</CardTitle>
          <Badge variant={share.online ? 'success' : 'secondary'}>
            {!share.enabled
              ? '已停止'
              : share.online
                ? `${share.viewers} 人观看`
                : '等待开始共享'}
          </Badge>
        </div>
        <CardDescription>
          访客只读观看 · 最多同时 3 人 · 无需登录
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`link-${share.id}`}>
              观看链接（包含密钥）
            </FieldLabel>
            <Input
              id={`link-${share.id}`}
              readOnly
              value={shareLink(share)}
              onFocus={(e) => e.target.select()}
            />
            <FieldDescription>
              复制整个链接发给观看者。停止、更换密钥或删除后，已有观看会话会断开。
            </FieldDescription>
          </Field>
          <Button
            variant='outline'
            onClick={() => {
              void navigator.clipboard
                .writeText(shareLink(share))
                .then(() => setCopied(true))
                .catch(() => {
                  document.getElementById(`link-${share.id}`)?.focus()
                })
            }}
          >
            <Copy data-icon='inline-start' />
            {copied ? '已复制链接' : '复制观看链接'}
          </Button>
          <Field>
            <FieldLabel htmlFor={`key-${share.id}`}>新密钥（可选）</FieldLabel>
            <Input
              id={`key-${share.id}`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              type='password'
              autoComplete='new-password'
              minLength={16}
              maxLength={128}
              placeholder='留空则自动生成随机密钥'
            />
            <FieldDescription>
              自定义密钥为 16–128 个字符。更换后请重新复制链接。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className='flex flex-wrap gap-2'>
        <Button
          disabled={pending || capturing || share.online}
          onClick={onStart}
        >
          <Monitor data-icon='inline-start' />
          {share.enabled ? '选择屏幕并开始' : '重新开启并选择屏幕'}
        </Button>
        <Button
          variant='outline'
          disabled={pending}
          onClick={() => {
            setCopied(false)
            onAction(share, 'rotate', key || undefined)
            setKey('')
          }}
        >
          更换密钥
        </Button>
        <Button
          variant='outline'
          disabled={pending || !share.enabled}
          onClick={() => onAction(share, 'stop')}
        >
          <Square data-icon='inline-start' />
          停止共享
        </Button>
        <Button
          variant='destructive'
          disabled={pending}
          onClick={() => onAction(share, 'delete')}
        >
          <Trash2 data-icon='inline-start' />
          删除共享
        </Button>
      </CardFooter>
    </Card>
  )
}
export function ScreenShares() {
  const [shares, setShares] = useState<Share[]>([]),
    [name, setName] = useState('我的屏幕')
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [pending, setPending] = useState(false),
    [active, setActive] = useState<string>()
  const preview = useRef<HTMLVideoElement>(null)
  const source = useRef<{
    generation: number
    stream?: MediaStream
    ws?: WebSocket
    peers: Map<string, RemotePeer>
    timer?: ReturnType<typeof setTimeout>
  }>({ generation: 0, peers: new Map() })
  const mounted = useRef(true)
  const refresh = async () => {
    const result = await api<{ shares: Share[] }>('/manage/shares', '')
    if (mounted.current) setShares(result.shares)
  }
  const stopCapture = () => {
    const r = source.current
    r.generation++
    clearTimeout(r.timer)
    const ws = r.ws
    r.ws = undefined
    ws?.close()
    for (const peer of r.peers.values()) peer.close()
    r.peers.clear()
    r.stream?.getTracks().forEach((t) => t.stop())
    r.stream = undefined
    if (preview.current) preview.current.srcObject = null
    if (mounted.current) {
      setActive(undefined)
      setPending(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void refresh().catch((e) => {
      if (mounted.current) setError(e.message)
    })
    const timer = setInterval(() => {
      void refresh().catch(() => {})
    }, 5000)
    return () => {
      mounted.current = false
      clearInterval(timer)
      stopCapture()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const action = async (
    share: Share,
    action: 'rotate' | 'stop' | 'delete',
    key?: string
  ) => {
    setError('')
    if (action !== 'rotate' && active === share.id) stopCapture()
    setPending(true)
    try {
      await api(
        `/manage/shares/${share.id}${action === 'delete' ? '' : `/${action}`}`,
        '',
        {
          method: action === 'delete' ? 'DELETE' : 'POST',
          ...(action === 'rotate' ? { body: JSON.stringify({ key }) } : {}),
        }
      )
      setStatus(
        action === 'rotate'
          ? '密钥已更换，旧链接和已有观看会话已失效，请复制新链接。'
          : action === 'delete'
            ? '共享已删除。'
            : '共享已停止。重新开启时会生成新密钥。'
      )
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }
  const start = async (share: Share) => {
    setError('')
    if (!window.isSecureContext) {
      setError('请通过 HTTPS 打开此页后共享屏幕。')
      return
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        '当前浏览器不支持发起屏幕共享。请在电脑 Chrome 或 Edge 中打开此页；手机可打开观看链接。'
      )
      return
    }
    if (source.current.stream || pending) return
    setPending(true)
    setStatus('请在浏览器弹窗中选择屏幕、窗口或标签页，再点击共享。')
    const r = source.current,
      generation = ++r.generation
    try {
      // Must run directly in the click handler before any HTTP request.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: false,
      })
      if (!mounted.current || r.generation !== generation) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      r.stream = stream
      await api(`/manage/shares/${share.id}/enable`, '', { method: 'POST' })
      if (!mounted.current || r.generation !== generation) return
      setActive(share.id)
      if (preview.current) preview.current.srcObject = stream
      stream.getVideoTracks()[0].onended = () => {
        stopCapture()
        void api(`/manage/shares/${share.id}/stop`, '', { method: 'POST' })
          .then(refresh)
          .catch(() => {})
        if (mounted.current) setStatus('已停止共享。')
      }
      const ws = shareSocket(
        { role: 'publisher', shareId: share.id },
        (message) => {
          if (r.generation !== generation) return
          if (message.type === 'ready') {
            clearTimeout(r.timer)
            setPending(false)
            setStatus('屏幕共享已开启，复制观看链接发给对方，并保持本页打开。')
            void refresh().catch(() => {})
          } else if (message.type === 'session') {
            const session = message.session
            if (r.peers.size >= 3) return
            const peer = new RemotePeer({
              role: 'host',
              readOnly: true,
              stream,
              quality: 'balanced',
              iceServers: message.iceServers,
              signal: (signal) =>
                sendSignal(ws, { ...signal, sessionId: session.id }),
              onState: (state) => {
                if (state === 'failed') {
                  sendSignal(ws, { type: 'end', sessionId: session.id })
                  r.peers.get(session.id)?.close()
                  r.peers.delete(session.id)
                }
              },
            })
            r.peers.set(session.id, peer)
            sendSignal(ws, { type: 'ready', sessionId: session.id })
          } else if (message.type === 'ended') {
            if (message.sessionId) {
              r.peers.get(message.sessionId)?.close()
              r.peers.delete(message.sessionId)
              void refresh().catch(() => {})
            } else {
              stopCapture()
              setStatus(message.reason)
              void refresh().catch(() => {})
            }
          } else if (message.type === 'error') {
            stopCapture()
            setError(message.message)
          } else if (message.sessionId)
            void r.peers.get(message.sessionId)?.handle(message)
        },
        (event) => {
          if (r.generation === generation) {
            stopCapture()
            setError(
              event.code === 1008
                ? '无法开启共享，请检查登录是否有效或共享是否已在另一页面开启。'
                : '共享连接已断开，请重新选择屏幕。'
            )
            void refresh().catch(() => {})
          }
        }
      )
      r.ws = ws
      r.timer = setTimeout(() => {
        if (r.generation === generation) {
          stopCapture()
          setError('共享注册超时，请检查网络后重试。')
        }
      }, 15000)
    } catch (e) {
      if (mounted.current && r.generation === generation) {
        stopCapture()
        setError(
          (e as Error).name === 'NotAllowedError'
            ? '已取消选屏或未获得共享权限，请重新选择并确认共享。'
            : (e as Error).message
        )
      }
    }
  }
  return (
    <>
      <Header>
        <span className='font-medium'>屏幕共享</span>
      </Header>
      <Main className='flex flex-col gap-5'>
        <div>
          <h1 className='text-2xl font-semibold'>屏幕共享</h1>
          <p className='mt-2 text-muted-foreground'>
            创建共享 → 选择屏幕 → 把带密钥的 HTTPS 链接发给对方。
          </p>
        </div>
        <Alert>
          <Monitor />
          <AlertTitle>访客无需登录，只能观看</AlertTitle>
          <AlertDescription>
            在电脑 Chrome 或 Edge
            中选择要共享的画面，并保持本页打开。观看者可使用电脑或手机。你可以随时更换密钥、停止或删除共享。
          </AlertDescription>
        </Alert>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setPending(true)
            setError('')
            try {
              await api('/manage/shares', '', {
                method: 'POST',
                body: JSON.stringify({ name }),
              })
              await refresh()
              setStatus('共享已创建，点击「选择屏幕并开始」后即可观看。')
            } catch (e) {
              setError((e as Error).message)
            } finally {
              setPending(false)
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='share-name'>共享名称</FieldLabel>
              <Input
                id='share-name'
                required
                maxLength={64}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='例如：产品演示'
              />
            </Field>
            <Button disabled={pending} type='submit'>
              创建共享并生成密钥
            </Button>
          </FieldGroup>
        </form>
        {status && (
          <p role='status' className='text-sm'>
            {status}
          </p>
        )}
        {error && (
          <Alert variant='destructive' role='alert'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {pending && !active && (
          <Button
            variant='outline'
            onClick={() => {
              stopCapture()
              setStatus('已取消准备共享。')
            }}
          >
            取消准备
          </Button>
        )}
        <div hidden={!active} className='flex flex-col gap-2'>
          <p className='text-sm'>本机预览</p>
          <video
            ref={preview}
            autoPlay
            playsInline
            muted
            className='max-h-80 w-full rounded-lg bg-muted object-contain'
          />
        </div>
        <div className='grid gap-4 lg:grid-cols-2'>
          {shares.map((share) => (
            <ShareCard
              key={share.id + ':' + share.key}
              share={share}
              pending={pending}
              capturing={!!active}
              onStart={() => void start(share)}
              onAction={(...args) => void action(...args)}
            />
          ))}
        </div>
        {!shares.length && (
          <p className='text-muted-foreground'>
            还没有共享，先创建一个观看链接。
          </p>
        )}
      </Main>
    </>
  )
}
