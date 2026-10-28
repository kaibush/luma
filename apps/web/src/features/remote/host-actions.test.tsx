import type { Host } from '@remote/protocol'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { request } from '@/features/access/auth'
import { DeleteHostButton } from './host-actions'

vi.mock('@/features/access/auth', () => ({ request: vi.fn() }))
const host: Host = {
  id: 'offline-host',
  name: '旧电脑',
  online: false,
  busy: false,
  kind: 'browser',
  capabilities: { video: true, systemInput: false },
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

test('deletion requires confirmation, preserves the card on failure, and only removes it after success', async () => {
  const onDeleted = vi.fn()
  const screen = await render(
    <DeleteHostButton host={host} onDeleted={onDeleted} />
  )
  await screen
    .getByRole('button', { name: '删除主机 旧电脑', exact: true })
    .click()
  await screen.getByRole('button', { name: '取消', exact: true }).click()
  expect(request).not.toHaveBeenCalled()
  await screen
    .getByRole('button', { name: '删除主机 旧电脑', exact: true })
    .click()
  vi.mocked(request).mockRejectedValueOnce(new Error('主机已重新上线'))
  await screen.getByRole('button', { name: '删除主机', exact: true }).click()
  await expect
    .element(screen.getByText('主机已重新上线', { exact: true }))
    .toBeVisible()
  expect(onDeleted).not.toHaveBeenCalled()
  vi.mocked(request).mockResolvedValueOnce({})
  await screen.getByRole('button', { name: '删除主机', exact: true }).click()
  await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(host.id))
  expect(request).toHaveBeenLastCalledWith(
    '/manage/hosts/offline-host',
    undefined,
    'DELETE'
  )
})

test('online hosts cannot be deleted from the card', async () => {
  const screen = await render(
    <DeleteHostButton host={{ ...host, online: true }} onDeleted={vi.fn()} />
  )
  await expect
    .element(
      screen.getByRole('button', { name: '删除主机 旧电脑', exact: true })
    )
    .toBeDisabled()
  expect(request).not.toHaveBeenCalled()
})
