import { createApp } from './server.js';
import { readConfig } from './config.js';
const app = await createApp(readConfig());
await app.listen({ host: process.env.API_HOST || '127.0.0.1', port: Number(process.env.API_PORT || 8787) });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
