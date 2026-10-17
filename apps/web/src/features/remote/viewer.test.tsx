import '@/styles/index.css'
import { afterEach, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { Viewer } from './viewer'

const { sendInput } = vi.hoisted(() => ({ sendInput: vi.fn() }))
vi.mock('./api', () => ({
  api: vi.fn(async () => {}),
  sendSignal: vi.fn(),
  signaling: () => ({ close: vi.fn() }),
}))
vi.mock('./peer', () => ({
  RemotePeer: class {
    constructor(options: {
      onState: (state: string) => void
      onStats: (stats: { fps: number; rttMs: number }) => void
    }) {
      options.onState('connected')
      options.onStats({ fps: 59.6, rttMs: 23.4 })
    }
    pc = { connectionState: 'connected' }
    sendInput = sendInput
    close() {}
  },
}))
afterEach(() => vi.clearAllMocks())
test('touchpad swipes move without holding left, taps click cursor, direct mode still drags', async () => {
  const screen = await render(
    <Viewer
      host={{
        id: 'host',
        name: 'Test desktop',
        busy: false,
        kind: 'linux-x11',
        capabilities: { video: true, systemInput: true },
      }}
      session={{
        id: 'test',
        hostId: 'host',
        quality: 'responsive',
        expiresAt: Date.now() + 60000,
      }}
      iceServers={[]}
      token=''
      onExit={() => {}}
    />
  )
  await new Promise((r) => setTimeout(r, 30))
  const video = document.querySelector('video')!
  Object.defineProperties(video, {
    videoWidth: { value: 1280 },
    videoHeight: { value: 720 },
  })
  video.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 800,
    height: 450,
    right: 800,
    bottom: 450,
    toJSON: () => ({}),
  })
  video.setPointerCapture = () => {}
  const pointer = (type: string, x: number, y: number, id = 1) =>
    video.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerType: 'touch',
        pointerId: id,
        button: 0,
        clientX: x,
        clientY: y,
      })
    )
  const flush = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const buttons = () =>
    sendInput.mock.calls.map((c) => c[0]).filter((e) => e.type === 'button')
  await screen.getByRole('button', { name: '触控板模式' }).click()
  for (const [width, height] of [
    [844, 390],
    [390, 844],
  ]) {
    await page.viewport(width, height)
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    )
    const hud = document.querySelector('[aria-label^="实时连接统计"]')!
    expect(hud.textContent).toContain('60 FPS')
    expect(hud.textContent).toContain('延迟 23 ms')
    expect(getComputedStyle(hud).pointerEvents).toBe('none')
    const hudRect = hud.getBoundingClientRect()
    expect(
      document.elementFromPoint(
        hudRect.x + hudRect.width / 2,
        hudRect.y + hudRect.height / 2
      )
    ).toBe(video)
    const viewer = document.querySelector('.remote-viewer')!
    expect(viewer.scrollWidth).toBeLessThanOrEqual(width)
    expect(
      document.querySelector('.remote-stage')!.getBoundingClientRect().height
    ).toBeGreaterThan(180)
    expect(
      document.querySelector('footer')!.getBoundingClientRect().bottom
    ).toBeLessThanOrEqual(height)
    await page.screenshot({
      path: `./__screenshots__/remote-touchpad-${width}.png`,
    })
  }
  sendInput.mockClear()
  pointer('pointerdown', 100, 100)
  pointer('pointermove', 180, 145)
  await flush()
  pointer('pointerup', 180, 145)
  expect(buttons()).toEqual([])
  expect(sendInput).toHaveBeenCalledWith({ type: 'move', x: 0.6, y: 0.6 })
  // Lifting and touching elsewhere does not teleport the pointer; two taps produce two left clicks.
  sendInput.mockClear()
  for (let i = 0; i < 2; i++) {
    pointer('pointerdown', 30 + i * 20, 30)
    pointer('pointerup', 30 + i * 20, 30)
  }
  expect(buttons()).toEqual(
    [true, false, true, false].map((down) => ({
      type: 'button',
      button: 'left',
      down,
      x: 0.6,
      y: 0.6,
    }))
  )
  sendInput.mockClear()
  pointer('pointerdown', 200, 200)
  await new Promise((r) => setTimeout(r, 370))
  pointer('pointerup', 200, 200)
  expect(buttons()).toEqual([])
  pointer('pointerdown', 200, 200)
  pointer('pointercancel', 200, 200)
  pointer('pointerup', 200, 200)
  expect(buttons()).toEqual([])
  // Movement stays clamped to desktop edges, and extra fingers never trigger a tap.
  pointer('pointerdown', 100, 100)
  pointer('pointermove', 2000, -2000)
  await flush()
  pointer('pointerup', 2000, -2000)
  expect(sendInput).toHaveBeenCalledWith({ type: 'move', x: 1, y: 0 })
  pointer('pointerdown', 100, 100)
  pointer('pointerdown', 110, 110, 2)
  pointer('pointerup', 110, 110, 2)
  pointer('pointerup', 100, 100)
  expect(buttons()).toEqual([])
  await screen.getByRole('button', { name: '触控板模式' }).click()
  sendInput.mockClear()
  pointer('pointerdown', 200, 225)
  pointer('pointermove', 400, 225)
  await flush()
  pointer('pointerup', 400, 225)
  expect(buttons()).toEqual([
    { type: 'button', button: 'left', down: true, x: 0.25, y: 0.5 },
    { type: 'button', button: 'left', down: false, x: 0.5, y: 0.5 },
  ])
  await screen.unmount()
})

