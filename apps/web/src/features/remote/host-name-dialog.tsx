import { useState } from 'react'
import type { AccessToken } from '@remote/protocol'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { request } from '@/features/access/auth'

export function HostNameDialog({
  host,
  onClose,
  onSaved,
}: {
  host: AccessToken['hosts'][number]
  onClose: () => void
  onSaved: () => void
}) {
  const [displayName, setDisplayName] = useState(host.displayName || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reportedName = host.reportedName || host.name
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改主机显示名称</DialogTitle>
          <DialogDescription>
            客户端名称：{reportedName}
            。修改后会同步显示在主机列表和关联主机中，离线或重连后仍保留。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            try {
              await request(
                `/manage/hosts/${host.id}/name`,
                { displayName },
                'PUT'
              )
              toast.success(
                displayName.trim() ? '主机显示名称已更新' : '已恢复客户端名称'
              )
              onSaved()
              onClose()
            } catch (e) {
              setError((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <FieldGroup>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor='host-display-name'>主机显示名称</FieldLabel>
              <Input
                id='host-display-name'
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={64}
                placeholder={reportedName}
                disabled={busy}
                autoFocus
              />
              <FieldDescription>
                留空使用客户端名称。名称修改不会更换主机使用的 Token。
              </FieldDescription>
            </Field>
            {error && (
              <Alert variant='destructive'>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button
                type='button'
                variant='ghost'
                disabled={busy}
                onClick={() => setDisplayName('')}
              >
                恢复客户端名称
              </Button>
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={onClose}
              >
                取消
              </Button>
              <Button disabled={busy} type='submit'>
                保存名称
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
