import { useEffect, useState } from 'react'
import type { AccessToken } from '@remote/protocol'
import { Copy, KeyRound, Pencil, Plus, RefreshCw } from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { HostNameDialog } from '@/features/remote/host-name-dialog'
import { request } from './auth'

const date = (value: number | null) =>
  value ? new Date(value).toLocaleString() : '尚未使用'
const statusLabel = { active: '有效', revoked: '已撤销', expired: '已过期' }
const actionLabel = { revoke: '撤销', restore: '恢复', purge: '永久删除' }
type Action = { token: AccessToken; kind: keyof typeof actionLabel }

export function TokenManagement() {
  const [tokens, setTokens] = useState<AccessToken[] | null>(null)
  const [checkedAt, setCheckedAt] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'host' | 'control'>('host')
  const [days, setDays] = useState('90')
  const [action, setAction] = useState<Action | null>(null)
  const [editingHost, setEditingHost] = useState<
    AccessToken['hosts'][number] | null
  >(null)
  const [rename, setRename] = useState<{ id: string; name: string } | null>(
    null
  )
  const [revealed, setRevealed] = useState<{
    name: string
    value: string
    usable: boolean
  } | null>(null)
  const load = async () => {
    setTokens(
      (await request<{ tokens: AccessToken[] }>('/manage/tokens')).tokens
    )
    setCheckedAt(Date.now())
  }
  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      try {
        const result = await request<{ tokens: AccessToken[] }>(
          '/manage/tokens'
        )
        if (!disposed) {
          setTokens(result.tokens)
          setCheckedAt(Date.now())
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message)
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 10000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const renderHost = (host: AccessToken['hosts'][number]) => (
    <div key={host.id} className='flex flex-wrap items-center gap-1'>
      <span className='min-w-0 break-all'>
        {host.name} · {host.online ? '在线' : '离线'}
      </span>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        disabled={busy}
        aria-label={`修改主机名称：${host.name}`}
        onClick={() => setEditingHost(host)}
      >
        <Pencil data-icon='inline-start' />
      </Button>
    </div>
  )
  const renderActions = (token: AccessToken) => (
    <div className='flex flex-wrap gap-1'>
      <Button
        variant='ghost'
        size='sm'
        disabled={busy || !token.revealable}
        onClick={() =>
          void run(async () => {
            const result = await request<{
              value: string
            }>(`/manage/tokens/${token.id}/reveal`, {})
            setRevealed({
              name: token.name,
              value: result.value,
              usable: token.status === 'active',
            })
          })
        }
      >
        查看密钥
      </Button>
      <Button
        variant='ghost'
        size='sm'
        disabled={busy}
        onClick={() => setRename({ id: token.id, name: token.name })}
      >
        重命名
      </Button>
      {token.revokedAt === null ? (
        <Button
          variant='outline'
          size='sm'
          disabled={busy}
          onClick={() => setAction({ token, kind: 'revoke' })}
        >
          撤销
        </Button>
      ) : (
        <>
          <Button
            variant='outline'
            size='sm'
            disabled={
              busy || (token.expiresAt !== null && token.expiresAt <= checkedAt)
            }
            onClick={() => setAction({ token, kind: 'restore' })}
          >
            恢复
          </Button>
          <Button
            variant='destructive'
            size='sm'
            disabled={busy}
            onClick={() => setAction({ token, kind: 'purge' })}
          >
            永久删除
          </Button>
        </>
      )}
    </div>
  )
  return (
    <div className='flex flex-col gap-5'>
      <Alert>
        <KeyRound />
        <AlertTitle>按用途管理密钥</AlertTitle>
        <AlertDescription>
          主机接入密钥用于桌面客户端和临时浏览器上线；控制 API
          密钥用于程序连接桌面。
          每台电脑建议使用独立密钥，并用电脑名称命名。撤销可恢复；永久删除后不能恢复原密钥。
        </AlertDescription>
      </Alert>
      {error && (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className='flex items-center justify-end'>
        <Button onClick={() => setCreating(true)}>
          <Plus data-icon='inline-start' />
          创建 Token
        </Button>
      </div>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!busy) setCreating(open)
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>创建接入 Token</DialogTitle>
            <DialogDescription>
              新密钥需要填入对应客户端才能使用，不会自动替换客户端原有密钥。
            </DialogDescription>
          </DialogHeader>
          <form
            className='flex flex-col gap-5'
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                const result = await request<{ value: string }>(
                  '/manage/tokens',
                  {
                    name,
                    scope,
                    ...(days === 'forever' ? {} : { days: Number(days) }),
                  }
                )
                setCreating(false)
                setRevealed({
                  name: `${name} · 新密钥`,
                  value: result.value,
                  usable: true,
                })
                setName('')
                await load()
                toast.success('Token 已创建')
              })
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor='token-name'>名称</FieldLabel>
                <Input
                  id='token-name'
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={64}
                  placeholder='例如：办公室 Windows 电脑'
                />
                <FieldDescription>
                  用电脑或程序名称区分，方便以后单独撤销。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel id='token-scope-label'>用途</FieldLabel>
                <ToggleGroup
                  type='single'
                  variant='outline'
                  value={scope}
                  aria-labelledby='token-scope-label'
                  onValueChange={(value) => {
                    if (value === 'host' || value === 'control') setScope(value)
                  }}
                >
                  <ToggleGroupItem value='host'>主机接入</ToggleGroupItem>
                  <ToggleGroupItem value='control'>控制 API</ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  {scope === 'host'
                    ? '桌面客户端和临时浏览器均可使用；不能用来登录管理员账号。'
                    : '供外部程序调用远程控制接口；不能用于浏览器或桌面客户端上线。'}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor='token-days'>有效期</FieldLabel>
                <Select value={days} onValueChange={setDays}>
                  <SelectTrigger id='token-days'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value='7'>7 天</SelectItem>
                      <SelectItem value='30'>30 天</SelectItem>
                      <SelectItem value='90'>90 天</SelectItem>
                      <SelectItem value='365'>365 天</SelectItem>
                      <SelectItem value='forever'>长期有效</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                取消
              </Button>
              <Button disabled={busy} type='submit'>
                创建 Token
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {!tokens ? (
        <Skeleton className='h-48 w-full' />
      ) : (
        (['host', 'control'] as const).map((purpose) => (
          <Card key={purpose}>
            <CardHeader>
              <CardTitle>
                {purpose === 'host' ? '主机接入密钥' : '控制 API 密钥'}
              </CardTitle>
              <CardDescription>
                {purpose === 'host'
                  ? '主机使用此密钥成功接入后自动关联，一把密钥可以关联多台主机，离线记录保留。点击主机旁的编辑按钮可修改显示名称。'
                  : '供程序控制桌面，无关联主机档案。部署导入的密钥也可以重命名、撤销和删除。'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className='flex flex-col gap-4 md:hidden'>
                {tokens
                  .filter((token) => token.scope === purpose)
                  .map((token) => (
                    <Card key={token.id} aria-label={`密钥 ${token.name}`}>
                      <CardHeader>
                        <CardTitle className='break-all'>
                          {token.name}
                        </CardTitle>
                        <CardDescription>
                          {token.source === 'deployment'
                            ? '部署导入'
                            : '管理员创建'}{' '}
                          · 尾号 {token.suffix}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className='flex flex-col gap-2'>
                        <div>
                          <Badge
                            variant={
                              token.status === 'active'
                                ? 'success'
                                : 'secondary'
                            }
                          >
                            {statusLabel[token.status]}
                          </Badge>
                        </div>
                        {purpose === 'host' &&
                          (token.hosts.length ? (
                            token.hosts.map(renderHost)
                          ) : (
                            <p>尚无主机记录</p>
                          ))}
                        <p>最近使用：{date(token.lastUsedAt)}</p>
                        <p>
                          到期时间：
                          {token.expiresAt ? date(token.expiresAt) : '长期有效'}
                        </p>
                      </CardContent>
                      <CardFooter>{renderActions(token)}</CardFooter>
                    </Card>
                  ))}
                {!tokens.some((token) => token.scope === purpose) && (
                  <p>暂无此用途的密钥。</p>
                )}
              </div>
              <div className='hidden md:block'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称 / 来源</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>
                        {purpose === 'host' ? '关联主机' : '最近使用'}
                      </TableHead>
                      <TableHead>到期时间</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokens
                      .filter((token) => token.scope === purpose)
                      .map((token) => (
                        <TableRow key={token.id}>
                          <TableCell>
                            <div className='font-medium'>{token.name}</div>
                            <div className='text-xs text-muted-foreground'>
                              {token.source === 'deployment'
                                ? '部署导入'
                                : '管理员创建'}{' '}
                              · 尾号 {token.suffix}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                token.status === 'active'
                                  ? 'success'
                                  : 'secondary'
                              }
                            >
                              {statusLabel[token.status]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {purpose === 'host' ? (
                              <div className='flex flex-col gap-1'>
                                {token.hosts.length ? (
                                  token.hosts.map(renderHost)
                                ) : (
                                  <span>尚无主机记录</span>
                                )}
                                <span className='text-xs text-muted-foreground'>
                                  最近使用：{date(token.lastUsedAt)}
                                </span>
                              </div>
                            ) : (
                              date(token.lastUsedAt)
                            )}
                          </TableCell>
                          <TableCell>
                            {token.expiresAt
                              ? date(token.expiresAt)
                              : '长期有效'}
                          </TableCell>
                          <TableCell>{renderActions(token)}</TableCell>
                        </TableRow>
                      ))}
                    {!tokens.some((token) => token.scope === purpose) && (
                      <TableRow>
                        <TableCell colSpan={5}>暂无此用途的密钥。</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
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
        ))
      )}
      {editingHost && (
        <HostNameDialog
          key={editingHost.id}
          host={editingHost}
          onClose={() => setEditingHost(null)}
          onSaved={() => void run(load)}
        />
      )}
      <AlertDialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action && actionLabel[action.kind]}「{action?.token.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action?.kind === 'revoke'
                ? `密钥将立即失效，${action.token.hosts.filter((host) => host.online).length} 台在线主机及使用此密钥的控制连接将断开。主机档案保留，之后可恢复未过期的密钥。`
                : action?.kind === 'restore'
                  ? '恢复后，持有原密钥的客户端将重新获得接入权限。运行中的桌面客户端会自动重试；浏览器需重新选择屏幕。有效期不变。'
                  : '永久删除密钥及保存的原文，无法再恢复。离线主机档案和审计记录保留；再次接入需创建新密钥并更新客户端配置。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                if (!action) return
                void run(async () => {
                  await request(
                    `/manage/tokens/${action.token.id}/${action.kind}`,
                    action.kind === 'purge' ? undefined : {},
                    action.kind === 'purge' ? 'DELETE' : 'POST'
                  )
                  toast.success(`Token 已${actionLabel[action.kind]}`)
                  setAction(null)
                  await load()
                })
              }}
            >
              确认{action && actionLabel[action.kind]}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={!!rename}
        onOpenChange={(open) => {
          if (!open && !busy) setRename(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名密钥</DialogTitle>
            <DialogDescription>
              用设备或程序名称标识用途，密钥值保持不变。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (rename)
                void run(async () => {
                  await request(
                    `/manage/tokens/${rename.id}`,
                    { name: rename.name },
                    'PUT'
                  )
                  setRename(null)
                  await load()
                })
            }}
          >
            <Field>
              <FieldLabel htmlFor='rename-token'>名称</FieldLabel>
              <Input
                id='rename-token'
                required
                maxLength={64}
                value={rename?.name || ''}
                onChange={(e) =>
                  setRename(
                    (current) => current && { ...current, name: e.target.value }
                  )
                }
              />
            </Field>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => setRename(null)}
              >
                取消
              </Button>
              <Button disabled={busy}>保存名称</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
              {revealed?.usable
                ? '完整密钥已加密保存，可复制到对应的接入端。'
                : '此密钥当前不可用于接入。查看原文不会恢复密钥，也不会延长有效期。'}
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label='完整密钥'
            value={revealed?.value || ''}
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
                  .writeText(revealed?.value || '')
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
    </div>
  )
}
