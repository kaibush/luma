import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createApp } from './server.js'
const controlToken='c'.repeat(64),hostToken='h'.repeat(64),origin='https://console.test'
const browser={'x-remote-request':'1',origin}
const settings={workspaceName:'测试桌面',defaultQuality:'responsive',sessionMinutes:30,stunUrl:'',turnUrl:''}
const password='initial-password-12345'
const cookie=(r:{headers:Record<string,unknown>})=>String(r.headers['set-cookie']).split(';')[0]

test('one-time setup, scoped tokens, persistent settings, password and session revocation', {timeout:30000}, async()=>{
 const dir=mkdtempSync(join(tmpdir(),'remote-auth-')),dataPath=join(dir,'state.sqlite')
 let app=await createApp({controlToken,hostToken,origins:[origin],dataPath,secureCookies:true,logger:false})
 try {
  assert.equal((await app.inject('/api/auth/me')).json().initialized,false)
  assert.equal((await app.inject({method:'POST',url:'/api/auth/setup/unlock',payload:{key:controlToken}})).statusCode,403)
  assert.equal((await app.inject({method:'POST',url:'/api/auth/setup/unlock',headers:browser,payload:{key:'wrong'}})).statusCode,401)
  assert.equal((await app.inject({method:'POST',url:'/api/auth/setup/complete',headers:browser,payload:{username:'admin',password,settings}})).statusCode,401)
  const unlocked=await app.inject({method:'POST',url:'/api/auth/setup/unlock',headers:browser,payload:{key:controlToken}})
  assert.equal(unlocked.statusCode,200)
  const setupCookie=cookie(unlocked)
  assert.equal((await app.inject({url:'/api/manage/tokens',headers:{cookie:setupCookie}})).statusCode,401)
  const setup=await app.inject({method:'POST',url:'/api/auth/setup/complete',headers:{...browser,cookie:setupCookie},payload:{username:'admin',password,settings}})
  assert.equal(setup.statusCode,200)
  assert.match(String(setup.headers['set-cookie']),/HttpOnly; SameSite=Strict; Max-Age=43200; Secure/)
  const sessionCookie=cookie(setup),headers={...browser,cookie:sessionCookie}
  assert.equal((await app.inject({method:'POST',url:'/api/auth/setup/complete',headers:{...browser,cookie:setupCookie},payload:{username:'attacker',password,settings}})).statusCode,409)
  assert.equal((await app.inject({url:'/api/auth/me',headers})).json().user.username,'admin')
  assert.equal((await app.inject({url:'/api/manage/settings',headers:{authorization:`Bearer ${controlToken}`}})).statusCode,401)
  assert.equal((await app.inject({method:'PUT',url:'/api/manage/settings',headers:{cookie:sessionCookie,origin:'https://evil.test','x-remote-request':'1'},payload:{settings}})).statusCode,403)
  const updated={...settings,workspaceName:'更新后的桌面'}
  assert.equal((await app.inject({method:'PUT',url:'/api/manage/settings',headers,payload:{settings:updated}})).statusCode,200)
  const list=(await app.inject({url:'/api/manage/tokens',headers})).json().tokens
  assert.equal(list.length,2)
  assert.ok(!JSON.stringify(list).includes(controlToken))
  assert.ok(!JSON.stringify(list).includes('hash'))
  const created=await app.inject({method:'POST',url:'/api/manage/tokens',headers,payload:{name:'test controller',scope:'control',days:7}})
  assert.equal(created.statusCode,201)
  const token=created.json()
  assert.equal((await app.inject({url:'/api/hosts',headers:{authorization:`Bearer ${token.value}`}})).statusCode,200)
  assert.equal((await app.inject({method:'DELETE',url:`/api/manage/tokens/${token.id}`,headers})).statusCode,200)
  assert.equal((await app.inject({url:'/api/hosts',headers:{authorization:`Bearer ${token.value}`}})).statusCode,401)
  // Restart persists setup, login session, settings and revocation; bootstrap seed cannot resurrect a token.
  const originalControl=list.find((t:{scope:string})=>t.scope==='control')
  await app.inject({method:'DELETE',url:`/api/manage/tokens/${originalControl.id}`,headers})
  await app.close()
  app=await createApp({controlToken,hostToken,origins:[origin],dataPath,secureCookies:true,logger:false})
  assert.equal((await app.inject({url:'/api/manage/settings',headers})).json().settings.workspaceName,updated.workspaceName)
  assert.equal((await app.inject({url:'/api/hosts',headers:{authorization:`Bearer ${controlToken}`}})).statusCode,401)
  assert.equal((await app.inject({method:'POST',url:'/api/auth/login',headers:browser,payload:{username:'admin',password:'bad'}})).statusCode,401)
  assert.equal((await app.inject({method:'POST',url:'/api/auth/password',headers,payload:{currentPassword:password,password:'replacement-password-1234'}})).statusCode,200)
  assert.equal((await app.inject({url:'/api/hosts',headers})).statusCode,401)
  assert.equal((await app.inject({method:'POST',url:'/api/auth/login',headers:browser,payload:{username:'admin',password}})).statusCode,401)
  const login=await app.inject({method:'POST',url:'/api/auth/login',headers:browser,payload:{username:'admin',password:'replacement-password-1234'}})
  assert.equal(login.statusCode,200)
  const loggedIn={...browser,cookie:cookie(login)}
  await app.inject({method:'POST',url:'/api/auth/logout',headers:loggedIn,payload:{}})
  assert.equal((await app.inject({url:'/api/manage/tokens',headers:loggedIn})).statusCode,401)
  await app.close()
  const file=readFileSync(dataPath)
  assert.ok(!file.includes(Buffer.from(password)))
  assert.ok(!file.includes(Buffer.from('replacement-password-1234')))
  assert.ok(!file.includes(Buffer.from(hostToken)))
 } finally {await app.close();rmSync(dir,{recursive:true,force:true})}
})

