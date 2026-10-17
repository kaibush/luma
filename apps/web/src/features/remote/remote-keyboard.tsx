import { useState } from 'react'
import type { InputEvent } from '@remote/protocol'
import { X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const modifiers = [
  ['ControlLeft', 'Ctrl'],
  ['AltLeft', 'Alt'],
  ['ShiftLeft', 'Shift'],
  ['MetaLeft', 'Win / ⌘'],
]
const shortcuts = [
  ['复制', 'Ctrl + C', ['ControlLeft', 'KeyC']],
  ['粘贴', 'Ctrl + V', ['ControlLeft', 'KeyV']],
  ['全选', 'Ctrl + A', ['ControlLeft', 'KeyA']],
  ['撤销', 'Ctrl + Z', ['ControlLeft', 'KeyZ']],
  ['保存', 'Ctrl + S', ['ControlLeft', 'KeyS']],
  ['切换窗口', 'Alt + Tab', ['AltLeft', 'Tab']],
  ['终端复制', 'Ctrl + Shift + C', ['ControlLeft', 'ShiftLeft', 'KeyC']],
  ['终端粘贴', 'Ctrl + Shift + V', ['ControlLeft', 'ShiftLeft', 'KeyV']],
] as const
const common = [
  ['Escape', 'Esc'],
  ['Tab', 'Tab'],
  ['Backspace', '退格'],
  ['Enter', '回车'],
  ['ArrowLeft', '←'],
  ['ArrowDown', '↓'],
  ['ArrowUp', '↑'],
  ['ArrowRight', '→'],
]
const navigation = [
  ['Home', 'Home'],
  ['End', 'End'],
  ['PageUp', 'PgUp'],
  ['PageDown', 'PgDn'],
  ['Insert', 'Insert'],
  ['Delete', 'Delete'],
]

export function sendChord(
  send: (event: InputEvent) => void,
  codes: readonly string[]
) {
  const keys = [...new Set(codes)]
  for (const code of keys) send({ type: 'key', code, down: true })
  for (const code of keys.reverse()) send({ type: 'key', code, down: false })
}

export function RemoteKeyboard({
  send,
  onClose,
  asciiOnly,
}: {
  send: (event: InputEvent) => void
  onClose: () => void
  asciiOnly: boolean
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [text, setText] = useState(''),
    [error, setError] = useState('')
  const press = (code: string) => {
    sendChord(send, [...selected, code])
    setSelected([])
  }
  const keys = (items: string[][]) =>
    items.map(([code, label]) => (
      <Button
        key={code}
        className='remote-key'
        size='sm'
        variant='outline'
        onClick={() => press(code)}
      >
        {label}
      </Button>
    ))
  return (
    <section
      className='remote-panel remote-keyboard border-t bg-background'
      aria-label='远程键盘'
    >
      <Tabs defaultValue='shortcuts' className='gap-2'>
        <div className='sticky top-0 z-10 flex items-center justify-between gap-2 bg-background'>
          <TabsList aria-label='键盘类型'>
            <TabsTrigger value='shortcuts'>常用组合</TabsTrigger>
            <TabsTrigger value='keys'>完整按键</TabsTrigger>
            <TabsTrigger value='text'>文字输入</TabsTrigger>
          </TabsList>
          <Button
            variant='ghost'
            size='icon'
            aria-label='收起键盘'
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <TabsContent value='shortcuts' className='flex flex-col gap-2'>
          <div className='remote-shortcuts'>
            {shortcuts.map(([label, hint, codes]) => (
              <Button
                key={label}
                variant='outline'
                className='h-auto flex-col gap-0 px-1 py-1'
                aria-label={`${label} ${hint}`}
                onClick={() => {
                  sendChord(send, codes)
                  setSelected([])
                }}
              >
                <span>{label}</span>
                <span className='text-xs text-muted-foreground'>{hint}</span>
              </Button>
            ))}
          </div>
          <div className='grid grid-cols-8 gap-1'>{keys(common)}</div>
          <p className='text-xs text-muted-foreground'>
            复制与粘贴使用远程电脑的剪贴板；自定义组合请用「完整按键」。
          </p>
        </TabsContent>
        <TabsContent value='keys' className='flex flex-col gap-2'>
          <ToggleGroup
            type='multiple'
            variant='outline'
            value={selected}
            onValueChange={setSelected}
            aria-label='组合修饰键'
            className='justify-start'
          >
            {modifiers.map(([code, label]) => (
              <ToggleGroupItem key={code} value={code} aria-label={label}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className='text-xs text-muted-foreground' aria-live='polite'>
            {selected.length
              ? '已选修饰键：再点一个按键发送组合，随后自动松开。'
              : '先选 Ctrl / Alt / Shift 等，再点按键。可同时选多个。'}
          </p>
          <div className='grid grid-cols-10 gap-1'>
            {keys('1234567890'.split('').map((n) => [`Digit${n}`, n]))}
          </div>
          {['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'].map((row) => (
            <div key={row} className='grid grid-cols-10 gap-1'>
              {keys(row.split('').map((c) => [`Key${c}`, c]))}
            </div>
          ))}
          <div className='grid grid-cols-8 gap-1'>{keys(common)}</div>
          <div className='grid grid-cols-4 gap-1 @min-[640px]:grid-cols-8'>
            {keys([['Space', '空格'], ['CapsLock', 'Caps'], ...navigation])}
          </div>
          <div className='grid grid-cols-6 gap-1 @min-[640px]:grid-cols-12'>
            {keys(
              Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`])
            )}
          </div>
          <div className='grid grid-cols-6 gap-1 @min-[640px]:grid-cols-12'>
            {keys([
              ['Backquote', '`'],
              ['Minus', '-'],
              ['Equal', '='],
              ['BracketLeft', '['],
              ['BracketRight', ']'],
              ['Backslash', '\\'],
              ['Semicolon', ';'],
              ['Quote', "'"],
              ['Comma', ','],
              ['Period', '.'],
              ['Slash', '/'],
            ])}
          </div>
        </TabsContent>
        <TabsContent value='text'>
          <form
            className='flex flex-col gap-2'
            onSubmit={(e) => {
              e.preventDefault()
              if (asciiOnly && /[^\x20-\x7e\n]/.test(text)) {
                setError('此主机暂支持英文、数字和符号，中文文本输入尚未接入。')
                return
              }
              if (text) {
                send({ type: 'text', text })
                setText('')
                setSelected([])
                setError('')
              }
            }}
          >
            <div className='flex gap-2'>
              <Input
                aria-label='发送文本'
                placeholder='输入文字后发送到远程电脑'
                value={text}
                maxLength={2048}
                onChange={(e) => setText(e.target.value)}
                autoComplete='off'
                autoCapitalize='off'
                autoCorrect='off'
                spellCheck={false}
              />
              <Button type='submit' disabled={!text}>
                发送
              </Button>
            </div>
            <p className='text-xs text-muted-foreground'>
              {asciiOnly
                ? '支持英文、数字和符号。中文文本输入暂不支持。'
                : '文字会发送到浏览器共享端的测试面板。'}
            </p>
            {error && (
              <Alert variant='destructive'>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>
        </TabsContent>
      </Tabs>
    </section>
  )
}
