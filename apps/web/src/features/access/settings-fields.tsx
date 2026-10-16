import { qualityProfiles } from '@remote/protocol'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ConnectionSettings } from './auth'

export function SettingsFields({
  value,
  onChange,
  secret,
  onSecret,
}: {
  value: ConnectionSettings
  onChange: (v: ConnectionSettings) => void
  secret: string
  onSecret: (v: string) => void
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor='workspace-name'>工作空间名称</FieldLabel>
        <Input
          id='workspace-name'
          value={value.workspaceName}
          maxLength={60}
          required
          onChange={(e) =>
            onChange({ ...value, workspaceName: e.target.value })
          }
        />
      </Field>
      <div className='grid gap-5 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='default-quality'>默认画质</FieldLabel>
          <select
            id='default-quality'
            className='h-11 rounded-md border bg-background px-3'
            value={value.defaultQuality}
            onChange={(e) =>
              onChange({
                ...value,
                defaultQuality: e.target
                  .value as ConnectionSettings['defaultQuality'],
              })
            }
          >
            {Object.entries(qualityProfiles).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label} · {p.height}p
              </option>
            ))}
          </select>
          <FieldDescription>实际帧率受主机编码能力限制。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor='session-minutes'>
            单次连接时长（分钟）
          </FieldLabel>
          <Input
            id='session-minutes'
            type='number'
            min={15}
            max={240}
            required
            value={value.sessionMinutes}
            onChange={(e) =>
              onChange({ ...value, sessionMinutes: Number(e.target.value) })
            }
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor='stun-url'>STUN 地址（可选）</FieldLabel>
        <Input
          id='stun-url'
          value={value.stunUrl}
          placeholder='stun:服务器:3478'
          onChange={(e) => onChange({ ...value, stunUrl: e.target.value })}
        />
        <FieldDescription>用于发现可从外网访问的网络地址。</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor='turn-url'>TURN 中继地址（可选）</FieldLabel>
        <Input
          id='turn-url'
          value={value.turnUrl}
          placeholder='turn:服务器:3478'
          onChange={(e) => onChange({ ...value, turnUrl: e.target.value })}
        />
        <FieldDescription>
          手机与主机无法直连时使用。留空关闭中继；已有设置建议保留。
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor='turn-secret'>TURN 共享密钥</FieldLabel>
        <Input
          id='turn-secret'
          type='password'
          autoComplete='new-password'
          value={secret}
          minLength={16}
          maxLength={256}
          onChange={(e) => onSecret(e.target.value)}
          placeholder={
            value.turnSecretSet
              ? '已配置，留空保留现有密钥'
              : '启用 TURN 时填写，与 coturn 一致'
          }
        />
        <FieldDescription>
          这里保存的是 API 使用的凭据；更换密钥时需同步修改 TURN 服务器配置。
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}
