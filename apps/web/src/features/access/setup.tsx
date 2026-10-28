import { useState } from 'react'
import { APP_NAME, getWorkspaceName } from '@/config/branding'
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from 'lucide-react'
import { Logo } from '@/assets/logo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'
import { request, useRemoteAuth, type ConnectionSettings } from './auth'
import { SettingsFields } from './settings-fields'

const steps = ['验证部署', '管理员账号', '连接设置', '确认完成']
export function SetupPage() {
  const { refresh } = useRemoteAuth()
  const [step, setStep] = useState(0),
    [key, setKey] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [secret, setSecret] = useState('')
  const [settings, setSettings] = useState<ConnectionSettings>({
    workspaceName: APP_NAME,
    defaultQuality: 'responsive',
    sessionMinutes: 240,
    stunUrl: '',
    turnUrl: '',
  })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const next = async () => {
    setError('')
    setBusy(true)
    try {
      if (step === 0) {
        const result = await request<{ settings: ConnectionSettings }>(
          '/auth/setup/unlock',
          { key }
        )
        setSettings({
          ...result.settings,
          workspaceName: getWorkspaceName(result.settings.workspaceName),
        })
        setKey('')
        setStep(1)
      } else if (step === 1) {
        if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username))
          throw new Error('账号格式不正确')
        if (password !== confirm) throw new Error('两次输入的密码不一致')
        setStep(2)
      } else if (step === 2) {
        if (settings.turnUrl && !secret && !settings.turnSecretSet)
          throw new Error('启用 TURN 需要填写共享密钥')
        setStep(3)
      } else {
        await request('/auth/setup/complete', {
          username,
          password,
          settings,
          turnSecret: secret || undefined,
        })
        setPassword('')
        setConfirm('')
        setSecret('')
        await refresh()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className='mx-auto flex min-h-svh max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12'>
      <div className='flex items-center gap-3'>
        <Logo className='size-7' alt='' />
        <span className='font-semibold'>{APP_NAME}</span>
        <Badge variant='secondary'>首次初始化</Badge>
      </div>
      <div>
        <h1 className='text-3xl font-semibold tracking-tight'>
          几步设置，连接你的桌面。
        </h1>
        <p className='mt-2 text-muted-foreground'>
          创建自己的管理员账号，确认连接方式，开始使用远程工作空间。
        </p>
      </div>
      <ol className='grid grid-cols-4 gap-2' aria-label='初始化进度'>
        {steps.map((label, index) => (
          <li
            key={label}
            className='flex flex-col items-center gap-2 text-center text-xs sm:text-sm'
            aria-current={step === index ? 'step' : undefined}
          >
            <Badge variant={step === index ? 'default' : 'outline'}>
              {index < step ? <Check className='size-4' /> : index + 1}
            </Badge>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void next()
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{steps[step]}</CardTitle>
            <CardDescription>
              {
                [
                  '验证你拥有此部署。此步骤只在首次设置时使用。',
                  '以后使用这个账号登录，不再需要输入控制端 Token。',
                  '已读取服务器现有参数，你可以直接保留。',
                  '确认后创建管理员，初始化入口将自动关闭。',
                ][step]
              }
            </CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-5'>
            {error && (
              <Alert variant='destructive' role='alert'>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {step === 0 && (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor='setup-key'>部署密钥</FieldLabel>
                  <PasswordInput
                    id='setup-key'
                    visibilityLabel='密钥'
                    autoComplete='off'
                    value={key}
                    required
                    onChange={(e) => setKey(e.target.value)}
                  />
                  <FieldDescription>
                    填写现有
                    CONTROL_TOKEN。服务器配置文件：/etc/remote-console/environment；本地开发使用项目根目录
                    .env。
                  </FieldDescription>
                </Field>
                <Alert>
                  <ShieldCheck />
                  <AlertTitle>防止他人抢先注册</AlertTitle>
                  <AlertDescription>
                    这是公开域名上的首次管理员设置。验证成功后有 10
                    分钟完成向导，不会更改现有主机密钥。
                  </AlertDescription>
                </Alert>
              </FieldGroup>
            )}
            {step === 1 && (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor='setup-username'>管理员账号</FieldLabel>
                  <Input
                    id='setup-username'
                    autoComplete='username'
                    value={username}
                    minLength={3}
                    maxLength={32}
                    required
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <FieldDescription>
                    3–32 位，支持字母、数字、点、下划线和短横线。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor='setup-password'>登录密码</FieldLabel>
                  <PasswordInput
                    id='setup-password'
                    visibilityLabel='密码'
                    autoComplete='new-password'
                    value={password}
                    minLength={12}
                    maxLength={128}
                    required
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <FieldDescription>
                    至少 12 位，建议使用密码管理器保存。
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor='setup-confirm'>确认密码</FieldLabel>
                  <PasswordInput
                    id='setup-confirm'
                    visibilityLabel='密码'
                    autoComplete='new-password'
                    value={confirm}
                    required
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </Field>
              </FieldGroup>
            )}
            {step === 2 && (
              <SettingsFields
                value={settings}
                onChange={setSettings}
                secret={secret}
                onSecret={setSecret}
              />
            )}
            {step === 3 && (
              <>
                <dl className='grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm'>
                  <dt className='text-muted-foreground'>管理员</dt>
                  <dd className='break-all'>{username}</dd>
                  <dt className='text-muted-foreground'>工作空间</dt>
                  <dd>{settings.workspaceName}</dd>
                  <dt className='text-muted-foreground'>会话时长</dt>
                  <dd>{settings.sessionMinutes} 分钟</dd>
                  <dt className='text-muted-foreground'>TURN 中继</dt>
                  <dd>{settings.turnUrl ? '已启用' : '未启用'}</dd>
                </dl>
                <Alert>
                  <AlertTitle>现有主机自动保留</AlertTitle>
                  <AlertDescription>
                    已在线的 Linux 桌面和原有 Token
                    会继续可用。进入系统后，可在「管理设置」创建或撤销
                    Token、调整连接参数。
                  </AlertDescription>
                </Alert>
              </>
            )}
          </CardContent>
          <CardFooter className='justify-between gap-3'>
            {step > 0 ? (
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => {
                  setStep(step - 1)
                  setError('')
                }}
              >
                <ArrowLeft data-icon='inline-start' />
                上一步
              </Button>
            ) : (
              <span />
            )}
            <Button type='submit' disabled={busy}>
              {busy
                ? '正在保存…'
                : step === 3
                  ? '完成初始化并进入系统'
                  : '下一步'}
              <ArrowRight data-icon='inline-end' />
            </Button>
          </CardFooter>
        </Card>
      </form>
      <p className='text-center text-xs text-muted-foreground'>
        密码经加盐哈希存储 · 登录凭据使用 HttpOnly Cookie
      </p>
    </main>
  )
}
