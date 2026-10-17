import { afterEach, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { BrowserHost } from './host'

vi.mock('./api', () => ({ signaling: vi.fn(), sendSignal: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

test('missing host token explains the requirement instead of silently disabling sharing', async () => {
  const capture = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia')
  const screen = await render(<BrowserHost />)
  await screen.getByRole('button', { name: '浏览器接入', exact: true }).click()
  await screen.getByRole('button', { name: '选择屏幕并上线' }).click()
  await expect
    .element(screen.getByText(/请先填写主机密钥/))
    .toHaveTextContent('请先填写主机密钥')
  expect(capture).not.toHaveBeenCalled()
  await expect
    .element(screen.getByText('浏览器主机接入：供控制台观看'))
    .toBeVisible()
})

test('canceled browser picker gives a visible explanation and can be retried', async () => {
  vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockRejectedValue(
    new DOMException('Denied', 'NotAllowedError')
  )
  const screen = await render(<BrowserHost />)
  await screen.getByRole('button', { name: '浏览器接入', exact: true }).click()
  await screen
    .getByLabelText('主机密钥', { exact: true })
    .fill('test-host-token')
  await screen.getByRole('button', { name: '选择屏幕并上线' }).click()
  await expect
    .element(screen.getByText(/已取消选择或未允许共享/))
    .toHaveTextContent('已取消选择或未允许共享')
  await expect
    .element(screen.getByRole('button', { name: '选择屏幕并上线' }))
    .toBeEnabled()
})

test('stopping while the browser picker is pending releases the subsequently selected screen', async () => {
  let resolve!: (stream: MediaStream) => void
  const stop = vi.fn()
  vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockReturnValue(
    new Promise((r) => {
      resolve = r
    })
  )
  const screen = await render(<BrowserHost />)
  await screen.getByRole('button', { name: '浏览器接入', exact: true }).click()
  await screen
    .getByLabelText('主机密钥', { exact: true })
    .fill('test-host-token')
  await screen.getByRole('button', { name: '选择屏幕并上线' }).click()
  await screen.getByRole('button', { name: '停止共享' }).click()
  resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
  await expect
    .element(screen.getByRole('button', { name: '选择屏幕并上线' }))
    .toBeEnabled()
})
