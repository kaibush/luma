import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium, webkit } = require('playwright')
const base = process.env.CLIENT_TEST_URL || 'http://127.0.0.1:4173'
for (const engine of (process.env.CLIENT_BROWSER === 'webkit' ? [webkit] : [chromium, webkit])) {
 const browser = await engine.launch({headless:true})
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}})
  const errors=[]; page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/api/auth/me',route=>route.fulfill({json:{initialized:true,user:{username:'test'},workspaceName:'测试控制台'}}))
  await page.goto(base+'/host')
  for (const name of ['下载 Linux 客户端','下载 Windows 预览版']) {
   const link=page.getByRole('link',{name,exact:true}); await link.waitFor()
   const response=await page.request.get(new URL(await link.getAttribute('href'), base).href)
   assert.equal(response.status(),200)
   assert.ok((await response.body()).length>1000)
   assert.ok(!(response.headers()['content-type']||'').includes('text/html'))
  }
  for (const width of [390,844]) {
   await page.setViewportSize({width,height:width===390?844:390})
   await page.screenshot({path:`/tmp/client-download-${engine.name()}-${width}.png`,fullPage:true})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  }
  assert.deepEqual(errors,[])
  console.log(`PASS ${engine.name()}: download archives and mobile layouts`)
 } finally {await browser.close()}
}
