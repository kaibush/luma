import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const path = fileURLToPath(new URL('../.env', import.meta.url))
try {
  writeFileSync(path, `CONTROL_TOKEN=${randomBytes(32).toString('hex')}\nHOST_TOKEN=${randomBytes(32).toString('hex')}\nAPI_HOST=127.0.0.1\nAPI_PORT=8787\nALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173\n`, { flag: 'wx', mode: 0o600 })
  console.log('Created .env with two random keys. Open .env locally to copy them into the host and controller pages.')
} catch (e) {
  if (e.code === 'EEXIST') console.log('.env already exists; no changes made.')
  else throw e
}
