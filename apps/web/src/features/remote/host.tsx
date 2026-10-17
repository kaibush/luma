import { useEffect, useRef, useState } from 'react'
import { qualityProfiles, type InputEvent } from '@remote/protocol'
import { ArrowLeft, Download, Monitor, Radio, Square } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { signaling, sendSignal } from './api'
import { RemotePeer } from './peer'

export function BrowserHost() {
  const [token, setToken] = useState(''),
    [name, setName] = useState('我的电脑'),
    [state, setState] = useState('未共享'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [event, setEvent] = useState('等待输入')
  const resources = useRef<{
    stream?: MediaStream
    ws?: WebSocket
    peer?: RemotePeer
    generation: number
  }>({ generation: 0 })
  const preview = useRef<HTMLVideoElement>(null),
    latest = useRef<InputEvent | null>(null),
    pointer = useRef<HTMLDivElement>(null)
  const stop = () => {
    const r = resources.current
    r.generation++
    r.peer?.close()
    r.ws?.close()
    r.stream?.getTracks().forEach((t) => t.stop())
    r.peer = undefined
    r.ws = undefined
    r.stream = undefined
    setState('未共享')
    setBusy(false)
  }
  useEffect(() => {
    const r = resources.current
    const timer = setInterval(() => {
      if (latest.current) {
        setEvent(JSON.stringify(latest.current))
        latest.current = null
      }
    }, 200)
    return () => {
      clearInterval(timer)
      r.generation++
      r.peer?.close()
      r.ws?.close()
      r.stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  const start = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
      setError(
        '请在电脑的 HTTPS 或 localhost 页面打开，使用支持屏幕共享的浏览器'
      )
      return
    }
    setBusy(true)
    setError('')
    const r = resources.current,
      generation = ++r.generation
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: false,
      })
      if (r.generation !== generation) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      r.stream = stream
      if (preview.current) preview.current.srcObject = stream
      stream.getVideoTracks()[0].onended = stop
      setState('正在注册')
      r.ws = signaling(
        { role: 'host', token, name },
        (message) => {
          if (r.generation !== generation) return
          if (message.type === 'ready') {
            setState('在线，等待连接')
            setToken('')
          } else if (message.type === 'session') {
            r.peer?.close()
            setState('正在连接')
            const profile = qualityProfiles[message.session.quality]
            stream.getVideoTracks()[0].contentHint = [
              'ultrafast',
              'smooth',
              'responsive',
            ].includes(message.session.quality)
              ? 'motion'
              : 'detail'
            // Constraint failure is nonfatal: sender bitrate/FPS caps still apply.
            void stream
              .getVideoTracks()[0]
              .applyConstraints({
                width: { ideal: profile.width, max: profile.width },
                height: { ideal: profile.height, max: profile.height },
                frameRate: { ideal: profile.fps, max: profile.fps },
              })
              .catch(() => {})
            try {
              r.peer = new RemotePeer({
                role: 'host',
                stream,
                quality: message.session.quality,
                iceServers: message.iceServers,
                signal: (m) =>
                  sendSignal(r.ws, { ...m, sessionId: message.session.id }),
                onState: (s) => {
                  if (r.generation === generation)
                    setState(s === 'connected' ? '正在共享' : s)
                },
                onInput: (input) => {
                  latest.current = input
                  if (
                    (input.type === 'move' || input.type === 'button') &&
                    pointer.current
                  ) {
                    pointer.current.style.left = `${input.x * 100}%`
                    pointer.current.style.top = `${input.y * 100}%`
                  }
                },
              })
              sendSignal(r.ws, { type: 'ready', sessionId: message.session.id })
            } catch {
              setError('无法初始化视频连接')
              sendSignal(r.ws, { type: 'end', sessionId: message.session.id })
            }
          } else if (message.type === 'ended') {
            r.peer?.close()
            r.peer = undefined
            setState('在线，等待连接')
          } else if (message.type === 'error') setError(message.message)
          else void r.peer?.handle(message)
        },
        () => {
          if (r.generation === generation) {
            stop()
            setError('主机连接已断开。请检查主机密钥与网络，然后重新共享。')
          }
        }
      )
    } catch (e) {
      if (r.generation === generation) {
        stop()
        setError(
          (e as Error).name === 'NotAllowedError'
            ? '屏幕共享未获授权，你可以重新选择屏幕'
            : (e as Error).message
        )
      }
    }
  }
  return (
    <main className='mx-auto flex max-w-4xl flex-col gap-6 p-4 md:p-8'>
      <div className='flex items-center justify-between'>
        <Button variant='ghost' asChild>
          <a href='/'>
            <ArrowLeft data-icon='inline-start' />
            主机列表
          </a>
        </Button>
        <Badge variant='secondary'>{state}</Badge>
      </div>
      <div>
        <h1 className='text-3xl font-semibold tracking-tight'>接入此电脑</h1>
        <p className='mt-2 text-muted-foreground'>
          在这台电脑安装客户端，即可通过控制台远程操作。
        </p>
      </div>
      <div className='grid gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>Linux 客户端</CardTitle>
            <CardDescription>X11 / Xorg 桌面 · 优先支持</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-3 text-sm'>
            <p>
              下载安装包并解压，在本机桌面终端运行{' '}
              <code>bash install-linux.sh</code>。安装后会打开配置窗口。
            </p>
            <p className='text-muted-foreground'>
              推荐 Ubuntu / Debian。暂不支持 Wayland；请使用桌面用户安装。
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild>
              <a href='/downloads/remote-console-linux.tar.gz' download>
                <Download data-icon='inline-start' />
                下载 Linux 客户端
              </a>
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              Windows 客户端 <Badge variant='warning'>预览版</Badge>
            </CardTitle>
            <CardDescription>Windows 10 / 11 x64 · 普通桌面</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-3 text-sm'>
            <p>
              下载并解压，双击 <code>install-windows.cmd</code>
              ，按提示安装。完成后可从桌面快捷方式打开。
            </p>
            <p className='text-muted-foreground'>
              首次安装需要联网。尚未通过 Windows 真机验收；不支持锁屏和 UAC
              安全桌面。
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild variant='outline'>
              <a href='/downloads/remote-console-windows.zip' download>
                <Download data-icon='inline-start' />
                下载 Windows 预览版
              </a>
            </Button>
          </CardFooter>
        </Card>
      </div>
      <Alert>
        <Monitor />
        <AlertTitle>三步接入其他电脑</AlertTitle>
        <AlertDescription>
          <ol className='list-decimal ps-5'>
            <li>
              管理员在「管理设置 → Token 管理」为这台电脑创建「主机」密钥。
            </li>
            <li>
              在被控电脑安装客户端，填写主机名称和密钥，点击「保存并连接」。控制台地址填写本站地址。
            </li>
            <li>
              客户端显示在线后，回到主机列表点击「连接桌面」。可设置登录本机桌面后自动接入。
            </li>
          </ol>
          <a
            className='underline'
            href='/downloads/client-guide.md'
            target='_blank'
            rel='noreferrer'
          >
            安装、停止与卸载说明
          </a>
        </AlertDescription>
      </Alert>
      <Alert>
        <Monitor />
        <AlertTitle>浏览器共享端</AlertTitle>
        <AlertDescription>
          在此电脑上授权屏幕共享。远端输入只显示在下方测试面板，不会操作系统鼠标和键盘。关闭共享即可结束访问。
        </AlertDescription>
      </Alert>
      {error && (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>屏幕共享</CardTitle>
          <CardDescription>
            使用与控制端不同的主机密钥注册此设备。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id='host-form'
            onSubmit={(e) => {
              e.preventDefault()
              void start()
            }}
          >
            <FieldGroup>
              <Field data-disabled={busy}>
                <FieldLabel htmlFor='host-name'>主机名称</FieldLabel>
                <Input
                  id='host-name'
                  value={name}
                  disabled={busy}
                  maxLength={64}
                  required
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field data-disabled={busy}>
                <FieldLabel htmlFor='host-token'>主机密钥</FieldLabel>
                <Input
                  id='host-token'
                  value={token}
                  type='password'
                  autoComplete='off'
                  disabled={busy}
                  required
                  onChange={(e) => setToken(e.target.value)}
                  placeholder='HOST_TOKEN'
                />
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className='gap-2'>
          <Button
            form='host-form'
            disabled={busy || !token || !name}
            type='submit'
          >
            <Radio data-icon='inline-start' />
            选择屏幕并上线
          </Button>
          <Button variant='outline' disabled={!busy} onClick={stop}>
            <Square data-icon='inline-start' />
            停止共享
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>本机预览</CardTitle>
          <CardDescription>
            建议共享其他窗口，避免反复捕获此预览。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <video
            ref={preview}
            autoPlay
            muted
            playsInline
            className='aspect-video w-full rounded-md bg-muted object-contain'
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>输入协议测试</CardTitle>
          <CardDescription>
            在控制端点击、拖动或输入文字，观察事件是否到达。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='relative h-40 overflow-hidden rounded-md border bg-muted'>
            <div
              ref={pointer}
              className='pointer-events-none absolute size-4 rounded-full bg-primary'
              style={{
                left: '50%',
                top: '50%',
                transform: 'translate(-50%,-50%)',
              }}
            />
          </div>
          <pre className='mt-3 overflow-auto text-xs' aria-live='polite'>
            {event}
          </pre>
        </CardContent>
      </Card>
    </main>
  )
}
