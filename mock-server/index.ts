import { existsSync } from 'node:fs';
import { buildServer } from './build-server.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.MOCK_PORT ?? 4000);
const app = buildServer();

await app.listen({ port, host: '127.0.0.1' });
console.log(`mock server listening on http://localhost:${port}`);
