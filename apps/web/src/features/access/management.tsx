import { useEffect, useState } from 'react'
import {
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
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
  DialogFooter,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { request, useRemoteAuth, type ConnectionSettings } from './auth'
import { SettingsFields } from './settings-fields'

interface Token {
  id: string
  revealable: boolean
  name: string
  scope: 'host' | 'control'
  suffix: string
  createdAt: number
  expiresAt: number | null
  revokedAt: number | null
  lastUsedAt: number | null
}
interface Connection {
  id: string
  hostName: string
  expiresAt: number
  quality: string
  connected: boolean
}
interface AuditEvent {
  id: number
  time: number
  actor: string
  action: string
  detail: string
}
const date = (value: number | null) =>
  value ? new Date(value).toLocaleString() : '—'
export function ManagementPage() {
  const { state, refresh, logout } = useRemoteAuth()
  const [settings, setSettings] = useState<ConnectionSettings | null>(null),
    [secret, setSecret] = useState(''),
    [tokens, setTokens] = useState<Token[]>([]),
    [connections, setConnections] = useState<Connection[]>([]),
    [audit, setAudit] = useState<AuditEvent[]>([])
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [scope, setScope] = useState<'host' | 'control'>('host'),
    [days, setDays] = useState('90'),
    [created, setCreated] = useState(''),
    [revoke, setRevoke] = useState<Token | null>(null)
  const [revealed, setRevealed] = useState<{
    name: string
    value: string
  } | null>(null)
  const [currentPassword, setCurrentPassword] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState('')
  const load = async () => {
    const [t, c, a] = await Promise.all([
      request<{ tokens: Token[] }>('/manage/tokens'),
      request<{ connections: Connection[] }>('/manage/connections'),
      request<{ events: AuditEvent[] }>('/manage/audit'),
    ])
    setTokens(t.tokens)
    setConnections(c.connections)
    setAudit(a.events)
  }
  useEffect(() => {
    let disposed = false
    void Promise.all([
      request<{ settings: ConnectionSettings }>('/manage/settings'),
      request<{ tokens: Token[] }>('/manage/tokens'),
      request<{ connections: Connection[] }>('/manage/connections'),
      request<{ events: AuditEvent[] }>('/manage/audit'),
    ])
      .then(([s, t, c, a]) => {
        if (!disposed) {
          setSettings(s.settings)
          setTokens(t.tokens)
          setConnections(c.connections)
          setAudit(a.events)
        }
      })
      .catch((e) => {
        if (!disposed) setError(e.message)
      })
    const timer = setInterval(() => {
      void request<{ connections: Connection[] }>('/manage/connections')
        .then((c) => {
          if (!disposed) setConnections(c.connections)
        })
        .catch(() => {})
    }, 10000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Header>
        <span className='text-sm font-medium'>管理设置</span>
        <div className='ms-auto flex items-center gap-2'>
          <Badge variant='outline'>{state.user?.username}</Badge>
          <Button variant='ghost' size='sm' onClick={() => void logout()}>
            退出登录
          </Button>
          <ThemeSwitch />
        </div>
      </Header>
      <Main className='flex flex-col gap-6'>
        <div>
          <h1 className='text-3xl font-semibold tracking-tight'>
            管理你的工作空间
          </h1>
          <p className='mt-2 text-muted-foreground'>
            连接参数、接入凭据和账号安全，在这里统一管理。
          </p>
        </div>
        {error && (
          <Alert variant='destructive' role='alert'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Tabs defaultValue='connection' className='flex flex-col gap-5'>
          <TabsList className='grid h-auto w-full grid-cols-3 gap-1 sm:w-fit sm:grid-cols-5'>
            <TabsTrigger className='h-9' value='connection'>
              连接设置
            </TabsTrigger>
            <TabsTrigger className='h-9' value='tokens'>
              Token 管理
            </TabsTrigger>
            <TabsTrigger className='h-9' value='sessions'>
              活动连接
            </TabsTrigger>
            <TabsTrigger className='h-9' value='account'>
              账号安全
            </TabsTrigger>
            <TabsTrigger className='h-9' value='audit'>
              操作记录
            </TabsTrigger>
          </TabsList>
          <TabsContent value='connection'>
            {settings ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(async () => {
                    const result = await request<{
                      settings: ConnectionSettings
                    }>(
                      '/manage/settings',
                      { settings, turnSecret: secret || undefined },
                      'PUT'
                    )
                    setSettings(result.settings)
                    setSecret('')
                    await refresh()
                    toast.success('设置已保存，将用于新连接')
                  })
                }}
              >
                <Card>
                  <CardHeader>
                    <CardTitle>连接偏好</CardTitle>
                    <CardDescription>
                      当前连接不受影响，新建连接使用最新配置。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SettingsFields
                      value={settings}
                      onChange={setSettings}
                      secret={secret}
                      onSecret={setSecret}
                      onReveal={() =>
                        void run(async () => {
                          const result = await request<{ value: string }>(
                            '/manage/settings/turn-secret/reveal',
                            {}
                          )
                          setRevealed({
                            name: 'TURN 共享密钥',
                            value: result.value,
                          })
                        })
                      }
                    />
                  </CardContent>
                  <CardFooter>
                    <Button disabled={busy}>
                      <Save data-icon='inline-start' />
                      保存连接设置
                    </Button>
                  </CardFooter>
                </Card>
              </form>
            ) : (
              <Skeleton className='h-72 w-full' />
            )}
          </TabsContent>
          <TabsContent value='tokens' className='flex flex-col gap-5'>
            <Alert>
              <KeyRound />
              <AlertTitle>Token 用于程序和主机接入</AlertTitle>
              <AlertDescription>
                浏览器使用账号登录。主机 Token 只能注册主机，控制 Token
                能连接桌面但不能管理系统。轮换时先创建新
                Token，更新接入端，再撤销旧 Token。
              </AlertDescription>
            </Alert>
            {created && (
              <Card>
                <CardHeader>
                  <CardTitle>新 Token 已创建</CardTitle>
                  <CardDescription>
                    完整 Token 已加密保存，之后可在下方列表中查看和复制。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Input
                    aria-label='新 Token'
                    value={created}
                    readOnly
                    autoComplete='off'
                  />
                </CardContent>
                <CardFooter className='gap-2'>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(created)
                        .then(() => toast.success('已复制'))
                        .catch(() => toast.error('请手动复制 Token'))
                    }
                  >
                    <Copy data-icon='inline-start' />
                    复制
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={() => setCreated('')}
                  >
                    已保存，关闭
                  </Button>
                </CardFooter>
              </Card>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  const result = await request<{ value: string }>(
                    '/manage/tokens',
                    { name, scope, ...(days ? { days: Number(days) } : {}) }
                  )
                  setCreated(result.value)
                  setName('')
                  await load()
                  toast.success('Token 已创建')
                })
              }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>创建接入 Token</CardTitle>
                  <CardDescription>
                    为不同的设备或调用程序使用独立 Token，便于单独撤销。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor='token-name'>名称</FieldLabel>
                      <Input
                        id='token-name'
                        value={name}
                        maxLength={64}
                        required
                        placeholder='例如：办公室电脑'
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <div className='grid gap-5 sm:grid-cols-2'>
                      <Field>
                        <FieldLabel htmlFor='token-scope'>用途</FieldLabel>
                        <select
                          id='token-scope'
                          className='h-11 rounded-md border bg-background px-3'
                          value={scope}
                          onChange={(e) =>
                            setScope(e.target.value as 'host' | 'control')
                          }
                        >
                          <option value='host'>主机接入</option>
                          <option value='control'>远程控制 API</option>
                        </select>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor='token-days'>有效期</FieldLabel>
                        <select
                          id='token-days'
                          className='h-11 rounded-md border bg-background px-3'
                          value={days}
                          onChange={(e) => setDays(e.target.value)}
                        >
                          <option value='7'>7 天</option>
                          <option value='30'>30 天</option>
                          <option value='90'>90 天</option>
                          <option value='365'>365 天</option>
                          <option value=''>长期有效</option>
                        </select>
                      </Field>
                    </div>
                  </FieldGroup>
                </CardContent>
                <CardFooter>
                  <Button disabled={busy}>
                    <Plus data-icon='inline-start' />
                    创建 Token
                  </Button>
                </CardFooter>
              </Card>
            </form>
            <Card>
              <CardHeader>
                <CardTitle>已有 Token</CardTitle>
                <CardDescription>
                  管理员可以查看有效密钥。未保存原文的旧密钥需要重新创建。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称 / 用途</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>最近使用</TableHead>
                      <TableHead>到期时间</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokens.map((token) => (
                      <TableRow key={token.id}>
                        <TableCell>
                          <div className='font-medium'>{token.name}</div>
                          <div className='text-xs text-muted-foreground'>
                            {token.scope === 'host' ? '主机' : '控制'} · 尾号{' '}
                            {token.suffix}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant='secondary'>
                            {token.revokedAt
                              ? '已撤销'
                              : token.expiresAt && token.expiresAt < Date.now()
                                ? '已过期'
                                : '有效'}
                          </Badge>
                        </TableCell>
                        <TableCell>{date(token.lastUsedAt)}</TableCell>
                        <TableCell>
                          {token.expiresAt ? date(token.expiresAt) : '长期有效'}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant='ghost'
                            size='sm'
                            disabled={
                              busy ||
                              !token.revealable ||
                              !!token.revokedAt ||
                              !!(
                                token.expiresAt && token.expiresAt < Date.now()
                              )
                            }
                            onClick={() =>
                              void run(async () => {
                                const result = await request<{ value: string }>(
                                  `/manage/tokens/${token.id}/reveal`,
                                  {}
                                )
                                setRevealed({
                                  name: token.name,
                                  value: result.value,
                                })
                              })
                            }
                          >
                            查看密钥
                          </Button>
                          <Button
                            variant='outline'
                            size='sm'
                            disabled={busy || !!token.revokedAt}
                            onClick={() => setRevoke(token)}
                          >
                            撤销
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value='sessions'>
            <Card>
              <CardHeader>
                <CardTitle>活动连接</CardTitle>
                <CardDescription>
                  显示当前控制会话，结束连接会立即释放该主机。
                </CardDescription>
              </CardHeader>
              <CardContent>
                {connections.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>主机</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>最晚结束时间</TableHead>
                        <TableHead>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {connections.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>{c.hostName}</TableCell>
                          <TableCell>
                            {c.connected ? '控制端已接入' : '等待接入'}
                          </TableCell>
                          <TableCell>{date(c.expiresAt)}</TableCell>
                          <TableCell>
                            <Button
                              variant='outline'
                              size='sm'
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await request(
                                    `/sessions/${c.id}`,
                                    undefined,
                                    'DELETE'
                                  )
                                  await load()
                                  toast.success('连接已结束')
                                })
                              }
                            >
                              断开连接
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    当前没有活动连接。
                  </p>
                )}
              </CardContent>
              <CardFooter>
                <Button
                  variant='outline'
                  disabled={busy}
                  onClick={() => void run(load)}
                >
                  <RefreshCw data-icon='inline-start' />
                  刷新
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
          <TabsContent value='account'>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  if (password !== confirm)
                    throw new Error('两次输入的密码不一致')
                  await request('/auth/password', { currentPassword, password })
                  setPassword('')
                  setCurrentPassword('')
                  setConfirm('')
                  await refresh()
                })
              }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>修改登录密码</CardTitle>
                  <CardDescription>
                    当前管理员：{state.user?.username}
                    。修改后所有浏览器登录会失效，需要重新登录；主机 Token
                    不受影响。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor='current-password'>
                        当前密码
                      </FieldLabel>
                      <Input
                        id='current-password'
                        type='password'
                        autoComplete='current-password'
                        value={currentPassword}
                        required
                        maxLength={128}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor='new-password'>新密码</FieldLabel>
                      <Input
                        id='new-password'
                        type='password'
                        autoComplete='new-password'
                        value={password}
                        required
                        minLength={12}
                        maxLength={128}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor='confirm-password'>
                        确认新密码
                      </FieldLabel>
                      <Input
                        id='confirm-password'
                        type='password'
                        autoComplete='new-password'
                        value={confirm}
                        required
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                </CardContent>
                <CardFooter>
                  <Button disabled={busy}>
                    <ShieldCheck data-icon='inline-start' />
                    修改密码并重新登录
                  </Button>
                </CardFooter>
              </Card>
            </form>
          </TabsContent>
          <TabsContent value='audit'>
            <Card>
              <CardHeader>
                <CardTitle>最近操作</CardTitle>
                <CardDescription>
                  记录登录、设置修改和 Token 操作，不记录密码或桌面输入。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>操作者</TableHead>
                      <TableHead>事件</TableHead>
                      <TableHead>详情</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>{date(event.time)}</TableCell>
                        <TableCell>{event.actor}</TableCell>
                        <TableCell>{event.action}</TableCell>
                        <TableCell>{event.detail}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
              <CardFooter>
                <Button
                  variant='outline'
                  disabled={busy}
                  onClick={() => void run(load)}
                >
                  刷新记录
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>
      </Main>
      <AlertDialog
        open={!!revoke}
        onOpenChange={(open) => {
          if (!open && !busy) setRevoke(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤销「{revoke?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              此 Token 将立即失效，使用它的主机或控制连接会被断开。如果这是本机
              Agent 使用的 Token，请先创建新 Token 并更新 Agent 配置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                void run(async () => {
                  await request(
                    `/manage/tokens/${revoke!.id}`,
                    undefined,
                    'DELETE'
                  )
                  setRevoke(null)
                  await load()
                  toast.success('Token 已撤销')
                })
              }}
            >
              确认撤销
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={!!revealed}
        onOpenChange={(open) => {
          if (!open) setRevealed(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{revealed?.name}</DialogTitle>
            <DialogDescription>
              完整密钥，可直接复制用于接入。
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label='完整密钥'
            value={revealed?.value ?? ''}
            readOnly
            autoComplete='off'
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setRevealed(null)}>
              关闭
            </Button>
            <Button
              onClick={() =>
                void navigator.clipboard
                  .writeText(revealed?.value ?? '')
                  .then(() => toast.success('已复制'))
                  .catch(() => toast.error('请手动复制密钥'))
              }
            >
              <Copy data-icon='inline-start' />
              复制密钥
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