test('mobile keyboard sends chords in order, restores tools after fullscreen fallback and fits resized viewport', async () => {
  const enabled = vi
    .spyOn(document, 'fullscreenEnabled', 'get')
    .mockReturnValue(false)
  const screen = await render(
    <Viewer
      host={{
        id: 'host',
        name: '本机 Linux 桌面',
        busy: false,
        kind: 'linux-x11',
        capabilities: { video: true, systemInput: true, textInput: 'ascii' },
      }}
      session={{
        id: 'keyboard',
        hostId: 'host',
        quality: 'responsive',
        expiresAt: Date.now() + 60000,
      }}
      iceServers={[]}
      token=''
      onExit={() => {}}
    />
  )
  await new Promise((r) => setTimeout(r, 30))
  await screen.getByRole('button', { name: '沉浸模式' }).click()
  expect(document.querySelector('footer')).toBeNull()
  expect(document.querySelector('.remote-viewer')!.textContent).not.toContain(
    '不支持页面全屏'
  )
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    '已进入沉浸模式'
  )
  await expect
    .poll(() => document.querySelector('[role="status"]'), { timeout: 5000 })
    .toBeNull()
  await screen.getByRole('button', { name: '显示工具' }).click()
  await screen.getByRole('button', { name: '键盘', exact: true }).click()
  sendInput.mockClear()
  await screen
    .getByRole('button', { name: '复制 Ctrl + C', exact: true })
    .click()
  expect(sendInput.mock.calls.map((c) => c[0])).toEqual([
    { type: 'key', code: 'ControlLeft', down: true },
    { type: 'key', code: 'KeyC', down: true },
    { type: 'key', code: 'KeyC', down: false },
    { type: 'key', code: 'ControlLeft', down: false },
  ])
  await screen.getByRole('tab', { name: '完整按键' }).click()
  sendInput.mockClear()
  await screen.getByRole('button', { name: 'Ctrl', exact: true }).click()
  await screen.getByRole('button', { name: 'Shift', exact: true }).click()
  expect(sendInput).not.toHaveBeenCalled() // Modifiers are selected locally until a key is tapped.
  await screen.getByRole('button', { name: 'C', exact: true }).click()
  expect(sendInput.mock.calls.map((c) => c[0])).toEqual([
    { type: 'key', code: 'ControlLeft', down: true },
    { type: 'key', code: 'ShiftLeft', down: true },
    { type: 'key', code: 'KeyC', down: true },
    { type: 'key', code: 'KeyC', down: false },
    { type: 'key', code: 'ShiftLeft', down: false },
    { type: 'key', code: 'ControlLeft', down: false },
  ])
  expect(
    screen
      .getByRole('button', { name: 'Ctrl', exact: true })
      .element()
      .getAttribute('aria-pressed')
  ).toBe('false')
  sendInput.mockClear()
  await screen.getByRole('button', { name: 'F5', exact: true }).click()
  expect(sendInput.mock.calls.map((c) => c[0])).toEqual([
    { type: 'key', code: 'F5', down: true },
    { type: 'key', code: 'F5', down: false },
  ])
  for (const [width, height] of [
    [844, 390],
    [390, 844],
    [390, 380],
  ]) {
    await page.viewport(width, height)
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r))
    )
    const panel = document.querySelector('.remote-panel')!
    panel.scrollTop = 0
    expect(
      document.querySelector('.remote-viewer')!.scrollWidth
    ).toBeLessThanOrEqual(width)
    expect(
      document.querySelector('footer')!.getBoundingClientRect().bottom
    ).toBeLessThanOrEqual(height)
    expect(
      document.querySelector('.remote-stage')!.getBoundingClientRect().height
    ).toBeGreaterThan(60)
    await page.screenshot({
      path: `./__screenshots__/keyboard-${width}-${height}.png`,
    })
  }
  await screen.getByRole('tab', { name: '文字输入' }).click()
  await screen.getByRole('textbox', { name: '发送文本' }).fill('abc123')
  sendInput.mockClear()
  await screen.getByRole('button', { name: '发送', exact: true }).click()
  expect(sendInput).toHaveBeenCalledWith({ type: 'text', text: 'abc123' })
  await screen.getByRole('textbox', { name: '发送文本' }).fill('中文')
  sendInput.mockClear()
  await screen.getByRole('button', { name: '发送', exact: true }).click()
  expect(sendInput).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: '收起键盘' }).click()
  expect(document.querySelector('[aria-label="远程键盘"]')).toBeNull()
  await screen.getByRole('button', { name: '更多', exact: true }).click()
  expect(
    document.querySelector('[aria-label="更多工具"]')!.textContent
  ).toContain('添加到主屏幕')
  sendInput.mockClear()
  await screen.getByRole('button', { name: '释放所有按键' }).click()
  expect(sendInput).toHaveBeenCalledWith({ type: 'release-all' })
  await screen.unmount()
  enabled.mockRestore()
}, 30000)