test('cookie WebSocket auth and token revocation disconnect a live host', {timeout:20000}, async()=>{
 const app=await createApp({controlToken,hostToken,origins:[origin],logger:false})
 const sockets:WebSocket[]=[]
 try {
  await app.listen({host:'127.0.0.1',port:0})
  const port=(app.server.address() as {port:number}).port,url=`ws://127.0.0.1:${port}/ws`
  const unlocked=await app.inject({method:'POST',url:'/api/auth/setup/unlock',headers:browser,payload:{key:controlToken}})
  const initialized=await app.inject({method:'POST',url:'/api/auth/setup/complete',headers:{...browser,cookie:cookie(unlocked)},payload:{username:'admin',password,settings}})
  const headers={...browser,cookie:cookie(initialized)}
  const host=new WebSocket(url);sockets.push(host);await once(host,'open')
  let next=once(host,'message');host.send(JSON.stringify({type:'auth',role:'host',token:hostToken,name:'host'}))
  const {hostId}=JSON.parse(String((await next)[0]))
  const reserved=(await app.inject({method:'POST',url:'/api/sessions',headers,payload:{hostId}})).json()
  const controller=new WebSocket(url,{headers:{Origin:origin,Cookie:headers.cookie}});sockets.push(controller);await once(controller,'open')
  next=once(host,'message');controller.send(JSON.stringify({type:'auth',role:'controller',token:'',sessionId:reserved.session.id}));assert.equal(JSON.parse(String((await next)[0])).type,'session')
  const ready=once(controller,'message');host.send(JSON.stringify({type:'ready',sessionId:reserved.session.id}));assert.equal(JSON.parse(String((await ready)[0])).type,'ready')
  const ended=once(host,'message'),closed=once(controller,'close')
  await app.inject({method:'POST',url:'/api/auth/logout',headers,payload:{}})
  await closed;assert.equal(JSON.parse(String((await ended)[0])).type,'ended')
  const login=await app.inject({method:'POST',url:'/api/auth/login',headers:browser,payload:{username:'admin',password}})
  const adminHeaders={...browser,cookie:cookie(login)}
  const hostTokenId=(await app.inject({url:'/api/manage/tokens',headers:adminHeaders})).json().tokens.find((t:{scope:string})=>t.scope==='host').id
  const hostClosed=once(host,'close')
  await app.inject({method:'DELETE',url:`/api/manage/tokens/${hostTokenId}`,headers:adminHeaders});assert.equal((await hostClosed)[0],1008)
 }finally{sockets.forEach(ws=>ws.terminate());await app.close()}
})
