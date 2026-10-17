import { useEffect, useRef, useState } from 'react'
import type { Host, IceServer, Session } from '@remote/protocol'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { Field, FieldLabel, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { api, signaling, sendSignal } from './api'
import { RemotePeer } from './peer'
import type { ToolClient } from './tool-client'

export const bytes = (value: number) =>
  value >= 1073741824
    ? `${(value / 1073741824).toFixed(1)} GiB`
    : `${(value / 1048576).toFixed(1)} MiB`
export function DeviceStatus({ host }: { host: Host }) {
  const s = host.stats
  return (
    <div className='flex flex-col gap-3'>
      {!s ? (
        <p>客户端尚未上报状态，请更新客户端。</p>
      ) : (
        <>
          <p className='text-sm text-muted-foreground'>
            {s.platform} · 客户端 {s.version} ·{' '}
            {Date.now() - s.sampledAt > 15000 ? '数据已过期' : '每 5 秒更新'}
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
    term.open(node.current!)
    fit.fit()
    let queued = 0
    let chain = Promise.resolve()
    const send = (op: string, args: Record<string, unknown>) => {
      const size = typeof args.text === 'string' ? args.text.length : 1
      if (queued + size > 65536) {
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
    const input = term.onData((text) => {
      for (let i = 0; i < text.length; i += 1024)
        send('terminal.input', { text: text.slice(i, i + 1024) })
    })
    client.onEvent = (e) => {
      if (e.event === 'terminal' && e.text) term.write(e.text)
      if (e.event === 'terminal-exit' && opened) {
        opened = false
        term.write('\r\n[终端已退出，切换页签可重新打开]\r\n')
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
          term.focus()
        }
      })
      .catch((e) => {
        if (!disposed) onError(e.message)
      })
    const observer = new ResizeObserver(() => {
      fit.fit()
      send('terminal.resize', {
        cols: Math.min(400, term.cols),
        rows: Math.min(200, term.rows),
      })
    })
    observer.observe(node.current!)
    return () => {
      disposed = true
      client.onEvent = undefined
      observer.disconnect()
      input.dispose()
      term.dispose()
      void client.call('terminal.close').catch(() => {})
    }
  }, [client, onError])
  return (
    <div
      ref={node}
      className='h-[55dvh] min-h-64 w-full overflow-hidden'
      aria-label='远程终端'
    />
  )
}
type Listing = {
  entries: { name: string; directory: boolean; size: number }[]
  next: number | null
}
function FilePanel({ client }: { client: ToolClient }) {
  const [path, setPath] = useState(''),
    [listing, setListing] = useState<Listing>({ entries: [], next: null })
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState('')
  const canceled = useRef(false),
    mounted = useRef(true)
  const refresh = async (directory = path, offset = 0) => {
    try {
      const data = await client.call<Listing>('files.list', {
        path: directory,
        offset,
      })
      if (mounted.current) {
        setListing(data)
        setPath(directory)
        setError('')
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message)
    }
  }
  useEffect(() => {
    mounted.current = true
    void refresh('')
    return () => {
      mounted.current = false
      canceled.current = true
      void client.call('files.cancel').catch(() => {})
    }
  }, [client]) // eslint-disable-line react-hooks/exhaustive-deps
  const transfer = async (name: string, file?: File) => {
    canceled.current = false
    setBusy(true)
    setError('')
    try {
      const remotePath = [path, name].filter(Boolean).join('/')
      if (file) {
        await client.call('files.upload', { path: remotePath, size: file.size })
        for (let offset = 0; offset < file.size; offset += 12288) {
          if (canceled.current) throw new Error('已取消传输')
          const data = new Uint8Array(
            await file.slice(offset, offset + 12288).arrayBuffer()
          )
          await client.call('files.chunk', {
            data: btoa(String.fromCharCode(...data)),
          })
          if (mounted.current)
            setProgress(
              `上传 ${Math.min(100, Math.round(((offset + data.length) / file.size) * 100))}%`
            )
        }
        if (canceled.current) throw new Error('已取消传输')
        await client.call('files.finish')
        await refresh()
      } else {
        const { size } = await client.call<{ size: number }>('files.download', {
          path: remotePath,
        })
        if (size > 268435456) throw new Error('单文件上限 256 MiB')
        const parts: Uint8Array<ArrayBuffer>[] = []
        let received = 0
        while (true) {
          if (canceled.current) throw new Error('已取消传输')
          const chunk = await client.call<{ data: string; done: boolean }>(
            'files.read'
          )
          if (chunk.done) break
          const data = Uint8Array.from(atob(chunk.data), (c) => c.charCodeAt(0))
          received += data.length
          if (received > size)
            throw new Error('远程文件在传输中发生变化，请重试')
          parts.push(data)
          if (mounted.current)
            setProgress(
              `下载 ${Math.round((received / Math.max(size, 1)) * 100)}%`
            )
        }
        if (received !== size)
          throw new Error('远程文件在传输中发生变化，请重试')
        if (canceled.current) throw new Error('已取消传输')
        const url = URL.createObjectURL(new Blob(parts)),
          a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 60000)
      }
      if (mounted.current) setProgress('传输完成')
    } catch (e) {
      if (mounted.current) setError((e as Error).message)
    } finally {
      await client.call('files.cancel').catch(() => {})
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <div className='flex flex-col gap-3'>
      <p className='text-sm text-muted-foreground'>
        共享目录 /{path} · 单文件最高 256 MiB · 同名文件不会覆盖
      </p>
      <div className='flex flex-wrap gap-2'>
        <Button
          variant='outline'
          disabled={busy || !path}
          onClick={() => void refresh(path.split('/').slice(0, -1).join('/'))}
        >
          上一级
        </Button>
        <Button
          variant='outline'
          disabled={busy}
          onClick={() => void refresh()}
        >
          刷新
        </Button>
      </div>
      <Field>
        <FieldLabel htmlFor='upload'>上传到当前目录</FieldLabel>
        <Input
          id='upload'
          type='file'
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void transfer(file.name, file)
            e.target.value = ''
          }}
        />
      </Field>
      {error && (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div role='status'>
        {progress}{' '}
        {busy && (
          <Button
            variant='outline'
            onClick={() => {
              canceled.current = true
            }}
          >
            取消传输
          </Button>
        )}
      </div>
      <div className='flex max-h-[45dvh] flex-col gap-2 overflow-auto'>
        {listing.entries.map((entry) => (
          <Button
            key={entry.name}
            variant='outline'
            className='justify-between'
            disabled={busy}
            onClick={() =>
              entry.directory
                ? void refresh([path, entry.name].filter(Boolean).join('/'))
                : void transfer(entry.name)
            }
          >
            <span className='truncate'>
              {entry.directory ? '目录' : '下载'} · {entry.name}
            </span>
            <span>{entry.directory ? '' : bytes(entry.size)}</span>
          </Button>
        ))}
      </div>
      {listing.next !== null && (
        <Button
          variant='outline'
          disabled={busy}
          onClick={() => void refresh(path, listing.next!)}
        >
          下一页
        </Button>
      )}
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
  const [tab, setTab] = useState('status'),
    [client, setClient] = useState<ToolClient>(),
    [error, setError] = useState('')
  const [group, setGroup] = useState(host.group || ''),
    [note, setNote] = useState(host.note || ''),
    [saving, setSaving] = useState(false)
  const cleanup = useRef<() => Promise<void>>(async () => {})
  const needTools = tab === 'terminal' || tab === 'files'
  useEffect(() => {
    if (!needTools) return
    let disposed = false,
      ws: WebSocket | undefined,
      peer: RemotePeer | undefined,
      session: Session | undefined
    const close = async () => {
      peer?.close()
      ws?.close()
      if (session)
        await api(`/sessions/${session.id}`, '', { method: 'DELETE' }).catch(
          () => {}
        )
    }
    cleanup.current = close
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
              setError('工具会话已断开，切换到状态页后可重新打开')
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
  }, [host.id, needTools])
  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between gap-3'>
          <CardTitle>{host.name}</CardTitle>
          <Button variant='outline' onClick={onClose}>
            关闭
          </Button>
        </div>
        <CardDescription>桌面、终端、文件与设备状态</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value='status'>状态</TabsTrigger>
            <TabsTrigger
              value='terminal'
              disabled={!host.capabilities.terminal}
            >
              终端
            </TabsTrigger>
            <TabsTrigger value='files' disabled={!host.capabilities.files}>
              文件
            </TabsTrigger>
            <TabsTrigger value='desktop'>桌面</TabsTrigger>
          </TabsList>
          <TabsContent value='status'>
            <DeviceStatus host={host} />
            <form
              className='mt-4'
              onSubmit={async (e) => {
                e.preventDefault()
                setSaving(true)
                try {
                  await api(`/hosts/${host.id}`, '', {
                    method: 'PUT',
                    body: JSON.stringify({ group, note }),
                  })
                  setError('')
                } catch (e) {
                  setError((e as Error).message)
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
                <Button disabled={saving}>保存分组与备注</Button>
              </FieldGroup>
            </form>
          </TabsContent>
          <TabsContent value='terminal'>
            {client ? (
              <TerminalPanel client={client} onError={setError} />
            ) : (
              <p>正在连接终端通道…</p>
            )}
          </TabsContent>
          <TabsContent value='files'>
            {client ? <FilePanel client={client} /> : <p>正在连接文件通道…</p>}
          </TabsContent>
          <TabsContent value='desktop'>
            <Button
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
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className='text-xs text-muted-foreground'>
          终端、文件、剪贴板与系统音频可在被控电脑的客户端窗口中启用。
        </p>
      </CardContent>
    </Card>
  )
}
