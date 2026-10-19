import { createApp } from '../apps/server/src/server.ts'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dir = mkdtempSync(`${tmpdir()}/agent-client-`)
const token = 'test-host-token-'.repeat(4), control = 'test-control-token-'.repeat(4)
const app = await createApp({ hostToken: token, controlToken: control, origins: [], logger: false })
const children: ChildProcess[] = []
const firstOutput = (child: ChildProcess) => Promise.race([
  once(child.stdout!, 'data').then(([raw]) => raw.toString().trim()),
  new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Child startup timeout')), 15000).unref()),
])
try {
  await app.listen({ host: '127.0.0.1', port: 0 })
  const port = (app.server.address() as { port: number }).port
  const xvfb = spawn('Xvfb', ['-displayfd', '1', '-screen', '0', '1024x768x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'inherit'] }); children.push(xvfb)
  const display = ':' + await firstOutput(xvfb)
  const env = { ...process.env, DISPLAY: display, XAUTHORITY: '', XDG_SESSION_TYPE: 'x11', FIXTURE_OUTPUT: `${dir}/events.jsonl` }
  const python = resolve('apps/agent/.venv/bin/python')
  const fixture = spawn(python, ['apps/agent/input_fixture.py'], { env, stdio: ['ignore', 'pipe', 'inherit'] }); children.push(fixture)
  const metadata = await firstOutput(fixture)
  execFileSync('tar', ['-xzf', 'apps/web/public/downloads/remote-console-linux.tar.gz', '-C', dir])
  const host = spawn(python, [`${dir}/remote-console-agent/main.py`, '--managed'], { env: { ...env, HOST_TOKEN: token, HOST_NAME: 'Packaged test desktop', SIGNAL_URL: `ws://127.0.0.1:${port}/ws` }, stdio: ['pipe', 'ignore', 'inherit'] }); children.push(host)
  const receiver = spawn(python, ['scripts/agent-client-smoke.py'], { env: { ...env, TEST_API: `http://127.0.0.1:${port}`, TEST_CONTROL_TOKEN: control, TEST_FIXTURE: metadata }, stdio: 'inherit' }); children.push(receiver)
  const timeout = setTimeout(() => receiver.kill(), 60000)
  const [code] = await once(receiver, 'exit'); clearTimeout(timeout)
  if (code !== 0) throw new Error(`Receiver failed: ${code}`)
  const stopped = once(host, 'exit'); host.stdin!.end('stop\n'); await stopped
  for (let i = 0; i < 30; i++) {
    const hosts = (await app.inject({ url: '/api/hosts', headers: { authorization: `Bearer ${control}` } })).json().hosts
    if (hosts.length && !hosts[0].online) { console.log('PASS managed shutdown keeps an offline host record'); break }
    if (i === 29) throw new Error('Host remained online')
    await new Promise(r => setTimeout(r, 100))
  }
} finally {
  for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
  await app.close(); rmSync(dir, { recursive: true, force: true })
}
