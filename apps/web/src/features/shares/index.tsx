import { useEffect, useRef, useState } from 'react'
import type { Host } from '@remote/protocol'
import { Copy, Monitor, Square, Trash2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { PasswordInput } from '@/components/password-input'
import { api, sendSignal } from '@/features/remote/api'
import { RemotePeer } from '@/features/remote/peer'
import { shareLink, shareSocket, type Share } from './connection'

function localDate(value: number | null) {
  if (value === null) return ''
  const date = new Date(value)
  return new Date(value - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

function ShareCard({
  share,
  pending,
  capturing,
  onStart,
  onAction,
  onExpiry,
  onPermission,
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
  onExpiry: (expiresAt: number | null) => void
  onPermission: (permission: 'view' | 'control') => void
}) {
  const [panel, setPanel] = useState<'link' | 'edit' | 'delete' | null>(null)
  const [expiry, setExpiry] = useState(localDate(share.expiresAt))
  const [key, setKey] = useState('')
  useEffect(() => setExpiry(localDate(share.expiresAt)), [share.expiresAt])
  const expired = share.expiresAt !== null && share.expiresAt <= Date.now()
  const status = expired
    ? '已到期'
    : !share.enabled
      ? '已停止'
      : share.online
        ? '分享中'
        : '等待上线'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${share.name}\n${shareLink(share)}${share.hostId ? `\n分享码：${share.key}` : ''}`
      )
      toast.success('链接和分享码已复制')
    } catch {
      setPanel('link')
      toast.info('请在弹窗中长按复制')
    }
  }
  return (
    <>
      <article className='flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between'>
        <div className='flex min-w-0 items-center gap-3'>
          <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted'>
            <Monitor className='size-5' />
          </div>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <h2 className='truncate font-medium'>{share.name}</h2>
              <Badge variant={status === '分享中' ? 'success' : 'secondary'}>
                {status}
              </Badge>
            </div>
            <p className='mt-1 text-xs text-muted-foreground'>
              {share.hostId ? '远程主机' : '浏览器屏幕'} ·{' '}
              {share.permission === 'control' ? '允许控制' : '仅观看'} ·{' '}
              {share.viewers} 人在线 ·{' '}
              {share.expiresAt
                ? new Date(share.expiresAt).toLocaleString() + ' 到期'
                : '不限时'}
            </p>
          </div>
        </div>
        <div className='flex shrink-0 flex-wrap gap-2'>
          <Button variant='outline' size='sm' onClick={() => void copy()}>
            <Copy className='size-4' />
            复制分享
          </Button>
          <Button variant='outline' size='sm' onClick={() => setPanel('link')}>
            链接
          </Button>
          <Button variant='outline' size='sm' onClick={() => setPanel('edit')}>
            管理
          </Button>
          {(!share.hostId || !share.enabled) && (
            <Button
              size='sm'
              disabled={
                pending ||
                expired ||
                (!share.hostId && (capturing || share.online))
              }
              onClick={onStart}
            >
              {share.hostId
                ? '重新开启远程分享'
                : share.enabled
                  ? '选择屏幕并开始'
                  : '重新开启并选择屏幕'}
            </Button>
          )}
        </div>
      </article>
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null)
        }}
      >
        <DialogContent className='max-h-[85dvh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>
              {panel === 'link'
                ? '发送分享'
                : panel === 'delete'
                  ? '删除这个分享？'
                  : '管理分享'}{' '}
              · {share.name}
            </DialogTitle>
            <DialogDescription>
              {panel === 'link'
                ? '对方打开链接并输入分享码即可连接。'
                : '更改权限、分享码或停止分享会断开已有访客。'}
            </DialogDescription>
          </DialogHeader>
          {panel === 'link' && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`link-${share.id}`}>
                  {share.hostId
                    ? '分享链接（不含分享码）'
                    : '观看链接（包含密钥）'}
                </FieldLabel>
                <Input
                  id={`link-${share.id}`}
                  readOnly
                  value={shareLink(share)}
                  onFocus={(e) => e.target.select()}
                />
              </Field>
              {share.hostId && (
                <Field>
                  <FieldLabel htmlFor={`code-${share.id}`}>
                    当前分享码
                  </FieldLabel>
                  <Input
                    id={`code-${share.id}`}
                    readOnly
                    value={share.key}
                    onFocus={(e) => e.target.select()}
                  />
                </Field>
              )}
              <Button onClick={() => void copy()}>
                <Copy className='size-4' />
                复制链接和分享码
              </Button>
            </FieldGroup>
          )}
          {panel === 'edit' && (
            <>
              <Tabs defaultValue='permission'>
                <TabsList className='w-full'>
                  <TabsTrigger value='permission'>权限</TabsTrigger>
                  <TabsTrigger value='expiry'>有效期</TabsTrigger>
                  <TabsTrigger value='code'>分享码</TabsTrigger>
                </TabsList>
                <TabsContent value='permission' className='py-3'>
                  {share.hostId ? (
                    <Field>
                      <FieldLabel htmlFor={`permission-${share.id}`}>
                        分享权限
                      </FieldLabel>
                      <select
                        id={`permission-${share.id}`}
                        className='h-10 rounded-md border bg-background px-3'
                        value={share.permission}
                        disabled={pending}
                        onChange={(e) =>
                          onPermission(e.target.value as 'view' | 'control')
                        }
                      >
                        <option value='view'>仅观看</option>
                        <option value='control'>允许控制</option>
                      </select>
                      <FieldDescription>
                        修改立即生效；重新连接后使用新权限。
                      </FieldDescription>
                    </Field>
                  ) : (
                    <p className='text-sm text-muted-foreground'>
                      浏览器屏幕仅支持观看。
                    </p>
                  )}
                </TabsContent>
                <TabsContent value='expiry' className='py-3'>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor={`expiry-${share.id}`}>
                        授权码到期时间
                      </FieldLabel>
                      <Input
                        id={`expiry-${share.id}`}
                        type='datetime-local'
                        value={expiry}
                        onChange={(e) => setExpiry(e.target.value)}
                      />
                      <FieldDescription>
                        按当前设备时区设置，留空不限时。
                      </FieldDescription>
                    </Field>
                    <Button
                      disabled={pending}
                      onClick={() =>
                        onExpiry(expiry ? new Date(expiry).getTime() : null)
                      }
                    >
                      保存有效期
                    </Button>
                  </FieldGroup>
                </TabsContent>
                <TabsContent value='code' className='py-3'>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor={`key-${share.id}`}>
                        新密钥（可选）
                      </FieldLabel>
                      <PasswordInput
                        id={`key-${share.id}`}
                        visibilityLabel='分享码'
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        minLength={6}
                        maxLength={128}
                        placeholder='留空随机生成，或输入至少 6 位'
                      />
                    </Field>
                    <Button
                      disabled={pending}
                      onClick={() => {
                        onAction(share, 'rotate', key || undefined)
                        setKey('')
                      }}
                    >
                      更换密钥
                    </Button>
                  </FieldGroup>
                </TabsContent>
              </Tabs>
              <DialogFooter className='border-t pt-4'>
                <Button
                  variant='outline'
                  disabled={pending || !share.enabled}
                  onClick={() => onAction(share, 'stop')}
                >
                  <Square className='size-4' />
                  停止共享
                </Button>
                <Button
                  variant='destructive'
                  disabled={pending}
                  onClick={() => setPanel('delete')}
                >
                  <Trash2 className='size-4' />
                  删除共享
                </Button>
              </DialogFooter>
            </>
          )}
          {panel === 'delete' && (
            <>
              <p className='text-sm'>此链接将永久失效，已有访客立即断开。</p>
              <DialogFooter>
                <Button variant='outline' onClick={() => setPanel('edit')}>
                  返回
                </Button>
                <Button
                  variant='destructive'
                  disabled={pending}
                  onClick={() => onAction(share, 'delete')}
                >
                  确认删除
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
export function ScreenShares() {
  const [shares, setShares] = useState<Share[]>([]),
    [name, setName] = useState('我的屏幕'),
    [expiry, setExpiry] = useState('')
  const [creating, setCreating] = useState(
    !!new URLSearchParams(location.search).get('host')
  )
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [hosts, setHosts] = useState<Host[]>([])
  const [sourceType, setSourceType] = useState('remote')
  const [hostId, setHostId] = useState(
    new URLSearchParams(location.search).get('host') || ''
  )
  const [createKey, setCreateKey] = useState('')
  const [permission, setPermission] = useState<'view' | 'control'>('view')
  const [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [pending, setPending] = useState(false),
    [active, setActive] = useState<string>()
  useEffect(() => {
    if (error) toast.error(error)
  }, [error])
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
    const [result, devices] = await Promise.all([
      api<{ shares: Share[] }>('/manage/shares', ''),
      api<{ hosts: Host[] }>('/hosts', ''),
    ])
    if (mounted.current) {
      setShares(result.shares)
      setHosts(devices.hosts.filter((h) => h.capabilities.remoteSharing))
    }
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
    if (share.hostId) {
      setPending(true)
      try {
        await api(`/manage/shares/${share.id}/enable`, '', { method: 'POST' })
        await refresh()
        setStatus('远程分享已开启，请复制新链接和分享码发给对方。')
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setPending(false)
      }
      return
    }
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
  const visibleShares = shares.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (s.enabled && (!s.expiresAt || s.expiresAt > Date.now())
          ? filter === 'active'
          : filter === 'stopped'))
  )
  return (
    <>
      <Header>
        <span className='font-medium'>屏幕共享</span>
      </Header>
      <Main className='flex flex-col gap-5'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <h1 className='text-2xl font-semibold'>屏幕共享</h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              {shares.length} 个分享 ·{' '}
              {shares.reduce((n, s) => n + s.viewers, 0)} 位访客在线
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Button variant='ghost' size='sm' asChild>
              <a href='/guide/sharing' target='_blank' rel='noreferrer'>
                使用指南
              </a>
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className='size-4' />
              创建分享
            </Button>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-3'>
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            <Search className='size-4 shrink-0 text-muted-foreground' />
            <Input
              aria-label='搜索分享'
              placeholder='搜索分享名称'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList>
              <TabsTrigger value='all'>全部</TabsTrigger>
              <TabsTrigger value='active'>有效</TabsTrigger>
              <TabsTrigger value='stopped'>已停用</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Dialog
          open={creating}
          onOpenChange={(open) => {
            if (!pending) setCreating(open)
          }}
        >
          <DialogContent className='max-h-[88dvh] overflow-y-auto'>
            <DialogHeader>
              <DialogTitle>创建分享</DialogTitle>
              <DialogDescription>
                选择来源、设置权限，再把链接发给对方。
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                setPending(true)
                setError('')
                try {
                  if (sourceType === 'remote' && !(hostId || hosts[0]?.id))
                    throw new Error('没有可分享的在线主机，请更新并连接客户端')
                  await api('/manage/shares', '', {
                    method: 'POST',
                    body: JSON.stringify({
                      name,
                      hostId:
                        sourceType === 'remote'
                          ? hostId || hosts[0]?.id
                          : undefined,
                      permission: sourceType === 'remote' ? permission : 'view',
                      key: createKey || undefined,
                      expiresAt: expiry ? new Date(expiry).getTime() : null,
                    }),
                  })
                  await refresh()
                  setCreating(false)
                  setStatus(
                    sourceType === 'remote'
                      ? '远程分享已创建，请发送链接和分享码；对方无需登录。'
                      : '共享已创建，点击「选择屏幕并开始」后即可观看。'
                  )
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setPending(false)
                }
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor='share-source'>分享来源</FieldLabel>
                  <select
                    id='share-source'
                    className='h-10 w-full rounded-md border bg-background px-3'
                    value={sourceType}
                    onChange={(e) => setSourceType(e.target.value)}
                  >
                    <option value='remote'>已接入的远程主机</option>
                    <option value='browser'>当前电脑的浏览器屏幕</option>
                  </select>
                </Field>
                {sourceType === 'remote' && (
                  <>
                    <Field>
                      <FieldLabel htmlFor='share-host'>远程主机</FieldLabel>
                      <select
                        id='share-host'
                        className='h-10 w-full rounded-md border bg-background px-3'
                        value={hostId || hosts[0]?.id || ''}
                        onChange={(e) => setHostId(e.target.value)}
                      >
                        {!hosts.length && (
                          <option value=''>暂无支持分享的在线主机</option>
                        )}
                        {hosts.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor='create-permission'>
                        访客权限
                      </FieldLabel>
                      <select
                        id='create-permission'
                        className='h-10 w-full rounded-md border bg-background px-3'
                        value={permission}
                        onChange={(e) =>
                          setPermission(e.target.value as 'view' | 'control')
                        }
                      >
                        <option value='view'>仅观看</option>
                        <option value='control'>允许控制</option>
                      </select>
                    </Field>
                  </>
                )}
                <Field>
                  <FieldLabel htmlFor='create-code'>分享码（可选）</FieldLabel>
                  <Input
                    id='create-code'
                    value={createKey}
                    onChange={(e) => setCreateKey(e.target.value)}
                    minLength={6}
                    maxLength={128}
                    placeholder='留空自动随机生成，或输入至少 6 位分享码'
                  />
                </Field>
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
                <Field>
                  <FieldLabel htmlFor='create-expiry'>
                    授权码到期时间（可选）
                  </FieldLabel>
                  <Input
                    id='create-expiry'
                    type='datetime-local'
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                  <FieldDescription>
                    留空表示不限时。到期后链接失效，已有观看者也会断开。
                  </FieldDescription>
                </Field>
                <Button disabled={pending} type='submit'>
                  创建共享并生成密钥
                </Button>
              </FieldGroup>
            </form>
            {error && (
              <p role='alert' className='text-sm text-destructive'>
                {error}
              </p>
            )}
          </DialogContent>
        </Dialog>
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
        <div className='flex flex-col gap-3'>
          {visibleShares.map((share) => (
            <ShareCard
              key={share.id}
              share={share}
              pending={pending}
              capturing={!!active}
              onStart={() => void start(share)}
              onAction={(...args) => void action(...args)}
              onPermission={async (permission) => {
                setPending(true)
                setError('')
                try {
                  await api(`/manage/shares/${share.id}/permission`, '', {
                    method: 'POST',
                    body: JSON.stringify({ permission }),
                  })
                  await refresh()
                  setStatus('分享权限已更新，已有访客已断开，重新连接后生效。')
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setPending(false)
                }
              }}
              onExpiry={async (expiresAt) => {
                setPending(true)
                setError('')
                try {
                  await api(`/manage/shares/${share.id}/expiry`, '', {
                    method: 'POST',
                    body: JSON.stringify({ expiresAt }),
                  })
                  await refresh()
                  setStatus(
                    '有效期已保存。已到期的共享会生成新密钥，请重新开启并复制链接。'
                  )
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setPending(false)
                }
              }}
            />
          ))}
        </div>
        {shares.length > 0 && !visibleShares.length && (
          <p className='rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground'>
            没有匹配的分享，试试其他名称或筛选条件。
          </p>
        )}
        {!shares.length && (
          <p className='text-muted-foreground'>
            还没有共享，先创建一个观看链接。
          </p>
        )}
      </Main>
    </>
  )
}
