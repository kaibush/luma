import { useEffect, useState } from 'react'
import {
  qualityProfiles,
  type Host,
  type IceServer,
  type Quality,
  type Session,
} from '@remote/protocol'
import {
  ArrowUpRight,
  Monitor,
  Radio,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from '@/components/ui/empty'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { useRemoteAuth, request } from '@/features/access/auth'
import { api } from './api'
import { Viewer } from './viewer'

export function RemoteDashboard() {
  const { state, logout } = useRemoteAuth()
  const token = ''
  const [hosts, setHosts] = useState<Host[]>([])
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [quality, setQuality] = useState<Quality>('responsive')
  const [active, setActive] = useState<{
    host: Host
    session: Session
    iceServers: IceServer[]
  } | null>(null)
  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      try {
        const result = await api<{ hosts: Host[] }>('/hosts', token)
        if (!disposed) {
          setHosts(result.hosts)
          setError('')
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message)
      }
    }
    void refresh()
    void request<{ defaultQuality: Quality }>('/preferences')
      .then((p) => {
        if (!disposed) setQuality(p.defaultQuality)
      })
      .catch(() => {})
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [token])
  const refresh = async () => {
    setLoading(true)
    try {
      const data = await api<{ hosts: Host[] }>('/hosts', token)
      setHosts(data.hosts)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  const connect = async (host: Host) => {
    setLoading(true)
    try {
      const data = await api<{ session: Session; iceServers: IceServer[] }>(
        '/sessions',
        token,
        { method: 'POST', body: JSON.stringify({ hostId: host.id, quality }) }
      )
      setActive({ host, ...data })
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <Header>
        <span className='text-sm font-medium'>{state.workspaceName}</span>
        <div className='ms-auto flex items-center gap-2'>
          <Badge variant='outline'>远程桌面</Badge>
          <Button variant='ghost' size='sm' onClick={() => void logout()}>
            退出登录
          </Button>
          <ThemeSwitch />
        </div>
      </Header>
      <Main className='flex flex-col gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-4'>
          <div className='flex flex-col gap-2'>
            <p className='text-sm text-muted-foreground'>工作空间 / 远程桌面</p>
            <h1 className='text-3xl font-semibold tracking-tight'>
              你的桌面，随时连接。
            </h1>
            <p className='text-muted-foreground'>
              选择一台在线电脑，点击「连接桌面」即可开始。
            </p>
          </div>
          <Button asChild variant='outline'>
            <a href='/host' target='_blank' rel='noreferrer'>
              <Monitor data-icon='inline-start' />
              接入此电脑
              <ArrowUpRight data-icon='inline-end' />
            </a>
          </Button>
        </div>
        {error && (
          <Alert variant='destructive' role='alert'>
            <AlertTitle>连接遇到问题</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <section className='flex flex-col gap-4' aria-label='主机列表'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <h2 className='text-xl font-semibold'>我的主机</h2>
              <p className='text-sm text-muted-foreground'>
                选择在线主机，开始远程会话。
              </p>
            </div>
            {state.user && (
              <Button
                variant='outline'
                size='sm'
                disabled={loading}
                onClick={() => void refresh()}
              >
                <RefreshCw data-icon='inline-start' />
                刷新
              </Button>
            )}
          </div>
          <Field className='max-w-xs'>
            <FieldLabel htmlFor='quality'>连接画质</FieldLabel>
            <select
              id='quality'
              className='h-11 rounded-md border bg-background px-3 text-sm'
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality)}
            >
              {Object.entries(qualityProfiles).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label} · {p.height}p / {p.fps} FPS 上限
                </option>
              ))}
            </select>
            <FieldDescription>
              流畅优先选 540p，仍卡顿选 360p。帧率为上限，切换后重新连接生效。
            </FieldDescription>
          </Field>
          {loading && !hosts.length ? (
            <Skeleton className='h-48 w-full' />
          ) : !hosts.length ? (
            <Empty className='border border-dashed'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Monitor />
                </EmptyMedia>
                <EmptyTitle>还没有在线主机</EmptyTitle>
                <EmptyDescription>
                  等待系统主机端上线，或在被控电脑打开「接入此电脑」进行浏览器共享。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
              {hosts.map((host) => (
                <Card key={host.id}>
                  <CardHeader>
                    <div className='mb-3 flex items-center justify-between'>
                      <Monitor className='size-8 text-muted-foreground' />
                      <Badge variant={host.busy ? 'secondary' : 'outline'}>
                        {host.busy ? '使用中' : '在线'}
                      </Badge>
                    </div>
                    <CardTitle>{host.name}</CardTitle>
                    <CardDescription>
                      {host.kind === 'linux-x11'
                        ? 'Linux 系统桌面 · 实时控制'
                        : '浏览器共享端 · 视频与输入测试'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className='text-sm text-muted-foreground'>
                      {host.capabilities.systemInput
                        ? '支持系统鼠标、键盘与英文文本。软件编码，卡顿时建议选择 540p 或 360p。'
                        : '支持实时画面；此浏览器共享端仅用于输入测试。'}
                    </p>
                  </CardContent>
                  <CardFooter>
                    <Button
                      className='w-full'
                      disabled={host.busy || loading}
                      onClick={() => void connect(host)}
                    >
                      <Radio data-icon='inline-start' />
                      {host.busy ? '已有活动会话' : '连接桌面'}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </section>
        <Alert>
          <ShieldCheck />
          <AlertTitle>连接你的实际桌面</AlertTitle>
          <AlertDescription>
            选择 Linux
            系统桌面即可查看并操作本机。浏览器共享端仍仅用于链路测试；当前系统文本输入支持英文和数字。
          </AlertDescription>
        </Alert>
      </Main>
      {active && (
        <Viewer
          {...active}
          token={token}
          onExit={() => {
            setActive(null)
            void refresh()
          }}
        />
      )}
    </>
  )
}
