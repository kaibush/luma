import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { request } from '@/features/access/auth'
import { signaling } from './api'
import { BrowserHost } from './host'

vi.mock('./api', () => ({ signaling: vi.fn(), sendSignal: vi.fn() }))
vi.mock('@/features/access/auth', () => ({ request: vi.fn() }))
const originalUrl = location.href
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.removeItem('remote-browser-device-id')
  localStorage.removeItem('remote-browser-device-id')
  vi.mocked(request).mockImplementation(async (path) =>
    path === '/auth/me' ? { user: null } : { name: '测试主机密钥' }
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  history.replaceState(null, '', originalUrl)
})

test('missing host token explains the requirement instead of silently disabling sharing', async () => {
  const capture = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia')
  const screen = await render(<BrowserHost />)
  await screen.getByRole('button', { name: '浏览器接入', exact: true }).click()
  await screen.getByRole('button', { name: '验证主机密钥' }).click()
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
  await screen.getByRole('button', { name: '验证主机密钥' }).click()
  await screen.getByRole('button', { name: '选择屏幕并上线' }).click()
  await expect
    .element(screen.getByText(/已取消选择或未允许共享/))
    .toHaveTextContent('已取消选择或未允许共享')
  await expect
    .element(screen.getByRole('button', { name: '验证主机密钥' }))
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
  await screen.getByRole('button', { name: '验证主机密钥' }).click()
  await screen.getByRole('button', { name: '选择屏幕并上线' }).click()
  await screen.getByRole('button', { name: '停止共享' }).click()
  resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
  await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce())
  await expect
    .element(screen.getByRole('button', { name: '验证主机密钥' }))
    .toBeEnabled()
})

test('invalid credentials are rejected before screen capture and editing a verified key requires revalidation', async () => {
  const capture = vi.spyOn(navigator.mediaDevices, 'getDisplayMedia')
  vi.mocked(request).mockImplementation(async (path, payload) => {
    if (path === '/auth/me') return { user: null }
    if ((payload as { token: string }).token === 'invalid')
      throw new Error('主机密钥已撤销')
    return { name: '有效密钥' }
  })
  const screen = await render(<BrowserHost />)
  await screen.getByRole('button', { name: '浏览器接入', exact: true }).click()
  await screen.getByLabelText('主机密钥', { exact: true }).fill('invalid')
  await screen.getByRole('button', { name: '验证主机密钥' }).click()
  await expect
    .element(screen.getByText('主机密钥已撤销', { exact: true }))
    .toBeVisible()
  expect(capture).not.toHaveBeenCalled()
  await screen.getByLabelText('主机密钥', { exact: true }).fill('valid')
  await screen.getByRole('button', { name: '验证主机密钥' }).click()
  await expect
    .element(screen.getByRole('button', { name: '选择屏幕并上线' }))
    .toBeEnabled()
  await screen.getByLabelText('主机密钥', { exact: true }).fill('changed')
  await expect
    .element(screen.getByRole('button', { name: '验证主机密钥' }))
    .toBeEnabled()
  expect(capture).not.toHaveBeenCalled()
})

test('browser host uses the same device identity when sharing again and releases capture on stop', async () => {
  const canvas = document.createElement('canvas')
  const tracks: MediaStreamTrack[] = []
  vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockImplementation(
    async () => {
      const stream = canvas.captureStream(1)
      tracks.push(...stream.getTracks())
      return stream
    }
  )
  vi.mocked(signaling).mockImplementation((_auth, onMessage) => {
    queueMicrotask(() => onMessage({ type: 'ready', hostId: 'test-host' }))
    return { close: vi.fn() } as unknown as WebSocket
  })
  const screen = await render(<BrowserHost />)
  await screen.getByRole('button', { name: '浏览器接入', exact: true }).click()
  await screen
    .getByLabelText('主机密钥', { exact: true })
    .fill('test-host-token')
  for (let attempt = 0; attempt < 2; attempt++) {
    await screen.getByRole('button', { name: '验证主机密钥' }).click()
    await screen.getByRole('button', { name: '选择屏幕并上线' }).click()
    await expect.element(screen.getByText(/已上线：我的电脑/)).toBeVisible()
    await screen.getByRole('button', { name: '停止共享', exact: true }).click()
  }
  const calls = vi.mocked(signaling).mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0][0]).toEqual(calls[1][0])
  expect(calls[0][0]).toHaveProperty('deviceId')
  expect(tracks.every((track) => track.readyState === 'ended')).toBe(true)
})

test('reopening a sharing tab reuses its host identity without persisting the host token', async () => {
  const canvas = document.createElement('canvas')
  vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockImplementation(
    async () => canvas.captureStream(1)
  )
  vi.mocked(signaling).mockImplementation((_auth, onMessage) => {
    queueMicrotask(() => onMessage({ type: 'ready', hostId: 'saved-host' }))
    return { close: vi.fn() } as unknown as WebSocket
  })
  for (let attempt = 0; attempt < 2; attempt++) {
    const screen = await render(<BrowserHost />)
    await screen
      .getByRole('button', { name: '浏览器接入', exact: true })
      .click()
    await screen
      .getByLabelText('主机密钥', { exact: true })
      .fill('test-host-token')
    await screen.getByRole('button', { name: '验证主机密钥' }).click()
    await screen.getByRole('button', { name: '选择屏幕并上线' }).click()
    await expect.element(screen.getByText(/已上线：我的电脑/)).toBeVisible()
    await screen.unmount()
    sessionStorage.removeItem('remote-browser-device-id')
  }
  const calls = vi.mocked(signaling).mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[1][0]).toEqual(calls[0][0])
  expect(JSON.stringify(localStorage)).not.toContain('test-host-token')
})

test('resume link verifies the original host before capturing and retains its name and identity', async () => {
  history.replaceState(null, '', `${location.pathname}?resume=original-host`)
  const capture = vi
    .spyOn(navigator.mediaDevices, 'getDisplayMedia')
    .mockImplementation(async () =>
      document.createElement('canvas').captureStream(1)
    )
  vi.mocked(request).mockImplementation(async (path) =>
    path === '/auth/me'
      ? { user: null }
      : {
          name: '原主机密钥',
          host: { id: 'original-host', name: '原来的共享电脑' },
        }
  )
  vi.mocked(signaling).mockImplementation((_auth, onMessage) => {
    queueMicrotask(() => onMessage({ type: 'ready', hostId: 'original-host' }))
    return { close: vi.fn() } as unknown as WebSocket
  })
  const screen = await render(<BrowserHost />)
  await screen
    .getByLabelText('主机密钥', { exact: true })
    .fill('test-host-token')
  expect(capture).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: '验证主机密钥' }).click()
  expect(request).toHaveBeenCalledWith('/auth/host-token/verify', {
    token: 'test-host-token',
    resumeHostId: 'original-host',
  })
  await expect
    .element(screen.getByLabelText('共享名称'))
    .toHaveValue('原来的共享电脑')
  await screen.getByRole('button', { name: '选择屏幕并上线' }).click()
  await expect.element(screen.getByText(/已上线：原来的共享电脑/)).toBeVisible()
  expect(signaling).toHaveBeenCalledWith(
    expect.objectContaining({
      resumeHostId: 'original-host',
      name: '原来的共享电脑',
    }),
    expect.any(Function),
    expect.any(Function)
  )
  await screen.getByRole('button', { name: '停止共享', exact: true }).click()
})
