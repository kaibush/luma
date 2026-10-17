// UI checks use mocked APIs; no real remote sessions are created.
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium, webkit } = require('playwright')
const base = process.env.DASHBOARD_URL || 'http://localhost:5173'
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    let hosts = [
      { id: 'one', name: '办公电脑', kind: 'linux-x11', busy: false, capabilities: { video: true, systemInput: true } },
      { id: 'two', name: 'Design workstation', kind: 'browser', busy: true, capabilities: { video: true, systemInput: false } },
      { id: 'three', name: '测试主机-LongNameWithoutBreaks123456789012345678901234567890', kind: 'linux-x11', busy: false, capabilities: { video: true, systemInput: true } },
    ]
    let reservation
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      let data = {}
      if (path === '/api/auth/me') data = { initialized: true, user: { username: 'test-admin' }, workspaceName: '我的工作空间' }
      if (path === '/api/preferences') data = { defaultQuality: 'responsive' }
      if (path === '/api/hosts') data = { hosts }
      if (path === '/api/sessions') {
        reservation = route.request().postDataJSON()
        return route.fulfill({ status: 409, json: { error: '测试连接反馈' } })
      }
      await route.fulfill({ json: data })
    })
    await page.goto(base)
    await page.getByRole('button', { name: '收藏 办公电脑', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: '取消收藏 办公电脑', exact: true }).waitFor()
    await page.getByRole('radio', { name: '收藏', exact: true }).click()
    assert.equal(await page.locator('.dashboard-host').count(), 1)
    hosts[0].id = 'reconnected'
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await page.getByRole('button', { name: '取消收藏 办公电脑', exact: true }).waitFor()
    await page.getByRole('radio', { name: '全部', exact: true }).click()
    await page.getByLabel('搜索主机', { exact: true }).fill('design')
    assert.equal(await page.locator('.dashboard-host').count(), 1)
    assert.equal(await page.getByRole('button', { name: '已有活动会话' }).isDisabled(), true)
    await page.getByLabel('搜索主机', { exact: true }).fill('不存在')
    await page.getByText('没有符合条件的主机', { exact: true }).waitFor()
    await page.getByRole('button', { name: '清除筛选' }).click()
    await page.getByRole('radio', { name: '可连接', exact: true }).click()
    assert.equal(await page.locator('.dashboard-host').count(), 2)
    await page.getByRole('radio', { name: /省流畅连/ }).click()
    assert.equal(await page.locator('#quality').inputValue(), 'smooth')
    await page.locator('.dashboard-host').first().getByRole('button', { name: '连接桌面' }).click()
    await page.getByText('测试连接反馈', { exact: true }).waitFor()
    assert.deepEqual(reservation, { hostId: 'reconnected', quality: 'smooth' })
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await page.getByText('测试连接反馈', { exact: true }).waitFor({ state: 'hidden' })
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(size)
      await page.screenshot({ path: `/tmp/dashboard-${engine.name()}-${size.width}.png`, fullPage: true })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${size.width}`)
    }
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: `/tmp/dashboard-${engine.name()}-dark.png`, fullPage: true })
    assert.deepEqual(errors, [])
    console.log(`PASS ${engine.name()}: search, favorites after reload/reconnect, filters, busy state, preset request, mobile/desktop layout`)
  } finally { await browser.close() }
}
