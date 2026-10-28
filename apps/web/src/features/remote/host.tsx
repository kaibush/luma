import { useEffect, useRef, useState } from 'react'
import {
  qualityProfiles,
  type InputEvent,
  type AccessToken,
} from '@remote/protocol'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Main } from '@/components/layout/main'
import { PasswordInput } from '@/components/password-input'
import { request } from '@/features/access/auth'
import { signaling, sendSignal } from './api'
import { RemotePeer } from './peer'

function browserDeviceId() {
  if (!globalThis.crypto?.randomUUID) return undefined
  const key = 'remote-browser-device-id'
  const valid = (value: string | null): value is string =>
    !!value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  let id: string | undefined
  // Preserve existing tabs' identities while allowing a reopened browser to
  // reconnect to its previous card instead of creating another offline entry.
  try {
    const existing = sessionStorage.getItem(key)
    if (valid(existing)) id = existing
  } catch {
    /* Persistent storage may still be available. */
  }
  try {
    const existing = localStorage.getItem(key)
    id ??= valid(existing) ? existing : crypto.randomUUID()
    localStorage.setItem(key, id)
  } catch {
    /* Keep a session identity if persistent storage is unavailable. */
  }
  id ??= crypto.randomUUID()
  try {
    sessionStorage.setItem(key, id)
  } catch {
    /* The identity remains stable for this mounted sharing page. */
  }
  return id
}

