// Isolated browser-host, persistent offline UI, and credential lifecycle verification.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import { createApp } from '../apps/server/src/server.ts'

const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium } = require('playwright')
const controlToken = randomBytes(32).toString('hex'), hostToken = randomBytes(32).toString('hex')
const webPort = 23988, base = `http://localhost:${webPort}`
const app = await createApp({ controlToken, hostToken, origins: [base], logger: false })
let vite, browser
try {
  await app.listen({ host: '127.0.0.1', port: 0 })
  vite = spawn('node', ['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts', '--host', '127.0.0.1', '--port', String(webPort)], {
    env: { ...process.env, API_PORT: String(app.server.address().port) }, stdio: 'ignore',
  })
  const until = Date.now() + 60000
  while (true) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (Date.now() > until) throw new Error('Vite timeout')
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } })
  const headers = { 'X-Remote-Request': '1' }
  await context.request.post(`${base}/api/auth/setup/unlock`, { headers, data: { key: controlToken } })
  assert.equal((await context.request.post(`${base}/api/auth/setup/complete`, { headers, data: {
    username: 'admin', password: 'test-password-1234', settings: { workspaceName: '主机验证', defaultQuality: 'responsive', sessionMinutes: 30, stunUrl: '', turnUrl: '' },
  } })).status(), 200)
  const created = await context.request.post(`${base}/api/manage/tokens`, { headers, data: { name: '浏览器验收专用', scope: 'host', days: 7 } })
  const token = await created.json()
  const publisher = await context.newPage(), dashboard = await context.newPage(), management = await context.newPage()
  const errors = []
  for (const page of [publisher, dashboard, management]) page.on('pageerror', error => errors.push(error.message))
  await publisher.addInitScript(() => {
    window.captureCount = 0
    navigator.mediaDevices.getDisplayMedia = async () => {
      window.captureCount++
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360
      const ctx = canvas.getContext('2d'); let frame = 0
      const draw = () => {
        ctx.fillStyle = '#183028'; ctx.fillRect(0, 0, 640, 360)
        ctx.fillStyle = '#9bf0ad'; ctx.fillRect((frame++ * 4) % 580, 100, 60, 60)
        requestAnimationFrame(draw)
      }
      draw(); return canvas.captureStream(30)
    }
  })
  await publisher.goto(`${base}/host`)
  await publisher.getByRole('button', { name: '浏览器接入', exact: true }).click()
  await publisher.getByLabel('共享名称', { exact: true }).fill('持久浏览器主机')
  await publisher.getByLabel('主机密钥', { exact: true }).fill(controlToken)
  await publisher.getByRole('button', { name: '验证主机密钥', exact: true }).click()
  await publisher.getByRole('alert').filter({ hasText: '这是控制 API 密钥' }).waitFor()
  assert.equal(await publisher.evaluate(() => window.captureCount), 0)
  await publisher.getByLabel('选择已有主机密钥').click()
  assert.equal(await publisher.getByRole('option').filter({ hasText: '控制' }).count(), 0)
  await publisher.getByRole('option').filter({ hasText: '浏览器验收专用' }).click()
  await publisher.getByRole('button', { name: '验证主机密钥', exact: true }).click()
  await publisher.getByRole('button', { name: '选择屏幕并上线', exact: true }).click()
  await publisher.getByText(/已上线：持久浏览器主机/).waitFor()
  let host = (await (await context.request.get(`${base}/api/hosts`)).json()).hosts[0]
  const hostId = host.id
  await context.request.put(`${base}/api/hosts/${hostId}`, { headers, data: { group: '验收组', note: '应保留的主机备注' } })
  await dashboard.goto(base)
  const card = dashboard.locator('.host-card').filter({ hasText: '持久浏览器主机' })
  await card.getByRole('button', { name: '观看画面', exact: true }).click()
  await dashboard.waitForFunction(() => {
    const video = document.querySelector('.remote-viewer video')
    return video?.videoWidth > 0 && video?.currentTime > 0
  }, { timeout: 30000 })
  await dashboard.getByRole('button', { name: '结束会话并返回', exact: true }).click()
  await publisher.getByRole('button', { name: '停止共享', exact: true }).click()
  await dashboard.getByRole('button', { name: '刷新', exact: true }).click()
  await card.getByText('离线', { exact: true }).waitFor()
  assert.equal(await card.getByRole('button', { name: '重新共享', exact: true }).isEnabled(), true)
  await card.getByText('验收组 · 应保留的主机备注', { exact: true }).waitFor()
  await card.getByRole('button', { name: '查看档案 / 编辑备注' }).click()
  await dashboard.getByLabel('备注', { exact: true }).fill('离线也能编辑')
  await dashboard.getByRole('button', { name: '保存分组与备注' }).click()
  await dashboard.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await dashboard.setViewportSize({ width: 390, height: 844 })
  assert.ok(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await dashboard.screenshot({ path: '/tmp/remote-host-offline-mobile.png', fullPage: true })
  // Reuse the same tab identity through a reload and a second sharing session.
  await publisher.reload()
  await publisher.getByRole('button', { name: '浏览器接入', exact: true }).click()
  await publisher.getByLabel('共享名称', { exact: true }).fill('持久浏览器主机')
  await publisher.getByLabel('主机密钥', { exact: true }).fill(token.value)
  const shareAgain = async () => {
    await publisher.getByRole('button', { name: '验证主机密钥', exact: true }).click()
    await publisher.getByRole('button', { name: '选择屏幕并上线', exact: true }).click()
    await publisher.getByText(/已上线：持久浏览器主机/).waitFor()
  }
  await shareAgain()
  host = (await (await context.request.get(`${base}/api/hosts`)).json()).hosts[0]
  assert.equal(host.id, hostId); assert.equal(host.note, '离线也能编辑')
  await management.goto(`${base}/management/tokens`)
  const row = management.getByRole('row').filter({ hasText: '浏览器验收专用' })
  await row.getByText('持久浏览器主机 · 在线', { exact: true }).waitFor()
  await row.getByRole('button', { name: '修改主机名称：持久浏览器主机', exact: true }).click()
  await management.getByLabel('主机显示名称', { exact: true }).fill('自定义关联主机名称')
  await management.getByRole('dialog').getByRole('button', { name: '保存名称', exact: true }).click()
  await row.getByText('自定义关联主机名称 · 在线', { exact: true }).waitFor()
  await dashboard.getByRole('button', { name: '刷新', exact: true }).click()
  const renamedCard = dashboard.locator('.host-card').filter({ hasText: '自定义关联主机名称' })
  await renamedCard.waitFor()
  host = (await (await context.request.get(`${base}/api/hosts`)).json()).hosts[0]
  assert.equal(host.id, hostId); assert.equal(host.accessToken.id, token.id)
  assert.equal(host.reportedName, '持久浏览器主机')
  await row.getByRole('button', { name: '撤销', exact: true }).click()
  await management.getByRole('button', { name: '确认撤销', exact: true }).click()
  await row.getByText('已撤销', { exact: true }).waitFor()
  await publisher.getByRole('button', { name: '验证主机密钥', exact: true }).waitFor()
  await dashboard.getByRole('button', { name: '刷新', exact: true }).click()
  await renamedCard.getByText(/主机密钥已撤销/).waitFor()
  await management.setViewportSize({ width: 390, height: 844 })
  const mobileLinkedToken = management.locator('[aria-label="密钥 浏览器验收专用"]')
  await mobileLinkedToken.getByRole('button', { name: '修改主机名称：自定义关联主机名称', exact: true }).click()
  assert.equal(await management.getByLabel('主机显示名称', { exact: true }).inputValue(), '自定义关联主机名称')
  await management.getByRole('button', { name: '恢复客户端名称', exact: true }).click()
  await management.getByRole('dialog').getByRole('button', { name: '保存名称', exact: true }).click()
  await mobileLinkedToken.getByText('持久浏览器主机 · 离线', { exact: true }).waitFor()
  await management.setViewportSize({ width: 1100, height: 800 })
  await dashboard.getByRole('button', { name: '刷新', exact: true }).click()
  await card.waitFor()
  await row.getByRole('button', { name: '恢复', exact: true }).click()
  await management.getByRole('button', { name: '确认恢复', exact: true }).click()
  await row.getByText('有效', { exact: true }).waitFor()
  await shareAgain()
  assert.equal((await (await context.request.get(`${base}/api/hosts`)).json()).hosts[0].id, hostId)
  await row.getByRole('button', { name: '撤销', exact: true }).click()
  await management.getByRole('button', { name: '确认撤销', exact: true }).click()
  await row.getByRole('button', { name: '永久删除', exact: true }).click()
  await management.getByRole('button', { name: '确认永久删除', exact: true }).click()
  await row.waitFor({ state: 'hidden' })
  host = (await (await context.request.get(`${base}/api/hosts`)).json()).hosts[0]
  assert.equal(host.accessToken.status, 'deleted'); assert.equal(host.online, false)
  await management.setViewportSize({ width: 390, height: 844 })
  assert.ok(await management.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const mobileToken = management.locator('[aria-label="密钥 部署主机接入密钥"]')
  await mobileToken.getByRole('button', { name: '查看密钥', exact: true }).waitFor()
  await mobileToken.getByRole('button', { name: '撤销', exact: true }).click()
  await management.getByRole('button', { name: '确认撤销', exact: true }).click()
  await mobileToken.getByRole('button', { name: '恢复', exact: true }).click()
  await management.getByRole('button', { name: '确认恢复', exact: true }).click()
  await mobileToken.getByText('有效', { exact: true }).waitFor()
  await management.screenshot({ path: '/tmp/remote-token-management-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: invalid-key capture prevention, scoped key picker, WebRTC video, offline metadata, stable browser identity, host display names/reset, revoke/restore/delete, mobile layouts.')
} finally {
  await browser?.close()
  if (vite) { vite.kill('SIGTERM'); await new Promise(resolve => vite.once('exit', resolve)) }
  await app.close()
}
