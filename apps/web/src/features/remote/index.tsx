import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  qualityProfiles,
  type Host,
  type IceServer,
  type Quality,
  type Session,
} from '@remote/protocol'
import {
  Monitor,
  Radio,
  RefreshCw,
  ShieldCheck,
  CircleCheck,
  Activity,
  Star,
  Zap,
  Globe,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { useRemoteAuth, request } from '@/features/access/auth'
import { api } from './api'
import { hostOfflineHint } from './host-status'
import { HostWorkspace } from './host-workspace'
import { ReconnectingViewer as Viewer } from './reconnecting-viewer'

// Stable device IDs preserve favorites across reconnects.
const favoriteKey = (host: Host) => host.id
function readFavorites(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : []
  } catch {
    return []
  }
}

export function RemoteDashboard() {
  const { state, logout } = useRemoteAuth()
  const token = ''
  const favoritesStorageKey = `remote-favorites:${state.user?.username || 'controller'}`
  const [favorites, setFavorites] = useState(() =>
    readFavorites(favoritesStorageKey)
  )
  const [workspace, setWorkspace] = useState<Host | null>(null)
  useEffect(() => {
    if (workspace)
      document
        .getElementById('host-workspace')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [workspace?.id])
  const [groupFilter, setGroupFilter] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const qualityChosen = useRef(false)
  const chooseQuality = (value: Quality) => {
    qualityChosen.current = true
    setQuality(value)
  }
  const toggleFavorite = (host: Host) => {
    const key = favoriteKey(host)
    const next = favorites.includes(key)
      ? favorites.filter((item) => item !== key)
      : [...favorites, key]
    setFavorites(next)
    try {
      localStorage.setItem(favoritesStorageKey, JSON.stringify(next))
    } catch {
      /* Session-only when storage is unavailable. */
    }
  }
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
        if (!disposed && !qualityChosen.current) setQuality(p.defaultQuality)
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
        {
          method: 'POST',
          body: JSON.stringify({
            hostId: host.id,
            quality,
            audio: !!host.capabilities.audio,
          }),
        }
      )
      setActive({ host, ...data })
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  const visibleHosts = hosts
    .filter((host) => {
      const matches =
        `${host.name} ${host.kind} ${host.group || ''} ${host.note || ''}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      return (
        matches &&
        (!groupFilter || host.group === groupFilter) &&
        (filter !== 'favorites' || favorites.includes(favoriteKey(host))) &&
        (filter !== 'available' || (host.online && !host.busy)) &&
        (filter !== 'offline' || !host.online)
      )
    })
    .sort(
      (a, b) =>
        Number(favorites.includes(favoriteKey(b))) -
          Number(favorites.includes(favoriteKey(a))) ||
        Number(b.online) - Number(a.online) ||
        (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0)
    )
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
      <Main id='content' tabIndex={-1} className='flex flex-col gap-6'>
        <div className='flex flex-wrap items-center justify-between gap-5 rounded-2xl border bg-card p-5 sm:p-6'>
          <div className='flex items-start gap-4'>
            <span className='flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary text-primary'>
              <Monitor className='size-6' />
            </span>
            <div className='flex flex-col gap-1'>
              <h1 className='text-2xl font-semibold tracking-tight'>
                我的主机
              </h1>
              <p className='max-w-xl text-sm leading-6 text-muted-foreground'>
                选择画质后连接在线电脑。收藏和筛选只保存在这台浏览器上。
              </p>
            </div>
          </div>
          <Button asChild>
            <Link to='/connect'>
              <Radio data-icon='inline-start' />
              接入此电脑
            </Link>
          </Button>
        </div>
        <div className='grid grid-cols-3 gap-3'>
          {[
            {
              label: '在线主机',
              value: hosts.filter((h) => h.online).length,
              icon: Monitor,
              tone: 'blue',
            },
            {
              label: '可连接',
              value: hosts.filter((h) => h.online && !h.busy).length,
              icon: CircleCheck,
              tone: 'green',
            },
            {
              label: '离线主机',
              value: hosts.filter((h) => !h.online).length,
              icon: Activity,
              tone: 'purple',
            },
          ].map(({ label, value, icon: Icon, tone }) => (
            <Card
              key={label}
              className='dashboard-stat gap-2 py-4'
              data-tone={tone}
            >
              <CardHeader className='px-4'>
                <span className='stat-icon mb-2 flex size-10 items-center justify-center rounded-xl'>
                  <Icon className='size-5' />
                </span>
                <CardDescription>{label}</CardDescription>
                <CardTitle className='text-2xl'>{value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
        {error && (
          <Alert variant='destructive' role='alert'>
            <AlertTitle>连接遇到问题</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {workspace && (
          <div id='host-workspace'>
            <HostWorkspace
              key={workspace.id}
              host={hosts.find((h) => h.id === workspace.id) || workspace}
              onClose={() => setWorkspace(null)}
              onDesktop={() => {
                setWorkspace(null)
                void connect(workspace)
              }}
            />
          </div>
        )}
        <Field>
          <FieldLabel htmlFor='host-group-filter'>筛选分组</FieldLabel>
          <Input
            id='host-group-filter'
            list='host-groups'
            placeholder='全部分组'
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
          />
          <datalist id='host-groups'>
            {[...new Set(hosts.map((h) => h.group).filter(Boolean))].map(
              (group) => (
                <option key={group} value={group} />
              )
            )}
          </datalist>
        </Field>
        <section
          className='flex flex-col gap-5 rounded-2xl border bg-card p-4 sm:p-6'
          aria-label='主机列表'
        >
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <h2 className='text-xl font-semibold'>我的主机</h2>
              <p className='text-sm text-muted-foreground'>
                在线主机可连接，离线主机保留档案并等待重新接入。
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
          <div className='connection-presets flex flex-col gap-4 rounded-xl border p-4'>
            <div className='flex items-center gap-2 text-sm font-semibold'>
              <Zap className='size-4 text-primary' />
              连接预设
            </div>
            <ToggleGroup
              type='single'
              value={quality}
              onValueChange={(v) => {
                if (v) chooseQuality(v as Quality)
              }}
              className='preset-grid'
              spacing={2}
              aria-label='连接预设'
            >
              {[
                {
                  id: 'smooth',
                  title: '省流畅连',
                  detail: '540p · 移动网络',
                  icon: Globe,
                },
                {
                  id: 'responsive',
                  title: '日常办公',
                  detail: '720p · 流畅响应',
                  icon: Zap,
                },
                {
                  id: 'sharp',
                  title: '高清桌面',
                  detail: '1080p · 网络良好',
                  icon: Sparkles,
                },
              ].map(({ id, title, detail, icon: Icon }) => (
                <ToggleGroupItem key={id} value={id} className='preset-option'>
                  <Icon className='size-5' />
                  <span className='flex min-w-0 flex-col gap-1'>
                    <span>{title}</span>
                    <span className='preset-detail'>{detail}</span>
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Field>
              <FieldLabel htmlFor='quality'>连接画质 · 下次连接生效</FieldLabel>
              <select
                id='quality'
                className='h-11 w-full max-w-sm rounded-md border bg-background px-3 text-sm'
                value={quality}
                onChange={(e) => chooseQuality(e.target.value as Quality)}
              >
                {Object.entries(qualityProfiles).map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.label} · {p.height}p / {p.fps} FPS 上限
                  </option>
                ))}
              </select>
              <FieldDescription>
                仍卡顿时可选极速流畅
                360p；实际清晰度和帧率取决于网络与主机性能。
              </FieldDescription>
            </Field>
          </div>
          <div className='flex flex-wrap items-end gap-3'>
            <Field className='min-w-0 flex-1 basis-56'>
              <FieldLabel htmlFor='host-search'>搜索主机</FieldLabel>
              <Input
                id='host-search'
                type='search'
                placeholder='输入主机名称或类型…'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Field>
            <ToggleGroup
              type='single'
              variant='outline'
              value={filter}
              onValueChange={(v) => {
                if (v) setFilter(v)
              }}
              aria-label='筛选主机'
            >
              <ToggleGroupItem value='all'>全部</ToggleGroupItem>
              <ToggleGroupItem value='available'>可连接</ToggleGroupItem>
              <ToggleGroupItem value='offline'>离线</ToggleGroupItem>
              <ToggleGroupItem value='favorites'>
                <Star />
                收藏
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <p className='text-xs text-muted-foreground' role='status'>
            显示 {visibleHosts.length} 台 · 每 5 秒自动刷新 · 收藏保存在此浏览器
            · 按收藏和最近连接排序
          </p>
          {loading && !hosts.length ? (
            <Skeleton className='h-48 w-full' />
          ) : !hosts.length ? (
            <Empty className='border border-dashed'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Monitor />
                </EmptyMedia>
                <EmptyTitle>还没有主机记录</EmptyTitle>
                <EmptyDescription>
                  等待系统主机端上线，或在被控电脑打开「接入此电脑」进行浏览器共享。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : !visibleHosts.length ? (
            <Empty className='border border-dashed'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Monitor />
                </EmptyMedia>
                <EmptyTitle>没有符合条件的主机</EmptyTitle>
                <EmptyDescription>
                  试试其他关键词，或收藏常用主机后在这里快速找到。
                </EmptyDescription>
              </EmptyHeader>
              <Button
                variant='outline'
                onClick={() => {
                  setQuery('')
                  setFilter('all')
                }}
              >
                清除筛选
              </Button>
            </Empty>
          ) : (
            <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
              {visibleHosts.map((host) => (
                <Card
                  key={host.id}
                  className='host-card dashboard-host'
                  data-favorite={favorites.includes(favoriteKey(host))}
                >
                  <CardHeader>
                    <div className='mb-3 flex items-center justify-between'>
                      <span
                        className={cn(
                          'flex size-12 items-center justify-center rounded-xl',
                          !host.online
                            ? 'bg-muted text-muted-foreground'
                            : host.busy
                              ? 'bg-warning-soft text-warning'
                              : 'bg-success-soft text-success'
                        )}
                      >
                        <Monitor className='size-6' />
                      </span>
                      <div className='flex items-center gap-2'>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label={`${favorites.includes(favoriteKey(host)) ? '取消收藏' : '收藏'} ${host.name}`}
                          aria-pressed={favorites.includes(favoriteKey(host))}
                          onClick={() => toggleFavorite(host)}
                        >
                          <Star className='favorite-star' />
                        </Button>
                        <Badge
                          variant={
                            !host.online
                              ? 'secondary'
                              : host.busy
                                ? 'warning'
                                : 'success'
                          }
                        >
                          {!host.online
                            ? '离线'
                            : host.busy
                              ? '使用中'
                              : '在线'}
                        </Badge>
                      </div>
                    </div>
                    <CardTitle className='break-all'>{host.name}</CardTitle>
                    <CardDescription>
                      {host.kind === 'linux-x11'
                        ? 'Linux 系统桌面 · 实时控制'
                        : host.kind === 'windows'
                          ? 'Windows 桌面 · 实时控制'
                          : '临时浏览器 · 画面观看'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className='mb-2 text-sm'>
                      {host.group || '未分组'}
                      {host.note ? ` · ${host.note}` : ''}
                    </p>
                    {host.accessToken && (
                      <p className='mb-2 text-sm text-muted-foreground'>
                        主机密钥：{host.accessToken.name}
                      </p>
                    )}
                    {!host.online && (
                      <div className='mb-3 flex flex-col gap-2 text-sm'>
                        <p>
                          最近在线：
                          {host.lastSeenAt
                            ? new Date(host.lastSeenAt).toLocaleString()
                            : '未知'}
                        </p>
                        <p>{hostOfflineHint(host)}</p>
                        {host.accessToken?.status !== 'active' && (
                          <a href='/management/tokens' className='underline'>
                            管理主机密钥
                          </a>
                        )}
                      </div>
                    )}
                    {host.stats && (
                      <p className='mb-2 text-sm'>
                        CPU {host.stats.cpu.toFixed(0)}% · 内存{' '}
                        {(
                          (host.stats.memoryUsed / host.stats.memoryTotal) *
                          100
                        ).toFixed(0)}
                        % · 磁盘{' '}
                        {(
                          (host.stats.diskUsed / host.stats.diskTotal) *
                          100
                        ).toFixed(0)}
                        %
                        {!host.online ||
                        Date.now() - host.stats.sampledAt > 15000
                          ? '（已过期）'
                          : ''}
                      </p>
                    )}
                    <p className='text-sm text-muted-foreground'>
                      {host.capabilities.systemInput
                        ? host.kind === 'windows'
                          ? '支持普通桌面的鼠标、键盘与文本输入。锁屏和 UAC 安全桌面不可操作。'
                          : '支持系统鼠标、键盘与英文文本。卡顿时建议选择 540p 或 360p。'
                        : '观看共享画面。浏览器无法操作本机系统鼠标和键盘。'}
                    </p>
                  </CardContent>
                  <CardFooter className='flex flex-col gap-2'>
                    {host.online && host.capabilities.remoteSharing && (
                      <Button
                        variant='outline'
                        className='w-full'
                        onClick={() => {
                          location.href = `/shares?host=${encodeURIComponent(host.id)}`
                        }}
                      >
                        分享远程主机
                      </Button>
                    )}
                    <Button
                      variant='outline'
                      className='w-full'
                      onClick={() => setWorkspace(host)}
                    >
                      {host.online
                        ? '状态 / 终端 / 文件'
                        : '查看档案 / 编辑备注'}
                    </Button>
                    <Button
                      className='w-full'
                      disabled={!host.online || host.busy || loading}
                      onClick={() => void connect(host)}
                    >
                      <Radio data-icon='inline-start' />
                      {!host.online
                        ? '主机离线'
                        : host.busy
                          ? '已有活动会话'
                          : host.kind === 'browser'
                            ? '观看画面'
                            : '连接桌面'}
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
            安装 Linux 或 Windows
            客户端后即可查看并操作对应电脑。临时浏览器接入可分享画面，停止后需要重新选择屏幕。
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
