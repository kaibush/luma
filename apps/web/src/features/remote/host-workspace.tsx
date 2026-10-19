import { useEffect, useRef, useState } from 'react'
import type { Host, IceServer, Session } from '@remote/protocol'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  Folder,
  File as FileIcon,
  Upload,
  Download,
  ChevronRight,
  Home,
  RefreshCw,
  FolderPlus,
  Search,
  TerminalSquare,
  Copy,
  ClipboardPaste,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { api, signaling, sendSignal } from './api'
import { hostOfflineHint } from './host-status'
import { RemotePeer } from './peer'
import type { ToolClient } from './tool-client'

export const bytes = (value: number) =>
  value >= 1073741824
    ? `${(value / 1073741824).toFixed(1)} GiB`
    : value >= 1048576
      ? `${(value / 1048576).toFixed(1)} MiB`
      : value >= 1024
        ? `${(value / 1024).toFixed(1)} KiB`
        : `${value} B`
export function DeviceStatus({ host }: { host: Host }) {
  const s = host.stats
  return (
    <div className='flex flex-col gap-3'>
      {!host.online && (
        <Alert>
          <AlertDescription>{hostOfflineHint(host)}</AlertDescription>
        </Alert>
      )}
      {!s ? (
        <p>
          {host.kind === 'browser'
            ? '临时浏览器接入不提供系统状态。'
            : '暂无客户端状态数据。'}
        </p>
      ) : (
        <>
          <p className='text-sm text-muted-foreground'>
            {s.platform} · 客户端 {s.version} ·{' '}
            {!host.online || Date.now() - s.sampledAt > 15000
              ? '历史数据'
              : '每 5 秒更新'}
          </p>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
            {[
              ['CPU', `${s.cpu.toFixed(1)}%`],
              ['内存', `${bytes(s.memoryUsed)} / ${bytes(s.memoryTotal)}`],
              ['主目录磁盘', `${bytes(s.diskUsed)} / ${bytes(s.diskTotal)}`],
              ['运行时间', `${Math.floor(s.uptime / 3600)} 小时`],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader>
                  <CardDescription>{label}</CardDescription>
                  <CardTitle>{value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <p className='text-sm'>
            视频编码：{s.encoder === 'idle' ? '未采集桌面' : s.encoder}
          </p>
        </>
      )}
    </div>
  )
}
function TerminalPanel({
  client,
  onError,
}: {
  client: ToolClient
  onError: (s: string) => void
}) {
  const node = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const resize = useRef<() => void>(() => {})
  const write = useRef<(text: string) => void>(() => {})
  const [restart, setRestart] = useState(0)
  const [state, setState] = useState('正在打开')
  const [command, setCommand] = useState('')
  const [fontSize, setFontSize] = useState(14)
  useEffect(() => {
    let disposed = false,
      opened = false
    const term = new Terminal({
      cursorBlink: true,
      scrollback: 3000,
      fontSize: 14,
      allowProposedApi: false,
    })
    // Never accept OSC 52 clipboard writes from terminal output.
    term.parser.registerOscHandler(52, () => true)
    const fit = new FitAddon()
    term.loadAddon(fit)
    terminal.current = term
    term.open(node.current!)
    if (node.current!.clientWidth) fit.fit()
    setState('正在打开')
    let queued = 0
    let chain = Promise.resolve()
    const send = (op: string, args: Record<string, unknown>) => {
      const size = typeof args.text === 'string' ? args.text.length : 1
      if (queued + size > 65536) {
        setState('已断开')
        opened = false
        onError('输入积压过多，终端已停止，请重新打开')
        void client.call('terminal.close').catch(() => {})
        return
      }
      queued += size
      chain = chain
        .then(async () => {
          if (!disposed && opened) await client.call(op, args)
        })
        .catch((e) => {
          if (!disposed) onError(e.message)
        })
        .finally(() => {
          queued -= size
        })
    }
    write.current = (text) => {
      for (let i = 0; i < text.length; i += 1024)
        send('terminal.input', { text: text.slice(i, i + 1024) })
    }
    const input = term.onData((text) => write.current(text))
    client.onEvent = (e) => {
      if (e.event === 'terminal' && e.text) term.write(e.text)
      if (e.event === 'terminal-exit' && opened) {
        opened = false
        setState('已退出')
        term.write('\r\n[终端已退出，点击重新打开继续]\r\n')
      }
    }
    void client
      .call('terminal.open', {
        cols: Math.min(400, term.cols),
        rows: Math.min(200, term.rows),
      })
      .then(() => {
        if (!disposed) {
          opened = true
          setState('已连接')
          term.focus()
        }
      })
      .catch((e) => {
        if (!disposed) onError(e.message)
      })
    resize.current = () => {
      if (!node.current?.clientWidth || !node.current?.clientHeight) return
      fit.fit()
      send('terminal.resize', {
        cols: Math.min(400, term.cols),
        rows: Math.min(200, term.rows),
      })
    }
    const observer = new ResizeObserver(() => resize.current())
    observer.observe(node.current!)
    return () => {
      disposed = true
      client.onEvent = undefined
      observer.disconnect()
      input.dispose()
      terminal.current = null
      write.current = () => {}
      term.dispose()
      void client.call('terminal.close').catch(() => {})
    }
  }, [client, onError, restart])
  useEffect(() => {
    if (terminal.current) {
      terminal.current.options.fontSize = fontSize
      resize.current()
    }
  }, [fontSize])
  return (
    <div className='flex h-full min-h-0 flex-col gap-2'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2 text-sm'>
          <TerminalSquare className='size-4' />
          <Badge variant={state === '已连接' ? 'success' : 'secondary'}>
            {state}
          </Badge>
        </div>
        <div className='flex flex-wrap gap-1'>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => terminal.current?.clear()}
          >
            清屏
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={() =>
              void navigator.clipboard
                .writeText(terminal.current?.getSelection() || '')
                .catch(() => onError('请选中文字后手动复制'))
            }
          >
            <Copy className='size-4' />
            复制
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={() =>
              void navigator.clipboard
                .readText()
                .then((text) => {
                  terminal.current?.paste(text)
                  terminal.current?.focus()
                })
                .catch(() =>
                  onError('浏览器不允许读取剪贴板，请粘贴到下方输入框')
                )
            }
          >
            <ClipboardPaste className='size-4' />
            粘贴
          </Button>
          <select
            aria-label='终端字号'
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className='rounded-md border bg-background px-2 text-xs'
          >
            <option value={12}>12px</option>
            <option value={14}>14px</option>
            <option value={16}>16px</option>
            <option value={18}>18px</option>
          </select>
          {state !== '已连接' && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => setRestart((n) => n + 1)}
            >
              重新打开
            </Button>
          )}
        </div>
      </div>
      <div
        ref={node}
        className='min-h-0 flex-1 overflow-hidden rounded-lg bg-black p-2'
        aria-label='远程终端'
      />
      <div className='flex gap-1 overflow-x-auto'>
        {[
          ['Ctrl+C', '\x03'],
          ['Tab', '\t'],
          ['Esc', '\x1b'],
          ['↑', '\x1b[A'],
          ['↓', '\x1b[B'],
          ['←', '\x1b[D'],
          ['→', '\x1b[C'],
        ].map(([label, text]) => (
          <Button
            key={label}
            size='sm'
            variant='outline'
            disabled={state !== '已连接'}
            onClick={() => {
              write.current(text)
              terminal.current?.focus()
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <form
        className='flex gap-2'
        onSubmit={(e) => {
          e.preventDefault()
          write.current(command + '\r')
          setCommand('')
        }}
      >
        <Input
          aria-label='终端命令'
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder='手机输入命令，回车执行'
          autoComplete='off'
          autoCapitalize='none'
          spellCheck={false}
          disabled={state !== '已连接'}
        />
        <Button disabled={state !== '已连接' || !command} type='submit'>
          执行
        </Button>
      </form>
    </div>
  )
}

type Listing = {
  entries: {
    name: string
    directory: boolean
    size: number
    modified?: number
  }[]
  next: number | null
  root?: string
}
function FilePanel({ client }: { client: ToolClient }) {
  const [path, setPath] = useState(''),
    [listing, setListing] = useState<Listing>({ entries: [], next: null })
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('')
  const [query, setQuery] = useState(''),
    [progress, setProgress] = useState(''),
    [percent, setPercent] = useState(0)
  const [folder, setFolder] = useState<string | null>(null)
  const [transfers, setTransfers] = useState<string[]>([])
  const canceled = useRef(false),
    mounted = useRef(true),
    locked = useRef(false),
    generation = useRef(0)
  const upload = useRef<HTMLInputElement>(null)
  const refresh = async (directory = path, offset = 0) => {
    const current = ++generation.current
    setLoading(true)
    try {
      const data = await client.call<Listing>('files.list', {
        path: directory,
        offset,
      })
      if (!mounted.current || generation.current !== current) return
      setListing((previous) =>
        offset
          ? {
              ...data,
              entries: [...previous.entries, ...data.entries].filter(
                (e, i, all) => all.findIndex((v) => v.name === e.name) === i
              ),
            }
          : data
      )
      setPath(directory)
      setError('')
      if (directory !== path) setQuery('')
    } catch (e) {
      if (mounted.current) setError((e as Error).message)
    } finally {
      if (mounted.current && generation.current === current) setLoading(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    canceled.current = false
    void refresh('')
    return () => {
      mounted.current = false
      canceled.current = true
      ++generation.current
      void client.call('files.cancel').catch(() => {})
    }
  }, [client]) // eslint-disable-line react-hooks/exhaustive-deps
  const transfer = async (name: string, files?: File[]) => {
    if (locked.current) return
    locked.current = true
    canceled.current = false
    setBusy(true)
    setError('')
    setPercent(0)
    try {
      const jobs = files || [null]
      for (let index = 0; index < jobs.length; index++) {
        if (canceled.current) throw new Error('已取消传输')
        const file = jobs[index],
          filename = file?.name || name
        const remotePath = [path, filename].filter(Boolean).join('/')
        const began = performance.now()
        const report = (done: number, total: number) => {
          if (!mounted.current) return
          setPercent(Math.round((done / Math.max(total, 1)) * 100))
          setProgress(
            `${file ? '上传' : '下载'} ${filename} · ${index + 1}/${jobs.length} · ${bytes(done)} / ${bytes(total)} · ${bytes(done / Math.max((performance.now() - began) / 1000, 0.1))}/s`
          )
        }
        if (file) {
          if (file.size > 268435456)
            throw new Error(`${filename} 超过单文件 256 MiB 上限`)
          report(0, file.size)
          await client.call('files.upload', {
            path: remotePath,
            size: file.size,
          })
          // Four ordered chunks per round-trip; keep the receiver's bounded queue below its limit.
          for (let offset = 0; offset < file.size; offset += 49152) {
            if (canceled.current) throw new Error('已取消传输')
            const data = new Uint8Array(
              await file.slice(offset, offset + 49152).arrayBuffer()
            )
            if (canceled.current) throw new Error('已取消传输')
            const batch = []
            for (let n = 0; n < data.length; n += 12288)
              batch.push(
                client.call('files.chunk', {
                  data: btoa(
                    String.fromCharCode(...data.subarray(n, n + 12288))
                  ),
                })
              )
            const results = await Promise.allSettled(batch)
            const failed = results.find((r) => r.status === 'rejected')
            if (failed?.status === 'rejected') throw failed.reason
            report(offset + data.length, file.size)
          }
          if (canceled.current) throw new Error('已取消传输')
          await client.call('files.finish')
        } else {
          const { size } = await client.call<{ size: number }>(
            'files.download',
            { path: remotePath }
          )
          if (size > 268435456) throw new Error('单文件上限 256 MiB')
          const parts: Uint8Array<ArrayBuffer>[] = []
          let received = 0
          report(0, size)
          while (received < size) {
            if (canceled.current) throw new Error('已取消传输')
            const count = Math.min(4, Math.ceil((size - received) / 12288))
            const results = await Promise.allSettled(
              Array.from({ length: count }, () =>
                client.call<{ data: string; done: boolean }>('files.read')
              )
            )
            for (const result of results) {
              if (result.status === 'rejected') throw result.reason
              const data = Uint8Array.from(atob(result.value.data), (c) =>
                c.charCodeAt(0)
              )
              if (!data.length || received + data.length > size)
                throw new Error('远程文件发生变化，请重试')
              received += data.length
              parts.push(data)
            }
            report(received, size)
          }
          const tail = await client.call<{ data: string; done: boolean }>(
            'files.read'
          )
          if (!tail.done || tail.data)
            throw new Error('远程文件发生变化，请重试')
          if (canceled.current) throw new Error('已取消传输')
          const url = URL.createObjectURL(new Blob(parts)),
            a = document.createElement('a')
          a.href = url
          a.download = filename
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 60000)
        }
        await client.call('files.cancel')
        if (mounted.current)
          setTransfers((v) =>
            [`${filename} · ${file ? '上传' : '下载'}完成`, ...v].slice(0, 5)
          )
      }
      if (mounted.current) {
        setPercent(100)
        setProgress('传输完成')
        await refresh()
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message)
    } finally {
      await client.call('files.cancel').catch(() => {})
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const entries = listing.entries
    .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name)
    )
  return (
    <div
      className='flex h-full min-h-0 flex-col gap-3'
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (!busy && e.dataTransfer.files.length)
          void transfer('', Array.from(e.dataTransfer.files))
      }}
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          size='sm'
          variant='outline'
          disabled={busy || loading || !path}
          onClick={() => void refresh(path.split('/').slice(0, -1).join('/'))}
        >
          上一级
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={busy || loading}
          onClick={() => void refresh()}
        >
          <RefreshCw className='size-4' />
          刷新
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={busy || loading}
          onClick={() => setFolder('')}
        >
          <FolderPlus className='size-4' />
          新建文件夹
        </Button>
        <Button
          size='sm'
          disabled={busy || loading}
          onClick={() => upload.current?.click()}
        >
          <Upload className='size-4' />
          上传文件
        </Button>
        <input
          ref={upload}
          aria-label='上传到当前目录'
          type='file'
          multiple
          className='sr-only'
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.length)
              void transfer('', Array.from(e.target.files))
            e.target.value = ''
          }}
        />
      </div>
      <nav
        aria-label='文件路径'
        className='flex shrink-0 items-center gap-1 overflow-x-auto rounded-lg bg-muted px-2 py-1'
      >
        <Button
          size='sm'
          variant='ghost'
          disabled={busy || loading}
          onClick={() => void refresh('')}
        >
          <Home className='size-4' />
          共享目录
        </Button>
        {path
          .split('/')
          .filter(Boolean)
          .map((part, i, all) => (
            <span className='flex shrink-0 items-center' key={i}>
              <ChevronRight className='size-3' />
              <Button
                variant='ghost'
                size='sm'
                disabled={busy || loading}
                onClick={() => void refresh(all.slice(0, i + 1).join('/'))}
              >
                {part}
              </Button>
            </span>
          ))}
      </nav>
      <div className='flex items-center gap-2'>
        <Search className='size-4 shrink-0 text-muted-foreground' />
        <Input
          aria-label='搜索当前文件'
          placeholder='搜索已加载文件'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className='shrink-0 text-xs text-muted-foreground'>
          {listing.entries.length} 项
        </span>
      </div>
      {error && (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div
        className='min-h-0 flex-1 overflow-auto rounded-lg border'
        aria-busy={loading}
      >
        <div className='sticky top-0 flex justify-between border-b bg-muted px-3 py-2 text-xs text-muted-foreground'>
          <span>名称</span>
          <span>大小 / 操作</span>
        </div>
        {!entries.length && (
          <div className='flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground'>
            <Folder className='size-8' />
            {loading
              ? '正在读取目录…'
              : query
                ? '没有匹配的文件'
                : '文件夹为空，可拖入文件或点击上传'}
          </div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.name}
            className='flex items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50'
          >
            {entry.directory ? (
              <Folder className='size-4 shrink-0 text-primary' />
            ) : (
              <FileIcon className='size-4 shrink-0 text-muted-foreground' />
            )}
            <div className='min-w-0 flex-1'>
              {entry.directory ? (
                <button
                  className='w-full truncate text-start text-sm hover:underline disabled:opacity-50'
                  disabled={busy || loading}
                  onClick={() =>
                    void refresh([path, entry.name].filter(Boolean).join('/'))
                  }
                >
                  {entry.name}
                </button>
              ) : (
                <p className='truncate text-sm' title={entry.name}>
                  {entry.name}
                </p>
              )}
            </div>
            <span className='shrink-0 text-xs text-muted-foreground'>
              {entry.directory ? '文件夹' : bytes(entry.size)}
            </span>
            {!entry.directory && (
              <Button
                size='icon'
                variant='ghost'
                disabled={busy}
                aria-label={`下载 · ${entry.name}`}
                onClick={() => void transfer(entry.name)}
              >
                <Download className='size-4' />
              </Button>
            )}
          </div>
        ))}
        {listing.next !== null && (
          <Button
            className='m-2'
            size='sm'
            variant='outline'
            disabled={busy || loading}
            onClick={() => void refresh(path, listing.next!)}
          >
            加载更多
          </Button>
        )}
      </div>
      {(busy || progress) && (
        <div className='flex flex-col gap-2 rounded-lg border p-3'>
          <div className='flex items-center gap-2'>
            <p role='status' className='min-w-0 flex-1 truncate text-xs'>
              {progress}
            </p>
            {busy && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  canceled.current = true
                }}
              >
                取消传输
              </Button>
            )}
          </div>
          <progress
            aria-label='文件传输进度'
            className='h-1.5 w-full accent-primary'
            max={100}
            value={percent}
          />
        </div>
      )}
      {!busy && transfers.length > 0 && (
        <details className='text-xs text-muted-foreground'>
          <summary className='cursor-pointer'>
            最近传输 · {transfers.length} 项
          </summary>
          {transfers.map((item, i) => (
            <p className='mt-1 truncate' key={i}>
              {item}
            </p>
          ))}
        </details>
      )}
      <p
        className='truncate text-xs text-muted-foreground'
        title={listing.root}
      >
        {listing.root || '客户端共享目录'} · 单文件最高 256 MiB · 同名不覆盖
      </p>
      <Dialog
        open={folder !== null}
        onOpenChange={(open) => {
          if (!open) setFolder(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
            <DialogDescription>在当前目录创建文件夹。</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              if (locked.current) return
              if (
                !folder?.trim() ||
                /[\/\\]/.test(folder) ||
                ['.', '..'].includes(folder)
              ) {
                setError('请输入有效的文件夹名称，不要包含路径分隔符')
                return
              }
              locked.current = true
              setBusy(true)
              try {
                await client.call('files.mkdir', {
                  path: [path, folder].filter(Boolean).join('/'),
                })
                setFolder(null)
                await refresh()
              } catch (e) {
                setError((e as Error).message)
              } finally {
                locked.current = false
                setBusy(false)
              }
            }}
          >
            <Field>
              <FieldLabel htmlFor='new-folder'>文件夹名称</FieldLabel>
              <Input
                id='new-folder'
                autoFocus
                required
                maxLength={128}
                value={folder || ''}
                onChange={(e) => setFolder(e.target.value)}
              />
            </Field>
            <DialogFooter className='mt-4'>
              <Button disabled={busy} type='submit'>
                创建文件夹
              </Button>
            </DialogFooter>
            {error && <p className='mt-2 text-sm text-destructive'>{error}</p>}
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function HostWorkspace({
  host,
  onClose,
  onDesktop,
}: {
  host: Host
  onClose: () => void
  onDesktop: () => void
}) {
  const [viewport, setViewport] = useState({
    height: window.visualViewport?.height || window.innerHeight,
    top: window.visualViewport?.offsetTop || 0,
  })
  useEffect(() => {
    const update = () =>
      setViewport({
        height: window.visualViewport?.height || window.innerHeight,
        top: window.visualViewport?.offsetTop || 0,
      })
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [])
  const [tab, setTab] = useState('status'),
    [client, setClient] = useState<ToolClient>(),
    [error, setError] = useState('')
  const [group, setGroup] = useState(host.group || ''),
    [note, setNote] = useState(host.note || ''),
    [saving, setSaving] = useState(false),
    [editingMeta, setEditingMeta] = useState(false)
  const cleanup = useRef<() => Promise<void>>(async () => {})
  const [visited, setVisited] = useState({ terminal: false, files: false })
  const [attempt, setAttempt] = useState(0)
  const needTools = visited.terminal || visited.files
  useEffect(() => {
    if (!needTools || !host.online) return
    let disposed = false,
      ws: WebSocket | undefined,
      peer: RemotePeer | undefined,
      session: Session | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const close = async () => {
      clearTimeout(timeout)
      peer?.close()
      ws?.close()
      if (session)
        await api(`/sessions/${session.id}`, '', { method: 'DELETE' }).catch(
          () => {}
        )
    }
    cleanup.current = close
    timeout = setTimeout(() => {
      if (!disposed) {
        disposed = true
        setClient(undefined)
        setError('连接超时，请检查主机网络后重试')
        void close()
      }
    }, 30000)
    void api<{ session: Session; iceServers: IceServer[] }>('/sessions', '', {
      method: 'POST',
      body: JSON.stringify({ hostId: host.id, mode: 'tools' }),
    })
      .then(async (result) => {
        session = result.session
        if (disposed) {
          await close()
          return
        }
        ws = signaling(
          { role: 'controller', token: '', sessionId: session.id },
          (message) => {
            if (disposed) return
            if (message.type === 'ready')
              void peer?.offer().catch((e) => setError(e.message))
            else if (message.type === 'ended' || message.type === 'error') {
              setError(
                message.type === 'ended' ? message.reason : message.message
              )
              setClient(undefined)
              peer?.close()
            } else if (['offer', 'answer', 'ice'].includes(message.type))
              void peer?.handle(message as Parameters<RemotePeer['handle']>[0])
          },
          () => {
            if (!disposed) {
              setError('工具会话已断开，请点击重新连接')
              setClient(undefined)
              peer?.close()
            }
          }
        )
        peer = new RemotePeer({
          role: 'controller',
          mode: 'tools',
          tools: true,
          quality: session.quality,
          iceServers: result.iceServers,
          signal: (m) => sendSignal(ws, { ...m, sessionId: session!.id }),
          onState: (s) => {
            if (!disposed && s === 'failed') {
              setError('工具连接失败，请重试')
              void close()
            }
          },
          onTools: (c) => {
            clearTimeout(timeout)
            if (!disposed) {
              setClient(c)
              setError('')
            }
          },
        })
      })
      .catch((e) => {
        if (!disposed) setError(e.message)
      })
    return () => {
      disposed = true
      setClient(undefined)
      void close()
    }
  }, [host.id, host.online, needTools, attempt])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        style={{
          height: viewport.height * 0.92,
          top: viewport.top + viewport.height / 2,
        }}
        className='flex h-[92dvh] max-w-[calc(100%-1rem)] flex-col gap-3 overflow-hidden p-3 sm:max-w-6xl sm:p-5'
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (tab === 'terminal') e.preventDefault()
        }}
      >
        <DialogHeader>
          <div className='flex items-center justify-between gap-3'>
            <DialogTitle>{host.name}</DialogTitle>
            <Button variant='outline' onClick={onClose}>
              关闭
            </Button>
          </div>
          <DialogDescription>
            设备工作区 · 切换页签保留终端和传输，关闭窗口结束会话
          </DialogDescription>
        </DialogHeader>
        <div className='flex min-h-0 flex-1 flex-col gap-2'>
          <Tabs
            className='min-h-0 flex-1'
            value={tab}
            onValueChange={(value) => {
              setTab(value)
              if (value === 'terminal' || value === 'files')
                setVisited((v) => ({ ...v, [value]: true }))
            }}
          >
            <TabsList>
              <TabsTrigger value='status'>状态</TabsTrigger>
              <TabsTrigger
                value='terminal'
                disabled={!host.online || !host.capabilities.terminal}
              >
                终端
              </TabsTrigger>
              <TabsTrigger
                value='files'
                disabled={!host.online || !host.capabilities.files}
              >
                文件
              </TabsTrigger>
              <TabsTrigger value='desktop' disabled={!host.online}>
                桌面
              </TabsTrigger>
            </TabsList>
            <TabsContent value='status' className='overflow-y-auto pr-1'>
              <DeviceStatus host={host} />
              <div className='mt-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3'>
                <div className='min-w-0'>
                  <p className='text-sm font-medium'>分组与备注</p>
                  <p className='truncate text-sm text-muted-foreground'>
                    {group || '未分组'}
                    {note ? ` · ${note}` : ''}
                  </p>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setEditingMeta(true)}
                >
                  编辑
                </Button>
              </div>
              <Dialog open={editingMeta} onOpenChange={setEditingMeta}>
                <DialogContent className='sm:max-w-md'>
                  <DialogHeader>
                    <DialogTitle>分组与备注</DialogTitle>
                    <DialogDescription>
                      只改变这台主机在控制台中的归类，不影响远程连接。
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    className='flex flex-col gap-5'
                    onSubmit={async (e) => {
                      e.preventDefault()
                      setSaving(true)
                      try {
                        await api(`/hosts/${host.id}`, '', {
                          method: 'PUT',
                          body: JSON.stringify({ group, note }),
                        })
                        setError('')
                        setEditingMeta(false)
                      } catch (err) {
                        setError((err as Error).message)
                      } finally {
                        setSaving(false)
                      }
                    }}
                  >
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor='group'>主机分组</FieldLabel>
                        <Input
                          id='group'
                          value={group}
                          maxLength={60}
                          onChange={(e) => setGroup(e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor='note'>备注</FieldLabel>
                        <Input
                          id='note'
                          value={note}
                          maxLength={500}
                          onChange={(e) => setNote(e.target.value)}
                        />
                      </Field>
                    </FieldGroup>
                    <DialogFooter>
                      <Button
                        type='button'
                        variant='outline'
                        disabled={saving}
                        onClick={() => setEditingMeta(false)}
                      >
                        取消
                      </Button>
                      <Button disabled={saving} type='submit'>
                        保存
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </TabsContent>
            <TabsContent
              value='terminal'
              forceMount
              className='min-h-0 data-[state=inactive]:hidden'
            >
              {client && visited.terminal ? (
                <TerminalPanel client={client} onError={setError} />
              ) : (
                <p className='p-4 text-sm text-muted-foreground'>
                  {error ? '终端连接不可用' : '正在连接终端通道…'}
                </p>
              )}
            </TabsContent>
            <TabsContent
              value='files'
              forceMount
              className='min-h-0 data-[state=inactive]:hidden'
            >
              {client && visited.files ? (
                <FilePanel client={client} />
              ) : (
                <p className='p-4 text-sm text-muted-foreground'>
                  {error ? '文件连接不可用' : '正在连接文件通道…'}
                </p>
              )}
            </TabsContent>
            <TabsContent value='desktop'>
              <Button
                disabled={!host.online}
                onClick={() => {
                  void cleanup.current().then(onDesktop)
                }}
              >
                连接桌面
              </Button>
            </TabsContent>
          </Tabs>
          {error && (
            <Alert variant='destructive'>
              <AlertDescription>
                {error}
                {needTools && !client && (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      setError('')
                      setAttempt((n) => n + 1)
                    }}
                  >
                    重新连接
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          <p className='text-xs text-muted-foreground'>
            终端与文件需在被控客户端开启权限。{' '}
            <a
              className='underline'
              href='/guide/tools'
              target='_blank'
              rel='noreferrer'
            >
              查看使用指南
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
