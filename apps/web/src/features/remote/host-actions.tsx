import { useState } from 'react'
import type { Host } from '@remote/protocol'
import { Copy, Radio, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { request } from '@/features/access/auth'

export function DeleteHostButton({
  host,
  onDeleted,
}: {
  host: Host
  onDeleted: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await request(
        `/manage/hosts/${encodeURIComponent(host.id)}`,
        undefined,
        'DELETE'
      )
      onDeleted(host.id)
      setOpen(false)
      toast.success('主机档案已删除')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        variant='ghost'
        size='icon'
        aria-label={`删除主机 ${host.name}`}
        title={
          host.online ? '请先停止共享或断开客户端，再删除主机' : '删除主机档案'
        }
        disabled={host.online || host.busy}
        onClick={() => {
          setError('')
          setOpen(true)
        }}
      >
        <Trash2 />
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除主机「{host.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除这台主机的档案、显示名称、分组和备注。主机密钥仍然有效，设备再次接入时会重新出现在列表中。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {host.online && (
            <Alert>
              <AlertDescription>
                主机已重新上线，请先停止共享或断开客户端。
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={busy || host.online || host.busy}
              onClick={() => void remove()}
            >
              <Trash2 data-icon='inline-start' />
              {busy ? '正在删除…' : '删除主机'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function ResumeBrowserHostButton({ host }: { host: Host }) {
  const [open, setOpen] = useState(false)
  const url = new URL(
    `/host?resume=${encodeURIComponent(host.id)}`,
    location.origin
  ).href
  return (
    <>
      <Button className='w-full' onClick={() => setOpen(true)}>
        <Radio data-icon='inline-start' />
        重新共享
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重新共享「{host.name}」</DialogTitle>
            <DialogDescription>
              在要共享屏幕的电脑上打开下方链接，使用原主机密钥并重新选择屏幕。上线后会复用这张卡片，保留显示名称、分组和备注。
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`resume-${host.id}`}>重新共享链接</FieldLabel>
            <Input
              id={`resume-${host.id}`}
              value={url}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <FieldDescription>
              如果你正在使用手机或另一台电脑，请把链接复制到原电脑的浏览器打开。
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                void navigator.clipboard
                  .writeText(url)
                  .then(() => toast.success('链接已复制'))
                  .catch(() => toast.error('复制失败，请选中链接手动复制'))
              }}
            >
              <Copy data-icon='inline-start' />
              复制链接
            </Button>
            <Button asChild>
              <a href={url}>在此电脑重新共享</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
