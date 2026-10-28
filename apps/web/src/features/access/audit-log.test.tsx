import { beforeEach, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { AuditLog } from './audit-log'
import { request } from './auth'

vi.mock('./auth', () => ({ request: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(request).mockImplementation(async (path) => {
    const params = new URL(path, location.origin).searchParams
    const page = Number(params.get('page') || 1),
      pageSize = Number(params.get('pageSize') || 20)
    const total = 65
    return {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      snapshot: 65,
      retentionLimit: 1000,
      events: Array.from(
        { length: Math.min(pageSize, total - (page - 1) * pageSize) },
        (_, i) => {
          const id = total - (page - 1) * pageSize - i
          return {
            id,
            time: Date.now(),
            actor: 'admin',
            action: 'host.delete',
            detail: `操作记录 ${id}`,
          }
        }
      ),
    }
  })
})

test('pages past the old fifty-record limit and refreshes from the newest record', async () => {
  const screen = await render(<AuditLog />)
  await expect
    .element(screen.getByText('操作记录 65', { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: '上一页' }))
    .toBeDisabled()
  for (let page = 2; page <= 4; page++) {
    await screen.getByRole('button', { name: '下一页' }).click()
    await expect
      .element(screen.getByText(`第 ${page} / 4 页`, { exact: true }))
      .toBeVisible()
  }
  await expect
    .element(screen.getByText('操作记录 1', { exact: true }))
    .toBeVisible()
  expect(request).toHaveBeenLastCalledWith(
    '/manage/audit?page=4&pageSize=20&snapshot=65'
  )
  await expect
    .element(screen.getByRole('button', { name: '下一页' }))
    .toBeDisabled()
  await screen.getByRole('button', { name: '刷新记录' }).click()
  await expect
    .element(screen.getByText('操作记录 65', { exact: true }))
    .toBeVisible()
  expect(request).toHaveBeenLastCalledWith('/manage/audit?page=1&pageSize=20')
  await screen.getByRole('combobox', { name: '每页记录数' }).click()
  await screen.getByRole('option', { name: '50 条 / 页', exact: true }).click()
  await expect
    .element(screen.getByText('第 1 / 2 页', { exact: true }))
    .toBeVisible()
  expect(request).toHaveBeenLastCalledWith('/manage/audit?page=1&pageSize=50')
})

test('a failed request exposes retry without replacing saved rows or falsely advancing the page', async () => {
  const screen = await render(<AuditLog />)
  await expect
    .element(screen.getByText('第 1 / 4 页', { exact: true }))
    .toBeVisible()
  vi.mocked(request).mockRejectedValueOnce(new Error('读取失败'))
  await screen.getByRole('button', { name: '下一页' }).click()
  await expect
    .element(screen.getByText('读取失败', { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByText('第 1 / 4 页', { exact: true }))
    .toBeVisible()
  await screen.getByRole('button', { name: '刷新记录' }).click()
  await expect
    .element(screen.getByText('读取失败', { exact: true }))
    .not.toBeInTheDocument()
})
