import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { request } from './auth'

interface AuditPage {
  events: {
    id: number
    time: number
    actor: string
    action: string
    detail: string
  }[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  snapshot: number
  retentionLimit: number
}

export function AuditLog() {
  const [query, setQuery] = useState<{
    page: number
    pageSize: number
    snapshot?: number
  }>({ page: 1, pageSize: 20 })
  const [data, setData] = useState<AuditPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = (next: typeof query) => {
    setLoading(true)
    setError('')
    setQuery(next)
  }
  useEffect(() => {
    let disposed = false
    const params = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
    })
    if (query.snapshot !== undefined)
      params.set('snapshot', String(query.snapshot))
    void request<AuditPage>(`/manage/audit?${params}`)
      .then((result) => {
        if (!disposed) setData(result)
      })
      .catch((e) => {
        if (!disposed) setError((e as Error).message)
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [query])
  const go = (page: number) => {
    if (data) load({ page, pageSize: data.pageSize, snapshot: data.snapshot })
  }
  return (
    <section
      aria-label='操作记录列表'
      aria-busy={loading}
      className='flex flex-col gap-4'
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <p className='text-sm text-muted-foreground'>
          {data
            ? `保留最近 ${data.retentionLimit} 条记录 · 按时间倒序`
            : '按时间倒序'}
        </p>
        <Button
          variant='outline'
          disabled={loading}
          onClick={() => load({ page: 1, pageSize: query.pageSize })}
        >
          <RefreshCw data-icon='inline-start' />
          {loading ? '正在加载…' : '刷新记录'}
        </Button>
      </div>
      {error && (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!data && loading ? (
        <Skeleton className='h-48 w-full' />
      ) : (
        data && (
          <>
            {data.events.length ? (
              <div className='overflow-hidden rounded-xl border bg-card'>
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
                    {data.events.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className='whitespace-nowrap'>
                          {new Date(event.time).toLocaleString()}
                        </TableCell>
                        <TableCell>{event.actor}</TableCell>
                        <TableCell>{event.action}</TableCell>
                        <TableCell className='min-w-48 break-words whitespace-normal'>
                          {event.detail}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>还没有操作记录。</p>
            )}
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <p role='status' className='text-sm text-muted-foreground'>
                共 {data.total} 条
                {data.total > 0 &&
                  ` · 显示 ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} 条`}
              </p>
              <div className='flex flex-wrap items-center gap-2'>
                <Select
                  value={String(query.pageSize)}
                  disabled={loading}
                  onValueChange={(value) =>
                    load({ page: 1, pageSize: Number(value) })
                  }
                >
                  <SelectTrigger aria-label='每页记录数' className='w-28'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {[20, 50, 100].map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size} 条 / 页
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  variant='outline'
                  size='icon'
                  aria-label='上一页'
                  disabled={loading || data.page <= 1}
                  onClick={() => go(data.page - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className='text-sm'>
                  第 {data.page} / {data.totalPages} 页
                </span>
                <Button
                  variant='outline'
                  size='icon'
                  aria-label='下一页'
                  disabled={loading || data.page >= data.totalPages}
                  onClick={() => go(data.page + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        )
      )}
    </section>
  )
}
