import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
const require=createRequire(new URL('../apps/web/package.json',import.meta.url))
const {chromium}=require('playwright')
const env=Object.fromEntries(readFileSync('/etc/remote-console/environment','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)]}))
const base=process.env.SMOKE_BASE_URL || 'https://rc.lvyrix.com'
const dir=mkdtempSync(`${tmpdir()}/remote-input-`), output=`${dir}/events.jsonl`
const fixture=spawn('apps/agent/.venv/bin/python',['apps/agent/input_fixture.py'],{env:{...process.env,DISPLAY:':10',XAUTHORITY:'/root/.Xauthority',FIXTURE_OUTPUT:output},stdio:['ignore','pipe','inherit']})
const metadata=await Promise.race([once(fixture.stdout,'data').then(([data])=>JSON.parse(data.toString())),new Promise((_,reject)=>setTimeout(()=>reject(new Error('X11 fixture timeout')),10000).unref())])
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']})
const events=()=>readFileSync(output,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
const errors=[]
try {
  const page=await browser.newPage({viewport:{width:844,height:390}})
  page.on('pageerror',e=>errors.push(e.message))
  // Force TURN to verify the relay path, even though test browser is on this server.
  await page.addInitScript(()=>{const Original=window.RTCPeerConnection;window.RTCPeerConnection=class extends Original{constructor(config){super({...config,iceTransportPolicy:'relay'})}}})
  await page.goto(base)
  await page.getByLabel('控制端密钥',{exact:true}).fill(env.CONTROL_TOKEN)
  await page.getByRole('button',{name:'进入工作空间'}).click()
  const card=page.locator('[data-slot="card"]').filter({has:page.getByText('本机 Linux 桌面',{exact:true})})
  await card.getByRole('button',{name:'连接桌面',exact:true}).click()
  await page.getByText('已连接',{exact:true}).waitFor({timeout:30000})
  await page.waitForFunction(()=>{const v=document.querySelector('.remote-viewer video');return v?.videoWidth>0 && v.currentTime>.2})
  const video=page.locator('.remote-viewer video'), box=await video.boundingBox()
  const actual=await video.evaluate(v=>({width:v.videoWidth,height:v.videoHeight}))
  const scale=Math.min(box.width/actual.width,box.height/actual.height)
  await page.mouse.click(box.x+(box.width-actual.width*scale)/2+300/metadata.width*actual.width*scale,box.y+(box.height-actual.height*scale)/2+210/metadata.height*actual.height*scale)
  await page.keyboard.press('a')
  await page.waitForTimeout(400)
  assert.ok(events().some(e=>e.type===4&&e.detail===1),'native mouse button reaches X11 fixture')
  assert.ok(events().some(e=>e.type===2&&e.detail===metadata.keyA),'native key reaches X11 fixture')
  const pixel=await video.evaluate((v,meta)=>{const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const ctx=c.getContext('2d');ctx.drawImage(v,0,0);return [...ctx.getImageData(Math.round(150/meta.width*c.width),Math.round(150/meta.height*c.height),1,1).data]},metadata)
  assert.ok(pixel[2]>pixel[0]+30 && pixel[1]>pixel[0]+15,'decoded video contains the real X11 test window')
  await page.getByRole('button',{name:'键盘',exact:true}).click()
  await page.getByLabel('发送文本',{exact:true}).fill('abc123')
  await page.getByRole('button',{name:'发送',exact:true}).click()
  await page.waitForTimeout(500)
  assert.ok(events().filter(e=>e.type===2).length>=7,'text input reaches X11')
  await page.getByRole('button',{name:'键盘',exact:true}).click()
  await video.focus()
  await page.keyboard.down('Control')
  await page.waitForTimeout(200)
  await page.close()
  await new Promise(r=>setTimeout(r,1000))
  const trace=events()
  assert.ok(trace.some(e=>e.type===2&&e.detail===metadata.control),'held modifier reached fixture')
  assert.ok(trace.some(e=>e.type===3&&e.detail===metadata.control),'disconnect releases modifier')
  assert.deepEqual(errors,[])
  console.log('PASS: public domain + forced TURN, actual X11 video pixels, system mouse/key/text input, disconnect releases held keys.',actual)
} finally {
  await browser.close()
  const exit=once(fixture,'exit');fixture.kill('SIGTERM');await exit
  rmSync(dir,{recursive:true,force:true})
}
