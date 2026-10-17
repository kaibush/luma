import '@/styles/index.css'
import { page } from 'vitest/browser'
import { afterEach, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Viewer } from './viewer'

const { sendInput } = vi.hoisted(() => ({ sendInput: vi.fn() }))
vi.mock('./api', () => ({
  api: vi.fn(async () => {}),
  sendSignal: vi.fn(),
  signaling: () => ({ close: vi.fn() }),
}))
vi.mock('./peer', () => ({
  RemotePeer: class {
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
    const viewer = document.querySelector('.remote-viewer')!
    expect(viewer.scrollWidth).toBeLessThanOrEqual(width)
    expect(
      document.querySelector('.remote-stage')!.getBoundingClientRect().height
    ).toBeGreaterThan(180)
    expect(
      document.querySelector('footer')!.getBoundingClientRect().bottom
    ).toBeLessThanOrEqual(height)
    await page.screenshot({ path: `./__screenshots__/remote-touchpad-${width}.png` })
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
