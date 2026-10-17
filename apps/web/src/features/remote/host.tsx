import { useEffect, useRef, useState } from 'react'
import { qualityProfiles, type InputEvent } from '@remote/protocol'
import { ArrowLeft, Download, Monitor, Radio, Square } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PasswordInput } from '@/components/password-input'
import { signaling, sendSignal } from './api'
import { RemotePeer } from './peer'

export function BrowserHost() {
  const [token, setToken] = useState(''),
    [name, setName] = useState('我的电脑'),
    [state, setState] = useState('未共享'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [event, setEvent] = useState('等待输入')
  const [panel, setPanel] = useState<'install' | 'browser' | null>(null)
  const resources = useRef<{
    stream?: MediaStream
    ws?: WebSocket
    peer?: RemotePeer
    generation: number
    registrationTimer?: ReturnType<typeof setTimeout>
  }>({ generation: 0 })
  const preview = useRef<HTMLVideoElement>(null),
    latest = useRef<InputEvent | null>(null),
    pointer = useRef<HTMLDivElement>(null)
  const stop = () => {
    const r = resources.current
    r.generation++
    clearTimeout(r.registrationTimer)
    r.peer?.close()
    r.ws?.close()
    r.stream?.getTracks().forEach((t) => t.stop())
    r.peer = undefined
    r.ws = undefined
    r.stream = undefined
    if (preview.current) preview.current.srcObject = null
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
      clearTimeout(r.registrationTimer)
      r.peer?.close()
      r.ws?.close()
      r.stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])
  const start = async () => {
    if (busy) return
    setError('')
    if (!window.isSecureContext) {
      setError(
        '当前页面不是安全连接，请在电脑浏览器中打开 https://rc.lvyrix.com/host 后重试。'
      )
      return
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        '当前浏览器不能共享屏幕。请在电脑上用 Chrome 或 Edge 打开本站；手机可用于观看，通常不能发起共享。'
      )
      return
    }
    if (!name.trim()) {
      setError('请先填写共享名称，观看者将通过这个名称找到你的屏幕。')
      document.getElementById('host-name')?.focus()
      return
    }
    if (!token.trim()) {
      setError(
        '请先填写主机密钥：由管理员在「管理设置 → Token 管理」创建用途为「主机」的密钥。'
      )
      document.getElementById('host-token')?.focus()
      return
    }
    setBusy(true)
    setState('等待选择屏幕，请在浏览器弹窗中选择后点击共享')
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
        { role: 'host', token: token.trim(), name: name.trim() },
        (message) => {
          if (r.generation !== generation) return
          if (message.type === 'ready') {
            clearTimeout(r.registrationTimer)
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
        (closeEvent) => {
          if (r.generation === generation) {
            stop()
            setError(
              closeEvent.code === 1008
                ? '主机密钥无效、已过期或被撤销。请使用用途为「主机」的密钥，不能填写管理员密码或控制端密钥。'
                : '主机连接已断开，请检查网络后重新选择屏幕共享。'
            )
          }
        }
      )
      r.registrationTimer = setTimeout(() => {
        if (r.generation !== generation) return
        stop()
        setError('主机注册超时，请检查网络后重试。')
      }, 15000)
    } catch (e) {
      if (r.generation === generation) {
        stop()
        setError(
          (e as Error).name === 'NotAllowedError'
            ? '已取消选择或未允许共享。请重新点击按钮，在浏览器弹窗中选择屏幕、窗口或标签页，再点击「共享」。'
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
            <ArrowLeft className='size-4' />
            主机列表
          </a>
        </Button>
        <Button variant='outline' asChild>
          <a href='/shares'>打开屏幕共享</a>
        </Button>
      </div>
      <div>
        <h1 className='text-3xl font-semibold'>接入电脑</h1>
        <p className='mt-2 text-muted-foreground'>
          选择接入方式，几步完成配置。手机只需登录控制台即可操作。
        </p>
      </div>
      <div className='grid gap-4 md:grid-cols-2'>
        <Card>
          <CardHeader>
            <Monitor className='mb-2 size-7 text-primary' />
            <CardTitle>安装桌面客户端</CardTitle>
            <CardDescription>远程控制、终端、文件与设备状态</CardDescription>
          </CardHeader>
          <CardContent>
            <p className='text-sm text-muted-foreground'>
              安装在被控电脑上，支持自动上线，无需一直打开网页。
            </p>
          </CardContent>
          <CardFooter>
            <Button onClick={() => setPanel('install')}>
              <Download className='size-4' />
              下载与安装
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <Radio className='mb-2 size-7 text-primary' />
            <CardTitle>临时浏览器接入</CardTitle>
            <CardDescription>不安装 · 只分享当前电脑画面</CardDescription>
          </CardHeader>
          <CardContent>
            <p className='text-sm text-muted-foreground'>
              供控制台用户临时观看。需要电脑浏览器支持选屏。
            </p>
          </CardContent>
          <CardFooter>
            <Button variant='outline' onClick={() => setPanel('browser')}>
              浏览器接入
            </Button>
          </CardFooter>
        </Card>
      </div>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4'>
        <div>
          <p className='font-medium'>分享已经接入的远程电脑？</p>
          <p className='mt-1 text-sm text-muted-foreground'>
            在手机创建链接，访客输入分享码即可观看或控制。
          </p>
        </div>
        <Button variant='outline' asChild>
          <a href='/shares'>去创建分享</a>
        </Button>
      </div>
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) {
            if (panel === 'browser') stop()
            setPanel(null)
          }
        }}
      >
        <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>
              {panel === 'install'
                ? '安装桌面客户端'
                : '浏览器主机接入：供控制台观看'}
            </DialogTitle>
            <DialogDescription>
              {panel === 'install'
                ? '在要被远程控制的电脑上完成以下步骤。'
                : '关闭此窗口会停止共享。访客链接请使用屏幕共享页面。'}
            </DialogDescription>
          </DialogHeader>
          {panel === 'install' && (
            <Tabs
              defaultValue={
                navigator.userAgent.includes('Windows') ? 'windows' : 'linux'
              }
            >
              <TabsList className='w-full'>
                <TabsTrigger value='linux'>Linux</TabsTrigger>
                <TabsTrigger value='windows'>Windows</TabsTrigger>
              </TabsList>
              <TabsContent value='linux' className='flex flex-col gap-4 py-3'>
                <Badge variant='secondary'>X11 / Xorg</Badge>
                <Button asChild>
                  <a href='/downloads/remote-console-linux.tar.gz' download>
                    <Download className='size-4' />
                    下载 Linux 客户端
                  </a>
                </Button>
                <p className='text-sm'>解压后在桌面终端执行：</p>
                <code className='rounded-lg bg-muted p-3 text-sm'>
                  bash install-linux.sh
                </code>
                <p className='text-xs text-muted-foreground'>
                  推荐 Ubuntu / Debian。Wayland 请切换到 Xorg 桌面。
                </p>
              </TabsContent>
              <TabsContent value='windows' className='flex flex-col gap-4 py-3'>
                <Badge variant='warning'>Windows 10 / 11 · 预览版</Badge>
                <Button asChild>
                  <a href='/downloads/remote-console-windows.zip' download>
                    <Download className='size-4' />
                    下载 Windows 预览版
                  </a>
                </Button>
                <p className='text-sm'>
                  解压后双击 install-windows.cmd，按提示完成安装。
                </p>
                <p className='text-xs text-muted-foreground'>
                  首次安装需联网；暂不支持锁屏与 UAC 安全桌面，尚待真机验收。
                </p>
              </TabsContent>
              <div className='flex flex-col gap-3 border-t pt-4'>
                <p className='text-sm font-medium'>
                  安装后，填写控制台地址和主机密钥
                </p>
                <Input
                  aria-label='控制台地址'
                  readOnly
                  value={location.origin}
                  onFocus={(e) => e.target.select()}
                />
                <p className='text-sm text-muted-foreground'>
                  管理员在「管理设置 → Token
                  管理」创建主机密钥，填入客户端后点击「保存并连接」。
                </p>
                <div className='flex gap-2'>
                  <Button variant='outline' asChild>
                    <a href='/management'>管理设置</a>
                  </Button>
                  <Button variant='ghost' asChild>
                    <a
                      href='/downloads/client-guide.md'
                      target='_blank'
                      rel='noreferrer'
                    >
                      完整安装说明
                    </a>
                  </Button>
                </div>
              </div>
            </Tabs>
          )}
          {panel === 'browser' && (
            <div className='flex flex-col gap-4'>
              <Card>
                <CardHeader>
                  <CardTitle>浏览器主机接入</CardTitle>
                  <CardDescription>
                    不用安装客户端。先填下面两项，再选择要共享的内容。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    id='host-form'
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault()
                      void start()
                    }}
                  >
                    <FieldGroup>
                      <Field data-disabled={busy}>
                        <FieldLabel htmlFor='host-name'>共享名称</FieldLabel>
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
                        <PasswordInput
                          id='host-token'
                          value={token}
                          visibilityLabel='密钥'
                          autoComplete='off'
                          disabled={busy}
                          required
                          onChange={(e) => setToken(e.target.value)}
                          placeholder='粘贴管理员提供的主机密钥'
                          maxLength={256}
                        />
                        <FieldDescription>
                          在「管理设置 → Token
                          管理」创建用途为「主机」的密钥。此处不填写管理员密码。
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                  </form>
                </CardContent>
                <CardFooter className='flex flex-col items-start gap-3'>
                  <p role='status' className='text-sm font-medium'>
                    {state}
                  </p>
                  {error && (
                    <Alert variant='destructive' role='alert'>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  <div className='flex flex-wrap gap-2'>
                    <Button form='host-form' disabled={busy} type='submit'>
                      <Radio data-icon='inline-start' />
                      选择屏幕并上线
                    </Button>
                    <Button variant='outline' disabled={!busy} onClick={stop}>
                      <Square data-icon='inline-start' />
                      停止共享
                    </Button>
                  </div>
                </CardFooter>
              </Card>
              <details className='rounded-lg border p-3'>
                <summary className='cursor-pointer text-sm'>
                  画面预览与输入测试
                </summary>
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
                    <pre
                      className='mt-3 overflow-auto text-xs'
                      aria-live='polite'
                    >
                      {event}
                    </pre>
                  </CardContent>
                </Card>
              </details>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}
