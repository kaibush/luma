import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
// Bundled production entry lives one directory deeper at server/dist as well.
export function readConfig() {
  const controlToken = process.env.CONTROL_TOKEN || '', hostToken = process.env.HOST_TOKEN || '';
  if ([controlToken, hostToken].some(t => t.length < 32 || t.startsWith('replace-')) || controlToken === hostToken) throw new Error('Set different random CONTROL_TOKEN and HOST_TOKEN (32+ characters) in .env');
  return { dataPath: process.env.DATA_PATH || fileURLToPath(new URL('../../../data/control.sqlite', import.meta.url)), secureCookies: process.env.NODE_ENV === 'production', controlToken, hostToken, origins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(','), turnUrl: process.env.TURN_URL, turnSecret: process.env.TURN_SECRET, stunUrl: process.env.STUN_URL };
}
