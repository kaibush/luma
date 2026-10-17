// Isolated service, X11 display and Agent. Never connects to the production API.
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import assert from 'node:assert/strict'
import { createApp } from '../apps/server/src/server.ts'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium } = require('playwright')
const temp = mkdtempSync(`${tmpdir()}/remote-tools-`)
const token = randomBytes(32).toString('hex'), hostToken = randomBytes(32).toString('hex')
const port = 18987, webPort = 18988, base = `http://localhost:${webPort}`
const app = await createApp({ controlToken: token, hostToken, origins: [base], logger: false })
const children = []; let browser
const child = (cmd, args, env = {}) => { const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(p); p.stderr.on('data', data => { if (process.env.SMOKE_VERBOSE) process.stderr.write(data) }); return p }
const waitFor = async (fn, timeout = 60000) => { const end = Date.now()+timeout; while (Date.now()<end) { try { const v = await fn(); if(v) return v } catch {} await new Promise(r=>setTimeout(r,300)) } throw new Error('wait timeout') }
try {
  await app.listen({host:'127.0.0.1',port})
  const xvfb=child('Xvfb',['-displayfd','1','-screen','0','1024x768x24','-nolisten','tcp','-ac'])
  const display=await new Promise((resolve,reject)=>{xvfb.stdout.once('data', d=>resolve(':'+d.toString().trim()));xvfb.once('error',reject)})
  child('apps/agent/.venv/bin/python',['apps/agent/main.py'],{DISPLAY:display,HOST_TOKEN:hostToken,HOST_NAME:'工具验收主机',SIGNAL_URL:`ws://127.0.0.1:${port}/ws`,XDG_CONFIG_HOME:temp,RC_TERMINAL:'1',RC_FILES:'1',RC_CLIPBOARD:'1',RC_AUDIO:'0',RC_FILE_ROOT:temp,SHELL:'/bin/sh'})
  const fixture=child('apps/agent/.venv/bin/python',['apps/agent/input_fixture.py'],{DISPLAY:display,FIXTURE_OUTPUT:`${temp}/events.jsonl`})
  await new Promise((resolve,reject)=>{fixture.stdout.once('data',d=>resolve(JSON.parse(d.toString())));fixture.once('error',reject)})
  child('node',['node_modules/vite/bin/vite.js','apps/web','--config','apps/web/vite.config.ts','--host','127.0.0.1','--port',String(webPort)],{API_PORT:String(port)})
  await waitFor(()=>fetch(base).then(r=>r.ok),120000)
  await waitFor(async()=> (await app.inject({url:'/api/hosts',headers:{authorization:`Bearer ${token}`}})).json().hosts.length)
  browser=await chromium.launch({headless:true,args:['--no-sandbox']})
  const context=await browser.newContext({viewport:{width:1000,height:800},acceptDownloads:true})
  const headers={'X-Remote-Request':'1'}
  let response=await context.request.post(`${base}/api/auth/setup/unlock`,{headers,data:{key:token}});assert.equal(response.status(),200)
  response=await context.request.post(`${base}/api/auth/setup/complete`,{headers,data:{username:'testadmin',password:'isolated-test-password',settings:{workspaceName:'工具验收',defaultQuality:'ultrafast',sessionMinutes:15,stunUrl:'',turnUrl:''}}});assert.equal(response.status(),200)
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
  page.setDefaultTimeout(45000)
  await page.addInitScript(() => {
    window.__signalSockets = []
    const NativeSocket = WebSocket
    window.WebSocket = class extends NativeSocket { constructor(...args) { super(...args); if(String(args[0]).endsWith('/ws')) window.__signalSockets.push(this) } }
  })
  await page.goto(base)
  console.log('Browser loaded; opening workspace')
  await page.getByRole('button',{name:'状态 / 终端 / 文件'}).click()
  await page.getByLabel('主机分组',{exact:true}).fill('测试分组')
  await page.getByLabel('备注',{exact:true}).fill('端到端验证')
  await page.getByRole('button',{name:'保存分组与备注'}).click()
  await page.getByRole('tab',{name:'终端',exact:true}).click()
  await page.locator('.xterm-helper-textarea').waitFor()
  await waitFor(async()=>page.locator('.xterm-screen').innerText().then(t=>t.includes('#')||t.includes('$')),45000)
  await page.locator('.xterm-helper-textarea').pressSequentially(`printf 'REMOTE_TERMINAL_OK' > ${temp}/terminal-ok.txt`,{delay:35})
  await page.keyboard.press('Enter')
  await waitFor(()=>readFileSync(`${temp}/terminal-ok.txt`,'utf8')==='REMOTE_TERMINAL_OK',15000)
  assert.equal((await context.request.get(`${base}/api/hosts`)).ok(),true)
  const host=(await (await context.request.get(`${base}/api/hosts`)).json()).hosts[0]
  assert.equal(host.stats.encoder,'idle','tools session must not capture desktop')
  console.log('Terminal verified')
  await page.getByLabel('终端命令',{exact:true}).fill('KEEP_SESSION=retained')
  await page.getByRole('button',{name:'执行',exact:true}).click()
  await page.screenshot({path:'/tmp/remote-console-terminal-redesign.png',fullPage:false})
  await page.getByRole('tab',{name:'文件',exact:true}).click()
  await page.getByLabel('上传到当前目录').setInputFiles({name:'中文文件.txt',mimeType:'text/plain',buffer:Buffer.from('文件往返测试\n')})
  await page.getByText('传输完成',{exact:true}).waitFor()
  assert.equal(readFileSync(`${temp}/中文文件.txt`,'utf8'),'文件往返测试\n')
  const downloaded=page.waitForEvent('download')
  await page.getByRole('button',{name:/下载 · 中文文件/}).click()
  const download=await downloaded;const local=await download.path();assert.equal(readFileSync(local,'utf8'),'文件往返测试\n')
  console.log('Files verified')
  await page.getByRole('button',{name:'新建文件夹',exact:true}).click()
  await page.getByLabel('文件夹名称',{exact:true}).fill('新目录')
  await page.getByRole('button',{name:'创建文件夹',exact:true}).click()
  await page.getByRole('button',{name:'新目录',exact:true}).click()
  await page.getByLabel('上传到当前目录').setInputFiles([{name:'first.txt',mimeType:'text/plain',buffer:Buffer.alloc(80000,65)},{name:'second.txt',mimeType:'text/plain',buffer:Buffer.from('second')}])
  await waitFor(()=>readFileSync(`${temp}/新目录/second.txt`,'utf8')==='second')
  assert.equal(readFileSync(`${temp}/新目录/first.txt`).length,80000)
  await page.getByText('传输完成',{exact:true}).waitFor()
  const bigDownload=page.waitForEvent('download')
  await page.getByRole('button',{name:'下载 · first.txt',exact:true}).click()
  const big=await bigDownload
  assert.deepEqual(readFileSync(await big.path()),Buffer.alloc(80000,65))
  await page.getByText('传输完成',{exact:true}).waitFor()
  await page.getByLabel('搜索当前文件',{exact:true}).fill('first')
  assert.equal(await page.getByRole('button',{name:'下载 · second.txt',exact:true}).count(),0)
  await page.screenshot({path:'/tmp/remote-console-files-redesign.png',fullPage:false})
  await page.getByRole('tab',{name:'终端',exact:true}).click()
  await page.getByLabel('终端命令',{exact:true}).fill(`printf "$KEEP_SESSION" > ${temp}/retained.txt`)
  await page.getByRole('button',{name:'执行',exact:true}).click()
  await waitFor(()=>readFileSync(`${temp}/retained.txt`,'utf8')==='retained')
  console.log('PASS: terminal survives tab switches; folder creation, queued uploads, file filtering')

  await page.getByRole('tab',{name:'桌面',exact:true}).click()
  await page.getByRole('tabpanel').getByRole('button',{name:'连接桌面',exact:true}).click()
  await page.getByText('已连接',{exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelector('.remote-viewer video')?.videoWidth>0)
  await page.getByRole('button',{name:'更多',exact:true}).click()
  await page.getByLabel('文本剪贴板',{exact:true}).fill('双向剪贴板验证')
  await page.getByRole('button',{name:'发送到远端',exact:true}).click()
  await page.getByText('已发送到远端，可在远程应用中粘贴').waitFor()
  await page.getByLabel('文本剪贴板',{exact:true}).fill('')
  await page.getByRole('button',{name:'取回远端',exact:true}).click()
  await waitFor(async()=>await page.getByLabel('文本剪贴板',{exact:true}).inputValue()==='双向剪贴板验证')
  await page.getByRole('button',{name:'关闭更多工具'}).click()
  // Break the controller's signaling socket; a new session should be reserved.
  const before=(await (await context.request.get(`${base}/api/manage/connections`)).json()).connections[0].id
  await page.evaluate(() => window.__signalSockets.filter(ws=>ws.readyState===WebSocket.OPEN).forEach(ws=>ws.close(4001,'Test network interruption')))
  await waitFor(async () => {
    const connections=(await (await context.request.get(`${base}/api/manage/connections`)).json()).connections
    return connections[0]?.id !== before && connections[0]?.connected
  }, 60000)
  await page.getByText('已连接',{exact:true}).waitFor({timeout:60000})
  await page.getByRole('button',{name:'结束会话并返回'}).click()
  await waitFor(async()=>!(await (await context.request.get(`${base}/api/hosts`)).json()).hosts[0].busy)
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'状态 / 终端 / 文件'}).click()
  await page.getByRole('tab',{name:'状态',exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'mobile layout must not overflow')
  await page.screenshot({path:'/tmp/remote-console-tools-mobile.png',fullPage:true})
  await page.getByRole('tab',{name:'终端',exact:true}).click()
  await page.getByText('已连接',{exact:true}).waitFor()
  const bounds=await page.getByRole('dialog').boundingBox()
  assert.ok(bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=391 && bounds.y+bounds.height<=845,'workspace fits mobile viewport')
  await page.screenshot({path:'/tmp/remote-console-terminal-mobile.png',fullPage:false})
  await page.getByRole('tab',{name:'文件',exact:true}).click()
  await page.getByText('terminal-ok.txt',{exact:true}).waitFor()
  await page.screenshot({path:'/tmp/remote-console-files-mobile.png',fullPage:false})
  assert.deepEqual(errors,[])
  console.log('PASS: real Agent status, metadata, PTY terminal, file upload/download, desktop stream, clipboard, automatic session recovery, mobile layout and cleanup.')
} finally {
  await browser?.close()
  for(const p of children) p.kill('SIGTERM')
  await app.close();rmSync(temp,{recursive:true,force:true})
}
