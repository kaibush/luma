// Isolated end-to-end coverage for archive deletion, browser recovery and audit pages.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
import { createApp } from '../apps/server/src/server.ts'

const dir = mkdtempSync(join(tmpdir(), 'remote-host-management-'))
const dataPath = join(dir, 'test.sqlite')
const controlToken = randomBytes(32).toString('hex'), hostToken = randomBytes(32).toString('hex')
const port = 23989, base = `http://localhost:${port}`
const app = await createApp({ controlToken, hostToken, origins: [base], dataPath, logger: false })
let vite, browser
try {
  await app.listen({ host: '127.0.0.1', port: 0 })
  vite = spawn('node', ['node_modules/vite/bin/vite.js', 'apps/web', '--config', 'apps/web/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, API_PORT: String(app.server.address().port) }, stdio: 'ignore',
  })
  const deadline = Date.now() + 45000
  while (true) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (Date.now() > deadline) throw new Error('Vite startup timeout')
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, colorScheme: 'light' })
  const headers = { 'X-Remote-Request': '1' }
  await context.request.post(`${base}/api/auth/setup/unlock`, { headers, data: { key: controlToken } })
  assert.equal((await context.request.post(`${base}/api/auth/setup/complete`, { headers, data: {
    username: 'admin', password: 'test-password-1234', settings: { workspaceName: '主机管理验收', defaultQuality: 'responsive', sessionMinutes: 30, stunUrl: '', turnUrl: '' },
  } })).status(), 200)
  const errors = []
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  // Simulate the user's screen-picker approval; no actual desktop is captured.
  await context.addInitScript(() => {
    if (!navigator.mediaDevices) return
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360
      return canvas.captureStream(1)
    }
  })
  let publisher = await context.newPage()
  const dashboard = await context.newPage()
  await publisher.goto(`${base}/host`)
  await publisher.getByRole('button', { name: '浏览器接入', exact: true }).click()
  await publisher.getByLabel('共享名称', { exact: true }).fill('可恢复的浏览器电脑')
  await publisher.getByLabel('主机密钥', { exact: true }).fill(hostToken)
  const start = async () => {
    await publisher.getByRole('button', { name: '验证主机密钥', exact: true }).click()
    await publisher.getByRole('button', { name: '选择屏幕并上线', exact: true }).click()
    await publisher.getByText(/已上线：可恢复的浏览器电脑/).waitFor()
  }
  await start()
  const list = async () => (await (await context.request.get(`${base}/api/hosts`)).json()).hosts
  const first = (await list())[0]
  await context.request.put(`${base}/api/hosts/${first.id}`, { headers, data: { group: '办公室', note: '恢复后保留' } })
  await dashboard.goto(base)
  let card = dashboard.locator('.host-card').filter({ hasText: '可恢复的浏览器电脑' })
  assert.equal(await card.getByRole('button', { name: '删除主机 可恢复的浏览器电脑', exact: true }).isDisabled(), true)
  await publisher.getByRole('button', { name: '停止共享', exact: true }).click()
  await publisher.close()
  await dashboard.getByRole('button', { name: '刷新', exact: true }).click()
  await card.getByRole('button', { name: '重新共享', exact: true }).click()
  const resumeUrl = await dashboard.getByLabel('重新共享链接', { exact: true }).inputValue()
  assert.equal(new URL(resumeUrl).searchParams.get('resume'), first.id)
  await dashboard.screenshot({ path: '/tmp/remote-host-resume-dialog.png', animations: 'disabled' })
  await dashboard.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  publisher = await context.newPage()
  await publisher.goto(resumeUrl)
  await publisher.getByLabel('主机密钥', { exact: true }).fill(hostToken)
  await start()
  assert.equal((await list()).length, 1)
  assert.equal((await list())[0].id, first.id)
  assert.equal((await list())[0].note, '恢复后保留')
  await publisher.getByRole('button', { name: '停止共享', exact: true }).click()
  await dashboard.getByRole('button', { name: '刷新', exact: true }).click()
  await card.getByRole('button', { name: '重新共享', exact: true }).waitFor()
  await dashboard.setViewportSize({ width: 390, height: 844 })
  assert.ok(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await card.getByRole('button', { name: '删除主机 可恢复的浏览器电脑', exact: true }).click()
  await dashboard.screenshot({ path: '/tmp/remote-host-delete-mobile.png', animations: 'disabled' })
  await dashboard.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal((await list()).length, 1)
  await card.getByRole('button', { name: '删除主机 可恢复的浏览器电脑', exact: true }).click()
  await dashboard.getByRole('alertdialog').getByRole('button', { name: '删除主机', exact: true }).click()
  await card.waitFor({ state: 'hidden' })
  assert.equal((await list()).length, 0)
  await dashboard.reload()
  assert.equal((await list()).length, 0)
  console.log('PASS: real API browser recovery, original archive retained, cancel/delete, reload and mobile dialogs')

  const db = new DatabaseSync(dataPath)
  for (let i = 0; i < 65; i++) db.prepare('INSERT INTO audit(time,actor,action,detail) VALUES(?,?,?,?)').run(Date.now(), 'admin', 'host.delete', `历史记录 ${i}`)
  db.close()
  await dashboard.setViewportSize({ width: 1365, height: 900 })
  await dashboard.goto(`${base}/management/audit`)
  await dashboard.getByText('历史记录 64', { exact: true }).waitFor()
  const audit = dashboard.getByRole('region', { name: '操作记录列表' })
  assert.equal(await audit.locator('tbody tr').count(), 20)
  await dashboard.screenshot({ path: '/tmp/remote-audit-desktop.png', fullPage: true })
  for (const page of [2, 3, 4]) {
    await dashboard.getByRole('button', { name: '下一页', exact: true }).click()
    await dashboard.getByText(`第 ${page} / 4 页`, { exact: true }).waitFor()
  }
  await dashboard.getByText('历史记录 0', { exact: true }).waitFor()
  assert.equal(await dashboard.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true)
  await dashboard.getByRole('combobox', { name: '每页记录数' }).click()
  await dashboard.getByRole('option', { name: '50 条 / 页', exact: true }).click()
  await dashboard.getByText('第 1 / 2 页', { exact: true }).waitFor()
  await audit.getByRole('row').nth(50).waitFor()
  assert.equal(await audit.locator('tbody tr').count(), 50)
  await dashboard.setViewportSize({ width: 390, height: 844 })
  assert.ok(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await dashboard.screenshot({ path: '/tmp/remote-audit-mobile.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: audit records beyond 50, page size, boundaries, desktop/mobile layouts and no browser errors')
} finally {
  await browser?.close()
  if (vite) { const exit = new Promise(resolve => vite.once('exit', resolve)); vite.kill('SIGTERM'); await exit }
  await app.close()
  rmSync(dir, { recursive: true, force: true })
}