export function BrowserHost() {
  const [resumeHostId] = useState(
    () => new URLSearchParams(location.search).get('resume') || undefined
  )
  const [deviceId] = useState(browserDeviceId)
  const [availableTokens, setAvailableTokens] = useState<AccessToken[]>([])
  const [selectedToken, setSelectedToken] = useState('')
  const [verifiedToken, setVerifiedToken] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [token, setToken] = useState(''),
    [name, setName] = useState('我的电脑'),
    [state, setState] = useState('未共享'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [event, setEvent] = useState('等待输入')
  const [panel, setPanel] = useState<'install' | 'browser' | null>(
    resumeHostId ? 'browser' : null
  )
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
    setKeyBusy(false)
    setVerifiedToken('')
  }
  useEffect(() => {
    if (panel !== 'browser') return
    let disposed = false
    void request<{ user: unknown }>('/auth/me')
      .then(async (auth) => {
        if (!auth.user) return
        const result = await request<{ tokens: AccessToken[] }>(
          '/manage/tokens'
        )
        if (!disposed)
          setAvailableTokens(
            result.tokens.filter(
              (t) => t.scope === 'host' && t.status === 'active' && t.revealable
            )
          )
      })
      .catch(() => {})
    return () => {
      disposed = true
    }
  }, [panel])
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
  const verifyToken = async () => {
    setError('')
    if (!token.trim()) {
      setError(
        '请先填写主机密钥：由管理员在「系统管理 → Token 管理」创建主机接入密钥。'
      )
      document.getElementById('host-token')?.focus()
      return
    }
    const generation = resources.current.generation
    setKeyBusy(true)
    try {
      const result = await request<{
        name: string
        host?: { id: string; name: string }
      }>('/auth/host-token/verify', {
        token: token.trim(),
        ...(resumeHostId ? { resumeHostId } : {}),
      })
      if (resources.current.generation !== generation) return
      setVerifiedToken(token.trim())
      if (result.host) setName(result.host.name)
      setState(`密钥已验证：${result.name}。请继续选择屏幕。`)
    } catch (e) {
      if (resources.current.generation === generation) {
        setVerifiedToken('')
        setError((e as Error).message)
      }
    } finally {
      if (resources.current.generation === generation) setKeyBusy(false)
    }
  }
  const start = async () => {
    if (busy || keyBusy || !verifiedToken || verifiedToken !== token.trim())
      return
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
        '请先填写主机密钥：由管理员在「系统管理 → Token 管理」创建用途为「主机」的密钥。'
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
        {
          role: 'host',
          kind: 'browser',
          deviceId,
          ...(resumeHostId ? { resumeHostId } : {}),
          token: token.trim(),
          name: name.trim(),
        },
        (message) => {
          if (r.generation !== generation) return
          if (message.type === 'ready') {
            clearTimeout(r.registrationTimer)
            setState(`已上线：${name.trim()}。请从主机列表点击「观看画面」。`)
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
              closeEvent.reason === 'Device already connected'
                ? '此浏览器共享已在其他页面接入，请先停止另一页面的共享。'
                : closeEvent.reason === 'Host unavailable'
                  ? '无法恢复此浏览器主机，请确认档案仍存在并使用原主机密钥。'
                  : closeEvent.code === 1008
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
    <Main className='flex flex-col gap-6'>
      <div className='flex items-center justify-between'>
        <Button variant='ghost' asChild>
          <a href='/'>
            <ArrowLeft className='size-4' />
            主机列表
          </a>
        </Button>
        <Button variant='ghost' asChild>
          <a href='/guide/install' target='_blank' rel='noreferrer'>
            接入指南
          </a>
        </Button>
        <Button variant='outline' asChild>
          <a href='/shares'>打开屏幕共享</a>
        </Button>
      </div>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>接入电脑</h1>
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
                : '上线后，其他已登录的控制台用户可从主机列表观看。关闭此窗口会停止共享，离线档案仍保留。'}
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
                  管理员在「系统管理 → Token
                  管理」创建主机密钥，填入客户端后点击「保存并连接」。
                </p>
                <div className='flex gap-2'>
                  <Button variant='outline' asChild>
                    <a href='/management/tokens'>Token 管理</a>
                  </Button>
                  <Button variant='ghost' asChild>
                    <a href='/guide/install' target='_blank' rel='noreferrer'>
                      详细接入指南
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
                    {resumeHostId
                      ? '正在恢复已有主机。请使用原主机密钥，验证后重新选择这台电脑的屏幕。'
                      : '先选择或粘贴主机密钥并验证，再选择要共享的屏幕。关闭后重新接入会复用这台浏览器的主机卡片。'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    id='host-form'
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (verifiedToken && verifiedToken === token.trim())
                        void start()
                      else void verifyToken()
                    }}
                  >
                    <FieldGroup>
                      <Field data-disabled={busy || keyBusy}>
                        <FieldLabel htmlFor='host-name'>共享名称</FieldLabel>
                        <Input
                          id='host-name'
                          value={name}
                          disabled={busy || keyBusy}
                          maxLength={64}
                          required
                          onChange={(e) => setName(e.target.value)}
                        />
                      </Field>
                      {!!availableTokens.length && (
                        <Field data-disabled={busy || keyBusy}>
                          <FieldLabel htmlFor='saved-host-token'>
                            选择已有主机密钥
                          </FieldLabel>
                          <Select
                            value={selectedToken}
                            disabled={busy || keyBusy}
                            onValueChange={(id) => {
                              setSelectedToken(id)
                              setKeyBusy(true)
                              setVerifiedToken('')
                              setToken('')
                              setError('')
                              const generation = resources.current.generation
                              void request<{ value: string }>(
                                `/manage/tokens/${id}/reveal`,
                                {}
                              )
                                .then((result) => {
                                  if (
                                    resources.current.generation === generation
                                  )
                                    setToken(result.value)
                                })
                                .catch((e) => {
                                  if (
                                    resources.current.generation === generation
                                  )
                                    setError(e.message)
                                })
                                .finally(() => {
                                  if (
                                    resources.current.generation === generation
                                  )
                                    setKeyBusy(false)
                                })
                            }}
                          >
                            <SelectTrigger id='saved-host-token'>
                              <SelectValue placeholder='选择用于此次接入的密钥' />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {availableTokens.map((item) => (
                                  <SelectItem key={item.id} value={item.id}>
                                    {item.name} · 尾号 {item.suffix}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <FieldDescription>
                            仅列出有效的主机接入密钥，控制 API
                            密钥不能用于此处。
                          </FieldDescription>
                        </Field>
                      )}
                      <Field data-disabled={busy || keyBusy}>
                        <FieldLabel htmlFor='host-token'>主机密钥</FieldLabel>
                        <PasswordInput
                          id='host-token'
                          value={token}
                          visibilityLabel='密钥'
                          autoComplete='off'
                          disabled={busy || keyBusy}
                          required
                          onChange={(e) => {
                            setToken(e.target.value)
                            setVerifiedToken('')
                            setSelectedToken('')
                            setState('未共享')
                          }}
                          placeholder='粘贴管理员提供的主机密钥'
                          maxLength={256}
                        />
                        <FieldDescription>
                          在「系统管理 → Token
                          管理」创建主机接入密钥，复制完整密钥，不能使用尾号。
                          <a
                            href='/management/tokens'
                            target='_blank'
                            rel='noreferrer'
                            className='underline'
                          >
                            管理密钥
                          </a>
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
                    <Button
                      form='host-form'
                      disabled={busy || keyBusy}
                      type='submit'
                    >
                      <Radio data-icon='inline-start' />
                      {keyBusy
                        ? '正在读取 / 验证密钥'
                        : verifiedToken
                          ? '选择屏幕并上线'
                          : '验证主机密钥'}
                    </Button>
                    <Button variant='outline' disabled={!busy} onClick={stop}>
                      <Square data-icon='inline-start' />
                      停止共享
                    </Button>
                    {busy && (
                      <Button variant='outline' asChild>
                        <a href='/' target='_blank' rel='noreferrer'>
                          打开主机列表观看
                        </a>
                      </Button>
                    )}
                  </div>
                </CardFooter>
              </Card>
              <details className='rounded-lg border p-3'>
                <summary className='cursor-pointer text-sm'>
                  本机画面预览与连接测试
                </summary>
                <Card>
                  <CardHeader>
                    <CardTitle>本机预览</CardTitle>
                    <CardDescription>
                      此处用于确认共享范围。其他控制台用户在主机列表点击「观看画面」即可观看；建议共享其他窗口以避免画面循环。
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
                    <CardTitle>输入事件测试（仅用于诊断）</CardTitle>
                    <CardDescription>
                      显示观看端传来的事件，不会操作本机系统鼠标、键盘或其他应用。
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
    </Main>
  )
}
