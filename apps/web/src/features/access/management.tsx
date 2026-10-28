import { useEffect, useState } from 'react'
import { getWorkspaceName } from '@/config/branding'
import {
  Copy,
  KeyRound,
  Radio,
  RefreshCw,
  Save,
  ScrollText,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
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
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { PasswordInput } from '@/components/password-input'
import { ThemeSwitch } from '@/components/theme-switch'
import { AuditLog } from './audit-log'
import { request, useRemoteAuth, type ConnectionSettings } from './auth'
import { SettingsFields } from './settings-fields'
import { TokenManagement } from './token-management'

interface Connection {
  id: string
  hostName: string
  expiresAt: number
  quality: string
  connected: boolean
}
const date = (value: number | null) =>
  value ? new Date(value).toLocaleString() : '—'

const sections: Record<
  string,
  {
    title: string
    description: string
    icon: LucideIcon
    tone: string
    iconTone: string
  }
> = {
  connection: {
    title: '连接设置',
    description: '工作空间名称、画质和中继地址。保存后只影响之后新建的连接。',
    icon: Settings,
    tone: 'bg-secondary',
    iconTone: 'text-primary',
  },
  tokens: {
    title: 'Token 管理',
    description:
      '为主机和访客创建接入密钥。每台电脑建议使用独立主机密钥，方便单独撤销。',
    icon: KeyRound,
    tone: 'bg-warning-soft',
    iconTone: 'text-warning',
  },
  sessions: {
    title: '活动连接',
    description: '查看当前控制会话。断开后会立即释放这台主机。',
    icon: Radio,
    tone: 'bg-success-soft',
    iconTone: 'text-success',
  },
  account: {
    title: '账号安全',
    description:
      '修改管理员密码。完成后所有浏览器登录会失效，主机 Token 不受影响。',
    icon: ShieldCheck,
    tone: 'bg-secondary',
    iconTone: 'text-primary',
  },
  audit: {
    title: '操作记录',
    description: '记录登录、设置修改和 Token 操作，不记录密码或桌面输入。',
    icon: ScrollText,
    tone: 'bg-accent',
    iconTone: 'text-chart-3',
  },
}

function SectionHeading({ id }: { id: string }) {
  const section = sections[id] ?? sections.connection
  const Icon = section.icon
  return (
    <div className='flex items-start gap-3'>
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-xl',
          section.tone,
          section.iconTone
        )}
      >
        <Icon className='size-5' aria-hidden />
      </span>
      <div className='min-w-0'>
        <h1 className='text-xl font-semibold tracking-tight'>
          {section.title}
        </h1>
        <p className='mt-1 max-w-2xl text-sm leading-6 text-muted-foreground'>
          {section.description}
        </p>
      </div>
    </div>
  )
}

export function ManagementPage({
  section = 'connection',
}: {
  section?: string
}) {
  const { state, refresh, logout } = useRemoteAuth()
  const [settings, setSettings] = useState<ConnectionSettings | null>(null),
    [secret, setSecret] = useState(''),
    [connections, setConnections] = useState<Connection[]>([])
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState<{
    name: string
    value: string
  } | null>(null)
  const [currentPassword, setCurrentPassword] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState('')
  const load = async () => {
    const c = await request<{ connections: Connection[] }>(
      '/manage/connections'
    )
    setConnections(c.connections)
  }
  useEffect(() => {
    let disposed = false
    void Promise.all([
      request<{ settings: ConnectionSettings }>('/manage/settings'),
      request<{ connections: Connection[] }>('/manage/connections'),
    ])
      .then(([s, c]) => {
        if (!disposed) {
          setSettings({
            ...s.settings,
            workspaceName: getWorkspaceName(s.settings.workspaceName),
          })
          setConnections(c.connections)
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
  const page = sections[section] ?? sections.connection
  return (
    <>
      <Header>
        <span className='text-sm font-medium'>{page.title}</span>
        <div className='ms-auto flex items-center gap-2'>
          <Badge variant='outline'>{state.user?.username}</Badge>
          <Button variant='ghost' size='sm' onClick={() => void logout()}>
            退出登录
          </Button>
          <ThemeSwitch />
        </div>
      </Header>
      <Main className='flex flex-col gap-8 pb-12'>
        <SectionHeading id={section} />
        {error && (
          <Alert variant='destructive' role='alert'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {section === 'connection' &&
          (settings ? (
            <form
              className='settings-form flex max-w-2xl flex-col gap-8'
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
                  setSettings({
                    ...result.settings,
                    workspaceName: getWorkspaceName(
                      result.settings.workspaceName
                    ),
                  })
                  setSecret('')
                  await refresh()
                  toast.success('设置已保存，将用于新连接')
                })
              }}
            >
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
              <div>
                <Button disabled={busy}>
                  <Save data-icon='inline-start' />
                  保存连接设置
                </Button>
              </div>
            </form>
          ) : (
            <Skeleton className='h-72 w-full max-w-2xl' />
          ))}
        {section === 'tokens' && (
          <div className='settings-form'>
            <TokenManagement />
          </div>
        )}
        {section === 'sessions' && (
          <div className='flex flex-col gap-4'>
            {connections.length ? (
              <div className='overflow-hidden rounded-xl border bg-card'>
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
                          <Badge variant={c.connected ? 'success' : 'warning'}>
                            {c.connected ? '控制端已接入' : '等待接入'}
                          </Badge>
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
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>
                当前没有活动连接。
              </p>
            )}
            <div>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => void run(load)}
              >
                <RefreshCw data-icon='inline-start' />
                刷新
              </Button>
            </div>
          </div>
        )}
        {section === 'account' && (
          <form
            className='settings-form flex max-w-2xl flex-col gap-8'
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
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor='current-password'>当前密码</FieldLabel>
                <PasswordInput
                  id='current-password'
                  visibilityLabel='密码'
                  autoComplete='current-password'
                  value={currentPassword}
                  required
                  maxLength={128}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <FieldDescription>
                  当前管理员：{state.user?.username}。用于确认是你本人在修改。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor='new-password'>新密码</FieldLabel>
                <PasswordInput
                  id='new-password'
                  visibilityLabel='密码'
                  autoComplete='new-password'
                  value={password}
                  required
                  minLength={12}
                  maxLength={128}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <FieldDescription>
                  至少 12 位。修改后需要重新登录。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor='confirm-password'>确认新密码</FieldLabel>
                <PasswordInput
                  id='confirm-password'
                  visibilityLabel='密码'
                  autoComplete='new-password'
                  value={confirm}
                  required
                  onChange={(e) => setConfirm(e.target.value)}
                />
                <FieldDescription>
                  再输入一次新密码，两次需要一致。
                </FieldDescription>
              </Field>
            </FieldGroup>
            <div>
              <Button disabled={busy}>
                <ShieldCheck data-icon='inline-start' />
                修改密码并重新登录
              </Button>
            </div>
          </form>
        )}
        {section === 'audit' && <AuditLog />}
      </Main>
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
