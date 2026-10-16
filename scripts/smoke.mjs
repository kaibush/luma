// End-to-end WebRTC test with a synthetic captured screen; no OS permissions or input injection.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium } = require('playwright')
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
const errors = []
try {
  const context = await browser.newContext()
  const host = await context.newPage()
  const controller = await context.newPage()
  for (const page of [host, controller]) page.on('pageerror', e => errors.push(e.message))
  await host.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720
      const ctx = canvas.getContext('2d'); let frame = 0
      const draw = () => { ctx.fillStyle = '#183028'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#9bf0ad'; ctx.fillRect((frame++ * 8) % 1200, 300, 80, 80); ctx.font = '40px sans-serif'; ctx.fillText('Remote Console WebRTC test', 80, 120); requestAnimationFrame(draw) }
      draw(); return canvas.captureStream(30)
    }
  })
  const base = process.env.SMOKE_BASE_URL || 'http://localhost:5173'
  await host.goto(`${base}/host`)
  await host.getByLabel('主机名称').fill('Smoke test host')
  await host.getByLabel('主机密钥').fill(env.HOST_TOKEN)
  await host.getByRole('button', {name: '选择屏幕并上线'}).click()
  await host.getByText('在线，等待连接', {exact: true}).waitFor()
  await controller.setViewportSize({width: 844, height: 390})
  await controller.goto(base)
  await controller.getByLabel('控制端密钥', {exact: true}).fill(env.CONTROL_TOKEN)
  await controller.getByRole('button', {name: '进入工作空间'}).click()
  const hostCard = controller.locator('[data-slot="card"]').filter({has: controller.getByText('Smoke test host', {exact: true})})
  await hostCard.getByRole('button', {name: '连接桌面', exact: true}).click()
  await controller.getByText('已连接', {exact: true}).waitFor({timeout: 30000})
  await controller.waitForFunction(() => { const v = document.querySelector('.remote-viewer video'); return v?.videoWidth > 0 && v?.currentTime > 0 })
  const video = controller.locator('.remote-viewer video')
  const box = await video.boundingBox()
  await controller.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await controller.getByRole('button', {name: '键盘', exact: true}).click()
  await controller.getByLabel('发送文本', {exact: true}).fill('端到端输入已到达')
  await controller.getByRole('button', {name: '发送', exact: true}).click()
  await host.getByText('端到端输入已到达', {exact: false}).waitFor()
  await controller.getByRole('button', {name: '键盘', exact: true}).click()
  const dimensions = await controller.evaluate(() => ({width: innerWidth, scrollWidth: document.querySelector('.remote-viewer').scrollWidth, height: innerHeight, viewer: document.querySelector('.remote-viewer').getBoundingClientRect().height}))
  assert.ok(dimensions.scrollWidth <= dimensions.width, 'landscape should not overflow horizontally')
  assert.ok(dimensions.viewer <= dimensions.height + 1, 'viewer should fit viewport')
  await controller.screenshot({path: '/tmp/remote-console-landscape.png'})
  await controller.getByRole('button', {name: '结束会话并返回'}).click()
  await host.getByText('在线，等待连接', {exact: true}).waitFor()
  await controller.getByRole('button', {name: '刷新', exact: true}).click()
  await hostCard.getByRole('button', {name: '连接桌面', exact: true}).click()
  await controller.getByText('已连接', {exact: true}).waitFor({timeout: 30000})
  await controller.getByRole('button', {name: '结束会话并返回'}).click()
  await host.getByRole('button', {name: '停止共享', exact: true}).click()
  await controller.setViewportSize({width: 390, height: 844})
  await controller.getByRole('button', {name: '刷新', exact: true}).click()
  await controller.getByText('Smoke test host', {exact: true}).waitFor({state: 'hidden'})
  await controller.evaluate(() => window.scrollTo(0, 0))
  await controller.screenshot({path: '/tmp/remote-console-mobile.png'})
  assert.deepEqual(errors, [], 'no browser runtime errors')
  console.log('PASS: WebRTC video, reliable text input, landscape viewport, session reconnect, host cleanup, mobile host list.')
} finally { await browser.close() }
