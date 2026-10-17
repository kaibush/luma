import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import type { ToolClient } from './tool-client'

export function ClipboardPanel({ client }: { client: ToolClient }) {
  const [text, setText] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch (e) {
      setStatus((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className='mt-3 flex flex-col gap-2'>
      <Field>
        <FieldLabel htmlFor='remote-clipboard'>文本剪贴板</FieldLabel>
        <Textarea
          id='remote-clipboard'
          maxLength={8192}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <div className='flex flex-wrap gap-2'>
        <Button
          variant='outline'
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const value = await navigator.clipboard.readText()
              setText(value.slice(0, 8192))
              setStatus('已读取本机剪贴板，请点击发送到远端')
            })
          }
        >
          读取本机
        </Button>
        <Button
          variant='outline'
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await client.call('clipboard.write', { text })
              setStatus('已发送到远端，可在远程应用中粘贴')
            })
          }
        >
          发送到远端
        </Button>
        <Button
          variant='outline'
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setText(await client.call<string>('clipboard.read'))
              setStatus('已取回远端文本，可复制到本机')
            })
          }
        >
          取回远端
        </Button>
        <Button
          variant='outline'
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await navigator.clipboard.writeText(text)
              setStatus('已复制到本机')
            })
          }
        >
          复制到本机
        </Button>
      </div>
      <p role='status'>{status}</p>
    </div>
  )
}