test('landscape keyboard respects panel width and iPhone safe areas', async () => {
  await page.viewport(844, 390)
  const safe = document.createElement('style')
  safe.textContent =
    ':root { --safe-left:59px; --safe-right:59px; --safe-bottom:21px; }'
  document.head.append(safe)
  const screen = await render(
    <Viewer
      host={{
        id: 'layout',
        name: '本机 Linux 桌面',
        busy: false,
        kind: 'linux-x11',
        capabilities: { video: true, systemInput: true },
      }}
      session={{
        id: 'layout',
        hostId: 'layout',
        quality: 'smooth',
        expiresAt: Date.now() + 60000,
      }}
      iceServers={[]}
      token=''
      onExit={() => {}}
    />
  )
  try {
    await screen.getByRole('button', { name: '键盘', exact: true }).click()
    await page.screenshot({ path: './__screenshots__/keyboard-side-panel.png' })
    const panel = document.querySelector('.remote-panel') as HTMLElement
    const stage = document
      .querySelector('.remote-stage')!
      .getBoundingClientRect()
    expect(stage.right).toBeLessThanOrEqual(panel.getBoundingClientRect().left)
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
    for (const button of panel.querySelectorAll('button')) {
      expect(button.scrollWidth, button.textContent ?? '').toBeLessThanOrEqual(
        button.clientWidth
      )
    }
    await screen
      .getByRole('button', { name: '终端复制 Ctrl + Shift + C', exact: true })
      .click()
    expect(sendInput).toHaveBeenCalledWith({
      type: 'key',
      code: 'KeyC',
      down: true,
    })
    for (const tab of ['完整按键', '文字输入', '常用组合']) {
      await screen.getByRole('tab', { name: tab, exact: true }).click()
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth)
    }
  } finally {
    await screen.unmount()
    safe.remove()
  }
}, 30000)
