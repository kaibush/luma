import { useState } from 'react'
import { Monitor } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { request, useRemoteAuth } from './auth'

export function LoginPage() {
  const { state, refresh } = useRemoteAuth()
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await request('/auth/login', { username, password })
      setPassword('')
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className='mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 p-4'>
      <div className='flex items-center justify-center gap-3'>
        <span className='flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground'>
          <Monitor className='size-6' />
        </span>
        <span className='text-xl font-semibold'>{state.workspaceName}</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>登录你的工作空间</CardTitle>
            <CardDescription>管理主机，随时连接你的桌面。</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-5'>
            {error && (
              <Alert variant='destructive'>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor='login-username'>账号</FieldLabel>
                <Input
                  id='login-username'
                  autoComplete='username'
                  value={username}
                  required
                  maxLength={32}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='login-password'>密码</FieldLabel>
                <Input
                  id='login-password'
                  type='password'
                  autoComplete='current-password'
                  value={password}
                  required
                  maxLength={128}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button className='w-full' disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </Button>
          </CardFooter>
        </Card>
      </form>
      <p className='text-center text-xs text-muted-foreground'>
        登录有效期 12 小时 · 修改密码后所有登录会失效
      </p>
    </main>
  )
}
